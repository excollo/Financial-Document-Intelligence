"""
Azure Blob Storage Service for Python backend.
Replaces the old S3/R2 implementation.
"""
import os
from azure.storage.blob import BlobServiceClient, generate_blob_sas, BlobSasPermissions
from datetime import datetime, timedelta
from typing import Optional
from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)

class AzureStorageService:
    """Service for downloading/uploading files to Azure Blob Storage."""

    def __init__(self):
        self.connection_string = os.getenv("AZURE_BLOB_STORAGE_CONNECTION_STRING")
        self.account_name = os.getenv("AZURE_BLOB_ACCOUNT_NAME")
        self.account_key = os.getenv("AZURE_BLOB_ACCOUNT_KEY")
        self.container_name = os.getenv("AZURE_BLOB_CONTAINER_NAME", "drhp-files")
        
        if not self.connection_string:
            logger.error("AZURE_BLOB_STORAGE_CONNECTION_STRING is missing in AzureStorageService!")
        else:
            try:
                self.blob_service_client = BlobServiceClient.from_connection_string(self.connection_string)
                logger.info(f"AzureStorageService initialized for container: {self.container_name}")
            except Exception as e:
                logger.error(f"Failed to initialize AzureStorageService: {str(e)}")
                self.blob_service_client = None

    async def download_file(self, key: str) -> Optional[bytes]:
        """Download file content from Azure Blob Storage."""
        try:
            if not self.blob_service_client:
                return None
            
            blob_client = self.blob_service_client.get_blob_client(container=self.container_name, blob=key)
            download_stream = blob_client.download_blob()
            return download_stream.readall()
        except Exception as e:
            logger.error(f"Azure download failed key={key}", error=str(e))
            return None

    async def upload_file(self, content: bytes, key: str, content_type: str = "application/octet-stream") -> bool:
        """Upload file content to Azure Blob Storage."""
        try:
            if not self.blob_service_client:
                return False
            
            blob_client = self.blob_service_client.get_blob_client(container=self.container_name, blob=key)
            blob_client.upload_blob(content, overwrite=True, content_settings={"content_type": content_type})
            return True
        except Exception as e:
            logger.error(f"Azure upload failed key={key}", error=str(e))
            return False

    async def get_presigned_url(self, key: str, expires_in: int = 3600) -> Optional[str]:
        """Generate a SAS token URL for downloading."""
        try:
            if not self.account_name or not self.account_key:
                return None
                
            sas_token = generate_blob_sas(
                account_name=self.account_name,
                container_name=self.container_name,
                blob_name=key,
                account_key=self.account_key,
                permission=BlobSasPermissions(read=True),
                expiry=datetime.utcnow() + timedelta(seconds=expires_in)
            )
            
            return f"https://{self.account_name}.blob.core.windows.net/{self.container_name}/{key}?{sas_token}"
        except Exception as e:
            logger.error(f"Azure SAS URL generation failed key={key}", error=str(e))
            return None

    def get_public_url(self, key: str) -> str:
        """Construct the URL (without SAS token)."""
        return f"https://{self.account_name}.blob.core.windows.net/{self.container_name}/{key}"


# Global instance - Aliased to s3_service to maintain backward compatibility with imports
s3_service = AzureStorageService()
