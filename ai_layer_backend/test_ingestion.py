"""
Test script for Data Ingestion Layer logic.
Verifies cleaning and chunking without needing external APIs.
"""
from app.services.extraction import ExtractionService
from app.services.chunking import ChunkingService
import json

def test_ingestion_logic():
    print("🚀 Starting Ingestion Logic Test...\n")
    
    # 1. Test Cleaning Logic
    dirty_text = """
    Page 1
    HELLO WORLD
    This is some text with
    newlines and    too many spaces.
    Page 2
    ---
    Repeated dashes should be removed.
    ___ 
    Score: 100
    """
    
    print("--- Testing Cleaning Logic ---")
    cleaned = ExtractionService.clean_text(dirty_text)
    print(f"Original length: {len(dirty_text)}")
    print(f"Cleaned length: {len(cleaned)}")
    print(f"Cleaned content sample: {cleaned[:100]}...")
    
    # Assertions based on n8n requirements
    assert "Page 1" not in cleaned
    assert "Page 2" not in cleaned
    assert "\n" not in cleaned
    assert "   " not in cleaned
    assert "---" not in cleaned
    print("✅ Cleaning logic verified!\n")

    # 2. Test Chunking Logic
    print("--- Testing Chunking Logic ---")
    # Small parameters for testing
    chunk_size = 50
    overlap = 10
    service = ChunkingService(chunk_size=chunk_size, chunk_overlap=overlap)
    
    chunks = service.split_text(cleaned)
    print(f"Total chunks created: {len(chunks)}")
    for i, chunk in enumerate(chunks[:3]):
        print(f"Chunk {i} (size {len(chunk)}): {chunk}")
        assert len(chunk) <= chunk_size
    
    print("✅ Chunking logic verified!\n")
    
    print("🎉 All ingestion logic tests passed!")

if __name__ == "__main__":
    test_ingestion_logic()
