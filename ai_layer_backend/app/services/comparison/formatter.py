"""
Comparison Formatter for DRHP vs RHP.
Replicates n8n 'mdn to html5' node logic.
"""
import re

class ComparisonFormatter:
    def __init__(self):
        self.css = """
        <style>
          /* Reset and base styles */
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }
          
          body { 
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
            font-size: 13px;
            line-height: 1.1; 
            color: #1a1a1a;
            background: #ffffff;
            margin: 0;
            padding: 15px;
            max-width: 210mm; /* A4 width */
            margin: 0 auto;
          }
          
          .content {
            width: 100%;
          }
          
          /* Headings */
          h1, h2, h3 { 
            color: #0f172a;
            font-weight: 600;
            margin: 20px 0 12px 0;
            page-break-after: avoid;
            line-height: 1.3;
          }
          
          h1 { 
            font-size: 20px;
            border-bottom: 2px solid #1e40af;
            padding-bottom: 8px;
            margin-bottom: 16px;
            color: #1e40af;
          }
          
          h2 { 
            font-size: 16px;
            border-bottom: 1px solid #64748b;
            padding-bottom: 4px;
            margin-bottom: 12px;
            color: #334155;
          }
          
          h3 { 
            font-size: 14px;
            margin-bottom: 8px;
            color: #475569;
          }
          
          /* Paragraphs */
          p { 
            margin: 6px 0 10px 0;
            text-align: justify;
            hyphens: auto;
            line-height: 1.6;
          }
          
          /* Lists */
          ul, ol { 
            margin: 5px 0;
            padding-left: 18px;
          }
          
          li { 
            margin: 0px 0;
            line-height: 1.5;
          }
          
          /* Tables */
          .data-table { 
            border-collapse: collapse; 
            width: 100%; 
            margin: 16px 0 20px 0;
            font-size: 11px;
            background: white;
            border: 1px solid #374151;
            page-break-inside: avoid;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
          }
          
          .data-table th { 
            border: 1px solid #374151;
            padding: 8px 6px;
            text-align: left; 
            background: linear-gradient(135deg, #f1f5f9 0%, #e2e8f0 100%);
            font-weight: 700;
            color: #1e293b;
            vertical-align: top;
            font-size: 9px;
            position: sticky;
            top: 0;
          }
          
          .data-table td { 
            border: 1px solid #374151;
            padding: 6px 5px;
            text-align: left;
            vertical-align: top;
            background: white;
            font-size: 9px;
          }
          
          .data-table tbody tr:nth-child(even) td {
            background: #f8fafc;
          }
          
          .amount { font-weight: 600; color: #059669; }
          .percentage { font-weight: 600; color: #dc2626; }
          .currency { font-weight: 600; color: #059669; }
          strong { color: #1e40af; font-weight: 700; }
          
          hr {
            border: none;
            border-top: 1px solid #d1d5db;
            margin: 20px 0;
          }
        </style>
        """

    def markdown_to_html(self, markdown_text: str) -> str:
        html = markdown_text
        
        # Normalize line endings
        html = html.replace('\r\n', '\n')
        html = re.sub(r'\n{3,}', '\n\n', html)
        
        # Tables
        def table_replacer(match):
            prefix = match.group(1)
            table_block = match.group(2)
            lines = [l.strip() for l in table_block.strip().split('\n') if l.strip() and '|' in l]
            
            if len(lines) < 2: return match.group(0)
            
            table_html = '<table class="data-table">'
            header_processed = False
            
            for line in lines:
                if re.match(r'^\|[-\s|:]*\|$', line): continue
                
                cells = [c.strip() for c in line.split('|') if c.strip()]
                if not cells: continue
                
                if not header_processed:
                    header_cells = "".join([f"<th>{re.sub(r'\*\*(.*?)\*\*', r'<strong>\1</strong>', c)}</th>" for c in cells])
                    table_html += f"<thead><tr>{header_cells}</tr></thead><tbody>"
                    header_processed = True
                else:
                    data_cells = ""
                    for cell in cells:
                        clean = cell
                        clean = re.sub(r'\*\*(.*?)\*\*', r'<strong>\1</strong>', clean)
                        clean = re.sub(r'\*(.*?)\*', r'<em>\1</em>', clean)
                        clean = re.sub(r'`([^`]+)`', r'<code>\1</code>', clean)
                        # Specific formatting from n8n node
                        clean = re.sub(r'(\d+\.?\d*)\s*%', r'<span class="percentage">\1%</span>', clean)
                        clean = re.sub(r'₹\s*(\d+(?:,\d+)*(?:\.\d+)?)', r'<span class="currency">₹\1</span>', clean)
                        data_cells += f"<td>{clean}</td>"
                    table_html += f"<tr>{data_cells}</tr>"
            
            table_html += "</tbody></table>"
            return prefix + table_html

        html = re.sub(r'(\n|^)(\|.+\|\s*\n(?:\|.+\|\s*\n)*)', table_replacer, html)
        
        # Headers
        html = re.sub(r'^### (.*$)', r'<h3>\1</h3>', html, flags=re.MULTILINE)
        html = re.sub(r'^## (.*$)', r'<h2>\1</h2>', html, flags=re.MULTILINE)
        html = re.sub(r'^# (.*$)', r'<h1>\1</h1>', html, flags=re.MULTILINE)
        
        # Bold and Italic
        html = re.sub(r'\*\*\*(.*?)\*\*\*', r'<strong><em>\1</em></strong>', html, flags=re.IGNORECASE | re.MULTILINE)
        html = re.sub(r'\*\*(.*?)\*\*', r'<strong>\1</strong>', html, flags=re.IGNORECASE | re.MULTILINE)
        html = re.sub(r'\*(.*?)\*', r'<em>\1</em>', html, flags=re.IGNORECASE | re.MULTILINE)
        
        # Horizontal rules
        html = re.sub(r'^---\s*$', r'<hr>', html, flags=re.MULTILINE)
        
        # Lists
        def bullet_list_replacer(match):
            indent = match.group(1)
            content = match.group(2)
            level = len(indent) // 2
            return f"<li>{content}</li>"

        html = re.sub(r'^(\s*)[-*] (.+$)', bullet_list_replacer, html, flags=re.MULTILINE)
        
        # Wrap consecutive list items
        html = re.sub(r'(<li>.*?</li>)(\s*<li>.*?</li>)*', r'<ul>\0</ul>', html, flags=re.DOTALL)
        
        # Financial formatting
        html = re.sub(r'₹\s*(\d+(?:,\d+)*(?:\.\d+)?)\s*(Cr|crore|crores)', r'<span class="amount">₹\1 \2</span>', html, flags=re.IGNORECASE)
        html = re.sub(r'(\d+\.?\d*)\s*%', r'<span class="percentage">\1%</span>', html)
        
        # Paragraphs
        html = re.sub(r'\n\n+', r'</p><p>', html)
        html = re.sub(r'\n', r'<br>', html)
        
        if not html.startswith('<'):
            html = '<p>' + html + '</p>'
            
        html = html.replace('<p></p>', '')
        # Clean up empty tags and nesting issues
        html = re.sub(r'<p>(<(?:h[1-6]|hr|table|ul|ol))', r'\1', html)
        html = re.sub(r'(</(?:h[1-6]|hr|table|ul|ol)>)</p>', r'\1', html)
        
        return f"""
<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>RHP vs DRHP Comparison Report</title>
    {self.css}
  </head>
  <body>
    <div class="content">
      {html}
    </div>
  </body>
</html>
"""

comparison_formatter = ComparisonFormatter()
