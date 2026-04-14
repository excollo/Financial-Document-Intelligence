"""
MongoDB connection and utilities.
Provides connection management and common database operations.
"""
from typing import Optional
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from pymongo import MongoClient
from pymongo.database import Database

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)


class MongoDB:
    """MongoDB connection manager."""
    
    def __init__(self):
        self.client: Optional[AsyncIOMotorClient] = None
        self.db: Optional[AsyncIOMotorDatabase] = None
        self.sync_client: Optional[MongoClient] = None
        self.sync_db: Optional[Database] = None
    
    async def connect(self) -> None:
        """Establish async MongoDB connection."""
        try:
            import asyncio
            # Detect loop changes (common in Celery workers using asyncio.run)
            loop = asyncio.get_running_loop()
            
            # Reconnect if loop changed or client is missing
            try:
                if self.client is not None and self.client.get_io_loop() != loop:
                    logger.info("MongoDB: Event loop changed, resetting connection")
                    self.client.close()
                    self.client = None
                    self.db = None
            except Exception:
                self.client = None

            if self.client is None:
                self.client = AsyncIOMotorClient(settings.MONGODB_URI, serverSelectionTimeoutMS=5000)
                # Use default database from URI, or fallback to settings.MONGO_DB_NAME
                try:
                    self.db = self.client.get_default_database()
                except Exception:
                    self.db = self.client[settings.MONGO_DB_NAME]
                
            # Always ensure db is reachable
            await self.client.admin.command('ping')
            db_name = self.db.name if self.db is not None else "unknown"
            logger.info(
                "MongoDB connected",
                database=db_name,
                environment=settings.APP_ENV
            )
        except Exception as e:
            logger.warning(f"MongoDB connection failed: {str(e)}")
            # Don't raise, allowing server to start for local dev
    
    async def disconnect(self) -> None:
        """Close async MongoDB connection."""
        if self.client is not None:
            self.client.close()
            logger.info("MongoDB disconnected")
    
    def connect_sync(self) -> None:
        """Establish synchronous MongoDB connection (for Celery workers)."""
        try:
            self.sync_client = MongoClient(settings.MONGODB_URI, serverSelectionTimeoutMS=5000)
            # Use default database from URI, or fallback to settings.MONGO_DB_NAME
            try:
                self.sync_db = self.sync_client.get_default_database()
            except Exception:
                self.sync_db = self.sync_client[settings.MONGO_DB_NAME]
            # Test connection
            self.sync_client.admin.command('ping')
            db_name = self.sync_db.name if self.sync_db is not None else "unknown"
            logger.info(
                "MongoDB sync connection established",
                database=db_name,
                environment=settings.APP_ENV
            )
        except Exception as e:
            logger.warning("MongoDB sync connection failed, but continuing", error=str(e))
            # Don't raise, allowing workers to start
    
    def disconnect_sync(self) -> None:
        """Close synchronous MongoDB connection."""
        if self.sync_client is not None:
            self.sync_client.close()
            logger.info("MongoDB sync connection closed")
    
    def get_collection(self, collection_name: str):
        """
        Get a collection from the async database.
        
        Args:
            collection_name: Name of the collection
        
        Returns:
            AsyncIOMotorCollection instance
        """
        if self.db is None:
            raise RuntimeError("MongoDB not connected. Call connect() first.")
        return self.db[collection_name]
    
    def get_sync_collection(self, collection_name: str):
        """
        Get a collection from the sync database (for Celery workers).
        
        Args:
            collection_name: Name of the collection
        
        Returns:
            Collection instance
        """
        if self.sync_db is None:
            raise RuntimeError("MongoDB sync not connected. Call connect_sync() first.")
        return self.sync_db[collection_name]


# Global MongoDB instance
mongodb = MongoDB()


async def get_database() -> AsyncIOMotorDatabase:
    """
    Dependency for FastAPI routes to get database instance.
    
    Returns:
        AsyncIOMotorDatabase instance
    """
    if mongodb.db is None:
        await mongodb.connect()
    return mongodb.db
