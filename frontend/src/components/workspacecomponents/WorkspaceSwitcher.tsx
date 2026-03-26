import React, { useState, useEffect } from "react";
import { toast } from "sonner";
import {
  workspaceInvitationService,
  UserWorkspace,
} from "@/services/workspaceInvitationService";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Building2, Users, Pencil, Check, X, Plus } from "lucide-react";
import { CreateWorkspaceModal } from "@/components/workspacecomponents/CreateWorkspaceModal";
import { useAuth } from "@/contexts/AuthContext";

interface WorkspaceSwitcherProps {
  className?: string;
  onWorkspaceChange?: (workspaceDomain: string) => void;
  // select: renders a <Select>; list: renders plain list for popovers
  mode?: "select" | "list";
}

export function WorkspaceSwitcher({
  className,
  onWorkspaceChange,
  mode = "select",
}: WorkspaceSwitcherProps) {
  const { user } = useAuth();
  const [workspaces, setWorkspaces] = useState<UserWorkspace[]>([]);
  const [currentWorkspace, setCurrentWorkspace] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [editingDomain, setEditingDomain] = useState<string | null>(null);
  const [editingName, setEditingName] = useState<string>("");
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    loadWorkspaces();
  }, []);

  const loadWorkspaces = async () => {
    try {
      setLoading(true);
      const data = await workspaceInvitationService.getUserWorkspaces();
      setWorkspaces(data.workspaces);
      setCurrentWorkspace(data.currentWorkspace);
    } catch (error) {
      console.error("Error loading workspaces:", error);
      toast.error("Failed to load workspaces");
    } finally {
      setLoading(false);
    }
  };

  const handleWorkspaceChange = async (workspaceDomain: string) => {
    try {
      await workspaceInvitationService.switchWorkspace(workspaceDomain);
      setCurrentWorkspace(workspaceDomain);
      onWorkspaceChange?.(workspaceDomain);
      toast.success(
        `Switched to ${
          workspaces.find((w) => w.workspaceDomain === workspaceDomain)
            ?.workspaceName
        }`
      );
      window.location.reload();
    } catch (error) {
      console.error("Error switching workspace:", error);
      toast.error("Failed to switch workspace");
    }
  };

  const getRoleIcon = (role: string) => {
    switch (role) {
      case "admin":
        return "👑";
      case "editor":
        return "✏️";
      case "viewer":
        return "👁️";
      default:
        return "👤";
    }
  };

  const toTitleCase = (raw: string): string => {
    if (!raw) return "";
    return raw
      .split(/[\.-_]/)
      .filter(Boolean)
      .map((s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase())
      .join(" ");
  };

  const getDisplayName = (ws: UserWorkspace): string => {
    const domain = (ws.workspaceDomain || "").split(".")[0];
    const friendly = `${toTitleCase(domain)} Workspace`;
    const existing = (ws.workspaceName || "").trim();
    if (
      existing &&
      existing.toLowerCase() !==
        `${(ws.workspaceDomain || "").toLowerCase()} workspace`
    ) {
      return existing;
    }
    return friendly;
  };

  if (loading) {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        <Building2 className="h-4 w-4" />
        <span className="text-sm text-gray-500">Loading workspaces...</span>
      </div>
    );
  }

  if (workspaces.length === 0) {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        <Building2 className="h-4 w-4" />
        <span className="text-sm text-gray-500">No workspaces available</span>
      </div>
    );
  }

  if (mode === "list") {
    return (
      <div className={className}>
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-medium text-gray-700">Switch to Workspaces</div>
          {user?.role === "admin" && (
            <button
              onClick={() => setCreateOpen(true)}
              className="text-xs text-[#4B2A06] hover:underline flex items-center gap-1"
            >
              <Plus className="h-3 w-3" /> Create workspace
            </button>
          )}
        </div>
        <div className="flex flex-col gap-1">
          {workspaces.map((ws) => (
            <button
              key={ws.workspaceDomain}
              onClick={() => handleWorkspaceChange(ws.workspaceDomain)}
              className={`flex items-center justify-between w-full text-left px-3 py-2 rounded hover:bg-gray-100 ${
                currentWorkspace === ws.workspaceDomain ? "bg-gray-50" : ""
              }`}
            >
              <div className="flex items-center  gap-2">
                <Building2 className="h-4 w-4 text-gray-600" />
                <div>
                  <div className="text-sm text-gray-900 flex items-center gap-2">
                    {editingDomain === ws.workspaceDomain ? (
                      <>
                        <input
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          className="border border-gray-300 rounded px-2 py-1 text-sm w-40"
                          onClick={(e) => e.stopPropagation()}
                        />
                        <button
                          onClick={async (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            try {
                              const name = editingName.trim();
                              if (name.length < 2) return;
                              await workspaceInvitationService.updateWorkspaceName(
                                ws.workspaceDomain,
                                name
                              );
                              setWorkspaces((prev) =>
                                prev.map((w) =>
                                  w.workspaceDomain === ws.workspaceDomain
                                    ? { ...w, workspaceName: name }
                                    : w
                                )
                              );
                              setEditingDomain(null);
                              toast.success("Workspace name updated");
                            } catch {
                              toast.error("Failed to update name");
                            }
                          }}
                          className="text-green-600"
                          title="Save"
                        >
                          <Check className="h-4 w-4" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setEditingDomain(null);
                          }}
                          className="text-gray-500"
                          title="Cancel"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </>
                    ) : (
                      <span>{getDisplayName(ws)}</span>
                    )}
                  </div>
                  {/* <div className="text-xs text-gray-500">
                    {ws.workspaceDomain}
                  </div> */}
                </div>
              </div>
              {/* Right-side actions */}
              {editingDomain !== ws.workspaceDomain && (
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setEditingDomain(ws.workspaceDomain);
                    setEditingName(getDisplayName(ws));
                  }}
                  className="text-gray-500 hover:text-gray-700"
                  title="Rename workspace"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              )}
            </button>
          ))}
        </div>
        <CreateWorkspaceModal
          open={createOpen}
          onOpenChange={(o) => setCreateOpen(o)}
          onCreated={() => {
            (async () => {
              try {
                const data = await workspaceInvitationService.getUserWorkspaces();
                setWorkspaces(data.workspaces);
              } catch {}
            })();
          }}
        />
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <Building2 className="h-4 w-4" />
      <Select value={currentWorkspace} onValueChange={(val) => {
        if (val === "__create__") {
          setCreateOpen(true);
          return;
        }
        handleWorkspaceChange(val);
      }}>
        <SelectTrigger className="w-[200px]">
          <SelectValue placeholder="Select workspace" />
        </SelectTrigger>
        <SelectContent>
          {workspaces.map((workspace) => (
            <SelectItem
              key={workspace.workspaceDomain}
              value={workspace.workspaceDomain}
            >
              <div className="flex items-center justify-between gap-2">
                <span>{getRoleIcon(workspace.role)}</span>
                <span>{getDisplayName(workspace)}</span>
                <span className="text-xs text-gray-500">
                  ({workspace.role})
                </span>
              </div>
            </SelectItem>
          ))}
          {user?.role === "admin" && (
            <>
              <div className="border-t my-1" />
              <SelectItem value="__create__">
                <div className="flex items-center gap-2">
                  <Plus className="h-4 w-4" />
                  <span>Create workspace</span>
                </div>
              </SelectItem>
            </>
          )}
        </SelectContent>
      </Select>
      <CreateWorkspaceModal
        open={createOpen}
        onOpenChange={(o) => setCreateOpen(o)}
        onCreated={() => {
          // Reload list to include the new workspace
          (async () => {
            try {
              const data = await workspaceInvitationService.getUserWorkspaces();
              setWorkspaces(data.workspaces);
            } catch {}
          })();
        }}
      />
    </div>
  );
}
