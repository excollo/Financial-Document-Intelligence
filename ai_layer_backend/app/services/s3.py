"""
S3/R2 Service for Python backend using aioboto3 for async operations.
"""
import aioboto3
from typing import Optional
from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)


class S3Service:
    """Async S3-compatible service for downloading/uploading files to R2."""

    def __init__(self):
        self.session = aioboto3.Session()
        self.endpoint_url = settings.CLOUDFLARE_URI
        self.bucket = settings.R2_BUCKET_NAME
        self.access_key = settings.R2_ACCESS_KEY_ID
        self.secret_key = settings.R2_SECRET_ACCESS_KEY
        self.region = settings.S3_REGION
        
        # Debugging: Ensure credentials are loaded
        if not self.access_key or len(self.access_key) < 10:
            logger.error(f"Cloudflare S3 Access Key is MISSING or too short in S3Service! keylen={len(self.access_key) if self.access_key else 0}")
        else:
            logger.info(f"S3Service initialized with credentials key_prefix={self.access_key[:4]}... endpoint={self.endpoint_url}")

    async def download_file(self, key: str) -> Optional[bytes]:
        """Download file content from S3."""
        try:
            async with self.session.client(
                "s3",
                endpoint_url=self.endpoint_url,
                aws_access_key_id=self.access_key,
                aws_secret_access_key=self.secret_key,
                region_name=self.region,
            ) as s3:
                response = await s3.get_object(Bucket=self.bucket, Key=key)
                async with response["Body"] as stream:
                    return await stream.read()
        except Exception as e:
            logger.error(f"S3 download failed key={key}", error=str(e))
            return None

    async def upload_file(self, content: bytes, key: str, content_type: str = "application/octet-stream") -> bool:
        """Upload file content to S3."""
        try:
            async with self.session.client(
                "s3",
                endpoint_url=self.endpoint_url,
                aws_access_key_id=self.access_key,
                aws_secret_access_key=self.secret_key,
                region_name=self.region,
            ) as s3:
                await s3.put_object(
                    Bucket=self.bucket, 
                    Key=key, 
                    Body=content, 
                    ContentType=content_type
                )
                return True
        except Exception as e:
            logger.error(f"S3 upload failed key={key}", error=str(e))
            return False

    async def get_presigned_url(self, key: str, expires_in: int = 3600) -> Optional[str]:
        """Generate a presigned URL for downloading."""
        try:
            async with self.session.client(
                "s3",
                endpoint_url=self.endpoint_url,
                aws_access_key_id=self.access_key,
                aws_secret_access_key=self.secret_key,
                region_name=self.region,
            ) as s3:
                return await s3.generate_presigned_url(
                    "get_object",
                    Params={"Bucket": self.bucket, "Key": key},
                    ExpiresIn=expires_in,
                )
        except Exception as e:
            logger.error(f"S3 presigned URL generation failed key={key}", error=str(e))
            return None

    async def delete_prefix(self, prefix: str) -> bool:
        """Delete all objects with a given prefix (folder cleanup)."""
        try:
            async with self.session.client(
                "s3",
                endpoint_url=self.endpoint_url,
                aws_access_key_id=self.access_key,
                aws_secret_access_key=self.secret_key,
                region_name=self.region,
            ) as s3:
                # 1. List all objects with prefix
                response = await s3.list_objects_v2(Bucket=self.bucket, Prefix=prefix)
                objects = response.get("Contents", [])
                
                if not objects:
                    logger.info(f"No objects found with prefix {prefix} to delete")
                    return True
                
                # 2. Delete them
                delete_keys = [{"Key": obj["Key"]} for obj in objects]
                await s3.delete_objects(
                    Bucket=self.bucket,
                    Delete={"Objects": delete_keys}
                )
                logger.info(f"Deleted {len(delete_keys)} objects with prefix {prefix}")
                return True
        except Exception as e:
            logger.error(f"S3 prefix deletion failed prefix={prefix}", error=str(e))
            return False

    def get_public_url(self, key: str) -> str:
        """Construct the public URL for a file (assuming bucket is public or proxied)."""
        base = self.endpoint_url.rstrip("/")
        return f"{base}/{self.bucket}/{key}"


# Global instance
s3_service = S3Service()
