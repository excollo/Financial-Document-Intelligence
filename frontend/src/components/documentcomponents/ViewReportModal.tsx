import React, { useEffect, useState, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { reportService } from "@/services/api";
import { cleanSummaryContent } from "@/lib/utils/markdownConverter";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";

import { FileText, Printer } from "lucide-react";

import { toast } from "sonner";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "@/components/ui/tooltip";

interface ViewReportModalProps {
  reportId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
}

const buildDocxFileName = (
  rawName: string | undefined,
  fallback: string
): string => {
  const normalized = (rawName || fallback)
    .trim()
    .replace(/\.(pdf|docx)$/i, "")
    .replace(/[\\/:*?"<>|]+/g, "_");

  return `${normalized || fallback}.docx`;
};

// Utility to strip <style> tags from HTML
function stripStyleTags(html: string): string {
  return html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
}

// Convert plain URLs and emails in HTML to clickable links
function linkifyHtml(html: string): string {
  if (!html) return html;
  const emailRegex = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;
  const urlRegex = /(?:(https?:\/\/)|\bwww\.)[\w.-]+(?:\.[\w.-]+)+(?:[\w\-._~:/?#\[\]@!$&'()*+,;=%]*)/g;

  let out = html.replace(emailRegex, (m) => `<a href="mailto:${m}">${m}</a>`);
  out = out.replace(urlRegex, (m) => {
    const hasProtocol = m.startsWith("http://") || m.startsWith("https://");
    const href = hasProtocol ? m : `http://${m}`;
    return `<a href="${href}" target="_blank" rel="noopener noreferrer">${m}</a>`;
  });
  return out;
}

// Helper function to prepare content for ReactMarkdown
const prepareContent = (content: string) => {
  if (!content) return "";
  const cleaned = cleanSummaryContent(content);
  return linkifyHtml(stripStyleTags(cleaned));
};

export const ViewReportModal: React.FC<ViewReportModalProps> = ({ reportId, open, onOpenChange, title }) => {
  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const load = async () => {
      if (!reportId || !open) return;
      setLoading(true);
      try {
        // `getAll()` is metadata-only (no `content`), so we must fetch by id for the full report.
        const report = await reportService.getById(reportId);
        setContent(report?.content || "");
      } catch {
        toast.error("Failed to load report content");
        setContent("");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [reportId, open]);

  const handleDownloadDocx = async () => {
    if (!reportId) {
      toast.error("No report selected");
      return;
    }
    let loadingToast;
    try {
      loadingToast = toast.loading("Download processing...");
      const blob = await reportService.downloadDocx(reportId);

      if (blob.type && blob.type !== "application/vnd.openxmlformats-officedocument.wordprocessingml.document" && blob.type !== "application/octet-stream") {
        const text = await blob.text();
        let errorData;
        try {
          errorData = JSON.parse(text);
          throw new Error(errorData.message || errorData.error || "DOCX generation service unavailable");
        } catch (parseError) {
          throw new Error("Invalid DOCX response from server");
        }
      }

      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = buildDocxFileName(title, "report");
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      toast.dismiss(loadingToast);
      toast.success("Report DOCX downloaded successfully");
    } catch (error: any) {
      toast.dismiss(loadingToast);
      const errorMessage = error?.message || "Failed to download DOCX";
      toast.error(errorMessage);
    }
  };

  const handlePrintReport = () => {
    if (contentRef.current) {
      const printWindow = window.open("", "", "width=900,height=650");
      if (printWindow) {
        printWindow.document.write(`
          <html>
            <head>
              <title>Print Report - ${title || "Report"}</title>
              <style>
                body { font-family: sans-serif; margin: 0; padding: 2rem; }
                .report-content table {
                  border-collapse: collapse;
                  width: 100%;
                  border: 1px solid #d1d5de;
                  font-size: 13px;
                  background: #f1eada;
                }
                .report-content th, .report-content td {
                  border: 1px solid #d1d5de;
                  padding: 6px 8px;
                  text-align: left;
                }
                .report-content th {
                  background: #f1eada;
                  font-weight: 600;
                }
                .report-content tr:nth-child(even) td {
                  background: #f1eada;
                }
                .report-content h1, .report-content h2, .report-content h3, .report-content h4 { 
                  font-weight: 700; 
                  color: #1F2937; 
                  margin: 10px 0; 
                }
                .report-content b, .report-content strong { font-weight: 700; }
                .report-content hr { border: none; border-top: 1px solid #E5E7EB; margin: 12px 0; }
                .report-content a { color: #1d4ed8; text-decoration: underline; }
              </style>
            </head>
            <body>
              <div class="report-content">
                ${contentRef.current.innerHTML}
              </div>
            </body>
          </html>
        `);
        printWindow.document.close();
        printWindow.focus();
        printWindow.print();
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl max-h-[90vh] flex flex-col bg-white" onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <div className="flex items-center mt-5 justify-between">
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-blue-700" />
              {title || "Report"}
            </DialogTitle>
            <div className="flex gap-2 items-center">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      className="bg-white border border-border rounded-sm p-2 w-10 h-10 flex items-center justify-center hover:bg-gray-100 transition-colors text-foreground shadow-none"
                      onClick={handleDownloadDocx}
                      disabled={!reportId || loading}
                    >
                      <FileText className="h-6 w-6 text-blue-700" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Download DOCX file</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      className="bg-white border border-border rounded-sm p-2 w-10 h-10 flex items-center justify-center hover:bg-gray-100 transition-colors text-foreground shadow-none"
                      onClick={handlePrintReport}
                      disabled={!content || loading}
                    >
                      <Printer className="h-6 w-6 text-gray-700" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Print Report</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-auto bg-[#ECE9E2] rounded-lg p-6 my-4 border min-h-0">
          {loading ? (
            <div className="flex items-center justify-center h-full text-gray-500 italic">
              Loading content...
            </div>
          ) : !content ? (
            <div className="flex items-center justify-center h-full text-gray-500 italic">
              No report content found
            </div>
          ) : (
            <div ref={contentRef} className="report-content preview-html text-foreground/90 leading-relaxed max-w-none">
              <style>{`
                .preview-html table { border-collapse: collapse; width: 100%; margin: 12px 0; border: 1px solid #d1d5de; background: #ECE9E2; }
                .preview-html th, .preview-html td { border: 1px solid #d1d5de; padding: 6px 8px; text-align: left; }
                .preview-html th { background: #ECE9E2; font-weight: 600; }
                .preview-html tr:nth-child(even) td { background: #ECE9E2; }
                .preview-html h1, .preview-html h2, .preview-html h3, .preview-html h4 { font-weight: 700; color: #1F2937; margin: 10px 0; }
                .preview-html b, .preview-html strong { font-weight: 700; }
                .preview-html hr { border: none; border-top: 1px solid #E5E7EB; margin: 12px 0; }
                .preview-html a { color: #1d4ed8; text-decoration: underline; word-break: break-all; }
              `}</style>
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeRaw]}
                components={{
                  table: ({ node, ...props }) => (
                    <div className="overflow-x-auto rounded-lg border border-[#d1d5de] my-4 bg-white/50">
                      <table className="w-full text-sm text-left border-collapse" {...props} />
                    </div>
                  ),
                  thead: ({ node, ...props }) => <thead className="bg-[#ECE9E2] font-semibold" {...props} />,
                  tr: ({ node, ...props }) => <tr className="border-b border-[#d1d5de] hover:bg-black/5" {...props} />,
                  th: ({ node, ...props }) => <th className="px-4 py-2 border-r border-[#d1d5de] last:border-r-0" {...props} />,
                  td: ({ node, ...props }) => <td className="px-4 py-2 border-r border-[#d1d5de] last:border-r-0" {...props} />,
                  h1: ({ node, ...props }) => <h1 className="text-2xl font-bold my-4 text-[#1F2937]" {...props} />,
                  h2: ({ node, ...props }) => <h2 className="text-xl font-bold my-3 text-[#1F2937]" {...props} />,
                  h3: ({ node, ...props }) => <h3 className="text-lg font-bold my-2 text-[#1F2937]" {...props} />,
                  p: ({ node, ...props }) => <p className="mb-4 leading-relaxed whitespace-pre-wrap" {...props} />,
                  ul: ({ node, ...props }) => <ul className="list-disc ml-6 mb-4 space-y-1" {...props} />,
                  ol: ({ node, ...props }) => <ol className="list-decimal ml-6 mb-4 space-y-1" {...props} />,
                  a: ({ node, ...props }) => <a className="text-blue-600 underline hover:text-blue-800" target="_blank" rel="noopener noreferrer" {...props} />,
                }}
              >
                {prepareContent(content)}
              </ReactMarkdown>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
