import { Request, Response } from "express";
import { Document } from "../models/Document";
import { SharePermission } from "../models/SharePermission";
import { Directory } from "../models/Directory";
import { Domain } from "../models/Domain";
import { User } from "../models/User";
import axios from "axios";
import FormData from "form-data";
import { storageService } from "../services/storageService";
import { publishEvent } from "../lib/events";
import { Summary } from "../models/Summary";
import { Report } from "../models/Report";
import { Chat } from "../models/Chat";
import { Job } from "../models/Job";
import { emitToWorkspace } from "../services/realtimeEmitter";
import { jobAdmissionService } from "../services/jobAdmissionService";
import { metricsService } from "../services/metricsService";
import { brokerQueueTelemetryService } from "../services/brokerQueueTelemetryService";
import { cacheService } from "../services/cacheService";
import { idempotencyLockService } from "../services/idempotencyLockService";
import { applyCanonicalInternalJobStatusUpdate } from "../services/jobLifecycleService";
import {
  buildSignedInternalJsonRequest,
  buildSignedInternalRawRequest,
} from "../services/internalRequestSigning";
import crypto from "crypto";
const MAX_VALIDATION_BUFFER_BYTES = Number(
  process.env.MAX_VALIDATION_BUFFER_BYTES || 10 * 1024 * 1024
);

interface AuthRequest extends Request {
  user?: any;
  userDomain?: string;
  currentWorkspace?: string;
}

export const documentController = {
  // Helper to normalize namespace consistently (trim, preserve .pdf extension)
  // Keep case as-is; rely on Mongo collation for case-insensitive uniqueness
  normalizeNamespace(raw?: string) {
    if (!raw) return "";
    let s = String(raw).trim();
    // Keep .pdf extension - don't remove it
    // Standardize separators to spaces
    s = s.replace(/[\-_]+/g, " ");
    // Collapse multiple spaces
    s = s.replace(/\s+/g, " ");
    // Trim again
    s = s.trim();
    return s;
  },

  // Helper to generate a SAS URL for a file in Azure Blob Storage
  async getPresignedUrl(fileKey: string): Promise<string> {
    return await storageService.getPresignedUrl(fileKey, 60);
  },

  buildDocumentListCacheKey(req: AuthRequest, query: any) {
    const currentWorkspace = req.currentWorkspace || "no-workspace";
    const userKey = req.user?.microsoftId || req.user?._id?.toString() || "anon";
    const queryPart = JSON.stringify(query || {});
    const pagePart = JSON.stringify(req.query || {});
    return `doc:list:${currentWorkspace}:${userKey}:${crypto
      .createHash("sha256")
      .update(`${queryPart}:${pagePart}`)
      .digest("hex")}`;
  },

  async invalidateWorkspaceDocumentCaches(workspaceId?: string) {
    if (!workspaceId) return;
    await cacheService.delByPrefix(`doc:list:${workspaceId}:`);
  },

  // Helper to check if user has access to a directory
  async hasDirectoryAccess(
    req: AuthRequest,
    directoryId: string | null
  ): Promise<boolean> {
    try {
      const user = req.user;
      const userId = user?._id?.toString();

      // Get the workspace domain - for cross-domain users, req.userDomain is set to workspace domain by middleware
      // For same-domain users, req.userDomain equals user.domain
      const workspaceDomain = req.userDomain || req.user?.domain;
      const userDomain = user?.domain;
      const isCrossDomainUser = userDomain && userDomain !== workspaceDomain;
      const isSameDomainAdmin = user?.role === "admin" && userDomain === workspaceDomain;

      // Same-domain admins of the workspace domain have access to all directories
      if (isSameDomainAdmin) {
        return true;
      }

      // Root directory (null directoryId)
      // Cross-domain users should NOT have access to root directory (they need explicit directory access)
      // Same-domain users can access root directory
      if (!directoryId) {
        return !isCrossDomainUser;
      }

      // Check if user owns the directory - use workspace domain for directory lookup
      // Cross-domain users won't own directories in other domains, so skip this check
      let directory = await Directory.findOne({
        id: directoryId,
        domain: workspaceDomain, // Use workspace domain, not user domain
      });

      // If not found in workspace domain, also check if it's a shared directory
      if (!directory) {
        directory = await Directory.findOne({
          id: directoryId,
          workspaceId: req.currentWorkspace,
        });
      }

      if (!directory) {
        // Check if this directoryId is the original directory of a shared directory
        // that the user has access to in their current workspace
        if (req.currentWorkspace) {
          const sharedDir = await Directory.findOne({
            workspaceId: req.currentWorkspace,
            sharedFromDirectoryId: directoryId,
            isShared: true,
          });

          if (sharedDir) {
            // User has access to a shared directory that points to this original directory
            // Check if they have permission to access the original directory (SharePermission is on the original)
            const userEmail = user?.email?.toLowerCase();

            // First check if user is the direct recipient of the shared directory
            if (userId && sharedDir.sharedWithUserId === userId) {
              return true;
            }

            // Get the original directory to check its domain
            const originalDirectory = await Directory.findOne({
              id: directoryId,
            });

            if (originalDirectory) {
              // Check SharePermission for the original directory (not the shared directory)
              // SharePermission is stored on the original directory in the original domain
              const { SharePermission } = await import("../models/SharePermission");

              // Check user-scoped share permission (by userId)
              if (userId) {
                const userShare = await SharePermission.findOne({
                  domain: originalDirectory.domain,
                  resourceType: "directory",
                  resourceId: directoryId, // Original directory ID
                  scope: "user",
                  principalId: userId,
                });
                if (userShare) return true;
              }

              // Check user-scoped share permission (by email) - important for cross-domain sharing
              if (userEmail) {
                const emailShare = await SharePermission.findOne({
                  domain: originalDirectory.domain,
                  resourceType: "directory",
                  resourceId: directoryId, // Original directory ID
                  scope: "user",
                  invitedEmail: userEmail,
                });
                if (emailShare) return true;
              }

              // Check workspace-scoped share permission
              // Try both the current workspace and the original workspace
              const currentWorkspaceKey = req.currentWorkspace;
              if (currentWorkspaceKey) {
                const wsShare = await SharePermission.findOne({
                  domain: originalDirectory.domain,
                  resourceType: "directory",
                  resourceId: directoryId, // Original directory ID
                  scope: "workspace",
                  principalId: currentWorkspaceKey,
                });
                if (wsShare) return true;
              }

              // Also try the original workspace (in case it was shared to the original workspace)
              if (originalDirectory.workspaceId) {
                const originalWsShare = await SharePermission.findOne({
                  domain: originalDirectory.domain,
                  resourceType: "directory",
                  resourceId: directoryId,
                  scope: "workspace",
                  principalId: originalDirectory.workspaceId,
                });
                if (originalWsShare) return true;
              }
            }
          }
        }
        return false;
      }

      // If this is a shared directory, check access to the original directory
      if (directory.isShared && directory.sharedFromDirectoryId) {
        const originalDirectoryId = directory.sharedFromDirectoryId;
        const originalDirectory = await Directory.findOne({
          id: originalDirectoryId,
        });

        if (originalDirectory) {
          // Check SharePermission for the original directory
          const userEmail = user?.email?.toLowerCase();
          if (userId) {
            const userShare = await SharePermission.findOne({
              domain: originalDirectory.domain,
              resourceType: "directory",
              resourceId: originalDirectoryId,
              scope: "user",
              principalId: userId,
            });
            if (userShare) return true;
          }
          if (userEmail) {
            const emailShare = await SharePermission.findOne({
              domain: originalDirectory.domain,
              resourceType: "directory",
              resourceId: originalDirectoryId,
              scope: "user",
              invitedEmail: userEmail,
            });
            if (emailShare) return true;
          }
        }
      }

      // GLOBAL ACCESS WITHIN WORKSPACE:
      // If the directory belongs to the current workspace, everyone in the workspace has access.
      if (directory.workspaceId === req.currentWorkspace) {
        return true;
      }

      // Only check ownership for same-domain users (fallback)
      if (!isCrossDomainUser && directory.ownerUserId === userId) return true;

      // Check user-scoped share permission (this is the key for cross-domain users)
      // SharePermission uses the workspace domain (where the directory exists)
      const userEmail = user?.email?.toLowerCase();
      if (userId) {
        const userShare = await SharePermission.findOne({
          domain: workspaceDomain,
          resourceType: "directory",
          resourceId: directoryId,
          scope: "user",
          principalId: userId,
        });
        if (userShare) return true;
      }
      // Also check by email for cross-domain sharing
      if (userEmail) {
        const emailShare = await SharePermission.findOne({
          domain: workspaceDomain,
          resourceType: "directory",
          resourceId: directoryId,
          scope: "user",
          invitedEmail: userEmail,
        });
        if (emailShare) return true;
      }

      // Check workspace-scoped share permission
      const workspaceKey = req.currentWorkspace || workspaceDomain;
      const wsShare = await SharePermission.findOne({
        domain: workspaceDomain,
        resourceType: "directory",
        resourceId: directoryId,
        scope: "workspace",
        principalId: workspaceKey,
      });

      return !!wsShare;
    } catch (error) {
      console.error("Error in hasDirectoryAccess:", error);
      // Return false on error to be safe (deny access)
      return false;
    }
  },
  async getAll(req: AuthRequest, res: Response) {
    const requestStartedAt = Date.now();
    try {
      const { type, directoryId, includeDeleted } = (req.query || {}) as {
        type?: string;
        directoryId?: string;
        includeDeleted?: string;
      };

      // Handle link access
      const linkAccess = (req as any).linkAccess;
      let effectiveDirectoryId = directoryId;

      // If link is for a directory and no directoryId is provided, use the link's directory
      if (linkAccess && linkAccess.resourceType === "directory" && !directoryId) {
        effectiveDirectoryId = linkAccess.resourceId;
      }
      // If link is for a document, only return that document
      if (linkAccess && linkAccess.resourceType === "document") {
        const document = await Document.findOne({
          id: linkAccess.resourceId,
          domain: linkAccess.domain,
        });
        return res.json(document ? [document] : []);
      }

      // Get current workspace from request
      // Workspace is required - domainAuth middleware ensures req.currentWorkspace is set
      const currentWorkspace = req.currentWorkspace;
      if (!currentWorkspace) {
        return res.status(400).json({
          error: "Workspace is required. Please select a workspace.",
        });
      }

      // For document queries, use the workspace domain (where documents are stored)
      // For cross-domain users, req.userDomain should be set to the workspace domain by middleware
      // But if not, we need to get it from the workspace
      const userHomeDomain = req.user?.domain || req.userDomain;

      // Get workspace to find its domain
      const { Workspace } = await import("../models/Workspace");
      const workspace = await Workspace.findOne({ workspaceId: currentWorkspace });
      const workspaceDomain = workspace?.domain || userHomeDomain; // Domain where workspace exists

      // Check if this is a shared directory first (before building query)
      let originalDirectoryId = effectiveDirectoryId;
      let sharedDirectoryInfo = null;

      if (effectiveDirectoryId && effectiveDirectoryId !== "root") {
        const { Directory } = await import("../models/Directory");
        const directory = await Directory.findOne({
          id: effectiveDirectoryId,
          workspaceId: currentWorkspace,
        });

        // If it's a shared directory, also get documents from the original directory
        if (directory?.isShared && directory.sharedFromDirectoryId) {
          sharedDirectoryInfo = directory;
          originalDirectoryId = directory.sharedFromDirectoryId;
        } else if (linkAccess && linkAccess.resourceType === "directory") {
          // If accessing via link and directory not found in current workspace,
          // check if the link's resourceId matches the requested directoryId
          if (linkAccess.resourceId === effectiveDirectoryId) {
            // Link is for this directory - get the original directory to find its workspace
            const originalDir = await Directory.findOne({
              id: effectiveDirectoryId,
              domain: linkAccess.domain,
            });
            if (originalDir) {
              sharedDirectoryInfo = {
                sharedFromDirectoryId: effectiveDirectoryId,
                sharedFromDomain: linkAccess.domain,
                sharedFromWorkspaceId: originalDir.workspaceId,
              };
              originalDirectoryId = effectiveDirectoryId;
            }
          } else {
            // Check if there's a shared directory pointing to this directory
            const sharedDir = await Directory.findOne({
              workspaceId: currentWorkspace,
              sharedFromDirectoryId: effectiveDirectoryId,
              isShared: true,
            });
            if (sharedDir) {
              sharedDirectoryInfo = sharedDir;
              originalDirectoryId = effectiveDirectoryId;
            }
          }
        }
      } else if (linkAccess && linkAccess.resourceType === "directory" && !effectiveDirectoryId) {
        // If no directoryId provided but link is for a directory, use the link's directory
        effectiveDirectoryId = linkAccess.resourceId;
        const originalDir = await Directory.findOne({
          id: linkAccess.resourceId,
          domain: linkAccess.domain,
        });
        if (originalDir) {
          sharedDirectoryInfo = {
            sharedFromDirectoryId: linkAccess.resourceId,
            sharedFromDomain: linkAccess.domain,
            sharedFromWorkspaceId: originalDir.workspaceId,
          };
          originalDirectoryId = linkAccess.resourceId;
        }
      }

      // Build query - for shared directories, we need to query across domains/workspaces
      const query: any = {};

      if (sharedDirectoryInfo) {
        // For shared directories, query documents from both the shared directory and original directory
        query.$or = [
          {
            domain: workspaceDomain,
            workspaceId: currentWorkspace,
            directoryId: effectiveDirectoryId, // Documents created in recipient's workspace
          },
          {
            domain: sharedDirectoryInfo.sharedFromDomain,
            workspaceId: sharedDirectoryInfo.sharedFromWorkspaceId,
            directoryId: originalDirectoryId, // Original documents
          },
        ];
      } else {
        // Normal query - use workspace domain and workspace
        query.domain = workspaceDomain;
        query.workspaceId = currentWorkspace;
      }

      // If a type filter is provided, use it
      if (type === "DRHP" || type === "RHP") {
        query.type = type;
      }

      // Enforce time-bucket permissions based on user's accessibleWorkspaces
      const user = (req as any).user;
      const wsEntry = Array.isArray(user?.accessibleWorkspaces)
        ? user.accessibleWorkspaces.find(
          (w: any) => w.workspaceDomain === req.userDomain && w.isActive
        )
        : undefined;

      // Default to all if no entry found (backward compatibility)
      let allowedBuckets: string[] = wsEntry?.allowedTimeBuckets || ["all"];

      // Always allow admins full access
      if (user?.role === "admin") {
        allowedBuckets = ["all"];
      }

      // If this is the user's primary domain, allow all
      if (
        (user?.domain || "").toLowerCase() ===
        (req.userDomain || "").toLowerCase()
      ) {
        allowedBuckets = ["all"];
      }

      // Build date range conditions
      if (!allowedBuckets.includes("all")) {
        const now = new Date();

        // Use the most restrictive time bucket (shortest time range)
        // Priority: today > last7 > last15 > last30 > last90
        let selectedBucket = null;

        if (allowedBuckets.includes("today")) {
          selectedBucket = "today";
        } else if (allowedBuckets.includes("last7")) {
          selectedBucket = "last7";
        } else if (allowedBuckets.includes("last15")) {
          selectedBucket = "last15";
        } else if (allowedBuckets.includes("last30")) {
          selectedBucket = "last30";
        } else if (allowedBuckets.includes("last90")) {
          selectedBucket = "last90";
        }

        if (selectedBucket) {
          let start: Date;

          if (selectedBucket === "today") {
            start = new Date();
            start.setUTCHours(0, 0, 0, 0);
            query.uploadedAt = { $gte: start, $lte: now };
          } else if (selectedBucket === "last7") {
            start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            query.uploadedAt = { $gte: start, $lte: now };
          } else if (selectedBucket === "last15") {
            start = new Date(now.getTime() - 15 * 24 * 60 * 60 * 1000);
            query.uploadedAt = { $gte: start, $lte: now };
          } else if (selectedBucket === "last30") {
            start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
            query.uploadedAt = { $gte: start, $lte: now };
          } else if (selectedBucket === "last90") {
            start = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
            query.uploadedAt = { $gte: start, $lte: now };
          }
        }
      }

      // Apply explicit overrides if present
      if (wsEntry?.extraDocumentIds?.length) {
        // If there are extra documents, we need to include them regardless of time filtering
        const extraDocsQuery = { id: { $in: wsEntry.extraDocumentIds } };

        if (query.uploadedAt) {
          // If we have time filtering, we need to combine it with existing $or (if any)
          if (query.$or) {
            // We have a shared directory $or, need to combine with time filter and extra docs
            // Use $and to combine: (shared directory $or) AND (time filter OR extra docs)
            query.$and = [
              { $or: query.$or },
              { $or: [{ uploadedAt: query.uploadedAt }, extraDocsQuery] }
            ];
            delete query.$or;
            delete query.uploadedAt;
          } else {
            // No existing $or, just combine time filter with extra docs
            query.$or = [{ uploadedAt: query.uploadedAt }, extraDocsQuery];
            delete query.uploadedAt;
          }
        } else {
          // No time filtering
          if (query.$or) {
            // We have a shared directory $or, add extra docs to it
            query.$or.push(extraDocsQuery);
          } else {
            // No existing $or, just add extra docs
            query.$or = [extraDocsQuery];
          }
        }
      }

      if (wsEntry?.blockedDocumentIds?.length) {
        query.id = { $nin: wsEntry.blockedDocumentIds };
      }

      // Set directoryId filter (if not already set in $or for shared directories)
      if (effectiveDirectoryId === "root") {
        if (sharedDirectoryInfo) {
          // For root in shared context, this shouldn't happen, but handle it
          query.directoryId = null;
        } else {
          query.directoryId = null;
        }
      } else if (typeof effectiveDirectoryId === "string" && !sharedDirectoryInfo) {
        // Only set directoryId if we didn't already set it in $or above
        query.directoryId = effectiveDirectoryId;
      }

      // no trash filter; return all in directory
      const page = Math.max(parseInt(String((req.query as any)?.page || "1"), 10), 1);
      const pageSizeRaw = parseInt(String((req.query as any)?.pageSize || "0"), 10);
      const pageSize = Number.isFinite(pageSizeRaw)
        ? Math.min(Math.max(pageSizeRaw, 0), 200)
        : 0;

      // Bound default responses for predictable latency under large datasets.
      const effectivePageSize = pageSize > 0 ? pageSize : 50;
      const findQuery = Document.find(query)
        .sort({ uploadedAt: -1 })
        .select(
          "id name uploadedAt directoryId namespace rhpNamespace status type relatedDrhpId relatedRhpId domain domainId workspaceId microsoftId userId fileKey error"
        )
        .lean();
      findQuery.skip((page - 1) * effectivePageSize).limit(effectivePageSize);

      const cacheKey = documentController.buildDocumentListCacheKey(req, query);
      const cached = await cacheService.getJson<any[]>(cacheKey);
      if (cached) {
        return res.json(cached);
      }
      const allDocuments = await findQuery;

      // Filter documents based on directory access permissions
      // Only show documents from directories the user has access to
      // Same-domain admins of the workspace domain see all documents
      // BUT cross-domain users (both admin and regular, invited from other domains) should only see documents in granted directories
      // Link access bypasses directory access checks
      if (linkAccess) {
        return res.json(allDocuments);
      }

      const userDomain = user?.domain;
      const isSameDomainAdmin = user?.role === "admin" && userDomain && userDomain === workspaceDomain;
      const isCrossDomainUser = userDomain && userDomain !== workspaceDomain;

      if (isSameDomainAdmin) {
        return res.json(allDocuments);
      }

      // Filter documents: only include those whose parent directory user has access to.
      // Cache permission checks per directory to avoid N+1 DB calls.
      const uniqueDirectoryKeys = Array.from(
        new Set(
          allDocuments.map((doc: any) =>
            doc.directoryId ? `dir:${doc.directoryId}` : "dir:__root__"
          )
        )
      );
      const directoryAccessCache = new Map<string, boolean>();
      await Promise.all(
        uniqueDirectoryKeys.map(async (key) => {
          const directoryId =
            key === "dir:__root__" ? null : key.replace(/^dir:/, "");

          if (sharedDirectoryInfo && directoryId === originalDirectoryId) {
            directoryAccessCache.set(key, true);
            return;
          }

          if (sharedDirectoryInfo && directoryId === effectiveDirectoryId) {
            const hasAccess = await documentController.hasDirectoryAccess(
              req,
              effectiveDirectoryId as string
            );
            directoryAccessCache.set(key, hasAccess);
            return;
          }

          const hasAccess = await documentController.hasDirectoryAccess(
            req,
            directoryId
          );
          directoryAccessCache.set(key, hasAccess);
        })
      );

      const filteredDocuments = allDocuments.filter((doc: any) => {
        const key = doc.directoryId ? `dir:${doc.directoryId}` : "dir:__root__";
        return directoryAccessCache.get(key) === true;
      });

      const totalMs = Date.now() - requestStartedAt;
      console.log(
        `[perf] documents.getAll completed in ${totalMs}ms (workspace=${currentWorkspace}, docs=${filteredDocuments.length})`
      );
      await cacheService.setJson(cacheKey, filteredDocuments, 30);
      res.json(filteredDocuments);
    } catch (error) {
      const totalMs = Date.now() - requestStartedAt;
      console.log(`[perf] documents.getAll failed after ${totalMs}ms`);
      console.error("Error in getAll documents:", error);
      console.error("Error stack:", (error as Error).stack);
      res.status(500).json({ error: "Failed to fetch documents", details: String(error) });
    }
  },

  async getById(req: AuthRequest, res: Response) {
    try {
      // Workspace is required
      const currentWorkspace = req.currentWorkspace;
      if (!currentWorkspace) {
        return res.status(400).json({ error: "Workspace is required" });
      }

      // Get workspace to find its domain (where documents are stored)
      const { Workspace } = await import("../models/Workspace");
      const workspace = await Workspace.findOne({ workspaceId: currentWorkspace });
      const workspaceDomain = workspace?.domain || req.userDomain;
      const userDomain = req.user?.domain;
      const isCrossDomainUser = userDomain && userDomain !== workspaceDomain;
      const isSameDomainAdmin = req.user?.role === "admin" && userDomain === workspaceDomain;

      // Check for link access first
      const linkAccess = (req as any).linkAccess;
      let document = null;

      if (
        linkAccess &&
        linkAccess.resourceType === "document" &&
        linkAccess.resourceId === req.params.id
      ) {
        // Allow access via link token
        document = await Document.findOne({
          id: req.params.id,
          domain: linkAccess.domain,
        });
      }

      // If not found via link, try current workspace/domain
      if (!document) {
        document = await Document.findOne({
          id: req.params.id,
          domain: workspaceDomain,
          workspaceId: currentWorkspace,
        });
      }

      // If still not found, check if it's in a shared directory's original directory
      if (!document) {
        const { Directory } = await import("../models/Directory");
        // Find all shared directories in current workspace that might contain this document
        const sharedDirectories = await Directory.find({
          workspaceId: currentWorkspace,
          isShared: true,
        });

        // Try to find the document in original directories
        for (const sharedDir of sharedDirectories) {
          if (sharedDir.sharedFromDomain && sharedDir.sharedFromWorkspaceId) {
            // Search in original domain/workspace
            const originalDoc = await Document.findOne({
              id: req.params.id,
              domain: sharedDir.sharedFromDomain,
              workspaceId: sharedDir.sharedFromWorkspaceId,
            });
            if (originalDoc) {
              // If we have a specific shared directory ID, verify the document is in that directory
              // Otherwise, allow any document in the original workspace (access will be checked later)
              if (!sharedDir.sharedFromDirectoryId || originalDoc.directoryId === sharedDir.sharedFromDirectoryId) {
                document = originalDoc;
                break;
              }
            }
          }
        }
      }

      if (!document) {
        return res.status(404).json({ error: "Document not found" });
      }

      // Check access to the document's directory
      // Same-domain admins have access to all documents
      if (!isSameDomainAdmin) {
        // For same-domain users in the same workspace, allow access
        // (they should have access to documents in their workspace)
        const isSameDomainSameWorkspace =
          !isCrossDomainUser &&
          document.workspaceId === currentWorkspace &&
          document.domain === workspaceDomain;

        if (!isSameDomainSameWorkspace) {
          // For cross-domain users or documents from different workspaces, check directory access
          const hasAccess = await documentController.hasDirectoryAccess(req, document.directoryId || null);
          if (!hasAccess) {
            return res.status(403).json({ error: "You do not have access to this document" });
          }
        }
      }

      res.json(document);
    } catch (error) {
      console.error("Error in getById:", error);
      res.status(500).json({ error: "Failed to fetch document" });
    }
  },

  async create(req: AuthRequest, res: Response) {
    try {
      const docData = { ...req.body };
      // Ensure namespace is always set and preserve original name with .pdf extension
      if (!docData.namespace) {
        docData.namespace = docData.name;
      }
      // Keep original namespace as-is to preserve .pdf extension
      // Workspace is required
      const currentWorkspace = req.currentWorkspace;
      if (!currentWorkspace) {
        return res.status(400).json({ error: "Workspace is required" });
      }

      // Always use user's actual domain (not workspace slug)
      // req.userDomain might be workspace slug, but we need the actual user domain
      const actualDomain = req.user?.domain || req.userDomain;

      // Add domain and workspace to document data
      docData.domain = actualDomain; // Use actual user domain, not workspace slug
      docData.workspaceId = currentWorkspace;

      // Ensure global access - remove user-specific fields if present in body
      delete docData.userId;
      delete docData.ownerUserId;
      delete docData.microsoftId;

      // Check duplicate by namespace within workspace
      const existing = await Document.findOne({
        workspaceId: currentWorkspace,
        namespace: docData.namespace,
      }).collation({ locale: "en", strength: 2 });
      if (existing) {
        return res.status(409).json({
          error: "Document with this namespace already exists",
          existingDocument: existing,
        });
      }
      const document = new Document(docData);
      await document.save();
      await publishEvent({
        actorUserId: (req as any).user?._id?.toString?.(),
        domain: (req as any).userDomain,
        action: "document.uploaded",
        resourceType: "document",
        resourceId: document.id,
        title: `Document uploaded: ${document.name}`,
        notifyWorkspace: true,
      });
      await documentController.invalidateWorkspaceDocumentCaches(currentWorkspace);
      res.status(201).json(document);
    } catch (error) {
      console.error("Error creating document:", error);
      res.status(500).json({ error: "Failed to create document" });
    }
  },

  async update(req: AuthRequest, res: Response) {
    try {
      // Workspace is required
      const currentWorkspace = req.currentWorkspace;
      if (!currentWorkspace) {
        return res.status(400).json({ error: "Workspace is required" });
      }

      const query: any = {
        id: req.params.id,
        domain: req.userDomain, // Ensure user can only update documents from their domain
        workspaceId: currentWorkspace, // Ensure user can only update documents from their workspace
      };
      const update: any = { ...req.body };
      if (typeof req.body?.directoryId !== "undefined") {
        update.directoryId =
          req.body.directoryId === "root" ? null : req.body.directoryId;
      }
      const document = await Document.findOneAndUpdate(query, update, {
        new: true,
      });
      if (!document) {
        return res.status(404).json({ error: "Document not found" });
      }

      // Update directory's updatedAt when document is renamed or moved
      if (document.directoryId) {
        const { Directory } = await import("../models/Directory");
        const now = new Date();
        await Directory.updateOne(
          { id: document.directoryId, workspaceId: currentWorkspace },
          {
            $set: {
              updatedAt: now,
            },
          }
        );
      }

      await documentController.invalidateWorkspaceDocumentCaches(currentWorkspace);
      res.json(document);
    } catch (error) {
      res.status(500).json({ error: "Failed to update document" });
    }
  },

  async delete(req: AuthRequest, res: Response) {
    try {
      // Workspace is required
      const currentWorkspace = req.currentWorkspace;
      if (!currentWorkspace) {
        return res.status(400).json({ error: "Workspace is required" });
      }

      const query: any = {
        id: req.params.id,
        workspaceId: currentWorkspace, // Ensure user can only delete documents from their workspace
      };
      const document = await Document.findOne(query);
      if (!document) {
        return res.status(404).json({ error: "Document not found" });
      }

      // HARD DELETE: remove file(s) from Azure Blob Storage and Mongo based on type
      if (document.fileKey) {
        try {
          await storageService.deleteFile(document.fileKey);
        } catch (err) {
          console.error("Failed to delete file from Azure Blob Storage:", err);
        }
      }

      // Build list of document ids to cascade delete against (only the document being deleted)
      const docIdsToDelete: string[] = [document.id];
      // let linkedRhpId: string | null = null;
      // let linkedRhpDoc: any = null;

      // If deleting a DRHP, unlink from RHP (don't delete RHP)
      if (document.type === "DRHP" && document.relatedRhpId) {
        const linkedRhpId = document.relatedRhpId;
        const linkedRhpDoc = await Document.findOne({ id: linkedRhpId, workspaceId: currentWorkspace });
        if (linkedRhpDoc) {
          // Unlink RHP from DRHP
          linkedRhpDoc.relatedDrhpId = undefined as any;
          await linkedRhpDoc.save();
          // Don't delete RHP - just unlink
        }
      }
      // If deleting an RHP, unlink from DRHP (don't delete DRHP)
      if (document.type === "RHP") {
        const drhpDoc = await Document.findOne({ relatedRhpId: document.id, workspaceId: currentWorkspace });
        if (drhpDoc) {
          drhpDoc.relatedRhpId = undefined as any;
          await drhpDoc.save();
          // Only unlink, don't delete DRHP
        }
      }

      // Delete summaries - only for the document being deleted
      await Summary.deleteMany({
        workspaceId: currentWorkspace,
        documentId: document.id
      });

      // Delete chats for the document being deleted
      await Chat.deleteMany({ workspaceId: currentWorkspace, documentId: document.id });

      // Delete reports based on document type
      if (document.type === "DRHP") {
        // When deleting DRHP: delete reports that reference this DRHP
        await Report.deleteMany({
          workspaceId: currentWorkspace,
          $or: [
            { drhpId: document.id },
            { drhpNamespace: document.namespace }
          ]
        });
      } else if (document.type === "RHP") {
        // When deleting RHP: delete reports that reference this RHP
        await Report.deleteMany({
          workspaceId: currentWorkspace,
          $or: [
            { rhpId: document.id },
            { rhpNamespace: document.rhpNamespace || document.namespace }
          ]
        });
      } else {
        // For other document types: delete reports that reference this document
        await Report.deleteMany({
          workspaceId: currentWorkspace,
          $or: [
            { drhpId: document.id },
            { rhpId: document.id },
            { drhpNamespace: document.namespace },
            { rhpNamespace: document.namespace }
          ]
        });
      }

      // Finally, delete the documents themselves
      await Document.deleteMany({ id: { $in: docIdsToDelete }, workspaceId: currentWorkspace });

      // Update directory statistics after deletion
      if (document.directoryId) {
        const { Directory } = await import("../models/Directory");
        const directory = await Directory.findOne({
          id: document.directoryId,
          workspaceId: currentWorkspace,
        });

        if (directory) {
          // Recalculate directory statistics
          const docCount = await Document.countDocuments({
            directoryId: document.directoryId,
            workspaceId: currentWorkspace,
          });
          const drhpCount = await Document.countDocuments({
            directoryId: document.directoryId,
            workspaceId: currentWorkspace,
            type: "DRHP",
          });
          const rhpCount = await Document.countDocuments({
            directoryId: document.directoryId,
            workspaceId: currentWorkspace,
            type: "RHP",
          });
          const lastDoc = await Document.findOne({
            directoryId: document.directoryId,
            workspaceId: currentWorkspace,
          })
            .sort({ uploadedAt: -1 })
            .select("uploadedAt");

          const now = new Date();
          await Directory.updateOne(
            { id: document.directoryId, workspaceId: currentWorkspace },
            {
              $set: {
                documentCount: docCount,
                drhpCount,
                rhpCount,
                updatedAt: now,
                ...(lastDoc?.uploadedAt && { lastDocumentUpload: lastDoc.uploadedAt }),
              },
            }
          );
        }
      }

      // Delete vectors from Pinecone
      try {
        const pythonApiUrl = process.env.PYTHON_API_URL || "http://localhost:8000";
        // Ensure pythonApiUrl doesn't have trailing slash
        const baseUrl = pythonApiUrl.endsWith("/") ? pythonApiUrl.slice(0, -1) : pythonApiUrl;

        console.log(`Deleting vectors for ${document.namespace || document.name} from Python API`);

        const deleteUrl = `${baseUrl}/jobs/document`;
        const signedDelete = buildSignedInternalRawRequest("DELETE", deleteUrl, "");
        await axios.delete(deleteUrl, {
          params: {
            namespace: document.namespace || document.name,
            doc_type: document.type,
            document_id: document.id,
            workspace_id: document.workspaceId,
            domain_id: document.domainId,
          },
          headers: signedDelete.headers,
          timeout: 10000
        });
        console.log("Vectors deleted successfully");
      } catch (err: any) {
        console.error("Failed to delete vectors:", err.message || err);
        // Don't block deletion if vector deletion fails
      }

      // Publish delete event for the primary document
      await publishEvent({
        actorUserId: (req as any).user?._id?.toString?.(),
        domain: (req as any).userDomain,
        action: "document.deleted",
        resourceType: "document",
        resourceId: document.id,
        title: `Document deleted: ${document.name} `,
        notifyWorkspace: true,
      });

      await documentController.invalidateWorkspaceDocumentCaches(currentWorkspace);
      res.json({ message: "Document and related artifacts deleted successfully" });
    } catch (error) {
      console.error("Error deleting document:", error);
      res.status(500).json({ error: "Failed to delete document" });
    }
  },

  async uploadDocument(req: AuthRequest, res: Response) {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }
      const originalname = req.file.originalname;
      // Ensure cross-compatibility with AWS S3 (key) and Azure Blob Storage (url/blobName)
      const rawUrl = (req.file as any).url || (req.file as any).path;
      const fileKey = (req.file as any).key || 
                     (req.file as any).blobName || 
                     (typeof rawUrl === 'string' ? decodeURIComponent(rawUrl.split('?')[0].split('/').pop() || "") : undefined);
      
      if (!fileKey) {
        return res.status(400).json({ error: "Internal storage error: Upload succeeded but could not determine blob key." });
      }
      const user = (req as any).user;
      // Use original filename for namespace to preserve .pdf extension
      // Workspace is required for document upload
      const workspaceId = req.currentWorkspace;
      if (!workspaceId) {
        return res.status(400).json({ error: "Workspace is required. Please select a workspace." });
      }

      // Get user's domainId
      const userWithDomain = await User.findById(user._id).select("domainId");
      if (!userWithDomain?.domainId) {
        return res.status(400).json({ error: "User domainId not found. Please contact administrator." });
      }
      const tenantId = String(userWithDomain.domainId);
      const queueName = "heavy_jobs";
      const userId = user?._id?.toString?.() || "anonymous";
      const admission = await jobAdmissionService.check(tenantId, queueName);
      if (admission.telemetryStatus === "UNAVAILABLE") {
        metricsService.emit("telemetry_unavailable", 1, {
          tenant_id: tenantId,
          queue_name: queueName,
        });
      }
      metricsService.emit("queue_depth", admission.queueDepth, {
        tenant_id: tenantId,
        queue_name: queueName,
      });
      metricsService.emit("queue_age_seconds", admission.queueAgeSeconds, {
        tenant_id: tenantId,
        queue_name: queueName,
      });
      if (!admission.allow) {
        try {
          await storageService.deleteFile(fileKey);
        } catch {}
        return res.status(429).json({
          error: "Queue overloaded, retry later",
          code: admission.reason || "QUEUE_OVERLOADED",
        });
      }
      // Determine document type from request body, default to DRHP
      let documentType = req.body.type || "DRHP"; // Accept type from frontend, default to DRHP

      // NEW: Directory is now required for document upload (directory-first approach)
      const directoryId = req.body.directoryId === "root" ? null : req.body.directoryId;
      if (!directoryId) {
        return res.status(400).json({
          error: "Directory is required. Please select a company directory before uploading."
        });
      }

      // Verify directory exists in the workspace (including shared directories)
      const { Directory } = await import("../models/Directory");
      let directory = await Directory.findOne({
        id: directoryId,
        workspaceId,
      });

      // If not found, check if it's a shared directory
      if (!directory) {
        directory = await Directory.findOne({
          id: directoryId,
          workspaceId,
          isShared: true,
          sharedWithUserId: user._id.toString(),
        });
      }

      if (!directory) {
        return res.status(404).json({
          error: "Directory not found. Please select a valid company directory."
        });
      }

      // If this is a shared directory, use the recipient's workspace (current workspace)
      // Documents created in shared directories go to recipient's workspace
      const finalWorkspaceId = directory.isShared ? workspaceId : directory.workspaceId;

      // For shared directories, use the shared directory ID (not the original)
      const finalDirectoryId = directory.isShared ? directory.id : directoryId;

      const docData: any = {
        id: req.body.id || fileKey, // Use provided id from frontend or fallback to fileKey
        name: originalname,
        fileKey: fileKey,
        namespace: originalname || req.body.namespace, // Use original name directly to preserve .pdf
        type: documentType, // Set type based on request (DRHP or RHP)
        status: "processing", // Set status to processing initially - n8n will update to completed
        domain: user.domain, // Add domain for workspace isolation - backward compatibility
        domainId: userWithDomain.domainId, // Link to Domain schema
        workspaceId, // Workspace required - middleware ensures it's set
        directoryId: directoryId, // Required - no null allowed
      };
      // Pre-check duplicate by namespace within workspace
      const duplicate = await Document.findOne({
        workspaceId: docData.workspaceId,
        namespace: docData.namespace,
      }).collation({ locale: "en", strength: 2 });
      if (duplicate) {
        return res.status(409).json({
          error: "Document with this namespace already exists",
          existingDocument: duplicate,
        });
      }
      if (user?.microsoftId) {
        docData.microsoftId = user.microsoftId;
      } else if (user?._id) {
        docData.userId = user._id.toString();
      }
      const stableUploadIdentity = [
        "document_upload",
        tenantId,
        workspaceId,
        userId,
        String(directoryId || ""),
        String(documentType || "").toUpperCase(),
        documentController.normalizeNamespace(originalname || ""),
      ].join(":");
      const idempotencyKey = crypto.createHash("sha256").update(stableUploadIdentity).digest("hex");
      const idempotencyOwner = crypto.randomUUID();
      const lock = await idempotencyLockService.acquire({
        tenantId,
        idempotencyKey,
        ownerId: idempotencyOwner,
      });
      if (!lock.acquired) {
        try {
          await storageService.deleteFile(fileKey);
        } catch {}
        if (lock.existingJob) {
          const existingDoc = await Document.findOne({ id: lock.existingJob.id }).lean();
          if (existingDoc) {
            return res.status(200).json({
              message: "Upload already in progress",
              document: existingDoc,
              idempotent: true,
            });
          }
        }
        return res.status(202).json({
          message: "Upload request already in progress",
          idempotent: true,
          pending: true,
          retry_after_seconds: lock.retryAfterSeconds,
        });
      }

      // --- VALIDATION START ---
      // Download file to validate content (DRHP vs RHP)
      let isContentValid = false;
      let rejectionReason = "Document validation failed. Unable to verify document content.";

      try {
        const fileSize = await storageService.getFileSize(fileKey);
        if (fileSize > MAX_VALIDATION_BUFFER_BYTES) {
          // Prevent loading large files fully into memory during MIME/content validation.
          console.warn(
            `⚠️ Skipping deep PDF validation for large file (${fileSize} bytes > ${MAX_VALIDATION_BUFFER_BYTES} bytes)`
          );
          isContentValid = true;
          docData.type = documentType;
        } else {
          const buffer = await storageService.downloadFile(fileKey);

          // Parse PDF
          // @ts-ignore
          let pdfParse;
          try {
            pdfParse = require("pdf-parse");
            if (typeof pdfParse !== 'function' && pdfParse.default) pdfParse = pdfParse.default;
          } catch (e) {
            console.error("Failed to require pdf-parse:", e);
          }

          if (typeof pdfParse === 'function') {
            const data = await pdfParse(buffer, { max: 1 });
            const normalizedText = (data.text || "").toLowerCase();

            let detectedType: string | null = null;
            if (normalizedText.includes("draft red herring prospectus")) {
              detectedType = "DRHP";
            } else if (normalizedText.includes("red herring prospectus")) {
              // If strictly red herring and NOT draft
              if (!normalizedText.includes("draft red herring prospectus")) {
                detectedType = "RHP";
              }
            }

            if (!detectedType) {
              // Invalid document
              console.warn(`❌ Invalid document content. Rejecting.`);
              const targetType = req.body.type || "DRHP";
              rejectionReason = `Invalid ${targetType} document.`;
              isContentValid = false;
            } else {
              // Strict validation: Content must match requested type
              if (req.body.type && req.body.type !== detectedType) {
                console.warn(`❌ Type mismatch. Requested: ${req.body.type}, Detected: ${detectedType}`);
                rejectionReason = `Document type mismatch. You are trying to upload a ${detectedType} as ${req.body.type}. Please upload the correct document.`;
                isContentValid = false;
              } else {
                // Apply detected type
                documentType = detectedType;
                docData.type = documentType;
                isContentValid = true;
                console.log(`✅ Document identified as ${documentType}`);
              }
            }
          } else {
            rejectionReason = "Server configuration error: PDF parser not available.";
          }
        }
      } catch (valError: any) {
        console.error("Validation error:", valError);
        // If pdf-parse crashes due to malformed metadata, allow the upload to proceed and trust the user!
        console.warn(`⚠️ PDF parsing threw an error. Falling back to requested type: ${documentType}`);
        isContentValid = true;
        docData.type = documentType;
      }

      if (!isContentValid) {
        // Delete from R2
        try {
          await storageService.deleteFile(fileKey);
        } catch (e) { }

        return res.status(400).json({ error: rejectionReason });
      }
      // --- VALIDATION END ---

      const document = new Document(docData);
      await document.save();
      await Job.create({
        id: document.id,
        tenant_id: tenantId,
        workspace_id: document.workspaceId,
        created_by: userId,
        job_type: "extraction",
        status: admission.status,
        current_stage: "document_upload",
        progress_pct: 0,
        document_name: document.name,
        s3_input_key: fileKey,
        queue_name: queueName,
        queued_with_delay: admission.status === "queued_with_delay",
        idempotency_key: idempotencyKey,
        trace_id: document.id,
      });
      await idempotencyLockService.bindJob({
        tenantId,
        idempotencyKey,
        ownerId: idempotencyOwner,
        jobId: String(document.id),
      });

      // NEW: Update directory statistics (use the actual directory ID that was used)
      if (finalDirectoryId) {
        const now = new Date();
        await Directory.updateOne(
          { id: finalDirectoryId, workspaceId: finalWorkspaceId },
          {
            $inc: {
              documentCount: 1,
              ...(documentType === "DRHP" ? { drhpCount: 1 } : { rhpCount: 1 }),
            },
            $set: {
              lastDocumentUpload: now,
              updatedAt: now,
            },
          }
        );
      }

      // Publish event for upload
      await publishEvent({
        actorUserId: (req as any).user?._id?.toString?.(),
        domain: (req as any).userDomain,
        action: "document.uploaded",
        resourceType: "document",
        resourceId: document.id,
        title: `Document uploaded: ${document.name} `,
        notifyWorkspace: true,
      });

      // --- INTEGRATION: CALL PYTHON API INSTEAD OF N8N ---
      const pythonApiUrl = process.env.PYTHON_API_URL || "http://localhost:8000";

      try {
        const fileUrl = await documentController.getPresignedUrl(fileKey);

        console.log(`Sending document to Python API: ${pythonApiUrl}/jobs/document`); // Fixed URL space

        const dispatchUrl = `${pythonApiUrl}/jobs/document`;
        const dispatchPayload = { // Fixed URL space
          file_url: fileUrl,
          file_type: "pdf",
          metadata: {
            filename: document.name,
            doc_type: documentType.toLowerCase(),
            documentId: document.id,
            domain: document.domain || user.domain,
            domainId: document.domainId || userWithDomain.domainId,
            workspaceId: document.workspaceId || workspaceId,
            directoryId: finalDirectoryId,
            fileKey: fileKey,  // So Python can download directly from R2 if presigned URL expires
            trace_id: document.id,
            queue_name: queueName,
          }
        };
        const signed = buildSignedInternalJsonRequest("POST", dispatchUrl, dispatchPayload, {
          "X-Trace-Id": document.id,
        });
        const pythonResponse = await axios.post(dispatchUrl, signed.data, {
          headers: signed.headers,
          timeout: 300000 // 5 minute timeout to accommodate large PDF processing
        });

        if (pythonResponse.data && (pythonResponse.data.status === "success" || pythonResponse.data.status === "accepted")) {
          console.log(`✅ Document ${document.id} successfully enqueued/sent to Python API`);
          await Job.updateOne(
            { id: document.id, tenant_id: tenantId },
            {
              $set: {
                status: "processing",
                current_stage: "ingestion",
                celery_task_id: pythonResponse.data?.job_id || pythonResponse.data?.celery_task_id || null,
                started_at: new Date(),
              },
            }
          );
          await metricsService.emitQueueMetrics(tenantId, queueName);
          await brokerQueueTelemetryService.emitBrokerQueueMetrics();
          // Note: Python API is now asynchronous and returns "accepted" immediately.
          // If it finished synchronously (rare), we can update status.
          if (pythonResponse.data.status === "success" || pythonResponse.data.details?.success) {
            document.status = "completed";
            await document.save();
          }
        }
      } catch (pythonErr: any) {
        console.error("Failed to call Python Ingestion API:", pythonErr.message);
        await Job.updateOne(
          { id: document.id, tenant_id: tenantId },
          {
            $set: {
              status: "failed",
              error_reason: `Failed to dispatch document ingestion: ${pythonErr.message}`,
              error_message: `Failed to dispatch document ingestion: ${pythonErr.message}`,
              completed_at: new Date(),
            },
          }
        );

        // ROLLBACK: Delete document if ingestion fails
        try {
          await Document.deleteOne({ _id: document._id });
          // Also delete from R2? It was uploaded before creating document...
          if (fileKey) {
            await storageService.deleteFile(fileKey);
          }
          console.log(`Rolled back document ${document.id} due to ingestion failure.`);
        } catch (rollbackErr) {
          console.error("Rollback failed:", rollbackErr);
        }

        return res.status(500).json({
          error: "Document ingestion failed. Please try again.",
          details: pythonErr.message
        });
      }

      await documentController.invalidateWorkspaceDocumentCaches(workspaceId);
      res.status(201).json({ message: "File uploaded successfully", document });
    } catch (error) {
      console.error("Error uploading document:", error);
      res.status(500).json({ error: "Failed to upload document" });
    }
  },

  async downloadDocument(req: AuthRequest, res: Response) {
    try {
      // Workspace is required
      const currentWorkspace = req.currentWorkspace;
      if (!currentWorkspace) {
        return res.status(400).json({ error: "Workspace is required" });
      }

      // Get workspace to find its domain
      const { Workspace } = await import("../models/Workspace");
      const workspace = await Workspace.findOne({ workspaceId: currentWorkspace });
      const workspaceDomain = workspace?.domain || req.userDomain;
      const userDomain = req.user?.domain;
      const isCrossDomainUser = userDomain && userDomain !== workspaceDomain;
      const isSameDomainAdmin = req.user?.role === "admin" && userDomain === workspaceDomain;

      // First, try to find document in current workspace/domain
      let document = await Document.findOne({
        id: req.params.id,
        domain: workspaceDomain,
        workspaceId: currentWorkspace,
      });

      // If not found, check if it's in a shared directory's original directory
      if (!document) {
        const { Directory } = await import("../models/Directory");
        const sharedDirectories = await Directory.find({
          workspaceId: currentWorkspace,
          isShared: true,
        });

        for (const sharedDir of sharedDirectories) {
          if (sharedDir.sharedFromDomain && sharedDir.sharedFromWorkspaceId) {
            const originalDoc = await Document.findOne({
              id: req.params.id,
              domain: sharedDir.sharedFromDomain,
              workspaceId: sharedDir.sharedFromWorkspaceId,
            });
            if (originalDoc) {
              if (!sharedDir.sharedFromDirectoryId || originalDoc.directoryId === sharedDir.sharedFromDirectoryId) {
                document = originalDoc;
                break;
              }
            }
          }
        }
      }

      if (!document || !document.fileKey) {
        return res.status(404).json({ error: "Document not found or no file" });
      }

      // Check access to the document's directory
      // Same-domain admins have access to all documents
      if (!isSameDomainAdmin) {
        // For same-domain users in the same workspace, allow access
        const isSameDomainSameWorkspace =
          !isCrossDomainUser &&
          document.workspaceId === currentWorkspace &&
          document.domain === workspaceDomain;

        if (!isSameDomainSameWorkspace) {
          // For cross-domain users or documents from different workspaces, check directory access
          const hasAccess = await documentController.hasDirectoryAccess(req, document.directoryId || null);
          if (!hasAccess) {
            return res.status(403).json({ error: "You do not have access to this document" });
          }
        }
      }

      const inline = (req.query.inline as string) === "1";
      res.set({
        "Content-Type": "application/pdf",
        "Content-Disposition": `${inline ? "inline" : "attachment"
          }; filename =\"${document.name}\"`,
        "Cache-Control": "private, max-age=60",
      });
      const buffer = await storageService.downloadFile(document.fileKey);
      res.send(buffer);
    } catch (error) {
      console.error("Error in downloadDocument:", error);
      res.status(500).json({ error: "Failed to download document" });
    }
  },

  async checkExistingByNamespace(req: AuthRequest, res: Response) {
    try {
      const { namespace } = req.query;
      if (!namespace) {
        return res
          .status(400)
          .json({ error: "Namespace parameter is required" });
      }

      // Use namespace as-is to preserve .pdf extension
      const queryNamespace = namespace as string;
      // Workspace is required
      const currentWorkspace = req.currentWorkspace;
      if (!currentWorkspace) {
        return res.status(400).json({ error: "Workspace is required" });
      }

      const query: any = {
        namespace: queryNamespace,
        domain: req.userDomain, // Check within user's domain only
        workspaceId: currentWorkspace, // Check within user's workspace only
      };

      const existingDocument = await Document.findOne(query).collation({
        locale: "en",
        strength: 2,
      });

      if (existingDocument) {
        res.json({
          exists: true,
          document: existingDocument,
          message: "Document with this name already exists",
        });
      } else {
        res.json({
          exists: false,
          message: "Document with this name does not exist",
        });
      }
    } catch (error) {
      console.error("Error checking existing document:", error);
      res.status(500).json({ error: "Failed to check existing document" });
    }
  },

  async uploadStatusUpdate(req: AuthRequest, res: Response) {
    console.log("🚀 Received upload-status update hit!");
    try {
      // Canonical correlation: terminal updates require immutable document/job ID.
      const { jobId, documentId, status, error, workspaceId, domainId } = req.body;
      if (jobId && documentId && String(jobId) !== String(documentId)) {
        console.warn("uploadStatusUpdate rejected due to identifier mismatch", {
          jobId,
          documentId,
        });
        return res.status(409).json({ message: "jobId and documentId mismatch" });
      }
      const identifier = String(documentId || jobId || "").trim();

      if (!identifier || !status) {
        return res.status(400).json({
          message: "Missing jobId/documentId or status",
          received: { jobId, documentId, status }
        });
      }
      if (!workspaceId || !domainId) {
        return res.status(400).json({
          message: "Missing required scoped callback metadata",
          required: ["workspaceId", "domainId"],
        });
      }

      const normalizedStatus = status.trim().toLowerCase();
      console.log(`📥 Received status update for ${identifier}: ${normalizedStatus}`);

      // Update document status in MongoDB with strict immutable correlation.
      try {
        const scopeQuery: any = { id: identifier };
        if (workspaceId) scopeQuery.workspaceId = String(workspaceId);
        if (domainId) scopeQuery.domainId = String(domainId);
        const document = await Document.findOne(scopeQuery);

        if (document) {
          if (workspaceId && String(document.workspaceId) !== String(workspaceId)) {
            return res.status(409).json({ message: "Workspace scope mismatch" });
          }
          if (domainId && String(document.domainId) !== String(domainId)) {
            return res.status(409).json({ message: "Tenant/domain scope mismatch" });
          }
          // Map n8n status to our document status
          let newStatus = document.status; // Default to current status

          if (normalizedStatus === "completed" || normalizedStatus === "ready" || normalizedStatus === "complete" || normalizedStatus === "success") {
            newStatus = "completed";
          } else if (normalizedStatus === "failed" || normalizedStatus === "error") {
            newStatus = "failed";
          } else if (normalizedStatus === "processing") {
            newStatus = "processing";
          }

          // Do not mutate document status until canonical lifecycle accepts the callback.
          const oldStatus = document.status;
          const shouldUpdate = oldStatus !== newStatus || (newStatus === "completed" && oldStatus === "processing");
          const jobStatus =
            newStatus === "completed" ? "completed" : newStatus === "failed" ? "failed" : "processing";
          const lifecycle = await applyCanonicalInternalJobStatusUpdate({
            job_id: document.id,
            tenant_id: String(document.domainId),
            status: jobStatus,
            current_stage: "document_callback",
            error_message: jobStatus === "failed" && error
              ? (typeof error === "string" ? error : JSON.stringify(error))
              : undefined,
          });
          if (lifecycle.statusCode !== 200) {
            return res.status(lifecycle.statusCode).json(lifecycle.body);
          }
          if (!lifecycle.changed) {
            return res.status(lifecycle.statusCode).json(lifecycle.body);
          }

          if (shouldUpdate) {
            document.status = newStatus;
            if (error) {
              document.error = error;
            }
            await document.save();
            console.log(`✅ Updated document ${document.id} (${document.name}, type: ${document.type}) status from "${oldStatus}" to "${newStatus}"`);

            // Verify the update was persisted
            const verifyDoc = await Document.findById(document._id);
            if (verifyDoc && verifyDoc.status === newStatus) {
              console.log(`✅ Verified: Document ${document.id} status is now "${verifyDoc.status}" in database`);
            } else {
              console.warn(`⚠️ Warning: Document ${document.id} status verification failed. Expected: "${newStatus}", Got: "${verifyDoc?.status}"`);
            }
          } else {
            console.log(`ℹ️ Document ${document.id} (type: ${document.type}) status unchanged: "${oldStatus}"`);
          }

          const actualJobId = document.id;
          const payload = { jobId: actualJobId, status: newStatus, error };
          try {
            await emitToWorkspace(document.workspaceId, "upload_status", payload);
          } catch (emitError: any) {
            console.error("uploadStatusUpdate emit failure", {
              jobId: actualJobId,
              workspaceId: document.workspaceId,
              tenantId: document.domainId,
              error: emitError?.message || String(emitError),
            });
            return res.status(500).json({
              message: "Status persisted but realtime emit failed",
              code: "DOCUMENT_EMIT_FAILED",
              jobId: actualJobId,
              documentId: document.id,
            });
          }

          await documentController.invalidateWorkspaceDocumentCaches(document.workspaceId);
          res.status(200).json({
            message: "Upload status update processed",
            jobId: actualJobId,
            documentId: document.id,
            documentType: document.type,
            status: normalizedStatus,
            previousStatus: oldStatus,
            newStatus: newStatus,
            error,
          });
        } else {
          console.warn(`⚠️ Document not found for identifier: ${identifier}`);

          res.status(404).json({
            message: "Document not found",
            identifier,
            status: normalizedStatus,
            error: "Document not found in database",
          });
        }
      } catch (dbError: any) {
        console.error("❌ Error updating document status in database:", dbError);
        console.error("   Error details:", {
          message: dbError.message,
          stack: dbError.stack,
          name: dbError.name,
        });

        res.status(500).json({
          message: "Failed to update document status",
          identifier,
          status: normalizedStatus,
          error: dbError.message || "Database error",
        });
      }
    } catch (err: any) {
      console.error("❌ Error in uploadStatusUpdate:", err);
      console.error("   Full error:", JSON.stringify(err, Object.getOwnPropertyNames(err)));
      res.status(500).json({
        message: "Failed to process upload status update",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },

  async uploadRhp(req: AuthRequest, res: Response) {
    try {
      const { drhpId } = req.body;
      if (!req.file) return res.status(400).json({ error: "No file uploaded" });
      if (!drhpId) return res.status(400).json({ error: "Missing DRHP ID" });

      const drhp = await Document.findById(drhpId);
      if (!drhp) return res.status(404).json({ error: "DRHP not found" });

      // Ensure cross-compatibility with AWS S3 (key) and Azure Blob Storage (url/blobName)
      const rawUrl = (req.file as any).url || (req.file as any).path;
      const fileKey = (req.file as any).key || 
                     (req.file as any).blobName || 
                     (typeof rawUrl === 'string' ? decodeURIComponent(rawUrl.split('?')[0].split('/').pop() || "") : undefined);

      if (!fileKey) {
        return res.status(400).json({ error: "Internal storage error: Upload succeeded but could not determine blob key." });
      }
      const user = (req as any).user;

      // Workspace is required for document upload
      const workspaceId = req.currentWorkspace;
      if (!workspaceId) {
        return res.status(400).json({ error: "Workspace is required. Please select a workspace." });
      }

      // Create RHP namespace by appending "-rhp" to the DRHP namespace
      const rhpNamespace = req.file.originalname;

      // Get user's domainId
      const userWithDomain = await User.findById(user._id).select("domainId");
      if (!userWithDomain?.domainId) {
        return res.status(400).json({ error: "User domainId not found. Please contact administrator." });
      }
      const tenantId = String(userWithDomain.domainId);
      const queueName = "heavy_jobs";
      const userId = user?._id?.toString?.() || "anonymous";
      const admission = await jobAdmissionService.check(tenantId, queueName);
      if (admission.telemetryStatus === "UNAVAILABLE") {
        metricsService.emit("telemetry_unavailable", 1, {
          tenant_id: tenantId,
          queue_name: queueName,
        });
      }
      metricsService.emit("queue_depth", admission.queueDepth, {
        tenant_id: tenantId,
        queue_name: queueName,
      });
      metricsService.emit("queue_age_seconds", admission.queueAgeSeconds, {
        tenant_id: tenantId,
        queue_name: queueName,
      });
      if (!admission.allow) {
        try {
          await storageService.deleteFile(fileKey);
        } catch {}
        return res.status(429).json({
          error: "Queue overloaded, retry later",
          code: admission.reason || "QUEUE_OVERLOADED",
        });
      }

      // Fetch full domain config
      const domainConfig = await Domain.findOne({ domainId: userWithDomain.domainId });

      const rhpDocData: any = {
        id: fileKey,
        fileKey: fileKey,
        name: req.file.originalname, // Use original filename with .pdf extension
        namespace: req.file.originalname, // Use original filename with .pdf extension
        rhpNamespace: rhpNamespace,
        type: "RHP",
        status: "processing", // Set status to processing initially - n8n will update to completed
        relatedDrhpId: drhp.id,
        domain: user.domain, // Add domain for workspace isolation - backward compatibility
        domainId: userWithDomain.domainId, // Link to Domain schema
        workspaceId, // Workspace required - middleware ensures it's set
      };

      // Add user information if available
      if (user?.microsoftId) {
        rhpDocData.microsoftId = user.microsoftId;
      } else if (user?._id) {
        rhpDocData.userId = user._id.toString();
      }
      const stableUploadIdentity = [
        "rhp_upload",
        tenantId,
        workspaceId,
        userId,
        String(drhp.id),
        documentController.normalizeNamespace(req.file.originalname || ""),
      ].join(":");
      const idempotencyKey = crypto.createHash("sha256").update(stableUploadIdentity).digest("hex");
      const idempotencyOwner = crypto.randomUUID();
      const lock = await idempotencyLockService.acquire({
        tenantId,
        idempotencyKey,
        ownerId: idempotencyOwner,
      });
      if (!lock.acquired) {
        try {
          await storageService.deleteFile(fileKey);
        } catch {}
        if (lock.existingJob) {
          const existingDoc = await Document.findOne({ id: lock.existingJob.id }).lean();
          if (existingDoc) {
            return res.status(200).json({
              message: "Upload already in progress",
              document: existingDoc,
              idempotent: true,
            });
          }
        }
        return res.status(202).json({
          message: "Upload request already in progress",
          idempotent: true,
          pending: true,
          retry_after_seconds: lock.retryAfterSeconds,
        });
      }

      // --- VALIDATION START FOR RHP ---
      let isContentValid = false;
      let rejectionReason = "Document validation failed. Unable to verify document content.";

      try {
        const fileSize = await storageService.getFileSize(fileKey);
        if (fileSize > MAX_VALIDATION_BUFFER_BYTES) {
          // Prevent large-file buffering for upload-time validation checks.
          console.warn(
            `⚠️ Skipping deep RHP validation for large file (${fileSize} bytes > ${MAX_VALIDATION_BUFFER_BYTES} bytes)`
          );
          isContentValid = true;
        } else {
          const buffer = await storageService.downloadFile(fileKey);

          // Parse PDF
          // @ts-ignore
          let pdfParse;
          try {
            pdfParse = require("pdf-parse");
            if (typeof pdfParse !== 'function' && pdfParse.default) pdfParse = pdfParse.default;
          } catch (e) {
            console.error("Failed to require pdf-parse:", e);
          }

          if (typeof pdfParse === 'function') {
            const data = await pdfParse(buffer, { max: 1 });
            const normalizedText = (data.text || "").toLowerCase();

            // Strict RHP check: Must contain "red herring prospectus" and NOT "draft"
            if (!normalizedText.includes("red herring prospectus") || normalizedText.includes("draft red herring prospectus")) {
              console.warn(`❌ Invalid RHP content. Rejecting.`);
              rejectionReason = "Invalid RHP document.";
              isContentValid = false;
            } else {
              isContentValid = true;
              console.log(`✅ RHP Document content validated.`);
            }
          } else {
            rejectionReason = "Server configuration error: PDF parser not available.";
          }
        }
      } catch (valError: any) {
        console.error("Validation error in uploadRhp:", valError);
        rejectionReason = "Validation error: " + (valError.message || "Unknown error");
      }

      if (!isContentValid) {
        // Delete from R2
        try {
          await storageService.deleteFile(fileKey);
        } catch (e) { }

        return res.status(400).json({ error: rejectionReason });
      }
      // --- VALIDATION END ---

      const rhpDoc = new Document(rhpDocData);
      await rhpDoc.save();
      await Job.create({
        id: rhpDoc.id,
        tenant_id: tenantId,
        workspace_id: rhpDoc.workspaceId,
        created_by: userId,
        job_type: "extraction",
        status: admission.status,
        current_stage: "document_upload",
        progress_pct: 0,
        document_name: rhpDoc.name,
        s3_input_key: fileKey,
        queue_name: queueName,
        queued_with_delay: admission.status === "queued_with_delay",
        idempotency_key: idempotencyKey,
        trace_id: rhpDoc.id,
      });
      await idempotencyLockService.bindJob({
        tenantId,
        idempotencyKey,
        ownerId: idempotencyOwner,
        jobId: String(rhpDoc.id),
      });

      drhp.relatedRhpId = rhpDoc.id;
      await drhp.save();

      // --- INTEGRATION: CALL PYTHON API INSTEAD OF N8N ---
      const pythonApiUrl = process.env.PYTHON_API_URL || "http://localhost:8000";
      let finalStatus = "processing";

      try {
        const fileUrl = await documentController.getPresignedUrl(fileKey);

        console.log(`Sending RHP document to Python API: ${pythonApiUrl}/jobs/document`);

        const rhpDispatchUrl = `${pythonApiUrl}/jobs/document`;
        const rhpDispatchPayload = {
          file_url: fileUrl,
          file_type: "pdf",
          metadata: {
            filename: rhpDoc.name,
            doc_type: "rhp",
            documentId: rhpDoc.id,
            relatedDrhpId: drhp.id,
            domain: rhpDoc.domain || user.domain,
            domainId: rhpDoc.domainId || userWithDomain.domainId,
            workspaceId: rhpDoc.workspaceId || workspaceId,
            // Multi-tenant configuration injection
            target_investors: domainConfig?.target_investors || [],
            investor_match_only: domainConfig?.investor_match_only ?? true,
            valuation_matching: domainConfig?.valuation_matching ?? true,
            adverse_finding: domainConfig?.adverse_finding ?? true
            ,
            trace_id: rhpDoc.id,
            queue_name: queueName
          }
        };
        const signed = buildSignedInternalJsonRequest("POST", rhpDispatchUrl, rhpDispatchPayload, {
          "X-Trace-Id": rhpDoc.id,
        });
        const pythonResponse = await axios.post(rhpDispatchUrl, signed.data, {
          headers: signed.headers,
          timeout: 300000 // 5 minute timeout for PDF ingestion
        });

        if (pythonResponse.data && (pythonResponse.data.status === "success" || pythonResponse.data.status === "accepted")) {
          console.log(`✅ RHP Document ${rhpDoc.id} successfully sent to Python API`);
          await Job.updateOne(
            { id: rhpDoc.id, tenant_id: tenantId },
            {
              $set: {
                status: "processing",
                current_stage: "ingestion",
                celery_task_id: pythonResponse.data?.job_id || pythonResponse.data?.celery_task_id || null,
                started_at: new Date(),
              },
            }
          );
          await metricsService.emitQueueMetrics(tenantId, queueName);
          await brokerQueueTelemetryService.emitBrokerQueueMetrics();
          if (pythonResponse.data.status === "success" && pythonResponse.data.details?.success) {
            rhpDoc.status = "completed";
            await rhpDoc.save();
            finalStatus = "completed";
          }
        }
      } catch (pythonErr: any) {
        console.error("Failed to call Python Ingestion API for RHP:", pythonErr.message);
        await Job.updateOne(
          { id: rhpDoc.id, tenant_id: tenantId },
          {
            $set: {
              status: "failed",
              error_reason: `Failed to dispatch document ingestion: ${pythonErr.message}`,
              error_message: `Failed to dispatch document ingestion: ${pythonErr.message}`,
              completed_at: new Date(),
            },
          }
        );

        // ROLLBACK: Delete RHP document if ingestion fails
        try {
          await Document.deleteOne({ _id: rhpDoc._id });
          // Also delete from R2
          await storageService.deleteFile(fileKey);

          // Also UNLINK from DRHP
          drhp.relatedRhpId = undefined as any;
          await drhp.save();

          console.log(`Rolled back RHP ${rhpDoc.id} due to ingestion failure.`);
        } catch (rollbackErr) {
          console.error("Rollback failed:", rollbackErr);
        }

        return res.status(500).json({
          error: "RHP ingestion failed. Please try again.",
          details: pythonErr.message
        });
      }

      // Emit upload status (use the actual status from n8n or default to processing)
      const jobId = rhpDoc.id;
      const uploadPayload = { jobId, status: finalStatus };
      try {
        await emitToWorkspace(rhpDoc.workspaceId, "upload_status", uploadPayload);
      } catch (emitError) {
        console.error("Failed to emit RHP upload status realtime event", emitError);
        metricsService.emit("realtime_emit_failure", 1, {
          flow: "upload_rhp",
          workspace_id: String(rhpDoc.workspaceId || ""),
          event: "upload_status",
        });
        return res.status(502).json({
          error: "RHP uploaded but realtime notification failed",
          code: "REALTIME_EMIT_FAILED",
        });
      }

      await documentController.invalidateWorkspaceDocumentCaches(workspaceId);
      res
        .status(201)
        .json({ message: "RHP uploaded and linked", document: rhpDoc });
    } catch (error) {
      console.error("Error uploading RHP:", error);
      res.status(500).json({ error: "Failed to upload RHP" });
    }
  },

  // Admin: Get all documents across all workspaces in domain
  async getAllAdmin(req: AuthRequest, res: Response) {
    try {
      const user = req.user;
      console.log("Admin getAllAdmin - User:", user?.role, "Domain:", req.userDomain);

      if (!user || user.role !== "admin") {
        console.log("Admin access denied for user:", user?.role);
        return res.status(403).json({ error: "Admin access required" });
      }

      // Admin query: get all documents for the domain (don't filter by workspaceId)
      const query: any = {
        domain: req.user?.domain || req.userDomain, // Use user's actual domain for admin
      };

      // Also check domainId if available
      const userWithDomain = await User.findById(req.user._id).select("domainId");
      if (userWithDomain?.domainId) {
        query.$or = [
          { domain: req.user?.domain || req.userDomain },
          { domainId: userWithDomain.domainId }
        ];
      }

      console.log("Admin query:", JSON.stringify(query, null, 2));
      const documents = await Document.find(query).sort({ uploadedAt: -1 });
      console.log("Found documents:", documents.length);

      // Get all workspaces to map workspaceId to workspace name
      const { Workspace } = await import("../models/Workspace");
      const workspaces = await Workspace.find({ domain: req.user?.domain || req.userDomain });
      console.log("Found workspaces:", workspaces.length);
      const workspaceMap = new Map(workspaces.map(ws => [ws.workspaceId, { workspaceId: ws.workspaceId, name: ws.name, slug: ws.slug }]));

      // Add workspace information to each document
      const documentsWithWorkspace = documents.map(doc => ({
        ...doc.toObject(),
        workspaceId: workspaceMap.get(doc.workspaceId) || { workspaceId: doc.workspaceId, name: workspaceMap.get(doc.workspaceId)?.name ? workspaceMap.get(doc.workspaceId)?.name : 'Excollo', slug: 'unknown' }
      }));

      console.log("Returning documents with workspace info:", documentsWithWorkspace.length);
      res.json(documentsWithWorkspace);
    } catch (error) {
      console.error("Error fetching admin documents:", error);
      res.status(500).json({ error: "Failed to fetch documents" });
    }
  },

  async getAvailableForCompare(req: AuthRequest, res: Response) {
    try {
      const { id } = req.params;
      const currentWorkspace = req.currentWorkspace || req.userDomain;

      // Get the document to compare with
      const document = await Document.findOne({
        id,
        domain: req.userDomain,
        workspaceId: currentWorkspace,
      });

      if (!document) {
        return res.status(404).json({ error: "Document not found" });
      }

      // Determine the opposite document type
      const oppositeType = document.type === "DRHP" ? "RHP" : "DRHP";

      // Get all documents of the opposite type that are not already linked
      const availableDocuments = await Document.find({
        domain: req.userDomain,
        workspaceId: currentWorkspace,
        type: oppositeType,
        // Exclude documents that are already linked to this document
        $and: [
          { id: { $ne: document.id } },
          { relatedDrhpId: { $ne: document.id } },
          { relatedRhpId: { $ne: document.id } }
        ]
      }).select('id name type uploadedAt namespace').sort({ uploadedAt: -1 });

      res.json({
        selectedDocument: {
          id: document.id,
          name: document.name,
          type: document.type,
          uploadedAt: document.uploadedAt
        },
        availableDocuments
      });
    } catch (error) {
      console.error("Error fetching available documents for compare:", error);
      res.status(500).json({ error: "Failed to fetch available documents" });
    }
  },

  async linkForCompare(req: AuthRequest, res: Response) {
    try {
      const { drhpId, rhpId } = req.body;
      const currentWorkspace = req.currentWorkspace || req.userDomain;

      if (!drhpId || !rhpId) {
        return res.status(400).json({ error: "Both DRHP and RHP IDs are required" });
      }

      // Verify both documents exist and belong to the user
      const drhpDoc = await Document.findOne({
        id: drhpId,
        domain: req.userDomain,
        workspaceId: currentWorkspace,
        type: "DRHP"
      });

      const rhpDoc = await Document.findOne({
        id: rhpId,
        domain: req.userDomain,
        workspaceId: currentWorkspace,
        type: "RHP"
      });

      if (!drhpDoc || !rhpDoc) {
        return res.status(404).json({ error: "One or both documents not found" });
      }

      // Make linking idempotent: if these documents are already linked,
      // return success so the frontend can continue to the compare view.
      if (drhpDoc.relatedRhpId === rhpId || rhpDoc.relatedDrhpId === drhpId) {
        return res.json({
          message: "Documents are already linked for comparison",
          alreadyLinked: true,
          drhpDocument: {
            id: drhpDoc.id,
            name: drhpDoc.name,
            type: drhpDoc.type
          },
          rhpDocument: {
            id: rhpDoc.id,
            name: rhpDoc.name,
            type: rhpDoc.type
          }
        });
      }

      // Link the documents
      drhpDoc.relatedRhpId = rhpId;
      rhpDoc.relatedDrhpId = drhpId;

      await drhpDoc.save();
      await rhpDoc.save();

      // Publish event for the linking (wrapped in try-catch to prevent errors from breaking the flow)
      try {
        await publishEvent({
          actorUserId: req.user?._id?.toString?.(),
          domain: req.userDomain!,
          action: "documents.linked",
          resourceType: "document",
          resourceId: drhpId,
          title: `Documents linked for comparison: ${drhpDoc.name} ↔ ${rhpDoc.name}`,
          notifyWorkspace: true,
        });
      } catch (eventError) {
        // Log but don't fail the request - documents are already linked
        console.error("Error publishing event for document linking:", eventError);
      }

      res.json({
        message: "Documents linked successfully for comparison",
        drhpDocument: {
          id: drhpDoc.id,
          name: drhpDoc.name,
          type: drhpDoc.type
        },
        rhpDocument: {
          id: rhpDoc.id,
          name: rhpDoc.name,
          type: rhpDoc.type
        }
      });
    } catch (error) {
      console.error("Error linking documents for compare:", error);
      res.status(500).json({ error: "Failed to link documents" });
    }
  },

  async unlinkForCompare(req: AuthRequest, res: Response) {
    try {
      const { id } = req.params;
      const currentWorkspace = req.currentWorkspace || req.userDomain;

      const document = await Document.findOne({
        id,
        domain: req.userDomain,
        workspaceId: currentWorkspace,
      });

      if (!document) {
        return res.status(404).json({ error: "Document not found" });
      }

      let linkedDocument = null;

      // Unlink based on document type
      if (document.type === "DRHP" && document.relatedRhpId) {
        linkedDocument = await Document.findOne({
          id: document.relatedRhpId,
          domain: req.userDomain,
          workspaceId: currentWorkspace,
        });

        if (linkedDocument) {
          linkedDocument.relatedDrhpId = undefined;
          await linkedDocument.save();
        }

        document.relatedRhpId = undefined;
        await document.save();
      } else if (document.type === "RHP" && document.relatedDrhpId) {
        linkedDocument = await Document.findOne({
          id: document.relatedDrhpId,
          domain: req.userDomain,
          workspaceId: currentWorkspace,
        });

        if (linkedDocument) {
          linkedDocument.relatedRhpId = undefined;
          await linkedDocument.save();
        }

        document.relatedDrhpId = undefined;
        await document.save();
      }

      // Publish event for the unlinking (wrapped in try-catch to prevent errors from breaking the flow)
      try {
        await publishEvent({
          actorUserId: req.user?._id?.toString?.(),
          domain: req.userDomain!,
          action: "documents.unlinked",
          resourceType: "document",
          resourceId: document.id,
          title: `Documents unlinked: ${document.name}`,
          notifyWorkspace: true,
        });
      } catch (eventError) {
        // Log but don't fail the request - documents are already unlinked
        console.error("Error publishing event for document unlinking:", eventError);
      }

      res.json({
        message: "Documents unlinked successfully",
        unlinkedDocument: {
          id: document.id,
          name: document.name,
          type: document.type
        }
      });
    } catch (error) {
      console.error("Error unlinking documents:", error);
      res.status(500).json({ error: "Failed to unlink documents" });
    }
  },

  async deleteInternal(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const { documentId, workspaceId, domainId } = req.body || {};
      if (!documentId || !workspaceId || !domainId) {
        return res.status(400).json({
          error: "documentId, workspaceId, and domainId are required",
          code: "INVALID_DELETE_SCOPE_BODY",
        });
      }
      if (String(documentId) !== String(id)) {
        return res.status(409).json({
          error: "Path/body document id mismatch",
          code: "DOCUMENT_ID_MISMATCH",
        });
      }

      const document = await Document.findOne({
        id: String(documentId),
        workspaceId: String(workspaceId),
        domainId: String(domainId),
      });
      if (!document) {
        return res.status(404).json({ error: "Document not found" });
      }
      if (String(document.id) !== String(documentId)) {
        return res.status(409).json({
          error: "Document identifier mismatch",
          code: "DOCUMENT_ID_MISMATCH",
        });
      }
      if (String(document.workspaceId) !== String(workspaceId)) {
        return res.status(409).json({
          error: "Workspace scope mismatch",
          code: "WORKSPACE_SCOPE_MISMATCH",
        });
      }
      if (String(document.domainId) !== String(domainId)) {
        return res.status(409).json({
          error: "Tenant/domain scope mismatch",
          code: "TENANT_SCOPE_MISMATCH",
        });
      }

      console.log(`🗑️ Internal request to delete document: ${document.id} (${document.name})`);

      // 1. Delete from R2
      if (document.fileKey) {
        try {
          await storageService.deleteFile(document.fileKey);
        } catch (err) {
          console.error("Failed to delete file from R2 during internal cleanup:", err);
        }
      }

      // 2. Cascade delete associated data
      const scopedFilter = {
        workspaceId: document.workspaceId,
        domainId: document.domainId,
      };
      await Summary.deleteMany({ documentId: document.id, ...scopedFilter });
      await Chat.deleteMany({ documentId: document.id, ...scopedFilter });
      
      // Delete reports that reference this document
      await Report.deleteMany({
        ...scopedFilter,
        $or: [
          { drhpId: document.id },
          { rhpId: document.id },
          { drhpNamespace: document.namespace },
          { rhpNamespace: document.namespace },
        ],
      });

      // 3. Delete the document itself
      await Document.deleteOne({ id: document.id, ...scopedFilter });

      // 4. Emit socket event for frontend removal
      const deletePayload = {
        jobId: document.id,
        status: "deleted",
        error: "Ingestion failed, cleaning up.",
      };
      try {
        await emitToWorkspace(document.workspaceId, "upload_status", deletePayload);
      } catch (emitError) {
        console.error("Failed to emit internal delete realtime event", emitError);
        metricsService.emit("realtime_emit_failure", 1, {
          flow: "document_internal_delete",
          workspace_id: String(document.workspaceId || ""),
          event: "upload_status",
        });
        return res.status(502).json({
          error: "Document deleted but realtime notification failed",
          code: "REALTIME_EMIT_FAILED",
        });
      }

      console.log(`✅ Successfully deleted document ${document.id} via internal request.`);
      await documentController.invalidateWorkspaceDocumentCaches(document.workspaceId);
      res.status(200).json({ message: "Document deleted successfully" });
    } catch (error) {
      console.error("Error in internal deleteInternal:", error);
      res.status(500).json({ error: "Failed to delete document internally" });
    }
  },

};

