import express from "express";
import { workspaceInvitationController } from "../controllers/workspaceInvitationController";
import { authMiddleware } from "../middleware/auth";
import { domainAuthMiddleware } from "../middleware/domainAuth";
import { rateLimitByUser } from "../middleware/rateLimitByUser";

const router = express.Router();

// Apply auth middleware to all routes
router.use(authMiddleware);
// Apply domain middleware to all routes
router.use(domainAuthMiddleware);

// Send workspace invitation (admin only)
router.post(
  "/send",
  rateLimitByUser("workspace:invite", 10, 24 * 60 * 60 * 1000), // 10 invitations per day
  workspaceInvitationController.sendInvitation
);

// Get all invitations for current workspace (admin only)
router.get("/workspace", workspaceInvitationController.getWorkspaceInvitations);

// Get invitations sent to a specific email
router.get(
  "/email/:email",
  workspaceInvitationController.getInvitationsByEmail
);

// Accept invitation
router.post(
  "/:invitationId/accept",
  workspaceInvitationController.acceptInvitation
);

// Decline invitation
router.post(
  "/:invitationId/decline",
  workspaceInvitationController.declineInvitation
);

// Cancel invitation (admin only)
router.delete(
  "/:invitationId/cancel",
  workspaceInvitationController.cancelInvitation
);

// Delete invitation record (admin only)
router.delete("/:invitationId", workspaceInvitationController.deleteInvitation);

// Get user's accessible workspaces
router.get("/user/workspaces", workspaceInvitationController.getUserWorkspaces);

// Switch workspace
router.post(
  "/user/switch-workspace",
  workspaceInvitationController.switchWorkspace
);

// Update friendly workspace name for current user
router.post(
  "/user/update-workspace-name",
  workspaceInvitationController.updateWorkspaceName
);

// Admin: update user's time-bucket permissions for current workspace
router.post(
  "/workspace/update-user-buckets",
  workspaceInvitationController.updateUserTimeBuckets
);

// Admin: revoke user's access to current workspace
router.post(
  "/workspace/revoke-user-access",
  workspaceInvitationController.revokeUserAccess
);

// Admin: grant directory access to a user
router.post(
  "/workspace/users/directories/grant",
  workspaceInvitationController.grantDirectoryAccess
);

// Admin: revoke directory access from a user
router.post(
  "/workspace/users/directories/revoke",
  workspaceInvitationController.revokeDirectoryAccess
);

// Admin: get all directories a user has access to
router.get(
  "/workspace/users/:userEmail/directories",
  workspaceInvitationController.getUserDirectories
);

// Admin: retroactively grant directory access from accepted invitation
router.post(
  "/workspace/retroactively-grant-access",
  workspaceInvitationController.retroactivelyGrantDirectoryAccess
);

// Admin: Get all workspace members
router.get(
  "/workspace/members",
  workspaceInvitationController.getWorkspaceMembers
);

// Admin: Update member role
router.post(
  "/workspace/members/role",
  workspaceInvitationController.updateMemberRole
);

// Admin: Remove member from workspace
router.delete(
  "/workspace/members/:userId",
  workspaceInvitationController.removeWorkspaceMember
);

// Admin: Get member's detailed permissions
router.get(
  "/workspace/members/:userId/permissions",
  workspaceInvitationController.getMemberPermissions
);

// Admin: Get activity log for workspace
router.get(
  "/workspace/activity-log",
  workspaceInvitationController.getActivityLog
);

export default router;
