import { Request, Response } from "express";
import { SharePermission } from "../models/SharePermission";
import { User } from "../models/User";
import { Directory } from "../models/Directory";
import { Document } from "../models/Document";
import { Workspace } from "../models/Workspace";
import { WorkspaceMembership } from "../models/WorkspaceMembership";
import { publishEvent } from "../lib/events";
import { sendEmail } from "../services/emailService";
import { getPrimaryDomain } from "../config/domainConfig";

interface AuthRequest extends Request {
  user?: any;
  userDomain?: string;
}

function generateId(prefix: string = "shr"): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function generateToken(): string {
  return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
}

export const shareController = {
  async list(req: AuthRequest, res: Response) {
    try {
      const { resourceType, resourceId } = req.query as any;
      if (!resourceType || !resourceId) {
        return res.status(400).json({ error: "resourceType and resourceId are required" });
      }
      const items = await SharePermission.find({
        domain: req.userDomain,
        resourceType,
        resourceId,
      }).sort({ createdAt: -1 });
      res.json(items);
    } catch (err) {
      res.status(500).json({ error: "Failed to list shares" });
    }
  },

  async create(req: AuthRequest, res: Response) {
    try {
      const { resourceType, resourceId, scope, principalId, role, expiresAt, invitedEmail } = req.body || {};
      if (!resourceType || !resourceId || !scope || !role) {
        return res.status(400).json({ error: "Missing required fields" });
      }
      
      // For user scope, allow email-based sharing (cross-domain)
      let finalPrincipalId = principalId;
      let finalInvitedEmail = invitedEmail;
      
      if (scope === "user") {
        // If email is provided but no principalId, try to find user by email (cross-domain)
        if (invitedEmail && !principalId) {
          const userByEmail = await User.findOne({ 
            email: invitedEmail.toLowerCase().trim() 
          }).select("_id email domain");
          
          if (userByEmail) {
            finalPrincipalId = userByEmail._id.toString();
            finalInvitedEmail = userByEmail.email;
          } else {
            // User doesn't exist yet, but we'll store the email for future reference
            // This allows sharing with users who haven't signed up yet
            finalInvitedEmail = invitedEmail.toLowerCase().trim();
          }
        } else if (principalId && !invitedEmail) {
          // If principalId is provided, get the email
          const userById = await User.findById(principalId).select("email");
          if (userById) {
            finalInvitedEmail = userById.email;
          }
        }
        
        // Validate that we have either principalId or invitedEmail
        if (!finalPrincipalId && !finalInvitedEmail) {
          return res.status(400).json({ error: "Either principalId or invitedEmail is required for user scope" });
        }
      } else if (scope === "workspace") {
        if (!principalId) {
          return res.status(400).json({ error: "principalId (workspaceId) is required for workspace scope" });
        }
      }
      
      const payload: any = {
        id: generateId(),
        resourceType,
        resourceId,
        domain: req.userDomain, // Resource domain (where the resource is located)
        scope,
        principalId: finalPrincipalId || null,
        role,
        invitedEmail: finalInvitedEmail || null,
        createdBy: req.user?._id?.toString?.(),
      };
      if (expiresAt) payload.expiresAt = new Date(expiresAt);
      
      const share = new SharePermission(payload);
      await share.save();
      
      // For directory sharing to cross-domain users, create directory in recipient's workspace
      if (resourceType === "directory" && scope === "user" && finalInvitedEmail) {
        try {
          // Find recipient user
          const recipientUser = finalPrincipalId 
            ? await User.findById(finalPrincipalId)
            : await User.findOne({ email: finalInvitedEmail.toLowerCase().trim() });
          
          if (recipientUser) {
            // Get original directory details
            const originalDirectory = await Directory.findOne({ 
              id: resourceId, 
              domain: req.userDomain 
            });
            
            if (originalDirectory) {
              // Get recipient's domain and workspace
              const recipientDomain = recipientUser.domain;
              const recipientDomainId = recipientUser.domainId;
              
              // Get recipient's current workspace or default workspace
              let recipientWorkspaceId = recipientUser.currentWorkspace;
              
              // If no current workspace, find their first workspace
              if (!recipientWorkspaceId) {
                const { WorkspaceMembership } = await import("../models/WorkspaceMembership");
                const firstMembership = await WorkspaceMembership.findOne({
                  userId: recipientUser._id,
                  status: "active"
                }).sort({ joinedAt: 1 });
                
                if (firstMembership) {
                  recipientWorkspaceId = firstMembership.workspaceId;
                } else {
                  // If no workspace membership, find or create default workspace
                  const defaultWorkspace = await Workspace.findOne({
                    domain: recipientDomain,
                    status: "active"
                  }).sort({ createdAt: 1 });
                  
                  if (defaultWorkspace) {
                    recipientWorkspaceId = defaultWorkspace.workspaceId;
                  } else {
                    console.log(`[shareController] No workspace found for recipient ${finalInvitedEmail}, directory share will be available when they create/join a workspace`);
                    // Continue without creating directory - it will be created when they access it
                  }
                }
              }
              
              // Create directory in recipient's workspace if workspace exists
              if (recipientWorkspaceId) {
                // Check if shared directory already exists
                const existingSharedDir = await Directory.findOne({
                  sharedFromDirectoryId: resourceId,
                  sharedWithUserId: recipientUser._id.toString(),
                  workspaceId: recipientWorkspaceId,
                });
                
                if (!existingSharedDir) {
                  // Create new directory in recipient's workspace
                  const sharedDirectoryId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                  const sharedDirectory = new Directory({
                    id: sharedDirectoryId,
                    name: originalDirectory.name,
                    normalizedName: originalDirectory.normalizedName || originalDirectory.name.toLowerCase().trim(),
                    parentId: null, // Top-level in recipient's workspace
                    domain: recipientDomain,
                    domainId: recipientDomainId,
                    workspaceId: recipientWorkspaceId,
                    ownerUserId: recipientUser._id.toString(),
                    documentCount: 0,
                    drhpCount: 0,
                    rhpCount: 0,
                    // Mark as shared directory
                    sharedFromDirectoryId: resourceId,
                    sharedFromDomain: req.userDomain,
                    sharedFromWorkspaceId: originalDirectory.workspaceId,
                    sharedWithUserId: recipientUser._id.toString(),
                    isShared: true,
                  });
                  
                  await sharedDirectory.save();
                  console.log(`✅ Created shared directory ${sharedDirectoryId} in recipient workspace ${recipientWorkspaceId} for user ${finalInvitedEmail}`);
                } else {
                  console.log(`[shareController] Shared directory already exists for ${finalInvitedEmail}`);
                }
              }
            }
          } else {
            console.log(`[shareController] Recipient user not found for ${finalInvitedEmail}, directory will be created when they sign up`);
          }
        } catch (dirError: any) {
          // Don't fail the share creation if directory creation fails
          console.error("Failed to create directory in recipient workspace:", dirError);
        }
      }
      
      // Send email notification if sharing with an email address (cross-domain or new user)
      if (scope === "user" && finalInvitedEmail) {
        try {
          // Get resource name
          let resourceName = resourceId;
          if (resourceType === "directory") {
            const directory = await Directory.findOne({ id: resourceId, domain: req.userDomain });
            resourceName = directory?.name || resourceId;
          } else if (resourceType === "document") {
            const document = await Document.findOne({ _id: resourceId, domain: req.userDomain });
            resourceName = document?.namespace || document?.name || resourceId;
          }

          // Get sharer info
          const sharer = await User.findById(req.user?._id).select("name email domain");
          const sharerName = sharer?.name || sharer?.email || "A user";
          const sharerDomain = sharer?.domain || req.userDomain || "unknown";

          // Get workspace info if available
          const currentWorkspace = (req as any).currentWorkspace;
          let workspaceName = null;
          if (currentWorkspace) {
            const workspace = await Workspace.findOne({ workspaceId: currentWorkspace });
            workspaceName = workspace?.name || null;
          }

          // Get base URL from environment or construct it
          const baseUrl = process.env["FRONTEND-URL"] || process.env["APP-URL"] || "http://localhost:5173";
          const dashboardUrl = `${baseUrl}/dashboard`;
          const signupUrl = `${baseUrl}/login`;

          await sendEmail({
            to: finalInvitedEmail,
            subject: `${sharerName} shared a ${resourceType === "directory" ? "directory" : "document"} with you`,
            template: "directory-share",
            data: {
              sharerName,
              sharerDomain,
              resourceType,
              resourceName,
              resourceId,
              role,
              workspaceName,
              dashboardUrl,
              signupUrl,
            },
          });
          console.log(`✅ Email notification sent to ${finalInvitedEmail} for ${resourceType} share`);
        } catch (emailError: any) {
          // Don't fail the share creation if email fails
          console.error("Failed to send share notification email:", emailError);
        }
      }
      
      await publishEvent({
        actorUserId: req.user?._id?.toString?.(),
        domain: req.userDomain!,
        action: "share.granted",
        resourceType: resourceType,
        resourceId: resourceId,
        title: `Share granted: ${role}`,
      });
      
      res.status(201).json(share);
    } catch (err: any) {
      console.error("Error creating share:", err);
      res.status(500).json({ error: err.message || "Failed to create share" });
    }
  },

  async revoke(req: AuthRequest, res: Response) {
    try {
      const { id } = req.params;
      const toDelete = await SharePermission.findOne({ id, domain: req.userDomain });
      const deleted = await SharePermission.deleteOne({ id, domain: req.userDomain });
      if (deleted.deletedCount === 0) {
        return res.status(404).json({ error: "Share not found" });
      }
      if (toDelete) {
        await publishEvent({
          actorUserId: req.user?._id?.toString?.(),
          domain: req.userDomain!,
          action: "share.revoked",
          resourceType: toDelete.resourceType,
          resourceId: toDelete.resourceId,
          title: `Share revoked`,
        });
      }
      res.json({ message: "Share revoked" });
    } catch (err) {
      res.status(500).json({ error: "Failed to revoke share" });
    }
  },

  async linkCreateOrRotate(req: AuthRequest, res: Response) {
    try {
      const { resourceType, resourceId, role, expiresAt } = req.body || {};
      if (!resourceType || !resourceId || !role) {
        return res.status(400).json({ error: "Missing required fields" });
      }
      // Upsert one link per resource/domain
      const token = generateToken();
      const update: any = {
        id: generateId("lnk"),
        resourceType,
        resourceId,
        domain: req.userDomain,
        scope: "link",
        role,
        linkToken: token,
        createdBy: req.user?._id?.toString?.(),
        expiresAt: expiresAt ? new Date(expiresAt) : null,
      };
      const link = await SharePermission.findOneAndUpdate(
        { domain: req.userDomain, resourceType, resourceId, scope: "link" },
        update,
        { new: true, upsert: true, setDefaultsOnInsert: true }
      );
      await publishEvent({
        actorUserId: req.user?._id?.toString?.(),
        domain: req.userDomain!,
        action: "share.link.rotated",
        resourceType,
        resourceId,
        title: `Share link created/rotated`,
      });
      res.json({ token: link.linkToken });
    } catch (err) {
      res.status(500).json({ error: "Failed to create link" });
    }
  },

  async linkResolve(req: Request, res: Response) {
    try {
      const { token } = req.params as any;
      // Find any domain link (domain-agnostic resolve by token)
      const link = await SharePermission.findOne({ scope: "link", linkToken: token });
      if (!link) {
        return res.status(404).json({ error: "Invalid link" });
      }
      if (link.expiresAt && link.expiresAt.getTime() < Date.now()) {
        return res.status(410).json({ error: "Link expired" });
      }
      res.json({
        resourceType: link.resourceType,
        resourceId: link.resourceId,
        role: link.role,
        domain: link.domain,
      });
    } catch (err) {
      res.status(500).json({ error: "Failed to resolve link" });
    }
  },
};


