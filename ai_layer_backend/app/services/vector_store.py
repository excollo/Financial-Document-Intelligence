"""
Pinecone vector store service.
Handles upserting document chunks to the correct index.
"""
from typing import List, Dict, Any
from pinecone import Pinecone
from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)


class VectorStoreService:
    """Service for interacting with Pinecone vector store."""
    
    def __init__(self):
        """Initialize Pinecone client."""
        self.pc = Pinecone(api_key=settings.PINECONE_API_KEY)

    @staticmethod
    def _extract_index_name(name_or_url: str) -> str:
        """Extract index name from URL if necessary."""
        if name_or_url.startswith("https://"):
            # URL format: https://index_name-project_id.svc.region.pinecone.io
            return name_or_url.split("https://")[1].split("-")[0]
        return name_or_url

    def get_index(self, index_name: str, host: str = ""):
        """Get a Pinecone index instance."""
        clean_name = self._extract_index_name(index_name)
        try:
            if host:
                return self.pc.Index(clean_name, host=host)
            # If index_name looks like a URL, use it as host
            if index_name.startswith("https://"):
                return self.pc.Index(clean_name, host=index_name)
            return self.pc.Index(clean_name)
        except Exception as e:
            logger.error("Failed to get Pinecone index", index_name=clean_name, host=host or index_name, error=str(e))
            raise

    def upsert_chunks(
        self,
        chunks: List[Dict[str, Any]],
        index_name: str,
        namespace: str = "",
        host: str = ""
    ) -> Dict[str, Any]:
        """
        Upsert embeddings to Pinecone.
        
        Args:
            chunks: List of chunk dicts (must contain 'embedding', 'chunk_text', 'chunk_index')
            index_name: Pinecone index name (drhpdocuments or rhpdocuments)
            namespace: Optional namespace (e.g. filename)
            host: Optional index host URL
        """
        index = self.get_index(index_name, host=host)
        
        vectors = []
        for chunk in chunks:
            # Metadata as stored in n8n workflow
            chunk_metadata = chunk.get("metadata", {})
            metadata = {
                "text": chunk["chunk_text"],
                "chunk_index": chunk["chunk_index"],
                "documentName": namespace,
                "documentId": chunk_metadata.get("documentId", ""),
                "domain": chunk_metadata.get("domain", ""),
                "domainId": chunk_metadata.get("domainId", ""),
                "type": chunk_metadata.get("type", "DRHP")
            }
            # Merge extra metadata if any
            if "metadata" in chunk:
                metadata.update(chunk["metadata"])
            
            # Create a unique ID for the vector
            vector_id = f"{namespace}_{chunk['chunk_index']}"
            
            vectors.append({
                "id": vector_id,
                "values": chunk["embedding"],
                "metadata": metadata
            })
            
        logger.info(
            "Upserting vectors to Pinecone",
            index=index_name,
            namespace=namespace,
            vector_count=len(vectors)
        )
        
        # Pinecone upsert in batches (Limit to 50 vectors per request to avoid size limits)
        batch_size = 50
        # ALWAYS use default namespace for single-index strategy, rely on metadata for separation
        safe_namespace = "" 
        
        total_upserted = 0
        for i in range(0, len(vectors), batch_size):
            batch = vectors[i:i + batch_size]
            try:
                upsert_response = index.upsert(
                    vectors=batch,
                    namespace=safe_namespace
                )
                upserted = getattr(upsert_response, "upserted_count", len(batch))
                total_upserted += upserted
                logger.debug(f"Upserted batch {i//batch_size + 1}", count=upserted)
            except Exception as e:
                logger.error(f"Failed to upsert batch {i}", error=str(e))
                raise
        
        count = total_upserted
        
        logger.info(
            "Pinecone upsert completed",
            index=index_name,
            namespace=namespace,
            upserted_count=count
        )
        
        return {
            "upserted_count": count,
            "namespace": namespace,
            "index": index_name
        }

    def delete_vectors(self, index_name: str, namespace: str, host: str = ""):
        """
        Delete all vectors in a namespace.
        """
        index = self.get_index(index_name, host=host)
        
        logger.info(
            "Deleting vectors from Pinecone",
            index=index_name,
            namespace=namespace
        )
        
        try:
            # Delete vectors using metadata filter on default namespace
            # Pinecone requires namespace="" for default
            response = index.delete(
                namespace="",
                filter={"documentName": namespace}
            )
            
            logger.info("Deletion request sent (filtered by documentName)", index=index_name, namespace=namespace)
            return response
            
        except Exception as e:
            logger.error("Failed to delete vectors", index=index_name, namespace=namespace, error=str(e))
            raise


# Global service instance
vector_store_service = VectorStoreService()
