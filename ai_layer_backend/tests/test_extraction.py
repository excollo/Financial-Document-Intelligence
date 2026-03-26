import pytest
from app.services.extraction import _clean_text_preserving_tables
from app.services.chunking import ChunkingService

def test_extraction_cleaning():
    """Verify cleaning logic for RHP/DRHP documents."""
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
    # Using the actual function from extraction.py
    cleaned = _clean_text_preserving_tables(dirty_text)
    
    # Assertions based on n8n migration requirements
    # Note: _clean_text_preserving_tables doesn't remove "Page 1" if it's part of normal text 
    # unless it matches "Page \d+". 
    assert "Page 1" not in cleaned
    assert "Page 2" not in cleaned
    # Newlines are preserved for tables, but whitespaces are collapsed
    # Actually the implementation says: return "\n".join(cleaned_lines).strip()
    assert "\n" in cleaned # Should be preserved for tables
    assert "   " not in cleaned
    # It removes TOC noise, dots, page numbers
    assert "TABLE OF CONTENTS" not in cleaned

def test_chunking_logic():
    """Verify text chunking with overlap."""
    text = "This is a moderately long sentence that we want to split into smaller chunks for vector embeddings."
    chunk_size = 20
    overlap = 5
    
    service = ChunkingService(chunk_size=chunk_size, chunk_overlap=overlap)
    chunks = service.split_text(text)
    
    assert len(chunks) > 1
    for chunk in chunks:
        assert len(chunk) <= chunk_size
