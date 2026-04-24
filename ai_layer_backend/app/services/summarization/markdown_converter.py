"""
Markdown Converter for Summary Pipeline
Converts Agent JSON outputs to markdown format
Matches n8n workflow conversion nodes
"""
import re
from typing import Dict, Any, List, Optional
from app.services.summarization.prompts import TARGET_INVESTORS


class MarkdownConverter:
    """
    Converts JSON outputs from agents to markdown format.
    Replicates n8n JavaScript conversion nodes.
    """
    
    def _safe_get_dict(self, data: Any, key: str) -> Dict[str, Any]:
        """Safely extract a dictionary from a potential dictionary."""
        if not isinstance(data, dict):
            return {}
        val = data.get(key)
        return val if isinstance(val, dict) else {}

    def _safe_get_list(self, data: Any, key: str) -> List[Any]:
        """Safely extract a list from a potential dictionary."""
        if not isinstance(data, dict):
            return []
        val = data.get(key)
        return val if isinstance(val, list) else []

    def _safe_number(self, value: Any, default: float = 0.0) -> float:
        """Convert mixed numeric inputs (int/float/str) into float safely."""
        if value is None:
            return default
        if isinstance(value, (int, float)):
            return float(value)
        if isinstance(value, str):
            cleaned = value.replace(",", "").replace("%", "").strip()
            cleaned = re.sub(r"[^\d.\-]", "", cleaned)
            if cleaned in {"", "-", ".", "-."}:
                return default
            try:
                return float(cleaned)
            except ValueError:
                return default
        return default
    
    def convert_investor_json_to_markdown(
        self,
        investor_json: Dict[str, Any],
        target_investors: List[str] = None,
        investor_match_only: bool = False,
        doc_type: str = "DRHP"
    ) -> str:
        """
        Converts Agent 1 JSON output to markdown tables.
        Matches user's n8n workflow logic: always show Section A and Section B.
        """
        if not investor_json or not isinstance(investor_json, dict):
            return ""

        company_name = investor_json.get("company_name", "Not explicitly stated in the provided text")
        total_share_issue = self._safe_number(investor_json.get("total_share_issue", 0))
        investors = self._safe_get_list(investor_json, "section_a_extracted_investors")

        # -- Step 1: Build processed list --
        processed_investors = [inv for inv in investors if isinstance(inv, dict)]

        # -- Step 2: Add Others row if needed (matches n8n addOthersRowIfNeeded) --
        total_extracted_shares = sum(
            self._safe_number(inv.get("number_of_equity_shares", 0))
            for inv in processed_investors
        )
        
        if total_share_issue > 0 and total_extracted_shares < total_share_issue:
            others_shares = total_share_issue - total_extracted_shares
            processed_investors.append(
                {
                    "investor_name": "Others",
                    "number_of_equity_shares": others_shares,
                    "investor_category": "Public",
                    "is_others_row": True,
                }
            )
            # Re-sum after adding others
            total_extracted_shares = total_share_issue

        # -- Step 3: Recalculate percentages --
        if total_share_issue > 0:
            for inv in processed_investors:
                shares = self._safe_number(inv.get("number_of_equity_shares", 0))
                pct_value = (shares / total_share_issue) * 100
                pct_str = f"{pct_value:.2f}%"
                inv["percentage_of_pre_issue_capital"] = pct_str
                inv["_calculated_percentage"] = pct_value

        # -- Section A totals --
        total_pct_numeric = sum(
            inv.get("_calculated_percentage", 0) for inv in processed_investors
        )
        total_pct_str = f"{total_pct_numeric:.2f}%"

        # -- Step 4: Match against TARGET_INVESTORS --
        active_targets = target_investors if target_investors else TARGET_INVESTORS
        target_lower = {name.lower().strip() for name in active_targets}

        matched_investors = []
        for inv in processed_investors:
            if inv.get("is_others_row"):
                continue
            name = inv.get("investor_name", "")
            if not name:
                continue
            if str(name).lower().strip() in target_lower:
                matched_investors.append(
                    {
                        "investor_name": name,
                        "number_of_equity_shares": inv.get("number_of_equity_shares", 0),
                        "percentage_of_capital": inv.get("percentage_of_pre_issue_capital", "0%"),
                        "investor_category": inv.get("investor_category", "Unknown"),
                    }
                )

        # -- Step 5: Build markdown --
        # Summary header
        markdown = f"""
        
**Company Name:** {company_name}

**Total Share Issue:** {total_share_issue:,}

**Total Investors Extracted:** {len(processed_investors)}

**Total Extracted Shares:** {total_extracted_shares:,}

**Total Extracted %:** {total_pct_str}

---
"""
        # SECTION A is ALWAYS included to match n8n logic provided by user
        markdown += f"""
## SECTION A: COMPLETE INVESTOR LIST FROM {doc_type}

| Investor Name | Number of Equity Shares | % of Pre-Issue Shareholding | Investor Category |
|---|---|---|---|
"""
        if not processed_investors:
            markdown += "| No investors found | - | - | - |\n"
        else:
            for inv in processed_investors:
                name = inv.get("investor_name", "N/A")
                shares = int(self._safe_number(inv.get("number_of_equity_shares", 0)))
                pct = inv.get("percentage_of_pre_issue_capital", "0%")
                cat = inv.get("investor_category", "N/A")
                markdown += f"| {name} | {shares:,} | {pct} | {cat} |\n"
            markdown += f"| **TOTAL** | **{total_extracted_shares:,}** | **{total_pct_str}** | - |\n"

        markdown += "\n"

        # -- Section B: Matched Target Investors --
        # Logic Pivot: Use the markdown table generated by the LLM (Agent 1)
        # fallback to the old post-processing if not present.
        llm_matched_md = investor_json.get("section_b_matched_investors_markdown", "")
        if llm_matched_md:
            markdown += llm_matched_md + "\n"
        else:
            matched_total_shares = sum(
                self._safe_number(m.get("number_of_equity_shares", 0))
                for m in matched_investors
            )
            matched_total_pct_numeric = sum(
                float(str(m["percentage_of_capital"]).replace("%", ""))
                for m in matched_investors
                if m["percentage_of_capital"]
            )
            matched_total_pct_str = f"{matched_total_pct_numeric:.2f}%"

            markdown += "## SECTION B: MATCHED TARGET INVESTORS\n\n"

            if matched_investors:
                matched_status = "MATCH_FOUND"
                markdown += (
                    f"**Matched Status:** {matched_status}  \n"
                    f"**Total Matched Investors:** {len(matched_investors)}\n\n"
                )
                markdown += (
                    "| Investor Name | Number of Equity Shares "
                    "| % of Capital | Investor Category |\n"
                    "|---|---|---|---|\n"
                )
                for m in matched_investors:
                    markdown += (
                        f"| {m['investor_name']} "
                        f"| {int(self._safe_number(m.get('number_of_equity_shares', 0))):,} "
                        f"| {m['percentage_of_capital']} "
                        f"| {m['investor_category']} |\n"
                    )
                markdown += (
                    f"| **TOTAL** | **{matched_total_shares:,}** "
                    f"| **{matched_total_pct_str}** | - |\n"
                )
            else:
                markdown += (
                    "**Matched Status:** NO_MATCH_FOUND  \n"
                    "No investors from the TARGET_INVESTORS list were found "
                    "in the extracted investor list.\n"
                )

        markdown += "\n"
        return markdown
    
    def convert_capital_json_to_markdown(
        self,
        capital_json: Dict[str, Any],
        include_valuation_analysis: bool = True
    ) -> str:
        """
        Converts Agent 2 JSON output to markdown tables.
        Replicates: valuation MDN conveter node
        """
        if not capital_json or not isinstance(capital_json, dict):
            return ""
        
        calc_params = self._safe_get_dict(capital_json, "calculation_parameters")
        premium_rounds = self._safe_get_list(calc_params, "premium_rounds")
        table_info = self._safe_get_dict(calc_params, "table_data")
        markdown_table = table_info.get("markdown_table")
        share_capital_history = self._safe_get_list(capital_json, "share_capital_history")
        
        markdown = ""
        
        def clean_number(val: Any) -> float:
            if not val:
                return 0.0
            s = str(val).replace(",", "").replace("₹", "").replace("/-", "").replace("/ -", "")
            s = s.replace("N.A", "").replace("NA", "").replace("Nil", "").strip()
            import re
            s = re.sub(r'[^\d.]', '', s).strip()
            if not s:
                return 0.0
            try:
                return float(s)
            except ValueError:
                return 0.0

        def format_num(val: Any) -> str:
            if not val or val == 0 or val == 0.0:
                return "-"
            try:
                # Use standard comma formatting
                return f"{float(val):,.2f}".replace(".00", "")
            except Exception:
                return str(val)

        # Build full table matching n8n logic
        if share_capital_history:
            header = [
              "Sr No", "Date of Allotment", "Nature of Allotment", "Shares Allotted",
              "Face Value", "Issue Price", "Nature of Consideration", "Cumulative Equity Shares",
              "Cumulative Paid-up Capital", "Round Raised (\u20b9)",
              "Dilution (%)", "Post Money Valuation (\u20b9)"
            ]
            
            markdown += "## Share Capital History With Valuation\n\n"
            markdown += "| " + " | ".join(header) + " |\n"
            markdown += "|" + "|".join(["---"] * len(header)) + "|\n"
            
            for r in share_capital_history:
                if not isinstance(r, dict):
                    continue
                
                shares = clean_number(r.get("shares_allotted", ""))
                face = clean_number(r.get("face_value", ""))
                price = clean_number(r.get("issue_price", ""))
                cumulative = clean_number(r.get("cumulative_equity_shares", ""))
                
                roundRaised = "-"
                dilutionPercent = "-"
                postMoney = "-"
                
                if shares > 0 and face > 0 and price > face:
                    raised = shares * price
                    dilution = shares / cumulative if cumulative > 0 else 0
                    valuation = raised / dilution if dilution > 0 else 0
                    
                    roundRaised = format_num(raised)
                    dilutionPercent = f"{float(dilution) * 100:.2f}%"
                    postMoney = format_num(valuation)
                
                row = [
                    str(r.get("sr_no", "")).replace("\n", " ") or "",
                    str(r.get("date_of_allotment", "")).replace("\n", " ") or "",
                    str(r.get("nature_of_allotment", "")).replace("\n", " ") or "",
                    str(r.get("shares_allotted", "")).replace("\n", " ") or "",
                    str(r.get("face_value", "")).replace("\n", " ") or "",
                    str(r.get("issue_price", "")).replace("\n", " ") or "",
                    str(r.get("nature_of_consideration", "")).replace("\n", " ") or "",
                    str(r.get("cumulative_equity_shares", "")).replace("\n", " ") or "",
                    str(r.get("cumulative_paid_up_capital", "")).replace("\n", " ") or "",
                    roundRaised,
                    dilutionPercent,
                    postMoney
                ]
                markdown += "| " + " | ".join(row) + " |\n"
                
            markdown += "\n---\n\n"
        elif markdown_table:
            # Add Part 1: Share Capital History Table fallback
            markdown += "### PART 1: CAPTURED SHARE CAPITAL HISTORY\n\n"
            markdown += markdown_table + "\n\n---\n\n"
        
        # PART 2 removed: Premium round data is already in the combined
        # "Share Capital History With Valuation" table above.
        
        if not markdown:
            return "\n### No share capital history or premium rounds found.\n"
            
        return markdown

    # ------------------------------------------------------------------
    # Adverse Findings Markdown Converter
    # Exact Python port of n8n "convert in mdn3" JavaScript code node
    # ------------------------------------------------------------------

    def convert_research_json_to_markdown(self, data: Dict[str, Any]) -> str:
        """
        Converts research JSON output to comprehensive MDN-style markdown report.
        Matches n8n 'convert in mdn3' node logic.
        """
        if not data or "executive_summary" not in data:
            return ""

        # Extract fields with safe fallbacks
        metadata           = data.get("metadata") or {}
        exec_sum           = data.get("executive_summary") or {}
        detailed           = data.get("detailed_findings") or {}
        entity_network     = data.get("entity_network") or {}
        risk_assessment    = data.get("risk_assessment") or {}
        gaps               = data.get("gaps_and_limitations") or []
        next_steps         = data.get("next_steps") or []

        # Metadata
        company            = metadata.get("company", "Unknown Company")
        promoters          = metadata.get("promoters", "Not Available")
        investigation_date = metadata.get("investigation_date", "N/A")
        jurisdictions      = metadata.get("jurisdictions_searched") or []
        total_sources      = metadata.get("total_sources_checked", 0)

        # Executive summary
        adverse_flag       = exec_sum.get("adverse_flag", False)
        risk_level         = exec_sum.get("risk_level", "Not Rated")
        confidence_overall = exec_sum.get("confidence_overall", 0)
        key_findings       = exec_sum.get("key_findings", "No findings available.")
        red_flags_count    = exec_sum.get("red_flags_count") or {}
        recommended_action = exec_sum.get("recommended_action", "N/A")

        # Risk assessment
        financial_crime    = risk_assessment.get("financial_crime_risk", "N/A")
        regulatory_risk    = risk_assessment.get("regulatory_compliance_risk", "N/A")
        reputational_risk  = risk_assessment.get("reputational_risk", "N/A")
        sanctions_risk     = risk_assessment.get("sanctions_risk", "N/A")
        litigation_risk    = risk_assessment.get("litigation_risk", "N/A")
        overall_risk_score = risk_assessment.get("overall_risk_score", 0)
        risk_factors       = risk_assessment.get("risk_factors") or []

        # Detailed findings
        l1_sanctions       = detailed.get("layer1_sanctions") or []
        l2_legal           = detailed.get("layer2_legal_regulatory") or []
        l3_osint           = detailed.get("layer3_osint_media") or []

        # Entity network
        assoc_companies    = entity_network.get("associated_companies") or []
        assoc_persons      = entity_network.get("associated_persons") or []
        beneficial_owners  = entity_network.get("beneficial_owners_identified") or []
        related_adverse    = entity_network.get("related_entities_in_adverse_actions") or []

        # -- Helper: promoterList --
        if isinstance(promoters, list):
            def _fmt_p(p):
                if isinstance(p, dict):
                    name = p.get("name") or p.get("full_name") or "Unknown"
                    role = p.get("role") or "Unknown Role"
                    return f"{name} ({role})"
                return str(p)
            promoter_list = ", ".join(_fmt_p(p) for p in promoters)
        elif isinstance(promoters, str):
            promoter_list = promoters
        else:
            promoter_list = "Not Available"

        # -- Helper: Risk Level --
        risk_map = {
            'Low': '🟢 Low',
            'Moderate': '🟡 Moderate',
            'High': '🔴 High',
            'Critical': '🔴 Critical'
        }
        formatted_risk = risk_map.get(risk_level, risk_level)

        # -- Helper: Action Badge --
        badge_map = {
            'proceed': '✅ Proceed',
            'proceed_with_caution': '⚠️ Proceed with Caution',
            'enhanced_due_diligence': '🔍 Enhanced Due Diligence Required',
            'enhanced_monitoring_and_verification': '🔍 Enhanced Monitoring & Verification',
            'do_not_proceed': '❌ Do Not Proceed'
        }
        action_badge = badge_map.get(str(recommended_action).lower(), recommended_action)

        # -- Helper: Legal Section --
        def generate_legal_section(items):
            if not items:
                return "**Result:** No legal or regulatory enforcement actions found.\n\n"
            md = ""
            for item in items:
                authority      = item.get("authority", "Unknown Authority")
                document_id    = item.get("document_id") or item.get("case_id") or "N/A"
                document_type  = item.get("document_type", "Legal Document")
                date_of_order  = item.get("date_of_order", "N/A")
                summary        = item.get("summary", "No summary available")
                case_status    = item.get("case_status", "Unknown")
                final_judgment = item.get("final_judgment", "Not determined")
                
                import re # Import re locally if not already imported globally
                doc_anchor = re.sub(r"[^\w]", "-", str(document_id))
                md += f"#### ⚖️ {document_type}\n\n"
                md += f"**Authority:** {authority}\n\n"
                md += f"**Document ID:** [{document_id}](#{doc_anchor})\n\n"
                md += f"**Date:** {date_of_order}\n\n"
                md += f"**Summary:** {summary}\n\n"
                md += f"**Status:** {case_status}\n\n"
                md += f"**Judgment:** {final_judgment}\n\n"
                
                entities = item.get("entities_mentioned", [])
                if entities and isinstance(entities, list):
                    md += "**Entities Mentioned:**\n"
                    for e in entities:
                        md += f"- {e}\n"
                    md += "\n"
                md += "---\n\n"
            return md

        # -- Helper: Media Section --
        def generate_media_section(items):
            if not items:
                return "**Result:** No adverse media coverage found.\n\n"
            md = ""
            for item in items:
                source    = item.get("source", "Unknown Source")
                date      = item.get("date", "N/A")
                summary   = item.get("summary", "No summary available")
                relevance = item.get("relevance", "N/A")
                md += f"#### 📰 {source}\n\n"
                md += f"**Date:** {date}\n\n"
                md += f"**Content:** {summary}\n\n"
                md += f"**Relevance:** {relevance}\n\n"
                md += "---\n\n"
            return md

        # -- Helper: formatPersonWithIdentifiers --
        def format_person(person):
            if isinstance(person, str): return person
            name = person.get("name")
            if not name: return str(person)
            fmt = f"**{name}**"
            if person.get("role"): fmt += f" - {person['role']}"
            fmt += "\n"
            identifiers = person.get("identifiers") or {}
            if isinstance(identifiers, dict):
                for k, v in identifiers.items():
                    if v and k != 'role_source':
                        fmt += f"- {k}: {v}\n"
            return fmt

        # -- Helper: formatCompanyWithRelationship --
        def format_company(co):
            if isinstance(co, str): return co
            name = co.get("name")
            if not name: return str(co)
            fmt = f"**{name}**"
            if co.get("relationship"): fmt += f" - {co['relationship']}"
            fmt += "\n"
            if co.get("notes"): fmt += f"  *{co['notes']}*\n"
            return fmt

        # -- Prepare list-based strings for f-string compatibility (No backslashes in f-string expressions) --
        l1_sanctions_str = "\n".join(f"- **{i.get('list_name', 'Unknown List')}**: {i.get('summary', 'No details')}" for i in l1_sanctions) if l1_sanctions else "✅ **Result:** No sanctions or international debarment records found.\n"
        
        risk_factors_md = ""
        if risk_factors:
            factors_list = "\n".join(f"- {f}" for f in risk_factors)
            risk_factors_md = f"\n### Contributing Risk Factors\n\n{factors_list}"

        # -- Build Report --
        confidence_pct = int(round(float(confidence_overall) * 100))
        jurisdictions_str = ", ".join(jurisdictions) if jurisdictions else "N/A"

        markdown_report = f"""# Compliance Investigation Report

## Executive Summary

| Field | Value |
|-------|-------|
| **Company** | {company} |
| **Investigation Date** | {investigation_date} |
| **Adverse Flag** | {"⚠️ YES" if adverse_flag else "✅ NO"} |
| **Overall Risk Level** | {formatted_risk} |
| **Confidence Score** | {confidence_pct}% |
| **Recommended Action** | {action_badge} |

### Key Findings

{key_findings}

**Promoters/Key Persons:** {promoter_list}

---

## Red Flags Summary

| Category | Count |
|----------|-------|
| Sanctions/Debarments | {red_flags_count.get("sanctions", 0)} |
| Enforcement Actions | {red_flags_count.get("enforcement_actions", 0)} |
| Criminal Cases | {red_flags_count.get("criminal_cases", 0)} |
| High-Risk Media | {red_flags_count.get("high_risk_media", 0)} |

---

## Investigation Scope

**Jurisdictions Searched:** {jurisdictions_str}

**Total Sources Checked:** {total_sources}

---

## Detailed Findings

### Layer 1: Sanctions & International Debarment Lists

{l1_sanctions_str}

---

### Layer 2: Legal & Regulatory Actions

{generate_legal_section(l2_legal)}

---

### Layer 3: OSINT & Media Intelligence

{generate_media_section(l3_osint)}

---

## Multi-Dimensional Risk Assessment

### Risk Ratings

| Risk Category | Assessment |
|---|---|
| **Financial Crime Risk** | {financial_crime} |
| **Regulatory Compliance Risk** | {regulatory_risk} |
| **Reputational Risk** | {reputational_risk} |
| **Sanctions Risk** | {sanctions_risk} |
| **Litigation Risk** | {litigation_risk} |

**Overall Risk Score:** {overall_risk_score}/10 ({formatted_risk})

{risk_factors_md}

---
"""

        # Entity Network section (Conditional)
        if any([assoc_companies, assoc_persons, beneficial_owners, related_adverse]):
            assoc_cos_str = "\n".join(format_company(c) for c in assoc_companies) if assoc_companies else "No associated companies identified."
            assoc_pers_str = "\n".join(format_person(p) for p in assoc_persons) if assoc_persons else "No associated persons identified."
            
            beneficial_owners_str = "No beneficial owners identified."
            if beneficial_owners:
                beneficial_owners_str = "\n".join(("- " + o) if isinstance(o, str) else (f"- **{o.get('name', 'Unknown')}**: {o.get('ownership', 'Ownership stake identified')}") for o in beneficial_owners)
                
            related_adverse_str = "No entities identified in adverse actions."
            if related_adverse:
                related_adverse_str = "\n".join(("- " + e) if isinstance(e, str) else (f"- **{e.get('entity', 'Unknown')}**: {e.get('adverse_action', 'Adverse action identified')}") for e in related_adverse)

            markdown_report += f"""
## Entity Network & Relationships

### Associated Companies

{assoc_cos_str}

---

### Associated Persons & Key Personnel

{assoc_pers_str}

---

### Beneficial Owners

{beneficial_owners_str}

---

### Entities in Adverse Actions

{related_adverse_str}

---
"""

        # Recommendations & Next Steps
        next_steps_str = "\n\n".join(f"{i+1}. {step}" for i, step in enumerate(next_steps)) if next_steps else "No specific recommendations at this time."
        
        # Gaps
        gaps_str = "\n".join(f"- **Note:** {gap}" for gap in gaps) if gaps else "- No significant gaps identified."

        markdown_report += f"""
## Recommendations & Next Steps

{next_steps_str}

---

## Investigation Gaps & Limitations

{gaps_str}

---

## Disclaimer

> **⚠️ Important Notice:** This report was generated using automated OSINT, open-source regulatory databases, and publicly available information. All findings should be independently verified through official channels and licensed compliance providers before making any material business decisions. This report does not constitute legal, financial, or investment advice.

**For questions or clarifications, refer to original source documents and official regulatory authorities in relevant jurisdictions.**
"""
        return markdown_report

    def _format_research_items(self, items: List[Any], category: str) -> str:
        """Legacy helper kept for backward compat — only used by old code paths."""
        if not items or not isinstance(items, list):
            return f" No {category.lower()} records found\n"
        md = ""
        for item in items:
            if not isinstance(item, dict):
                md += f"- {str(item)}\n"
                continue
            summary = item.get("summary", item.get("snippet", "N/A"))
            md += f"- {summary}\n"
            md += "---\n\n"
        return md

    def replace_section_content(
        self,
        full_markdown: str,
        section_header_to_find: str,
        new_content: str
    ) -> str:
        """
        Replaces the content of a specific section with new content.
        Keeps the header, but replaces everything until the next SECTION header.
        """
        if not full_markdown or not section_header_to_find or not new_content:
            return full_markdown

        # 1. Find the target section header
        clean_header = re.escape(section_header_to_find).replace(r'\ ', r'\s+')
        pattern = rf'(^#{{1,4}}\s+.*{clean_header}.*$)'
        match = re.search(pattern, full_markdown, re.IGNORECASE | re.MULTILINE)
        
        if not match:
            # If not found, just append (fallback)
            return full_markdown + f"\n\n## {section_header_to_find} (RECOVERED)\n\n{new_content}"

        header_end = match.end()
        
        # 2. Find the start of the NEXT section (next header starting with #)
        # We look for the next line starting with # after the current header
        remaining_text = full_markdown[header_end:]
        next_header_match = re.search(r'^#+.*SECTION\s+', remaining_text, re.MULTILINE | re.IGNORECASE)
        
        if next_header_match:
            next_header_start = header_end + next_header_match.start()
            return full_markdown[:header_end] + "\n\n" + new_content.strip() + "\n\n" + full_markdown[next_header_start:]
        else:
            # If it's the last section, replace everything until end
            return full_markdown[:header_end] + "\n\n" + new_content.strip() + "\n"

    def insert_markdown_before_section(
        self,
        full_markdown: str,
        insert_markdown: str,
        section_header: str,
        section_label: str
    ) -> str:
        """
        Inserts markdown content before a specific section.
        Replicates: combine FULL MDN summary node logic
        
        Args:
            full_markdown: Complete markdown document
            insert_markdown: Markdown to insert
            section_header: Section header to find (e.g., "SECTION VII: FINANCIAL PERFORMANCE")
            section_label: Label for inserted section
        
        Returns:
            Modified markdown with inserted content
        """
        if not full_markdown or not isinstance(full_markdown, str):
            return full_markdown or ""
        
        if not insert_markdown or not isinstance(insert_markdown, str) or not insert_markdown.strip():
            return full_markdown
        
        # 1. Primary Strategy: Try to find exactly what was requested (e.g., "SECTION VII")
        clean_header = re.escape(section_header).replace(r'\ ', r'\s+')
        primary_pattern = rf'(^#{{1,4}}\s+.*{clean_header}.*$)'
        match = re.search(primary_pattern, full_markdown, re.IGNORECASE | re.MULTILINE)
        
        # 2. Secondary Strategy: If looking for VII, also try SECTION 7 or common alternate names
        if not match and "SECTION VII" in section_header.upper():
            # Try matching "SECTION 7" or "7. " or "FINANCIAL PERFORMANCE"
            alternates = [r'SECTION\s+7', r'^#+\s+7[\.\s]', r'FINANCIAL\s+PERFORMANCE']
            for alt in alternates:
                alt_pattern = rf'(^#{{1,4}}\s+.*{alt}.*$)'
                match = re.search(alt_pattern, full_markdown, re.IGNORECASE | re.MULTILINE)
                if match: break

        # 3. Tertiary Strategy: Just look for any numbered header after the current one if applicable
        # (Omitted for safety/simplicity unless purely sequential)

        if match:
            insertion_point = match.start()
            # Surround with some spacing and horizontal rules for clarity
            insertion_content = f"\n\n---\n\n## {section_label}\n\n{insert_markdown.strip()}\n\n---\n\n"
            return full_markdown[:insertion_point] + insertion_content + full_markdown[insertion_point:]
        else:
            # 4. Fallback: If section not found, append at end of document
            # Log it so we know it fell back (stdout goes to celery logs)
            print(f"DEBUG: Could not find insertion point for {section_header}, appending at end.")
            insertion_content = f"\n\n---\n\n## {section_label}\n\n{insert_markdown.strip()}\n"
            return full_markdown + insertion_content


    def assemble_final_summary(
        self,
        sections: Dict[str, str],
        doc_type: str = "DRHP",
        company_name: str = "Company"
    ) -> str:
        """
        Assembles all 12 sections into a single markdown document in sequential order.
        
        sections: Dictionary containing markdown for each section (e.g. {'sec1_2': '...', 'sec3': '...'})
        """
        order = [
            'sec1_2',    # SECTION I & II
            'sec3',      # SECTION III
            'sec4_5',    # SECTION IV & V
            'sec6',      # SECTION VI
            'sec7',      # SECTION VII
            'sec8_9',    # SECTION VIII & IX
            'sec10',     # SECTION X
            'sec11_12'   # SECTION XI & XII
        ]
        
        final_md_parts = []
        
        # Add Header
        final_md_parts.append(f"# {doc_type} Summary: {company_name}")
        
        for key in order:
            content = sections.get(key, "").strip()
            if content:
                final_md_parts.append(content)
        
        # Join with horizontal rules
        return "\n\n---\n\n".join(final_md_parts)


# Singleton instance
markdown_converter = MarkdownConverter()
