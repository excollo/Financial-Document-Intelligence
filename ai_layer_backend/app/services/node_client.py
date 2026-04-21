"""
Node Backend Client — for sending job status updates, section results,
and adverse findings to the Node.js backend via internal authenticated endpoints.

All requests include the X-Internal-Secret header.
This replaces the old `backend_notifier` service with properly authenticated calls.
"""
import httpx
from typing import Dict, Any, Optional, List
import json
import time
import hmac
import hashlib
import secrets
from urllib.parse import urlparse
from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)


class NodeBackendClient:
    """
    Sends internal API calls to the Node.js backend.
    All requests carry the X-Internal-Secret header for authentication.
    """

    def __init__(self):
        self.base_url = settings.NODE_BACKEND_URL.rstrip("/")
        self.secret = settings.INTERNAL_SECRET
        self.signing_secret = settings.INTERNAL_CALLBACK_SIGNING_SECRET or settings.INTERNAL_SECRET
        self._headers = {
            "Content-Type": "application/json",
            "X-Internal-Secret": self.secret,
        }
        # Timeout: 10s connect, 30s read
        self._timeout = httpx.Timeout(connect=10.0, read=30.0, write=10.0, pool=10.0)

    def _check_secret(self):
        if not self.secret or not self.signing_secret:
            logger.error("INTERNAL_SECRET is not configured — cannot call Node backend")
            raise RuntimeError("INTERNAL_SECRET is not configured")

    def _signed_request(self, method: str, url: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        timestamp = str(int(time.time()))
        nonce = secrets.token_hex(16)
        body = json.dumps(payload, separators=(",", ":"), ensure_ascii=False)
        path = urlparse(url).path
        signing_payload = f"{method.upper()}\n{path}\n{body}\n{timestamp}\n{nonce}"
        signature = hmac.new(
            self.signing_secret.encode("utf-8"),
            signing_payload.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()
        headers = {
            **self._headers,
            "X-Timestamp": timestamp,
            "X-Nonce": nonce,
            "X-Signature": signature,
        }
        return {"headers": headers, "body": body}

    async def update_job_status(
        self,
        job_id: str,
        tenant_id: str,
        status: str,
        progress_pct: int = 0,
        current_stage: Optional[str] = None,
        error_message: Optional[str] = None,
        output_urls: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Update the job status on the Node backend."""
        self._check_secret()

        payload = {
            "job_id": job_id,
            "tenant_id": tenant_id,
            "status": status,
            "progress_pct": progress_pct,
        }
        if current_stage:
            payload["current_stage"] = current_stage
        if error_message:
            payload["error_message"] = error_message
        if output_urls:
            payload["output_urls"] = output_urls

        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                signed = self._signed_request("POST", f"{self.base_url}/api/jobs/internal/status", payload)
                resp = await client.post(
                    f"{self.base_url}/api/jobs/internal/status",
                    content=signed["body"],
                    headers=signed["headers"],
                )
                resp.raise_for_status()
                data = resp.json()
                logger.info(
                    "Job status updated",
                    job_id=job_id,
                    status=status,
                    progress_pct=progress_pct,
                )
                return data
        except Exception as e:
            logger.error(
                "Failed to update job status",
                job_id=job_id,
                error=str(e),
            )
            raise

    async def submit_section_result(
        self,
        job_id: str,
        tenant_id: str,
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
    ) -> Dict[str, Any]:
        """Submit a section result to the Node backend."""
        self._check_secret()

        payload = {
            "job_id": job_id,
            "tenant_id": tenant_id,
            "section_id": section_id,
            "status": status,
            "markdown": markdown,
            "raw_json": raw_json,
            "tables": tables or [],
            "screenshots": screenshots or [],
            "gpt_model": gpt_model,
            "gpt_input_tokens": gpt_input_tokens,
            "gpt_output_tokens": gpt_output_tokens,
            "duration_ms": duration_ms,
            "sop_compliance_score": sop_compliance_score,
            "sop_compliance_notes": sop_compliance_notes,
            "error_message": error_message,
        }

        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                signed = self._signed_request(
                    "POST",
                    f"{self.base_url}/api/jobs/internal/section-result",
                    payload,
                )
                resp = await client.post(
                    f"{self.base_url}/api/jobs/internal/section-result",
                    content=signed["body"],
                    headers=signed["headers"],
                )
                resp.raise_for_status()
                data = resp.json()
                logger.info(
                    "Section result submitted",
                    job_id=job_id,
                    section_id=section_id,
                    status=status,
                )
                return data
        except Exception as e:
            logger.error(
                "Failed to submit section result",
                job_id=job_id,
                section_id=section_id,
                error=str(e),
            )
            raise

    async def submit_adverse_finding(
        self,
        job_id: str,
        tenant_id: str,
        entity_name: str,
        finding_type: str,
        severity: str,
        title: str,
        description: str,
        entity_type: str = "company",
        source_url: Optional[str] = None,
        source_name: Optional[str] = None,
        published_date: Optional[str] = None,
        confidence_score: Optional[float] = None,
        risk_assessment: Optional[Dict] = None,
    ) -> Dict[str, Any]:
        """Submit an adverse finding to the Node backend."""
        self._check_secret()

        payload = {
            "job_id": job_id,
            "tenant_id": tenant_id,
            "entity_name": entity_name,
            "entity_type": entity_type,
            "finding_type": finding_type,
            "severity": severity,
            "title": title,
            "description": description,
            "source_url": source_url,
            "source_name": source_name,
            "published_date": published_date,
            "confidence_score": confidence_score,
            "risk_assessment": risk_assessment,
        }

        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                signed = self._signed_request(
                    "POST",
                    f"{self.base_url}/api/jobs/internal/adverse-finding",
                    payload,
                )
                resp = await client.post(
                    f"{self.base_url}/api/jobs/internal/adverse-finding",
                    content=signed["body"],
                    headers=signed["headers"],
                )
                resp.raise_for_status()
                data = resp.json()
                logger.info(
                    "Adverse finding submitted",
                    job_id=job_id,
                    entity_name=entity_name,
                    severity=severity,
                )
                return data
        except Exception as e:
            logger.error(
                "Failed to submit adverse finding",
                job_id=job_id,
                entity_name=entity_name,
                error=str(e),
            )
            raise


# Singleton instance
node_client = NodeBackendClient()
