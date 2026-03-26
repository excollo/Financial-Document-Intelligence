import { Request, Response } from "express";
import { Workspace } from "../models/Workspace";
import { User } from "../models/User";
import { WorkspaceMembership } from "../models/WorkspaceMembership";

interface AuthRequest extends Request {
  user?: any;
  userDomain?: string;
  currentWorkspace?: string;
}

function generateWorkspaceId(): string {
  return `ws_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function toSlug(input: string): string {
  return (input || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

export const workspaceController = {
  // Check if admin user needs to create workspace AND/OR complete onboarding (first-login check)
  async checkFirstLogin(req: AuthRequest, res: Response) {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ message: "Unauthorized" });

      // Only admins can create workspaces
      if (user.role !== "admin") {
        return res.json({ needsWorkspace: false, isAdmin: false, isNewDomain: false, needsOnboarding: false });
      }

      const domain = req.userDomain || user.domain;

      // Check if this is a NEW domain (domain has no workspaces yet)
      const domainWorkspacesCount = await Workspace.countDocuments({
        domain,
        status: "active",
      });

      // Check if user has any workspace memberships (via new system)
      const memberships = await WorkspaceMembership.find({
        userId: user._id,
        status: "active",
      });

      // Check if user has any legacy accessibleWorkspaces
      const hasLegacyWorkspaces = (user.accessibleWorkspaces || []).some(
        (ws: any) => ws.isActive !== false
      );

      const hasWorkspace = memberships.length > 0 || hasLegacyWorkspaces;
      const isNewDomain = domainWorkspacesCount === 0;

      // Show modal only for new domain admin on first login (no workspaces in domain AND user has no workspace access)
      const needsWorkspace = isNewDomain && !hasWorkspace;

      // Check if domain onboarding is still pending (admin should complete onboarding setup)
      let needsOnboarding = false;
      try {
        const { Domain } = await import("../models/Domain");
        const domainRecord = await Domain.findOne({
          $or: [
            { domainId: user.domainId },
            { domainName: domain }
          ]
        });
        if (domainRecord) {
          const onboardingStatus = domainRecord.onboarding_status || "pending";
          // Needs onboarding if status is pending or failed
          needsOnboarding = onboardingStatus === "pending" || onboardingStatus === "failed";
        } else {
          // No domain record found — definitely needs onboarding
          needsOnboarding = true;
        }
      } catch (err) {
        console.error("Error checking onboarding status:", err);
      }

      return res.json({
        needsWorkspace,
        isAdmin: user.role === "admin",
        isNewDomain,
        needsOnboarding,
      });
    } catch (error) {
      console.error("Check first login error:", error);
      return res.status(500).json({ message: "Failed to check first login" });
    }
  },

  // Create a new workspace under current user's domain (admin only)
  async create(req: AuthRequest, res: Response) {
    try {
      const user = req.user;
      const domain = req.userDomain || user?.domain;
      const { name, slug: rawSlug, description } = req.body as {
        name: string;
        slug?: string;
        description?: string;
      };

      if (!user) return res.status(401).json({ message: "Unauthorized" });
      if (user.role !== "admin") {
        return res.status(403).json({ message: "Only domain admins can create workspaces" });
      }
      if (!name || name.trim().length < 2) {
        return res.status(400).json({ message: "Workspace name is required" });
      }
      const baseSlug = toSlug(rawSlug || name);
      if (!baseSlug) {
        return res.status(400).json({ message: "Invalid workspace slug" });
      }

      // Ensure slug uniqueness within the same domain
      const existing = await Workspace.findOne({ domain, slug: baseSlug });
      if (existing) {
        return res.status(400).json({ message: "A workspace with this URL already exists" });
      }

      // Get user's domainId
      const userWithDomain = await User.findById(user._id).select("domainId");
      if (!userWithDomain?.domainId) {
        return res.status(400).json({ message: "User domainId not found. Please contact administrator." });
      }

      const workspaceId = generateWorkspaceId();
      const workspace = new Workspace({
        workspaceId,
        domain,
        domainId: userWithDomain.domainId, // Link to Domain schema
        name: name.trim(),
        slug: baseSlug,
        description: description?.trim() || undefined,
        ownerId: user._id,
        admins: [user._id],
      });

      await workspace.save();

      // Check if this is the first workspace in the domain
      const workspaceCount = await Workspace.countDocuments({
        domainId: userWithDomain.domainId,
        status: "active",
      });

      const isFirstWorkspace = workspaceCount === 1;

      // Create workspace membership for creator (as admin)
      const membership = new WorkspaceMembership({
        userId: user._id,
        workspaceId: workspace.workspaceId,
        role: "admin",
        invitedBy: user._id,
        joinedAt: new Date(),
        status: "active",
      });
      await membership.save();

      // If this is the first workspace, grant access to ALL users in the domain
      if (isFirstWorkspace) {
        const allDomainUsers = await User.find({
          domainId: userWithDomain.domainId,
          status: "active",
        });

        for (const domainUser of allDomainUsers) {
          // Skip creator (already has membership)
          if (domainUser._id.toString() === user._id.toString()) continue;

          // Check if membership already exists
          const existingMembership = await WorkspaceMembership.findOne({
            userId: domainUser._id,
            workspaceId: workspace.workspaceId,
          });

          if (!existingMembership) {
            const userMembership = new WorkspaceMembership({
              userId: domainUser._id,
              workspaceId: workspace.workspaceId,
              role: "editor",
              invitedBy: user._id,
              joinedAt: new Date(),
              status: "active",
            });
            await userMembership.save();
          }
        }

        console.log(`✅ First workspace created - granted access to ${allDomainUsers.length} users in domain`);
      }

      // Update user's currentWorkspace if they don't have one
      const updatedUser = await User.findById(user._id);
      if (updatedUser && !updatedUser.currentWorkspace) {
        updatedUser.currentWorkspace = workspace.workspaceId;
        await updatedUser.save();
      }

      return res.status(201).json({ workspace, isFirstWorkspace });
    } catch (error) {
      console.error("Create workspace error:", error);
      return res.status(500).json({ message: "Failed to create workspace" });
    }
  },

  // List members of a workspace (by workspaceId within current domain)
  async listMembers(req: AuthRequest, res: Response) {
    try {
      const user = req.user;
      const domain = req.userDomain || user?.domain;
      const { workspaceId } = req.params as { workspaceId: string };
      if (!user) return res.status(401).json({ message: "Unauthorized" });
      if (user.role !== "admin") return res.status(403).json({ message: "Only domain admins can view members" });

      let slug: string;
      if (workspaceId === 'default') {
        slug = String(domain);
      } else {
        const workspace = await Workspace.findOne({ workspaceId, domain });
        if (!workspace) return res.status(404).json({ message: "Workspace not found" });
        slug = workspace.slug;
      }
      const members = await User.find({
        domain,
        accessibleWorkspaces: { $elemMatch: { workspaceDomain: slug, isActive: true } },
      }).select("_id name email status role");

      return res.json({ members });
    } catch (error) {
      console.error("List members error:", error);
      return res.status(500).json({ message: "Failed to list members" });
    }
  },

  // Add a member to workspace (by userId or email)
  async addMember(req: AuthRequest, res: Response) {
    try {
      const user = req.user;
      const domain = req.userDomain || user?.domain;
      const { workspaceId } = req.params as { workspaceId: string };
      const { userId, email } = req.body as { userId?: string; email?: string };

      if (!user) return res.status(401).json({ message: "Unauthorized" });
      if (user.role !== "admin") return res.status(403).json({ message: "Only domain admins can add members" });

      let slug: string;
      let workspaceName = '';
      if (workspaceId === 'default') {
        slug = String(domain);
        workspaceName = `${domain} Workspace`;
      } else {
        const workspace = await Workspace.findOne({ workspaceId, domain });
        if (!workspace) return res.status(404).json({ message: "Workspace not found" });
        slug = workspace.slug;
        workspaceName = workspace.name;
      }

      const target = await User.findOne(
        userId ? { _id: userId } : { email: email }
      );
      if (!target) return res.status(404).json({ message: "User not found" });
      if ((target as any).domain !== domain) {
        return res.status(400).json({ message: "User does not belong to this domain" });
      }

      (target as any).accessibleWorkspaces = (target as any).accessibleWorkspaces || [];
      const existingIdx = (target as any).accessibleWorkspaces.findIndex(
        (w: any) => (w.workspaceDomain || '').toLowerCase() === slug.toLowerCase()
      );
      if (existingIdx >= 0) {
        (target as any).accessibleWorkspaces[existingIdx].isActive = true;
        (target as any).accessibleWorkspaces[existingIdx].workspaceName = workspaceName;
      } else {
        (target as any).accessibleWorkspaces.push({
          workspaceDomain: slug,
          workspaceName,
          role: "user",
          allowedTimeBuckets: ["all"],
          extraDocumentIds: [],
          blockedDocumentIds: [],
          invitedBy: user._id,
          joinedAt: new Date(),
          isActive: true,
        });
      }
      await (target as any).save();

      return res.json({ message: "User added to workspace" });
    } catch (error) {
      console.error("Add member error:", error);
      return res.status(500).json({ message: "Failed to add member" });
    }
  },

  // Remove a member from workspace (hard-remove entry)
  async removeMember(req: AuthRequest, res: Response) {
    try {
      const user = req.user;
      const domain = req.userDomain || user?.domain;
      const { workspaceId, memberId } = req.params as { workspaceId: string; memberId: string };
      if (!user) return res.status(401).json({ message: "Unauthorized" });
      if (user.role !== "admin") return res.status(403).json({ message: "Only domain admins can remove members" });

      let slug: string;
      if (workspaceId === 'default') {
        slug = String(domain);
      } else {
        const workspace = await Workspace.findOne({ workspaceId, domain });
        if (!workspace) return res.status(404).json({ message: "Workspace not found" });
        slug = workspace.slug;
      }

      const target = await User.findOne({ _id: memberId, domain });
      if (!target) return res.status(404).json({ message: "User not found" });

      (target as any).accessibleWorkspaces = (target as any).accessibleWorkspaces || [];
      (target as any).accessibleWorkspaces = (target as any).accessibleWorkspaces.filter(
        (w: any) => (w.workspaceDomain || '').toLowerCase() !== slug.toLowerCase()
      );

      // If the user was currently in this workspace, switch them back to their default (primary domain)
      if (String((target as any).currentWorkspace || '').toLowerCase() === String(slug).toLowerCase()) {
        (target as any).currentWorkspace = (target as any).domain;
      }

      // Ensure the primary domain is present in accessibleWorkspaces and active
      const primaryDomain = String((target as any).domain || '').toLowerCase();
      const hasPrimary = (target as any).accessibleWorkspaces.some((w: any) => String(w.workspaceDomain || '').toLowerCase() === primaryDomain);
      if (!hasPrimary && primaryDomain) {
        (target as any).accessibleWorkspaces.push({
          workspaceDomain: (target as any).domain,
          workspaceName: `${(target as any).domain} Workspace`,
          role: 'user',
          allowedTimeBuckets: ['all'],
          extraDocumentIds: [],
          blockedDocumentIds: [],
          invitedBy: user._id,
          joinedAt: new Date(),
          isActive: true,
        });
      }
      await (target as any).save();

      return res.json({ message: "User removed from workspace" });
    } catch (error) {
      console.error("Remove member error:", error);
      return res.status(500).json({ message: "Failed to remove member" });
    }
  },

  // List all workspaces for current domain (admin only)
  async list(req: AuthRequest, res: Response) {
    try {
      const user = req.user;
      const domain = req.userDomain || user?.domain;
      if (!user) return res.status(401).json({ message: "Unauthorized" });
      if (user.role !== "admin") {
        return res.status(403).json({ message: "Only domain admins can view domain workspaces" });
      }
      const workspaces = await Workspace.find({ domain, status: { $ne: "archived" } }).sort({ createdAt: -1 });
      return res.json({ workspaces });
    } catch (error) {
      console.error("List workspaces error:", error);
      return res.status(500).json({ message: "Failed to list workspaces" });
    }
  },

  // Update workspace (name/settings) - admin of domain
  async update(req: AuthRequest, res: Response) {
    try {
      const user = req.user;
      const domain = req.userDomain || user?.domain;
      const { workspaceId } = req.params as { workspaceId: string };
      const updates = req.body || {};

      if (!user) return res.status(401).json({ message: "Unauthorized" });
      if (user.role !== "admin") {
        return res.status(403).json({ message: "Only domain admins can update workspaces" });
      }

      const workspace = await Workspace.findOne({ workspaceId, domain });
      if (!workspace) return res.status(404).json({ message: "Workspace not found" });

      const nameUpdated = typeof updates.name === "string" && updates.name.trim().length >= 2;
      if (nameUpdated) {
        workspace.name = updates.name.trim();
      }
      if (updates.settings && typeof updates.settings === "object") {
        workspace.settings = { ...workspace.settings, ...updates.settings } as any;
      }
      if (typeof updates.status === "string") {
        workspace.status = updates.status;
      }
      await workspace.save();

      // Update workspace name in all users' accessibleWorkspaces
      if (nameUpdated) {
        await User.updateMany(
          {
            domain,
            "accessibleWorkspaces.workspaceDomain": workspace.slug
          },
          {
            $set: {
              "accessibleWorkspaces.$.workspaceName": workspace.name
            }
          }
        );
      }

      return res.json({ workspace });
    } catch (error) {
      console.error("Update workspace error:", error);
      return res.status(500).json({ message: "Failed to update workspace" });
    }
  },

  // Archive a workspace - admin of domain
  async archive(req: AuthRequest, res: Response) {
    try {
      const user = req.user;
      const domain = req.userDomain || user?.domain;
      const { workspaceId } = req.params as { workspaceId: string };
      if (!user) return res.status(401).json({ message: "Unauthorized" });
      if (user.role !== "admin") {
        return res.status(403).json({ message: "Only domain admins can archive workspaces" });
      }
      const workspace = await Workspace.findOneAndUpdate(
        { workspaceId, domain },
        { status: "archived" },
        { new: true }
      );
      if (!workspace) return res.status(404).json({ message: "Workspace not found" });
      return res.json({ message: "Workspace archived", workspace });
    } catch (error) {
      console.error("Archive workspace error:", error);
      return res.status(500).json({ message: "Failed to archive workspace" });
    }
  },

  // Move a document from current workspace to target workspace (admin only)
  async moveDocument(req: AuthRequest, res: Response) {
    try {
      const user = req.user;
      const domain = req.userDomain || user?.domain;
      const { workspaceId } = req.params as { workspaceId: string };
      const { documentId, targetWorkspaceId } = req.body as {
        documentId: string;
        targetWorkspaceId: string;
      };

      if (!user) return res.status(401).json({ message: "Unauthorized" });
      if (user.role !== "admin") {
        return res.status(403).json({ message: "Only admins can move documents" });
      }

      if (!documentId || !targetWorkspaceId) {
        return res.status(400).json({
          message: "documentId and targetWorkspaceId are required",
        });
      }

      // Verify both workspaces exist and belong to same domain
      const sourceWorkspace = await Workspace.findOne({
        workspaceId,
        domain,
      });
      const targetWorkspace = await Workspace.findOne({
        workspaceId: targetWorkspaceId,
        domain,
      });

      if (!sourceWorkspace) {
        return res.status(404).json({ message: "Source workspace not found" });
      }
      if (!targetWorkspace) {
        return res.status(404).json({ message: "Target workspace not found" });
      }

      // Import Document model
      const { Document } = await import("../models/Document");

      // Find document and verify it exists in source workspace
      const document = await Document.findOne({
        id: documentId,
        domain,
        workspaceId,
      });

      if (!document) {
        return res.status(404).json({
          message: "Document not found in source workspace",
        });
      }

      // Check for duplicate in target workspace
      const duplicate = await Document.findOne({
        workspaceId: targetWorkspaceId,
        namespace: document.namespace,
      }).collation({ locale: "en", strength: 2 });

      if (duplicate && duplicate.id !== document.id) {
        return res.status(409).json({
          message: "Document with this name already exists in target workspace",
        });
      }

      // Move document
      document.workspaceId = targetWorkspaceId;

      // If document has directoryId, check if directory needs to move too
      // For simplicity, we'll move the document and its directory to target workspace
      if (document.directoryId) {
        const { Directory } = await import("../models/Directory");
        const directory = await Directory.findOne({
          id: document.directoryId,
          domain,
          workspaceId,
        });

        if (directory) {
          directory.workspaceId = targetWorkspaceId;
          await directory.save();
        }
      }

      await document.save();

      return res.json({
        message: "Document moved successfully",
        document,
        targetWorkspace: {
          workspaceId: targetWorkspace.workspaceId,
          name: targetWorkspace.name,
        },
      });
    } catch (error) {
      console.error("Move document error:", error);
      return res.status(500).json({ message: "Failed to move document" });
    }
  },

  // Get user's workspaces via membership
  // Migrate legacy accessibleWorkspaces to WorkspaceMembership (one-time migration)
  async migrateLegacyWorkspaces(req: AuthRequest, res: Response) {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ message: "Unauthorized" });

      // Only admins can run migration
      if (user.role !== "admin") {
        return res.status(403).json({ message: "Only admins can run migration" });
      }

      const { User } = await import("../models/User");
      const { WorkspaceMembership } = await import("../models/WorkspaceMembership");
      const { Workspace } = await import("../models/Workspace");

      // Find all users with legacy accessibleWorkspaces
      const usersWithLegacy = await User.find({
        accessibleWorkspaces: { $exists: true, $ne: [] },
      });

      let migrated = 0;
      let skipped = 0;
      const errors: string[] = [];

      for (const legacyUser of usersWithLegacy) {
        const legacyWorkspaces = (legacyUser.accessibleWorkspaces || []).filter(
          (ws: any) => ws.isActive !== false
        );

        for (const legacyWs of legacyWorkspaces) {
          try {
            // Check if membership already exists
            const existingMembership = await WorkspaceMembership.findOne({
              userId: legacyUser._id,
              workspaceId: legacyWs.workspaceDomain,
            });

            if (existingMembership) {
              skipped++;
              continue;
            }

            // Try to find workspace by slug (legacy system used slug as workspaceDomain)
            let workspace = await Workspace.findOne({
              domain: legacyUser.domain,
              slug: legacyWs.workspaceDomain,
              status: "active",
            });

            // If not found by slug, check if workspaceDomain is actually a workspaceId
            if (!workspace) {
              workspace = await Workspace.findOne({
                workspaceId: legacyWs.workspaceDomain,
                status: "active",
              });
            }

            // If workspace doesn't exist in DB, we can still create membership with the slug as workspaceId
            // This maintains backward compatibility
            const workspaceId = workspace?.workspaceId || legacyWs.workspaceDomain;

            // Map legacy role to membership role
            let membershipRole: "admin" | "editor" | "viewer" = "editor";
            if (legacyWs.role === "viewer") {
              membershipRole = "viewer";
            } else if (legacyWs.role === "editor") {
              membershipRole = "editor";
            }

            // Create membership
            const membership = new WorkspaceMembership({
              userId: legacyUser._id,
              workspaceId,
              role: membershipRole,
              invitedBy: legacyWs.invitedBy || legacyUser._id,
              joinedAt: legacyWs.joinedAt || new Date(),
              status: "active",
            });

            await membership.save();
            migrated++;

            // Update user's currentWorkspace if needed (use workspaceId if workspace exists)
            if (!legacyUser.currentWorkspace || legacyUser.currentWorkspace === legacyWs.workspaceDomain) {
              legacyUser.currentWorkspace = workspaceId;
              await legacyUser.save();
            }
          } catch (error: any) {
            errors.push(
              `User ${legacyUser.email}, workspace ${legacyWs.workspaceDomain}: ${error.message}`
            );
          }
        }
      }

      return res.json({
        message: "Migration completed",
        stats: {
          usersProcessed: usersWithLegacy.length,
          membershipsCreated: migrated,
          membershipsSkipped: skipped,
          errors: errors.length,
        },
        errors: errors.slice(0, 10), // Return first 10 errors
      });
    } catch (error) {
      console.error("Migration error:", error);
      return res.status(500).json({ message: "Migration failed", error: String(error) });
    }
  },

  async getMyWorkspaces(req: AuthRequest, res: Response) {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ message: "Unauthorized" });

      const memberships = await WorkspaceMembership.find({
        userId: user._id,
        status: "active",
      }).populate("userId", "name email");

      const workspaceIds = memberships.map((m) => m.workspaceId);
      const workspaces = await Workspace.find({
        workspaceId: { $in: workspaceIds },
        status: "active",
      });

      const workspacesWithRole = workspaces.map((ws) => {
        const membership = memberships.find(
          (m) => m.workspaceId === ws.workspaceId
        );
        return {
          workspaceId: ws.workspaceId,
          name: ws.name,
          slug: ws.slug,
          description: ws.description,
          domain: ws.domain,
          role: membership?.role || "editor",
          joinedAt: membership?.joinedAt,
        };
      });

      return res.json({ workspaces: workspacesWithRole });
    } catch (error) {
      console.error("Get my workspaces error:", error);
      return res.status(500).json({ message: "Failed to get workspaces" });
    }
  },
};


