import React, { useEffect, useState, useRef } from "react";
import { Plus, Folder, Bell, ChevronDown, ChevronRight, Trash2, Edit2, Check, X, Building2, UserPlus } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { directoryService, notificationsService } from "@/services/api";
import { workspaceInvitationService, UserWorkspace } from "@/services/workspaceInvitationService";
import { useAuth } from "@/contexts/AuthContext";
import { CreateWorkspaceModal } from "@/components/workspacecomponents/CreateWorkspaceModal";
import { AvailableWorkspacesList } from "@/components/workspacecomponents/AvailableWorkspacesList";
import { WorkspaceInvitationPopover } from "@/components/workspacecomponents/WorkspaceInvitationPopover";
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";

type FolderItem = { id: string; name: string };

interface FolderSidebarProps {
  onFolderOpen?: (folder: FolderItem) => void;
  onFolderDeleted?: () => void;
  refreshNotifications?: boolean; // Add this to trigger refresh
}

export const FolderSidebar: React.FC<FolderSidebarProps> = ({ onFolderOpen, onFolderDeleted, refreshNotifications }) => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [newName, setNewName] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<FolderItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const createRef = useRef<HTMLDivElement | null>(null);
  const [renaming, setRenaming] = useState<FolderItem | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [workspaces, setWorkspaces] = useState<UserWorkspace[]>([]);
  const [currentWorkspace, setCurrentWorkspace] = useState<string>("");
  const [workspacesLoading, setWorkspacesLoading] = useState(false);
  const [showWorkspaces, setShowWorkspaces] = useState(true);
  const [showCreateWorkspaceModal, setShowCreateWorkspaceModal] = useState(false);
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [selectedWorkspaceForInvite, setSelectedWorkspaceForInvite] = useState<{ workspaceId: string; workspaceName: string } | null>(null);
  const [hoveredWorkspace, setHoveredWorkspace] = useState<string | null>(null);

  const loadRootFolders = async () => {
    try {
      setLoading(true);
      const data = await directoryService.listChildren("root");
      const onlyDirs = (data?.items || [])
        .filter((x: { kind: string }) => x.kind === "directory")
        .map((x: { item: FolderItem }) => x.item);
      setFolders(onlyDirs);
    } catch (e: unknown) {
      toast.error("Failed to load folders");
    } finally {
      setLoading(false);
    }
  };

  const loadWorkspaces = async () => {
    try {
      setWorkspacesLoading(true);
      const data = await workspaceInvitationService.getUserWorkspaces();
      setWorkspaces(data.workspaces || []);
      const workspaceId = data.currentWorkspace || data.workspaces?.[0]?.workspaceDomain || "";
      setCurrentWorkspace(workspaceId);
      
      // Update localStorage with the correct workspace ID
      if (workspaceId) {
        const { setCurrentWorkspace } = await import("@/services/workspaceContext");
        setCurrentWorkspace(workspaceId);
      }
      
      // If no workspaces and user is admin, show message
      if (data.workspaces.length === 0) {
        // Workspace modal should already be handled by ProtectedLayout
      }
    } catch (error) {
      console.error("Error loading workspaces:", error);
    } finally {
      setWorkspacesLoading(false);
    }
  };

  const handleWorkspaceChange = async (workspaceDomain: string) => {
    try {
      const result = await workspaceInvitationService.switchWorkspace(workspaceDomain);
      const newWorkspace = result.currentWorkspace || workspaceDomain;
      setCurrentWorkspace(newWorkspace);
      
      // Update localStorage
      const { setCurrentWorkspace: setWorkspace } = await import("@/services/workspaceContext");
      setWorkspace(newWorkspace);
      
      toast.success(`Switched to ${workspaces.find((w) => w.workspaceDomain === workspaceDomain)?.workspaceName || workspaceDomain}`);
      window.location.reload();
    } catch (error) {
      console.error("Error switching workspace:", error);
      toast.error("Failed to switch workspace");
    }
  };

  const getDisplayName = (ws: UserWorkspace): string => {
    const existing = (ws.workspaceName || "").trim();
    if (existing && existing.toLowerCase() !== `${(ws.workspaceDomain || "").toLowerCase()} workspace`) {
      return existing;
    }
    const domain = (ws.workspaceDomain || "").split(".")[0];
    return `${domain.charAt(0).toUpperCase() + domain.slice(1)} Workspace`;
  };

  useEffect(() => {
    loadRootFolders();
    loadWorkspaces();
    let active = true;
    const loadUnread = async () => {
      try {
        const res = await notificationsService.list({ unread: true, page: 1, pageSize: 1 });
        console.log('Unread notifications response:', res);
        if (active) {
          const count = res.total || 0;
          setUnreadCount(count);
          console.log('Set unread count to:', count);
        }
      } catch (error) {
        console.error('Failed to load unread count:', error);
        if (active) setUnreadCount(0);
      }
    };
    
    // Load immediately
    loadUnread();
    
    // Then load every 30 seconds (more frequent for testing)
    const id = setInterval(loadUnread, 30000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  // Refresh notifications when refreshNotifications prop changes
  useEffect(() => {
    if (refreshNotifications) {
      const loadUnread = async () => {
        try {
          const res = await notificationsService.list({ unread: true, page: 1, pageSize: 1 });
          const count = res.total || 0;
          setUnreadCount(count);
          console.log('Refreshed unread count to:', count);
        } catch (error) {
          console.error('Failed to refresh unread count:', error);
        }
      };
      loadUnread();
    }
  }, [refreshNotifications]);

  useEffect(() => {
    const onDoc = (ev: MouseEvent) => {
      if (!showCreate) return;
      const el = createRef.current;
      if (el && !el.contains(ev.target as Node)) {
        setShowCreate(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [showCreate]);

  const handleCreateFolder = async () => {
    if (!newName.trim()) {
      toast.error("Folder name is required");
      return;
    }
    try { 
      setCreating(true);
      const created = await directoryService.create(newName.trim(), null);
      setNewName("");
      setShowCreate(false);
      await loadRootFolders();
      if (created?.id) {
        onFolderOpen?.({ id: created.id, name: created.name });
      }
      toast.success("Folder created");
    } catch (e: unknown) {
      if ((e as any)?.response?.status === 409) {
        toast.error("A folder with this name already exists");
      } else {
        toast.error("Failed to create folder");
      }
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteFolder = async () => {
    if (!deleteConfirm) return;
    
    try {
      setDeleting(true);
      await directoryService.delete(deleteConfirm.id);
      // Remove directory from recent directories if it exists there
      if (currentWorkspace) {
        const { removeDirectoryFromRecent } = await import("@/utils/directoryTracking");
        removeDirectoryFromRecent(deleteConfirm.id, currentWorkspace);
        // Reload recent directories to reflect the change
        loadRecentDirectories();
      }
      setDeleteConfirm(null);
      await loadRootFolders();
      onFolderDeleted?.();
      toast.success("Folder and all documents deleted");
    } catch (e: unknown) {
      toast.error("Failed to delete folder");
    } finally {
      setDeleting(false);
    }
  };

  const startRename = (folder: FolderItem) => {
    setRenaming(folder);
    setRenameValue(folder.name);
  };

  const cancelRename = () => {
    setRenaming(null);
    setRenameValue("");
  };

  const submitRename = async () => {
    if (!renaming) return;
    const newName = renameValue.trim();
    if (!newName || newName === renaming.name) {
      cancelRename();
      return;
    }
    try {
      await directoryService.update(renaming.id, { name: newName });
      // Update directory name in recent directories if it exists there
      if (currentWorkspace) {
        const { updateDirectoryName } = await import("@/utils/directoryTracking");
        updateDirectoryName(renaming.id, newName, currentWorkspace);
        // Reload recent directories to reflect the change
        loadRecentDirectories();
      }
      toast.success("Folder renamed");
      await loadRootFolders();
    } catch (e: unknown) {
      toast.error((e as any)?.response?.data?.error || "Failed to rename folder");
    } finally {
      cancelRename();
    }
  };

  // Recent directories tracking (refreshed daily)
  const [recentDirectories, setRecentDirectories] = useState<FolderItem[]>([]);
  const [recentDirectoriesLoading, setRecentDirectoriesLoading] = useState(false);
  const [showRecentDirectories, setShowRecentDirectories] = useState(true);

  // Load recent directories from localStorage (tracked by last access, workspace-specific)
  const loadRecentDirectories = async () => {
    try {
      setRecentDirectoriesLoading(true);
      const { getRecentDirectories } = await import("@/utils/directoryTracking");
      
      // Get recent directories for current workspace
      const recent = getRecentDirectories(currentWorkspace);

      // Convert to FolderItem format
      const recentFolders: FolderItem[] = recent.map((r) => ({ id: r.id, name: r.name }));
      setRecentDirectories(recentFolders);
    } catch (error) {
      console.error("Error loading recent directories:", error);
    } finally {
      setRecentDirectoriesLoading(false);
    }
  };

  // Track directory access when folder is opened
  const handleFolderOpenWithTracking = (folder: FolderItem) => {
    // Track directory open (workspace-specific)
    import("@/utils/directoryTracking").then(({ trackDirectoryOpen }) => {
      trackDirectoryOpen(folder.id, folder.name, currentWorkspace);
      // Reload recent directories
      loadRecentDirectories();
      // Dispatch event for other components
      window.dispatchEvent(new CustomEvent("directoryOpened"));
    });

    // Call original handler
    onFolderOpen?.(folder);
  };

  // Load recent directories on mount, when workspace changes, and when folders change
  useEffect(() => {
    if (currentWorkspace) {
      loadRecentDirectories();
    }

    // Listen for directory open events from other components
    const handleDirectoryOpen = () => {
      if (currentWorkspace) {
        loadRecentDirectories();
      }
    };

    window.addEventListener("directoryOpened", handleDirectoryOpen);

    // Refresh recent directories periodically (every 30 seconds) as a fallback
    const refreshInterval = setInterval(() => {
      if (currentWorkspace) {
        loadRecentDirectories();
      }
    }, 30000);

    return () => {
      window.removeEventListener("directoryOpened", handleDirectoryOpen);
      clearInterval(refreshInterval);
    };
  }, [currentWorkspace]);

  return (
    <aside className="hidden md:flex md:flex-col md:w-[260px] shrink-0 border-r border-gray-200 bg-white">
      {/* New Folder button removed - folder creation now happens in upload flow */}

      {/* Create Workspace Button - Admin Only - Below New Folder */}
      {user?.role === "admin" && (
        <div className="px-4 py-2">
          <button
            onClick={() => setShowCreateWorkspaceModal(true)}
            className="w-full flex items-center justify-between rounded-xl px-4 py-3 bg-[#ECE9E2] text-[#4B2A06] font-semibold hover:bg-[#DDD5C9] transition-colors"
            title="Create new workspace"
          >
            <span>New Workspace</span>
            <Plus className="h-5 w-5" />
          </button>
        </div>
      )}

      {/* Workspaces Section - 50% height */}
      <nav className="px-4 pb-2 space-y-2 border-b border-gray-200" style={{ maxHeight: "40%", overflowY: "auto" }}>
        <button
          className="w-full flex items-center gap-3 px-5 justify-between text-sm text-gray-800 hover:text-[#4B2A06]"
          onClick={() => setShowWorkspaces((v) => !v)}
        >
          <div className="flex items-center gap-2 mt-5">
            <Building2 className="h-5 w-5" />
            Workspaces
          </div>
          <div className="flex items-center gap-2 mt-5">
            {showWorkspaces ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </div>
        </button>
        {showWorkspaces && (
          <div className="pl-7 pr-2 max-h-[30vh] overflow-y-auto space-y-2">
            {workspacesLoading ? (
              <div className="text-xs text-gray-500 py-2">Loading...</div>
            ) : workspaces.length === 0 ? (
              <div className="space-y-2">
                <div className="text-xs text-gray-500 py-2">
                  No workspaces. Create one to get started.
                </div>
                {/* Only show available workspaces list when user has NO workspaces */}
                <div className="mt-2">
                  <AvailableWorkspacesList />
                </div>
              </div>
            ) : (
              <ul className="space-y-1">
                {workspaces.map((ws) => (
                  <li 
                    key={ws.workspaceDomain}
                    className="group relative"
                    onMouseEnter={() => setHoveredWorkspace(ws.workspaceDomain)}
                    onMouseLeave={() => setHoveredWorkspace(null)}
                  >
                    <button
                      className={`w-full flex items-center gap-2 text-left px-3 py-2 text-sm rounded-md truncate ${
                        currentWorkspace === ws.workspaceDomain
                          ? "bg-[#ECE9E2] text-[#4B2A06] font-medium"
                          : "text-gray-700 hover:text-[#4B2A06] hover:bg-gray-50"
                      }`}
                      title={getDisplayName(ws)}
                      onClick={() => handleWorkspaceChange(ws.workspaceDomain)}
                    >
                      <Building2 className="h-4 w-4 flex-shrink-0" />
                      <span className="truncate flex-1">{getDisplayName(ws)}</span>
                      {user?.role === "admin" && hoveredWorkspace === ws.workspaceDomain && (
                        <div
                          className="ml-auto p-1 rounded hover:bg-[#DDD5C9] transition-colors flex-shrink-0 cursor-pointer"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedWorkspaceForInvite({
                              workspaceId: ws.workspaceDomain,
                              workspaceName: getDisplayName(ws),
                            });
                            setInviteDialogOpen(true);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              e.stopPropagation();
                              setSelectedWorkspaceForInvite({
                                workspaceId: ws.workspaceDomain,
                                workspaceName: getDisplayName(ws),
                              });
                              setInviteDialogOpen(true);
                            }
                          }}
                          role="button"
                          tabIndex={0}
                          title="Invite to workspace"
                        >
                          <UserPlus className="h-3 w-3 text-[#4B2A06]" />
                        </div>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </nav>
      {/* Recent Directories Section - Rest of the space */}
      <nav className="px-4 space-y-4  pt-2 flex-1 min-h-0 flex flex-col">
        <button
          className="w-full flex items-center gap-3 px-5 justify-between text-sm text-gray-800 hover:text-[#4B2A06]"
          onClick={() => setShowRecentDirectories((v) => !v)}
        >
          <div className="flex items-center gap-2">
            <Folder className="h-5 w-5" />
            Recent Directories
          </div>
          <div className="flex items-center gap-2">
            {showRecentDirectories ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </div>
        </button>
        {showRecentDirectories && (
          <div className="pl-7 pr-2 flex-1 min-h-0 overflow-y-auto">
            {recentDirectoriesLoading ? (
              <div className="text-xs text-gray-500 py-2">Loading...</div>
            ) : recentDirectories.length === 0 ? (
              <div className="text-xs text-gray-500 py-2">No recent directories</div>
            ) : (
              <ul className="space-y-1.5 max-h-[40vh]  overflow-y-auto scrollbar-hide">
                {recentDirectories.map((f) => (
                  <li key={f.id} className="group">
                    <div className="flex items-center gap-2">
                      {renaming?.id === f.id ? (
                        <>
                          <input
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') submitRename();
                              if (e.key === 'Escape') cancelRename();
                            }}
                            className="flex-1 px-2 py-1 text-sm border rounded"
                            autoFocus
                          />
                          <button className="text-green-700 hover:text-green-800" title="Save" onClick={submitRename}>
                            <Check className="h-4 w-4" />
                          </button>
                          <button className="text-gray-600 hover:text-gray-800" title="Cancel" onClick={cancelRename}>
                            <X className="h-4 w-4" />
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            className="flex-1 flex items-center text-left px-4 py-2 text-sm text-gray-700 hover:text-[#4B2A06] hover:bg-[#ECE9E2] rounded-md truncate"
                            title={f.name}
                            onClick={() => handleFolderOpenWithTracking(f)}
                          >
                            <Folder className="h-4 w-4 mr-2 flex-shrink-0" />
                            <span className="truncate">{f.name}</span>
                          </button>
                        </>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </nav>

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-lg w-full mx-4">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex-shrink-0">
                <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center">
                  <Trash2 className="w-5 h-5 text-red-600" />
                </div>
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Delete Company Folder</h3>
                <p className="text-sm text-gray-500">This action cannot be undone</p>
              </div>
            </div>
            
            <div className="mb-6">
              <p className="text-gray-700 mb-3">
                Are you sure you want to delete the folder <strong>"{deleteConfirm.name}"</strong>?
              </p>
              
              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0">
                    <div className="w-6 h-6 bg-red-100 rounded-full flex items-center justify-center">
                      <span className="text-red-600 text-sm font-bold">!</span>
                    </div>
                  </div>
                  <div>
                    <h4 className="text-sm font-medium text-red-800 mb-2">Warning: All documents will be permanently deleted</h4>
                    <ul className="text-sm text-red-700 space-y-1">
                      <li>• All <strong>DRHP documents</strong> in this folder</li>
                      <li>• All <strong>RHP documents</strong> in this folder</li>
                      <li>• All <strong>summaries</strong> related to these documents</li>
                      <li>• All <strong>chat conversations</strong> related to these documents</li>
                      <li>• All <strong>comparison reports</strong> between DRHP and RHP</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
            
            <div className="flex justify-end gap-3">
              <button
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors"
                onClick={() => setDeleteConfirm(null)}
                disabled={deleting}
              >
                Cancel
              </button>
              <button
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-md disabled:opacity-50 transition-colors"
                onClick={handleDeleteFolder}
                disabled={deleting}
              >
                {deleting ? (
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    Deleting...
                  </div>
                ) : (
                  'Delete Permanently'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Create Workspace Modal */}
      <CreateWorkspaceModal
        open={showCreateWorkspaceModal}
        onOpenChange={setShowCreateWorkspaceModal}
        onCreated={() => {
          setShowCreateWorkspaceModal(false);
          loadWorkspaces();
          window.location.reload(); // Reload to refresh workspace context
        }}
        isFirstLogin={false}
      />

      {/* Invite Workspace Dialog */}
      {selectedWorkspaceForInvite && (
        <Dialog open={inviteDialogOpen} onOpenChange={setInviteDialogOpen}>
          <DialogContent className="w-[90vw] max-w-[800px] p-0" hideClose>
            <DialogTitle className="sr-only">Workspace Invitations</DialogTitle>
            <DialogDescription className="sr-only">Manage workspace invitations and user access</DialogDescription>
            <WorkspaceInvitationPopover />
          </DialogContent>
        </Dialog>
      )}
    </aside>
  );
};


