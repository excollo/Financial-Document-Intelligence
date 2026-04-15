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

logger = get_logger(__name__)


class IngestionPipeline:
    def __init__(self):
        self.extraction = ExtractionService()
        self.chunking = ChunkingService()
        self.embedding = EmbeddingService()

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

        # Embed
        chunks_with_embeddings = await self.embedding.embed_chunks(chunks)

        # Build Pinecone vectors with hierarchy and table context
        index = vector_store_service.get_index(index_name, host=host)
        vectors = []
        for chunk in chunks_with_embeddings:
            meta = chunk.get("metadata", {})
            vector_id = f"{namespace}_{chunk['chunk_index']}"
            vectors.append(
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

        # Upsert in batches of 50 (matches n8n embeddingBatchSize: 50)
        batch_size = 60
        total_upserted = 0
        for i in range(0, len(vectors), batch_size):
            batch = vectors[i : i + batch_size]
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

        logger.info(
            "Section embedded and upserted",
            section=section_name,
            chunks=len(vectors),
            upserted=total_upserted,
        )
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
            file_content = None
            download_method = "presigned_url"

            try:
                resp = requests.get(file_url, timeout=60)
                resp.raise_for_status()
                file_content = resp.content
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
                        file_content = await s3_service.download_file(file_key)
                        download_method = "azure_blob_direct"
                        if not file_content:
                            raise RuntimeError(f"Azure Blob Storage direct download also failed for key: {file_key}")
                    else:
                        logger.error("Presigned URL expired and no fileKey in metadata for Azure Blob Storage fallback", job_id=job_id)
                        raise
                else:
                    raise

            logger.info(
                "[TIMING] Step 1: Document downloaded",
                seconds=round(time.time() - t_download, 2),
                size_mb=round(len(file_content) / 1_048_576, 2),
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
            toc_map = await self.extraction.get_toc(file_content)
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
            extraction_result = await self.extraction.extract_sections_from_pdf(
                file_content, 
                job_id=job_id,
                table_callback=stream_tables_to_mongo,
                provided_toc=toc_map
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

            # 5. Chunk → embed → upsert each section — PARALLELIZED
            # Each section's pipeline (chunk→embed→upsert) is fully independent,
            # so we can run them concurrently with asyncio.gather().
            # We batch in groups of 5 to avoid overwhelming OpenAI rate limits.
            total_upserted = 0
            PARALLEL_BATCH = 5  # sections processed concurrently

            # Pre-compute chunk offsets so vector IDs don't collide across sections
            # Estimate: each section produces ~(len(text)/3600) chunks on average
            chunk_estimates = []
            running_offset = 0
            for section in sections:
                chunk_estimates.append(running_offset)
                # Rough estimate of output chunks (4800 char size, 800 overlap)
                approx_chunks = max(1, len(section.get("text", "")) // 3600)
                running_offset += approx_chunks + 5  # +5 safety buffer

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
                batch = sections[batch_start: batch_start + PARALLEL_BATCH]
                offsets = chunk_estimates[batch_start: batch_start + PARALLEL_BATCH]

                logger.info(
                    "Processing section batch",
                    batch_start=batch_start,
                    batch_size=len(batch),
                    sections_total=len(sections)
                )

                results = await asyncio.gather(
                    *[process_section_with_offset(sec, off) for sec, off in zip(batch, offsets)],
                    return_exceptions=True
                )

                for r in results:
                    if isinstance(r, Exception):
                        logger.error("Section processing error", error=str(r))
                    else:
                        total_upserted += r


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
                status="success",  # Use "success" to trigger frontend close
                namespace=filename,
                document_id=metadata.get("documentId"),
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

        except Exception as e:
            logger.error("Ingestion pipeline failed", error=str(e), job_id=job_id)
            filename = metadata.get("filename", "document.pdf")
            document_id = metadata.get("documentId")

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
                    error={"message": str(e)},
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


ingestion_pipeline = IngestionPipeline()
