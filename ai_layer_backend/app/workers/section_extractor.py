"""
Section Extractor — extracts structured data and markdown from a specific document segment.
Driven by the SopConfig's section definition.
"""
import json
import asyncio
from typing import Dict, Any, List, Optional
from app.core.config import settings
from app.core.logging import get_logger
from app.core.openai_client import get_async_openai_client, DEPLOYMENT_MODEL
from app.workers.job_context import JobContext

logger = get_logger(__name__)


class SectionExtractor:
    """
    Handles extraction from a single section.
    1. Formulates a dynamic prompt based on SopConfig fields.
    2. Calls OpenAI with temperature=0 and response_format=json_object.
    3. Handles field_id mapping and markdown conversion.
    """

    def __init__(self, context: JobContext):
        self.ctx = context
        self.client = get_async_openai_client()

    async def process(self, section_id: str, segment_text: str) -> Dict[str, Any]:
        """Process extraction for a specific section and segment."""
        section = self.ctx.get_section(section_id)
        if not section:
            logger.error(f"Section {section_id} definition not found in SopConfig")
            return {"status": "failed", "error": f"Section {section_id} not defined"}

        label = section.get('label')
        fields = section.get('fields', [])
        
        # 1. Build Custom Extraction Prompt
        system_prompt = self._build_system_prompt(section)
        user_prompt = f"### Document Segment (Section: {label})\n\n{segment_text}"

        logger.info(f"Dispatching LLM extraction for section: {label}")
        
        try:
            # 2. Call OpenAI (temperature=0, response_format=json_object)
            response = await self.client.chat.completions.create(
                model=DEPLOYMENT_MODEL,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt}
                ],
                temperature=0,
                response_format={"type": "json_object"}
            )
            
            # 3. Parse and Validate
            content = response.choices[0].message.content
            raw_data = json.loads(content)
            
            # 4. Generate Markdown Result
            markdown = self._format_to_markdown(section, raw_data)
            
            # 5. Push to Global Job Context storage for other processors to use
            for fid, val in raw_data.items():
                if fid != "_markdown" and val is not None:
                    await self.ctx.set_field(fid, val)
            
            return {
                "status": "completed",
                "markdown": markdown,
                "raw_json": raw_data,
                "gpt_model": settings.GPT_MODEL,
                "gpt_input_tokens": response.usage.prompt_tokens,
                "gpt_output_tokens": response.usage.completion_tokens,
            }

        except Exception as e:
            logger.error(f"LLM extraction failed for section {section_id}", error=str(e))
            return {"status": "failed", "error": str(e)}

    def _build_system_prompt(self, section: Dict[str, Any]) -> str:
        """Dynamically build the system prompt based on SOP fields."""
        fields = section.get('fields', [])
        label = section.get('label')
        
        # Field extraction instructions
        field_instructions = []
        for f in fields:
            fid = f.get('field_id')
            flab = f.get('label')
            ftype = f.get('extraction_type', 'TEXT')
            instr = f"- **{flab}** (JSON Key: `{fid}`): "
            
            if f.get('prompt_override'):
                instr += f.get('prompt_override')
            else:
                instr += f"Extract the {flab} found in this section."
                if ftype == 'TABLE':
                    instr += " Return as a structured list of objects if multiple rows exist."

            field_instructions.append(instr)

        field_list_str = "\n".join(field_instructions)
        
        prompt = f"""You are an Expert Financial Document Extractor specializing on DRHP/RHP filings.
Your task is to extract specific information from the provided document segment for the section "{label}".

### Guidelines:
1. EXTRACT DATA ACCURATELY. If a value is missing, return null.
2. DO NOT include boilerplate or preamble.
3. CONVERT all currency to numerical values (e.g., "5.00 Crore" to 50000000) if possible.
4. RETURN JSON ONLY.

### Fields to Extract:
{field_list_str}

### Output Format:
Return a JSON object where the keys exactly match the Field IDs provided above. 
Append a `_markdown` key to the JSON containing a beautifully formatted markdown version of THIS ENTIRE SECTION'S extracted content (MDN style).
"""
        return prompt

    def _format_to_markdown(self, section: Dict[str, Any], raw_data: Dict[str, Any]) -> str:
        """Helper to extract or build the final markdown representation."""
        # Use LLM-generated markdown for speed, or fallback to auto-formatting
        return raw_data.get('_markdown', f"# {section.get('label')}\n" + json.dumps(raw_data, indent=2))
