"""
Segmenter Utility — groups raw PDF text segments into SopConfig sections.
Uses fuzzy matching on section names and keywords to map PDF TOC to SOP.
"""
from typing import Dict, Any, List, Optional
from app.services.extraction import extraction_service
from app.core.logging import get_logger

logger = get_logger(__name__)


class SectionSegmenter:
    """
    Utility to map the PDF's internal Table of Contents (TOC) 
    to the SopConfig's logical sections.
    """

    @staticmethod
    def map_pdf_to_sop(
        pdf_sections: List[Dict[str, Any]], 
        sop_config: Dict[str, Any]
    ) -> Dict[str, str]:
        """
        Map SopConfig section_id to the actual PDF text content.
        
        Args:
           pdf_sections: Result from ExtractionService.extract_sections_from_pdf
           sop_config: The current tenant's SopConfig
           
        Returns:
           Dict[section_id, combined_text]
        """
        mapping: Dict[str, str] = {}
        sop_sections = sop_config.get('sections', [])
        
        for sop_sec in sop_sections:
            section_id = sop_sec.get('section_id')
            label = sop_sec.get('label', '').upper()
            keywords = [k.upper() for k in sop_sec.get('section_keywords', [])]
            
            # Simple fuzzy matching logic
            combined_text = ""
            for pdf_sec in pdf_sections:
                pdf_name = pdf_sec.get('sectionName', '').upper()
                
                # Match if label is in name or any keyword is in name
                if label in pdf_name or any(k in pdf_name for k in keywords):
                    combined_text += pdf_sec.get('text', '') + "\n\n"
            
            if combined_text:
                mapping[section_id] = combined_text
                logger.info(
                    f"Mapped SopSection {section_id} to PDF segments", 
                    text_len=len(combined_text)
                )
            else:
                mapping[section_id] = ""
                logger.warning(f"Could not find PDF segment for SopSection {section_id}")
                
        return mapping
