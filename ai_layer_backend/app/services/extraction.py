"""
Enhanced Multi-Engine Document Extraction Service.
Matches the architecture diagram:
  - pdfplumber: Full text & section mapping
  - Camelot: Lattice + Stream table extraction (High-fidelity)
"""
import io
import re
import tempfile
import uuid
import sys
import os
import asyncio
from typing import Dict, Any, List, Optional, Tuple, Callable

# --- MULTIPROCESSING PATH FIX ---
# On macOS ('spawn' mode), child processes don't inherit the parent's sys.path.
# We must ensure the project root (ai_layer_backend) is in PYTHONPATH.
_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _root not in sys.path:
    sys.path.insert(0, _root)
# Propagate to children via environment variable
os.environ["PYTHONPATH"] = _root + os.pathsep + os.environ.get("PYTHONPATH", "")

import pdfplumber
import concurrent.futures
from concurrent.futures import ProcessPoolExecutor, ThreadPoolExecutor
import multiprocessing
from app.core.logging import get_logger
from app.services.s3 import s3_service

logger = get_logger(__name__)

# Lazy import camelot to prevent startup failure if system libs are missing
try:
    import camelot
    CAMELOT_AVAILABLE = True
except ImportError as _e:
    CAMELOT_AVAILABLE = False
    camelot = None
    import warnings
    warnings.warn(f"camelot-py could not be loaded: {_e}. Table extraction will fall back to pdfplumber.", RuntimeWarning)

# --------------------------------------------------------------------------- #
# Patterns & Helpers
# --------------------------------------------------------------------------- #
# Updated to match "SECTION I", "SECTION - IV", "SECTION – IV", etc.
TOC_LINE_PATTERN = re.compile(r"^(.*?)(?:\s|\.){3,}\s*(\d+)$", re.MULTILINE)
SECTION_PREFIX_PATTERN = re.compile(r"^(?:SECTION|PART)\s*[-\u2013\u2014]?\s*[IVXLCD0-9]+", re.IGNORECASE)
SUBSECTION_PREFIX_PATTERN = re.compile(r"^[A-Z][a-z]+(?:\s[A-Z][a-z]+)*", re.UNICODE)


def _to_markdown_table(rows: List[List[str]]) -> str:
    """
    Safely convert a grid of strings to Markdown table format with full columns and rows.
    Includes advanced Multi-Level Header Merging for financial tables.
    """
    if not rows or not any(rows):
        return ""
    
    # 1. Cleaning and normalization
    clean_rows = []
    for row in rows:
        if not any(row): continue
        clean_row = []
        for c in row:
            if c is None: clean_row.append("")
            else:
                s = str(c).replace("|", "\\|").replace("\n", " ").strip()
                clean_row.append(s)
        clean_rows.append(clean_row)
        
    if not clean_rows: return ""
    
    # 2. Alignment
    max_cols = max(len(row) for row in clean_rows)
    for row in clean_rows:
        while len(row) < max_cols:
            row.append("")

    # 3. ADVANCED: Multi-Level Header Detection & Merging
    # If the first row has many empty columns, it's likely a parent header row (e.g. "Fiscal 2024" covering 2 cols)
    final_header = []
    start_data_idx = 1
    
    if len(clean_rows) > 1:
        row0 = clean_rows[0]
        row1 = clean_rows[1]
        
        # Heuristic: If row0 has trailing/internal empty cells next to labels, it's a multi-level header
        empty_count = row0.count("")
        has_numeric_r0 = any(re.search(r'\d', str(c)) for c in row0 if str(c).upper() not in ["2022", "2023", "2024", "2025"]) 
        
        if empty_count > (max_cols / 4) and not has_numeric_r0:
            # Merging Strategy: Forward-fill the parent headers and append the child sub-headers
            merged_header = []
            curr_parent = ""
            for i in range(max_cols):
                parent = row0[i] if i < len(row0) else ""
                child = row1[i] if i < len(row1) else ""
                
                if parent: curr_parent = parent
                
                if curr_parent and child and curr_parent != child:
                    merged_header.append(f"{curr_parent} ({child})")
                elif curr_parent:
                    merged_header.append(curr_parent)
                else:
                    merged_header.append(child)
            
            final_header = merged_header
            start_data_idx = 2
        else:
            final_header = row0
    else:
        final_header = clean_rows[0]

    # 4. Final MDN Construction
    header_str = "| " + " | ".join(final_header) + " |"
    sep_str = "| " + " | ".join(["---"] * max_cols) + " |"
    body_str = "\n".join("| " + " | ".join(row) + " |" for row in clean_rows[start_data_idx:])
    
    return "\n".join(filter(None, [header_str, sep_str, body_str]))


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


def _camelot_worker(pdf_path: str, pages_str: str, flavor: str, edge_tol: int, batch_start: int, batch_end: int) -> Dict[str, Any]:
    """Isolated worker for Camelot to prevent memory leaks and speed up extraction."""
    try:
        import camelot as _camelot
    except ImportError as e:
        return {"batch_start": batch_start, "batch_end": batch_end, "error": f"camelot unavailable: {e}", "tables": []}
    try:
        # Each worker process gets its own Ghostscript instance via Camelot
        tables = _camelot.read_pdf(pdf_path, pages=pages_str, flavor=flavor, edge_tol=edge_tol)
        batch_data = []
        for t in tables:
            batch_data.append({
                "local_page": t.page,
                "df_values": t.df.values.tolist(),
                "bbox": t._bbox
            })
        return {"batch_start": batch_start, "batch_end": batch_end, "tables": batch_data}
    except Exception as e:
        return {"batch_start": batch_start, "batch_end": batch_end, "error": str(e), "tables": []}


def _worker_init(root_path: str):
    """Initializer to ensure child processes have the correct path."""
    import sys
    import os
    if root_path not in sys.path:
        sys.path.insert(0, root_path)
    os.environ["PYTHONPATH"] = root_path + os.pathsep + os.environ.get("PYTHONPATH", "")


class ExtractionService:
    """
    Service for multi-engine document extraction.
    Ensures Section IV and Tables are captured correctly.
    """

    def _pdfplumber_fallback(self, pdf_path: str, start: int, end: int) -> List[Dict[str, Any]]:
        """Fallback table extraction using pdfplumber when Camelot fails."""
        import pdfplumber
        tables_data = []
        try:
            with pdfplumber.open(pdf_path) as pdf:
                # Iterate through requested pages
                for p_num in range(start, end + 1):
                    if p_num > len(pdf.pages): break
                    page = pdf.pages[p_num - 1]
                    h = page.height
                    
                    found = page.find_tables()
                    for t in found:
                        # Convert plumber bbox (x0, top, x1, bottom) to camelot-style (x0, y0, x1, y1)
                        # Camelot y1 is plumber top, y0 is plumber bottom
                        x0, top, x1, btm = t.bbox
                        # Camelot coors are from btm up
                        camelot_bbox = (x0, h - btm, x1, h - top)
                        
                        tables_data.append({
                            "local_page": p_num - start + 1,
                            "df_values": t.extract(),
                            "bbox": camelot_bbox
                        })
            return tables_data
        except Exception as e:
            logger.error(f"pdfplumber fallback failed: {str(e)}")
            return []

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
        2. Text extraction & metadata mapping.
        """
        job_id = job_id or str(uuid.uuid4())
        temp_path = None
        try:
            with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as tmp:
                tmp.write(file_content)
                temp_path = tmp.name

            all_tables_storage = []
            
            # --- 1. Global Table Extraction (Parallelized) ---
            # Extract total page count and TOC first
            with pdfplumber.open(temp_path) as pdf:
                toc_map = provided_toc or _extract_toc_mapping(pdf)
                total_pages = len(pdf.pages)
            
            # Identify Priority Pages (OUR BUSINESS, CAPITAL STRUCTURE, FINANCIAL INFORMATION)
            priority_pages = set()
            priority_keywords = ["OUR BUSINESS", "CAPITAL STRUCTURE", "FINANCIAL INFORMATION"]
            for entry in toc_map:
                e_name = entry.get("name", "").upper()
                if any(kw in e_name for kw in priority_keywords):
                    for p in range(entry["start_page"], entry["end_page"] + 1):
                        priority_pages.add(p)

            logger.info("Starting Parallel Global Table Scan", job_id=job_id, pages=total_pages, priority_pages=len(priority_pages))
            
            all_tables_storage = []
            max_workers = min(4, multiprocessing.cpu_count())

            # Celery prefork workers are daemon processes and cannot spawn child processes.
            # In that environment, ProcessPoolExecutor raises:
            # "daemonic processes are not allowed to have children".
            can_spawn_processes = not multiprocessing.current_process().daemon

            if can_spawn_processes:
                # --- MULTIPROCESSING CONTEXT ---
                # On macOS, 'spawn' often fails to find the 'app' package in child processes.
                # 'fork' is used here to ensure the child inherits the parent's sys.path and environment.
                import multiprocessing as mp
                try:
                    # Use fork on macOS for path inheritance; spawn on others for safety
                    method = "fork" if sys.platform == "darwin" else "spawn"
                    ctx = mp.get_context(method)
                except Exception:
                    ctx = mp.get_context("spawn")

                executor: concurrent.futures.Executor = ProcessPoolExecutor(
                    max_workers=max_workers,
                    mp_context=ctx,
                    initializer=_worker_init,
                    initargs=(_root,)
                )
            else:
                logger.warning(
                    "Running inside daemon worker process; using ThreadPoolExecutor "
                    "for table extraction to avoid nested multiprocessing crash",
                    job_id=job_id,
                    max_workers=max_workers,
                )
                executor = ThreadPoolExecutor(max_workers=max_workers)

            with executor:
                loop = asyncio.get_event_loop()
                futures = []
                
                # Setup batches (40 pages each)
                step = 40
                batches = []
                for batch_start in range(1, total_pages + 1, step):
                    batch_end = min(batch_start + step - 1, total_pages)
                    batch_pages = set(range(batch_start, batch_end + 1))
                    is_prio = not batch_pages.isdisjoint(priority_pages)
                    batches.append((batch_start, batch_end, is_prio))
                
                # Re-order: Priority batches first (Stable sort keeps chronological order within groups)
                batches.sort(key=lambda x: x[2], reverse=True)
                
                for b_start, b_end, is_prio in batches:
                    pages_str = f"{b_start}-{b_end}"
                    if is_prio:
                        logger.info(f"Queuing PRIORITY Camelot Batch: {pages_str}", job_id=job_id)
                    else:
                        logger.info(f"Queuing Regular Camelot Batch: {pages_str}", job_id=job_id)
                    
                    futures.append(loop.run_in_executor(
                        executor, 
                        _camelot_worker, 
                        temp_path, 
                        pages_str, 
                        "stream", 
                        100, 
                        b_start,
                        b_end
                    ))

                # Collect and post-process
                for future in asyncio.as_completed(futures):
                    try:
                        result = await future
                        b_start = result.get("batch_start")
                        b_end = result.get("batch_end")
                        b_err = result.get("error")
                        b_tables_data = result.get("tables", [])
                        
                        if b_err:
                            logger.warning(f"Batch {b_start} Camelot failed: {b_err}. Falling back to pdfplumber.")
                            b_tables_data = self._pdfplumber_fallback(temp_path, b_start, b_end)

                        batch_tables = []
                        # Open pdfplumber once per batch for header lookup
                        with pdfplumber.open(temp_path) as current_pdf:
                            for t_data in b_tables_data:
                                table_df_vals = t_data["df_values"]
                                t_md = _to_markdown_table(table_df_vals)
                                if not t_md or len(table_df_vals) < 2: continue
                                
                                global_p = b_start + t_data["local_page"] - 1
                                if global_p > total_pages: continue
                                
                                # Create dummy object for header lookup
                                class MockTable:
                                    def __init__(self, bbox): self._bbox = bbox
                                
                                t_heading = self._get_table_heading(current_pdf.pages[global_p - 1], MockTable(t_data["bbox"]))
                                sec, sub, r_str = self._find_toc_entry_for_page(global_p, toc_map)
                                
                                table_metadata = {
                                    "table_id": str(uuid.uuid4()),
                                    "section": sec or "General",
                                    "subsection": sub or "",
                                    "subsection_range": r_str,
                                    "table_heading": t_heading,
                                    "page": global_p,
                                    "markdown": t_md,
                                    "headers": table_df_vals[0] if table_df_vals else []
                                }
                                batch_tables.append(table_metadata)

                        if table_callback and batch_tables:
                            await table_callback(batch_tables)
                            logger.info(f"Streamed {len(batch_tables)} tables for batch starting {b_start}")
                        
                        all_tables_storage.extend(batch_tables)

                    except Exception as e:
                        logger.error(f"Error in parallel batch processing: {str(e)}", exc_info=True)

            # --- 1b. Table Stitching ---
            if all_tables_storage:
                all_tables_storage.sort(key=lambda x: x["page"])
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

            # --- 2. Text Extraction ---
            with pdfplumber.open(temp_path) as pdf:
                processed_sections = []
                for entry in toc_map:
                    sec_name = entry["name"]
                    start_p = entry["start_page"]
                    end_p = entry["end_page"]
                    is_sub = (entry["type"] == "subsection")
                    
                    section_text_parts = []
                    tables_in_this_entry = []
                    headings_in_this_entry = []
                    
                    for p_num in range(start_p, end_p + 1):
                        if p_num > total_pages: break
                        page = pdf.pages[p_num - 1]
                        
                        # 1. Page text (Raw Layout)
                        p_text = page.extract_text(layout=True)
                        if p_text:
                            section_text_parts.append(f"\n--- [Page {p_num}] ---\n{p_text}")
                        

                            
                        # 2. Page Tables (High-Fidelity Markdown)
                        # Injecting tables immediately after their page text ensures they remain 
                        # in the same or adjacent chunks in Pinecone.
                        for t in all_tables_storage:
                            if t["page"] == p_num:
                                # Apply subsection filters
                                if is_sub and t.get("subsection") and t["subsection"] != sec_name:
                                    continue
                                if not is_sub and t.get("subsection"):
                                    continue
                                    
                                section_text_parts.append(f"\n\n--- [Table: {t['table_heading']}] ---\n{t['markdown']}\n\n")
                                tables_in_this_entry.append(t["table_id"])
                                if t["table_heading"]:
                                    headings_in_this_entry.append(t["table_heading"])

                    section_text = "\n".join(section_text_parts)
                    cleaned_section = _clean_text_preserving_tables(section_text)
                    if len(cleaned_section) > 50:
                        processed_sections.append({
                            "sectionName": sec_name,
                            "subsectionName": sec_name if is_sub else "",
                            "sectionStart&End": entry["range_str"],
                            "text": cleaned_section,
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
