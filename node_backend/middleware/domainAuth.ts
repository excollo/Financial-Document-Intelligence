import { Request, Response, NextFunction } from "express";
import { User } from "../models/User";
import { Workspace } from "../models/Workspace";
import { WorkspaceMembership } from "../models/WorkspaceMembership";

interface AuthRequest extends Request {
  user?: any;
  userDomain?: string;
  currentWorkspace?: string;
}

// Resolves the effective workspace for the request using `x-workspace` header
// or the user's saved `currentWorkspace`, and verifies access via WorkspaceMembership.
// No auto-creation - workspaces must be explicitly created.
export const domainAuthMiddleware = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    // Check for link access first
    const linkAccess = (req as any).linkAccess;
    if (linkAccess) {
      // If user is authenticated, check if link domain matches user domain
      if (req.user) {
        const user = await User.findById(req.user._id).select("domain");
        if (user && user.domain !== linkAccess.domain) {
          // Domain mismatch - user cannot access resources from other domains
          return res.status(403).json({ 
            message: "You cannot access documents from other domains. Cross-domain access is not allowed.",
            code: "DOMAIN_MISMATCH",
            userDomain: user.domain,
            linkDomain: linkAccess.domain
          });
        }
      }
      // Set domain from link access (only if domains match or user is not authenticated)
      req.userDomain = linkAccess.domain;
      req.currentWorkspace = linkAccess.domain;
      return next();
    }

    if (!req.user) {
      return res.status(401).json({ message: "Authentication required" });
    }

    // Get user's current workspace from the request header or user's saved currentWorkspace
    // Handle null/undefined properly
    const headerWorkspace = req.headers["x-workspace"] as string;
    const savedWorkspace = req.user?.currentWorkspace;
    const requestedWorkspaceId = headerWorkspace || savedWorkspace || undefined;

    // Get user with domain information and accessibleWorkspaces (for backward compatibility)
    const user = await User.findById(req.user._id).select("domain domainId currentWorkspace accessibleWorkspaces role");

    if (!user) {
      return res.status(400).json({
        message: "User not found. Please contact administrator.",
      });
    }

    // If no workspace is requested and user has no currentWorkspace,
    // we need to check if they have any workspaces at all (via membership or accessibleWorkspaces)
    if (!requestedWorkspaceId) {
      const memberships = await WorkspaceMembership.find({
        userId: user._id,
        status: "active",
      });

      // Also check legacy accessibleWorkspaces for backward compatibility
      const legacyWorkspaces = (user.accessibleWorkspaces || []).filter((ws: any) => ws.isActive !== false);

      if (memberships.length === 0 && legacyWorkspaces.length === 0) {
        // User has no workspace access - this is OK for certain endpoints (like check-first-login)
        // For other endpoints, they'll get a 403 from the specific controller
        req.userDomain = user.domain;
        req.currentWorkspace = undefined;
        return next();
      }

      // Prefer membership-based workspace, fallback to legacy
      let firstWorkspaceId: string | undefined;
      
      if (memberships.length > 0) {
        const firstWorkspace = await Workspace.findOne({
          workspaceId: memberships[0].workspaceId,
          status: "active",
        });
        if (firstWorkspace) {
          firstWorkspaceId = firstWorkspace.workspaceId;
        }
      }
      
      // Fallback to legacy accessibleWorkspaces
      if (!firstWorkspaceId && legacyWorkspaces.length > 0) {
        // Try to find workspace by slug (legacy system used slug as workspaceDomain)
        const legacySlug = legacyWorkspaces[0].workspaceDomain;
        
        // Check if legacySlug is actually a domain (legacy behavior)
        if (legacySlug === user.domain) {
          firstWorkspaceId = user.domain; // Use domain as workspaceId for legacy compatibility
        } else {
          // Try to find workspace by slug
          const legacyWorkspace = await Workspace.findOne({
            domain: user.domain,
            slug: legacySlug,
            status: "active",
          });
          if (legacyWorkspace) {
            firstWorkspaceId = legacyWorkspace.workspaceId;
          } else {
            // If no workspace found in DB, use the slug as workspaceId (for backward compatibility)
            // This handles legacy cases where workspaceDomain was just a slug
            firstWorkspaceId = legacySlug;
          }
        }
      }

      if (firstWorkspaceId) {
        user.currentWorkspace = firstWorkspaceId;
        await user.save();
        req.userDomain = user.domain;
        req.currentWorkspace = firstWorkspaceId;
        return next();
      }
      
      // If still no workspace but user is admin, allow access (they might be creating workspace)
      if (user.role === "admin") {
        req.userDomain = user.domain;
        // Try to find any workspace for the domain
        const domainWorkspace = await Workspace.findOne({
          domain: user.domain,
          status: "active",
        });
        req.currentWorkspace = domainWorkspace?.workspaceId || user.domain; // Use workspaceId if found, domain as fallback
        return next();
      }
      
      // For non-admin users without workspace access, set currentWorkspace to help with debugging
      // But this will cause 400 error in controllers, which is expected
      req.userDomain = user.domain;
      req.currentWorkspace = undefined;
      return next();
    }

    // Verify workspace exists - handle both workspaceId and legacy slug
    let workspace = await Workspace.findOne({
      workspaceId: requestedWorkspaceId,
      status: "active",
    });

    // If not found by workspaceId, try legacy slug lookup
    if (!workspace) {
      workspace = await Workspace.findOne({
        domain: user.domain,
        slug: requestedWorkspaceId,
        status: "active",
      });
    }

    // If still not found, check for legacy support
    if (!workspace) {
      // Legacy behavior: if requestedWorkspaceId matches domain, find the actual workspace
      if (requestedWorkspaceId === user.domain) {
        // Try to find the first active workspace for this user via membership
        const memberships = await WorkspaceMembership.find({
          userId: user._id,
          status: "active",
        });
        
        if (memberships.length > 0) {
          const firstWorkspace = await Workspace.findOne({
            workspaceId: memberships[0].workspaceId,
            domain: user.domain,
            status: "active",
          });
          
          if (firstWorkspace) {
            req.userDomain = user.domain;
            req.currentWorkspace = firstWorkspace.workspaceId;
            // Update user's currentWorkspace
            if (user.currentWorkspace !== firstWorkspace.workspaceId) {
              user.currentWorkspace = firstWorkspace.workspaceId;
              await user.save();
            }
            return next();
          }
        }
        
        // Fallback: use domain as workspace (for backward compatibility)
        req.userDomain = user.domain;
        req.currentWorkspace = user.domain;
        return next();
      }
      
      // Check if user has legacy accessibleWorkspaces entry for this workspace
      const hasLegacyAccess = (user.accessibleWorkspaces || []).some(
        (ws: any) => {
          const wsDomain = (ws.workspaceDomain || "").toLowerCase();
          const requested = (requestedWorkspaceId || "").toLowerCase();
          return wsDomain === requested && ws.isActive !== false;
        }
      );
      
      // If user has legacy access, allow it (for backward compatibility)
      if (hasLegacyAccess) {
        req.userDomain = user.domain;
        req.currentWorkspace = requestedWorkspaceId; // Keep as-is for legacy compatibility
        return next();
      }
      
      // If admin, allow access even without explicit workspace (they might be creating one)
      if (user.role === "admin") {
        req.userDomain = user.domain;
        req.currentWorkspace = requestedWorkspaceId || user.domain;
        return next();
      }
      
      // Only reject if user truly has no access
      return res.status(403).json({
        message: "Workspace not found or you don't have access to it",
      });
    }

    // Check if user has membership in this workspace FIRST (allows cross-domain access)
    const membership = await WorkspaceMembership.findOne({
      userId: user._id,
      workspaceId: workspace.workspaceId,
      status: "active",
    });

    // Also check legacy accessibleWorkspaces for backward compatibility
    const hasLegacyAccess = !membership && (user.accessibleWorkspaces || []).some(
      (ws: any) => {
        const wsDomain = (ws.workspaceDomain || "").toLowerCase();
        const workspaceSlug = workspace.slug.toLowerCase();
        const workspaceIdMatch = wsDomain === workspace.workspaceId.toLowerCase();
        const slugMatch = wsDomain === workspaceSlug;
        return (workspaceIdMatch || slugMatch) && ws.isActive !== false;
      }
    );

    // Check if user is admin of the workspace's domain (for same-domain admins)
    const isWorkspaceDomainAdmin = user.role === "admin" && user.domain === workspace.domain;

    // If user has membership or legacy access, allow them (even if cross-domain)
    // Or if they are admin of the workspace's domain
    if (!membership && !hasLegacyAccess && !isWorkspaceDomainAdmin) {
      // For cross-domain users, only allow if they have explicit membership
      // This prevents unauthorized cross-domain access
      if (workspace.domain !== user.domain) {
        return res.status(403).json({
          message: "Access denied. You do not have access to this workspace.",
        });
      }
      
      // For same-domain users, check if they're domain admin
      const isDomainAdmin = user.role === "admin";
      if (!isDomainAdmin) {
        return res.status(403).json({
          message: "Access denied. You do not have access to this workspace.",
        });
      }
    }

    // Use workspace.workspaceId (not the requested ID which might be a slug)
    const effectiveWorkspaceId = workspace.workspaceId;
    
    // For cross-domain users with membership, we need to allow access to workspace domain data
    // Set userDomain to workspace domain ONLY for workspace-scoped operations
    // This allows cross-domain users to access workspace data
    if (membership && workspace.domain !== user.domain) {
      // Cross-domain user - use workspace domain for data access in workspace context
      req.userDomain = workspace.domain;
    } else {
      // Same domain or no membership - use user's own domain
      req.userDomain = user.domain;
    }

    // Update user's currentWorkspace if different (use workspaceId, not slug)
    if (user.currentWorkspace !== effectiveWorkspaceId) {
      user.currentWorkspace = effectiveWorkspaceId;
      await user.save();
    }

    // Set workspace context for controllers
    // For cross-domain users with membership, keep req.userDomain as workspace domain (set above)
    // For same-domain users, use user's domain
    // This allows cross-domain users to access workspace domain data
    if (!(membership && workspace.domain !== user.domain)) {
      // Only override if we didn't set it to workspace domain above
      req.userDomain = user.domain;
    }
    req.currentWorkspace = effectiveWorkspaceId; // Use actual workspaceId
    next();
  } catch (error) {
    console.error("Domain authentication error:", error);
    res.status(500).json({ message: "Domain authentication failed" });
  }
};

// Middleware to ensure user can only access data from their domain
export const ensureDomainAccess = (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const userDomain = req.userDomain;
    const requestedDomain = req.params.domain || req.query.domain;

    // If no specific domain is requested, allow access to user's own domain
    if (!requestedDomain) {
      return next();
    }

    // Check if user is trying to access data from their own domain
    if (requestedDomain !== userDomain) {
      return res.status(403).json({
        message: "Access denied. You can only access data from your domain.",
      });
    }

    next();
  } catch (error) {
    console.error("Domain access check error:", error);
    res.status(500).json({ message: "Domain access check failed" });
  }
};

// Middleware for admin users to access all domains (optional)
export const adminDomainAccess = (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (req.user.role === "admin") {
      // Admins can access all domains
      return next();
    }

    // For non-admin users, use regular domain access check
    return ensureDomainAccess(req, res, next);
  } catch (error) {
    console.error("Admin domain access check error:", error);
    res.status(500).json({ message: "Admin domain access check failed" });
  }
};
