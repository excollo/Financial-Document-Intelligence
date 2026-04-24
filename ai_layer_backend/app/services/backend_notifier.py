"""
Backend notification service.
Sends job status updates back to the Node.js backend.
"""
from typing import Dict, Any, Optional
import requests
import time
import json
import hmac
import hashlib
import secrets
from urllib.parse import urlparse
from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)


class BackendNotifier:
    """Service to notify the Node.js backend of job status."""

    @staticmethod
    def _build_signed_request(method: str, url: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        timestamp = str(int(time.time()))
        nonce = secrets.token_hex(16)
        body = json.dumps(payload, separators=(",", ":"), ensure_ascii=False)
        path = urlparse(url).path
        signing_payload = f"{method.upper()}\n{path}\n{body}\n{timestamp}\n{nonce}"
        signature = hmac.new(
            (settings.INTERNAL_CALLBACK_SIGNING_SECRET or settings.INTERNAL_SECRET).encode("utf-8"),
            signing_payload.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()
        return {
            "body": body,
            "headers": {
                "Content-Type": "application/json",
                "X-Internal-Secret": settings.INTERNAL_SECRET,
                "X-Timestamp": timestamp,
                "X-Nonce": nonce,
                "X-Signature": signature,
            },
        }
    
    @staticmethod
    def notify_status(
        job_id: str,
        status: str,
        namespace: str,
        error: Optional[Dict[str, Any]] = None,
        execution_id: Optional[str] = None,
        result: Optional[Dict[str, Any]] = None,
        output_urls: Optional[Dict[str, Any]] = None,
        document_id: Optional[str] = None,
        workspace_id: Optional[str] = None,
        domain_id: Optional[str] = None,
    ) -> bool:
        """
        Send status update to backend with exponential backoff.
        Matched to n8n node "Send Error to Backend3" and webhook response logic.
        """
        payload = {
            "jobId": job_id,
            "status": status,
            "namespace": namespace,
            "documentId": document_id or job_id,
            "execution": {
                "workflowId": "python-platform",
                "executionId": execution_id or job_id
            },
            "workspaceId": workspace_id,
            "domainId": domain_id,
        }
        
        if result:
            payload["result"] = result

        if output_urls and isinstance(output_urls, dict) and output_urls:
            payload["output_urls"] = output_urls
            
        if error:
            payload["error"] = {
                "message": error.get("message", "Unknown error"),
                "stack": error.get("stack", "No stack trace"),
                "timestamp": str(time.time())
            }
            
        max_retries = 3
        backoff = 1
        for attempt in range(max_retries):
            try:
                logger.info("Notifying backend of status", job_id=job_id, status=status, attempt=attempt + 1)
                signed = BackendNotifier._build_signed_request("POST", settings.BACKEND_STATUS_URL, payload)
                response = requests.post(
                    settings.BACKEND_STATUS_URL,
                    data=signed["body"],
                    headers=signed["headers"],
                    timeout=10
                )
                response.raise_for_status()
                logger.info("Backend notified successfully", status_code=response.status_code)
                return True
            except Exception as e:
                status_code = getattr(getattr(e, "response", None), "status_code", None)
                response_text = getattr(getattr(e, "response", None), "text", None)
                logger.warning(
                    "Failed to notify backend",
                    error=str(e),
                    status_code=status_code,
                    response_text=(response_text[:300] if isinstance(response_text, str) else None),
                    job_id=job_id,
                    document_id=document_id,
                    attempt=attempt + 1
                )
                if attempt < max_retries - 1:
                    time.sleep(backoff)
                    backoff *= 2
                else:
                    logger.error("Max retries reached. Failed to notify backend", job_id=job_id)
                    return False
        return False

    @staticmethod
    def create_report(
        drhp_namespace: str,
        drhp_id: str,
        title: str,
        content: str,
        session_id: str,
        rhp_namespace: str = "",
        rhp_id: str = "",
        domain: str = "",
        domain_id: str = "",
        workspace_id: str = "",
        authorization: str = ""
    ) -> bool:
        """
        Creates a report record in the backend.
        Replicates n8n 'sent response to the backend api for create report' node.
        """
        payload = {
            "drhpNamespace": drhp_namespace,
            "drhpId": drhp_id,
            "title": title,
            "content": content,
            "id": session_id,
            "rhpNamespace": rhp_namespace,
            "rhpId": rhp_id,
            "domain": domain,
            "domainId": domain_id,
            "workspaceId": workspace_id
        }
        
        headers = {"Content-Type": "application/json"}
        if authorization:
            headers["Authorization"] = authorization
        if workspace_id:
            headers["x-workspace"] = workspace_id
            
        try:
            logger.info("Creating report in backend", title=title, session_id=session_id)
            response = requests.post(
                settings.REPORT_CREATE_URL,
                json=payload,
                headers=headers,
                timeout=20
            )
            response.raise_for_status()
            logger.info("Report created successfully", status_code=response.status_code)
            return True
        except Exception as e:
            logger.error("Failed to create report", error=str(e), session_id=session_id)
            return False

    @staticmethod
    def update_report_status(
        job_id: str,
        namespace: str,
        status: str,
        error: Optional[Dict[str, Any]] = None,
        output_urls: Optional[Dict[str, Any]] = None,
        authorization: str = "",
        workspace_id: str = "",
        domain_id: str = "",
    ) -> bool:
        """
        Updates the final status of a report generation job.
        Replicates n8n 'send final response for success report' node.
        """
        payload = {
            "jobId": job_id,
            "namespace": namespace,
            "status": status,
            "execution": {
                "workflowId": "python-comparison-pipeline",
                "executionId": job_id
            },
            "error": error or {
                "message": None,
                "stack": None,
                "timestamp": str(time.time())
            },
            "workspaceId": workspace_id,
            "domainId": domain_id,
        }
        if output_urls and isinstance(output_urls, dict) and output_urls:
            payload["output_urls"] = output_urls
        
        signed = BackendNotifier._build_signed_request("POST", settings.REPORT_STATUS_UPDATE_URL, payload)
        headers = signed["headers"]
        if authorization:
            headers["Authorization"] = authorization
            
        try:
            logger.info("Updating report status", job_id=job_id, status=status)
            response = requests.post(
                settings.REPORT_STATUS_UPDATE_URL,
                data=signed["body"],
                headers=headers,
                timeout=10
            )
            response.raise_for_status()
            logger.info("Report status updated successfully", status_code=response.status_code)
            return True
        except Exception as e:
            logger.error("Failed to update report status", error=str(e), job_id=job_id)
            return False
    @staticmethod
    def update_chat_status(
        job_id: str,
        namespace: str,
        status: str,
        error: Optional[Dict[str, Any]] = None,
        authorization: str = "",
    ) -> bool:
        """
        Updates the final status of a chat request.
        Replicates n8n 'Send Error to Backend8' node.
        """
        payload = {
            "jobId": job_id,
            "namespace": namespace,
            "status": status,
            "execution": {
                "workflowId": "python-chat-service",
                "executionId": job_id
            },
            "error": error or {
                "message": None,
                "stack": None,
                "timestamp": str(time.time())
            }
        }
        
        signed = BackendNotifier._build_signed_request("POST", settings.CHAT_STATUS_UPDATE_URL, payload)
        headers = signed["headers"]
        if authorization:
            headers["Authorization"] = authorization
            
        try:
            logger.info("Updating chat status", job_id=job_id, status=status)
            response = requests.post(
                settings.CHAT_STATUS_UPDATE_URL,
                data=signed["body"],
                headers=headers,
                timeout=10
            )
            response.raise_for_status()
            logger.info("Chat status updated successfully", status_code=response.status_code)
            return True
        except Exception as e:
            logger.error("Failed to update chat status", error=str(e), job_id=job_id)
            return False

    @staticmethod
    def update_summary_status(
        job_id: str,
        namespace: str,
        status: str,
        error: Optional[Dict[str, Any]] = None,
        output_urls: Optional[Dict[str, Any]] = None,
        authorization: str = "",
        workspace_id: str = "",
        domain_id: str = "",
    ) -> bool:
        """
        Updates the final status of a summary request.
        """
        payload = {
            "jobId": job_id,
            "namespace": namespace,
            "status": status,
            "error": error or {
                "message": None,
                "stack": None,
                "timestamp": str(time.time())
            },
            "workspaceId": workspace_id,
            "domainId": domain_id,
        }
        if output_urls and isinstance(output_urls, dict) and output_urls:
            payload["output_urls"] = output_urls
        
        signed = BackendNotifier._build_signed_request("POST", settings.SUMMARY_STATUS_UPDATE_URL, payload)
        headers = signed["headers"]
        if authorization:
            headers["Authorization"] = authorization
            
        try:
            logger.info("Updating summary status", job_id=job_id, status=status)
            response = requests.post(
                settings.SUMMARY_STATUS_UPDATE_URL,
                data=signed["body"],
                headers=headers,
                timeout=10
            )
            response.raise_for_status()
            logger.info("Summary status updated successfully", status_code=response.status_code)
            return True
        except Exception as e:
            logger.error("Failed to update summary status", error=str(e), job_id=job_id)
            return False

    @staticmethod
    def create_summary(
        title: str,
        content: str,
        document_id: str,
        domain: str = "",
        domain_id: str = "",
        workspace_id: str = "",
        authorization: str = ""
    ) -> bool:
        """
        Creates a summary record in the backend.
        """
        payload = {
            "title": title,
            "content": content,
            "documentId": document_id,
            "domain": domain,
            "domainId": domain_id,
            "workspaceId": workspace_id
        }
        
        headers = {"Content-Type": "application/json"}
        if authorization:
            headers["Authorization"] = authorization
        if workspace_id:
            headers["x-workspace"] = workspace_id
            
        try:
            logger.info("Creating summary in backend", title=title, document_id=document_id)
            response = requests.post(
                settings.SUMMARY_CREATE_URL,
                json=payload,
                headers=headers,
                timeout=20
            )
            response.raise_for_status()
            logger.info("Summary created successfully", status_code=response.status_code)
            return True
        except Exception as e:
            logger.error("Failed to create summary", error=str(e), document_id=document_id)
            return False
    @staticmethod
    def delete_document(document_id: str, workspace_id: str, domain_id: str) -> bool:
        """
        Request the backend to perform a hard delete of a document.
        Used for cleanup when ingestion fails fatally.
        """
        if not document_id or not workspace_id or not domain_id:
            return False
            
        url = f"{settings.NODE_BACKEND_URL}/api/documents/internal/{document_id}"
        payload = {
            "documentId": document_id,
            "workspaceId": workspace_id,
            "domainId": domain_id,
        }
        signed = BackendNotifier._build_signed_request("DELETE", url, payload)
        headers = signed["headers"]
        
        try:
            logger.info("Requesting internal document deletion for cleanup", document_id=document_id)
            response = requests.delete(url, data=signed["body"], headers=headers, timeout=10)
            response.raise_for_status()
            logger.info("Internal document deletion successful", document_id=document_id)
            return True
        except Exception as e:
            logger.error("Failed to request internal document deletion", error=str(e), document_id=document_id)
            return False


# Global service instance
backend_notifier = BackendNotifier()
