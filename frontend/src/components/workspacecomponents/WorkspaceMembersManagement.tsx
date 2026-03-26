import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  UserPlus,
  UserX,
  Eye,
  Edit2,
  Trash2,
  Search,
  Shield,
  FileEdit,
  FileText,
  Loader2,
  MoreVertical,
  Check,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  workspaceInvitationService,
  WorkspaceMember,
  PendingMember,
  MemberPermissions,
} from "@/services/workspaceInvitationService";
import { useAuth } from "@/contexts/AuthContext";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function WorkspaceMembersManagement() {
  const { user } = useAuth();
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [pending, setPending] = useState<PendingMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [updating, setUpdating] = useState<string | null>(null);
  const [selectedMember, setSelectedMember] = useState<WorkspaceMember | null>(null);
  const [permissionsDialogOpen, setPermissionsDialogOpen] = useState(false);
  const [memberPermissions, setMemberPermissions] = useState<MemberPermissions | null>(null);
  const [loadingPermissions, setLoadingPermissions] = useState(false);

  useEffect(() => {
    loadMembers();
  }, []);

  const loadMembers = async () => {
    try {
      setLoading(true);
      const data = await workspaceInvitationService.getWorkspaceMembers();
      setMembers(data.members || []);
      setPending(data.pending || []);
    } catch (error: any) {
      console.error("Error loading members:", error);
      toast.error(error.response?.data?.message || "Failed to load workspace members");
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateRole = async (userId: string, newRole: "editor" | "viewer") => {
    try {
      setUpdating(userId);
      await workspaceInvitationService.updateMemberRole(userId, newRole);
      toast.success("Member role updated successfully");
      await loadMembers();
    } catch (error: any) {
      console.error("Error updating role:", error);
      toast.error(error.response?.data?.message || "Failed to update member role");
    } finally {
      setUpdating(null);
    }
  };

  const handleRemoveMember = async (userId: string, email: string) => {
    if (!confirm(`Are you sure you want to remove ${email} from this workspace?`)) {
      return;
    }

    try {
      setUpdating(userId);
      await workspaceInvitationService.removeWorkspaceMember(userId);
      toast.success("Member removed successfully");
      await loadMembers();
    } catch (error: any) {
      console.error("Error removing member:", error);
      toast.error(error.response?.data?.message || "Failed to remove member");
    } finally {
      setUpdating(null);
    }
  };

  const handleViewPermissions = async (member: WorkspaceMember) => {
    try {
      setLoadingPermissions(true);
      setSelectedMember(member);
      const permissions = await workspaceInvitationService.getMemberPermissions(member.userId);
      setMemberPermissions(permissions);
      setPermissionsDialogOpen(true);
    } catch (error: any) {
      console.error("Error loading permissions:", error);
      toast.error(error.response?.data?.message || "Failed to load permissions");
    } finally {
      setLoadingPermissions(false);
    }
  };

  const getRoleBadgeColor = (role: string) => {
    switch (role) {
      case "admin":
        return "bg-red-100 text-red-700 border-red-200";
      case "editor":
        return "bg-blue-100 text-blue-700 border-blue-200";
      case "viewer":
        return "bg-gray-100 text-gray-700 border-gray-200";
      default:
        return "bg-gray-100 text-gray-700 border-gray-200";
    }
  };

  const filteredMembers = members.filter((member) => {
    // Filter out admin users - admins cannot give access to themselves
    if (member.workspaceRole === "admin") {
      return false;
    }
    const matchesSearch =
      member.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
      member.name?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesRole = roleFilter === "all" || member.workspaceRole === roleFilter;
    return matchesSearch && matchesRole;
  });

  const filteredPending = pending.filter((p) => {
    const matchesSearch =
      p.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.name?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesRole = roleFilter === "all" || p.workspaceRole === roleFilter;
    return matchesSearch && matchesRole;
  });

  if (loading) {
    return (
      <div className="w-full mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-[#4B2A06] mb-4 sm:mb-0">
            Workspace Members
          </h2>
        </div>
        <div className="flex items-center justify-center py-8 bg-white rounded-lg border border-gray-200">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="w-full mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-[#4B2A06] mb-4 sm:mb-0">
            Workspace Members
          </h2>
        </div>
        <div>
          {/* Filters */}
          <div className="flex gap-4 mb-6">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 border-none text-gray-400" />
              <Input
                placeholder="Search by name or email..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 bg-white border-gray-300 text-[#4B2A06] focus:ring-0 focus:outline-none"
              />
            </div>
            <Select value={roleFilter} onValueChange={setRoleFilter}>
              <SelectTrigger className="w-40 bg-white border-gray-300 text-[#4B2A06] focus:ring-0 focus:outline-none">
                <SelectValue placeholder="All Roles" />
              </SelectTrigger>
              <SelectContent className="bg-white border border-gray-200">
                <SelectItem className="bg-white hover:bg-gray-100 data-[highlighted]:bg-gray-100 hover:text-[#4B2A06]" value="all">All Roles</SelectItem>
                <SelectItem className="bg-white hover:bg-gray-100 data-[highlighted]:bg-gray-100 hover:text-[#4B2A06]" value="editor">Editor</SelectItem>
                <SelectItem className="bg-white hover:bg-gray-100 data-[highlighted]:bg-gray-100 hover:text-[#4B2A06]" value="viewer">Viewer</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Active Members */}
          <div className="mb-8">
            <h3 className="text-sm font-semibold text-[rgba(114, 120, 127, 1)] mb-4">
              Active Members ({filteredMembers.length})
            </h3>
            {filteredMembers.length === 0 ? (
              <div className="text-sm text-[rgba(114, 120, 127, 1)] py-4 text-center bg-white rounded-lg border border-gray-200">
                No members found
              </div>
            ) : (
              <div className="space-y-2">
                {filteredMembers.map((member) => (
                  <div
                    key={member.userId}
                    className="flex items-center justify-between p-4 bg-white shadow-sm rounded-lg hover:bg-gray-50 transition-colors border-b border-gray-200"
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-3">
                        <div>
                          <div className="font-medium text-[rgba(38,40,43,1)]">
                            {member.name || member.email}
                          </div>
                          <div className="text-sm text-[rgba(114, 120, 127, 1)]">{member.email}</div>
                          {member.domain && (
                            <div className="text-xs text-[rgba(114, 120, 127, 1)] mt-1">
                              Domain: {member.domain}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 mt-2">
                        <Badge className={getRoleBadgeColor(member.workspaceRole)}>
                          {member.workspaceRole}
                        </Badge>
                        {member.directoryAccess.length > 0 && (
                          <Badge variant="outline" className="text-xs">
                            {member.directoryAccess.length} directory
                            {member.directoryAccess.length > 1 ? "ies" : "y"}
                          </Badge>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0 hover:bg-gray-100"
                            disabled={updating === member.userId}
                          >
                            {updating === member.userId ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <MoreVertical className="h-4 w-4 text-gray-600" />
                            )}
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="bg-white border border-gray-200">
                          <DropdownMenuItem
                            onClick={() => handleViewPermissions(member)}
                            className="hover:bg-white data-[highlighted]:bg-gray-100 hover:text-[#4B2A06] cursor-pointer"
                          >
                            <Eye className="h-4 w-4 mr-2" />
                            View Permissions
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => {
                              const newRole =
                                member.workspaceRole === "editor"
                                  ? "viewer"
                                  : "editor";
                              handleUpdateRole(member.userId, newRole);
                            }}
                            className="hover:bg-white data-[highlighted]:bg-gray-100 hover:text-[#4B2A06] cursor-pointer"
                          >
                            <Edit2 className="h-4 w-4 mr-2" />
                            Change Role
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-red-600 hover:bg-white data-[highlighted]:bg-gray-100 hover:text-red-600 cursor-pointer"
                            onClick={() =>
                              handleRemoveMember(member.userId, member.email)
                            }
                          >
                            <UserX className="h-4 w-4 mr-2" />
                            Remove Member
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                      <Select
                        value={member.workspaceRole}
                        onValueChange={(value: "editor" | "viewer") =>
                          handleUpdateRole(member.userId, value)
                        }
                        disabled={updating === member.userId}
                      >
                        <SelectTrigger className="w-32 h-8 text-xs bg-white border-gray-300 text-[#4B2A06] focus:ring-0 focus:outline-none">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-white border border-gray-200">
                          <SelectItem className="bg-white hover:bg-gray-100 data-[highlighted]:bg-gray-100 hover:text-[#4B2A06]" value="editor">Editor</SelectItem>
                          <SelectItem className="bg-white hover:bg-gray-100 data-[highlighted]:bg-gray-100 hover:text-[#4B2A06]" value="viewer">Viewer</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Pending Invitations */}
          {filteredPending.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-[rgba(114, 120, 127, 1)] mb-4">
                Pending Invitations ({filteredPending.length})
              </h3>
              <div className="space-y-2">
                {filteredPending.map((pendingMember) => (
                  <div
                    key={pendingMember.invitationId}
                    className="flex items-center justify-between p-4 bg-white shadow-sm rounded-lg hover:bg-gray-50 transition-colors border-b border-gray-200"
                  >
                    <div className="flex-1">
                      <div className="font-medium text-[rgba(38,40,43,1)]">
                        {pendingMember.name || pendingMember.email}
                      </div>
                      <div className="text-sm text-[rgba(114, 120, 127, 1)]">{pendingMember.email}</div>
                      <div className="flex items-center gap-2 mt-2">
                        <Badge className={getRoleBadgeColor(pendingMember.workspaceRole)}>
                          {pendingMember.workspaceRole}
                        </Badge>
                        <Badge variant="outline" className="text-xs">
                          Pending
                        </Badge>
                        {pendingMember.directoryAccess.length > 0 && (
                          <Badge variant="outline" className="text-xs">
                            {pendingMember.directoryAccess.length} directory
                            {pendingMember.directoryAccess.length > 1 ? "ies" : "y"}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Permissions Dialog */}
      <Dialog open={permissionsDialogOpen} onOpenChange={setPermissionsDialogOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Permissions: {memberPermissions?.member.name || memberPermissions?.member.email}
            </DialogTitle>
          </DialogHeader>
          {loadingPermissions ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
            </div>
          ) : memberPermissions ? (
            <div className="space-y-6">
              {/* Workspace Permissions */}
              <div>
                <h4 className="font-semibold text-[rgba(38,40,43,1)] mb-2 flex items-center gap-2">
                  <Shield className="h-4 w-4" />
                  Workspace Permissions
                </h4>
                <div className="bg-white border border-gray-200 p-4 rounded-lg">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-[rgba(114, 120, 127, 1)]">Role:</span>
                    <Badge className={getRoleBadgeColor(memberPermissions.member.workspaceRole)}>
                      {memberPermissions.member.workspaceRole}
                    </Badge>
                  </div>
                  <div className="space-y-1 mt-3">
                    <div className="flex items-center gap-2 text-sm">
                      {memberPermissions.permissions.workspace.canInvite ? (
                        <Check className="h-4 w-4 text-green-600" />
                      ) : (
                        <X className="h-4 w-4 text-gray-400" />
                      )}
                      <span>Can invite users</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      {memberPermissions.permissions.workspace.canEdit ? (
                        <Check className="h-4 w-4 text-green-600" />
                      ) : (
                        <X className="h-4 w-4 text-gray-400" />
                      )}
                      <span>Can edit documents</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      {memberPermissions.permissions.workspace.canView ? (
                        <Check className="h-4 w-4 text-green-600" />
                      ) : (
                        <X className="h-4 w-4 text-gray-400" />
                      )}
                      <span>Can view documents</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Directory Access */}
              <div>
                <h4 className="font-semibold text-[rgba(38,40,43,1)] mb-2 flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  Directory Access ({memberPermissions.permissions.directories.length})
                </h4>
                {memberPermissions.permissions.directories.length === 0 ? (
                  <div className="text-sm text-[rgba(114, 120, 127, 1)] py-2">No directory access granted</div>
                ) : (
                  <div className="space-y-2">
                    {memberPermissions.permissions.directories.map((dir) => (
                      <div
                        key={dir.directoryId}
                        className="flex items-center justify-between p-3 bg-white border border-gray-200 rounded-lg"
                      >
                        <div>
                          <div className="font-medium text-sm text-[rgba(38,40,43,1)]">{dir.directoryName}</div>
                          <div className="text-xs text-[rgba(114, 120, 127, 1)]">
                            Granted: {new Date(dir.grantedAt).toLocaleDateString()}
                          </div>
                        </div>
                        <Badge className={getRoleBadgeColor(dir.role)}>{dir.role}</Badge>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Document Access */}
              {memberPermissions.permissions.documents.length > 0 && (
                <div>
                  <h4 className="font-semibold text-[rgba(38,40,43,1)] mb-2 flex items-center gap-2">
                    <FileEdit className="h-4 w-4" />
                    Document Access ({memberPermissions.permissions.documents.length})
                  </h4>
                  <div className="space-y-2 max-h-40 overflow-y-auto">
                    {memberPermissions.permissions.documents.map((doc) => (
                      <div
                        key={doc.documentId}
                        className="flex items-center justify-between p-3 bg-white border border-gray-200 rounded-lg"
                      >
                        <div>
                          <div className="font-medium text-sm text-[rgba(38,40,43,1)]">{doc.documentName}</div>
                          <div className="text-xs text-[rgba(114, 120, 127, 1)]">
                            Granted: {new Date(doc.grantedAt).toLocaleDateString()}
                          </div>
                        </div>
                        <Badge className={getRoleBadgeColor(doc.role)}>{doc.role}</Badge>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : null}
          <DialogFooter>
            <Button
              onClick={() => setPermissionsDialogOpen(false)}
              className="bg-[#4B2A06] text-white"
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

