import { Request, Response } from "express";
import { WorkspaceRequest } from "../models/WorkspaceRequest";
import { WorkspaceMembership } from "../models/WorkspaceMembership";
import { Workspace } from "../models/Workspace";
import { User } from "../models/User";

interface AuthRequest extends Request {
  user?: any;
  userDomain?: string;
  currentWorkspace?: string;
}

export const workspaceRequestController = {
  // User requests access to a workspace
  async requestAccess(req: AuthRequest, res: Response) {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ message: "Unauthorized" });

      const { workspaceId } = req.body as { workspaceId: string };
      if (!workspaceId) {
        return res.status(400).json({ message: "workspaceId is required" });
      }

      // Get user's domainId
      const userWithDomain = await User.findById(user._id).select("domainId");
      if (!userWithDomain?.domainId) {
        return res.status(400).json({ message: "User domainId not found" });
      }

      // Check if workspace exists and belongs to user's domain
      const workspace = await Workspace.findOne({
        workspaceId,
        domainId: userWithDomain.domainId,
        status: "active",
      });

      if (!workspace) {
        return res.status(404).json({ message: "Workspace not found" });
      }

      // Check if user already has access
      const existingMembership = await WorkspaceMembership.findOne({
        userId: user._id,
        workspaceId,
        status: "active",
      });

      if (existingMembership) {
        return res.status(400).json({ message: "You already have access to this workspace" });
      }

      // Check if request already exists
      const existingRequest = await WorkspaceRequest.findOne({
        userId: user._id,
        workspaceId,
        status: "pending",
      });

      if (existingRequest) {
        return res.status(400).json({ message: "You already have a pending request for this workspace" });
      }

      // Create request
      const request = new WorkspaceRequest({
        userId: user._id,
        workspaceId,
        domainId: userWithDomain.domainId,
        status: "pending",
        message: req.body.message,
      });

      await request.save();

      return res.status(201).json({
        message: "Workspace access request sent",
        request: {
          id: request._id,
          workspaceId: request.workspaceId,
          status: request.status,
          requestedAt: request.requestedAt,
        },
      });
    } catch (error) {
      console.error("Request workspace access error:", error);
      return res.status(500).json({ message: "Failed to request workspace access" });
    }
  },

  // Get pending requests for a workspace (admin only)
  async getPendingRequests(req: AuthRequest, res: Response) {
    try {
      const user = req.user;
      const workspaceId = req.params.workspaceId;

      if (!user) return res.status(401).json({ message: "Unauthorized" });
      if (user.role !== "admin") {
        return res.status(403).json({ message: "Only admins can view requests" });
      }

      // Get user's domainId
      const userWithDomain = await User.findById(user._id).select("domainId");
      if (!userWithDomain?.domainId) {
        return res.status(400).json({ message: "User domainId not found" });
      }

      // Get workspace to verify it belongs to admin's domain
      const workspace = await Workspace.findOne({
        workspaceId,
        domainId: userWithDomain.domainId,
      });

      if (!workspace) {
        return res.status(404).json({ message: "Workspace not found" });
      }

      // Get all pending requests for this workspace
      const requests = await WorkspaceRequest.find({
        workspaceId,
        domainId: userWithDomain.domainId,
        status: "pending",
      })
        .populate("userId", "email name")
        .sort({ requestedAt: -1 });

      return res.json({ requests });
    } catch (error) {
      console.error("Get pending requests error:", error);
      return res.status(500).json({ message: "Failed to get pending requests" });
    }
  },

  // Admin approves or rejects a workspace request
  async reviewRequest(req: AuthRequest, res: Response) {
    try {
      const user = req.user;
      const { requestId } = req.params;
      const { action, rejectionReason } = req.body as {
        action: "approve" | "reject";
        rejectionReason?: string;
      };

      if (!user) return res.status(401).json({ message: "Unauthorized" });
      if (user.role !== "admin") {
        return res.status(403).json({ message: "Only admins can review requests" });
      }

      if (!action || !["approve", "reject"].includes(action)) {
        return res.status(400).json({ message: "Action must be 'approve' or 'reject'" });
      }

      // Get request
      const request = await WorkspaceRequest.findById(requestId);
      if (!request) {
        return res.status(404).json({ message: "Request not found" });
      }

      // Get user's domainId to verify workspace belongs to domain
      const userWithDomain = await User.findById(user._id).select("domainId");
      if (!userWithDomain?.domainId || request.domainId !== userWithDomain.domainId) {
        return res.status(403).json({ message: "Access denied" });
      }

      // Get workspace to verify it exists
      const workspace = await Workspace.findOne({
        workspaceId: request.workspaceId,
        domainId: userWithDomain.domainId,
      });

      if (!workspace) {
        return res.status(404).json({ message: "Workspace not found" });
      }

      if (action === "approve") {
        // Check if membership already exists
        const existingMembership = await WorkspaceMembership.findOne({
          userId: request.userId,
          workspaceId: request.workspaceId,
        });

        if (!existingMembership) {
          // Create workspace membership
          const membership = new WorkspaceMembership({
            userId: request.userId,
            workspaceId: request.workspaceId,
            role: "editor",
            invitedBy: user._id,
            joinedAt: new Date(),
            status: "active",
          });
          await membership.save();
        }

        // Update request status
        request.status = "approved";
        request.reviewedBy = user._id;
        request.reviewedAt = new Date();
        await request.save();

        return res.json({
          message: "Workspace access approved",
          request,
        });
      } else {
        // Reject request
        request.status = "rejected";
        request.reviewedBy = user._id;
        request.reviewedAt = new Date();
        if (rejectionReason) {
          request.rejectionReason = rejectionReason;
        }
        await request.save();

        return res.json({
          message: "Workspace access rejected",
          request,
        });
      }
    } catch (error) {
      console.error("Review request error:", error);
      return res.status(500).json({ message: "Failed to review request" });
    }
  },

  // Get user's own requests
  async getMyRequests(req: AuthRequest, res: Response) {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ message: "Unauthorized" });

      const requests = await WorkspaceRequest.find({
        userId: user._id,
      })
        .populate("reviewedBy", "email name")
        .sort({ requestedAt: -1 });

      // Get workspace info for each request
      const requestsWithWorkspace = await Promise.all(
        requests.map(async (req) => {
          const workspace = await Workspace.findOne({ workspaceId: req.workspaceId });
          return {
            ...req.toObject(),
            workspace: workspace ? { workspaceId: workspace.workspaceId, name: workspace.name } : null,
          };
        })
      );

      return res.json({ requests: requestsWithWorkspace });
    } catch (error) {
      console.error("Get my requests error:", error);
      return res.status(500).json({ message: "Failed to get requests" });
    }
  },

  // Get available workspaces user can request access to
  async getAvailableWorkspaces(req: AuthRequest, res: Response) {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ message: "Unauthorized" });

      // Get user's domainId
      const userWithDomain = await User.findById(user._id).select("domainId");
      if (!userWithDomain?.domainId) {
        return res.status(400).json({ message: "User domainId not found" });
      }

      // Get all workspaces in user's domain
      const allWorkspaces = await Workspace.find({
        domainId: userWithDomain.domainId,
        status: "active",
      });

      // Get user's memberships
      const memberships = await WorkspaceMembership.find({
        userId: user._id,
        status: "active",
      });

      const userWorkspaceIds = new Set(memberships.map((m) => m.workspaceId));

      // Get pending requests
      const pendingRequests = await WorkspaceRequest.find({
        userId: user._id,
        status: "pending",
      });

      const pendingWorkspaceIds = new Set(pendingRequests.map((r) => r.workspaceId));

      // Filter workspaces user doesn't have access to
      const availableWorkspaces = allWorkspaces
        .filter((ws) => !userWorkspaceIds.has(ws.workspaceId))
        .map((ws) => ({
          workspaceId: ws.workspaceId,
          name: ws.name,
          slug: ws.slug,
          description: ws.description,
          hasPendingRequest: pendingWorkspaceIds.has(ws.workspaceId),
        }));

      return res.json({ workspaces: availableWorkspaces });
    } catch (error) {
      console.error("Get available workspaces error:", error);
      return res.status(500).json({ message: "Failed to get available workspaces" });
    }
  },
};



