"""
Vision Service for document visual analysis.
Uses Gemini 2.0 Flash to describe images/charts for document ingestion.
"""
import base64
import io
from typing import List, Dict, Any, Optional
import google.generativeai as genai
from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)


class VisionService:
    """Service for analyzing images extracted from PDFs."""
    
    def __init__(self):
        """Initialize Gemini client."""
        if not settings.GEMINI_API_KEY:
            logger.warning("GEMINI_API_KEY not configured — Visual analysis disabled")
            self.model = None
        else:
            genai.configure(api_key=settings.GEMINI_API_KEY)
            self.model = genai.GenerativeModel("gemini-2.0-flash-lite")

    async def describe_visual_element(self, image_bytes: bytes, element_type: str = "chart") -> str:
        """
        Takes raw image bytes (e.g. from a page crop) and returns a narrative description.
        Matches the architecture requirement for 'Visual visuals / charts analysis'.
        """
        if not self.model:
            return f"[Visual element: {element_type} (Analysis skipped — Gemini not configured)]"
            
        try:
            # Prepare image for Gemini
            image_data = [{"mime_type": "image/png", "data": image_bytes}]
            
            prompt = (
                f"Identify and describe this {element_type} from a financial prospectus (DRHP/RHP). "
                "1. If it's a chart, list its title, axes, and main data points/trends. "
                "2. If it's a diagram, explain the flow or hierarchy shown. "
                "3. If it's a signature block or logo, just identify it. "
                "Be strictly factual. Provide a concise narrative that captures all numbers and percentages shown."
            )
            
            response = self.model.generate_content([prompt, image_data[0]])
            description = response.text.strip()
            
            logger.info("Visual element analyzed", type=element_type, desc_len=len(description))
            return f"[VISUAL ELEMENT: {element_type}]\n{description}"
            
        except Exception as e:
            logger.error("Failed to analyze visual element", error=str(e))
            return f"[Visual element: {element_type} (Analysis failed)]"

    async def analyze_full_page(self, page_image_bytes: bytes) -> str:
        """
        Analyze a full 200 DPI page render to catch any visual context text missed by OCR.
        Matches architecture requirement for '200 DPI page render'.
        """
        if not self.model:
            return ""
            
        try:
            image_data = [{"mime_type": "image/png", "data": page_image_bytes}]
            prompt = (
                "Review this page from a financial prospectus. "
                "Identify any charts, graphs, or visual data that are important for a financial investigator. "
                "If no visuals exist, respond with 'NO_VISUALS'. "
                "If visuals exist, provide a detailed bulleted summary of the findings."
            )
            
            response = self.model.generate_content([prompt, image_data[0]])
            result = response.text.strip()
            
            if "NO_VISUALS" in result:
                return ""
                
            return f"\n\n--- PAGE VISUAL ANALYSIS ---\n{result}\n"
            
        except Exception as e:
            logger.warning("Full page visual analysis failed", error=str(e))
            return ""


# Global service instance
vision_service = VisionService()
