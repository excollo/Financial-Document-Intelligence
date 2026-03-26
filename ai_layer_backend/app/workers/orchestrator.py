"""
Pipeline Orchestrator — manages the end-to-end execution of a document processing job.
Driven by the SopConfig provided in the JobContext.
"""
import asyncio
import traceback
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
            await self._prepare_document()
            
            # 3. Core Section Extraction
            await self._process_sections()
            
            # 4. Special Processors (Adverse Findings, Research)
            await self._run_special_processors()
            
            # 5. Final Output Assembly
            await self.ctx.update_status(
                progress_pct=90, 
                current_stage="output_assembly"
            )
            await self._assemble_outputs()
            
            # 6. Completion
            await self.ctx.update_status(
                status="completed", 
                progress_pct=100, 
                current_stage="completed"
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

    async def _prepare_document(self):
        """Download document from S3/R2 and perform initial text extraction."""
        logger.info("Downloading PDF from S3", job_id=self.ctx.job_id, key=self.ctx.s3_input_key)
        
        file_content = await s3_service.download_file(self.ctx.s3_input_key)
        if not file_content:
            raise FileNotFoundError(f"Could not download PDF from S3: {self.ctx.s3_input_key}")

        logger.info("Extracting all sections from PDF", job_id=self.ctx.job_id)
        # Uses the existing extraction_service to get the basic section partitions from the PDF
        self.pdf_sections = extraction_service.extract_sections_from_pdf(file_content)
        
        if not self.pdf_sections:
            raise ValueError("PDF extraction yielded no sections. Check TOC parsing.")

    async def _process_sections(self):
        """Process each section defined in the SopConfig concurrently."""
        if not self.ctx.sop_config or 'sections' not in self.ctx.sop_config:
            logger.warning("No SOP config sections to process", job_id=self.ctx.job_id)
            return

        sop_sections = self.ctx.sop_config.get('sections', [])
        
        # 1. Map PDF segments to SOP sections
        logger.info("Mapping PDF segments to SOP sections", job_id=self.ctx.job_id)
        section_mapping = SectionSegmenter.map_pdf_to_sop(self.pdf_sections, self.ctx.sop_config)

        # 2. Concurrently process sections (with concurrency limit)
        semaphore = asyncio.Semaphore(5) # Limit to 5 at a time to protect OpenAI rate limits
        
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
        await asyncio.gather(*(process_with_limit(sec) for sec in sop_sections))

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
            db = mongodb.get_database()
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
            docx_key = f"outputs/{self.ctx.job_id}/{self.ctx.job_id}.docx"
            await s3_service.upload_file(docx_bytes, docx_key, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
            
            # 3. Generate Excel
            excel_bytes = self.excel_builder.build(job_metadata, section_results)
            excel_key = f"outputs/{self.ctx.job_id}/{self.ctx.job_id}.xlsx"
            await s3_service.upload_file(excel_bytes, excel_key, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
            
            logger.info("Outputs generated and uploaded", job_id=self.ctx.job_id)
            
            # Update job status with output URLs
            await self.ctx.update_status(
                output_urls={
                    "docx": s3_service.get_public_url(docx_key),
                    "excel": s3_service.get_public_url(excel_key)
                }
            )
            
        except Exception as e:
            logger.error("Output assembly failed", error=str(e))
            # Non-blocking, the job results are still in MongoDB
            pass
