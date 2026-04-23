"""
Job Context — holds the state and configuration for a single pipeline run.
Provides a unified interface for updating status, progress, and submitting results
to the Node.js backend via NodeBackendClient.
"""
import asyncio
from typing import Optional, Dict, Any, List
from app.services.node_client import node_client
from app.core.logging import get_logger
from app.services.metrics import metrics

logger = get_logger(__name__)


class JobContext:
    """
    Context for a pipeline job run. 
    Maintains status and provides thread/async-safe update methods.
    """

    def __init__(
        self,
        job_id: str,
        tenant_id: str,
        workspace_id: str,
        domain_id: str,
        sop_config: Optional[Dict[str, Any]] = None,
        document_name: Optional[str] = None,
        s3_input_key: Optional[str] = None,
    ):
        self.job_id = job_id
        self.tenant_id = tenant_id
        self.workspace_id = workspace_id
        self.domain_id = domain_id
        self.sop_config = sop_config
        self.document_name = document_name
        self.s3_input_key = s3_input_key
        
        # Current execution state
        self.status = "processing"
        self.progress_pct = 0
        self.current_stage = "initialization"
        
        # Temp storage for extracted data
        self.extracted_text: Optional[str] = None
        self.extracted_fields: Dict[str, Any] = {}
        
        # Lock for thread safety if multiple tasks update the same context
        self._lock = asyncio.Lock()

    async def set_field(self, field_id: str, value: Any):
        """Store a globally accessible extracted field value."""
        async with self._lock:
            self.extracted_fields[field_id] = value

    def get_field(self, field_id: str, default: Any = None) -> Any:
        """Retrieve a globally accessible extracted field value."""
        return self.extracted_fields.get(field_id, default)

    async def update_status(
        self,
        status: Optional[str] = None,
        progress_pct: Optional[int] = None,
        current_stage: Optional[str] = None,
        error_message: Optional[str] = None,
        output_urls: Optional[Dict[str, Any]] = None,
        retry_count: Optional[int] = None,
        stage_event: Optional[Dict[str, Any]] = None,
    ):
        """Update internal state and notify the Node backend."""
        async with self._lock:
            if status: self.status = status
            if progress_pct is not None: self.progress_pct = progress_pct
            if current_stage: self.current_stage = current_stage
            
            await node_client.update_job_status(
                job_id=self.job_id,
                tenant_id=self.tenant_id,
                status=self.status,
                progress_pct=self.progress_pct,
                current_stage=self.current_stage,
                error_message=error_message,
                output_urls=output_urls,
                retry_count=retry_count,
                stage_event=stage_event,
            )
            if stage_event and stage_event.get("duration_ms") is not None:
                metrics.emit("stage_duration_ms", float(stage_event.get("duration_ms", 0)), {
                    "job_id": self.job_id,
                    "stage_name": stage_event.get("stage_name", "unknown"),
                    "status": stage_event.get("status", "success"),
                })

    async def submit_section_result(
        self,
        section_id: str,
        status: str = "completed",
        markdown: Optional[str] = None,
        raw_json: Optional[Dict] = None,
        tables: Optional[List[Dict]] = None,
        screenshots: Optional[List[Dict]] = None,
        gpt_model: Optional[str] = None,
        gpt_input_tokens: int = 0,
        gpt_output_tokens: int = 0,
        duration_ms: int = 0,
        sop_compliance_score: Optional[float] = None,
        sop_compliance_notes: Optional[str] = None,
        error_message: Optional[str] = None,
    ):
        """Submit a completed section result to the Node backend."""
        await node_client.submit_section_result(
            job_id=self.job_id,
            tenant_id=self.tenant_id,
            workspace_id=self.workspace_id,
            domain_id=self.domain_id,
            section_id=section_id,
            status=status,
            markdown=markdown,
            raw_json=raw_json,
            tables=tables,
            screenshots=screenshots,
            gpt_model=gpt_model,
            gpt_input_tokens=gpt_input_tokens,
            gpt_output_tokens=gpt_output_tokens,
            duration_ms=duration_ms,
            sop_compliance_score=sop_compliance_score,
            sop_compliance_notes=sop_compliance_notes,
            error_message=error_message,
        )

    async def submit_adverse_finding(self, **kwargs):
        """Submit a discovered adverse finding for this job."""
        await node_client.submit_adverse_finding(
            job_id=self.job_id,
            tenant_id=self.tenant_id,
            workspace_id=self.workspace_id,
            domain_id=self.domain_id,
            **kwargs
        )

    def get_section(self, section_id: str) -> Optional[Dict[str, Any]]:
        """Find a section definition in the SOP config."""
        if not self.sop_config or 'sections' not in self.sop_config:
            return None
            
        for section in self.sop_config['sections']:
            if section.get('section_id') == section_id:
                return section
        return None
