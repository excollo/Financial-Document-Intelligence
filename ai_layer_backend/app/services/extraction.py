"""
Enhanced Multi-Engine Document Extraction Service.
Matches the architecture diagram:
  - pdfplumber: Full text & section mapping
  - Camelot: Lattice + Stream table extraction (High-fidelity)
  - pdf2image: Screenshot capture for visuals/charts (Stored in S3)
"""
import io
import re
import tempfile
import os
import asyncio
import uuid
from typing import Dict, Any, List, Optional, Tuple
import pdfplumber
import camelot
from pdf2image import convert_from_path
from app.core.logging import get_logger
from app.services.s3 import s3_service

logger = get_logger(__name__)

# --------------------------------------------------------------------------- #
# Patterns & Helpers
# --------------------------------------------------------------------------- #
# Updated to match "SECTION I", "SECTION - IV", "SECTION – IV", etc.
TOC_LINE_PATTERN = re.compile(r"^(.*?)(?:\s|\.){3,}\s*(\d+)$", re.MULTILINE)
SECTION_PREFIX_PATTERN = re.compile(r"^(?:SECTION|PART)\s*[-\u2013\u2014]?\s*[IVXLCD0-9]+", re.IGNORECASE)
SUBSECTION_PREFIX_PATTERN = re.compile(r"^[A-Z][a-z]+(?:\s[A-Z][a-z]+)*", re.UNICODE)


def _to_markdown_table(rows: List[List[str]]) -> str:
    """Safely convert a grid of strings to Markdown table format with full columns and rows."""
    if not rows or not any(rows):
        return ""
    
    # Escape pipe characters and normalize newlines
    clean_rows = []
    for row in rows:
        if not any(row): continue
        clean_row = []
        for c in row:
            if c is None:
                clean_row.append("")
            else:
                s = str(c).replace("|", "\\|").replace("\n", " ").strip()
                clean_row.append(s)
        clean_rows.append(clean_row)
        
    if not clean_rows:
        return ""
    
    # Calculate max columns
    max_cols = max(len(row) for row in clean_rows)
    
    # Ensure all rows have the same number of columns
    for row in clean_rows:
        while len(row) < max_cols:
            row.append("")
    
    header = "| " + " | ".join(clean_rows[0]) + " |"
    sep = "| " + " | ".join(["---"] * max_cols) + " |"
    body = "\n".join("| " + " | ".join(row) + " |" for row in clean_rows[1:])
    return "\n".join(filter(None, [header, sep, body]))


def _extract_toc_mapping(pdf) -> List[Dict[str, Any]]:
    """
    Scan the first 20 pages for the Table of Contents.
    Supports both dot-separated text (.....) and table-based TOCs.
    """
    mapping: List[Dict[str, Any]] = []
    found_toc = False
    total_pages = len(pdf.pages)

    for i in range(min(20, total_pages)):
        page = pdf.pages[i]
        text = page.extract_text() or ""
        
        # 1. Check for TOC keywords
        if "TABLE OF CONTENTS" in text.upper() or "INDEX" in text.upper():
            found_toc = True

        if found_toc:
            # --- Type A: Regex-based (Dots) ---
            matches = TOC_LINE_PATTERN.findall(text)
            for name, page_str in matches:
                name = name.strip()
                try:
                    page_num = int(page_str)
                    is_section = bool(SECTION_PREFIX_PATTERN.match(name))
                    mapping.append({
                        "start_page": page_num,
                        "type": "section" if is_section else "subsection",
                        "name": name,
                    })
                except ValueError:
                    continue
            
            # --- Type B: Table-based TOC (Common in Indian RHPs) ---
            # If regex didn't find much, look for tables
            if len(mapping) < 5:
                tables = page.extract_tables()
                for table in tables:
                    if not table or len(table) < 2: continue
                    
                    # Try to identify TOC columns: [SECTION, NAME, PAGE]
                    header = [str(c or "").upper() for c in table[0]]
                    page_col_idx = -1
                    name_col_idx = -1
                    section_col_idx = -1
                    
                    for idx, h in enumerate(header):
                        if "PAGE" in h: page_col_idx = idx
                        if "CONTENTS" in h or "PARTICULARS" in h or "NAME" in h: name_col_idx = idx
                        if "SECTION" in h: section_col_idx = idx
                    
                    if page_col_idx != -1:
                        # Process rows
                        for row_idx, row in enumerate(table):
                            if row_idx == 0: continue # skip header
                            try:
                                p_str = re.sub(r"\D", "", str(row[page_col_idx] or ""))
                                if not p_str: continue
                                page_num = int(p_str)
                                
                                # Combine section and name
                                prefix = str(row[section_col_idx] or "").strip() if section_col_idx != -1 else ""
                                name_text = str(row[name_col_idx] or "").strip() if name_col_idx != -1 else ""
                                
                                # Ignore empty names or page numbers that are too large
                                if not name_text and not prefix: continue
                                if page_num > total_pages: continue
                                
                                full_name = f"{prefix} {name_text}".strip()
                                is_section = bool(SECTION_PREFIX_PATTERN.match(full_name)) or (bool(prefix) and not name_text)
                                
                                mapping.append({
                                    "start_page": page_num,
                                    "type": "section" if is_section else "subsection",
                                    "name": full_name,
                                })
                            except (ValueError, IndexError):
                                continue

            if len(mapping) > 10:
                # If we've found enough headers, we can stop searching TOC pages
                break

    if not mapping:
        logger.warning("No TOC mapping found. Using full-document fallback.")
        return [{
            "start_page": 1,
            "end_page": total_pages,
            "type": "section",
            "name": "SECTION: FULL DOCUMENT",
            "range_str": f"1-{total_pages}"
        }]

    # De-duplicate and Sort
    unique_mapping = {}
    for entry in mapping:
        key = (entry["start_page"], entry["name"])
        if key not in unique_mapping:
            unique_mapping[key] = entry
    
    mapping = list(unique_mapping.values())
    mapping.sort(key=lambda x: x["start_page"])

    # Calculate end pages
    for idx, entry in enumerate(mapping):
        next_page = total_pages
        if entry["type"] == "section":
            for next_entry in mapping[idx + 1:]:
                if next_entry["type"] == "section":
                    next_page = next_entry["start_page"] - 1
                    break
        else:
            if idx + 1 < len(mapping):
                next_page = mapping[idx + 1]["start_page"] - 1
        
        # Ensure end_page is at least start_page
        entry["end_page"] = max(entry["start_page"], next_page)
        entry["range_str"] = f"{entry['start_page']}-{entry['end_page']}"

    return mapping


def _clean_text_preserving_tables(text: str) -> str:
    """Clean text while preserving Markdown table structure (newlines)."""
    if not text:
        return ""
    # Remove TOC noise
    text = re.sub(r"TABLE OF CONTENTS", "", text, flags=re.IGNORECASE)
    # Remove excessive dots
    text = re.sub(r"\.{5,}", "", text)
    # Remove page numbers
    text = re.sub(r"Page\s\d+", "", text, flags=re.IGNORECASE)
    # Normalize whitespaces but PRESERVE newlines for Markdown tables
    lines = text.split("\n")
    cleaned_lines = [re.sub(r"\s{2,}", " ", line).strip() for line in lines]
    return "\n".join(cleaned_lines).strip()


class ExtractionService:
    """
    Service for multi-engine document extraction.
    Ensures Section IV and Tables are captured correctly.
    """

    def _get_table_heading(self, page_plumber, camelot_table) -> str:
        """Heuristic to find a table heading (text in a small box strictly above the table)."""
        try:
            # Camelot y coordinates are from BTM UP
            # pdfplumber y coordinates are from TOP DOWN
            h = page_plumber.height
            x1, y1, x2, y2 = camelot_table._bbox
            
            # Area to scan: full width of table, 40-60 pixels above it
            # pdfplumber bounding box: [x0, top, x1, bottom]
            search_area = (x1, max(0, h - y2 - 60), x2, h - y2)
            crop = page_plumber.within_bbox(search_area)
            heading_text = crop.extract_text()
            if heading_text:
                # Clean up and return first 100 chars
                heading_text = heading_text.replace("\n", " ").strip()
                return heading_text[:120]
        except Exception:
            pass
        return ""

    @staticmethod
    def _find_toc_entry_for_page(p_num: int, toc_map: List[Dict[str, Any]]) -> Tuple[Optional[str], Optional[str], Optional[str]]:
        """Find the matching Section and Subsection for a given page number."""
        best_section = None
        best_subsection = None
        range_str = ""
        
        # toc_map is sorted by start_page
        current_sec = None
        for entry in toc_map:
            if entry["start_page"] <= p_num:
                if entry["type"] == "section":
                    current_sec = entry["name"]
                    best_section = entry["name"]
                    best_subsection = ""
                    range_str = entry["range_str"]
                elif entry["type"] == "subsection":
                    best_section = current_sec
                    best_subsection = entry["name"]
                    best_subsection_range = entry["range_str"]
                    range_str = best_subsection_range
            else:
                break
        return best_section, best_subsection, range_str

    async def get_toc(self, file_content: bytes) -> List[Dict[str, Any]]:
        """Public method to extract TOC only."""
        temp_path = None
        try:
            with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as tmp:
                tmp.write(file_content)
                temp_path = tmp.name
            
            with pdfplumber.open(temp_path) as pdf:
                return _extract_toc_mapping(pdf)
        finally:
            if temp_path and os.path.exists(temp_path):
                os.remove(temp_path)

    async def extract_sections_from_pdf(
        self, 
        file_content: bytes, 
        job_id: str = None, 
        table_callback: Optional[Callable] = None,
        provided_toc: Optional[List[Dict[str, Any]]] = None
    ) -> Dict[str, Any]:
        """
        Main multi-engine extraction flow.
        1. Global Table Extraction (Every page).
        2. Visual references capture.
        3. Text extraction & metadata mapping.
        """
        job_id = job_id or str(uuid.uuid4())
        temp_path = None
        try:
            with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as tmp:
                tmp.write(file_content)
                temp_path = tmp.name

            all_tables_storage = []
            
            # --- 1. Global Table Extraction (High-Fidelity) ---
            # Extract total page count first
            with pdfplumber.open(temp_path) as pdf:
                toc_map = provided_toc or _extract_toc_mapping(pdf)
                total_pages = len(pdf.pages)
                
            logger.info("Starting Global Table Scan", job_id=job_id, pages=total_pages)

            # Process in small chunks to avoid memory bloat and provide early storage
            for batch_start in range(1, total_pages + 1, 20):
                batch_end = min(batch_start + 19, total_pages)
                try:
                    logger.info(f"Camelot Batch: {batch_start}-{batch_end}")
                    tables = camelot.read_pdf(temp_path, pages=f"{batch_start}-{batch_end}", flavor="stream", edge_tol=100)
                    
                    batch_tables = []
                    # Isolated pdfplumber handle for this batch header scan
                    with pdfplumber.open(temp_path) as current_pdf:
                        for idx, table in enumerate(tables):
                            table_df = table.df
                            table_md = _to_markdown_table(table_df.values.tolist())
                            if not table_md or len(table_df) < 2: continue
                            
                            global_page = batch_start + table.page - 1
                            table_page_plumber = current_pdf.pages[global_page - 1]
                            table_heading = self._get_table_heading(table_page_plumber, table)
                            
                            sec, sub, r_str = self._find_toc_entry_for_page(global_page, toc_map)
                            
                            table_metadata = {
                                "table_id": str(uuid.uuid4()),
                                "section": sec or "General",
                                "subsection": sub or "",
                                "subsection_range": r_str,
                                "table_heading": table_heading,
                                "page": global_page,
                                "markdown": table_md,
                                "headers": table_df.values.tolist()[0] if len(table_df) > 0 else []
                            }
                            batch_tables.append(table_metadata)

                    # --- Early Storage Callback (Streaming) ---
                    if table_callback and batch_tables:
                        await table_callback(batch_tables)
                        logger.info(f"Streamed {len(batch_tables)} tables to database from batch {batch_start}")
                    
                    all_tables_storage.extend(batch_tables)

                except Exception as e:
                    logger.warning(f"Camelot batch {batch_start} failed: {str(e)}")

            # --- 1b. Table Stitching (Merge sequential tables) ---
            if all_tables_storage:
                stitched = []
                curr = all_tables_storage[0]
                for next_t in all_tables_storage[1:]:
                    headers_match = (curr["headers"] == next_t["headers"])
                    is_sequential = (next_t["page"] == curr["page"] + 1)
                    if headers_match and is_sequential:
                        body_lines = next_t["markdown"].split("\n")[2:]
                        curr["markdown"] += "\n" + "\n".join(body_lines)
                        curr["page_end"] = next_t["page"]
                    else:
                        stitched.append(curr)
                        curr = next_t
                stitched.append(curr)
                all_tables_storage = stitched
                # If we stitched, we might want to re-save or update Mongo?
                # For now, summary pipeline can handle it from these results.

            # --- 2. Screenshots & Text Extraction ---
            with pdfplumber.open(temp_path) as pdf:
                screenshots_urls = {}
                try:
                    images = convert_from_path(temp_path, dpi=200, first_page=1, last_page=min(50, total_pages))
                    for i, img in enumerate(images):
                        p_num = i + 1
                        with io.BytesIO() as out:
                            img.save(out, format="PNG")
                            s3_key = f"visuals/{job_id}/page_{p_num}.png"
                            if await s3_service.upload_file(out.getvalue(), s3_key, "image/png"):
                                screenshots_urls[p_num] = s3_service.get_public_url(s3_key)
                except Exception as ex_img:
                    logger.warning(f"Screenshots failed: {str(ex_img)}")

                processed_sections = []
                for entry in toc_map:
                    sec_name = entry["name"]
                    start_p = entry["start_page"]
                    end_p = entry["end_page"]
                    is_sub = (entry["type"] == "subsection")
                    
                    section_text_parts = []
                    section_images = []
                    tables_in_this_entry = []
                    headings_in_this_entry = []
                    
                    for p_num in range(start_p, end_p + 1):
                        if p_num > total_pages: break
                        page = pdf.pages[p_num - 1]
                        p_text = page.extract_text(layout=True)
                        if p_text:
                            section_text_parts.append(f"\n--- [Page {p_num}] ---\n{p_text}")
                        if p_num in screenshots_urls:
                            section_images.append(screenshots_urls[p_num])

                    # Match with global tables scan
                    for t in all_tables_storage:
                        p_start = t["page"]
                        p_end = t.get("page_end", p_start)
                        overlap = max(start_p, p_start) <= min(end_p, p_end)
                        if overlap:
                            if is_sub and t["subsection"] != sec_name: continue
                            if not is_sub and t["subsection"] != "": continue
                            section_text_parts.append(f"\n\n--- [Table: {t['table_heading']}] ---\n{t['markdown']}")
                            tables_in_this_entry.append(t["table_id"])
                            if t["table_heading"]: headings_in_this_entry.append(t["table_heading"])

                    section_text = "\n".join(section_text_parts)
                    cleaned_section = _clean_text_preserving_tables(section_text)
                    if len(cleaned_section) > 50:
                        processed_sections.append({
                            "sectionName": sec_name,
                            "subsectionName": sec_name if is_sub else "",
                            "sectionStart&End": entry["range_str"],
                            "text": cleaned_section,
                            "visual_references": section_images,
                            "table_count": len(tables_in_this_entry),
                            "table_headings": ", ".join(headings_in_this_entry) if headings_in_this_entry else ""
                        })

            return {
                "sections": processed_sections,
                "tables": all_tables_storage
            }

        except Exception as e:
            logger.error("Multi-Engine extraction failed", error=str(e), exc_info=True)
            raise
        finally:
            if temp_path and os.path.exists(temp_path):
                os.remove(temp_path)

    @staticmethod
    def extract_text(file_content: bytes, file_type: str, metadata: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Legacy sync wrapper."""
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            result = loop.run_until_complete(extraction_service.extract_sections_from_pdf(file_content))
            sections = result["sections"]
            combined_text = " ".join(s["text"] for s in sections if s.get("text"))
            return {
                "text": combined_text,
                "file_type": file_type,
                "char_count": len(combined_text),
                "metadata": metadata or {},
            }
        finally:
            loop.close()


# Global service instance
extraction_service = ExtractionService()
