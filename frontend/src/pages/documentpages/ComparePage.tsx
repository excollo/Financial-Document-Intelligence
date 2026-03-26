// Compares a DRHP with its RHP: loads docs, manages report creation via sockets,
// shows latest comparison report and the RHP Summary panel, with download/print tools.
import React, { useState, useEffect, useRef } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import {
  documentService,
  reportService,
  Report,
  shareService,
  jobService,
} from "@/services/api";
import { reportN8nService } from "@/lib/api/reportN8nService";
import { sessionService } from "@/lib/api/sessionService";
import { toast } from "sonner";
import { Navbar } from "@/components/sharedcomponents/Navbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  FileText,
  Download,
  Trash2,
  Star,
  Loader2,
  AlertCircle,
  CheckCircle,
  Printer,
  Plus,
  Minus,
  Menu,
  X,
  BarChart3,
  Sidebar,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { io as socketIOClient } from "socket.io-client";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import { cleanSummaryContent } from "@/lib/utils/markdownConverter";

interface ComparePageProps { }

export const ComparePage: React.FC<ComparePageProps> = () => {
  const { drhpId } = useParams<{ drhpId: string }>();
  const [searchParams] = useSearchParams();
  const linkToken =
    searchParams.get("linkToken") ||
    localStorage.getItem("sharedLinkToken") ||
    undefined;
  const navigate = useNavigate();
  const { user } = useAuth();
  const [sessionData] = useState(() => sessionService.initializeSession());

  const [drhp, setDrhp] = useState<any>(null);
  const [rhp, setRhp] = useState<any>(null);
  const [reports, setReports] = useState<Report[]>([]);
  const [selectedReport, setSelectedReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [comparing, setComparing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [zoom, setZoom] = useState(1); // 1 = 100%
  const reportRef = useRef<HTMLDivElement>(null);
  const [linkRole, setLinkRole] = useState<
    "viewer" | "editor" | "owner" | null
  >(null);

  // Sidebar state
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const lastHandledRef = useRef<{
    jobId: string | null;
    status: string | null;
  }>({
    jobId: null,
    status: null,
  });

  // Use refs to store latest values for socket callback
  const drhpRef = useRef(drhp);
  const rhpRef = useRef(rhp);
  const selectedReportRef = useRef(selectedReport);

  // Update refs when values change
  useEffect(() => {
    drhpRef.current = drhp;
  }, [drhp]);

  useEffect(() => {
    rhpRef.current = rhp;
  }, [rhp]);

  useEffect(() => {
    selectedReportRef.current = selectedReport;
  }, [selectedReport]);

  const fetchDocumentsAndReports = async () => {
    if (!drhpId) return;
    try {
      setLoading(true);
      const drhpDoc = await documentService.getById(drhpId!, linkToken);
      setDrhp(drhpDoc);

      let rhpDoc = null;
      if (drhpDoc.relatedRhpId) {
        rhpDoc = await documentService.getById(drhpDoc.relatedRhpId, linkToken);
        setRhp(rhpDoc);
      }

      // Fetch existing reports for this DRHP/RHP pair
      const allReports = await reportService.getAll();
      const filteredReports = allReports.filter(
        (r) =>
          r.drhpNamespace === drhpDoc.namespace ||
          (rhpDoc && r.rhpNamespace === rhpDoc.rhpNamespace)
      );

      // Sort reports by updatedAt to get the latest first
      const sortedReports = filteredReports.sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );

      setReports(sortedReports);

      // Always select the latest report if available
      if (sortedReports.length > 0) {
        const latestReport = sortedReports[0];
        console.log('Initial fetch - Selecting latest report:', latestReport.title, 'Updated:', latestReport.updatedAt);
        setSelectedReport(latestReport);
      } else {
        console.log('Initial fetch - No reports found');
        setSelectedReport(null);
      }
    } catch (error) {
      console.error("Error fetching data:", error);
      toast.error("Failed to load document and reports");
    } finally {
      setLoading(false);
    }
  };

  // Separate function to refresh only reports (used after job completion)
  const refreshReports = async (delay = 0) => {
    if (!drhp || !rhp) return;

    // Add a small delay to ensure backend has processed the report
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    try {
      const allReports = await reportService.getAll();
      const filteredReports = allReports.filter(
        (r) =>
          r.drhpNamespace === drhp.namespace ||
          (rhp && r.rhpNamespace === rhp.rhpNamespace)
      );

      // Sort reports by updatedAt to get the latest first
      const sortedReports = filteredReports.sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );

      setReports(sortedReports);

      // Always select the latest report if available
      if (sortedReports.length > 0) {
        const latestReport = sortedReports[0];
        console.log('refreshReports - Selecting latest report:', latestReport.id, latestReport.title, 'Updated:', latestReport.updatedAt);
        // Force update selectedReport to ensure UI refreshes with latest content
        setSelectedReport(latestReport);
      } else {
        console.log('refreshReports - No reports found for this document pair');
        setSelectedReport(null);
      }
    } catch (error) {
      console.error("Error refreshing reports:", error);
    }
  };

  useEffect(() => {
    fetchDocumentsAndReports();
  }, [drhpId]);

  // Ensure latest report is always selected when reports change
  useEffect(() => {
    if (reports.length > 0) {
      const latestReport = reports.reduce((a, b) =>
        new Date(a.updatedAt).getTime() > new Date(b.updatedAt).getTime() ? a : b
      );
      if (!selectedReport || selectedReport.id !== latestReport.id) {
        console.log('Auto-selecting latest report:', latestReport.title, 'Updated:', latestReport.updatedAt);
        setSelectedReport(latestReport);
      }
    }
  }, [reports, selectedReport]);

  useEffect(() => {
    (async () => {
      const role = await shareService.resolveTokenRole();
      setLinkRole(role);
    })();
  }, []);

  useEffect(() => {
    // On mount, check if report processing is ongoing for this DRHP
    if (drhpId) {
      const key = `report_processing_${drhpId}`;
      const jobStartedAt = Number(localStorage.getItem(key));
      if (jobStartedAt) {
        setComparing(true);
      }
    }
  }, [drhpId]);

  // When reports are fetched and the latest is rendered, clear the processing flag only if a new report is present
  useEffect(() => {
    if (!drhpId) return;
    const key = `report_processing_${drhpId}`;
    const jobStartedAt = Number(localStorage.getItem(key));
    if (comparing && reports && reports.length > 0 && jobStartedAt) {
      // Find the latest report
      const latestReport = reports.reduce((a, b) =>
        new Date(a.updatedAt).getTime() > new Date(b.updatedAt).getTime()
          ? a
          : b
      );
      if (new Date(latestReport.updatedAt).getTime() > jobStartedAt) {
        localStorage.removeItem(key);
        setComparing(false);
      }
    }
  }, [reports, comparing, drhpId]);

  useEffect(() => {
    // Determine socket URL from API URL (remove /api suffix)
    const apiUrl = import.meta.env.VITE_API_URL || "http://localhost:5000/api";
    const socketUrl = apiUrl.endsWith("/api") ? apiUrl.slice(0, -4) : apiUrl;

    const socket = socketIOClient(socketUrl, { transports: ["websocket"] });

    socket.on(
      "compare_status",
      async (data: {
        jobId: string;
        status: string;
        error?: string;
        reportId?: string;
      }) => {
        const { jobId, status, error, reportId } = data;
        const cleanStatus = status?.trim().toLowerCase();

        if (
          lastHandledRef.current.jobId === jobId &&
          lastHandledRef.current.status === cleanStatus
        ) {
          return;
        }
        lastHandledRef.current = { jobId, status: cleanStatus };

        // Handle both "completed" and "success" status (n8n sends "success" with possible space)
        if (cleanStatus === "completed" || cleanStatus === "success") {
          toast.success("Comparison completed successfully!");
          setComparing(false);
          if (drhpId) localStorage.removeItem(`report_processing_${drhpId}`);

          // Fetch latest reports immediately (same pattern as SummaryPanel)
          const fetchLatestReport = async (retries = 3, delay = 1000) => {
            try {
              // Wait a bit for backend to process the report
              await new Promise((resolve) => setTimeout(resolve, delay));

              // Get fresh reports list
              const allReports = await reportService.getAll();
              const currentDrhp = drhpRef.current;
              const currentRhp = rhpRef.current;

              if (!currentDrhp || !currentRhp) {
                if (retries > 0) {
                  console.log(`Documents not ready, retrying... (${retries} retries left)`);
                  await fetchLatestReport(retries - 1, delay + 500);
                }
                return;
              }

              const filteredReports = allReports.filter(
                (r) =>
                  r.drhpNamespace === currentDrhp.namespace ||
                  (currentRhp && r.rhpNamespace === currentRhp.rhpNamespace)
              );

              if (filteredReports.length > 0) {
                // Sort reports by updatedAt to get the latest first
                const sortedReports = filteredReports.sort(
                  (a, b) =>
                    new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
                );

                const latestReport = sortedReports[0];
                console.log('✅ Selecting latest report after completion:', latestReport.id, 'Title:', latestReport.title, 'Updated:', latestReport.updatedAt);

                // Always update to latest report (same as SummaryPanel pattern)
                setReports(sortedReports);
                setSelectedReport(latestReport);

                // If we have a specific reportId, verify it matches
                if (reportId && reportId !== latestReport.id) {
                  const reportById = allReports.find((r) => r.id === reportId);
                  if (reportById) {
                    console.log('Found report by reportId, but latest is newer. Using latest:', latestReport.id);
                  }
                }
              } else if (retries > 0) {
                // If no reports found and we have retries left, try again
                console.log(`No reports found, retrying... (${retries} retries left)`);
                await fetchLatestReport(retries - 1, delay + 500);
              } else {
                console.warn('No reports found after all retries');
              }
            } catch (error) {
              console.error("Error refreshing reports after completion:", error);
              if (retries > 0) {
                // Retry on error
                await fetchLatestReport(retries - 1, delay + 500);
              }
            }
          };

          // Start fetching with retries (same pattern as SummaryPanel)
          fetchLatestReport();
        } else if (cleanStatus === "failed") {
          toast.error(`Comparison failed: ${error || "Unknown error"}`);
          setComparing(false);
          if (drhpId) localStorage.removeItem(`report_processing_${drhpId}`);
        } else if (cleanStatus === "processing") {
          setComparing(true);
          if (drhpId) {
            const key = `report_processing_${drhpId}`;
            if (!localStorage.getItem(key)) {
              localStorage.setItem(key, Date.now().toString());
            }
          }
        } else {
          setComparing(false);
          if (drhpId) localStorage.removeItem(`report_processing_${drhpId}`);
        }
      }
    );

    return () => {
      socket.disconnect();
    };
  }, [drhpId]);

  useEffect(() => {
    // On mount and on window focus, check if report is ready
    const checkReportReady = async () => {
      if (!drhpId) return;
      const key = `report_processing_${drhpId}`;
      if (localStorage.getItem(key)) {
        // Use refreshReports to get latest reports
        await refreshReports();
        if (reports && reports.length > 0) {
          setComparing(false);
          localStorage.removeItem(key);
          // Set ready flag for global notification
          localStorage.setItem(`report_ready_${drhpId}`, "1");
          toast.success("Comparison report is ready!");
        }
      }
    };
    checkReportReady();
    // Listen for window focus
    const onFocus = () => checkReportReady();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [drhpId, drhp?.namespace, rhp?.rhpNamespace]);

  // Removed periodic polling; rely on socket "completed" event to refresh

  useEffect(() => {
    // Refetch reports on window focus if processing is ongoing
    if (!drhpId) return;
    const onFocus = async () => {
      if (comparing) {
        await refreshReports();
      }
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [comparing, drhpId]);

  const handleCreateReport = async () => {
    if (!drhp || !rhp) {
      toast.error("Both DRHP and RHP documents are required");
      return;
    }

    try {
      setComparing(true);
      // Persist processing state with timestamp for progress tracking
      if (drhpId) {
        const jobStartedAt = Date.now();
        localStorage.setItem(
          `report_processing_${drhpId}`,
          jobStartedAt.toString()
        );
      }
      
      toast.info("Initiating Intelligence Pipeline for comparison...");

      // NEW: Using the central job service for intelligence processing
      const response = await jobService.create({
        directoryId: drhp.directoryId,
        drhpId: drhp.id,
        rhpId: rhp.id,
        title: `${drhp.name} vs ${rhp.name} Intelligence Report`
      });

      if (response.data?.id) {
        toast.success("Intelligence Pipeline job started. Comparison is underway!");
      } else {
        toast.success("Comparison job started successfully!");
      }

    } catch (error: any) {
      console.error("Error creating comparison job:", error);
      const errorMessage = error.response?.data?.error || error.message || "Failed to initiate comparison";
      toast.error(errorMessage);
      setComparing(false);
      if (drhpId) localStorage.removeItem(`report_processing_${drhpId}`);
    }
  };

  const handleDeleteRhp = async () => {
    if (!rhp) return;

    try {
      setDeleting(true);
      // Delete only the RHP document
      await documentService.delete(rhp.id);
      toast.success("RHP document deleted successfully");
      // Refresh the page data to reflect the change
      await fetchDocumentsAndReports();
    } catch (error) {
      console.error("Error deleting RHP document:", error);
      toast.error("Failed to delete RHP document");
    } finally {
      setDeleting(false);
    }
  };

  function stripStyleTags(html: string): string {
    return html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
  }

  // Removed handleDownloadPdf - use handlePrint instead which allows saving as PDF

  const handleDownloadDocx = async () => {
    if (!selectedReport) return;
    let loadingToast;
    try {
      loadingToast = toast.loading("Download processing...");
      const blob = await reportService.downloadDocx(selectedReport.id);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${selectedReport.title}.docx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      toast.dismiss(loadingToast);
      toast.success("DOCX downloaded successfully");
    } catch (error) {
      toast.dismiss(loadingToast);
      console.error("Error downloading DOCX:", error);
      toast.error("Failed to download DOCX");
    }
  };

  const handleZoomIn = () =>
    setZoom((z) => Math.min(Math.round((z + 0.1) * 10) / 10, 2));
  const handleZoomOut = () =>
    setZoom((z) => Math.max(Math.round((z - 0.1) * 10) / 10, 1));

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

  const handlePrint = () => {
    if (reportRef.current) {
      const printWindow = window.open("", "", "width=900,height=650");
      if (printWindow) {
        printWindow.document.write(`
          <html>
            <head>
              <title>Print Report</title>
              <style>
                body { 
                  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; 
                  margin: 0; 
                  padding: 2rem; 
                  line-height: 1.6;
                  color: #1F2937;
                }
                .summary-content {
                  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
                  line-height: 1.6;
                  color: #1F2937;
                }
                .summary-content h1 { 
                  font-size: 28px; 
                  font-weight: 800; 
                  color: #1F2937; 
                  margin: 24px 0 16px 0; 
                  padding-bottom: 8px;
                  border-bottom: 2px solid #4B2A06;
                  line-height: 1.3;
                }
                .summary-content h2 { 
                  font-size: 22px; 
                  font-weight: 700; 
                  color: #1F2937; 
                  margin: 20px 0 12px 0; 
                  padding-left: 8px;
                  border-left: 4px solid #4B2A06;
                  line-height: 1.4;
                }
                .summary-content h3 { 
                  font-size: 18px; 
                  font-weight: 600; 
                  color: #374151; 
                  margin: 16px 0 10px 0; 
                  line-height: 1.4;
                }
                .summary-content h4 { 
                  font-size: 16px; 
                  font-weight: 600; 
                  color: #374151; 
                  margin: 14px 0 8px 0; 
                  line-height: 1.4;
                }
                .summary-content h5 { 
                  font-size: 14px; 
                  font-weight: 600; 
                  color: #4B5563; 
                  margin: 12px 0 6px 0; 
                  line-height: 1.4;
                }
                .summary-content h6 { 
                  font-size: 13px; 
                  font-weight: 600; 
                  color: #4B5563; 
                  margin: 10px 0 4px 0; 
                  line-height: 1.4;
                }
                .summary-content p { 
                  margin: 12px 0; 
                  line-height: 1.7;
                  text-align: justify;
                }
                .summary-content ul, .summary-content ol { 
                  margin: 12px 0; 
                  padding-left: 24px; 
                  line-height: 1.6;
                }
                .summary-content li { 
                  margin: 6px 0; 
                  line-height: 1.6;
                }
                .summary-content blockquote { 
                  margin: 16px 0; 
                  padding: 12px 16px; 
                  background: #F9FAFB; 
                  border-left: 4px solid #4B2A06; 
                  font-style: italic;
                  color: #4B5563;
                }
                .summary-content b, .summary-content strong { 
                  font-weight: 700; 
                  color: #1F2937;
                }
                .summary-content i, .summary-content em { 
                  font-style: italic; 
                  color: #4B5563;
                }
                .summary-content hr { 
                  border: none; 
                  border-top: 2px solid #E5E7EB; 
                  margin: 24px 0; 
                }
                .summary-content table {
                  border-collapse: collapse;
                  width: 100%;
                  border: 2px solid #d1d5de;
                  margin: 20px 0;
                  font-size: 14px;
                  background: #ECE9E2;
                  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                }
                .summary-content th, .summary-content td {
                  border: 1px solid #d1d5de;
                  padding: 10px 12px;
                  text-align: left;
                  vertical-align: top;
                }
                .summary-content th {
                  background: #4B2A06;
                  color: white;
                  font-weight: 600;
                  font-size: 13px;
                }
                .summary-content tr:nth-child(even) td {
                  background: #F5F5F5;
                }
                .summary-content tr:nth-child(odd) td {
                  background: #ECE9E2;
                }
                .summary-content code {
                  background: #F3F4F6;
                  padding: 2px 6px;
                  border-radius: 4px;
                  font-family: 'Courier New', monospace;
                  font-size: 13px;
                  color: #1F2937;
                }
                .summary-content pre {
                  background: #F3F4F6;
                  padding: 16px;
                  border-radius: 8px;
                  overflow-x: auto;
                  margin: 16px 0;
                  border: 1px solid #E5E7EB;
                }
                .summary-content pre code {
                  background: none;
                  padding: 0;
                  font-size: 13px;
                }
                @media print {
                  .summary-content table {
                    border-collapse: collapse !important;
                    width: 100% !important;
                    border: 2px solid #d1d5de !important;
                    background: #ECE9E2 !important;
                    box-shadow: none !important;
                  }
                  .summary-content th, .summary-content td {
                    border: 1px solid #d1d5de !important;
                    padding: 10px 12px !important;
                    text-align: left !important;
                    vertical-align: top !important;
                  }
                  .summary-content th {
                    background: #4B2A06 !important;
                    color: white !important;
                    font-weight: 600 !important;
                    font-size: 13px !important;
                  }
                  .summary-content tr:nth-child(even) td {
                    background: #F5F5F5 !important;
                  }
                  .summary-content tr:nth-child(odd) td {
                    background: #ECE9E2 !important;
                  }
                  .summary-content h1, .summary-content h2, .summary-content h3, 
                  .summary-content h4, .summary-content h5, .summary-content h6 {
                    color: #1F2937 !important;
                    page-break-after: avoid;
                  }
                  .summary-content p, .summary-content li {
                    orphans: 3;
                    widows: 3;
                  }
                }
              </style>
            </head>
            <body>
              <div class="summary-content">
                ${reportRef.current.innerHTML}
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

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar title="Compare Documents" />
        <div className="flex items-center justify-center h-[90vh]">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      </div>
    );
  }

  if (!drhp) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar title="Compare Documents" />
        <div className="flex items-center justify-center h-[90vh]">
          <div className="text-center">
            <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-2">Document Not Found</h2>
            <p className="text-gray-600 mb-4">
              The DRHP document could not be found.
            </p>
            <Button onClick={() => navigate("/dashboard")}>
              Back to Dashboard
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-[100vw] flex flex-col bg-white overflow-x-hidden">
      {/* Top 10vh - Navbar */}
      <div className=" fixed top-0 left-0 right-0 z-50 h-[10vh]">
        <Navbar title="Compare Documents" />
      </div>

      {/* Bottom 90vh - Main Content */}
      <div className="h-[90vh] flex mt-[10vh]">
        {/* Left Sidebar - ChatGPT Style */}
        <div
          className={`transition-all duration-300 ease-in-out ${sidebarOpen ? "w-80" : "w-16"
            } fixed top-[10vh] left-0 bg-white border-r border-gray-200 h-[90vh] px-5 flex flex-col overflow-hidden`}
        >
          {sidebarOpen && (
            <>
              {/* Sidebar Header */}
              <div className="px-4 py-2 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-[#4B2A06] ">
                  Documents
                </h2>
                <button
                  onClick={() => setSidebarOpen(false)}
                  className="p-2 hover:bg-gray-100 rounded-md"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Document Cards */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4 ">
                {/* DRHP Card */}
                <Card className="w-full bg-white rounded-md  border border-gray-200">
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-sm">
                      <FileText className="h-4 w-4" />
                      DRHP Document
                      {drhp.hasRhp && (
                        <Star className="h-4 w-4 text-yellow-500" />
                      )}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0  ">
                    <div className="space-y-1 text-xs">
                      <p>
                        <strong>Name:</strong> {drhp.name}
                      </p>
                      <p>
                        <strong>Namespace:</strong> {drhp.namespace}
                      </p>
                      <p>
                        <strong>Uploaded:</strong>{" "}
                        {new Date(drhp.uploadedAt).toLocaleDateString()}
                      </p>
                      <Badge
                        variant="secondary"
                        className="text-xs bg-[#ECE9E2] text-[#4B2A06] hover:bg-[#ECE9E2] hover:text-[#4B2A06]"
                      >
                        DRHP
                      </Badge>
                    </div>
                  </CardContent>
                </Card>

                {/* RHP Card */}
                <Card className="w-full relative bg-white rounded-md  border border-gray-200">
                  {rhp && (
                    <div className="absolute top-2 right-2 z-10">
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-6 w-6 p-0 hover:bg-[#ECE9E2] text-[#4B2A06] bg-[#ECE9E2]"
                            disabled={deleting}
                            title="Delete Document"
                          >
                            {deleting ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Trash2 className="h-3 w-3 " />
                            )}
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete Document</AlertDialogTitle>
                            <AlertDialogDescription>
                              Are you sure you want to delete this document and
                              its linked RHP? This action cannot be undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={handleDeleteRhp}>
                              Delete
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  )}
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-sm">
                      <FileText className="h-4 w-4" />
                      RHP Document
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    {rhp ? (
                      <div className="space-y-1 text-xs">
                        <p>
                          <strong>Name:</strong> {rhp.name}
                        </p>
                        <p>
                          <strong>Namespace:</strong> {rhp.rhpNamespace}
                        </p>
                        <p>
                          <strong>Uploaded:</strong>{" "}
                          {new Date(rhp.uploadedAt).toLocaleDateString()}
                        </p>
                        <Badge
                          variant="secondary"
                          className="text-xs text-xs bg-[#ECE9E2] text-[#4B2A06] hover:bg-[#ECE9E2] hover:text-[#4B2A06]"
                        >
                          RHP
                        </Badge>
                      </div>
                    ) : (
                      <div className="text-center py-4">
                        <AlertCircle className="h-8 w-8 text-gray-400 mx-auto mb-2" />
                        <p className="text-gray-600 text-xs">
                          No RHP document found
                        </p>
                        <p className="text-xs text-gray-500">
                          Upload an RHP document to enable comparison
                        </p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

              {/* Compare Button */}
              {rhp && (
                <div className="px-4 py-2 ">
                  <Button
                    className="w-full bg-[#4B2A06] hover:bg-[#6b3a0a] text-white font-semibold"
                    onClick={handleCreateReport}
                    disabled={comparing || linkRole === "viewer"}
                  >
                    {comparing ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Processing...
                      </>
                    ) : (
                      <>
                        <BarChart3 className="mr-1 h-4 w-4" />
                        Compare Documents
                      </>
                    )}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>

        {/* Sidebar Toggle Button (when closed) */}
        {!sidebarOpen && (
          <button
            onClick={() => setSidebarOpen(true)}
            className="absolute top-[12vh] left-3 z-50 p-2 bg-white border border-gray-200 rounded-md shadow-md hover:bg-gray-50"
          >
            <Sidebar className="h-5 w-5" />
          </button>
        )}

        {/* Main Content Area */}
        <div
          className={`flex-1 flex h-full transition-all duration-300 ease-in-out mr-10 mt-5 ${sidebarOpen ? "ml-80" : "ml-16"
            }`}
        >
          {/* Comparison Report - Full Width */}
          <div className="flex-1 flex flex-col bg-gray-50  mx-auto">
            {/* Report Header */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between pr-4 py-3 bg-white gap-2 sm:gap-0  ">
              <div className="font-bold text-md md:text-lg ml-12">
                Comparison Report
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                {/* Zoom controls */}
                <button
                  className="p-1  rounded hover:bg-gray-100"
                  onClick={handleZoomOut}
                  title="Zoom Out"
                  disabled={zoom <= 1}
                >
                  <Minus className="h-4 w-4" />
                </button>
                <span className="w-8 text-center text-sm">
                  {Math.round(zoom * 100)}%
                </span>
                <button
                  className="p-1 rounded hover:bg-gray-100"
                  onClick={handleZoomIn}
                  title="Zoom In"
                  disabled={zoom >= 2}
                >
                  <Plus className="h-4 w-4 " />
                </button>
                {/* Download DOCX */}
                <button
                  className="p-1  rounded hover:bg-gray-100"
                  onClick={handleDownloadDocx}
                  title="Download DOCX"
                >
                  <FileText className="h-4 w-4 " />
                </button>
                {/* Download PDF
                <button
                  className="p-1  rounded hover:bg-gray-100"
                  onClick={handleDownloadPdf}
                  title="Download PDF"
                >
                  <Download className="h-4 w-4 " />
                </button> */}
                {/* Print */}
                <button
                  className="p-1 rounded hover:bg-gray-100"
                  onClick={handlePrint}
                  title="Print"
                >
                  <Printer className="h-4 w-4 " />
                </button>
              </div>
            </div>

            {/* Report Content */}
            <div className=" bg-white flex-1 overflow-hidden">
              {comparing ? (
                <div className="flex flex-1 items-center justify-center">
                  <Loader2 className="h-12 w-12 animate-spin text-[#4B2A06]" />
                  <span className="ml-4 text-lg">Loading Summary......</span>
                </div>
              ) : selectedReport ? (
                <div className="h-full mr-5 my-4 ">
                  <style>{`
              .summary-content {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
                line-height: 1.6;
                color: #1F2937;
              }
              .summary-content h1 { 
                font-size: 28px; 
                font-weight: 800; 
                color: #1F2937; 
                margin: 24px 0 16px 0; 
                padding-bottom: 8px;
                border-bottom: 2px solid #4B2A06;
                line-height: 1.3;
              }
              .summary-content h2 { 
                font-size: 22px; 
                font-weight: 700; 
                color: #1F2937; 
                margin: 20px 0 12px 0; 
                padding-left: 8px;
                border-left: 4px solid #4B2A06;
                line-height: 1.4;
              }
              .summary-content h3 { 
                font-size: 18px; 
                font-weight: 600; 
                color: #374151; 
                margin: 16px 0 10px 0; 
                line-height: 1.4;
              }
              .summary-content h4 { 
                font-size: 16px; 
                font-weight: 600; 
                color: #374151; 
                margin: 14px 0 8px 0; 
                line-height: 1.4;
              }
              .summary-content h5 { 
                font-size: 14px; 
                font-weight: 600; 
                color: #4B5563; 
                margin: 12px 0 6px 0; 
                line-height: 1.4;
              }
              .summary-content h6 { 
                font-size: 13px; 
                font-weight: 600; 
                color: #4B5563; 
                margin: 10px 0 4px 0; 
                line-height: 1.4;
              }
              .summary-content p { 
                margin: 12px 0; 
                line-height: 1.7;
                text-align: justify;
              }
              .summary-content ul, .summary-content ol { 
                margin: 12px 0; 
                padding-left: 24px; 
                line-height: 1.6;
              }
              .summary-content li { 
                margin: 6px 0; 
                line-height: 1.6;
              }
              .summary-content blockquote { 
                margin: 16px 0; 
                padding: 12px 16px; 
                background: #F9FAFB; 
                border-left: 4px solid #4B2A06; 
                font-style: italic;
                color: #4B5563;
              }
              .summary-content b, .summary-content strong { 
                font-weight: 700; 
                color: #1F2937;
              }
              .summary-content i, .summary-content em { 
                font-style: italic; 
                color: #4B5563;
              }
              .summary-content hr { 
                border: none; 
                border-top: 2px solid #E5E7EB; 
                margin: 24px 0; 
              }
              .summary-content table {
                border-collapse: collapse;
                width: 100%;
                border: 2px solid #d1d5de;
                margin: 20px 0;
                font-size: 14px;
                background: #ECE9E2;
                box-shadow: 0 2px 4px rgba(0,0,0,0.1);
              }
              .summary-content th, .summary-content td {
                border: 1px solid #d1d5de;
                padding: 10px 12px;
                text-align: left;
                vertical-align: top;
              }
              .summary-content th {
                background: #4B2A06;
                color: white;
                font-weight: 600;
                font-size: 13px;
              }
              .summary-content tr:nth-child(even) td {
                background: #F5F5F5;
              }
              .summary-content tr:nth-child(odd) td {
                background: #ECE9E2;
              }
              .summary-content code {
                background: #F3F4F6;
                padding: 2px 6px;
                border-radius: 4px;
                font-family: 'Courier New', monospace;
                font-size: 13px;
                color: #1F2937;
              }
              .summary-content pre {
                background: #F3F4F6;
                padding: 16px;
                border-radius: 8px;
                overflow-x: auto;
                margin: 16px 0;
                border: 1px solid #E5E7EB;
              }
              .summary-content pre code {
                background: none;
                padding: 0;
                font-size: 13px;
              }
            `}</style>
                  {/* HTML Content Display */}
                  <div
                    className="h-[95%] hide-scrollbar ml-12 bg-[#ECE9E2] rounded-md overflow-y-auto"
                    style={{ zoom: zoom }}
                  >
                    <div
                      ref={reportRef}
                      className="summary-content text-foreground/90 leading-relaxed py-8 px-5"
                      style={{
                        width: "100%",
                        wordBreak: "break-word",
                        overflowWrap: "break-word",
                      }}
                    >
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
                        {prepareContent(selectedReport.content)}
                      </ReactMarkdown>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex-1 h-full flex items-center justify-center text-gray-400">
                  <div className="text-center ">
                    <BarChart3 className="h-12 w-12 m-auto mb-4 " />
                    <p>No comparison report available</p>
                    <p className="text-sm">
                      Click "Compare Documents" to generate a report
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ComparePage;
