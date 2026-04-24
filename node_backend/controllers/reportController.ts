import { Request, Response } from "express";
import { Report } from "../models/Report";
import { User } from "../models/User";
import axios from "axios";
import { publishEvent } from "../lib/events";
import { generateDocxBuffer } from "../services/docxService";
import { v4 as uuidv4 } from "uuid";
import { emitToWorkspace } from "../services/realtimeEmitter";
import { Job } from "../models/Job";
import crypto from "crypto";
import { jobAdmissionService } from "../services/jobAdmissionService";
import { metricsService } from "../services/metricsService";
import { brokerQueueTelemetryService } from "../services/brokerQueueTelemetryService";
import { idempotencyLockService } from "../services/idempotencyLockService";
import { applyCanonicalInternalJobStatusUpdate } from "../services/jobLifecycleService";
import { buildSignedInternalJsonRequest } from "../services/internalRequestSigning";

interface AuthRequest extends Request {
  user?: any;
  userDomain?: string;
  currentWorkspace?: string;
}

const parsePagination = (query: any) => {
  const limitRaw = Number(query?.limit ?? query?.pageSize ?? 50);
  const offsetRaw = Number(query?.offset ?? ((Number(query?.page || 1) - 1) * limitRaw));
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50;
  const offset = Number.isFinite(offsetRaw) ? Math.max(offsetRaw, 0) : 0;
  return { limit, offset };
};

export const reportController = {
  async compareDocuments(req: AuthRequest, res: Response) {
    let createdJobId: string | null = null;
    let idempotencyKey: string | null = null;
    let idempotencyOwner: string | null = null;
    let tenantIdForLock: string | null = null;
    try {
      const { drhpNamespace, rhpNamespace, sessionId, prompt } = req.body;

      // Handle both drhpId and drhpDocumentId (compat with reportN8nService)
      const drhpId = req.body.drhpId || req.body.drhpDocumentId;
      const rhpId = req.body.rhpId || req.body.rhpDocumentId;

      if (!drhpId || !rhpId || !drhpNamespace || !rhpNamespace) {
        return res.status(400).json({
          error: "Missing required fields for comparison",
          received: { drhpId: !!drhpId, rhpId: !!rhpId, drhpNamespace: !!drhpNamespace, rhpNamespace: !!rhpNamespace }
        });
      }

      const pythonApiUrl = process.env.PYTHON_API_URL || "http://localhost:8000";
      const domain = req.userDomain || (req as any).user?.domain;

      // Get domainId
      let domainId = (req as any).user?.domainId;
      if (!domainId && req.user?._id) {
        const user = await User.findById(req.user._id).select("domainId").lean();
        domainId = user?.domainId;
      }

      console.log(`Triggering Python Comparison: ${drhpNamespace} vs ${rhpNamespace}`);

      const tenantId = domainId || domain;
      if (!tenantId) {
        return res.status(400).json({ error: "Unable to resolve tenant/domain for comparison job" });
      }
      tenantIdForLock = String(tenantId);
      const queueName = "light_jobs";
      const userId = req.user?._id?.toString?.() || "anonymous";
      idempotencyKey = crypto
        .createHash("sha256")
        .update(`${userId}:${drhpId}:${rhpId}:comparison`)
        .digest("hex");
      idempotencyOwner = crypto.randomUUID();
      const admission = await jobAdmissionService.check(tenantId, queueName);
      console.log("[report.compare] admission decision", {
        tenantId,
        queueName,
        allow: admission.allow,
        reason: admission.reason,
        loadState: admission.loadState,
        telemetryStatus: admission.telemetryStatus,
        queueDepth: admission.queueDepth,
        queueAgeSeconds: admission.queueAgeSeconds,
      });
      if (admission.telemetryStatus === "UNAVAILABLE") {
        metricsService.emit("telemetry_unavailable", 1, {
          tenant_id: tenantId,
          queue_name: queueName,
        });
      }
      metricsService.emit("queue_depth", admission.queueDepth, { tenant_id: tenantId, queue_name: queueName });
      metricsService.emit("queue_age_seconds", admission.queueAgeSeconds, {
        tenant_id: tenantId,
        queue_name: queueName,
      });
      if (!admission.allow) {
        return res.status(429).json({
          error: "Queue overloaded, retry later",
          code: admission.reason || "QUEUE_OVERLOADED",
        });
      }
      const lock = await idempotencyLockService.acquire({
        tenantId: String(tenantId),
        idempotencyKey,
        ownerId: idempotencyOwner,
      });
      console.log("[report.compare] idempotency lock", {
        acquired: lock.acquired,
        hasExistingJob: Boolean((lock as any)?.existingJob),
        retryAfterSeconds: (lock as any)?.retryAfterSeconds,
      });
      if (!lock.acquired) {
        if (lock.existingJob) {
          return res.status(200).json({
            status: lock.existingJob.status,
            job_id: lock.existingJob.id,
            message: "Comparison job already in progress",
            idempotent: true,
          });
        }
        return res.status(202).json({
          status: "queued",
          job_id: null,
          message: "Comparison request already in progress",
          idempotent: true,
          pending: true,
          retry_after_seconds: lock.retryAfterSeconds,
        });
      }

      const payload = {
        job_id: uuidv4(),
        drhpNamespace,
        rhpNamespace,
        drhpDocumentId: drhpId,
        rhpDocumentId: rhpId,
        sessionId: sessionId || undefined,
        domain: domain,
        domainId: domainId,
        authorization: req.headers.authorization,
        trace_id: "",
        queue_name: queueName,
        metadata: {
          workspaceId: req.currentWorkspace || domain,
          triggeredBy: req.user?._id
        }
      };
      payload.sessionId = payload.job_id;
      payload.trace_id = payload.job_id;

      createdJobId = payload.job_id;
      await Job.create({
        id: payload.job_id,
        tenant_id: tenantId,
        job_type: "comparison",
        status: admission.status,
        current_stage: "comparison",
        progress_pct: 0,
        workspace_id: req.currentWorkspace || domain,
        created_by: req.user?._id?.toString?.() || null,
        drhp_id: drhpId,
        rhp_id: rhpId,
        title: `${drhpNamespace} vs ${rhpNamespace}`,
        idempotency_key: idempotencyKey,
        trace_id: payload.job_id,
        queue_name: queueName,
        queued_with_delay: admission.status === "queued_with_delay",
      });
      await idempotencyLockService.bindJob({
        tenantId: String(tenantId),
        idempotencyKey,
        ownerId: idempotencyOwner,
        jobId: String(payload.job_id),
      });

      const comparisonUrl = `${pythonApiUrl}/jobs/comparison`;
      console.log("[report.compare] python dispatch start", {
        url: comparisonUrl,
        jobId: payload.job_id,
        tenantId,
        workspaceId: payload.metadata?.workspaceId,
      });
      const signed = buildSignedInternalJsonRequest("POST", comparisonUrl, payload, {
        "X-Trace-Id": payload.job_id,
      });
      const pythonResponse = await axios.post(comparisonUrl, signed.data, {
        headers: signed.headers,
        timeout: 30000
      });
      console.log("[report.compare] python dispatch response", {
        status: pythonResponse?.status,
        dataStatus: pythonResponse?.data?.status,
        jobId: pythonResponse?.data?.job_id || payload.job_id,
      });

      if (pythonResponse.data && pythonResponse.data.status === "accepted") {
        await metricsService.emitQueueMetrics(tenantId, queueName);
        await brokerQueueTelemetryService.emitBrokerQueueMetrics();
        return res.json({
          status: admission.status,
          job_id: pythonResponse.data.job_id || payload.job_id,
          message: "Comparison job started successfully"
        });
      }

      if (createdJobId) {
        await idempotencyLockService.releaseByJobId({
          tenantId: String(tenantId),
          jobId: createdJobId,
        });
      }
      res.status(500).json({ error: "Failed to start comparison job", details: pythonResponse.data });
    } catch (error: any) {
      if (createdJobId) {
        await Job.updateOne(
          {
            id: createdJobId,
            ...(tenantIdForLock ? { tenant_id: tenantIdForLock } : {}),
          },
          {
            $set: {
              status: "failed",
              error_reason: `Failed to dispatch comparison job: ${String(error?.message || "unknown")}`,
              error_message: `Failed to dispatch comparison job: ${String(error?.message || "unknown")}`,
              completed_at: new Date(),
            },
          }
        );
        if (tenantIdForLock) {
          await idempotencyLockService.releaseByJobId({
            tenantId: tenantIdForLock,
            jobId: createdJobId,
          });
        }
      } else if (tenantIdForLock && idempotencyKey && idempotencyOwner) {
        await idempotencyLockService.releaseByOwner({
          tenantId: tenantIdForLock,
          idempotencyKey,
          ownerId: idempotencyOwner,
        });
      }
      console.error("Error in compareDocuments:", error.message);
      res.status(500).json({ error: "Comparison trigger failed", message: error.message });
    }
  },

  async getAll(req: AuthRequest, res: Response) {
    try {
      const link = (req as any).linkAccess;

      // Get current workspace from request
      const currentWorkspace = req.currentWorkspace || req.userDomain;
      const domain = req.userDomain || (link?.domain);

      const query: any = {};
      if (domain) query.domain = domain;
      if (currentWorkspace) query.workspaceId = currentWorkspace;

      console.log("Fetching reports with query:", JSON.stringify(query));

      // Handle link access
      if (link) {
        if (link.resourceType === "document") {
          // If link is for a specific document, show reports that reference that document
          const { Document } = await import("../models/Document");
          const document = await Document.findOne({
            id: link.resourceId,
            domain: link.domain,
          });
          if (document) {
            // Show reports that reference this document as DRHP or RHP
            query.$or = [
              { drhpId: document.id },
              { rhpId: document.id },
              { drhpNamespace: document.namespace },
              { rhpNamespace: document.namespace || document.rhpNamespace },
            ];
          } else {
            // Document not found, return empty array
            return res.json([]);
          }
        } else if (link.resourceType === "directory") {
          // If link is for a directory, show reports for all documents in that directory
          const { Document } = await import("../models/Document");
          const documents = await Document.find({
            directoryId: link.resourceId,
            domain: link.domain,
          });
          const documentIds = documents.map(doc => doc.id);
          const documentNamespaces = documents.map(doc => doc.namespace);
          if (documentIds.length > 0 || documentNamespaces.length > 0) {
            query.$or = [
              { drhpId: { $in: documentIds } },
              { rhpId: { $in: documentIds } },
              { drhpNamespace: { $in: documentNamespaces } },
              { rhpNamespace: { $in: documentNamespaces } },
            ];
          } else {
            // No documents in directory, return empty array
            return res.json([]);
          }
        }
      } else {
        // Check for shared directories via SharePermission
        const { SharePermission } = await import("../models/SharePermission");
        const { Document } = await import("../models/Document");
        const { Directory } = await import("../models/Directory");

        const userId = req.user?._id?.toString();
        const userEmail = req.user?.email?.toLowerCase();
        const sharedDirectoryIds: string[] = [];

        // Find all directories shared with this user
        if (userId) {
          const userShares = await SharePermission.find({
            resourceType: "directory",
            scope: "user",
            principalId: userId,
          });
          sharedDirectoryIds.push(...userShares.map(s => s.resourceId));
        }

        if (userEmail) {
          const emailShares = await SharePermission.find({
            resourceType: "directory",
            scope: "user",
            invitedEmail: userEmail,
          });
          sharedDirectoryIds.push(...emailShares.map(s => s.resourceId));
        }

        // Also check workspace-scoped shares
        if (currentWorkspace) {
          const workspaceShares = await SharePermission.find({
            resourceType: "directory",
            scope: "workspace",
            principalId: currentWorkspace,
          });
          sharedDirectoryIds.push(...workspaceShares.map(s => s.resourceId));
        }

        // Get all documents from shared directories
        if (sharedDirectoryIds.length > 0) {
          const uniqueDirIds = [...new Set(sharedDirectoryIds)];
          // Scope shared-doc lookup to trusted directory records.
          const trustedDirectories = await Directory.find({
            id: { $in: uniqueDirIds },
          }).select("id domain workspaceId");
          const sharedDirectoryScope = trustedDirectories.map((dir: any) => ({
            directoryId: dir.id,
            domain: dir.domain,
            workspaceId: dir.workspaceId,
          }));
          const sharedDocs = sharedDirectoryScope.length
            ? await Document.find({ $or: sharedDirectoryScope })
            : [];
          const sharedDocumentIds = sharedDocs.map(doc => doc.id);
          const sharedDocumentNamespaces = sharedDocs.map(doc => doc.namespace);

          // Also check for shared directories created via Directory.isShared
          const sharedDirs = await Directory.find({
            isShared: true,
            sharedWithUserId: userId,
            workspaceId: currentWorkspace,
          });

          const sharedOrigins = sharedDirs
            .filter(
              (dir: any) =>
                !!dir.sharedFromDirectoryId && !!dir.sharedFromDomain && !!dir.sharedFromWorkspaceId
            )
            .map((dir: any) => ({
              id: dir.sharedFromDirectoryId,
              domain: dir.sharedFromDomain,
              workspaceId: dir.sharedFromWorkspaceId,
            }));
          if (sharedOrigins.length > 0) {
            const originalDirectories = await Directory.find({
              $or: sharedOrigins.map((origin) => ({
                id: origin.id,
                domain: origin.domain,
                workspaceId: origin.workspaceId,
              })),
            }).select("id domain workspaceId");
            const originalScope = originalDirectories.map((dir: any) => ({
              directoryId: dir.id,
              domain: dir.domain,
              workspaceId: dir.workspaceId,
            }));
            if (originalScope.length > 0) {
              const originalDocs = await Document.find({ $or: originalScope }).select("id namespace");
              sharedDocumentIds.push(...originalDocs.map((doc: any) => doc.id));
              sharedDocumentNamespaces.push(...originalDocs.map((doc: any) => doc.namespace));
            }
          }
          const uniqueSharedDocumentIds = Array.from(new Set(sharedDocumentIds));
          const uniqueSharedNamespaces = Array.from(
            new Set(sharedDocumentNamespaces.filter((ns: any) => !!ns))
          );

          // Include reports for shared documents, but keep each shared branch scoped
          // to the exact domain/workspace tuple where those documents were resolved.
          if (uniqueSharedDocumentIds.length > 0 || uniqueSharedNamespaces.length > 0) {
            const sharedScopeMap = new Map<
              string,
              { domain: string; workspaceId: string; ids: Set<string>; namespaces: Set<string> }
            >();
            for (const doc of sharedDocs as any[]) {
              const scopedDomain = String(doc?.domain || "");
              const scopedWorkspace = String(doc?.workspaceId || "");
              const docId = String(doc?.id || "");
              const docNamespace = String(doc?.namespace || "");
              if (!scopedDomain || !scopedWorkspace || !docId) {
                continue;
              }
              const key = `${scopedDomain}::${scopedWorkspace}`;
              if (!sharedScopeMap.has(key)) {
                sharedScopeMap.set(key, {
                  domain: scopedDomain,
                  workspaceId: scopedWorkspace,
                  ids: new Set<string>(),
                  namespaces: new Set<string>(),
                });
              }
              const scoped = sharedScopeMap.get(key)!;
              scoped.ids.add(docId);
              if (docNamespace) {
                scoped.namespaces.add(docNamespace);
              }
            }

            const sharedReportsQuery: any[] = [];
            for (const scoped of sharedScopeMap.values()) {
              const ids = Array.from(scoped.ids);
              const namespaces = Array.from(scoped.namespaces);
              const scopedOr: any[] = [
                { drhpId: { $in: ids } },
                { rhpId: { $in: ids } },
              ];
              if (namespaces.length > 0) {
                scopedOr.push(
                  { drhpNamespace: { $in: namespaces } },
                  { rhpNamespace: { $in: namespaces } }
                );
              }
              sharedReportsQuery.push({
                domain: scoped.domain,
                workspaceId: scoped.workspaceId,
                $or: scopedOr,
              });
            }

            if (sharedReportsQuery.length > 0) {
              // Combine with workspace reports
              // Remove domain/workspaceId from base query since we're using $or
              delete query.domain;
              delete query.workspaceId;
              query.$or = [
                { domain: domain, workspaceId: currentWorkspace },
                ...sharedReportsQuery,
              ];
            }
          }
        }
        // If no shared directories, query already has domain and workspaceId, so it will show all workspace reports
      }

      // Visibility: All members of the workspace can see all reports in that workspace.
      // Do not further restrict by userId/microsoftId for reads.

      const { limit, offset } = parsePagination(req.query);
      const reports = await Report.find(query)
        .sort({ updatedAt: -1 })
        .skip(offset)
        .limit(limit)
        .select(
          "id title updatedAt drhpId rhpId drhpNamespace rhpNamespace domain domainId workspaceId microsoftId userId"
        )
        .lean();
      res.json(reports);
    } catch (error: any) {
      console.error("Error fetching reports:", error);
      res.status(500).json({ 
        message: "Error fetching reports", 
        details: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    }
  },

  async getById(req: AuthRequest, res: Response) {
    try {
      const currentWorkspace = req.currentWorkspace || req.userDomain;
      const query: any = {
        id: req.params.id,
        domain: req.userDomain, // Ensure user can only access reports from their domain
        workspaceId: currentWorkspace,
      };

      const report = await Report.findOne(query);
      if (!report) {
        return res.status(404).json({ error: "Report not found" });
      }
      res.json(report);
    } catch (error) {
      console.error("Error fetching report:", error);
      res.status(500).json({ message: "Error fetching report" });
    }
  },

  async create(req: AuthRequest, res: Response) {
    try {
      const { title, content, drhpNamespace, rhpNamespace, domainId: bodyDomainId, domain: bodyDomain } =
        req.body;

      // Handle both drhpId and drhpDocumentId
      const drhpId = req.body.drhpId || req.body.drhpDocumentId;
      const rhpId = req.body.rhpId || req.body.rhpDocumentId;

      if (
        !title ||
        !content ||
        !drhpId ||
        !rhpId ||
        !drhpNamespace ||
        !rhpNamespace
      ) {
        return res.status(400).json({
          message: "Missing required fields",
          required: {
            title: !!title,
            content: !!content,
            drhpId: !!drhpId,
            rhpId: !!rhpId,
            drhpNamespace: !!drhpNamespace,
            rhpNamespace: !!rhpNamespace,
          },
        });
      }

      // Get current workspace from request
      const currentWorkspace = req.currentWorkspace || req.userDomain;
      const actualDomain = req.userDomain || bodyDomain;

      // Get domainId - priority: 1) from request body (n8n), 2) from user, 3) from domain name lookup
      let domainId: string | undefined = bodyDomainId;

      if (!domainId) {
        // Try to get from user if available
        const user = req.user;
        if (user?._id) {
          const userWithDomain = await User.findById(user._id).select("domainId").lean();
          domainId = userWithDomain?.domainId || (userWithDomain as any)?.domainId;
        }
      }

      // If domainId still not found, try to get it from the domain name
      if (!domainId && actualDomain) {
        try {
          const { Domain } = await import("../models/Domain");
          const domainRecord = await Domain.findOne({ domainName: actualDomain, status: "active" });
          if (domainRecord) {
            domainId = domainRecord.domainId;
          }
        } catch (error) {
          console.error("Error fetching domainId from Domain model:", error);
        }
      }

      if (!domainId) {
        return res.status(400).json({
          error: "domainId is required. Unable to determine domainId from request body, user, or domain.",
          message: "Please ensure domainId is included in the request body or contact administrator."
        });
      }

      const reportData: any = {
        id: uuidv4(),
        title,
        content,
        drhpId,
        rhpId,
        drhpNamespace,
        rhpNamespace,
        domain: actualDomain, // Add domain for workspace isolation - backward compatibility
        domainId: domainId, // Link to Domain schema (required)
        workspaceId: currentWorkspace, // Add workspace for team isolation
        updatedAt: new Date(),
      };

      // Add user information if available
      if (req.user) {
        if (req.user.microsoftId) {
          reportData.microsoftId = req.user.microsoftId;
        } else if (req.user._id) {
          reportData.userId = req.user._id.toString();
        }
      }


      const { id: generatedId, ...reportDataWithoutId } = reportData;
      const report = await Report.findOneAndUpdate(
        {
          domainId,
          workspaceId: currentWorkspace,
          drhpNamespace,
          rhpNamespace,
        },
        {
          $set: reportDataWithoutId,
          $setOnInsert: { id: generatedId },
        },
        {
          new: true,
          upsert: true,
          runValidators: true,
          setDefaultsOnInsert: true,
        }
      );

      // Update directory's updatedAt when report is created
      if (drhpId) {
        const { Document } = await import("../models/Document");
        const { Directory } = await import("../models/Directory");
        const doc = await Document.findOne({ id: drhpId, workspaceId: currentWorkspace });
        if (doc?.directoryId) {
          const now = new Date();
          await Directory.updateOne(
            { id: doc.directoryId, workspaceId: currentWorkspace },
            {
              $set: {
                updatedAt: now,
              },
            }
          );
        }
      }

      // Publish event for workspace notification (only if user context available)
      if (req.user?._id && req.userDomain) {
        await publishEvent({
          actorUserId: req.user._id.toString(),
          domain: req.userDomain,
          action: "report.created",
          resourceType: "report",
          resourceId: report.id,
          title: `New report created: ${report.title}`,
          notifyWorkspace: true,
        });
      }

      res.status(201).json(report);
    } catch (error) {
      console.error("Error creating report:", error);
      res
        .status(500)
        .json({ error: "Failed to create report", details: error });
    }
  },

  async reportStatusUpdate(req: Request, res: Response) {
    try {
      const { jobId, status, error, workspaceId, domainId, output_urls, outputUrls, result } = req.body;
      if (!workspaceId || !domainId) {
        return res.status(400).json({
          message: "Missing required scoped callback metadata",
          required: ["workspaceId", "domainId"],
        });
      }
      if (!jobId || !status) {
        return res.status(400).json({ message: "Missing jobId or status" });
      }
      const normalized =
        String(status).toLowerCase() === "success"
          ? "completed"
          : String(status).toLowerCase();
      const mappedStatus = ["completed", "completed_with_errors", "failed", "processing"].includes(
        normalized
      )
        ? normalized
        : "processing";

      const job = await Job.findOne({ id: jobId, job_type: "comparison" })
        .select("id tenant_id workspace_id")
        .lean();
      if (!job) {
        console.warn("reportStatusUpdate rejected: unknown comparison jobId", { jobId });
        return res.status(404).json({ message: "Unknown jobId" });
      }
      if (String(workspaceId) !== String(job.workspace_id)) {
        console.warn("reportStatusUpdate rejected: workspace mismatch", {
          jobId,
          callbackWorkspaceId: workspaceId,
          expectedWorkspaceId: job.workspace_id,
        });
        return res.status(409).json({ message: "Workspace mismatch for callback" });
      }
      if (String(domainId) !== String(job.tenant_id)) {
        console.warn("reportStatusUpdate rejected: tenant mismatch", {
          jobId,
          callbackDomainId: domainId,
          expectedTenantId: job.tenant_id,
        });
        return res.status(409).json({ message: "Tenant mismatch for callback" });
      }

      const canonicalOutputUrls =
        (output_urls &&
        typeof output_urls === "object" &&
        !Array.isArray(output_urls) &&
        Object.keys(output_urls).length > 0
          ? output_urls
          : undefined) ||
        (outputUrls &&
        typeof outputUrls === "object" &&
        !Array.isArray(outputUrls) &&
        Object.keys(outputUrls).length > 0
          ? outputUrls
          : undefined) ||
        (result?.output_urls &&
        typeof result.output_urls === "object" &&
        !Array.isArray(result.output_urls) &&
        Object.keys(result.output_urls).length > 0
          ? result.output_urls
          : undefined);

      const lifecycle = await applyCanonicalInternalJobStatusUpdate({
        job_id: jobId,
        tenant_id: String(job.tenant_id),
        status: mappedStatus,
        current_stage: "comparison_callback",
        output_urls: canonicalOutputUrls,
        error_message: typeof error === "string" ? error : error?.message,
      });
      if (lifecycle.statusCode !== 200) {
        return res.status(lifecycle.statusCode).json(lifecycle.body);
      }
      if (!lifecycle.changed) {
        return res.status(lifecycle.statusCode).json(lifecycle.body);
      }
      const canonicalJob = lifecycle.job;

      const eventData = { jobId, status: canonicalJob?.status || mappedStatus, error };
      try {
        await emitToWorkspace(job.workspace_id, "compare_status", eventData);
      } catch (emitError: any) {
        console.error("reportStatusUpdate emit failure", {
          jobId,
          workspaceId: job.workspace_id,
          tenantId: job.tenant_id,
          error: emitError?.message || String(emitError),
        });
        return res.status(500).json({
          message: "Status persisted but realtime emit failed",
          code: "REPORT_EMIT_FAILED",
          jobId,
        });
      }
      res
        .status(200)
        .json({ message: "Status update emitted", jobId, status: mappedStatus, error });
    } catch (err) {
      res.status(500).json({
        message: "Failed to emit status update",
        error: err instanceof Error ? err.message : err,
      });
    }
  },


  // Download DOCX generated from HTML content by report ID
  async downloadDocx(req: AuthRequest, res: Response) {
    try {
      const { id } = req.params;
      const currentWorkspace = req.currentWorkspace || req.userDomain;
      const report = await Report.findOne({
        id,
        workspaceId: currentWorkspace,
        domain: req.userDomain,
      });
      if (!report || !report.content) {
        return res.status(404).json({ error: "Report not found" });
      }

      const normalizedTitle = (report.title || "report")
        .replace(/\.pdf$/i, "")
        .replace(/\.docx$/i, "")
        .replace(/[^a-z0-9._-]/gi, "_");
      const { buffer: docxBuffer, engine } = await generateDocxBuffer(
        report.content,
        "html"
      );
      console.log(`Report DOCX generated with engine: ${engine}`);

      // Send DOCX file
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      );
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${normalizedTitle}.docx"`
      );
      res.send(docxBuffer);
    } catch (error) {
      console.error("Error generating DOCX:", error);
      res.status(500).json({ error: "Failed to generate DOCX" });
    }
  },



  async update(req: AuthRequest, res: Response) {
    try {
      const { id } = req.params;
      const currentWorkspace = req.currentWorkspace || req.userDomain;
      const query: any = {
        id,
        domain: req.userDomain, // Ensure user can only update reports from their domain
        workspaceId: currentWorkspace,
      };

      // All workspace members can update reports in their workspace
      // No user-based filtering needed - workspace isolation is sufficient

      const report = await Report.findOneAndUpdate(query, req.body, {
        new: true,
      });
      if (!report) {
        return res.status(404).json({ error: "Report not found" });
      }
      res.json(report);
    } catch (error) {
      console.error("Error updating report:", error);
      res.status(500).json({ error: "Failed to update report" });
    }
  },

  async delete(req: AuthRequest, res: Response) {
    try {
      const currentWorkspace = req.currentWorkspace || req.userDomain;
      const query: any = {
        id: req.params.id,
        domain: req.userDomain, // Ensure user can only delete reports from their domain
        workspaceId: currentWorkspace,
      };

      // Admins can delete all reports in their domain, regular users see only their own
      if (req.user.role !== "admin") {
        if (req.user.microsoftId) {
          query.microsoftId = req.user.microsoftId;
        } else if (req.user._id) {
          query.userId = req.user._id.toString();
        } else {
          return res.status(400).json({ error: "No user identifier found" });
        }
      }

      const report = await Report.findOne(query);
      if (!report) {
        return res.status(404).json({ error: "Report not found" });
      }

      await report.deleteOne();
      await publishEvent({
        actorUserId: req.user?._id?.toString?.(),
        domain: req.userDomain!,
        action: "report.deleted",
        resourceType: "report",
        resourceId: report.id,
        title: `Report deleted: ${report.title || report.id}`,
        notifyWorkspace: true,
      });
      res.json({ message: "Report deleted successfully" });
    } catch (error) {
      console.error("Error deleting report:", error);
      res.status(500).json({ error: "Failed to delete report" });
    }
  },

  async downloadPdfFromHtml(req: AuthRequest, res: Response) {
    try {
      const { id } = req.params;
      const currentWorkspace = req.currentWorkspace || req.userDomain;
      const report = await Report.findOne({
        id,
        workspaceId: currentWorkspace,
        domain: req.userDomain,
      });
      if (!report || !report.content) {
        return res.status(404).json({ error: "Report not found" });
      }

      // Call PDF.co API to generate PDF from HTML
      try {
        const pdfcoResponse = await axios.post(
          "https://api.pdf.co/v1/pdf/convert/from/html",
          {
            html: report.content,
            name: `${report.title || "report"}.pdf`,
            allowAbsoluteUrls: true,
          },
          {
            headers: {
              "x-api-key": process.env.PDFCO_API_KEY,
              "Content-Type": "application/json",
            },
          }
        );

        if (!pdfcoResponse.data || !pdfcoResponse.data.url) {
          // Check if PDF.co returned an error in the response
          if (pdfcoResponse.data?.error || pdfcoResponse.data?.status === 402) {
            const errorMsg = pdfcoResponse.data?.message || "PDF.co API error: Insufficient credits or service unavailable";
            console.error("PDF.co API error:", pdfcoResponse.data);
            return res.status(503).json({
              error: "PDF generation service temporarily unavailable",
              message: errorMsg,
              details: "The PDF generation service is currently unavailable. Please try again later or contact support."
            });
          }
          throw new Error("PDF.co did not return a PDF URL");
        }

        // Download the generated PDF and stream to client
        const pdfStream = await axios.get(pdfcoResponse.data.url, {
          responseType: "stream",
        });

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename=\"${report.title || "report"}.pdf\"`
        );
        pdfStream.data.pipe(res);
      } catch (pdfcoError: any) {
        // Handle PDF.co specific errors
        if (pdfcoError.response?.status === 402) {
          const errorData = pdfcoError.response?.data || {};
          console.error("PDF.co API error (402):", errorData);
          return res.status(503).json({
            error: "PDF generation service unavailable",
            message: errorData.message || "Insufficient credits for PDF generation",
            details: "The PDF generation service requires additional credits. Please contact support or try again later."
          });
        }
        if (pdfcoError.response?.status) {
          const errorData = pdfcoError.response?.data || {};
          console.error(`PDF.co API error (${pdfcoError.response.status}):`, errorData);
          return res.status(503).json({
            error: "PDF generation service error",
            message: errorData.message || "PDF generation failed",
            details: "The PDF generation service encountered an error. Please try again later."
          });
        }
        throw pdfcoError; // Re-throw if it's not a PDF.co response error
      }
    } catch (error: any) {
      console.error("Error generating PDF with PDF.co:", error);

      // Check if response was already sent
      if (res.headersSent) {
        return;
      }

      // Return proper error response
      res.status(500).json({
        error: "Failed to generate PDF",
        message: error.message || "An unexpected error occurred",
        details: "Please try again later or contact support if the problem persists."
      });
    }
  },

  // Admin: Get all reports across all workspaces in domain
  async getAllAdmin(req: AuthRequest, res: Response) {
    try {
      const user = req.user;
      if (!user || user.role !== "admin") {
        return res.status(403).json({ error: "Admin access required" });
      }

      const query: any = {
        domain: req.user?.domain || req.userDomain, // Use user's actual domain for admin
      };

      const { limit, offset } = parsePagination(req.query);
      const reports = await Report.find(query)
        .sort({ updatedAt: -1 })
        .skip(offset)
        .limit(limit)
        .select(
          "id title updatedAt drhpId rhpId drhpNamespace rhpNamespace domain domainId workspaceId microsoftId userId"
        )
        .lean();

      // Get all workspaces to map workspaceId to workspace name
      const { Workspace } = await import("../models/Workspace");
      const workspaceIds = Array.from(new Set(reports.map((r: any) => r.workspaceId).filter(Boolean)));
      const workspaces = await Workspace.find({
        domain: req.user?.domain || req.userDomain,
        workspaceId: { $in: workspaceIds },
      }).select("workspaceId name slug").lean();
      const workspaceMap = new Map(workspaces.map(ws => [ws.workspaceId, { workspaceId: ws.workspaceId, name: ws.name, slug: ws.slug }]));

      // Add workspace information to each report
      const reportsWithWorkspace = reports.map(report => {
        const reportObj: any = report;
        const wsData = workspaceMap.get(reportObj.workspaceId);
        
        return {
          ...reportObj,
          workspaceId: wsData || { 
            workspaceId: reportObj.workspaceId, 
            name: 'Excollo', 
            slug: 'unknown' 
          }
        };
      });

      res.json(reportsWithWorkspace);
    } catch (error) {
      console.error("Error fetching admin reports:", error);
      res.status(500).json({ error: "Failed to fetch reports" });
    }
  },
};
