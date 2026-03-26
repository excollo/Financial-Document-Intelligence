/**
 * Markdown to HTML converter utility
 * Converts markdown content to HTML for rendering in the summary panel
 */

export function markdownToHtml(markdown: string): string {
    if (!markdown) return "";

    // Handle literal escaped newlines (e.g. from JSON response)
    // Double backslash means we look for literal '\n' characters
    let html = markdown.replace(/\\n/g, "\n").replace(/\\r\\n/g, "\n").replace(/\\r/g, "\n").replace(/\\"/g, '"');




    // Headers
    html = html.replace(/^### (.*$)/gim, "<h3>$1</h3>");
    html = html.replace(/^## (.*$)/gim, "<h2>$1</h2>");
    html = html.replace(/^# (.*$)/gim, "<h1>$1</h1>");

    // Bold
    html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/__(.+?)__/g, "<strong>$1</strong>");

    // Italic
    html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");
    html = html.replace(/_(.+?)_/g, "<em>$1</em>");

    // Links
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

    // Images
    html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" />');

    // Code blocks
    html = html.replace(/```(\w+)?\n([\s\S]*?)```/g, (match, lang, code) => {
        return `<pre><code class="language-${lang || 'plaintext'}">${code.trim()}</code></pre>`;
    });

    // Inline code
    html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

    // Tables
    html = convertMarkdownTables(html);

    // Horizontal rules
    html = html.replace(/^---$/gim, "<hr>");
    html = html.replace(/^\*\*\*$/gim, "<hr>");

    // Unordered lists
    html = convertUnorderedLists(html);

    // Ordered lists
    html = convertOrderedLists(html);

    // Blockquotes
    html = html.replace(/^> (.+)$/gim, "<blockquote>$1</blockquote>");

    // Line breaks (preserve double newlines as paragraphs)
    html = html.replace(/\n\n/g, "</p><p>");
    html = html.replace(/\n/g, "<br>");

    // Wrap in paragraph tags if not already wrapped
    if (!html.startsWith("<")) {
        html = `<p>${html}</p>`;
    }

    return html;
}

function convertMarkdownTables(markdown: string): string {
    const tableRegex = /(\|.+\|\n)+/g;

    return markdown.replace(tableRegex, (match) => {
        const rows = match.trim().split("\n");
        if (rows.length < 2) return match;

        let html = '<table class="markdown-table">\n';

        // Header row
        const headerCells = rows[0].split("|").filter(cell => cell.trim());
        html += "  <thead>\n    <tr>\n";
        headerCells.forEach(cell => {
            html += `      <th>${cell.trim()}</th>\n`;
        });
        html += "    </tr>\n  </thead>\n";

        // Skip separator row (row 1)
        // Body rows
        if (rows.length > 2) {
            html += "  <tbody>\n";
            for (let i = 2; i < rows.length; i++) {
                const cells = rows[i].split("|").filter(cell => cell.trim());
                if (cells.length > 0) {
                    html += "    <tr>\n";
                    cells.forEach(cell => {
                        html += `      <td>${cell.trim()}</td>\n`;
                    });
                    html += "    </tr>\n";
                }
            }
            html += "  </tbody>\n";
        }

        html += "</table>\n";
        return html;
    });
}

function convertUnorderedLists(markdown: string): string {
    const lines = markdown.split("\n");
    let html = "";
    let inList = false;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const match = line.match(/^[\s]*[-*+] (.+)$/);

        if (match) {
            if (!inList) {
                html += "<ul>\n";
                inList = true;
            }
            html += `  <li>${match[1]}</li>\n`;
        } else {
            if (inList) {
                html += "</ul>\n";
                inList = false;
            }
            html += line + "\n";
        }
    }

    if (inList) {
        html += "</ul>\n";
    }

    return html;
}

function convertOrderedLists(markdown: string): string {
    const lines = markdown.split("\n");
    let html = "";
    let inList = false;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const match = line.match(/^[\s]*\d+\. (.+)$/);

        if (match) {
            if (!inList) {
                html += "<ol>\n";
                inList = true;
            }
            html += `  <li>${match[1]}</li>\n`;
        } else {
            if (inList) {
                html += "</ol>\n";
                inList = false;
            }
            html += line + "\n";
        }
    }

    if (inList) {
        html += "</ol>\n";
    }

    return html;
}

/**
 * Detects if content is markdown or HTML
 */
export function isMarkdown(rawContent: string): boolean {
    if (!rawContent) return false;

    // Normalize content by unescaping newlines
    const content = rawContent.replace(/\\n/g, "\n");

    // Check for common markdown patterns
    const markdownPatterns = [
        /^#{1,6}\s/m,           // Headers
        /\*\*.*\*\*/,           // Bold
        /\[.*\]\(.*\)/,         // Links
        /^\s*[-*+]\s/m,         // Unordered lists
        /^\s*\d+\.\s/m,         // Ordered lists
        /^\|.*\|$/m,            // Tables
        /```[\s\S]*?```/,       // Code blocks
    ];

    // Check for HTML tags
    const hasHtmlTags = /<[^>]+>/.test(content);

    // If it has HTML tags, it's likely HTML
    if (hasHtmlTags && !content.includes("```")) {
        return false;
    }

    // Check if it matches markdown patterns
    return markdownPatterns.some(pattern => pattern.test(content));
}

/**
 * Cleanup function to remove literal escaped newlines and other artifacts
 * Call this BEFORE rendering
 */
export function cleanSummaryContent(text: string): string {
    if (!text) return "";
    return text
        .replace(/\\n/g, "\n")
        .replace(/\\r/g, "")
        .replace(/\\t/g, "\t")
        .replace(/\\"/g, '"')
        .replace(/^\s+/, "") // Trim start
        .trim();
}
