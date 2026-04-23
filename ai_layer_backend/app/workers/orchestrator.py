"""
Pipeline Orchestrator — manages the end-to-end execution of a document processing job.
Driven by the SopConfig provided in the JobContext.
"""
import asyncio
import traceback
import time
import os
import hashlib
from typing import Dict, Any, List, Optional
from app.workers.job_context import JobContext
from app.services.s3 import s3_service
from app.services.extraction import extraction_service
from app.workers.segmenter import SectionSegmenter
from app.workers.section_extractor import SectionExtractor
from app.workers.adverse_processor import AdverseFindingProcessor
from app.workers.docx_builder import DocxBuilder
from app.workers.excel_builder import ExcelBuilder
from app.db.mongo import mongodb
from app.core.logging import get_logger
from app.services.checkpoint_store import checkpoint_store

logger = get_logger(__name__)


class PipelineOrchestrator:
    """
    Orchestrates the modular pipeline steps:
    1. Preparation (Download PDF, Analyze SOP)
    2. Extraction (Text and Tables)
    3. Section Processing (Iterate over SopConfig sections)
    4. Post-processing (Adverse findings, research)
    5. Final Output (Docx/Excel assembly)
    """

    def __init__(self, context: JobContext):
        self.ctx = context
        self.extractor = SectionExtractor(context)
        self.adverse_processor = AdverseFindingProcessor(context)
        self.docx_builder = DocxBuilder()
        self.excel_builder = ExcelBuilder()
        self._extraction_checkpoint_metadata: Dict[str, Any] = {}

    async def run(self):
        """The main pipeline execution loop."""
        try:
            logger.info("Pipeline run started", job_id=self.ctx.job_id)
            
            # 1. Initialization
            await self.ctx.update_status(
                status="processing", 
                progress_pct=5, 
                current_stage="initialization"
            )
            # Already initialized in task wrapper (sop_config fetched)
            
            # 2. Preparation (PDF Download & Basic Parse)
            await self.ctx.update_status(
                progress_pct=10, 
                current_stage="preparation"
            )
            await self._run_stage("ingestion", self._prepare_document, stage_label="preparation")
            
            # 3. Core Section Extraction
            await self._run_stage("extraction", self._process_sections, stage_label="extracting_sections")
            
            # 4. Special Processors (Adverse Findings, Research)
            await self._run_stage("summary", self._run_special_processors, stage_label="running_adverse_research")
            
            # 5. Final Output Assembly
            await self.ctx.update_status(
                progress_pct=90, 
                current_stage="output_assembly"
            )
            assembly_result = await self._run_stage("upload", self._assemble_outputs, stage_label="output_assembly")
            
            # 6. Completion
            if not assembly_result.get("ok"):
                await self.ctx.update_status(
                    status="completed_with_errors",
                    progress_pct=100,
                    current_stage="completed_with_errors",
                    error_message="; ".join(assembly_result.get("errors", ["Output assembly failed"])),
                )
                logger.warning(
                    "Pipeline completed with output errors",
                    job_id=self.ctx.job_id,
                    errors=assembly_result.get("errors", []),
                )
                return

            await self.ctx.update_status(
                status="completed", 
                progress_pct=100, 
                current_stage="completed",
                output_urls=assembly_result.get("output_urls"),
            )
            logger.info("Pipeline run successfully completed", job_id=self.ctx.job_id)

        except Exception as e:
            logger.error(
                "Pipeline execution failed", 
                job_id=self.ctx.job_id, 
                error=str(e), 
                trace=traceback.format_exc()
            )
            # Notify Node of failure
            await self.ctx.update_status(
                status="failed", 
                progress_pct=100, 
                error_message=str(e)
            )
            raise e

    async def _run_stage(self, stage_name: str, fn, stage_label: Optional[str] = None):
        checkpoint = await checkpoint_store.get_checkpoint(self.ctx.job_id, stage_name)
        if checkpoint and checkpoint.get("status") == "completed":
            verified = await self._verify_checkpoint_artifacts(stage_name, checkpoint)
            if verified:
                resumable = checkpoint.get("resumable_metadata") or {}
                if stage_name == "ingestion" and resumable.get("pdf_sections"):
                    self.pdf_sections = resumable.get("pdf_sections")
                logger.info("Skipping stage using verified checkpoint", job_id=self.ctx.job_id, stage_name=stage_name)
                return {"resumed": True}
            logger.warning("Checkpoint verification failed; rerunning stage", job_id=self.ctx.job_id, stage_name=stage_name)

        started = time.time()
        if stage_label:
            await self.ctx.update_status(current_stage=stage_label)
        try:
            result = await fn()
            ended = time.time()
            await self.ctx.update_status(
                stage_event={
                    "stage_name": stage_name,
                    "start_time": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(started)),
                    "end_time": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(ended)),
                    "duration_ms": int((ended - started) * 1000),
                    "status": "success",
                }
            )
            metadata: Dict[str, Any] = {}
            if stage_name == "ingestion":
                metadata["input_key"] = self.ctx.s3_input_key
                metadata["document_name"] = self.ctx.document_name
                metadata["ingestion_fingerprint"] = self._ingestion_fingerprint()
            if stage_name == "extraction":
                metadata.update(self._extraction_checkpoint_metadata or {})
            await checkpoint_store.mark_completed(self.ctx.job_id, stage_name, metadata=metadata)
            return result
        except Exception as exc:
            ended = time.time()
            await self.ctx.update_status(
                stage_event={
                    "stage_name": stage_name,
                    "start_time": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(started)),
                    "end_time": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(ended)),
                    "duration_ms": int((ended - started) * 1000),
                    "status": "failed",
                    "error_reason": str(exc),
                }
            )
            await checkpoint_store.mark_failed(
                self.ctx.job_id,
                stage_name,
                metadata={"error_reason": str(exc)},
            )
            raise

    async def _verify_checkpoint_artifacts(self, stage_name: str, checkpoint: Dict[str, Any]) -> bool:
        metadata = checkpoint.get("resumable_metadata") or {}
        if stage_name == "ingestion":
            return (
                metadata.get("input_key") == self.ctx.s3_input_key
                and metadata.get("document_name") == self.ctx.document_name
                and metadata.get("ingestion_fingerprint") == self._ingestion_fingerprint()
            )
        if stage_name == "extraction":
            db = mongodb.db
            if db is None:
                return False
            if not self.ctx.sop_config or "sections" not in self.ctx.sop_config:
                return False
            if not getattr(self, "pdf_sections", None):
                return False
            expected_ids = metadata.get("expected_section_ids") or []
            expected_digest = metadata.get("section_identity_digest")
            if not expected_ids or not expected_digest:
                return False
            section_mapping = SectionSegmenter.map_pdf_to_sop(self.pdf_sections, self.ctx.sop_config)
            current_metadata = self._build_extraction_checkpoint_metadata(section_mapping, self.ctx.sop_config.get("sections", []))
            if current_metadata.get("section_identity_digest") != expected_digest:
                return False
            if current_metadata.get("expected_section_ids") != expected_ids:
                return False
            coll = db.get_collection("sectionresults")
            cursor = coll.find(
                {
                    "job_id": self.ctx.job_id,
                    "status": {"$in": ["completed", "skipped"]},
                    "section_id": {"$in": expected_ids},
                },
                {"section_id": 1},
            )
            docs = await cursor.to_list(length=max(len(expected_ids), 1) * 2)
            persisted_ids = sorted({str(doc.get("section_id")) for doc in docs if doc.get("section_id")})
            return persisted_ids == sorted([str(section_id) for section_id in expected_ids])
        if stage_name == "upload":
            docx_key = f"outputs/{self.ctx.job_id}/{self.ctx.job_id}.docx"
            excel_key = f"outputs/{self.ctx.job_id}/{self.ctx.job_id}.xlsx"
            return await s3_service.file_exists(docx_key) and await s3_service.file_exists(excel_key)
        if stage_name == "summary":
            # No reliable durable artifact contract yet; rerun for correctness.
            return False
        return False

    def _ingestion_fingerprint(self) -> str:
        payload = f"{self.ctx.job_id}:{self.ctx.s3_input_key or ''}:{self.ctx.document_name or ''}"
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()

    def _build_extraction_checkpoint_metadata(self, section_mapping: Dict[str, Any], sop_sections: List[Dict[str, Any]]) -> Dict[str, Any]:
        expected_section_ids: List[str] = []
        signature_parts: List[str] = []
        for section in sop_sections:
            sid = str(section.get("section_id") or "").strip()
            if not sid:
                continue
            expected_section_ids.append(sid)
            segment = section_mapping.get(sid) or {}
            text = str(segment.get("text") or "")
            signature_parts.append(f"{sid}:{hashlib.sha256(text.encode('utf-8')).hexdigest()}")
        digest = hashlib.sha256("|".join(signature_parts).encode("utf-8")).hexdigest() if signature_parts else ""
        return {
            "expected_section_count": len(expected_section_ids),
            "expected_section_ids": expected_section_ids,
            "section_identity_digest": digest,
        }

    async def _prepare_document(self):
        """Download document from Azure Blob Storage and perform initial text extraction."""
        logger.info("Downloading PDF from Azure Blob Storage", job_id=self.ctx.job_id, key=self.ctx.s3_input_key)
        
        file_content = await s3_service.download_file(self.ctx.s3_input_key)
        if not file_content:
            raise FileNotFoundError(f"Could not download PDF from Azure Blob Storage: {self.ctx.s3_input_key}")

        logger.info("Extracting all sections and tables from PDF (Parallel)", job_id=self.ctx.job_id)
        
        # Callback to save tables to MongoDB as they are extracted
        async def table_save_callback(tables: List[Dict[str, Any]]):
            try:
                db = mongodb.db
                if db is None:
                    logger.error("MongoDB not connected in table_save_callback")
                    return
                
                collection = db.get_collection("extraction_results")
                # Add job_id, tenant_id and filename to each table record for cross-service compatibility
                for t in tables:
                    t["job_id"] = self.ctx.job_id
                    t["tenant_id"] = self.ctx.tenant_id
                    t["filename"] = self.ctx.document_name
                    t["created_at"] = time.time()
                
                if tables:
                    await collection.insert_many(tables)
                    logger.info(f"Buffered {len(tables)} tables to MongoDB (extraction_results)", job_id=self.ctx.job_id)
            except Exception as e:
                logger.error(f"Failed to stream tables to MongoDB: {e}", job_id=self.ctx.job_id)

        # Uses the existing extraction_service to get the basic section partitions from the PDF
        # Note: Now awaited to fix the coroutine bug.
        result = await extraction_service.extract_sections_from_pdf(
            file_content, 
            job_id=self.ctx.job_id,
            table_callback=table_save_callback
        )
        
        self.pdf_sections = result.get("sections", [])
        
        if not self.pdf_sections:
            raise ValueError("PDF extraction yielded no sections. Check TOC parsing.")

    async def _process_sections(self):
        """Process each section defined in the SopConfig concurrently."""
        if not self.ctx.sop_config or 'sections' not in self.ctx.sop_config:
            logger.warning("No SOP config sections to process", job_id=self.ctx.job_id)
            return

        sop_sections = self.ctx.sop_config.get('sections', [])
        
        chunking_started = time.time()
        # 1. Map PDF segments to SOP sections
        logger.info("Mapping PDF segments to SOP sections", job_id=self.ctx.job_id)
        section_mapping = SectionSegmenter.map_pdf_to_sop(self.pdf_sections, self.ctx.sop_config)
        self._extraction_checkpoint_metadata = self._build_extraction_checkpoint_metadata(section_mapping, sop_sections)
        chunking_ended = time.time()
        await self.ctx.update_status(
            stage_event={
                "stage_name": "chunking",
                "start_time": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(chunking_started)),
                "end_time": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(chunking_ended)),
                "duration_ms": int((chunking_ended - chunking_started) * 1000),
                "status": "success",
            }
        )

        # 2. Concurrently process sections (with concurrency limit)
        max_embedding_concurrency = int(os.environ.get("MAX_CONCURRENT_EMBEDDING_TASKS", "5"))
        semaphore = asyncio.Semaphore(max_embedding_concurrency) # protect model/vector capacity
        
        async def process_with_limit(section_def):
            async with semaphore:
                sid = section_def.get('section_id')
                segment = section_mapping.get(sid)
                
                if not segment:
                    logger.warning(f"Skipping section {sid}: no mapped text segment found")
                    await self.ctx.submit_section_result(
                        section_id=sid,
                        status="skipped",
                        error_message="Segment not found in PDF"
                    )
                    return

                # Update progress stage
                await self.ctx.update_status(current_stage=f"extracting:{sid}")
                
                # Execute Extraction
                result = await self.extractor.process(sid, segment)
                
                # Submit Result to Node
                await self.ctx.submit_section_result(
                    section_id=sid,
                    **result
                )

        # Dispatch all sections
        logger.info(f"Dispatching extraction for {len(sop_sections)} sections", job_id=self.ctx.job_id)
        embedding_started = time.time()
        await asyncio.gather(*(process_with_limit(sec) for sec in sop_sections))
        embedding_ended = time.time()
        duration_ms = int((embedding_ended - embedding_started) * 1000)
        for stage_name in ("embedding", "vector_upsert"):
            await self.ctx.update_status(
                stage_event={
                    "stage_name": stage_name,
                    "start_time": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(embedding_started)),
                    "end_time": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(embedding_ended)),
                    "duration_ms": duration_ms,
                    "status": "success",
                }
            )

    async def _run_special_processors(self):
        """Run processors like adverse findings that aren't strictly section-based."""
        logger.info("Running special processors", job_id=self.ctx.job_id)
        
        await self.ctx.update_status(progress_pct=85, current_stage="running_adverse_research")
        await self.adverse_processor.run()

    async def _assemble_outputs(self):
        """Assemble docx and excel files from all results."""
        logger.info("Assembling final outputs", job_id=self.ctx.job_id)
        
        # 1. Fetch all section results from MongoDB for this job
        try:
            db = mongodb.db
            if db is None:
                raise RuntimeError("MongoDB not connected during output assembly")
            
            collection = db.get_collection("sectionresults")
            
            cursor = collection.find({"job_id": self.ctx.job_id})
            section_results = await cursor.to_list(length=100)
            
            job_metadata = {
                "job_id": self.ctx.job_id,
                "document_name": self.ctx.document_name,
                "created_at": "Today" # Could be sourced from Mongo Job record
            }
            
            # 2. Generate Docx
            docx_bytes = self.docx_builder.build(job_metadata, section_results)
            if not docx_bytes:
                raise RuntimeError("DOCX builder returned empty content")
            docx_key = f"outputs/{self.ctx.job_id}/{self.ctx.job_id}.docx"
            docx_uploaded = await s3_service.upload_file(
                docx_bytes,
                docx_key,
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            )
            docx_exists = await s3_service.file_exists(docx_key)
            if not docx_uploaded or not docx_exists:
                raise RuntimeError("Failed to upload DOCX artifact")
            
            # 3. Generate Excel
            excel_bytes = self.excel_builder.build(job_metadata, section_results)
            if not excel_bytes:
                raise RuntimeError("Excel builder returned empty content")
            excel_key = f"outputs/{self.ctx.job_id}/{self.ctx.job_id}.xlsx"
            excel_uploaded = await s3_service.upload_file(
                excel_bytes,
                excel_key,
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
            excel_exists = await s3_service.file_exists(excel_key)
            if not excel_uploaded or not excel_exists:
                raise RuntimeError("Failed to upload Excel artifact")
            
            logger.info("Outputs generated and uploaded", job_id=self.ctx.job_id)

            output_urls = {
                "docx": s3_service.get_public_url(docx_key),
                "excel": s3_service.get_public_url(excel_key),
            }
            if not output_urls["docx"] or not output_urls["excel"]:
                raise RuntimeError("One or more output URLs are missing")

            return {"ok": True, "output_urls": output_urls, "errors": []}
        except Exception as e:
            logger.error("Output assembly failed", error=str(e), job_id=self.ctx.job_id)
            return {"ok": False, "output_urls": None, "errors": [str(e)]}
