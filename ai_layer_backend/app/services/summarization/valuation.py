"""
Valuation service for calculating investment rounds and dilutions.
Ported from n8n nodes Code17 and Code18.
"""
from typing import List, Dict, Any

class ValuationService:
    @staticmethod
    def calculate_premium_rounds(premium_rounds: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Calculates valuation metrics for each identified premium round.
        """
        results = []
        for round_data in premium_rounds:
            shares = float(round_data.get("shares_allotted", 0))
            price = float(round_data.get("issue_price", 0))
            total_shares = float(round_data.get("cumulative_equity_shares", 0))
            
            if shares > 0 and price > 0 and total_shares > 0:
                round_raised = shares * price
                dilution = shares / total_shares
                post_money = round_raised / dilution if dilution > 0 else 0
                
                results.append({
                    **round_data,
                    "round_raised": round_raised,
                    "dilution": dilution,
                    "dilution_percent": dilution * 100,
                    "post_money_valuation": post_money
                })
        return results

    @staticmethod
    def generate_valuation_markdown(calculated_rounds: List[Dict[str, Any]]) -> str:
        """
        Generates markdown tables for the valuation analysis to be used in LLM prompts.
        """
        if not calculated_rounds:
            return "No premium rounds found for this company."

        md = ""
        for i, r in enumerate(calculated_rounds):
            md += f"\n#### Premium Round {i + 1}\n\n"
            md += "| Field | Value |\n"
            md += "|-------|-------|\n"
            md += f"| Row | {r.get('row_number', '-')} |\n"
            md += f"| Date of Allotment | {r.get('date_of_allotment', '-')} |\n"
            md += f"| Nature of Allotment | {r.get('nature_of_allotment', '-')} |\n"
            md += f"| Shares Allotted | {r.get('shares_allotted', '-')} |\n"
            md += f"| Face Value (₹) | {r.get('face_value', '-')} |\n"
            md += f"| Issue Price (₹) | {r.get('issue_price', '-')} |\n"
            md += f"| Cumulative Equity Shares | {r.get('cumulative_equity_shares', '-')} |\n"
            md += f"| Round Raised (₹) | {r.get('round_raised', '-')} |\n"
            md += f"| Dilution | {r.get('dilution', '-')} |\n"
            md += f"| Dilution (%) | {r.get('dilution_percent', '-'):.2f}% |\n"
            md += f"| Post Money Valuation (₹) | {r.get('post_money_valuation', '-'):.2f} |\n\n"
        return md

    @staticmethod
    def generate_valuation_html(calculated_rounds: List[Dict[str, Any]]) -> str:
        """
        Generates premium HTML tables for the valuation analysis.
        Matches the style and format from the user's n8n node.
        """
        if not calculated_rounds:
            return """
            <div style="padding: 15px; background: #fffcf0; border: 1px solid #fef3c7; border-radius: 8px; margin-top: 20px;">
                <h4 style="margin: 0; color: #92400e; font-family: Arial, sans-serif;">ℹ️ No premium rounds found. Valuation of the company has not increased.</h4>
            </div>
            """

        html = ""
        for i, r in enumerate(calculated_rounds):
            # Helper to format numbers safely
            def f_num(val):
                try:
                    if val is None or val == "": return "-"
                    if isinstance(val, str):
                        val = float(val.replace(',', ''))
                    return "{:,.2f}".format(float(val)).rstrip('0').rstrip('.')
                except:
                    return str(val)

            html += f"""
            <div style="margin-bottom: 30px; font-family: Arial, sans-serif;">
                <h3 style="color: #333; margin-bottom: 15px;">Premium Round {i + 1}</h3>
                <table border="1" cellpadding="5" cellspacing="0" style="border-collapse: collapse; width: 100%; border: 1px solid #e5e7eb;">
                    <thead style="background-color: #f9fafb;">
                        <tr>
                            <th style="text-align: left; padding: 12px; border: 1px solid #e5e7eb; color: #374151;">Field</th>
                            <th style="text-align: left; padding: 12px; border: 1px solid #e5e7eb; color: #374151;">Value</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr><td style="padding: 10px; border: 1px solid #e5e7eb; color: #4b5563;">Row</td><td style="padding: 10px; border: 1px solid #e5e7eb; font-weight: 600;">{r.get('row_number', '-')}</td></tr>
                        <tr><td style="padding: 10px; border: 1px solid #e5e7eb; color: #4b5563;">Date of Allotment</td><td style="padding: 10px; border: 1px solid #e5e7eb; font-weight: 600;">{r.get('date_of_allotment', '-')}</td></tr>
                        <tr><td style="padding: 10px; border: 1px solid #e5e7eb; color: #4b5563;">Nature of Allotment</td><td style="padding: 10px; border: 1px solid #e5e7eb;">{r.get('nature_of_allotment', '-')}</td></tr>
                        <tr><td style="padding: 10px; border: 1px solid #e5e7eb; color: #4b5563;">Shares Allotted</td><td style="padding: 10px; border: 1px solid #e5e7eb;">{f_num(r.get('shares_allotted'))}</td></tr>
                        <tr><td style="padding: 10px; border: 1px solid #e5e7eb; color: #4b5563;">Face Value (₹)</td><td style="padding: 10px; border: 1px solid #e5e7eb;">{f_num(r.get('face_value'))}</td></tr>
                        <tr><td style="padding: 10px; border: 1px solid #e5e7eb; color: #4b5563;">Issue Price (₹)</td><td style="padding: 10px; border: 1px solid #e5e7eb; font-weight: 700; color: #b45309;">{f_num(r.get('issue_price'))}</td></tr>
                        <tr><td style="padding: 10px; border: 1px solid #e5e7eb; color: #4b5563;">Cumulative Equity Shares</td><td style="padding: 10px; border: 1px solid #e5e7eb;">{f_num(r.get('cumulative_equity_shares'))}</td></tr>
                        <tr style="background-color: #fdfdfd;"><td style="padding: 10px; border: 1px solid #e5e7eb; color: #4b5563;">Round Raised (₹)</td><td style="padding: 10px; border: 1px solid #e5e7eb; font-weight: 600;">{f_num(r.get('round_raised'))}</td></tr>
                        <tr><td style="padding: 10px; border: 1px solid #e5e7eb; color: #4b5563;">Dilution</td><td style="padding: 10px; border: 1px solid #e5e7eb;">{r.get('dilution', '-')}</td></tr>
                        <tr><td style="padding: 10px; border: 1px solid #e5e7eb; color: #4b5563;">Dilution (%)</td><td style="padding: 10px; border: 1px solid #e5e7eb; font-weight: 700; color: #059669;">{f_num(r.get('dilution_percent'))}%</td></tr>
                        <tr style="background-color: #fffef2;"><td style="padding: 10px; border: 1px solid #e5e7eb; font-weight: 700; color: #1e293b;">Post Money Valuation (₹)</td><td style="padding: 10px; border: 1px solid #e5e7eb; font-weight: 800; color: #111827;">{f_num(r.get('post_money_valuation'))}</td></tr>
                    </tbody>
                </table>
            </div>
            """
        return html

valuation_service = ValuationService()
