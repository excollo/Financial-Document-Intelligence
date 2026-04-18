import { Request, Response } from "express";
import mongoose from "mongoose";
import { Directory } from "../models/Directory";
import { User } from "../models/User";
import { Document } from "../models/Document";
import { SharePermission } from "../models/SharePermission";
import { Workspace } from "../models/Workspace";
import { WorkspaceInvitation } from "../models/WorkspaceInvitation";
import { publishEvent } from "../lib/events";

interface AuthRequest extends Request {
  user?: any;
  userDomain?: string;
  currentWorkspace?: string;
}

export const directoryController = {
  async move(req: AuthRequest, res: Response) {
    try {
      const { newParentId } = req.body || {};
      // Get current workspace from request
      // Workspace is required
      const currentWorkspace = req.currentWorkspace;
      if (!currentWorkspace) {
        return res.status(400).json({ error: "Workspace is required" });
      }

      const dir = await Directory.findOne({
        id: req.params.id,
        workspaceId: currentWorkspace,
      });
      if (!dir) {
        return res.status(404).json({ error: "Directory not found" });
      }
      if (newParentId === dir.id) {
        return res.status(400).json({ error: "Cannot move into itself" });
      }
      // Validate new parent if provided
      if (newParentId) {
        const parent = await Directory.findOne({
          id: newParentId,
          domain: req.userDomain,
          workspaceId: currentWorkspace,
        });
        if (!parent) {
          return res.status(400).json({ error: "Invalid destination folder" });
        }
      }
      dir.parentId = newParentId || null;
      await dir.save();
      res.json(dir);
    } catch (err: any) {
      if (err?.code === 11000) {
        return res
          .status(409)
          .json({ error: "A folder with this name already exists here" });
      }
      res.status(500).json({ error: "Failed to move directory" });
    }
  },
  async create(req: AuthRequest, res: Response) {
    try {
      const { name, parentId } = req.body || {};
      if (!name || String(name).trim() === "") {
        return res.status(400).json({ error: "Name is required" });
      }
      // Get current workspace from request
      // Workspace is required
      const currentWorkspace = req.currentWorkspace;
      if (!currentWorkspace) {
        return res.status(400).json({ error: "Workspace is required" });
      }

      // Always use user's actual domain (not workspace slug)
      // req.userDomain might be workspace slug, but we need the actual user domain
      const actualDomain = req.user?.domain || req.userDomain;

      // Get user's domainId
      const userWithDomain = await User.findById(req.user?._id).select("domainId");
      if (!userWithDomain?.domainId) {
        return res.status(400).json({ error: "User domainId not found. Please contact administrator." });
      }

      const trimmedName = String(name).trim();

      // Normalize the company name for duplicate detection
      const { normalizeCompanyName, findSimilarDirectories } = await import("../lib/companyNameNormalizer");
      const normalizedName = normalizeCompanyName(trimmedName);

      // Check for exact match (normalized name)
      const existingExact = await Directory.findOne({
        workspaceId: currentWorkspace,
        normalizedName: normalizedName,
        parentId: parentId === "root" || !parentId ? null : parentId,
      });

      if (existingExact) {
        return res.status(409).json({
          error: "A directory with this name already exists",
          existingDirectory: {
            id: existingExact.id,
            name: existingExact.name,
            similarity: 100
          }
        });
      }

      // Check for similar directories (fuzzy match) - only for top-level directories (company directories)
      if (!parentId || parentId === "root") {
        const similarDirs = await findSimilarDirectories(trimmedName, currentWorkspace, 85);
        if (similarDirs.length > 0) {
          return res.status(409).json({
            error: "Similar directories found. Please use an existing directory or confirm creation.",
            similarDirectories: similarDirs,
            suggestedAction: "review"
          });
        }
      }

      const payload: any = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: trimmedName,
        normalizedName: normalizedName, // Store normalized name
        parentId: parentId === "root" || !parentId ? null : parentId,
        domain: actualDomain, // Use actual user domain, not workspace slug - backward compatibility
        domainId: userWithDomain.domainId, // Link to Domain schema
        workspaceId: currentWorkspace,
        // ownerUserId: req.user?._id?.toString?.(), // Removed for global workspace access
        documentCount: 0,
        drhpCount: 0,
        rhpCount: 0,
      };
      const dir = new Directory(payload);
      await dir.save();
      await publishEvent({
        actorUserId: req.user?._id?.toString?.(),
        domain: req.userDomain!,
        action: "directory.created",
        resourceType: "directory",
        resourceId: dir.id,
        title: `Folder created: ${dir.name}`,
        notifyWorkspace: true,
      });
      res.status(201).json(dir);
    } catch (err: any) {
      if (err?.code === 11000) {
        return res
          .status(409)
          .json({ error: "A folder with this name already exists here" });
      }
      console.error("Error creating directory:", err);
      res.status(500).json({ error: "Failed to create directory" });
    }
  },

  async getById(req: AuthRequest, res: Response) {
    try {
      // Get current workspace from request
      // Workspace is required
      const currentWorkspace = req.currentWorkspace;
      if (!currentWorkspace) {
        return res.status(400).json({ error: "Workspace is required" });
      }

      const dir = await Directory.findOne({
        id: req.params.id,
        workspaceId: currentWorkspace,
      });
      if (!dir) {
        return res.status(404).json({ error: "Directory not found" });
      }
      res.json(dir);
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch directory" });
    }
  },

  async listChildren(req: AuthRequest, res: Response) {
    const requestStartedAt = Date.now();
    try {
      const parentId = req.params.id === "root" ? null : req.params.id;
      const { includeDeleted, page, pageSize, sort, order } = (req.query ||
        {}) as {
          includeDeleted?: string;
          page?: string;
          pageSize?: string;
          sort?: string;
          order?: string;
        };
      // Get current workspace from request
      // Workspace is required
      const currentWorkspace = req.currentWorkspace;
      if (!currentWorkspace) {
        return res.status(400).json({ error: "Workspace is required" });
      }

      // Get the workspace to determine the correct domain
      // For cross-domain users, we need the workspace's domain, not the user's domain
      const workspace = await Workspace.findOne({ workspaceId: currentWorkspace });
      const workspaceDomain = workspace?.domain || req.userDomain || req.user?.domain;

      // Use workspace domain when querying directories (not user's domain)
      // Directories are stored with workspace's domain
      const actualDomain = workspaceDomain;

      const userId = req.user?._id?.toString();

      // Build filter to include both regular directories and shared directories
      // Regular directories: domain + workspaceId + parentId (not shared)
      // Shared directories: workspaceId + isShared + sharedWithUserId + parentId (can be any domain)
      const filterConditions: any[] = [
        {
          domain: actualDomain,
          workspaceId: currentWorkspace,
          parentId,
          $or: [
            { isShared: { $exists: false } },
            { isShared: false },
            { isShared: null }
          ]
        }
      ];

      // Also include shared directories that belong to this user in this workspace
      // Shared directories can be from any domain, but must be in the current workspace
      if (userId) {
        filterConditions.push({
          workspaceId: currentWorkspace,
          parentId,
          isShared: true,
          sharedWithUserId: userId,
        });
      }

      const filter: any = filterConditions.length > 1 ? { $or: filterConditions } : filterConditions[0];

      const allDirs = await Directory.find(filter).sort({ name: 1 }).lean();

      console.log(`[listChildren] Found ${allDirs.length} directories (including shared) for workspace ${currentWorkspace}, parentId: ${parentId}, userId: ${userId}`);
      if (userId) {
        const sharedDirs = allDirs.filter(d => d.isShared);
        console.log(`[listChildren] Of these, ${sharedDirs.length} are shared directories`);
      }

      // Filter directories by user permissions (only show directories user has access to)
      // Use workspace domain for SharePermission lookups (not user domain)
      const domain = workspaceDomain;

      // Check if user is a cross-domain user (invited from another domain)
      const userDomain = req.user?.domain;
      const isCrossDomainUser = userDomain && userDomain !== workspaceDomain;
      const isSameDomainAdmin = req.user?.role === "admin" && userDomain === workspaceDomain;

      // Debug-only deep share inspection (disabled by default for latency)
      if (process.env.DEBUG_PERMISSIONS === "true" && userId && isCrossDomainUser) {
        const allUserShares = await SharePermission.find({
          scope: "user",
          principalId: userId,
          resourceType: "directory",
        });
        const shareDirIds = allUserShares.map(s => s.resourceId);
        const checkDirIds = allDirs.map(d => d.id);
        const matchingDirs = shareDirIds.filter(id => checkDirIds.includes(id));

        console.log(`[listChildren DEBUG] User: ${req.user?.email}, UserId: ${userId}`);
        console.log(`[listChildren DEBUG] UserDomain: ${userDomain}, WorkspaceDomain: ${workspaceDomain}, Domain used for lookup: ${domain}`);
        console.log(`[listChildren DEBUG] All SharePermissions for this user (any domain):`, allUserShares.map(s => ({
          domain: s.domain,
          resourceId: s.resourceId,
          role: s.role,
          principalId: s.principalId
        })));
        console.log(`[listChildren DEBUG] SharePermission directory IDs:`, shareDirIds);
        console.log(`[listChildren DEBUG] Directories to check IDs:`, checkDirIds);
        console.log(`[listChildren DEBUG] Matching directory IDs:`, matchingDirs);
        console.log(`[listChildren DEBUG] Total directories to check: ${allDirs.length}, Total SharePermissions: ${allUserShares.length}`);
      }

      const userEmail = req.user?.email?.toLowerCase();
      const allDirIds = allDirs.map((d) => d.id);
      const shareDomains = Array.from(
        new Set([workspaceDomain, ...allDirs.map((d) => d.domain).filter(Boolean)])
      );
      const shareQueryOr: any[] = [
        {
          scope: "workspace",
          domain: workspaceDomain,
          principalId: currentWorkspace,
        },
      ];
      if (userId) {
        shareQueryOr.push({
          scope: "user",
          domain: { $in: shareDomains },
          principalId: userId,
        });
      }
      if (userEmail) {
        shareQueryOr.push({
          scope: "user",
          domain: { $in: shareDomains },
          invitedEmail: userEmail,
        });
      }
      const sharePermissions =
        allDirIds.length > 0
          ? await SharePermission.find({
              resourceType: "directory",
              resourceId: { $in: allDirIds },
              $or: shareQueryOr,
            })
              .select("resourceId scope principalId invitedEmail")
              .lean()
          : [];
      const userSharedDirIds = new Set(
        sharePermissions
          .filter((s: any) => s.scope === "user")
          .map((s: any) => s.resourceId)
      );
      const workspaceSharedDirIds = new Set(
        sharePermissions
          .filter(
            (s: any) =>
              s.scope === "workspace" && s.principalId === currentWorkspace
          )
          .map((s: any) => s.resourceId)
      );

      const visibleDirs = allDirs.filter((dir) => {
        // Global access for directories in the current workspace.
        if (dir.workspaceId === currentWorkspace) return true;
        // Shared copy belongs to this user.
        if (dir.isShared && dir.sharedWithUserId === userId) return true;

        if (isCrossDomainUser) {
          // Cross-domain users require an explicit share.
          return (
            userSharedDirIds.has(dir.id) || workspaceSharedDirIds.has(dir.id)
          );
        }

        return true;
      });

      // Filter out null values (directories without permission)
      let dirs = visibleDirs.filter((d): d is typeof allDirs[0] => d !== null);

      // Self-heal shared-directory materialization only when needed.
      // Running this on every root request creates unnecessary query load.
      if (isCrossDomainUser && userId && parentId === null && dirs.length === 0) { // Only for root level fallback
        try {
          const pendingShares = await SharePermission.find({
            scope: "user",
            resourceType: "directory",
            $or: [
              { principalId: userId },
              { invitedEmail: req.user?.email?.toLowerCase() }
            ]
          });

          for (const share of pendingShares) {
            // Check if shared directory already exists
            const existingSharedDir = await Directory.findOne({
              sharedFromDirectoryId: share.resourceId,
              sharedWithUserId: userId,
              workspaceId: currentWorkspace,
            });

            if (!existingSharedDir) {
              // Get original directory
              const originalDirectory = await Directory.findOne({
                id: share.resourceId,
                domain: share.domain
              });

              if (originalDirectory) {
                // Get user's domain
                const userWithDomain = await User.findById(userId).select("domainId domain");
                if (userWithDomain) {
                  // Create shared directory in recipient's workspace
                  const sharedDirectoryId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                  const sharedDirectory = new Directory({
                    id: sharedDirectoryId,
                    name: originalDirectory.name,
                    normalizedName: originalDirectory.normalizedName || originalDirectory.name.toLowerCase().trim(),
                    parentId: null,
                    domain: userWithDomain.domain,
                    domainId: userWithDomain.domainId,
                    workspaceId: currentWorkspace,
                    ownerUserId: userId,
                    documentCount: 0,
                    drhpCount: 0,
                    rhpCount: 0,
                    sharedFromDirectoryId: share.resourceId,
                    sharedFromDomain: share.domain,
                    sharedFromWorkspaceId: originalDirectory.workspaceId,
                    sharedWithUserId: userId,
                    isShared: true,
                  });

                  await sharedDirectory.save();
                  console.log(`✅ Created missing shared directory ${sharedDirectoryId} in workspace ${currentWorkspace} for user ${userId}`);
                  dirs.push(sharedDirectory);
                }
              }
            }
          }
        } catch (createError) {
          console.error("[listChildren] Error creating missing shared directories:", createError);
        }
      }

      // For cross-domain users, if no SharePermissions exist, check if they have an accepted invitation
      // with grantedDirectories and create SharePermissions retroactively
      if (isCrossDomainUser && userId && dirs.length === 0) {
        const allUserShares = await SharePermission.find({
          scope: "user",
          principalId: userId,
          resourceType: "directory",
        });

        // If no SharePermissions exist, check for accepted invitation and create them
        if (allUserShares.length === 0) {
          console.log(`[listChildren] No SharePermissions found for cross-domain user. Checking for accepted invitation...`);

          const invitation = await WorkspaceInvitation.findOne({
            inviteeEmail: req.user?.email?.toLowerCase(),
            workspaceId: currentWorkspace,
            status: "accepted",
          });

          if (invitation && invitation.grantedDirectories && invitation.grantedDirectories.length > 0) {
            console.log(`[listChildren] Found accepted invitation with ${invitation.grantedDirectories.length} granted directories. Creating SharePermissions...`);

            // Get the inviter's domain
            const inviter = await User.findById(invitation.inviterId);
            if (inviter) {
              const actualDomain = inviter.domain;
              const userIdString = userId;

              for (const dirAccess of invitation.grantedDirectories) {
                try {
                  // Find directory
                  const directory = await Directory.findOne({
                    id: dirAccess.directoryId,
                    domain: actualDomain,
                    workspaceId: currentWorkspace,
                  });

                  if (directory) {
                    // Check if SharePermission already exists
                    // Must include domain in the query to match the compound index
                    const existingShare = await SharePermission.findOne({
                      domain: actualDomain,
                      resourceType: "directory",
                      resourceId: dirAccess.directoryId,
                      scope: "user",
                      principalId: userIdString,
                    });

                    if (!existingShare) {
                      // Create SharePermission using compound unique index
                      // The index is: { domain, resourceType, resourceId, scope, principalId }
                      const shareId = `shr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

                      try {
                        // Use direct insert instead of updateOne to avoid old index conflicts
                        // First check if it already exists (using compound index)
                        const existingCheck = await SharePermission.findOne({
                          domain: actualDomain,
                          resourceType: "directory",
                          resourceId: dirAccess.directoryId,
                          scope: "user",
                          principalId: userIdString,
                        });

                        if (existingCheck) {
                          console.log(`[listChildren] SharePermission already exists for directory ${dirAccess.directoryId}`);
                          continue; // Skip to next directory
                        }

                        // Clean up any SharePermissions with null linkToken that might block creation
                        // (due to old index)
                        await SharePermission.deleteMany({
                          domain: actualDomain,
                          resourceType: "directory",
                          resourceId: dirAccess.directoryId,
                          scope: "user",
                          principalId: userIdString,
                          linkToken: null,
                        });

                        // Use native MongoDB insert to bypass Mongoose validation and old index issues
                        // For user-scoped shares, set linkToken to a unique dummy value to bypass old index
                        // The old index { scope: 1, linkToken: 1 } requires unique linkToken values
                        const uniqueLinkToken = `user_${shareId}`;

                        const sharePermissionDoc = {
                          id: shareId,
                          resourceType: "directory",
                          resourceId: dirAccess.directoryId,
                          domain: actualDomain,
                          scope: "user",
                          principalId: userIdString,
                          role: dirAccess.role || "viewer",
                          invitedEmail: invitation.inviteeEmail,
                          createdBy: invitation.inviterId.toString(),
                          linkToken: uniqueLinkToken, // Set unique value to bypass old index
                          createdAt: new Date(),
                          updatedAt: new Date(),
                        };

                        // Use native MongoDB collection to insert directly
                        const collection = mongoose.connection.db.collection("sharepermissions");
                        await collection.insertOne(sharePermissionDoc);

                        // Verify creation
                        const verifyCreated = await SharePermission.findOne({
                          domain: actualDomain,
                          resourceType: "directory",
                          resourceId: dirAccess.directoryId,
                          scope: "user",
                          principalId: userIdString,
                        });

                        if (!verifyCreated) {
                          throw new Error("SharePermission was not created despite insertOne success");
                        }

                        console.log(`[listChildren] ✓ Created SharePermission (native insert) for directory ${dirAccess.directoryId} (${directory.name})`);
                      } catch (upsertError: any) {
                        // If upsert fails due to duplicate key error
                        if (upsertError.code === 11000) {
                          // Check if it's the old scope_1_linkToken_1 index causing the issue
                          if (upsertError.keyPattern?.scope === 1 && upsertError.keyPattern?.linkToken === 1) {
                            // This is the old index without partialFilterExpression
                            // Try to find existing SharePermission with this scope and null linkToken
                            const existingWithNullToken = await SharePermission.findOne({
                              scope: "user",
                              linkToken: null,
                              domain: actualDomain,
                              resourceType: "directory",
                              resourceId: dirAccess.directoryId,
                              principalId: userIdString,
                            });

                            if (existingWithNullToken) {
                              // SharePermission already exists, update it if needed
                              console.log(`[listChildren] SharePermission already exists (found via old index) for directory ${dirAccess.directoryId}`);
                              continue;
                            }

                            // Try to find using compound index (the correct one)
                            const verifyShare = await SharePermission.findOne({
                              domain: actualDomain,
                              resourceType: "directory",
                              resourceId: dirAccess.directoryId,
                              scope: "user",
                              principalId: userIdString,
                            });

                            if (verifyShare) {
                              // SharePermission exists, continue
                              console.log(`[listChildren] SharePermission already exists (found via compound index) for directory ${dirAccess.directoryId}`);
                              continue;
                            }

                            // If we get here, the old index is blocking us but the SharePermission doesn't exist
                            // The old index { scope: 1, linkToken: 1 } without partialFilterExpression is causing conflicts
                            // Try to find any existing SharePermission with this scope and null linkToken (from old index)
                            const anyExistingWithNullToken = await SharePermission.findOne({
                              scope: "user",
                              linkToken: null,
                            });

                            // Clean up: Remove linkToken field from any existing SharePermissions with scope="user" and linkToken=null
                            // This helps work around the old index issue
                            console.log(`[listChildren] ⚠ Old index conflict detected. Cleaning up null linkToken fields...`);
                            await SharePermission.updateMany(
                              {
                                scope: "user",
                                linkToken: null,
                              },
                              {
                                $unset: { linkToken: "" },
                              }
                            );
                            console.log(`[listChildren] Cleaned up SharePermissions with null linkToken`);

                            // Retry the creation - use native MongoDB insert to bypass old index issues
                            try {
                              // First, try to delete any existing SharePermission with null linkToken that might block us
                              await SharePermission.deleteMany({
                                domain: actualDomain,
                                resourceType: "directory",
                                resourceId: dirAccess.directoryId,
                                scope: "user",
                                principalId: userIdString,
                                linkToken: null,
                              });

                              // Use native MongoDB insert to bypass Mongoose validation and old index issues
                              // For user-scoped shares, set linkToken to a unique dummy value to bypass old index
                              const uniqueLinkToken = `user_${shareId}`;

                              const sharePermissionDoc = {
                                id: shareId,
                                resourceType: "directory",
                                resourceId: dirAccess.directoryId,
                                domain: actualDomain,
                                scope: "user",
                                principalId: userIdString,
                                role: dirAccess.role || "viewer",
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
                                console.log(`[listChildren] ✓ Created SharePermission (native insert after cleanup) for directory ${dirAccess.directoryId} (${directory.name})`);
                              } else {
                                throw new Error("SharePermission was not created despite insertOne success");
                              }
                            } catch (retryError: any) {
                              if (retryError.code === 11000) {
                                // Still duplicate, check if it exists now using compound index
                                const finalCheck = await SharePermission.findOne({
                                  domain: actualDomain,
                                  resourceType: "directory",
                                  resourceId: dirAccess.directoryId,
                                  scope: "user",
                                  principalId: userIdString,
                                });
                                if (finalCheck) {
                                  console.log(`[listChildren] SharePermission exists (after cleanup check) for directory ${dirAccess.directoryId}`);
                                } else {
                                  console.error(`[listChildren] Cannot create SharePermission even after cleanup for ${dirAccess.directoryId}. Error: ${retryError.message}`);
                                }
                              } else {
                                console.error(`[listChildren] Error creating SharePermission after cleanup for ${dirAccess.directoryId}:`, retryError);
                              }
                            }
                          } else {
                            // Different duplicate key error - check if SharePermission exists using compound index
                            const verifyShare = await SharePermission.findOne({
                              domain: actualDomain,
                              resourceType: "directory",
                              resourceId: dirAccess.directoryId,
                              scope: "user",
                              principalId: userIdString,
                            });
                            if (!verifyShare) {
                              throw upsertError; // Re-throw if it's a different error and SharePermission doesn't exist
                            }
                            // SharePermission exists, continue
                            console.log(`[listChildren] SharePermission already exists for directory ${dirAccess.directoryId}`);
                          }
                        } else {
                          throw upsertError;
                        }
                      }

                      console.log(`[listChildren] ✓ Created SharePermission for directory ${dirAccess.directoryId} (${directory.name})`);
                    }
                  }
                } catch (error: any) {
                  console.error(`[listChildren] Error creating SharePermission for ${dirAccess.directoryId}:`, error);
                }
              }

              // Re-fetch directories after creating SharePermissions
              // Use the same domain that was used to create SharePermissions (actualDomain = inviter's domain)
              console.log(`[listChildren] Re-fetching directories after SharePermission creation, using domain: ${actualDomain}`);

              // Get list of directory IDs that were just granted from the invitation
              const grantedDirectoryIds = invitation.grantedDirectories.map(d => d.directoryId);

              const updatedDirs = await Promise.all(
                allDirs.map(async (dir) => {
                  if (isSameDomainAdmin) return dir;

                  if (isCrossDomainUser) {
                    // If this directory was in the granted list, check for SharePermission
                    if (grantedDirectoryIds.includes(dir.id) && userId) {
                      // Must include domain in query to match the SharePermissions we just created
                      const userShare = await SharePermission.findOne({
                        domain: actualDomain, // Use the same domain used for creation
                        resourceType: "directory",
                        resourceId: dir.id,
                        scope: "user",
                        principalId: userId,
                      });

                      if (userShare) {
                        console.log(`[listChildren] ✓ Found SharePermission (after creation) for directory: ${dir.name} (${dir.id}), domain: ${userShare.domain}`);
                        return dir;
                      } else {
                        console.log(`[listChildren] ✗ No SharePermission found (after creation) for directory: ${dir.name} (${dir.id}), searched with domain: ${actualDomain}`);
                        // Even if not found in DB yet, if it was in granted list, include it
                        // (it might be a timing issue with MongoDB)
                        console.log(`[listChildren] ⚠ Including directory ${dir.name} anyway (was in granted list)`);
                        return dir;
                      }
                    }
                    return null;
                  }

                  // For same-domain users
                  if (dir.ownerUserId === userId) return dir;

                  if (userId) {
                    const userShare = await SharePermission.findOne({
                      domain,
                      resourceType: "directory",
                      resourceId: dir.id,
                      scope: "user",
                      principalId: userId,
                    });
                    if (userShare) return dir;
                  }

                  const wsShare = await SharePermission.findOne({
                    domain,
                    resourceType: "directory",
                    resourceId: dir.id,
                    scope: "workspace",
                    principalId: currentWorkspace,
                  });
                  if (wsShare) return dir;

                  return null;
                })
              );

              dirs = updatedDirs.filter((d): d is typeof allDirs[0] => d !== null);
              console.log(`[listChildren] After retroactive SharePermission creation, found ${dirs.length} directories`);
            }
          } else {
            console.log(`[listChildren] No accepted invitation with grantedDirectories found for this user`);
          }
        } else {
          // SharePermissions exist, use fallback mechanism
          const shareDirIds = allUserShares.map(s => s.resourceId);
          console.log(`[listChildren] User has ${allUserShares.length} SharePermissions for directories:`, shareDirIds);

          const fallbackDirs = await Directory.find({
            id: { $in: shareDirIds },
            workspaceId: currentWorkspace,
            parentId: parentId,
          });

          const existingDirIds = new Set(dirs.map(d => d.id));
          const newDirs = fallbackDirs.filter(d => !existingDirIds.has(d.id));

          if (newDirs.length > 0) {
            console.log(`[listChildren] Found ${newDirs.length} additional directories via SharePermission fallback`);
            dirs = [...dirs, ...newDirs];
          }
        }
      }

      // Documents under this directory
      // Use workspace domain when querying documents (not user domain)
      const actualDomainForDocs = workspaceDomain;

      // Check if parentId is a shared directory - if so, we need to get documents from the original directory
      let originalDirectoryId = parentId;
      let isViewingSharedDirectory = false;

      if (parentId) {
        const parentDirectory = await Directory.findOne({ id: parentId, workspaceId: currentWorkspace });
        if (parentDirectory?.isShared && parentDirectory?.sharedFromDirectoryId) {
          originalDirectoryId = parentDirectory.sharedFromDirectoryId;
          isViewingSharedDirectory = true;
          console.log(`[listChildren] Viewing shared directory ${parentId}, fetching documents from original directory ${originalDirectoryId}`);
        }
      }

      // Build document filter - need to check both shared directory and original directory
      const docFilterConditions: any[] = [
        {
          domain: actualDomainForDocs,
          workspaceId: currentWorkspace,
          directoryId: parentId,
        }
      ];

      // If viewing a shared directory, also get documents from the original directory
      if (isViewingSharedDirectory && originalDirectoryId) {
        // Get the original directory's domain and workspace
        const originalDir = await Directory.findOne({ id: originalDirectoryId });
        if (originalDir) {
          docFilterConditions.push({
            domain: originalDir.domain,
            workspaceId: originalDir.workspaceId,
            directoryId: originalDirectoryId,
          });
          console.log(`[listChildren] Also querying documents from original directory ${originalDirectoryId} in domain ${originalDir.domain}, workspace ${originalDir.workspaceId}`);
        }
      }

      const docFilter: any = docFilterConditions.length > 1 ? { $or: docFilterConditions } : docFilterConditions[0];

      // Sorting
      const sortKey = sort === "uploadedAt" ? "uploadedAt" : "name";
      const sortDir = (order || "asc").toLowerCase() === "desc" ? -1 : 1;

      const allDocs = await Document.find(docFilter)
        .sort({ [sortKey]: sortDir })
        .lean();

      console.log(`[listChildren] Found ${allDocs.length} documents for directory ${parentId}${isViewingSharedDirectory ? ` (shared, original: ${originalDirectoryId})` : ''}`);

      // Filter documents based on directory access permissions
      // Only show documents from directories the user has access to
      // Cross-domain users should only see documents in directories they have access to
      let docs = allDocs;

      // Only filter if user is NOT a same-domain admin
      if (!isSameDomainAdmin) {
        const visibleDirIds = new Set(dirs.map((d) => d.id));
        const docDirectoryIds = Array.from(
          new Set(
            allDocs
              .map((doc) => doc.directoryId)
              .filter((id): id is string => Boolean(id))
          )
        );

        const docShareQueryOr: any[] = [
          {
            scope: "workspace",
            domain: workspaceDomain,
            principalId: currentWorkspace,
          },
        ];
        if (userId) {
          docShareQueryOr.push({
            scope: "user",
            domain: { $in: [workspaceDomain] },
            principalId: userId,
          });
        }
        if (userEmail) {
          docShareQueryOr.push({
            scope: "user",
            domain: { $in: [workspaceDomain] },
            invitedEmail: userEmail,
          });
        }

        const docSharePermissions =
          docDirectoryIds.length > 0
            ? await SharePermission.find({
                resourceType: "directory",
                resourceId: { $in: docDirectoryIds },
                $or: docShareQueryOr,
              })
                .select("resourceId")
                .lean()
            : [];
        const docSharedDirIds = new Set(
          docSharePermissions.map((share: any) => share.resourceId)
        );

        docs = allDocs.filter((doc) => {
          const docDirId = doc.directoryId || null;

          // Cross-domain users cannot access root docs by default.
          if (isCrossDomainUser && !docDirId) return false;
          if (!isCrossDomainUser && !docDirId) return true;
          if (!docDirId) return false;

          // Directory already visible in current result set.
          if (visibleDirIds.has(docDirId)) return true;

          // Documents from original directory should be visible when viewing a shared dir.
          if (
            isViewingSharedDirectory &&
            originalDirectoryId &&
            docDirId === originalDirectoryId
          ) {
            return true;
          }

          // Fallback: explicit share exists for this directory.
          return docSharedDirIds.has(docDirId);
        });
      }

      // Merge and paginate
      const merged = [
        ...dirs.map((d) => ({ kind: "directory", item: d })),
        ...docs.map((d) => ({ kind: "document", item: d })),
      ];
      const p = Math.max(parseInt(page || "1", 10), 1);
      const ps = Math.min(Math.max(parseInt(pageSize || "50", 10), 1), 200);
      const start = (p - 1) * ps;
      const paged = merged.slice(start, start + ps);

      const totalMs = Date.now() - requestStartedAt;
      console.log(
        `[perf] directories.listChildren completed in ${totalMs}ms (workspace=${currentWorkspace}, parent=${parentId ?? "root"}, items=${paged.length}, total=${merged.length})`
      );
      res.json({
        total: merged.length,
        page: p,
        pageSize: ps,
        items: paged,
      });
    } catch (err) {
      const totalMs = Date.now() - requestStartedAt;
      console.log(`[perf] directories.listChildren failed after ${totalMs}ms`);
      res.status(500).json({ error: "Failed to list children" });
    }
  },

  async update(req: AuthRequest, res: Response) {
    try {
      const { name, parentId } = req.body || {};
      // Get current workspace from request
      // Workspace is required
      const currentWorkspace = req.currentWorkspace;
      if (!currentWorkspace) {
        return res.status(400).json({ error: "Workspace is required" });
      }

      const dir = await Directory.findOne({
        id: req.params.id,
        workspaceId: currentWorkspace,
      });
      if (!dir) {
        return res.status(404).json({ error: "Directory not found" });
      }
      if (typeof name === "string" && name.trim() !== "") {
        dir.name = name.trim();
      }
      if (typeof parentId !== "undefined") {
        dir.parentId = parentId || null;
      }
      dir.updatedAt = new Date();
      await dir.save();
      await publishEvent({
        actorUserId: req.user?._id?.toString?.(),
        domain: req.userDomain!,
        action: "directory.updated",
        resourceType: "directory",
        resourceId: dir.id,
        title: `Folder updated: ${dir.name}`,
        notifyWorkspace: true,
      });
      res.json(dir);
    } catch (err: any) {
      if (err?.code === 11000) {
        return res
          .status(409)
          .json({ error: "A folder with this name already exists here" });
      }
      res.status(500).json({ error: "Failed to update directory" });
    }
  },

  // Soft delete removed

  // Restore removed

  async delete(req: AuthRequest, res: Response) {
    try {
      // Get current workspace from request
      // Workspace is required
      const currentWorkspace = req.currentWorkspace;
      if (!currentWorkspace) {
        return res.status(400).json({ error: "Workspace is required" });
      }

      const dir = await Directory.findOne({
        id: req.params.id,
        workspaceId: currentWorkspace,
      });
      if (!dir) {
        return res.status(404).json({ error: "Directory not found" });
      }

      // Get all descendant directories recursively
      const queue = [dir.id];
      const visited: Set<string> = new Set();
      const dirsToDelete: string[] = [];

      while (queue.length) {
        const current = queue.shift()!;
        if (visited.has(current)) continue;
        visited.add(current);
        dirsToDelete.push(current);

        const children = await Directory.find({
          workspaceId: currentWorkspace,
          parentId: current,
        });
        for (const child of children) {
          if (!visited.has(child.id)) queue.push(child.id);
        }
      }

      // Delete all documents in all directories
      await Document.deleteMany({
        workspaceId: currentWorkspace,
        directoryId: { $in: dirsToDelete },
      });

      // Delete all directories
      await Directory.deleteMany({
        workspaceId: currentWorkspace,
        id: { $in: dirsToDelete },
      });

      await publishEvent({
        actorUserId: req.user?._id?.toString?.(),
        domain: req.userDomain!,
        action: "directory.deleted",
        resourceType: "directory",
        resourceId: dir.id,
        title: `Folder permanently deleted: ${dir.name}`,
        notifyWorkspace: true,
      });

      res.json({ message: "Directory and all contents permanently deleted" });
    } catch (err) {
      res.status(500).json({ error: "Failed to delete directory" });
    }
  },

  // NEW: Search directories with fuzzy matching
  async search(req: AuthRequest, res: Response) {
    try {
      const { query, limit = 10 } = req.query;
      const currentWorkspace = req.currentWorkspace;

      if (!currentWorkspace) {
        return res.status(400).json({ error: "Workspace is required" });
      }

      if (!query || String(query).trim() === "") {
        // Return recent/popular directories if no query.
        // Cosmos DB may reject multi-field order-by without a composite index,
        // so fetch and sort in-memory for compatibility.
        const rawDirectories = await Directory.find({
          workspaceId: currentWorkspace,
          parentId: null, // Only top-level company directories
        })
          .limit(Math.max(Number(limit) * 5, 50))
          .lean();

        const directories = rawDirectories
          .sort((a: any, b: any) => {
            const docCountDiff = (Number(b.documentCount) || 0) - (Number(a.documentCount) || 0);
            if (docCountDiff !== 0) return docCountDiff;
            const timeA = a.lastDocumentUpload ? new Date(a.lastDocumentUpload).getTime() : 0;
            const timeB = b.lastDocumentUpload ? new Date(b.lastDocumentUpload).getTime() : 0;
            return timeB - timeA;
          })
          .slice(0, Number(limit));

        return res.json(directories);
      }

      const searchQuery = String(query).trim();
      const { normalizeCompanyName, findSimilarDirectories } = await import("../lib/companyNameNormalizer");

      // Find similar directories
      const similarDirs = await findSimilarDirectories(searchQuery, currentWorkspace, 70);

      // Also do a text search for exact/partial matches
      const normalized = normalizeCompanyName(searchQuery);
      const textMatches = await Directory.find({
        workspaceId: currentWorkspace,
        parentId: null,
        $or: [
          { name: { $regex: searchQuery, $options: "i" } },
          { normalizedName: { $regex: normalized, $options: "i" } },
        ],
      }).limit(Number(limit));

      // Combine and deduplicate results
      const allResults = new Map();

      // Add text matches first (higher priority)
      textMatches.forEach(dir => {
        const normalizedDirName = dir.normalizedName || normalizeCompanyName(dir.name);
        const similarity = normalized === normalizedDirName ? 100 :
          (normalized.includes(normalizedDirName) || normalizedDirName.includes(normalized) ? 90 : 80);
        allResults.set(dir.id, {
          id: dir.id,
          name: dir.name,
          normalizedName: normalizedDirName,
          similarity,
          documentCount: dir.documentCount || 0,
          drhpCount: dir.drhpCount || 0,
          rhpCount: dir.rhpCount || 0,
          lastDocumentUpload: dir.lastDocumentUpload,
        });
      });

      // Add fuzzy matches
      similarDirs.forEach(match => {
        if (!allResults.has(match.id) || allResults.get(match.id).similarity < match.similarity) {
          allResults.set(match.id, match);
        }
      });

      // Sort by similarity and return
      const results = Array.from(allResults.values())
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, Number(limit));

      res.json(results);
    } catch (error) {
      console.error("Error searching directories:", error);
      res.status(500).json({ error: "Failed to search directories" });
    }
  },

  // NEW: Check for duplicate/similar directories before creation
  async checkDuplicate(req: AuthRequest, res: Response) {
    try {
      const { name } = req.body;
      const currentWorkspace = req.currentWorkspace;

      if (!currentWorkspace) {
        return res.status(400).json({ error: "Workspace is required" });
      }

      if (!name || String(name).trim() === "") {
        return res.status(400).json({ error: "Name is required" });
      }

      const { normalizeCompanyName, findSimilarDirectories } = await import("../lib/companyNameNormalizer");
      const normalized = normalizeCompanyName(name);

      // Check for exact match
      const exactMatch = await Directory.findOne({
        workspaceId: currentWorkspace,
        normalizedName: normalized,
        parentId: null, // Only top-level directories
      });

      if (exactMatch) {
        return res.json({
          isDuplicate: true,
          exactMatch: {
            id: exactMatch.id,
            name: exactMatch.name,
            similarity: 100,
          },
          similarDirectories: [],
        });
      }

      // Find similar directories
      const similarDirs = await findSimilarDirectories(name, currentWorkspace, 80);

      return res.json({
        isDuplicate: false,
        exactMatch: null,
        similarDirectories: similarDirs,
      });
    } catch (error) {
      console.error("Error checking duplicate:", error);
      res.status(500).json({ error: "Failed to check for duplicates" });
    }
  },
};
