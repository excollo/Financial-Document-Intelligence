import React, { useState, useEffect } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Users,
  Mail,
  Shield,
  Edit,
  Loader2,
  UserCheck,
  UserX,
} from "lucide-react";
import {
  workspaceInvitationService,
  WorkspaceInvitation,
} from "@/services/workspaceInvitationService";
import { getCurrentWorkspace } from "@/services/workspaceContext";

interface InviteeMember {
  email: string;
  name?: string;
  role: string;
  status: "accepted" | "pending";
  joinedAt?: string;
  invitedAt?: string;
}

export function InviteeManagement() {
  const [invitations, setInvitations] = useState<WorkspaceInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);
  const [currentWorkspace] = useState(() => getCurrentWorkspace());

  useEffect(() => {
    loadInvitations();
  }, []);

  const loadInvitations = async () => {
    try {
      setLoading(true);
      const data = await workspaceInvitationService.getWorkspaceInvitations();
      setInvitations(data);
    } catch (error) {
      console.error("Error loading invitations:", error);
      toast.error("Failed to load invitations");
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateRole = async (
    invitation: WorkspaceInvitation,
    newRole: "user" | "viewer" | "editor"
  ) => {
    try {
      setUpdating(invitation.invitationId);
      
      // If invitation is accepted, update the membership role
      if (invitation.status === "accepted") {
        // Use getWorkspaceMembers to get the user ID instead of getAllUsers
        // This is more efficient and doesn't require fetching all users
        const membersData = await workspaceInvitationService.getWorkspaceMembers();
        const member = membersData.members.find(
          (m: any) => m.email.toLowerCase() === invitation.inviteeEmail.toLowerCase()
        );
        
        if (member) {
          // Map invitation role to membership role
          let membershipRole: "admin" | "editor" | "viewer" = "editor";
          if (newRole === "viewer") {
            membershipRole = "viewer";
          } else if (newRole === "editor" || newRole === "user") {
            membershipRole = "editor";
          }
          
          await workspaceInvitationService.updateMemberRole(member.userId, membershipRole);
          toast.success(`Updated role for ${invitation.inviteeEmail}`);
        } else {
          toast.error("User not found. They may need to accept the invitation first.");
        }
      } else {
        // For pending invitations, we can update the invitation itself
        // But this requires a new endpoint or we update when they accept
        toast.info("Role will be applied when invitation is accepted");
      }
      
      loadInvitations();
    } catch (error: any) {
      console.error("Error updating role:", error);
      toast.error(
        error.response?.data?.message || "Failed to update role"
      );
    } finally {
      setUpdating(null);
    }
  };

  const handleRevokeAccess = async (invitationId: string, inviteeEmail: string) => {
    if (!window.confirm(`Revoke access for ${inviteeEmail}?`)) {
      return;
    }

    try {
      setUpdating(inviteeEmail);
      await workspaceInvitationService.revokeUserAccess(invitationId);
      toast.success(`Access revoked for ${inviteeEmail}`);
      loadInvitations();
    } catch (error: any) {
      console.error("Error revoking access:", error);
      toast.error(
        error.response?.data?.message || "Failed to revoke access"
      );
    } finally {
      setUpdating(null);
    }
  };

  // Group invitations by status
  const acceptedInvitations = invitations.filter(
    (inv) => inv.status === "accepted"
  );
  const pendingInvitations = invitations.filter(
    (inv) => inv.status === "pending"
  );

  if (loading) {
    return (
      <div className=" rounded-lg">
        <CardHeader className=" border-gray-200">
          <CardTitle className="flex items-center gap-2 text-[#4B2A06]">
            <Users className="h-5 w-5" />
            Workspace Members
          </CardTitle>
        </CardHeader>
        <CardContent className="bg-white">
          <div className="text-center py-8">
            <Loader2 className="h-6 w-6 animate-spin mx-auto text-gray-400" />
            <p className="text-sm text-[rgba(114, 120, 127, 1)] mt-2">Loading members...</p>
          </div>
        </CardContent>
      </div>
    );
  }

  return (
    <div className=" border-b border-gray-200 rounded-lg">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-6">
      <h2 className="text-2xl font-bold text-[#4B2A06] mb-4 sm:mb-0">
          Workspace Members & Invitations
        </h2>
      </div>
      <div>
        {/* Accepted Members */}
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <UserCheck className="h-4 w-4 text-gray-600" />
            <h3 className="font-semibold text-[#4B2A06]">
              Invited Members ({acceptedInvitations.length})
            </h3>
          </div>
          {acceptedInvitations.length === 0 ? (
            <div className="text-sm text-[rgba(114, 120, 127, 1)] py-4 text-center">
              No active members yet
            </div>
          ) : (
            <div className="space-y-2 max-h-[40vh] overflow-y-auto">
              {acceptedInvitations.map((inv) => (
                <div
                  key={inv.invitationId}
                  className="flex items-center justify-between p-3 bg-white border border-gray-200 rounded-lg hover:bg-gray-50"
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <Mail className="h-4 w-4 text-gray-400 flex-shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-sm text-[rgba(38,40,43,1)] truncate">
                        {inv.inviteeEmail}
                      </div>
                      <div className="text-xs text-[rgba(114, 120, 127, 1)]">
                        Invited: {new Date(inv.createdAt).toLocaleDateString()}
                      </div>
                    </div>
                    <Badge
                      variant="secondary"
                      className="bg-white text-[rgba(114, 120, 127, 1)] border-gray-200"
                    >
                      Active
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2 ml-4 flex-shrink-0">
                    <Select
                      value={inv.invitedRole}
                      onValueChange={(value: "user" | "viewer" | "editor") =>
                        handleUpdateRole(inv, value)
                      }
                      disabled={updating === inv.invitationId}
                    >
                      <SelectTrigger className="w-28 h-8 text-xs bg-white border-gray-300 text-[#4B2A06] focus:ring-0 focus:outline-none">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-white border border-gray-200">
                        <SelectItem className="bg-white hover:bg-gray-100 data-[highlighted]:bg-gray-100 hover:text-[#4B2A06]" value="user">User</SelectItem>
                        <SelectItem className="bg-white hover:bg-gray-100 data-[highlighted]:bg-gray-100 hover:text-[#4B2A06]" value="viewer">Viewer</SelectItem>
                        <SelectItem className="bg-white hover:bg-gray-100 data-[highlighted]:bg-gray-100 hover:text-[#4B2A06]" value="editor">Editor</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleRevokeAccess(inv.invitationId, inv.inviteeEmail)}
                      disabled={updating === inv.invitationId}
                      className="h-8 text-xs bg-[#4B2A06] text-white hover:bg-[#4B2A06] hover:text-white focus:ring-0 focus:outline-none"
                    >
                      {updating === inv.invitationId ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <UserX className="h-3 w-3" />
                      )}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Pending Invitations */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Mail className="h-4 w-4 text-gray-600" />
            <h3 className="font-semibold text-[#4B2A06]">
              Pending Invitations ({pendingInvitations.length})
            </h3>
          </div>
          {pendingInvitations.length === 0 ? (
            <div className="text-sm text-[rgba(114, 120, 127, 1)] py-4 text-center">
              No pending invitations
            </div>
          ) : (
            <div className="space-y-2 max-h-[30vh] overflow-y-auto">
              {pendingInvitations.map((inv) => (
                <div
                  key={inv.invitationId}
                  className="flex items-center justify-between p-3 bg-white border border-gray-200 rounded-lg hover:bg-gray-50"
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <Mail className="h-4 w-4 text-gray-400 flex-shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-sm text-[rgba(38,40,43,1)] truncate">
                        {inv.inviteeEmail}
                      </div>
                      <div className="text-xs text-[rgba(114, 120, 127, 1)]">
                        Invited: {new Date(inv.createdAt).toLocaleDateString()}
                        {inv.expiresAt &&
                          new Date(inv.expiresAt) > new Date() && (
                            <> • Expires: {new Date(inv.expiresAt).toLocaleDateString()}</>
                          )}
                      </div>
                    </div>
                    <Badge
                      variant="secondary"
                      className="bg-white text-[rgba(114, 120, 127, 1)] border-gray-200"
                    >
                      Pending
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2 ml-4 flex-shrink-0">
                    <Select
                      value={inv.invitedRole}
                      disabled
                    >
                      <SelectTrigger className="w-28 h-8 text-xs bg-white border-gray-300 text-[#4B2A06] opacity-60 focus:ring-0 focus:outline-none">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-white border border-gray-200">
                        <SelectItem className="bg-white hover:bg-gray-100 data-[highlighted]:bg-gray-100 hover:text-[#4B2A06]" value="user">User</SelectItem>
                        <SelectItem className="bg-white hover:bg-gray-100 data-[highlighted]:bg-gray-100 hover:text-[#4B2A06]" value="viewer">Viewer</SelectItem>
                        <SelectItem className="bg-white hover:bg-gray-100 data-[highlighted]:bg-gray-100 hover:text-[#4B2A06]" value="editor">Editor</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>  
  );
}

