import { Request, Response } from "express";
import mongoose from "mongoose";
import { User } from "../models/User";
import { WorkspaceInvitation } from "../models/WorkspaceInvitation";
import { SharePermission } from "../models/SharePermission";
import { Directory } from "../models/Directory";
import { Document } from "../models/Document";
import { Workspace } from "../models/Workspace";
import { WorkspaceMembership } from "../models/WorkspaceMembership";
import { sendEmail } from "../services/emailService";
import { v4 as uuidv4 } from "uuid";
import { auditLogger } from "../lib/auditLogger";

interface AuthRequest extends Request {
  user?: any;
  userDomain?: string;
  currentWorkspace?: string;
}

export const workspaceInvitationController = {
  // Send workspace invitation
  async sendInvitation(req: AuthRequest, res: Response) {
    try {
      const {
        inviteeEmail,
        inviteeName,
        invitedRole = "user",
        message,
        allowedTimeBuckets,
        grantedDirectories,
      } = req.body as {
        inviteeEmail: string;
        inviteeName?: string;
        invitedRole?: "user" | "viewer" | "editor";
        message?: string;
        allowedTimeBuckets?: string[];
        grantedDirectories?: Array<{
          directoryId: string;
          role: "viewer" | "editor";
        }>;
      };
      const inviterId = req.user._id;
      const workspaceId = req.currentWorkspace; // Use workspaceId from current workspace
      const userDomain = req.userDomain || req.user?.domain;

      // Validate required fields
      if (!inviteeEmail) {
        return res.status(400).json({ message: "Invitee email is required" });
      }

      if (!workspaceId) {
        return res.status(400).json({ message: "Workspace is required. Please select a workspace." });
      }

      // Get workspace to verify it exists and get name
      const workspace = await Workspace.findOne({ workspaceId, domain: userDomain });
      if (!workspace) {
        return res.status(404).json({ message: "Workspace not found" });
      }

      // Check if inviter is admin (domain admin or workspace admin via membership)
      const isDomainAdmin = req.user.role === "admin";
      const membership = await WorkspaceMembership.findOne({
        userId: req.user._id,
        workspaceId,
        role: "admin",
        status: "active",
      });

      if (!isDomainAdmin && !membership) {
        return res.status(403).json({
          message: "Only workspace admins can send invitations",
        });
      }

      // Check if user is trying to invite themselves
      if (inviteeEmail === req.user.email) {
        return res.status(400).json({
          message: "You cannot invite yourself",
        });
      }

      // Check if user already exists and has access to this workspace via membership
      const existingUser = await User.findOne({ email: inviteeEmail });
      if (existingUser) {
        const existingMembership = await WorkspaceMembership.findOne({
          userId: existingUser._id,
          workspaceId,
          status: "active",
        });
        if (existingMembership) {
          return res.status(400).json({
            message: "User already has access to this workspace",
          });
        }
      }

      // Check for existing pending invitation
      const existingInvitation = await WorkspaceInvitation.findOne({
        inviteeEmail: inviteeEmail.toLowerCase(),
        workspaceId,
        status: "pending",
      });

      if (existingInvitation) {
        return res.status(400).json({
          message: "A pending invitation already exists for this email",
        });
      }

      // Validate grantedDirectories if provided
      // Ensure that only selected directories are granted access
      if (grantedDirectories && Array.isArray(grantedDirectories)) {
        if (grantedDirectories.length === 0) {
          return res.status(400).json({
            message: "At least one directory must be selected to grant access",
          });
        }

        // Validate that all directory IDs exist and belong to the workspace domain
        for (const dirAccess of grantedDirectories) {
          if (!dirAccess.directoryId) {
            return res.status(400).json({
              message: "Invalid directory ID in grantedDirectories",
            });
          }

          // Check if directory exists in the workspace domain
          const directory = await Directory.findOne({
            id: dirAccess.directoryId,
            domain: userDomain,
          });

          if (!directory) {
            return res.status(400).json({
              message: `Directory with ID ${dirAccess.directoryId} not found in your workspace`,
            });
          }

          // Validate role
          if (dirAccess.role && !["viewer", "editor"].includes(dirAccess.role)) {
            return res.status(400).json({
              message: `Invalid role "${dirAccess.role}" for directory. Must be "viewer" or "editor"`,
            });
          }
        }
      } else if (grantedDirectories !== undefined) {
        // If grantedDirectories is provided but not an array
        return res.status(400).json({
          message: "grantedDirectories must be an array",
        });
      }

      // Create invitation
      const invitationId = `inv_${Date.now()}_${Math.random()
        .toString(36)
        .substr(2, 9)}`;
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7); // 7 days expiry

      const invitation = new WorkspaceInvitation({
        invitationId,
        inviterId,
        inviterEmail: req.user.email,
        inviterName: req.user.name,
        inviteeEmail: inviteeEmail.toLowerCase(),
        inviteeName: inviteeName || inviteeEmail.split("@")[0],
        workspaceId, // Use workspaceId
        workspaceDomain: userDomain, // Store actual domain for backward compatibility
        workspaceName: workspace.name, // Use actual workspace name
        invitedRole: invitedRole, // Use invitedRole as-is (user/viewer/editor)
        message,
        expiresAt,
        // Persist desired time-bucket permissions on invitation (deprecated but kept for compatibility)
        allowedTimeBuckets:
          Array.isArray(allowedTimeBuckets) && allowedTimeBuckets.length
            ? allowedTimeBuckets
            : ["all"],
        // Store directory access granted with this invitation
        grantedDirectories: Array.isArray(grantedDirectories)
          ? grantedDirectories
          : [],
      });

      await invitation.save();

      // Log activity
      await auditLogger.logInvitationSent(
        inviterId.toString(),
        invitation.invitationId,
        inviteeEmail.toLowerCase(),
        workspace.workspaceId,
        workspace.name,
        userDomain,
        invitedRole
      );

      // Send invitation email
      try {
        await sendInvitationEmail(invitation);
        invitation.emailSent = true;
        invitation.emailSentAt = new Date();
        await invitation.save();
      } catch (emailError) {
        console.error("Failed to send invitation email:", emailError);
        // Don't fail the request if email fails
      }

      res.status(201).json({
        message: "Invitation sent successfully",
        invitation: {
          id: invitation._id,
          invitationId: invitation.invitationId,
          inviteeEmail: invitation.inviteeEmail,
          invitedRole: invitation.invitedRole,
          expiresAt: invitation.expiresAt,
        },
      });
    } catch (error) {
      console.error("Error sending invitation:", error);
      res.status(500).json({ message: "Failed to send invitation" });
    }
  },

  // Get all invitations for a workspace (admin only)
  async getWorkspaceInvitations(req: AuthRequest, res: Response) {
    try {
      if (req.user.role !== "admin") {
        return res.status(403).json({
          message: "Only workspace admins can view invitations",
        });
      }

      // Use workspaceId from currentWorkspace (set by domainAuth middleware)
      const currentWorkspaceId = req.currentWorkspace;
      if (!currentWorkspaceId) {
        return res.status(400).json({
          message: "Workspace context not found",
        });
      }

      // Query by workspaceId (more reliable than workspaceDomain for cross-domain scenarios)
      // Show all invitations for the workspace, not just those sent by the current admin
      const invitations = await WorkspaceInvitation.find({
        workspaceId: currentWorkspaceId,
      })
        .sort({ createdAt: -1 })
        .populate("inviterId", "name email");

      res.json(invitations);
    } catch (error) {
      console.error("Error fetching invitations:", error);
      res.status(500).json({ message: "Failed to fetch invitations" });
    }
  },

  // Get invitations sent to a specific email
  async getInvitationsByEmail(req: AuthRequest, res: Response) {
    try {
      const { email } = req.params;

      const invitations = await WorkspaceInvitation.find({
        inviteeEmail: email.toLowerCase(),
        status: "pending",
        expiresAt: { $gt: new Date() },
      })
        .populate("inviterId", "name email")
        .sort({ createdAt: -1 });

      res.json(invitations);
    } catch (error) {
      console.error("Error fetching invitations by email:", error);
      res.status(500).json({ message: "Failed to fetch invitations" });
    }
  },

  // Accept invitation
  async acceptInvitation(req: AuthRequest, res: Response) {
    try {
      const { invitationId } = req.params;
      const userId = req.user._id;

      // Look up invitation by id (check all statuses first to provide better error messages)
      const invitation = await WorkspaceInvitation.findOne({
        invitationId,
      });

      if (!invitation) {
        return res.status(404).json({
          message: "Invitation not found",
        });
      }

      // Check if invitation is already accepted
      if (invitation.status === "accepted") {
        return res.status(400).json({
          message: "This invitation has already been accepted",
          invitation: {
            invitationId: invitation.invitationId,
            status: invitation.status,
            acceptedAt: invitation.acceptedAt,
          },
        });
      }

      // Check if invitation is pending
      if (invitation.status !== "pending") {
        return res.status(400).json({
          message: `This invitation has been ${invitation.status}`,
        });
      }

      // Ensure the signed-in user matches the invitee
      if (
        !req.user?.email ||
        req.user.email.toLowerCase() !== invitation.inviteeEmail.toLowerCase()
      ) {
        return res.status(403).json({
          message:
            "This invitation was sent to a different email. Please sign in with the invited email to accept.",
          invitedEmail: invitation.inviteeEmail,
        });
      }

      if (new Date() > invitation.expiresAt) {
        invitation.status = "expired";
        await invitation.save();
        return res.status(400).json({
          message: "Invitation has expired",
        });
      }

      // Add workspace access via WorkspaceMembership
      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      // Check if user already has membership
      const existingMembership = await WorkspaceMembership.findOne({
        userId: user._id,
        workspaceId: invitation.workspaceId,
        status: "active",
      });

      if (existingMembership) {
        // If membership exists but invitation is still pending, update invitation status
        if (invitation.status === "pending") {
          invitation.status = "accepted";
          invitation.acceptedAt = new Date();
          await invitation.save();
        }
        return res.status(400).json({
          message: "You already have access to this workspace",
          alreadyAccepted: true,
        });
      }

      // Create workspace membership
      // Map invitation role to membership role (standardized mapping)
      // invitedRole: "user" | "viewer" | "editor" → membershipRole: "editor" | "viewer" | "admin"
      let membershipRole: "admin" | "editor" | "viewer" = "editor";
      if (invitation.invitedRole === "viewer") {
        membershipRole = "viewer";
      } else if (invitation.invitedRole === "editor") {
        membershipRole = "editor"; // Editor maps to editor (consistent naming)
      } else if (invitation.invitedRole === "user") {
        membershipRole = "editor"; // "user" maps to "editor" (can edit documents)
      }
      // Note: "admin" role can only be granted by domain admins, not through invitations
      
      const membership = new WorkspaceMembership({
        userId: user._id,
        workspaceId: invitation.workspaceId,
        role: membershipRole,
        invitedBy: invitation.inviterId,
        joinedAt: new Date(),
        status: "active",
      });
      await membership.save();

      // Log activity
      const workspace = await Workspace.findOne({ workspaceId: invitation.workspaceId });
      const inviter = await User.findById(invitation.inviterId);
      await auditLogger.logMemberAdded(
        invitation.inviterId.toString(),
        user._id.toString(),
        invitation.workspaceId,
        workspace?.name || invitation.workspaceName,
        workspace?.domain || inviter?.domain || "unknown",
        membershipRole
      );

      // Log invitation acceptance
      await auditLogger.logInvitationAccepted(
        user._id.toString(),
        invitation.invitationId,
        invitation.workspaceId,
        invitation.workspaceName,
        workspace?.domain || inviter?.domain || "unknown"
      );

      // Set as current workspace if user doesn't have one
      if (!user.currentWorkspace) {
        user.currentWorkspace = invitation.workspaceId;
        await user.save();
      }

      // Auto-grant directory access if directories were specified in invitation
      if (
        invitation.grantedDirectories &&
        Array.isArray(invitation.grantedDirectories) &&
        invitation.grantedDirectories.length > 0
      ) {
        console.log(`[acceptInvitation] Processing ${invitation.grantedDirectories.length} granted directories for user ${userId}`);
        // Get the inviter's actual domain (not workspace slug)
        const inviter = await User.findById(invitation.inviterId);
        if (!inviter) {
          console.error("Inviter not found for invitation:", invitation.invitationId);
          // Continue without directory access if inviter not found
        } else {
          const actualDomain = inviter.domain; // Use inviter's actual domain (e.g., "excollo.com")
          const userIdString = userId.toString();
          console.log(`[acceptInvitation] Inviter domain: ${actualDomain}, UserId: ${userIdString}`);

          for (const dirAccess of invitation.grantedDirectories) {
            console.log(`[acceptInvitation] Processing directory: ${dirAccess.directoryId}, role: ${dirAccess.role}`);
            // Check if directory exists - directories use actual domain, not workspace slug
            const directory = await Directory.findOne({
              id: dirAccess.directoryId,
              domain: actualDomain,
            });

            if (!directory) {
              console.log(`[acceptInvitation] ⚠ Directory not found: ${dirAccess.directoryId} in domain ${actualDomain}`);
              // Try to find directory without domain filter
              const dirWithoutDomain = await Directory.findOne({
                id: dirAccess.directoryId,
              });
              if (dirWithoutDomain) {
                console.log(`[acceptInvitation] ⚠ Directory found but with different domain: ${dirWithoutDomain.domain} (expected: ${actualDomain})`);
              }
            } else {
              console.log(`[acceptInvitation] ✓ Directory found: ${directory.name} (${directory.id}) in domain ${directory.domain}`);
              
              // Check if share already exists to avoid duplicates
              // Query should match the actual document structure
              const existingShare = await SharePermission.findOne({
                domain: actualDomain,
                resourceType: "directory",
                resourceId: dirAccess.directoryId,
                scope: "user",
                principalId: userIdString,
              });

              if (!existingShare) {
                // Generate share ID
                const shareId = `shr_${Date.now()}_${Math.random()
                  .toString(36)
                  .substr(2, 9)}`;

                console.log(`[acceptInvitation] Creating SharePermission for directory ${dirAccess.directoryId}, userId: ${userIdString}, domain: ${actualDomain}`);
                
                // Use native MongoDB insert to bypass old index issues (same as script)
                try {
                  // Clean up any existing SharePermissions with null linkToken
                  await SharePermission.deleteMany({
                    domain: actualDomain,
                    resourceType: "directory",
                    resourceId: dirAccess.directoryId,
                    scope: "user",
                    principalId: userIdString,
                    linkToken: null,
                  });
                  
                  // Create SharePermission using native MongoDB insert
                  const uniqueLinkToken = `user_${shareId}`;
                  const sharePermissionDoc = {
                    id: shareId,
                    resourceType: "directory",
                    resourceId: dirAccess.directoryId,
                    domain: actualDomain,
                    scope: "user",
                    principalId: userIdString,
                    role: dirAccess.role,
                    invitedEmail: invitation.inviteeEmail,
                    createdBy: invitation.inviterId.toString(),
                    linkToken: uniqueLinkToken, // Set unique value to bypass old index
                    createdAt: new Date(),
                    updatedAt: new Date(),
                  };
                  
                  // Use native MongoDB collection to insert directly
                  const collection = mongoose.connection.db.collection("sharepermissions");
                  await collection.insertOne(sharePermissionDoc);
                  
                  // Verify it was created
                  const verifyShare = await SharePermission.findOne({
                    domain: actualDomain,
                    resourceType: "directory",
                    resourceId: dirAccess.directoryId,
                    scope: "user",
                    principalId: userIdString,
                  });
                  
                  if (verifyShare) {
                    console.log(`[acceptInvitation] ✓ SharePermission created and verified: ${verifyShare.id}, domain: ${verifyShare.domain}`);
                  } else {
                    throw new Error("SharePermission was not created despite insertOne success");
                  }
                } catch (insertError: any) {
                  // Handle duplicate key error gracefully
                  if (insertError.code === 11000) {
                    const verifyShare = await SharePermission.findOne({
                      domain: actualDomain,
                      resourceType: "directory",
                      resourceId: dirAccess.directoryId,
                      scope: "user",
                      principalId: userIdString,
                    });
                    if (verifyShare) {
                      console.log(`[acceptInvitation] SharePermission already exists (duplicate key handled)`);
                    } else {
                      console.error(`[acceptInvitation] Error creating SharePermission: ${insertError.message}`);
                      throw insertError;
                    }
                  } else {
                    console.error(`[acceptInvitation] Error creating SharePermission: ${insertError.message}`);
                    throw insertError;
                  }
                }
              } else {
                console.log(`[acceptInvitation] SharePermission already exists for directory ${dirAccess.directoryId}`);
                // Update role if it's different
                if (existingShare.role !== dirAccess.role) {
                  existingShare.role = dirAccess.role;
                  await existingShare.save();
                }
              }
            }
          }
        }
      } else {
        console.log(`[acceptInvitation] No grantedDirectories in invitation or empty array`);
      }

      // Update invitation status to accepted
      invitation.status = "accepted";
      invitation.acceptedAt = new Date();
      
      // Save invitation with error handling
      try {
        await invitation.save();
        console.log(`Invitation ${invitationId} status updated to accepted`);
      } catch (saveError: any) {
        console.error("Error saving invitation status:", saveError);
        // Continue even if save fails, but log it
      }

      // Verify the status was saved
      const savedInvitation = await WorkspaceInvitation.findOne({
        invitationId,
      });
      
      if (savedInvitation?.status !== "accepted") {
        console.error(`Warning: Invitation ${invitationId} status may not have been saved correctly. Expected: accepted, Got: ${savedInvitation?.status}`);
        // Try to update again
        await WorkspaceInvitation.updateOne(
          { invitationId },
          { status: "accepted", acceptedAt: new Date() }
        );
      }

      res.json({
        message: "Invitation accepted successfully",
        workspace: {
          workspaceId: invitation.workspaceId,
          name: invitation.workspaceName,
          role: membership.role,
        },
        invitation: {
          invitationId: invitation.invitationId,
          status: "accepted",
        },
      });
    } catch (error) {
      console.error("Error accepting invitation:", error);
      res.status(500).json({ message: "Failed to accept invitation" });
    }
  },

  // Decline invitation
  async declineInvitation(req: AuthRequest, res: Response) {
    try {
      const { invitationId } = req.params;

      const invitation = await WorkspaceInvitation.findOne({
        invitationId,
        inviteeEmail: req.user.email.toLowerCase(),
        status: "pending",
      });

      if (!invitation) {
        return res.status(404).json({
          message: "Invitation not found or already processed",
        });
      }

      invitation.status = "declined";
      invitation.declinedAt = new Date();
      await invitation.save();

      res.json({ message: "Invitation declined successfully" });
    } catch (error) {
      console.error("Error declining invitation:", error);
      res.status(500).json({ message: "Failed to decline invitation" });
    }
  },

  // Cancel invitation (admin only)
  async cancelInvitation(req: AuthRequest, res: Response) {
    try {
      const { invitationId } = req.params;
      const workspaceDomain = req.userDomain;

      if (req.user.role !== "admin") {
        return res.status(403).json({
          message: "Only workspace admins can cancel invitations",
        });
      }

      const invitation = await WorkspaceInvitation.findOne({
        invitationId,
        workspaceDomain,
        inviterId: req.user._id,
        status: "pending",
      });

      if (!invitation) {
        return res.status(404).json({
          message: "Invitation not found",
        });
      }

      invitation.status = "cancelled";
      await invitation.save();

      res.json({ message: "Invitation cancelled successfully" });
    } catch (error) {
      console.error("Error cancelling invitation:", error);
      res.status(500).json({ message: "Failed to cancel invitation" });
    }
  },

  // Delete invitation record (admin only)
  async deleteInvitation(req: AuthRequest, res: Response) {
    try {
      const { invitationId } = req.params;
      const workspaceDomain = req.userDomain;

      if (req.user.role !== "admin") {
        return res.status(403).json({
          message: "Only workspace admins can delete invitations",
        });
      }

      const invitation = await WorkspaceInvitation.findOne({
        invitationId,
        workspaceDomain,
        inviterId: req.user._id,
      });

      if (!invitation) {
        return res.status(404).json({ message: "Invitation not found" });
      }

      await WorkspaceInvitation.deleteOne({ _id: invitation._id });
      res.json({ message: "Invitation deleted" });
    } catch (error) {
      console.error("Error deleting invitation:", error);
      res.status(500).json({ message: "Failed to delete invitation" });
    }
  },

  // Get user's accessible workspaces
  async getUserWorkspaces(req: AuthRequest, res: Response) {
    try {
      const user = await User.findById(req.user._id).select("currentWorkspace");

      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      // Get workspaces via membership
      const memberships = await WorkspaceMembership.find({
        userId: user._id,
        status: "active",
      });

      const workspaceIds = memberships.map((m) => m.workspaceId);
      const workspaces = await Workspace.find({
        workspaceId: { $in: workspaceIds },
        status: "active",
      });

      // Also get legacy accessibleWorkspaces for backward compatibility
      const legacyWorkspaces = (user.accessibleWorkspaces || []).filter((ws: any) => ws.isActive !== false);
      
      // Get workspaces from legacy system that aren't in membership yet
      const legacyWorkspaceSlugs = legacyWorkspaces.map((ws: any) => ws.workspaceDomain);
      const legacyWorkspacesFromDB = await Workspace.find({
        domain: user.domain,
        slug: { $in: legacyWorkspaceSlugs },
        status: "active",
      });

      // Combine membership-based and legacy workspaces, deduplicate
      const allWorkspacesMap = new Map<string, any>();
      
      // Add membership-based workspaces
      workspaces.forEach((ws) => {
        const membership = memberships.find((m) => m.workspaceId === ws.workspaceId);
        allWorkspacesMap.set(ws.workspaceId, {
          workspaceDomain: ws.workspaceId,
          workspaceName: ws.name,
          role: membership?.role || "editor",
          isActive: true,
        });
      });
      
      // Add legacy workspaces not yet in membership
      legacyWorkspaces.forEach((legacyWs: any) => {
        const legacyWsFromDB = legacyWorkspacesFromDB.find(
          (ws) => ws.slug.toLowerCase() === (legacyWs.workspaceDomain || "").toLowerCase()
        );
        
        // If found in DB, use workspaceId; otherwise use legacy slug (for backward compatibility)
        const wsId = legacyWsFromDB?.workspaceId || legacyWs.workspaceDomain;
        
        if (!allWorkspacesMap.has(wsId)) {
          allWorkspacesMap.set(wsId, {
            workspaceDomain: wsId,
            workspaceName: legacyWs.workspaceName || legacyWs.workspaceDomain,
            role: legacyWs.role || "editor",
            isActive: true,
          });
        }
      });

      const workspacesWithRole = Array.from(allWorkspacesMap.values());

      res.json({
        workspaces: workspacesWithRole,
        currentWorkspace: user.currentWorkspace,
      });
    } catch (error) {
      console.error("Error fetching user workspaces:", error);
      res.status(500).json({ message: "Failed to fetch workspaces" });
    }
  },

  // Switch workspace
  async switchWorkspace(req: AuthRequest, res: Response) {
    try {
      const { workspaceDomain } = req.body; // This is actually workspaceId now
      const userId = req.user._id;

      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      // Check if user has membership in this workspace
      const membership = await WorkspaceMembership.findOne({
        userId: user._id,
        workspaceId: workspaceDomain, // workspaceDomain is actually workspaceId
        status: "active",
      });

      if (!membership) {
        return res.status(403).json({
          message: "You don't have access to this workspace",
        });
      }

      // Verify workspace exists
      const workspace = await Workspace.findOne({
        workspaceId: workspaceDomain,
        status: "active",
      });

      if (!workspace) {
        return res.status(404).json({ message: "Workspace not found" });
      }

      user.currentWorkspace = workspaceDomain;
      await user.save();

      res.json({
        message: "Workspace switched successfully",
        currentWorkspace: workspaceDomain,
      });
    } catch (error) {
      console.error("Error switching workspace:", error);
      res.status(500).json({ message: "Failed to switch workspace" });
    }
  },

  // Update friendly workspace name for the current user
  async updateWorkspaceName(req: AuthRequest, res: Response) {
    try {
      const { workspaceDomain, workspaceName } = req.body as {
        workspaceDomain: string;
        workspaceName: string;
      };

      if (!workspaceDomain || !workspaceName) {
        return res
          .status(400)
          .json({ message: "workspaceDomain and workspaceName are required" });
      }

      const trimmed = (workspaceName || "").trim();
      if (trimmed.length < 2 || trimmed.length > 64) {
        return res
          .status(400)
          .json({ message: "Workspace name must be 2-64 characters" });
      }

      const user = await User.findById(req.user._id);
      if (!user) return res.status(404).json({ message: "User not found" });

      const idx = (user.accessibleWorkspaces || []).findIndex(
        (ws: any) =>
          (ws.workspaceDomain || "").toLowerCase() ===
          (workspaceDomain || "").toLowerCase()
      );
      if (idx === -1) {
        return res
          .status(404)
          .json({ message: "Workspace not found for this user" });
      }

      (user.accessibleWorkspaces[idx] as any).workspaceName = trimmed;
      await user.save();

      res.json({ message: "Workspace name updated", workspaceName: trimmed });
    } catch (error) {
      console.error("Error updating workspace name:", error);
      res.status(500).json({ message: "Failed to update workspace name" });
    }
  },

  // Admin: update a user's allowed time buckets for this workspace
  async updateUserTimeBuckets(req: AuthRequest, res: Response) {
    try {
      if (req.user.role !== "admin") {
        return res
          .status(403)
          .json({ message: "Only admins can update permissions" });
      }

      const { userEmail, allowedTimeBuckets } = req.body as {
        userEmail: string;
        allowedTimeBuckets: (
          | "today"
          | "last7"
          | "last15"
          | "last30"
          | "last90"
          | "all"
        )[];
      };

      if (
        !userEmail ||
        !Array.isArray(allowedTimeBuckets) ||
        allowedTimeBuckets.length === 0
      ) {
        return res
          .status(400)
          .json({ message: "userEmail and allowedTimeBuckets are required" });
      }

      const user = await User.findOne({ email: userEmail.toLowerCase() });
      if (!user) return res.status(404).json({ message: "User not found" });

      const idx = (user.accessibleWorkspaces || []).findIndex(
        (ws: any) =>
          (ws.workspaceDomain || "").toLowerCase() ===
          (req.userDomain || "").toLowerCase()
      );
      if (idx === -1) {
        return res
          .status(404)
          .json({ message: "User does not have access to this workspace" });
      }

      (user.accessibleWorkspaces[idx] as any).allowedTimeBuckets =
        allowedTimeBuckets;
      await user.save();

      return res.json({ message: "Permissions updated", allowedTimeBuckets });
    } catch (error) {
      console.error("Error updating user time buckets:", error);
      return res.status(500).json({ message: "Failed to update permissions" });
    }
  },

  // Admin: revoke a user's access to this workspace
  async revokeUserAccess(req: AuthRequest, res: Response) {
    try {
      if (req.user.role !== "admin") {
        return res
          .status(403)
          .json({ message: "Only admins can revoke access" });
      }

      const { invitationId } = req.body as { invitationId: string };
      if (!invitationId) {
        return res.status(400).json({ message: "invitationId is required" });
      }

      // Get the current workspace ID from the request context
      const headerWorkspace = req.headers["x-workspace"] as string;
      const currentWorkspaceId = headerWorkspace || req.currentWorkspace || req.userDomain;
      
      if (!currentWorkspaceId) {
        return res.status(400).json({ 
          message: "Workspace context not found. Please ensure you have selected a workspace." 
        });
      }

      // Find the invitation by ID
      const invitation = await WorkspaceInvitation.findOne({
        invitationId,
        workspaceId: currentWorkspaceId,
      });

      if (!invitation) {
        return res.status(404).json({ message: "Invitation not found" });
      }

      // Get the user from the invitation
      const user = await User.findOne({ email: invitation.inviteeEmail.toLowerCase() });
      if (!user) {
        // If user doesn't exist, just delete the invitation
        await WorkspaceInvitation.deleteOne({ _id: invitation._id });
        return res.json({ 
          message: "Invitation deleted (user not found)",
          deleted: {
            membership: 0,
            invitations: 1,
            directoryShares: 0,
          },
        });
      }

      // Check if user has membership in this workspace
      const membership = await WorkspaceMembership.findOne({
        userId: user._id,
        workspaceId: currentWorkspaceId,
      });

      // Delete WorkspaceMembership if exists (regardless of status)
      let deletedMembership = false;
      if (membership) {
        await WorkspaceMembership.deleteOne({ _id: membership._id });
        deletedMembership = true;
        console.log(`Deleted membership for user ${invitation.inviteeEmail} in workspace ${currentWorkspaceId}`);
      }

      // Remove from legacy accessibleWorkspaces
      const before = (user.accessibleWorkspaces || []).length;
      user.accessibleWorkspaces = (user.accessibleWorkspaces || []).filter((ws: any) => {
        const wsDomain = (ws.workspaceDomain || "").toLowerCase();
        return wsDomain !== currentWorkspaceId.toLowerCase();
      });

      // If currentWorkspace was this workspace, switch to another available workspace
      if ((user.currentWorkspace || "").toLowerCase() === currentWorkspaceId.toLowerCase()) {
        // Try to find another active membership
        const otherMemberships = await WorkspaceMembership.find({
          userId: user._id,
          status: "active",
          workspaceId: { $ne: currentWorkspaceId },
        });

        if (otherMemberships.length > 0) {
          user.currentWorkspace = otherMemberships[0].workspaceId;
        } else if ((user.accessibleWorkspaces || []).length > 0) {
          user.currentWorkspace = user.accessibleWorkspaces?.[0]?.workspaceDomain || "";
        } else {
          // Switch to user's own domain if no other workspace
          user.currentWorkspace = user.domain || "";
        }
      }

      await user.save();

      // Revoke all directory access for this user in this workspace
      const workspace = await Workspace.findOne({ workspaceId: currentWorkspaceId });
      let deletedShares = 0;
      if (workspace) {
        // Get all directories in this workspace's domain
        const directories = await Directory.find({ domain: workspace.domain });
        const directoryIds = directories.map(d => d.id);
        
        // Delete all share permissions for this user in these directories
        const deleteResult = await SharePermission.deleteMany({
          principalId: user._id.toString(),
          resourceType: "directory",
          resourceId: { $in: directoryIds },
          scope: "user",
        });
        deletedShares = deleteResult.deletedCount;
        console.log(`Deleted ${deletedShares} directory share(s) for user ${invitation.inviteeEmail}`);
      }

      // Delete the specific invitation record
      await WorkspaceInvitation.deleteOne({ _id: invitation._id });
      console.log(`Deleted invitation ${invitationId} for user ${invitation.inviteeEmail} in workspace ${currentWorkspaceId}`);

      return res.json({ 
        message: "Invitation and membership deleted successfully",
        deleted: {
          membership: deletedMembership ? 1 : 0,
          invitations: 1,
          directoryShares: deletedShares,
        },
      });
    } catch (error) {
      console.error("Error revoking user access:", error);
      return res.status(500).json({ message: "Failed to revoke access" });
    }
  },

  // Admin: grant directory access to a user
  async grantDirectoryAccess(req: AuthRequest, res: Response) {
    try {
      if (req.user.role !== "admin") {
        return res
          .status(403)
          .json({ message: "Only admins can grant directory access" });
      }

      const { userEmail, directoryIds, role } = req.body as {
        userEmail: string;
        directoryIds: string[];
        role: "viewer" | "editor";
      };

      if (!userEmail || !Array.isArray(directoryIds) || directoryIds.length === 0 || !role) {
        return res.status(400).json({
          message: "userEmail, directoryIds array, and role are required",
        });
      }

      const user = await User.findOne({ email: userEmail.toLowerCase() });
      if (!user) return res.status(404).json({ message: "User not found" });

      // Verify user is in the workspace - use WorkspaceMembership as source of truth
      const workspaceId = req.currentWorkspace;
      if (!workspaceId) {
        return res.status(400).json({ message: "Workspace context is required" });
      }

      // Check WorkspaceMembership first (primary source of truth)
      const membership = await WorkspaceMembership.findOne({
        userId: user._id,
        workspaceId: workspaceId,
        status: "active",
      });

      // Fallback to legacy accessibleWorkspaces check for backward compatibility
      let hasWorkspaceAccess = !!membership;
      if (!hasWorkspaceAccess) {
        const workspaceDomain = req.userDomain;
        hasWorkspaceAccess = (user.accessibleWorkspaces || []).some(
          (ws: any) =>
            ((ws.workspaceDomain || "").toLowerCase() ===
              (workspaceDomain || "").toLowerCase()) && ws.isActive !== false
        );
      }

      if (!hasWorkspaceAccess) {
        return res
          .status(400)
          .json({ message: "User does not have access to this workspace" });
      }

      // Use actual user domain (not workspace slug)
      // Get domain from workspace or use req.userDomain
      const workspace = await Workspace.findOne({ workspaceId: workspaceId });
      const domain = workspace?.domain || req.userDomain || req.user?.domain;
      const userIdString = user._id.toString();
      const granted: string[] = [];
      const errors: string[] = [];

      for (const directoryId of directoryIds) {
        try {
          // Verify directory exists
          const directory = await Directory.findOne({
            id: directoryId,
            domain,
          });

          if (!directory) {
            errors.push(`Directory ${directoryId} not found`);
            continue;
          }

          // Check if share already exists
          const existingShare = await SharePermission.findOne({
            domain,
            resourceType: "directory",
            resourceId: directoryId,
            scope: "user",
            principalId: userIdString,
          });

          if (existingShare) {
            // Update existing share role
            const oldRole = existingShare.role;
            existingShare.role = role;
            await existingShare.save();
            granted.push(directoryId);
            
            // Log activity if role changed
            if (oldRole !== role) {
              const workspace = await Workspace.findOne({ workspaceId: req.currentWorkspace });
              const directory = await Directory.findOne({ id: directoryId, domain });
              await auditLogger.logDirectoryAccessGranted(
                req.user._id.toString(),
                userIdString,
                directoryId,
                directory?.name || directoryId,
                req.currentWorkspace || domain,
                workspace?.name || req.currentWorkspace || domain,
                domain,
                role
              );
            }
          } else {
            // Create new share using updateOne with upsert to avoid duplicate key errors
            const shareId = `shr_${Date.now()}_${Math.random()
              .toString(36)
              .substr(2, 9)}`;

            try {
              // Clean up any existing SharePermissions with null linkToken
              await SharePermission.deleteMany({
                domain,
                resourceType: "directory",
                resourceId: directoryId,
                scope: "user",
                principalId: userIdString,
                linkToken: null,
              });
              
              // Use native MongoDB insert to bypass old index issues (same as script)
              const uniqueLinkToken = `user_${shareId}`;
              const sharePermissionDoc = {
                id: shareId,
                resourceType: "directory",
                resourceId: directoryId,
                domain,
                scope: "user",
                principalId: userIdString,
                role,
                invitedEmail: userEmail.toLowerCase(),
                createdBy: req.user._id.toString(),
                linkToken: uniqueLinkToken, // Set unique value to bypass old index
                createdAt: new Date(),
                updatedAt: new Date(),
              };
              
              // Use native MongoDB collection to insert directly
              const collection = mongoose.connection.db.collection("sharepermissions");
              await collection.insertOne(sharePermissionDoc);
              
              // Verify it was created
              const verifyShare = await SharePermission.findOne({
                domain,
                resourceType: "directory",
                resourceId: directoryId,
                scope: "user",
                principalId: userIdString,
              });
              
              if (!verifyShare) {
                throw new Error("SharePermission was not created despite insertOne success");
              }
              
              granted.push(directoryId);
              
              // Log activity
              const workspace = await Workspace.findOne({ workspaceId: req.currentWorkspace });
              const directory = await Directory.findOne({ id: directoryId, domain });
              await auditLogger.logDirectoryAccessGranted(
                req.user._id.toString(),
                userIdString,
                directoryId,
                directory?.name || directoryId,
                req.currentWorkspace || domain,
                workspace?.name || req.currentWorkspace || domain,
                domain,
                role
              );
            } catch (saveError: any) {
              // Handle duplicate key error gracefully
              if (saveError.code === 11000 && saveError.keyPattern?.scope && saveError.keyPattern?.linkToken) {
                console.log(`Share permission already exists for directory ${directoryId} and user ${userIdString}, skipping...`);
                granted.push(directoryId); // Consider it granted since it already exists
              } else {
                throw saveError; // Re-throw if it's a different error
              }
            }
          }
        } catch (error: any) {
          errors.push(`Failed to grant access to ${directoryId}: ${error.message}`);
        }
      }

      return res.json({
        message: "Directory access granted",
        granted,
        errors: errors.length > 0 ? errors : undefined,
      });
    } catch (error) {
      console.error("Error granting directory access:", error);
      return res
        .status(500)
        .json({ message: "Failed to grant directory access" });
    }
  },

  // Admin: revoke directory access from a user
  async revokeDirectoryAccess(req: AuthRequest, res: Response) {
    try {
      if (req.user.role !== "admin") {
        return res
          .status(403)
          .json({ message: "Only admins can revoke directory access" });
      }

      const { userEmail, directoryId } = req.body as {
        userEmail: string;
        directoryId: string;
      };

      if (!userEmail || !directoryId) {
        return res
          .status(400)
          .json({ message: "userEmail and directoryId are required" });
      }

      const user = await User.findOne({ email: userEmail.toLowerCase() });
      if (!user) return res.status(404).json({ message: "User not found" });

      // Use actual user domain (not workspace slug)
      // req.userDomain might be workspace slug, but SharePermission uses actual domain
      const domain = req.user?.domain || req.userDomain;
      const userIdString = user._id.toString();

      const share = await SharePermission.findOne({
        domain,
        resourceType: "directory",
        resourceId: directoryId,
        scope: "user",
        principalId: userIdString,
      });

      if (!share) {
        return res.status(404).json({
          message: "Directory access not found",
        });
      }

      await SharePermission.deleteOne({ _id: share._id });

      // Log activity
      const workspace = await Workspace.findOne({ workspaceId: req.currentWorkspace });
      const directory = await Directory.findOne({ id: directoryId, domain });
      await auditLogger.logDirectoryAccessRevoked(
        req.user._id.toString(),
        userIdString,
        directoryId,
        directory?.name || directoryId,
        req.currentWorkspace || domain,
        workspace?.name || req.currentWorkspace || domain,
        domain
      );

      return res.json({ message: "Directory access revoked" });
    } catch (error) {
      console.error("Error revoking directory access:", error);
      return res
        .status(500)
        .json({ message: "Failed to revoke directory access" });
    }
  },

  // Admin: get all directories a user has access to
  async getUserDirectories(req: AuthRequest, res: Response) {
    try {
      if (req.user.role !== "admin") {
        return res
          .status(403)
          .json({ message: "Only admins can view user directory access" });
      }

      const { userEmail } = req.params as { userEmail: string };
      if (!userEmail) {
        return res.status(400).json({ message: "userEmail is required" });
      }

      const user = await User.findOne({ email: userEmail.toLowerCase() });
      if (!user) return res.status(404).json({ message: "User not found" });

      const currentWorkspaceId = req.currentWorkspace;
      if (!currentWorkspaceId) {
        return res.status(400).json({ message: "Workspace context required" });
      }

      // Get the workspace domain
      const workspace = await Workspace.findOne({ workspaceId: currentWorkspaceId });
      const workspaceDomain = workspace?.domain || req.user?.domain || req.userDomain;
      
      const userIdString = user._id.toString();

      // Get all user-scoped shares for this user in the workspace domain
      // Include domain in query to match SharePermissions created with domain
      const shares = await SharePermission.find({
        domain: workspaceDomain,
        resourceType: "directory",
        scope: "user",
        principalId: userIdString,
      });

      // Filter shares that are in the workspace domain or match directories in workspace
      const workspaceShares = await Promise.all(
        shares.map(async (share) => {
          // Check if directory exists in workspace domain
          const directory = await Directory.findOne({
            id: share.resourceId,
            workspaceId: currentWorkspaceId,
          });
          
          if (directory && (share.domain === workspaceDomain || share.domain === directory.domain)) {
            return {
              share,
              directory,
            };
          }
          return null;
        })
      );

      const validShares = workspaceShares.filter((s): s is { share: any; directory: any } => s !== null);

      // Get directory details for each share
      const directoriesWithAccess = validShares.map(({ share, directory }) => ({
        directoryId: share.resourceId,
        directoryName: directory?.name || "Unknown",
        role: share.role,
        shareId: share.id,
        grantedAt: share.createdAt || new Date(),
        createdAt: share.createdAt,
      }));

      return res.json({ directories: directoriesWithAccess });
    } catch (error) {
      console.error("Error fetching user directories:", error);
      return res
        .status(500)
        .json({ message: "Failed to fetch user directories" });
    }
  },

  // Admin: Get all workspace members with their roles and permissions
  async getWorkspaceMembers(req: AuthRequest, res: Response) {
    try {
      if (req.user.role !== "admin") {
        return res.status(403).json({ message: "Only admins can view workspace members" });
      }

      const currentWorkspaceId = req.currentWorkspace;
      if (!currentWorkspaceId) {
        return res.status(400).json({ message: "Workspace context required" });
      }

      // Get all active memberships for this workspace
      const memberships = await WorkspaceMembership.find({
        workspaceId: currentWorkspaceId,
        status: "active",
      }).populate("userId", "name email domain role");

      // Get workspace invitations for pending members
      const pendingInvitations = await WorkspaceInvitation.find({
        workspaceId: currentWorkspaceId,
        status: "pending",
      });

      // Get directory access for each member
      const membersWithPermissions = await Promise.all(
        memberships.map(async (membership: any) => {
          const user = membership.userId;
          if (!user) return null;

          // Get directory-level permissions
          const directoryShares = await SharePermission.find({
            scope: "user",
            principalId: user._id.toString(),
            resourceType: "directory",
          }).populate("resourceId");

          return {
            userId: user._id.toString(),
            email: user.email,
            name: user.name,
            domain: user.domain,
            workspaceRole: membership.role, // admin, editor, viewer
            joinedAt: membership.joinedAt,
            invitedBy: membership.invitedBy?.toString(),
            directoryAccess: directoryShares.map((share: any) => ({
              directoryId: share.resourceId,
              role: share.role, // editor, viewer
              grantedAt: share.createdAt,
            })),
          };
        })
      );

      // Format pending invitations
      const pendingMembers = pendingInvitations.map((invitation) => ({
        invitationId: invitation.invitationId,
        email: invitation.inviteeEmail,
        name: invitation.inviteeName,
        workspaceRole: invitation.invitedRole, // user, viewer, editor
        invitedAt: invitation.createdAt,
        invitedBy: invitation.inviterId.toString(),
        directoryAccess: invitation.grantedDirectories || [],
        expiresAt: invitation.expiresAt,
      }));

      return res.json({
        members: membersWithPermissions.filter((m) => m !== null),
        pending: pendingMembers,
      });
    } catch (error) {
      console.error("Error fetching workspace members:", error);
      return res.status(500).json({ message: "Failed to fetch workspace members" });
    }
  },

  // Admin: Update workspace member role
  async updateMemberRole(req: AuthRequest, res: Response) {
    try {
      if (req.user.role !== "admin") {
        return res.status(403).json({ message: "Only admins can update member roles" });
      }

      const currentWorkspaceId = req.currentWorkspace;
      if (!currentWorkspaceId) {
        return res.status(400).json({ message: "Workspace context required" });
      }

      const { userId, role } = req.body as {
        userId: string;
        role: "admin" | "editor" | "viewer";
      };

      if (!userId || !role) {
        return res.status(400).json({ message: "userId and role are required" });
      }

      // Validate role
      if (!["admin", "editor", "viewer"].includes(role)) {
        return res.status(400).json({ message: "Invalid role. Must be admin, editor, or viewer" });
      }

      // Check if user is trying to update themselves
      if (userId === req.user._id.toString()) {
        return res.status(400).json({ message: "Cannot update your own role" });
      }

      // Find membership
      const membership = await WorkspaceMembership.findOne({
        userId,
        workspaceId: currentWorkspaceId,
        status: "active",
      });

      if (!membership) {
        return res.status(404).json({ message: "Member not found in this workspace" });
      }

      // Get old role for audit log
      const oldRole = membership.role;

      // Update role
      membership.role = role;
      await membership.save();

      // Log activity
      const workspace = await Workspace.findOne({ workspaceId: currentWorkspaceId });
      await auditLogger.logRoleChange(
        req.user._id.toString(),
        userId,
        currentWorkspaceId,
        workspace?.name || currentWorkspaceId,
        workspace?.domain || req.userDomain || req.user?.domain,
        oldRole,
        role
      );

      return res.json({
        message: "Member role updated successfully",
        membership: {
          userId: membership.userId.toString(),
          workspaceId: membership.workspaceId,
          role: membership.role,
        },
      });
    } catch (error) {
      console.error("Error updating member role:", error);
      return res.status(500).json({ message: "Failed to update member role" });
    }
  },

  // Admin: Remove member from workspace
  async removeWorkspaceMember(req: AuthRequest, res: Response) {
    try {
      if (req.user.role !== "admin") {
        return res.status(403).json({ message: "Only admins can remove members" });
      }

      const currentWorkspaceId = req.currentWorkspace;
      if (!currentWorkspaceId) {
        return res.status(400).json({ message: "Workspace context required" });
      }

      const { userId } = req.params as { userId: string };

      if (!userId) {
        return res.status(400).json({ message: "userId is required" });
      }

      // Check if user is trying to remove themselves
      if (userId === req.user._id.toString()) {
        return res.status(400).json({ message: "Cannot remove yourself from workspace" });
      }

      // Find membership
      const membership = await WorkspaceMembership.findOne({
        userId,
        workspaceId: currentWorkspaceId,
      });

      if (!membership) {
        return res.status(404).json({ message: "Member not found in this workspace" });
      }

      // Get workspace to find its domain
      const workspace = await Workspace.findOne({ workspaceId: currentWorkspaceId });
      const workspaceDomain = workspace?.domain || req.userDomain || req.user?.domain;

      // Suspend membership
      membership.status = "suspended";
      await membership.save();

      // Update user's currentWorkspace if it's this workspace
      const user = await User.findById(userId);
      if (user && user.currentWorkspace === currentWorkspaceId) {
        // Switch to another active workspace or user's domain
        const otherMembership = await WorkspaceMembership.findOne({
          userId,
          status: "active",
          workspaceId: { $ne: currentWorkspaceId },
        });

        if (otherMembership) {
          user.currentWorkspace = otherMembership.workspaceId;
        } else {
          user.currentWorkspace = user.domain;
        }
        await user.save();
      }

      // Remove all SharePermissions for this user in this workspace's directories
      const directories = await Directory.find({
        workspaceId: currentWorkspaceId,
        domain: workspaceDomain,
      });

      for (const directory of directories) {
        await SharePermission.deleteMany({
          domain: workspaceDomain,
          resourceType: "directory",
          resourceId: directory.id,
          scope: "user",
          principalId: userId,
        });
      }

      // Delete workspace invitations for this user
      await WorkspaceInvitation.deleteMany({
        workspaceId: currentWorkspaceId,
        inviteeEmail: user?.email?.toLowerCase(),
      });

      // Log activity
      await auditLogger.logMemberRemoved(
        req.user._id.toString(),
        userId,
        currentWorkspaceId,
        workspace?.name || currentWorkspaceId,
        workspaceDomain
      );

      return res.json({
        message: "Member removed from workspace successfully",
      });
    } catch (error) {
      console.error("Error removing workspace member:", error);
      return res.status(500).json({ message: "Failed to remove workspace member" });
    }
  },

  // Admin: Get activity log for workspace
  async getActivityLog(req: AuthRequest, res: Response) {
    try {
      if (req.user.role !== "admin") {
        return res.status(403).json({ message: "Only admins can view activity logs" });
      }

      const currentWorkspaceId = req.currentWorkspace;
      if (!currentWorkspaceId) {
        return res.status(400).json({ message: "Workspace context required" });
      }

      const { page, pageSize, action, targetUserId } = req.query as {
        page?: string;
        pageSize?: string;
        action?: string;
        targetUserId?: string;
      };

      const { ActivityLog } = await import("../models/ActivityLog");

      const query: any = {
        workspaceId: currentWorkspaceId,
      };

      if (action) {
        query.action = action;
      }

      if (targetUserId) {
        query.targetUserId = targetUserId;
      }

      const pageNum = page ? parseInt(page) : 1;
      const pageSizeNum = pageSize ? parseInt(pageSize) : 50;
      const skip = (pageNum - 1) * pageSizeNum;
      const limit = pageSizeNum;

      const [logs, total] = await Promise.all([
        ActivityLog.find(query)
          .sort({ timestamp: -1 })
          .skip(skip)
          .limit(limit)
          .populate("performedBy", "name email")
          .populate("targetUserId", "name email"),
        ActivityLog.countDocuments(query),
      ]);

      return res.json({
        logs,
        pagination: {
          page: pageNum,
          pageSize: pageSizeNum,
          total,
          totalPages: Math.ceil(total / pageSizeNum),
        },
      });
    } catch (error) {
      console.error("Error fetching activity log:", error);
      return res.status(500).json({ message: "Failed to fetch activity log" });
    }
  },

  // Admin: Get member's detailed permissions
  async getMemberPermissions(req: AuthRequest, res: Response) {
    try {
      if (req.user.role !== "admin") {
        return res.status(403).json({ message: "Only admins can view member permissions" });
      }

      const currentWorkspaceId = req.currentWorkspace;
      if (!currentWorkspaceId) {
        return res.status(400).json({ message: "Workspace context required" });
      }

      const { userId } = req.params as { userId: string };

      if (!userId) {
        return res.status(400).json({ message: "userId is required" });
      }

      // Get membership
      const membership = await WorkspaceMembership.findOne({
        userId,
        workspaceId: currentWorkspaceId,
        status: "active",
      }).populate("userId", "name email domain");

      if (!membership) {
        return res.status(404).json({ message: "Member not found in this workspace" });
      }

      const user = (membership as any).userId;
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      // Get workspace domain
      const workspace = await Workspace.findOne({ workspaceId: currentWorkspaceId });
      const workspaceDomain = workspace?.domain || req.userDomain || req.user?.domain;

      // Get all directory permissions
      const directoryShares = await SharePermission.find({
        scope: "user",
        principalId: userId,
        resourceType: "directory",
      });

      // Get directory details
      const directoryAccess = await Promise.all(
        directoryShares.map(async (share) => {
          const directory = await Directory.findOne({
            id: share.resourceId,
            workspaceId: currentWorkspaceId,
          });

          return {
            directoryId: share.resourceId,
            directoryName: directory?.name || "Unknown",
            role: share.role,
            grantedAt: share.createdAt,
            grantedBy: share.createdBy,
          };
        })
      );

      // Get document permissions (if any)
      const documentShares = await SharePermission.find({
        scope: "user",
        principalId: userId,
        resourceType: "document",
      }).limit(50); // Limit to recent 50

      const documentAccess = await Promise.all(
        documentShares.map(async (share) => {
          const document = await Document.findOne({
            id: share.resourceId,
            workspaceId: currentWorkspaceId,
          });

          return {
            documentId: share.resourceId,
            documentName: document?.name || "Unknown",
            role: share.role,
            grantedAt: share.createdAt,
          };
        })
      );

      return res.json({
        member: {
          userId: user._id.toString(),
          email: user.email,
          name: user.name,
          domain: user.domain,
          workspaceRole: membership.role,
          joinedAt: membership.joinedAt,
          invitedBy: membership.invitedBy?.toString(),
        },
        permissions: {
          workspace: {
            role: membership.role,
            canInvite: membership.role === "admin",
            canEdit: membership.role === "admin" || membership.role === "editor",
            canView: true,
          },
          directories: directoryAccess,
          documents: documentAccess,
        },
      });
    } catch (error) {
      console.error("Error fetching member permissions:", error);
      return res.status(500).json({ message: "Failed to fetch member permissions" });
    }
  },

  // Admin: retroactively grant directory access from accepted invitation
  // This fixes cases where SharePermissions weren't created during invitation acceptance
  async retroactivelyGrantDirectoryAccess(req: AuthRequest, res: Response) {
    try {
      if (req.user.role !== "admin") {
        return res.status(403).json({ message: "Only admins can grant access" });
      }

      const { userEmail } = req.body as { userEmail: string };
      if (!userEmail) {
        return res.status(400).json({ message: "userEmail is required" });
      }

      const currentWorkspaceId = req.currentWorkspace;
      if (!currentWorkspaceId) {
        return res.status(400).json({ message: "Workspace context required" });
      }

      const user = await User.findOne({ email: userEmail.toLowerCase() });
      if (!user) return res.status(404).json({ message: "User not found" });

      // Find accepted invitation for this user in this workspace
      const invitation = await WorkspaceInvitation.findOne({
        inviteeEmail: userEmail.toLowerCase(),
        workspaceId: currentWorkspaceId,
        status: "accepted",
      });

      if (!invitation) {
        return res.status(404).json({ 
          message: "No accepted invitation found for this user in this workspace" 
        });
      }

      if (!invitation.grantedDirectories || invitation.grantedDirectories.length === 0) {
        return res.status(400).json({ 
          message: "Invitation does not have any granted directories" 
        });
      }

      // Get the inviter's domain
      const inviter = await User.findById(invitation.inviterId);
      if (!inviter) {
        return res.status(404).json({ message: "Inviter not found" });
      }

      const actualDomain = inviter.domain;
      const userIdString = user._id.toString();
      const granted: string[] = [];
      const errors: string[] = [];

      console.log(`[retroactivelyGrantDirectoryAccess] Processing ${invitation.grantedDirectories.length} directories for user ${userEmail}`);

      for (const dirAccess of invitation.grantedDirectories) {
        try {
          // Find directory
          const directory = await Directory.findOne({
            id: dirAccess.directoryId,
            domain: actualDomain,
            workspaceId: currentWorkspaceId,
          });

          if (!directory) {
            errors.push(`Directory ${dirAccess.directoryId} not found`);
            continue;
          }

          // Check if SharePermission already exists
          const existingShare = await SharePermission.findOne({
            resourceType: "directory",
            resourceId: dirAccess.directoryId,
            scope: "user",
            principalId: userIdString,
          });

          if (existingShare) {
            console.log(`[retroactivelyGrantDirectoryAccess] SharePermission already exists for directory ${dirAccess.directoryId}`);
            granted.push(dirAccess.directoryId);
            continue;
          }

          // Create SharePermission using compound unique index
          const shareId = `shr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          
          try {
            await SharePermission.updateOne(
              {
                domain: actualDomain,
                resourceType: "directory",
                resourceId: dirAccess.directoryId,
                scope: "user",
                principalId: userIdString,
              },
              {
                $setOnInsert: {
                  id: shareId,
                  resourceType: "directory",
                  resourceId: dirAccess.directoryId,
                  domain: actualDomain,
                  scope: "user",
                  principalId: userIdString,
                  role: dirAccess.role,
                  invitedEmail: invitation.inviteeEmail,
                  createdBy: invitation.inviterId.toString(),
                },
              },
              { upsert: true }
            );
            granted.push(dirAccess.directoryId);
            console.log(`[retroactivelyGrantDirectoryAccess] ✓ Created SharePermission for directory ${dirAccess.directoryId}`);
          } catch (upsertError: any) {
            // Handle duplicate key error gracefully
            if (upsertError.code === 11000) {
              const verifyShare = await SharePermission.findOne({
                domain: actualDomain,
                resourceType: "directory",
                resourceId: dirAccess.directoryId,
                scope: "user",
                principalId: userIdString,
              });
              if (verifyShare) {
                console.log(`[retroactivelyGrantDirectoryAccess] SharePermission already exists for ${dirAccess.directoryId}`);
                granted.push(dirAccess.directoryId);
              } else {
                throw upsertError; // Re-throw if it's a different error
              }
            } else {
              throw upsertError;
            }
          }
        } catch (error: any) {
          errors.push(`Failed to grant access to ${dirAccess.directoryId}: ${error.message}`);
        }
      }

      return res.json({
        message: "Directory access granted retroactively",
        granted,
        errors: errors.length > 0 ? errors : undefined,
      });
    } catch (error) {
      console.error("Error retroactively granting directory access:", error);
      return res.status(500).json({ message: "Failed to grant directory access" });
    }
  },
};

// Helper function to send invitation email
async function sendInvitationEmail(invitation: any) {
  const invitationUrl = `${process.env["FRONTEND-URL"]}/invitation/${invitation.invitationId}`;

  const emailData = {
    to: invitation.inviteeEmail,
    subject: `Invitation to join ${invitation.workspaceName}`,
    template: "workspace-invitation",
    data: {
      inviterName: invitation.inviterName,
      workspaceName: invitation.workspaceName,
      workspaceDomain: invitation.workspaceDomain,
      invitedRole: invitation.invitedRole,
      message: invitation.message,
      invitationUrl,
      expiresAt: invitation.expiresAt.toLocaleDateString(),
    },
  };

  await sendEmail(emailData);
}
