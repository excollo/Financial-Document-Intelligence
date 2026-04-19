// Admin dashboard: aggregates stats and management UIs for documents, summaries,
// reports, chats, and workspaces. Admin-only access enforced via role check.
import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  User,
  FileText,
  BarChart3,
  FileText as InputIcon,
  Download,
  Trash2,
  MessageSquare,
  Shield,
  Settings,
  MoreVertical,
  Eye,
  Share2,
  Plus,
  Check,
  X,
  Pencil,
  Divide,
  Printer,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Navbar } from "@/components/sharedcomponents/Navbar";
import { DocumentPopover } from "@/components/chatcomponents/ChatPanel";
import { ShareDialog } from "@/components/documentcomponents/ShareDialog";
import { ViewSummaryModal } from "@/components/documentcomponents/ViewSummaryModal";
import { ViewReportModal } from "@/components/documentcomponents/ViewReportModal";
import { WorkspaceRequestsManager } from "@/components/workspacecomponents/WorkspaceRequestsManager";
import { InviteeManagement } from "@/components/workspacecomponents/InviteeManagement";
import { WorkspaceMembersManagement } from "@/components/workspacecomponents/WorkspaceMembersManagement";
import { workspaceService, WorkspaceDTO } from "@/services/workspaceService";
import { workspaceInvitationService } from "@/services/workspaceInvitationService";
import { CreateWorkspaceModal } from "@/components/workspacecomponents/CreateWorkspaceModal";
import { SystemHealth } from "@/components/admincomponents/SystemHealth";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  documentService,
  chatService,
  summaryService,
  reportService,
  directoryService,
} from "@/services/api";
import { userService } from "@/lib/api/userService";
import { Separator } from "@radix-ui/react-dropdown-menu";

interface Document {
  id: string;
  _id: string;
  name: string;
  createdAt: string;
  createdBy?: string;
  namespace?: string;
  userId?: string;
  microsoftId?: string;
  workspaceId?: {
    workspaceId: string;
    name: string;
    slug: string;
  };
}

interface Summary {
  id: string;
  documentId: string;
  updatedAt: string;
  createdBy?: string;
  title?: string;
  userId?: string;
  microsoftId?: string;
  workspaceId?: {
    workspaceId: string;
    name: string;
    slug: string;
  };
}

interface Report {
  id: string;
  drhpNamespace: string;
  updatedAt: string;
  userId?: string;
  microsoftId?: string;
  workspaceId?: {
    workspaceId: string;
    name: string;
    slug: string;
  };
}

interface Chat {
  _id: string;
  documentId: string;
  messageCount: number;
  createdAt: string;
}

interface ChatStats {
  totalChats: number;
  messagesPerChat: any[];
  chatsPerUser: any[];
}

interface DashboardStats {
  totalUsers: number;
  totalDocuments: number;
  totalReports: number;
  totalSummaries: number;
  totalChats: number;
  totalDirectories: number;
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

export default function AdminDashboardPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [documentsLoading, setDocumentsLoading] = useState(true);
  const [summariesLoading, setSummariesLoading] = useState(true);
  const [reportsLoading, setReportsLoading] = useState(true);
  const [chatsLoading, setChatsLoading] = useState(true);
  const [directoriesLoading, setDirectoriesLoading] = useState(true);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [summaries, setSummaries] = useState<Summary[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [directories, setDirectories] = useState<any[]>([]);
  const [shareDirId, setShareDirId] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [viewSummaryId, setViewSummaryId] = useState<string | null>(null);
  const [viewReportId, setViewReportId] = useState<string | null>(null);
  const [chats, setChats] = useState<Chat[]>([]);
  const [chatStats, setChatStats] = useState<ChatStats | null>(null);
  const [chatsLast30Days, setChatsLast30Days] = useState(0);
  const [activeUsers, setActiveUsers] = useState(0);
  const [avgMessages, setAvgMessages] = useState(0);
  const [recentChats, setRecentChats] = useState<any[]>([]);
  const [userStats, setUserStats] = useState<any>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [reportsFilter, setReportsFilter] = useState("7");
  const [reportsSearch, setReportsSearch] = useState("");
  const [workspaces, setWorkspaces] = useState<WorkspaceDTO[]>([]);
  const [workspacesLoading, setWorkspacesLoading] = useState(true);
  const [editingWorkspace, setEditingWorkspace] = useState<WorkspaceDTO | null>(null);
  const [editingName, setEditingName] = useState("");
  const [createWorkspaceOpen, setCreateWorkspaceOpen] = useState(false);
  const [addUsersOpen, setAddUsersOpen] = useState(false);
  const [removeUsersOpen, setRemoveUsersOpen] = useState(false);
  const [viewRequestsOpen, setViewRequestsOpen] = useState(false);
  const [targetWorkspace, setTargetWorkspace] = useState<WorkspaceDTO | null>(null);
  const [workspaceMembers, setWorkspaceMembers] = useState<Array<{ _id: string; name?: string; email: string; status: string; role: string }>>([]);
  const [userSearch, setUserSearch] = useState("");
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [directorySortBy, setDirectorySortBy] = useState<"alphabetical" | "lastModified">("lastModified"); // Directory sort option
  const [showDirectorySort, setShowDirectorySort] = useState(false); // Directory sort dropdown visibility
  const [activeMainTab, setActiveMainTab] = useState<"overview" | "health">("overview");

  const currentUserId = String((user as any)?.id || (user as any)?._id || "");

  // Real stats fetched from backend
  const [stats, setStats] = useState<DashboardStats>({
    totalUsers: 0,
    totalDocuments: 0,
    totalReports: 0,
    totalSummaries: 0,
    totalChats: 0,
    totalDirectories: 0,
  });

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadWorkspaces = async () => {
    try {
      setWorkspacesLoading(true);
      const data = await workspaceService.listWorkspaces();
      const items = data.workspaces || [];
      // Only show actual workspaces from database, no fake "default" workspace
      // Use workspace.name (not slug) for display
      setWorkspaces(items);
    } catch (error) {
      console.error("Error loading workspaces:", error);
      toast.error("Failed to load workspaces");
    } finally {
      setWorkspacesLoading(false);
    }
  };

  const handleRenameWorkspace = async (workspace: WorkspaceDTO) => {
    if (!editingName.trim()) return;
    try {
      await workspaceService.updateWorkspace(workspace.workspaceId, { name: editingName.trim() });
      toast.success("Workspace renamed successfully");
      setEditingWorkspace(null);
      setEditingName("");
      loadWorkspaces();
    } catch (error: any) {
      toast.error(error?.response?.data?.message || "Failed to rename workspace");
    }
  };

  const handleDeleteWorkspace = async (workspace: WorkspaceDTO) => {
    if (!confirm(`Are you sure you want to archive workspace "${workspace.name}"?`)) return;
    try {
      await workspaceService.archiveWorkspace(workspace.workspaceId);
      toast.success("Workspace archived successfully");
      loadWorkspaces();
    } catch (error: any) {
      toast.error(error?.response?.data?.message || "Failed to archive workspace");
    }
  };

  const openAddUsers = async (workspace: WorkspaceDTO) => {
    try {
      setTargetWorkspace(workspace);
      setSelectedUserIds([]);
      setUserSearch("");

      // Ensure all users are loaded
      if (!users || users.length === 0) {
        const allUsers = await userService.getAllUsers({ limit: 1000 });
        setUsers(allUsers.users);
      }

      // Get workspace members to filter out users who already have access
      // Switch workspace context temporarily to get members
      const originalWorkspace = localStorage.getItem("currentWorkspace");
      try {
        localStorage.setItem("currentWorkspace", workspace.workspaceId);
        const res = await workspaceInvitationService.getWorkspaceMembers();
        // Convert to format expected by filtering logic
        const membersList = (res.members || []).map((m: any) => ({
          _id: m.userId,
          name: m.name,
          email: m.email,
          status: "active", // Active members from getWorkspaceMembers
          role: m.workspaceRole,
        }));
        setWorkspaceMembers(membersList);
      } finally {
        if (originalWorkspace) {
          localStorage.setItem("currentWorkspace", originalWorkspace);
        } else {
          localStorage.removeItem("currentWorkspace");
        }
      }

      setAddUsersOpen(true);
    } catch (e: any) {
      console.error("Error opening add users:", e);
      toast.error(e?.response?.data?.message || "Failed to open add users");
    }
  };

  const openRemoveUsers = async (workspace: WorkspaceDTO) => {
    try {
      setTargetWorkspace(workspace);
      setSelectedUserIds([]);
      setUserSearch("");

      // Switch workspace context to get members for this workspace
      const originalWorkspace = localStorage.getItem("currentWorkspace");
      try {
        localStorage.setItem("currentWorkspace", workspace.workspaceId);
        const res = await workspaceInvitationService.getWorkspaceMembers();
        // Convert to format expected by filtering logic
        const membersList = (res.members || []).map((m: any) => ({
          _id: m.userId,
          name: m.name,
          email: m.email,
          status: "active", // Active members from getWorkspaceMembers
          role: m.workspaceRole,
        }));
        setWorkspaceMembers(membersList);
      } finally {
        if (originalWorkspace) {
          localStorage.setItem("currentWorkspace", originalWorkspace);
        } else {
          localStorage.removeItem("currentWorkspace");
        }
      }

      setRemoveUsersOpen(true);
    } catch (e: any) {
      console.error("Error opening remove users:", e);
      toast.error(e?.response?.data?.message || "Failed to open remove users");
    }
  };

  const filteredAddableUsers = (users || []).filter((u: any) => {
    const already = workspaceMembers.some((m) => m._id === u._id);
    const matches = (u.name || u.email || "").toLowerCase().includes(userSearch.toLowerCase());
    const notSelf = String(u._id) !== currentUserId;
    return !already && matches && notSelf;
  });

  const filteredRemovableUsers = workspaceMembers.filter((m) => {
    const matches = (m.name || m.email || "").toLowerCase().includes(userSearch.toLowerCase());
    const notSelf = String(m._id) !== currentUserId;
    // Filter out admins - admins cannot be removed from workspace
    const notAdmin = (m as any).role !== "admin";
    return matches && notSelf && notAdmin;
  });

  const toggleSelected = (id: string) => {
    setSelectedUserIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const handleAddUsersConfirm = async () => {
    if (!targetWorkspace) return;
    try {
      // Switch workspace context
      const originalWorkspace = localStorage.getItem("currentWorkspace");
      try {
        localStorage.setItem("currentWorkspace", targetWorkspace.workspaceId);

        // Get user emails for selected user IDs
        const selectedUsers = users.filter((u: any) => selectedUserIds.includes(u._id));

        // Send invitations for each user
        await Promise.all(
          selectedUsers.map((u: any) =>
            workspaceInvitationService.sendInvitation({
              inviteeEmail: u.email,
              inviteeName: u.name,
              invitedRole: "editor", // Default role
            })
          )
        );

        toast.success("Users invited successfully");
        setAddUsersOpen(false);
        loadWorkspaces();
      } finally {
        if (originalWorkspace) {
          localStorage.setItem("currentWorkspace", originalWorkspace);
        } else {
          localStorage.removeItem("currentWorkspace");
        }
      }
    } catch (e: any) {
      console.error("Error adding users:", e);
      toast.error(e?.response?.data?.message || "Failed to add users");
    }
  };

  const handleRemoveUsersConfirm = async () => {
    if (!targetWorkspace) return;
    try {
      // Switch workspace context
      const originalWorkspace = localStorage.getItem("currentWorkspace");
      try {
        localStorage.setItem("currentWorkspace", targetWorkspace.workspaceId);

        // Remove members using workspaceInvitationService
        await Promise.all(
          selectedUserIds.map((id) => workspaceInvitationService.removeWorkspaceMember(id))
        );

        toast.success("Users removed successfully");
        setRemoveUsersOpen(false);
        loadWorkspaces();
      } finally {
        if (originalWorkspace) {
          localStorage.setItem("currentWorkspace", originalWorkspace);
        } else {
          localStorage.removeItem("currentWorkspace");
        }
      }
    } catch (e: any) {
      console.error("Error removing users:", e);
      toast.error(e?.response?.data?.message || "Failed to remove users");
    }
  };

  useEffect(() => {
    loadWorkspaces();
  }, []);

  const loadDashboardData = async () => {
    try {
      // Set all loading states to true at once
      setDashboardLoading(true);
      setDocumentsLoading(true);
      setSummariesLoading(true);
      setReportsLoading(true);
      setChatsLoading(true);

      console.log("Loading dashboard data for user:", user);

      // Optimized helper function to fetch directories with depth limit and timeout
      const fetchAllDirectories = async (maxDepth: number = 3, timeout: number = 3000): Promise<any[]> => {
        const result: any[] = [];
        const queue: Array<{ id: string | null; depth: number }> = [{ id: "root", depth: 0 }];
        const seen = new Set<string | null>();
        const startTime = Date.now();

        while (queue.length > 0 && (Date.now() - startTime) < timeout) {
          const { id: current, depth } = queue.shift()!;
          if (seen.has(current) || depth > maxDepth) continue;
          seen.add(current);

          try {
            // Fetch with reasonable pageSize
            const data = await directoryService.listChildren(current as any, {
              pageSize: 200,
              page: 1,
            });
            let dirs = (data?.items || [])
              .filter((x: any) => x.kind === "directory")
              .map((x: any) => x.item);

            // Only fetch additional pages if we haven't exceeded timeout
            if (data?.total && data.total > 200 && (Date.now() - startTime) < timeout) {
              const totalPages = Math.min(Math.ceil(data.total / 200), 3); // Limit to 3 pages max
              const pagePromises = [];
              for (let page = 2; page <= totalPages; page++) {
                if ((Date.now() - startTime) < timeout) {
                  pagePromises.push(
                    directoryService.listChildren(current as any, {
                      pageSize: 200,
                      page: page,
                    }).then(pageData =>
                      (pageData?.items || [])
                        .filter((x: any) => x.kind === "directory")
                        .map((x: any) => x.item)
                    )
                  );
                }
              }
              const additionalDirs = await Promise.all(pagePromises);
              dirs = [...dirs, ...additionalDirs.flat()];
            }

            result.push(...dirs);
            // Only queue children if we haven't exceeded max depth
            if (depth < maxDepth) {
              for (const d of dirs) {
                queue.push({ id: d.id, depth: depth + 1 });
              }
            }
          } catch (e) {
            // ignore errors and continue
            console.warn("Error fetching directory children:", e);
          }
        }
        return result;
      };

      // Phase 1: Load critical stats first (fast, needed for initial render)
      const [userData, chatData] = await Promise.all([
        userService.getUserStats().catch(err => {
          console.error("Error loading user stats:", err);
          return { total: 0 };
        }),
        chatService.getStats().catch(err => {
          console.error("Error loading chat stats:", err);
          return null;
        })
      ]);

      // Set initial stats immediately for fast UI update
      setUserStats(userData);
      setChatStats(chatData);
      setStats({
        totalUsers: userData?.total || 0,
        totalDocuments: 0, // Will be updated after documents load
        totalReports: 0,
        totalSummaries: 0,
        totalChats: chatData?.totalChats || 0,
        totalDirectories: 0,
      });

      // Phase 2: Load detailed data in parallel (but directories are non-blocking)
      const [
        allUsersResponse,
        docs,
        sums,
        reps,
        allChats
      ] = await Promise.all([
        userService.getAllUsers({ limit: 1000 }).catch(err => {
          console.error("Error loading users:", err);
          return { users: [] };
        }),
        documentService.getAllAdmin().catch(err => {
          console.error("Error loading documents:", err);
          return [];
        }),
        summaryService.getAllAdmin().catch(err => {
          console.error("Error loading summaries:", err);
          return [];
        }),
        reportService.getAllAdmin().catch(err => {
          console.error("Error loading reports:", err);
          return [];
        }),
        chatService.getAllAdmin().catch(err => {
          console.error("Error loading chats:", err);
          return [];
        })
      ]);

      // Set main data
      setUsers(allUsersResponse.users || []);
      setDocuments(Array.isArray(docs) ? docs : []);
      setSummaries(Array.isArray(sums) ? sums : []);
      setReports(Array.isArray(reps) ? reps : []);

      // Process chat data
      const chatsArray = Array.isArray(allChats) ? allChats : [];
      setRecentChats(chatsArray.slice(0, 3));

      // Calculate chats from last 30 days using actual chats
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const chats30 = chatsArray.filter((c: any) => {
        const d = new Date(c.createdAt || c.updatedAt || Date.now());
        return d >= thirtyDaysAgo;
      });
      setChatsLast30Days(chats30.length);

      // Active users: deduplicate using real users list to avoid double-counting (userId vs microsoftId)
      const activeUserIdSet: Set<string> = new Set();
      for (const c of chatsArray) {
        const found = (allUsersResponse.users || []).find(
          (u: any) =>
            (c.userId && u._id === c.userId) ||
            (c.microsoftId && u.microsoftId === c.microsoftId) ||
            (c.userEmail && u.email === c.userEmail)
        );
        if (found && found._id) activeUserIdSet.add(String(found._id));
      }
      setActiveUsers(activeUserIdSet.size);

      // Average messages per chat: prefer stats, fallback to messageCount
      if (Array.isArray(chatData?.messagesPerChat) && chatData!.messagesPerChat.length) {
        const sum = chatData!.messagesPerChat.reduce(
          (acc: number, it: any) => acc + (Number(it.count) || 0),
          0
        );
        setAvgMessages(Math.round(sum / chatData!.messagesPerChat.length));
      } else if (chatsArray.length) {
        const sum = chatsArray.reduce(
          (acc: number, it: any) => acc + (Number(it.messageCount) || 0),
          0
        );
        setAvgMessages(Math.round(sum / Math.max(chatsArray.length, 1)));
      } else {
        setAvgMessages(0);
      }

      // Update stats with real data
      setStats(prev => ({
        ...prev,
        totalDocuments: Array.isArray(docs) ? docs.length : 0,
        totalReports: Array.isArray(reps) ? reps.length : 0,
        totalSummaries: Array.isArray(sums) ? sums.length : 0,
        totalChats: chatData?.totalChats || chatsArray.length || 0,
      }));

      // Set loading states to false for main data
      setDocumentsLoading(false);
      setSummariesLoading(false);
      setReportsLoading(false);
      setChatsLoading(false);
      setDashboardLoading(false);

      // Phase 3: Load directories asynchronously (non-blocking, can take longer)
      // This runs in the background and updates when ready
      setDirectoriesLoading(true);
      fetchAllDirectories(3, 5000).then(dirs => {
        setDirectories(Array.isArray(dirs) ? dirs : []);
        setStats(prev => ({
          ...prev,
          totalDirectories: Array.isArray(dirs) ? dirs.length : 0,
        }));
        setDirectoriesLoading(false);
      }).catch(err => {
        console.error("Error loading directories:", err);
        setDirectories([]);
        setDirectoriesLoading(false);
      });
    } catch (error) {
      console.error("Error loading dashboard data:", error);
      // Set all loading states to false on error
      setDocumentsLoading(false);
      setSummariesLoading(false);
      setReportsLoading(false);
      setChatsLoading(false);
      setDashboardLoading(false);
    }
  };

  const handleDownloadDocument = async (doc: Document) => {
    let loadingToast;
    try {
      loadingToast = toast.loading("Download processing...");
      const blob = await documentService.download(doc.id || doc._id);
      if (!blob || blob.size === 0) {
        throw new Error("Empty file received from server");
      }

      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = doc.name || "document.pdf";
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      toast.dismiss(loadingToast);
      toast.success("Document downloaded successfully");
    } catch (error) {
      toast.dismiss(loadingToast);
      toast.error("Error downloading document: " + (error as any).message);
      console.error("Error downloading document:", error);
    }
  };

  const handleDeleteDocument = async (doc: Document) => {
    try {
      await documentService.delete(doc._id);
      setDocuments(documents.filter((d) => d._id !== doc._id));
      // Update stats
      setStats((prev) => ({
        ...prev,
        totalDocuments: prev.totalDocuments - 1,
      }));
    } catch (error) {
      console.error("Error deleting document:", error);
    }
  };

  const handlePrintSummary = async (summary: Summary) => {
    try {
      // Fetch full summary data with content
      const token = localStorage.getItem("accessToken");
      const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000/api";
      const response = await fetch(`${API_URL}/summaries/${summary.id}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (!response.ok) throw new Error("Failed to fetch summary");
      const fullSummary = await response.json();
      const summaryContent = fullSummary.content || "No content available";
      const summaryTitle = fullSummary.title || summary.title || "Summary";

      // Create a print window with the summary content
      const printWindow = window.open("", "", "width=900,height=650");
      if (printWindow) {
        printWindow.document.write(`
          <html>
            <head>
              <title>Print Summary - ${summaryTitle}</title>
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
                }
              </style>
            </head>
            <body>
              <div class="summary-content">
                ${summaryContent}
              </div>
            </body>
          </html>
        `);
        printWindow.document.close();
        printWindow.focus();
        // Open print dialog - user can select "Save as PDF" from the print dialog
        printWindow.print();
      }
    } catch (error) {
      console.error("Error fetching summary for print:", error);
      toast.error("Failed to load summary content for printing");
    }
  };

  const handleDownloadSummaryDocx = async (summary: Summary) => {
    let loadingToast;
    try {
      loadingToast = toast.loading("Download processing...");
      const blob = await summaryService.downloadDocx(summary.id);

      // Check if blob is actually an error response
      if (blob.type && blob.type !== "application/vnd.openxmlformats-officedocument.wordprocessingml.document" && blob.type !== "application/octet-stream") {
        // Might be an error response, try to parse it
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
      const a = document.createElement("a");
      a.href = url;
      a.download = buildDocxFileName(summary.title, "summary");
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      toast.dismiss(loadingToast);
      toast.success("Summary DOCX downloaded successfully");
    } catch (error: any) {
      toast.dismiss(loadingToast);
      const errorMessage = error?.message || "Failed to download DOCX";
      toast.error(errorMessage);
      console.error("Error downloading summary DOCX:", error);
    }
  };

  const handleDeleteSummary = async (summary: Summary) => {
    try {
      await summaryService.delete(summary.id);
      setSummaries(summaries.filter((s) => s.id !== summary.id));
      // Update stats
      setStats((prev) => ({
        ...prev,
        totalSummaries: prev.totalSummaries - 1,
      }));
    } catch (error) {
      console.error("Error deleting summary:", error);
    }
  };

  const handlePrintReport = async (report: Report) => {
    try {
      // Fetch full report data with content
      const fullReport = await reportService.getById(report.id);
      const reportContent = fullReport.content || "No content available";
      const reportTitle = fullReport.title || report.drhpNamespace || "Report";

      // Create a print window with the report content
      const printWindow = window.open("", "", "width=900,height=650");
      if (printWindow) {
        printWindow.document.write(`
          <html>
            <head>
              <title>Print Report - ${reportTitle}</title>
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
                }
              </style>
            </head>
            <body>
              <div class="summary-content">
                ${reportContent}
              </div>
            </body>
          </html>
        `);
        printWindow.document.close();
        printWindow.focus();
        // Open print dialog - user can select "Save as PDF" from the print dialog
        printWindow.print();
      }
    } catch (error) {
      console.error("Error fetching report for print:", error);
      toast.error("Failed to load report content for printing");
    }
  };

  const handleDownloadReportDocx = async (report: Report) => {
    let loadingToast;
    try {
      loadingToast = toast.loading("Download processing...");
      const blob = await reportService.downloadDocx(report.id);

      // Check if blob is actually an error response
      if (blob.type && blob.type !== "application/vnd.openxmlformats-officedocument.wordprocessingml.document" && blob.type !== "application/octet-stream") {
        // Might be an error response, try to parse it
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
      const a = document.createElement("a");
      a.href = url;
      a.download = buildDocxFileName(report.drhpNamespace, "report");
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      toast.dismiss(loadingToast);
      toast.success("Report DOCX downloaded successfully");
    } catch (error: any) {
      toast.dismiss(loadingToast);
      const errorMessage = error?.message || "Failed to download DOCX";
      toast.error(errorMessage);
      console.error("Error downloading report DOCX:", error);
    }
  };

  const handleDeleteReport = async (report: Report) => {
    try {
      await reportService.delete(report.id);
      setReports(reports.filter((r) => r.id !== report.id));
      // Update stats
      setStats((prev) => ({ ...prev, totalReports: prev.totalReports - 1 }));
    } catch (error) {
      console.error("Error deleting report:", error);
    }
  };

  const handleDeleteChat = async (chat: any) => {
    try {
      await chatService.deleteAnyAdmin(chat.id || chat._id);
      setRecentChats(
        recentChats.filter((c) => (c.id || c._id) !== (chat.id || chat._id))
      );
      // Update stats
      setStats((prev) => ({
        ...prev,
        totalChats: prev.totalChats - 1,
      }));
    } catch (error) {
      console.error("Error deleting chat:", error);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString();
  };

  const getUserName = (userId?: string, microsoftId?: string) => {
    if (microsoftId) {
      const user = users.find((u) => u.microsoftId === microsoftId);
      return user ? user.name || user.email : `User ${microsoftId.slice(-4)}`;
    }
    if (userId) {
      const user = users.find((u) => u._id === userId);
      return user ? user.name || user.email : `User ${userId.slice(-4)}`;
    }
    return "Unknown User";
  };

  if (!user || user.role !== "admin") {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-[#4B2A06] mb-4">
            Access Denied
          </h1>
          <p className="text-gray-600">
            You don't have permission to access this page.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar
        title="Dashboard"
        showSearch={true}
        searchValue=""
        onSearchChange={() => { }}
      />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
        <div className="flex space-x-4 border-b border-gray-200">
          <button
            onClick={() => setActiveMainTab("overview")}
            className={`pb-4 px-4 text-sm font-medium transition-colors relative ${activeMainTab === "overview"
              ? "text-[#4B2A06]"
              : "text-gray-500 hover:text-gray-700"
              }`}
          >
            Management Overview
            {activeMainTab === "overview" && (
              <div className="absolute bottom-0 left-0 w-full h-0.5 bg-[#4B2A06]" />
            )}
          </button>
          <button
            onClick={() => setActiveMainTab("health")}
            className={`pb-4 px-4 text-sm font-medium transition-colors relative ${activeMainTab === "health"
              ? "text-[#4B2A06]"
              : "text-gray-500 hover:text-gray-700"
              }`}
          >
            System Health
            {activeMainTab === "health" && (
              <div className="absolute bottom-0 left-0 w-full h-0.5 bg-[#4B2A06]" />
            )}
          </button>
        </div>
      </div>

      <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 py-6 md:py-8">
        {activeMainTab === "overview" ? (
          <>
            {/* Top Section - Responsive Grid: Key Metrics + Reports Chart + Management Lists */}
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
              {/* Left Column- Total Chats Chart */}
              <div className="xl:col-span-2 my-2 md:my-4 border-t border-gray-100 bg-white flex flex-col shadow-sm rounded-lg items-center p-4 md:p-6 self-start">
                <div className="text-lg  font-bold text-[#4B2A06] my-5">
                  Total Chats
                </div>
                <div className="relative mt-2 w-32 h-32 lg:w-40 lg:h-40">
                  <svg
                    className="w-full h-full transform -rotate-90"
                    viewBox="0 0 36 36"
                  >
                    <path
                      className="text-gray-300"
                      stroke="currentColor"
                      strokeWidth="3"
                      fill="transparent"
                      d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                    />
                    <path
                      className="text-[rgba(62,36,7,1)]"
                      stroke="currentColor"
                      strokeWidth="3"
                      fill="transparent"
                      strokeDasharray={`${(stats.totalChats / Math.max(stats.totalChats + 10, 1)) *
                        100
                        }, 100`}
                      d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                    />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-2xl lg:text-3xl font-bold text-[#4B2A06]">
                      {stats.totalChats}
                    </span>
                  </div>
                </div>
              </div>
              {/*  Middle Column - Key Metrics */}
              <div className="xl:col-span-3 mt-2 md:mt-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="shadow-sm  bg-white rounded-lg">
                    <CardHeader className="flex flex-row items-center space-y-0 pb-2">
                      <CardTitle className="text-md font-bold text-[rgba(114, 120, 127, 1)]">
                        Total Users
                      </CardTitle>
                      {/* <User className="h-4 ml-2 w-4 text-[rgba(114, 120, 127, 1)]" /> */}
                    </CardHeader>
                    <CardContent>
                      <div className="  ml-2 text-2xl font-bold text-[rgba(38,40,43,1)]">
                        {dashboardLoading ? (
                          <div className="animate-pulse bg-white/20 h-8 w-16 rounded"></div>
                        ) : (
                          stats.totalUsers
                        )}
                      </div>
                    </CardContent>
                  </div>

                  <div className="shadow-sm bg-white rounded-lg">
                    <CardHeader className="flex flex-row items-center space-y-0 pb-2">
                      <CardTitle className="text-md font-bold text-[rgba(114, 120, 127, 1)]">
                        Total Documents
                      </CardTitle>
                      {/* <InputIcon className="h-4 ml-2 w-4 text-[rgba(114, 120, 127, 1)]" /> */}
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl ml-2 font-bold text-[rgba(38,40,43,1)]">
                        {dashboardLoading ? (
                          <div className="animate-pulse bg-white/20 h-8 w-16 rounded"></div>
                        ) : (
                          stats.totalDocuments
                        )}
                      </div>
                    </CardContent>
                  </div>

                  <div className="shadow-sm bg-white rounded-lg">
                    <CardHeader className="flex flex-row items-center space-y-0  pb-2">
                      <CardTitle className="text-md font-bold text-[rgba(114, 120, 127, 1)]">
                        Total Summaries
                      </CardTitle>
                      {/* <FileText className="h-4 ml-2 w-4 text-[rgba(114, 120, 127, 1)]" /> */}
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl ml-2 font-bold text-[rgba(38,40,43,1)]">
                        {dashboardLoading ? (
                          <div className="animate-pulse bg-white/20 h-8 w-16 rounded"></div>
                        ) : (
                          stats.totalSummaries
                        )}
                      </div>
                    </CardContent>
                  </div>

                  <div className="shadow-sm  bg-white rounded-lg">
                    <CardHeader className="flex flex-row items-center space-y-0  pb-2">
                      <CardTitle className="text-md font-bold text-[rgba(114, 120, 127, 1)]">
                        Total Reports
                      </CardTitle>
                      {/* <BarChart3 className="h-4 ml-2 w-4 text-[rgba(114, 120, 127, 1)]" /> */}
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl ml-2 font-bold text-[rgba(38,40,43,1)]">
                        {dashboardLoading ? (
                          <div className="animate-pulse bg-white/20 h-8 w-16 rounded"></div>
                        ) : (
                          stats.totalReports
                        )}
                      </div>
                    </CardContent>
                  </div>
                </div>
              </div>



              {/* Right Columns - Management Lists */}
              <div className="xl:col-span-7 xl:border-l border-gray-200 xl:pl-2">
                {/* Document Management */}
                <div className="p-4">
                  <h2 className="text-xl font-bold text-[#4B2A06] mb-3">
                    Document Management
                  </h2>
                  <div className="text-sm font-medium text-gray-600 mb-3">
                    All Documents ({documents.length})
                  </div>
                  <div className="max-h-[40vh] xl:max-h-[25vh] overflow-y-auto scrollbar-hide">
                    {documentsLoading ? (
                      <div className="text-center py-4 text-gray-600">
                        Loading documents...
                      </div>
                    ) : documents.length === 0 ? (
                      <div className="text-center py-4 text-gray-600">
                        No documents found
                      </div>
                    ) : (
                      documents.map((doc, index) => (
                        <div
                          key={doc._id}
                          className="flex items-center justify-between px-2 py-2  bg-white rounded-lg hover:bg-gray-50 border-b border-gray-200"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <FileText className="h-4 w-4  text-gray-600" />
                            <div className="min-w-0">
                              <div
                                className="font-medium text-[#4B2A06] text-sm truncate"
                                title={(doc.name || doc.namespace || `Document ${index + 1}`) as string}
                                style={{ maxWidth: '200px' }}
                              >
                                {(doc.name || doc.namespace || `Document ${index + 1}`).length > 25
                                  ? `${(doc.name || doc.namespace || `Document ${index + 1}`).substring(0, 25)}...`
                                  : (doc.name || doc.namespace || `Document ${index + 1}`)
                                }
                              </div>
                              <div className="text-xs text-gray-500">
                                Created: {formatDate(doc.createdAt)}
                              </div>
                              <div className="text-xs text-[#4B2A06] font-bold">
                                Workspace: {doc.workspaceId?.name || "excollo"}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <button
                                  className="p-1 hover:bg-gray-100 rounded transition-colors"
                                  title="More actions"
                                >
                                  <MoreVertical className="h-4 w-4 text-gray-600" />
                                </button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="bg-white w-48 border border-gray-200">
                                <DropdownMenuItem
                                  onClick={() => handleDownloadDocument(doc)}
                                  className="flex items-center gap-2 cursor-pointer hover:bg-white data-[highlighted]:bg-gray-50"
                                >
                                  <Download className="h-4 w-4" />
                                  <span>Download</span>
                                </DropdownMenuItem>
                                <DropdownMenuItem className="flex items-center gap-2 cursor-pointer hover:bg-white data-[highlighted]:bg-gray-50">
                                  <Eye className="h-4 w-4" />
                                  <DocumentPopover
                                    documentId={doc.id as string}
                                    documentName={(doc.namespace || doc.name || "Document") as string}
                                    renderAsButton
                                    buttonLabel="View Document"
                                    buttonClassName="text-sm text-[#4B2A06]"
                                  />
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => handleDeleteDocument(doc)}
                                  className="flex items-center gap-2 cursor-pointer hover:bg-white data-[highlighted]:bg-gray-50 text-red-600 focus:text-red-600"
                                >
                                  <Trash2 className="h-4 w-4" />
                                  <span>Delete</span>
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Directories Management Section */}
            <div className="mt-8 border-t border-gray-200 pt-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-4">
                <h2 className="text-2xl font-bold text-[#4B2A06] mb-2 sm:mb-0">Directory Management</h2>
                <div className="flex items-center gap-4">
                  <div className="text-md font-bold text-[#4B2A06]">
                    Total Directories : {directoriesLoading ? (
                      <span className="inline-flex items-center">
                        <svg className="animate-spin h-4 w-4 ml-2 text-[#4B2A06]" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                      </span>
                    ) : (
                      directories.length
                    )}
                  </div>
                  {/* Sort Dropdown */}
                  {!directoriesLoading && directories.length > 0 && (
                    <div className="relative flex items-center mr-2" style={{ zIndex: 50 }}>
                      {(() => {
                        const sortOptions = [
                          { value: "alphabetical", label: "A-Z" },
                          { value: "lastModified", label: "Last Modified" }
                        ];
                        const selectedSort = sortOptions.find(opt => opt.value === directorySortBy) || sortOptions[0];

                        return (
                          <>
                            <button
                              type="button"
                              onClick={() => setShowDirectorySort(!showDirectorySort)}
                              className={`flex items-center gap-2 font-semibold px-4 py-2 rounded-lg text-[#5A6473] transition-colors cursor-pointer relative bg-[#F3F4F6] hover:bg-[#E5E7EB]`}
                              style={{
                                paddingRight: '2.5rem',
                              }}
                            >
                              <span>Sort: {selectedSort.label}</span>
                              {showDirectorySort ? (
                                <ChevronUp className="h-4 w-4 absolute right-2" />
                              ) : (
                                <ChevronDown className="h-4 w-4 absolute right-2" />
                              )}
                            </button>

                            {/* Dropdown Menu */}
                            {showDirectorySort && (
                              <>
                                {/* Backdrop to close on outside click */}
                                <div
                                  className="fixed inset-0 z-40"
                                  onClick={() => setShowDirectorySort(false)}
                                />
                                {/* Dropdown Options */}
                                <div
                                  className="absolute top-full right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 min-w-[180px]"
                                  style={{ bottom: 'auto' }}
                                >
                                  {sortOptions.map((option) => (
                                    <button
                                      key={option.value}
                                      type="button"
                                      onClick={() => {
                                        setDirectorySortBy(option.value as "alphabetical" | "lastModified");
                                        setShowDirectorySort(false);
                                      }}
                                      className={`w-full text-left px-4 py-2 text-sm font-medium transition-colors ${directorySortBy === option.value
                                        ? 'bg-[#F3F4F6] text-[#4B2A06]'
                                        : 'text-[#5A6473] hover:bg-[#F3F4F6]'
                                        } ${option.value === sortOptions[0].value ? 'rounded-t-lg' : ''} ${option.value === sortOptions[sortOptions.length - 1].value ? 'rounded-b-lg' : ''
                                        }`}
                                    >
                                      {option.label}
                                    </button>
                                  ))}
                                </div>
                              </>
                            )}
                          </>
                        );
                      })()}
                    </div>
                  )}
                </div>
              </div>
              {/* Sort directories based on selected sort option */}
              {(() => {
                const sortedDirectories = [...directories].sort((a: any, b: any) => {
                  if (directorySortBy === "alphabetical") {
                    // Sort alphabetically ascending (A-Z)
                    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
                  } else if (directorySortBy === "lastModified") {
                    // Sort by last modified date (newest first)
                    const dateA = a.lastDocumentUpload || a.createdAt || a.updatedAt || 0;
                    const dateB = b.lastDocumentUpload || b.createdAt || b.updatedAt || 0;
                    const timeA = dateA ? new Date(dateA).getTime() : 0;
                    const timeB = dateB ? new Date(dateB).getTime() : 0;
                    return timeB - timeA; // Descending (newest first)
                  }
                  return 0;
                });

                return (
                  <div className="max-h-[35vh] overflow-y-auto  pr-2 scrollbar-hide">
                    {directoriesLoading ? (
                      <div className="flex items-center justify-center py-8">
                        <div className="flex flex-col items-center gap-3">
                          <svg className="animate-spin h-8 w-8 text-[#4B2A06]" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                          </svg>
                          <div className="text-sm text-gray-600">Loading directories...</div>
                        </div>
                      </div>
                    ) : sortedDirectories.length === 0 ? (
                      <div className="text-center py-4 text-gray-600">No directories found</div>
                    ) : (
                      sortedDirectories.map((dir) => (
                        <div key={dir.id} className="flex items-center justify-between p-2 rounded-lg bg-white hover:bg-gray-50 border-b border-gray-200">
                          <div className="flex items-center gap-3">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6B7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M3 7h5l2 3h11v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                              <path d="M3 7V5a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v3" />
                            </svg>
                            <div>
                              <div className="font-medium text-[#4B2A06] text-sm">{dir.name}</div>
                              <div className="text-xs text-gray-500">ID: {dir.id}</div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              className="px-3 py-1 text-sm hover:text-[#4B2A06]  "
                              onClick={() => { setShareDirId(dir.id); setShareOpen(true); }}
                              title="Share directory"
                            >
                              <Share2 className="h-4 w-4" />
                            </button>
                            <button
                              className="px-3 py-1 text-sm hover:text-red-600  "
                              onClick={async () => {
                                if (!window.confirm(`Delete folder "${dir.name}" and all documents inside?`)) return;
                                try {
                                  await directoryService.delete(dir.id);
                                  const updated = directories.filter((d) => d.id !== dir.id);
                                  setDirectories(updated);
                                  setStats((prev) => ({ ...prev, totalDirectories: Math.max((prev.totalDirectories || 1) - 1, 0) }));
                                } catch (e) {
                                  console.error('Failed to delete directory', e);
                                  toast.error('Failed to delete directory');
                                }
                              }}
                              title="Delete directory"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                );
              })()}
            </div>

            {/* Summary Management Section - Full Width */}
            <div className="mt-8 border-t border-gray-200 pt-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-6">
                <h2 className="text-2xl font-bold text-[#4B2A06] mb-2 sm:mb-0">
                  Summary Management
                </h2>
                <div className="text-md font-bold text-[#4B2A06]">
                  Total Summaries : {summaries.length}
                </div>
              </div>
              <div className="max-h-[40vh] overflow-y-auto overflow-x-none pr-2 scrollbar-hide">
                {summariesLoading ? (
                  <div className="text-center py-4 text-gray-600">
                    Loading summaries...
                  </div>
                ) : summaries.length === 0 ? (
                  <div className="text-center py-4 text-gray-600">
                    No summaries found
                  </div>
                ) : (
                  summaries.map((summary, index) => (
                    <div
                      key={summary.id}
                      className={`flex items-center justify-between p-2 rounded-lg bg-white hover:bg-[rgba(62, 36, 7, 0.13)] border-b border-gray-200 ${index === 0
                        ? "bg-[rgba(62, 36, 7, 0.13)] border-amber-200"
                        : ""
                        }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <FileText className="h-4 w-4 text-gray-600" />
                        <div className="min-w-0">
                          <div
                            className="font-medium text-[#4B2A06] flex items-center gap-2 text-sm truncate"
                            title={(summary.title || `Summary ${index + 1}`) as string}
                            style={{ maxWidth: '260px' }}
                          >
                            {(summary.title || `Summary ${index + 1}`).length > 35
                              ? `${(summary.title || `Summary ${index + 1}`).substring(0, 35)}...`
                              : (summary.title || `Summary ${index + 1}`)
                            }
                          </div>
                          <div className="text-xs text-gray-500">
                            Created:{" "}
                            {formatDate(summary.updatedAt)}
                          </div>
                          <div className="text-xs text-[#4B2A06] font-bold">
                            Workspace: {summary.workspaceId?.name || 'Unknown'}
                          </div>
                          {index === 0 && (
                            <div className="text-xs text-gray-500 font-medium">
                              Latest Summary
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              className="p-1 hover:bg-gray-100 rounded transition-colors"
                              title="More actions"
                            >
                              <MoreVertical className="h-4 w-4 text-gray-600" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="bg-white w-56 border border-gray-200">
                            <DropdownMenuItem
                              onClick={() => handlePrintSummary(summary)}
                              className="flex items-center gap-2 cursor-pointer hover:bg-white data-[highlighted]:bg-gray-50"
                            >
                              <Printer className="h-4 w-4" />
                              <span>Print (Save as PDF)</span>
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => setViewSummaryId(summary.id)}
                              className="flex items-center gap-2 cursor-pointer hover:bg-white data-[highlighted]:bg-gray-50"
                            >
                              <Eye className="h-4 w-4" />
                              <span>View</span>
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => handleDownloadSummaryDocx(summary)}
                              className="flex items-center gap-2 cursor-pointer hover:bg-white data-[highlighted]:bg-gray-50"
                            >
                              <FileText className="h-4 w-4" />
                              <span>Download DOCX</span>
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => navigate(`/doc/${summary.documentId}`)}
                              className="flex items-center gap-2 cursor-pointer hover:bg-white data-[highlighted]:bg-gray-50"
                            >
                              <Eye className="h-4 w-4" />
                              <span>View Document</span>
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => handleDeleteSummary(summary)}
                              className="flex items-center gap-2 cursor-pointer hover:bg-white data-[highlighted]:bg-gray-50 text-red-600 focus:text-red-600"
                            >
                              <Trash2 className="h-4 w-4" />
                              <span>Delete</span>
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <ShareDialog
              resourceType="directory"
              resourceId={shareDirId}
              open={shareOpen}
              onOpenChange={(o) => { setShareOpen(o); if (!o) setShareDirId(null); }}
            />

            <ViewSummaryModal
              summaryId={viewSummaryId}
              open={!!viewSummaryId}
              onOpenChange={(o) => { if (!o) setViewSummaryId(null); }}
              title="Summary Preview"
            />
            <ViewReportModal
              reportId={viewReportId}
              open={!!viewReportId}
              onOpenChange={(o) => { if (!o) setViewReportId(null); }}
              title="Report Preview"
            />

            <CreateWorkspaceModal
              open={createWorkspaceOpen}
              onOpenChange={setCreateWorkspaceOpen}
              onCreated={() => {
                loadWorkspaces();
                setCreateWorkspaceOpen(false);
              }}
            />

            <Dialog open={addUsersOpen} onOpenChange={setAddUsersOpen}>
              <DialogContent className="sm:max-w-lg bg-white">
                <DialogHeader>
                  <DialogTitle className="text-[#4B2A06]">Add users to {targetWorkspace?.name}</DialogTitle>
                </DialogHeader>
                <div className="space-y-3">
                  <Input
                    placeholder="Search users by name or email"
                    value={userSearch}
                    onChange={(e) => setUserSearch(e.target.value)}
                    className="bg-white border-gray-300 text-[#4B2A06]"
                  />
                  <div className="max-h-64 overflow-y-auto border border-gray-200 rounded">
                    {filteredAddableUsers.length === 0 ? (
                      <div className="p-3 text-sm text-gray-500">No users found</div>
                    ) : (
                      filteredAddableUsers.map((u: any) => (
                        <label key={u._id} className="flex items-center gap-2 p-2 hover:bg-gray-50 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={selectedUserIds.includes(u._id)}
                            onChange={() => toggleSelected(u._id)}
                          />
                          <div className="flex-1">
                            <div className="text-sm text-[#4B2A06]">{u.name || u.email}</div>
                            <div className="text-xs text-gray-500">{u.email}</div>
                          </div>
                        </label>
                      ))
                    )}
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setAddUsersOpen(false)} className="bg-white text-[#4B2A06] border-gray-300 hover:bg-gray-50">Cancel</Button>
                  <Button onClick={handleAddUsersConfirm} disabled={selectedUserIds.length === 0} className="bg-[#4B2A06] text-white hover:bg-[#3A2004]">Add</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <Dialog open={removeUsersOpen} onOpenChange={setRemoveUsersOpen}>
              <DialogContent className="sm:max-w-lg bg-white">
                <DialogHeader>
                  <DialogTitle className="text-[#4B2A06]">Remove users from {targetWorkspace?.name}</DialogTitle>
                </DialogHeader>
                <div className="space-y-3">
                  <Input
                    placeholder="Search members"
                    value={userSearch}
                    onChange={(e) => setUserSearch(e.target.value)}
                    className="bg-white border-gray-300 text-[#4B2A06]"
                  />
                  <div className="max-h-64 overflow-y-auto border border-gray-200 rounded">
                    {filteredRemovableUsers.length === 0 ? (
                      <div className="p-3 text-sm text-gray-500">No members found</div>
                    ) : (
                      filteredRemovableUsers.map((m: any) => (
                        <label key={m._id} className="flex items-center gap-2 p-2 hover:bg-gray-50 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={selectedUserIds.includes(m._id)}
                            onChange={() => toggleSelected(m._id)}
                          />
                          <div className="flex-1">
                            <div className="text-sm text-[#4B2A06]">{m.name || m.email}</div>
                            <div className="text-xs text-gray-500">{m.email}</div>
                          </div>
                        </label>
                      ))
                    )}
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setRemoveUsersOpen(false)} className="bg-white text-[#4B2A06] border-gray-300 hover:bg-gray-50">Cancel</Button>
                  <Button onClick={handleRemoveUsersConfirm} disabled={selectedUserIds.length === 0} className="bg-[#4B2A06] text-white hover:bg-[#3A2004]">Remove</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            {/* Bottom Section - Quick View */}
            <div className="mt-8 border-t border-gray-200 pt-6">
              <h2 className="text-2xl font-bold text-[#4B2A06] mb-6">Quick View</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <Card
                  className="bg-[#637587] text-white cursor-pointer  transition-colors"
                  onClick={() => navigate("/admin/users")}
                >
                  <CardContent className="p-6">
                    <h3 className="text-lg font-semibold mb-2">User Management</h3>
                    <p className="text-sm text.white/80">
                      Manage User Roles and Permissions
                    </p>
                  </CardContent>
                </Card>

                {/* Domain Configuration card removed */}

                <Card
                  className="bg-[#637587] text-white cursor-pointer hover:bg-[#637587] transition-colors"
                  onClick={() => navigate("/dashboard")}
                >
                  <CardContent className="p-6">
                    <h3 className="text-lg font-semibold mb-2">
                      Document Management
                    </h3>
                    <p className="text-sm text-white/80">Manage Documents</p>
                  </CardContent>
                </Card>

                <Card
                  className="bg-[#637587] text-white cursor-pointer hover:bg-[#637587] transition-colors"
                  onClick={() => navigate("/chat-history")}
                >
                  <CardContent className="p-6">
                    <h3 className="text-lg font-semibold mb-2">Chat Management</h3>
                    <p className="text-sm text-white/80">Manage chats history</p>
                  </CardContent>
                </Card>

                <Card
                  className="bg-[#637587] text-white cursor-pointer hover:bg-[#637587] transition-colors"
                  onClick={() => navigate("/profile")}
                >
                  <CardContent className="p-6">
                    <h3 className="text-lg font-semibold mb-2">
                      Profile Management
                    </h3>
                    <p className="text-sm text-white/80">
                      Manage profile and settings
                    </p>
                  </CardContent>
                </Card>
              </div>
            </div>

            {/* Chat Management Section */}
            <div className="w-full mx-auto mt-8 border-t border-gray-200 pt-6">
              <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
                {/* Left Column - Chat Statistics */}
                <div className="xl:col-span-4 xl:border-r border-gray-200 xl:pr-6">
                  <h2 className="text-2xl font-bold text-[#4B2A06] ">
                    Chat Management
                  </h2>
                  <div className="grid grid-cols-2 gap-4 pt-3">
                    <div className="shadow-sm bg-white rounded-lg" >
                      <CardHeader className="flex flex-row items-center space-y-0 ">
                        <CardTitle className="text-md font-bold text-[rgba(114, 120, 127, 1)]">
                          Total Chats
                        </CardTitle>
                        <MessageSquare className="h-4 ml-2 w-4 text-[rgba(114, 120, 127, 1)]" />
                      </CardHeader>
                      <CardContent>
                        <div className="ml-2 text-2xl font-bold text-[rgba(38,40,43,1)]">
                          {dashboardLoading ? (
                            <div className="animate-pulse bg-white/20 h-8 w-16 rounded"></div>
                          ) : (
                            stats.totalChats
                          )}
                        </div>
                      </CardContent>
                    </div>

                    <div className="shadow-sm bg-white rounded-lg">
                      <CardHeader className="flex flex-row items-center space-y-0 ">
                        <CardTitle className="text-md font-bold text-[rgba(114, 120, 127, 1)]">
                          Avg Messages
                        </CardTitle>
                        <BarChart3 className="h-4 ml-2 w-4 text-[rgba(114, 120, 127, 1)]" />
                      </CardHeader>
                      <CardContent>
                        <div className="text-2xl ml-2 font-bold text-[rgba(38,40,43,1)]">
                          {dashboardLoading ? (
                            <div className="animate-pulse bg-white/20 h-8 w-16 rounded"></div>
                          ) : (
                            avgMessages
                          )}
                        </div>
                      </CardContent>
                    </div>

                    <div className="shadow-sm bg-white rounded-lg">
                      <CardHeader className="flex flex-row items-center space-y-0 ">
                        <CardTitle className="text-md font-bold text-[rgba(114, 120, 127, 1)]">
                          Last 30 days
                        </CardTitle>
                        <FileText className="h-4 ml-2 w-4 text-[rgba(114, 120, 127, 1)]" />
                      </CardHeader>
                      <CardContent>
                        <div className="text-2xl ml-2 font-bold text-[rgba(38,40,43,1)]">
                          {dashboardLoading ? (
                            <div className="animate-pulse bg.white/20 h-8 w-16 rounded"></div>
                          ) : (
                            chatsLast30Days
                          )}
                        </div>
                      </CardContent>
                    </div>

                    <div className="shadow-sm bg-white rounded-lg">
                      <CardHeader className="flex flex-row items-center space-y-0 ">
                        <CardTitle className="text-md font-bold text-[rgba(114, 120, 127, 1)]">
                          Active users
                        </CardTitle>
                        <User className="h-4 ml-2 w-4 text-[rgba(114, 120, 127, 1)]" />
                      </CardHeader>
                      <CardContent>
                        <div className="text-2xl ml-2 font-bold text-[rgba(38,40,43,1)]">
                          {dashboardLoading ? (
                            <div className="animate-pulse bg-white/20 h-8 w-16 rounded"></div>
                          ) : (
                            activeUsers
                          )}
                        </div>
                      </CardContent>
                    </div>
                  </div>
                </div>

                {/* Right Column - Recent Chat Sessions */}
                <div className="xl:col-span-8">
                  <h3 className="text-2xl font-bold text-[#4B2A06] mb-5">
                    Recent Chat Sessions
                  </h3>
                  <div >
                    {chatsLoading ? (
                      <div className="text-center py-8 text-gray-600">
                        Loading chat sessions...
                      </div>
                    ) : recentChats.length === 0 ? (
                      <div className="text-center py-8 text-gray-600">
                        No recent chat sessions found
                      </div>
                    ) : (
                      recentChats.map((chat, index) => (
                        <div
                          key={chat.id || chat._id}
                          className="flex items-center justify-between p-4 bg-white rounded-lg hover:bg-gray-50 transition-colors border-b border-gray-200"
                        >
                          <div className="flex items-center gap-3">
                            {/* User Avatar */}
                            <div className="w-10 h-10 bg-[#637587] text-white rounded-full flex items-center justify-center  font-semibold text-sm">
                              {getUserName(chat.userId, chat.microsoftId)
                                .charAt(0)
                                .toUpperCase()}
                            </div>
                            <div>
                              <div className="font-medium text-[#4B2A06] text-sm">
                                {getUserName(chat.userId, chat.microsoftId)}
                              </div>
                              <div className="text-xs text-gray-500">
                                Document: {chat.documentId}
                              </div>
                              <div className="text-xs text-gray-500 font-medium">
                                Created by:{" "}
                                {getUserName(chat.userId, chat.microsoftId)}
                              </div>
                            </div>
                          </div>
                          <button
                            className="p-2 hover:bg-red-50 rounded-full transition-colors group"
                            onClick={() => handleDeleteChat(chat)}
                            title="Delete Chat"
                          >
                            <Trash2 className="h-4 w-4 text-gray-400 group-hover:text-red-500" />
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Report Management Section - Full Width */}
            <div className="mt-8 border-t border-gray-200 pt-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-6">
                <h2 className="text-2xl font-bold text-[#4B2A06] mb-2 sm:mb-0">
                  Report Management
                </h2>
                <div className="text-md font-bold text-[#4B2A06]">
                  Total Reports : {reports.length}
                </div>
              </div>
              <div className="h-[40vh] overflow-y-auto  pr-2 scrollbar-hide">
                {reportsLoading ? (
                  <div className="text-center py-4 text-gray-600">
                    Loading reports...
                  </div>
                ) : reports.length === 0 ? (
                  <div className="text-center py-4 text-gray-600">
                    No reports found
                  </div>
                ) : (
                  reports.map((report, index) => (
                    <div
                      key={report.id}
                      className="flex items-center justify-between p-2 rounded-lg bg-white hover:bg-gray-50 border-b border-gray-200"
                    >
                      <div className="flex items-center gap-3">
                        <FileText className="h-4 w-4 text-gray-600" />
                        <div>
                          <div className="font-medium text-[#4B2A06] text-sm">
                            Report For Document: {report.drhpNamespace}
                          </div>
                          <div className="text-xs text-gray-500">
                            Document: {report.drhpNamespace}
                          </div>
                          <div className="text-xs text-[#4B2A06] font-bold">
                            Workspace: {report.workspaceId?.name || 'Unknown'}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <DropdownMenu >
                          <DropdownMenuTrigger asChild>
                            <button
                              className="p-1 hover:bg-gray-100 rounded transition-colors"
                              title="More actions"
                            >
                              <MoreVertical className="h-4 w-4 text-gray-600" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent className="bg-white w-56 border border-gray-200 " align="end" >
                            <DropdownMenuItem
                              onClick={() => handlePrintReport(report)}
                              className="flex items-center gap-2 cursor-pointer hover:bg-white data-[highlighted]:bg-gray-50"
                            >
                              <Printer className="h-4 w-4 " />
                              <span>Print (Save as PDF)</span>
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => setViewReportId(report.id)}
                              className="flex items-center gap-2 cursor-pointer hover:bg-white data-[highlighted]:bg-gray-50"
                            >
                              <Eye className="h-4 w-4" />
                              <span>View</span>
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => handleDownloadReportDocx(report)}
                              className="flex items-center gap-2 cursor-pointer hover.bg-white data-[highlighted]:bg-gray-50"
                            >
                              <FileText className="h-4 w-4" />
                              <span>Download DOCX</span>
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => handleDeleteReport(report)}
                              className="flex items-center gap-2 cursor-pointer hover:bg-white data-[highlighted]:bg-gray-50 text-red-600 focus:text-red-600"
                            >
                              <Trash2 className="h-4 w-4" />
                              <span>Delete</span>
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Workspace Management Section */}
            <div className="mt-8 border-t border-gray-200 pt-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-6">
                <h2 className="text-2xl font-bold text-[#4B2A06] mb-4 sm:mb-0">
                  Workspace Management
                </h2>
                <button
                  onClick={() => setCreateWorkspaceOpen(true)}
                  className="px-4 py-2 bg-[#4B2A06] text-white rounded-lg hover:bg-[#3A2004] transition-colors flex items-center gap-2"
                >
                  <Plus className="h-4 w-4" />
                  Create Workspace
                </button>
              </div>
              <div className="text-sm font-medium text-gray-600 mb-3">
                All Workspaces ({workspaces.length})
              </div>
              <div className="max-h-[30vh]  overflow-y-auto pr-2 scrollbar-hide">
                {workspacesLoading ? (
                  <div className="text-center py-4 text-gray-600">
                    Loading workspaces...
                  </div>
                ) : workspaces.length === 0 ? (
                  <div className="text-center py-4 text-gray-600">
                    No workspaces found
                  </div>
                ) : (
                  workspaces.map((workspace) => (
                    <div
                      key={workspace.workspaceId}
                      className="flex items-center justify-between p-3 rounded-lg bg-white hover:bg-gray-50 border-b border-gray-200"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div
                          className="w-4 h-4 rounded"
                          style={{ backgroundColor: workspace.color || "#4B2A06" }}
                        />
                        <div className="min-w-0">
                          {editingWorkspace?.workspaceId === workspace.workspaceId ? (
                            <div className="flex items-center gap-2">
                              <input
                                value={editingName}
                                onChange={(e) => setEditingName(e.target.value)}
                                className="border border-gray-300 rounded px-2 py-1 text-sm w-48"
                                placeholder="Workspace name"
                              />
                              <button
                                onClick={() => handleRenameWorkspace(workspace)}
                                className="text-green-600 hover:text-green-700"
                                title="Save"
                              >
                                <Check className="h-4 w-4" />
                              </button>
                              <button
                                onClick={() => {
                                  setEditingWorkspace(null);
                                  setEditingName("");
                                }}
                                className="text-gray-500 hover:text-gray-700"
                                title="Cancel"
                              >
                                <X className="h-4 w-4" />
                              </button>
                            </div>
                          ) : (
                            <div>
                              <div className="font-medium text-[#4B2A06] text-sm">
                                {workspace.name || workspace.workspaceId}
                              </div>
                              <div className="text-xs text-gray-500">
                                ID: {workspace.workspaceId} • {workspace.status}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {editingWorkspace?.workspaceId !== workspace.workspaceId && (
                          <>
                            <button
                              onClick={() => openAddUsers(workspace)}
                              className="px-2 py-1 text-sm rounded bg-white text-[#4B2A06] border border-gray-200 hover:bg-gray-50"
                            >
                              Add user
                            </button>
                            <button
                              onClick={() => openRemoveUsers(workspace)}
                              className="px-2 py-1 text-sm rounded bg-white text-[#4B2A06] border border-gray-200 hover:bg-gray-50"
                            >
                              Remove user
                            </button>
                            <button
                              onClick={() => {
                                setTargetWorkspace(workspace);
                                setViewRequestsOpen(true);
                              }}
                              className="px-2 py-1 text-sm rounded bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100"
                              title="View requests"
                            >
                              Requests
                            </button>
                            <button
                              onClick={() => {
                                setEditingWorkspace(workspace);
                                setEditingName(workspace.name);
                              }}
                              className="p-1 hover:bg-gray-100 rounded transition-colors"
                              title="Rename workspace"
                            >
                              <Pencil className="h-4 w-4 text-gray-600" />
                            </button>
                            {workspace.workspaceId !== "default" && (
                              <button
                                onClick={() => handleDeleteWorkspace(workspace)}
                                className="p-1 hover:bg-red-50 rounded transition-colors"
                                title="Archive workspace"
                              >
                                <Trash2 className="h-4 w-4 text-red-600" />
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <Separator className="border-t border-gray-200 mt-5" />
            {/* Workspace Request Management Dialog */}
            <Dialog open={viewRequestsOpen} onOpenChange={setViewRequestsOpen}>
              <DialogContent className="max-w-2xl max-h-[70vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Workspace Access Requests</DialogTitle>
                </DialogHeader>
                {targetWorkspace && (
                  <WorkspaceRequestsManager
                    workspaceId={targetWorkspace.workspaceId}
                    workspaceName={targetWorkspace.name}
                  />
                )}
              </DialogContent>
            </Dialog>

            {/* Workspace Invitation Management Section */}
            <div className=" pt-6">
              {/* Workspace Members Management - Comprehensive member management */}
              <WorkspaceMembersManagement />

              {/* Invitee Management - List of all members and their access */}
              <InviteeManagement />
            </div>
          </>
        ) : (
          <SystemHealth />
        )}
      </div>
    </div>
  );
}
