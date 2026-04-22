"""
Synchronous Ingestion Pipeline.
Replicates the n8n embedding workflow exactly:

  PDF → pdfplumber section extraction
     → per-section cleaning (already done in ExtractionService)
     → RecursiveCharacterTextSplitter (chunkSize=4000, overlap=800)
     → OpenAI text-embedding-3-large (batch 50)
     → Pinecone upsert with metadata:
           documentName, documentId, domain, domainId, type,
           sectionName, sectionPageRange   ← NEW (n8n Default Data Loader3)
"""
import time
import asyncio
import os
import tempfile
from typing import Dict, Any, Optional, List
import requests

from app.services.extraction import ExtractionService
from app.services.chunking import ChunkingService
from app.services.embedding import EmbeddingService
from app.services.vector_store import vector_store_service
from app.services.backend_notifier import backend_notifier
from app.db.mongo import mongodb
from app.core.config import settings
from app.core.logging import get_logger
from app.core.memory import maybe_collect

logger = get_logger(__name__)


class IngestionPipeline:
    def __init__(self):
        self.extraction = ExtractionService()
        self.chunking = ChunkingService()
        self.embedding = EmbeddingService()

    def _compute_section_offsets(self, sections: List[Dict[str, Any]]) -> List[int]:
        """Compute exact chunk offsets to avoid vector-id collisions."""
        offsets: List[int] = []
        running_offset = 0
        for section in sections:
            offsets.append(running_offset)
            section_text = str(section.get("text", "") or "").strip()
            if len(section_text) < 20:
                continue
            running_offset += len(self.chunking.split_text(section_text))
        return offsets

    # ----------------------------------------------------------------------- #
    # Internal: process one section's text into Pinecone chunks
    # ----------------------------------------------------------------------- #
    async def _process_section(
        self,
        section: Dict[str, Any],
        base_metadata: Dict[str, Any],
        index_name: str,
        host: str,
        namespace: str,
        section_offset: int,
    ) -> int:
        """
        Chunk → embed → upsert one section.
        Returns number of vectors upserted.
        """
        text = section.get("text", "").strip()
        if len(text) < 20:
            return 0

        section_name = section.get("sectionName", "General")
        subsection_name = section.get("subsectionName", "")
        section_range = section.get("sectionStart&End", "")
        table_count = section.get("table_count", 0)
        table_headings = section.get("table_headings", "")

        # Build per-section metadata (identifying section, subsection, and tables)
        chunk_metadata = {
            **base_metadata,
            "sectionName": section_name,
            "subsectionName": subsection_name,
            "subsectionRange": section_range,
            "tableCount": table_count,
            "tableHeading": table_headings
        }

        chunks = self.chunking.chunk_with_metadata(text, metadata=chunk_metadata)
        if not chunks:
            return 0

        # Re-index chunk_index to be globally unique across all sections
        for i, chunk in enumerate(chunks):
            chunk["chunk_index"] = section_offset + i

        # Build Pinecone vectors with hierarchy and table context
        index = vector_store_service.get_index(index_name, host=host)
        batch_size = self.embedding.get_batch_size()
        total_upserted = 0
        for i in range(0, len(chunks), batch_size):
            chunk_batch = chunks[i : i + batch_size]
            chunks_with_embeddings = await self.embedding.embed_chunks(chunk_batch)
            batch = []
            for chunk in chunks_with_embeddings:
                meta = chunk.get("metadata", {})
                vector_id = f"{namespace}_{chunk['chunk_index']}"
                batch.append(
                    {
                        "id": vector_id,
                        "values": chunk["embedding"],
                        "metadata": {
                            "text": chunk["chunk_text"],
                            "chunk_index": chunk["chunk_index"],
                            "documentName": meta.get("documentName", namespace),
                            "documentId": meta.get("documentId", ""),
                            "domain": meta.get("domain", ""),
                            "domainId": meta.get("domainId", ""),
                            "type": meta.get("type", "DRHP"),
                            "sectionName": meta.get("sectionName", ""),
                            "subsectionName": meta.get("subsectionName", ""),
                            "subsectionRange": meta.get("subsectionRange", ""),
                            "tableCount": meta.get("tableCount", 0),
                            "tableHeading": meta.get("tableHeading", "")
                        },
                    }
                )
            try:
                resp = index.upsert(vectors=batch, namespace="")
                total_upserted += getattr(resp, "upserted_count", len(batch))
            except Exception as e:
                logger.error(
                    "Batch upsert failed",
                    section=section_name,
                    batch_start=i,
                    error=str(e),
                )
                raise
        maybe_collect(stage="ingestion.section_upsert_complete", size_hint_mb=140.0)

        logger.info(
            "Section embedded and upserted",
            section=section_name,
            chunks=len(chunks),
            upserted=total_upserted,
        )
        del chunks
        return total_upserted

    # ----------------------------------------------------------------------- #
    # Public entry-point
    # ----------------------------------------------------------------------- #
    async def process(
        self,
        file_url: str,
        file_type: str,
        job_id: str,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        Full ingestion pipeline matching the n8n embedding workflow.

        n8n flow replicated:
          Webhook → parse PDF (pdfplumber, section-wise)
                 → Cleaned text3 (cleaning already done in ExtractionService)
                 → Default Data Loader3 (metadata attachment)
                 → Recursive Character Text Splitter (4000 / 800)
                 → Pinecone Vector Store (text-embedding-3-large, batch 50)
        """
        start_time = time.time()
        metadata = metadata or {}
        doc_type = metadata.get("doc_type", "drhp").upper()
        filename = metadata.get("filename", "document.pdf")

        logger.info(
            "Starting section-wise ingestion pipeline",
            job_id=job_id,
            filename=filename,
            doc_type=doc_type,
        )

        try:
            # 1. Download document
            # Strategy: Try presigned URL first. If it expired (403), download
            # directly from Azure Blob Storage using the Python backend's own credentials.
            # This handles the case where the Celery queue delay exceeds the
            # 1-hour presigned URL expiry.
            t_download = time.time()
            download_path = None
            download_method = "presigned_url"

            try:
                with requests.get(file_url, timeout=60, stream=True) as resp:
                    resp.raise_for_status()
                    fd, path = tempfile.mkstemp(suffix=".pdf")
                    os.close(fd)
                    download_path = path
                    try:
                        with open(download_path, "wb") as f:
                            for chunk in resp.iter_content(chunk_size=1024 * 1024):
                                if chunk:
                                    f.write(chunk)
                    except Exception:
                        if download_path and os.path.exists(download_path):
                            os.remove(download_path)
                        download_path = None
                        raise
            except requests.exceptions.HTTPError as download_err:
                status_code = download_err.response.status_code if download_err.response is not None else 0
                if status_code == 403:
                    # Presigned URL expired — download directly from Azure Blob Storage
                    file_key = metadata.get("fileKey")
                    if file_key:
                        logger.warning(
                            "Presigned URL expired (403). Downloading directly from Azure Blob Storage.",
                            job_id=job_id,
                            file_key=file_key
                        )
                        from app.services.s3 import s3_service
                        download_path = await s3_service.download_file_to_path(file_key)
                        download_method = "azure_blob_direct"
                        if not download_path:
                            raise RuntimeError(f"Azure Blob Storage direct download also failed for key: {file_key}")
                    else:
                        logger.error("Presigned URL expired and no fileKey in metadata for Azure Blob Storage fallback", job_id=job_id)
                        raise
                else:
                    raise

            logger.info(
                "[TIMING] Step 1: Document downloaded",
                seconds=round(time.time() - t_download, 2),
                size_mb=round((os.path.getsize(download_path) if download_path else 0) / 1_048_576, 2),
                method=download_method,
                job_id=job_id
            )

            # Define early storage callback for streaming tables to Mongo
            async def stream_tables_to_mongo(batch_tables):
                if not batch_tables: return
                try:
                    if mongodb.sync_db is None:
                        mongodb.connect_sync()
                    result_collection = mongodb.get_sync_collection("extraction_results")
                    for t in batch_tables:
                        t["job_id"] = job_id
                        t["filename"] = filename
                        t["doc_type"] = doc_type
                        t["created_at"] = time.time()
                        # Update or insert immediately
                        result_collection.update_one(
                            {"table_id": t["table_id"]},
                            {"$set": t},
                            upsert=True
                        )
                except Exception as ex_mongo:
                    logger.warning(f"Streaming to Mongo failed for job {job_id}: {str(ex_mongo)}")

            # 2. Extract TOC First (Robust 1st check)
            t_toc = time.time()
            toc_map = await self.extraction.get_toc(download_path)
            logger.info(
                "[TIMING] Step 2: TOC extracted",
                seconds=round(time.time() - t_toc, 2),
                entries=len(toc_map),
                job_id=job_id
            )
            
            # --- Store TOC Metadata for Summary Pipeline ---
            try:
                if mongodb.sync_db is None:
                    mongodb.connect_sync()
                metadata_coll = mongodb.get_sync_collection("document_metadata")
                # Keep full TOC structure (title, pages, etc)
                toc_data = [{"title": s.get("name"), "start_page": s.get("start_page"), "end_page": s.get("end_page"), "type": s.get("type")} for s in toc_map]
                metadata_coll.update_one(
                    {"filename": filename},
                    {"$set": {
                        "job_id": job_id,
                        "filename": filename,
                        "doc_type": doc_type,
                        "toc": toc_data,
                        "updated_at": time.time()
                    }},
                    upsert=True
                )
                logger.info("Stored TOC metadata (1st check)", filename=filename, toc_size=len(toc_data))
            except Exception as me:
                logger.warning("Failed to store TOC metadata", error=str(me))

            # 3. Extract section-wise with real-time table streaming (using provided TOC)
            t_extract = time.time()
            extraction_timeout = max(120, settings.INGESTION_EXTRACTION_TIMEOUT_SECONDS)
            logger.info(
                "Starting Step 3 extraction",
                job_id=job_id,
                timeout_seconds=extraction_timeout,
            )
            extraction_result = await asyncio.wait_for(
                self.extraction.extract_sections_from_pdf(
                    download_path,
                    job_id=job_id,
                    table_callback=stream_tables_to_mongo,
                    provided_toc=toc_map
                ),
                timeout=extraction_timeout,
            )
            sections = extraction_result.get("sections", [])
            tables = extraction_result.get("tables", [])
            logger.info(
                "[TIMING] Step 3: PDF extraction complete",
                seconds=round(time.time() - t_extract, 2),
                sections=len(sections),
                tables=len(tables),
                job_id=job_id
            )

            if not sections:
                logger.warning("No sections extracted from document", job_id=job_id)
                document_id = metadata.get("documentId")
                
                # 1. Notify backend of failure with specific error message
                backend_notifier.notify_status(
                    job_id=job_id,
                    status="failed",
                    namespace=filename,
                    document_id=document_id,
                    workspace_id=metadata.get("workspaceId"),
                    domain_id=metadata.get("domainId"),
                    error={"message": "No text extracted from document. Check if the PDF is non-searchable."}
                )
                
                # NOTE: We no longer delete the document automatically on failure
                # so the user can see the error message in their document list.
                
                return {"success": False, "error": "No text extracted from document"}

            logger.info(
                "Sections extracted",
                job_id=job_id,
                section_count=len(sections),
                table_count=len(tables)
            )

            # 3. Base metadata (everything except section-level fields)
            base_metadata = {
                "source": file_url,
                "job_id": job_id,
                "documentName": filename,
                "documentId": metadata.get("documentId", ""),
                "domain": metadata.get("domain", ""),
                "domainId": metadata.get("domainId", ""),
                "type": doc_type,
            }

            # 4. Pinecone index
            index_name = settings.PINECONE_INDEX
            host = settings.PINECONE_INDEX_HOST
            vector_write_stage_started = False

            # 5. Chunk → embed → upsert each section — PARALLELIZED
            # Each section's pipeline (chunk→embed→upsert) is fully independent,
            # so we can run them concurrently with asyncio.gather().
            # We batch in groups of 5 to avoid overwhelming OpenAI rate limits.
            total_upserted = 0
            PARALLEL_BATCH = max(1, settings.INGESTION_PARALLEL_BATCH)

            # Pre-compute exact chunk offsets so vector IDs do not collide.
            chunk_offsets = self._compute_section_offsets(sections)

            async def process_section_with_offset(section, offset):
                return await self._process_section(
                    section=section,
                    base_metadata=base_metadata,
                    index_name=index_name,
                    host=host,
                    namespace=filename,
                    section_offset=offset,
                )

            for batch_start in range(0, len(sections), PARALLEL_BATCH):
                # Consistency policy:
                # if any later section fails after we started vector writes,
                # we compensate by deleting vectors for this document/job attempt.
                vector_write_stage_started = True
                batch = sections[batch_start: batch_start + PARALLEL_BATCH]
                offsets = chunk_offsets[batch_start: batch_start + PARALLEL_BATCH]

                logger.info(
                    "Processing section batch",
                    batch_start=batch_start,
                    batch_size=len(batch),
                    sections_total=len(sections)
                )

                section_tasks = [
                    asyncio.create_task(process_section_with_offset(sec, off))
                    for sec, off in zip(batch, offsets)
                ]
                await asyncio.wait(section_tasks, return_when=asyncio.ALL_COMPLETED)

                failed_sections: List[Dict[str, str]] = []
                for task, section in zip(section_tasks, batch):
                    try:
                        total_upserted += task.result()
                    except Exception as section_err:
                        section_name = str(section.get("sectionName") or "unknown")
                        failed_sections.append(
                            {"section": section_name, "error": str(section_err)}
                        )
                        logger.error(
                            "Section processing error",
                            section=section_name,
                            error=str(section_err),
                        )

                if failed_sections:
                    raise RuntimeError(
                        f"Section processing failed for {len(failed_sections)} sections: {failed_sections}"
                    )


            # 6. MongoDB record
            try:
                if mongodb.sync_db is None:
                    mongodb.connect_sync()
                collection = mongodb.get_sync_collection("document_processing")
                collection.insert_one(
                    {
                        "job_id": job_id,
                        "filename": filename,
                        "doc_type": doc_type,
                        "status": "completed",
                        "sections_processed": len(sections),
                        "pinecone_count": total_upserted,
                        "created_at": time.time(),
                    }
                )
            except Exception as mongo_err:
                logger.warning("MongoDB record skipped", error=str(mongo_err))

            # 7. Notify backend
            backend_notifier.notify_status(
                job_id=job_id,
                status="completed",
                namespace=filename,
                document_id=metadata.get("documentId"),
                workspace_id=metadata.get("workspaceId"),
                domain_id=metadata.get("domainId"),
            )

            execution_time = time.time() - start_time
            logger.info(
                "Ingestion pipeline completed",
                job_id=job_id,
                sections=len(sections),
                total_vectors=total_upserted,
                duration=execution_time,
            )

            return {
                "success": True,
                "filename": filename,
                "sections_processed": len(sections),
                "total_vectors": total_upserted,
                "duration": execution_time,
            }

        except asyncio.TimeoutError:
            timeout_seconds = max(120, settings.INGESTION_EXTRACTION_TIMEOUT_SECONDS)
            message = f"PDF extraction timed out after {timeout_seconds} seconds"
            logger.error(message, job_id=job_id)
            filename = metadata.get("filename", "document.pdf")
            document_id = metadata.get("documentId")
            backend_notifier.notify_status(
                job_id=job_id,
                status="failed",
                namespace=filename,
                document_id=document_id,
                error={"message": message},
            )
            raise RuntimeError(message)
        except Exception as e:
            logger.error("Ingestion pipeline failed", error=str(e), job_id=job_id)
            filename = metadata.get("filename", "document.pdf")
            document_id = metadata.get("documentId")
            cleanup_error = None

            if (
                "vector_write_stage_started" in locals()
                and vector_write_stage_started
                and "index_name" in locals()
                and "host" in locals()
            ):
                try:
                    vector_store_service.delete_vectors(
                        index_name=index_name,
                        namespace=filename,
                        host=host,
                        document_id=str(document_id or ""),
                    )
                    logger.warning(
                        "Compensating vector cleanup applied after ingestion failure",
                        job_id=job_id,
                        document_id=document_id,
                        namespace=filename,
                    )
                except Exception as cleanup_exc:
                    cleanup_error = str(cleanup_exc)
                    logger.error(
                        "Compensating vector cleanup failed",
                        job_id=job_id,
                        document_id=document_id,
                        namespace=filename,
                        error=cleanup_error,
                    )

            current_retry = int(metadata.get("_celery_current_retry", 0))
            max_retries = int(metadata.get("_celery_max_retries", 0))
            is_terminal_attempt = current_retry >= max_retries

            # Avoid sending a terminal failed callback during retriable attempts.
            if is_terminal_attempt:
                backend_notifier.notify_status(
                    job_id=job_id,
                    status="failed",
                    namespace=filename,
                    document_id=document_id,
                    workspace_id=metadata.get("workspaceId"),
                    domain_id=metadata.get("domainId"),
                    error={
                        "message": str(e),
                        "vector_cleanup_error": cleanup_error,
                    } if cleanup_error else {"message": str(e)},
                )
            else:
                logger.warning(
                    "Ingestion failed on retryable attempt; deferring failed callback until terminal attempt",
                    job_id=job_id,
                    current_retry=current_retry,
                    max_retries=max_retries,
                )
            
            # NOTE: We no longer delete the document automatically on failure
            # so the user can see the error message in their document list.
            
            raise
        finally:
            if "download_path" in locals() and download_path and os.path.exists(download_path):
                try:
                    os.remove(download_path)
                except Exception:
                    pass


ingestion_pipeline = IngestionPipeline()
