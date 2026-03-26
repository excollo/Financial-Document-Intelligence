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
            resp = requests.get(file_url, timeout=60)
            resp.raise_for_status()
            file_content = resp.content

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
            toc_map = await self.extraction.get_toc(file_content)
            
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
            extraction_result = await self.extraction.extract_sections_from_pdf(
                file_content, 
                job_id=job_id,
                table_callback=stream_tables_to_mongo,
                provided_toc=toc_map
            )
            sections = extraction_result.get("sections", [])
            tables = extraction_result.get("tables", [])

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

            # 5. Chunk → embed → upsert each section
            total_upserted = 0
            chunk_offset = 0
            for section in sections:
                n = await self._process_section(
                    section=section,
                    base_metadata=base_metadata,
                    index_name=index_name,
                    host=host,
                    namespace=filename,
                    section_offset=chunk_offset,
                )
                total_upserted += n
                chunk_offset += n  # keep chunk_index globally unique

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
            
            # 1. First notify backend of failure (while document still exists)
            backend_notifier.notify_status(
                job_id=job_id,
                status="failed",
                namespace=filename,
                document_id=document_id,
                error={"message": str(e)},
            )
            
            # NOTE: We no longer delete the document automatically on failure
            # so the user can see the error message in their document list.
            
            raise


ingestion_pipeline = IngestionPipeline()
