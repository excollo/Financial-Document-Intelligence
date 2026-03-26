import { ActivityLog } from "../models/ActivityLog";
import { User } from "../models/User";

interface LogActivityParams {
  performedBy: string; // User ID
  action: ActivityLogAction;
  resourceType: "workspace" | "directory" | "document" | "invitation";
  resourceId: string;
  resourceName?: string;
  workspaceId?: string;
  workspaceName?: string;
  domain: string;
  targetUserId?: string;
  targetUserEmail?: string;
  oldRole?: string;
  newRole?: string;
  oldPermission?: string;
  newPermission?: string;
  metadata?: any;
}

type ActivityLogAction =
  | "role_changed"
  | "access_granted"
  | "access_revoked"
  | "invitation_sent"
  | "invitation_accepted"
  | "invitation_declined"
  | "invitation_cancelled"
  | "member_added"
  | "member_removed"
  | "directory_access_granted"
  | "directory_access_revoked"
  | "document_access_granted"
  | "document_access_revoked";

export async function logActivity(params: LogActivityParams): Promise<void> {
  try {
    // Get performer's email
    const performer = await User.findById(params.performedBy);
    const performedByEmail = performer?.email || "unknown";

    // Create activity log
    const activityLog = new ActivityLog({
      performedBy: params.performedBy,
      performedByEmail,
      targetUserId: params.targetUserId,
      targetUserEmail: params.targetUserEmail,
      action: params.action,
      resourceType: params.resourceType,
      resourceId: params.resourceId,
      resourceName: params.resourceName,
      workspaceId: params.workspaceId,
      workspaceName: params.workspaceName,
      domain: params.domain,
      oldRole: params.oldRole,
      newRole: params.newRole,
      oldPermission: params.oldPermission,
      newPermission: params.newPermission,
      metadata: params.metadata,
      timestamp: new Date(),
    });

    await activityLog.save();
  } catch (error) {
    // Don't throw - audit logging should not break the main flow
    console.error("Error logging activity:", error);
  }
}

// Helper functions for common actions
export const auditLogger = {
  async logRoleChange(
    performedBy: string,
    targetUserId: string,
    workspaceId: string,
    workspaceName: string,
    domain: string,
    oldRole: string,
    newRole: string
  ) {
    const targetUser = await User.findById(targetUserId);
    await logActivity({
      performedBy,
      action: "role_changed",
      resourceType: "workspace",
      resourceId: workspaceId,
      resourceName: workspaceName,
      workspaceId,
      workspaceName,
      domain,
      targetUserId,
      targetUserEmail: targetUser?.email,
      oldRole,
      newRole,
    });
  },

  async logMemberAdded(
    performedBy: string,
    targetUserId: string,
    workspaceId: string,
    workspaceName: string,
    domain: string,
    role: string
  ) {
    const targetUser = await User.findById(targetUserId);
    await logActivity({
      performedBy,
      action: "member_added",
      resourceType: "workspace",
      resourceId: workspaceId,
      resourceName: workspaceName,
      workspaceId,
      workspaceName,
      domain,
      targetUserId,
      targetUserEmail: targetUser?.email,
      newRole: role,
    });
  },

  async logMemberRemoved(
    performedBy: string,
    targetUserId: string,
    workspaceId: string,
    workspaceName: string,
    domain: string
  ) {
    const targetUser = await User.findById(targetUserId);
    await logActivity({
      performedBy,
      action: "member_removed",
      resourceType: "workspace",
      resourceId: workspaceId,
      resourceName: workspaceName,
      workspaceId,
      workspaceName,
      domain,
      targetUserId,
      targetUserEmail: targetUser?.email,
    });
  },

  async logDirectoryAccessGranted(
    performedBy: string,
    targetUserId: string,
    directoryId: string,
    directoryName: string,
    workspaceId: string,
    workspaceName: string,
    domain: string,
    role: string
  ) {
    const targetUser = await User.findById(targetUserId);
    await logActivity({
      performedBy,
      action: "directory_access_granted",
      resourceType: "directory",
      resourceId: directoryId,
      resourceName: directoryName,
      workspaceId,
      workspaceName,
      domain,
      targetUserId,
      targetUserEmail: targetUser?.email,
      newPermission: role,
    });
  },

  async logDirectoryAccessRevoked(
    performedBy: string,
    targetUserId: string,
    directoryId: string,
    directoryName: string,
    workspaceId: string,
    workspaceName: string,
    domain: string
  ) {
    const targetUser = await User.findById(targetUserId);
    await logActivity({
      performedBy,
      action: "directory_access_revoked",
      resourceType: "directory",
      resourceId: directoryId,
      resourceName: directoryName,
      workspaceId,
      workspaceName,
      domain,
      targetUserId,
      targetUserEmail: targetUser?.email,
    });
  },

  async logInvitationSent(
    performedBy: string,
    invitationId: string,
    inviteeEmail: string,
    workspaceId: string,
    workspaceName: string,
    domain: string,
    invitedRole: string
  ) {
    await logActivity({
      performedBy,
      action: "invitation_sent",
      resourceType: "invitation",
      resourceId: invitationId,
      workspaceId,
      workspaceName,
      domain,
      targetUserEmail: inviteeEmail,
      newRole: invitedRole,
    });
  },

  async logInvitationAccepted(
    performedBy: string,
    invitationId: string,
    workspaceId: string,
    workspaceName: string,
    domain: string
  ) {
    await logActivity({
      performedBy,
      action: "invitation_accepted",
      resourceType: "invitation",
      resourceId: invitationId,
      workspaceId,
      workspaceName,
      domain,
    });
  },
};



















