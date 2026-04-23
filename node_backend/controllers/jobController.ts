import { Request, Response } from "express";
import { Job } from "../models/Job";
import { SectionResult } from "../models/SectionResult";
import { AdverseFinding } from "../models/AdverseFinding";
import { SopConfig } from "../models/SopConfig";
import axios from "axios";
import crypto from "crypto";
import { jobAdmissionService } from "../services/jobAdmissionService";
import { metricsService } from "../services/metricsService";
import { brokerQueueTelemetryService } from "../services/brokerQueueTelemetryService";
import { realtimeEventControlService } from "../services/realtimeEventControlService";
import { cacheService } from "../services/cacheService";
import { idempotencyLockService } from "../services/idempotencyLockService";
import { applyCanonicalInternalJobStatusUpdate } from "../services/jobLifecycleService";
import { buildSignedInternalJsonRequest } from "../services/internalRequestSigning";

const PYTHON_API_URL = process.env.PYTHON_API_URL || "http://localhost:8000";
const JOB_CACHE_TTL_SECONDS = Number(process.env.JOB_CACHE_TTL_SECONDS || "15");
const getJobCacheKey = (tenantId: string, jobId: string) => `job:status:${tenantId}:${jobId}`;

interface AuthRequest extends Request {
  user?: any;
  userDomain?: string;
  currentWorkspace?: string;
  tenantId?: string;
  tenantQuery: () => { tenant_id: string };
}

/**
 * Job Controller — create jobs, dispatch to Python, track status, get results.
 * All queries use req.tenantQuery() for mandatory tenant isolation.
 */

// POST /api/jobs — Create a new processing job and dispatch to Python
export const createJob = async (req: AuthRequest, res: Response) => {
  try {
    const { 
      document_name, 
      s3_input_key, 
      sop_config_id, 
      workspace_id,
      directoryId,
      drhpId,
      rhpId,
      title
    } = req.body;

    // Determine job type: if drhpId and rhpId are present, it's a comparison job
    const isComparison = !!(drhpId && rhpId);

    if (!isComparison && (!document_name || !s3_input_key)) {
      return res.status(400).json({
        error: "document_name and s3_input_key are required for extraction jobs",
        code: "INVALID_JOB_BODY",
      });
    }

    // Import Document model for resolving namespaces in comparison jobs
    const { Document } = await import("../models/Document");

    // Resolve SOP config
    let resolvedSopConfigId = sop_config_id;
    if (!resolvedSopConfigId) {
      const activeConfig = await SopConfig.findOne({
        ...req.tenantQuery(),
        is_active: true,
      }).select("id").lean();
      if (activeConfig) resolvedSopConfigId = activeConfig.id;
    }

    const userId = (req as any).user?._id?.toString() || "anonymous";
    const operationType = isComparison ? "comparison" : "extraction";
    const normalizedDocumentName = String(document_name || "").trim().toLowerCase();
    const clientRequestId = String((req.body as any)?.request_id || (req.body as any)?.requestId || "")
      .trim()
      .toLowerCase();
    const stableOperationIdentity = isComparison
      ? `${String(drhpId || "").trim()}:${String(rhpId || "").trim()}`
      : `${clientRequestId || normalizedDocumentName}:${String(directoryId || "")}`;
    const idempotency_key = crypto
      .createHash("sha256")
      .update(
        [
          String(req.tenantId || ""),
          String(workspace_id || (req as any).currentWorkspace || ""),
          userId,
          operationType,
          stableOperationIdentity,
        ].join(":")
      )
      .digest("hex");

    const idempotencyOwner = crypto.randomUUID();

    const queueName = isComparison ? "light_jobs" : "heavy_jobs";
    const admission = await jobAdmissionService.check(req.tenantId!, queueName);
    if (admission.telemetryStatus === "UNAVAILABLE") {
      metricsService.emit("telemetry_unavailable", 1, {
        tenant_id: req.tenantId!,
        queue_name: queueName,
      });
    }
    metricsService.emit("queue_depth", admission.queueDepth, { tenant_id: req.tenantId!, queue_name: queueName });
    metricsService.emit("queue_age_seconds", admission.queueAgeSeconds, { tenant_id: req.tenantId!, queue_name: queueName });
    if (jobAdmissionService.shouldWarnQueueAge(admission.queueAgeSeconds)) {
      console.warn(
        JSON.stringify({
          event: "queue_age_threshold_exceeded",
          tenant_id: req.tenantId,
          queue_name: queueName,
          queue_age_seconds: admission.queueAgeSeconds,
        })
      );
    }
    if (!admission.allow) {
      return res.status(429).json({
        error: "Queue overloaded, retry later",
        code: admission.reason || "QUEUE_OVERLOADED",
      });
    }
    const lock = await idempotencyLockService.acquire({
      tenantId: String(req.tenantId),
      idempotencyKey: idempotency_key,
      ownerId: idempotencyOwner,
    });
    if (!lock.acquired) {
      if (lock.existingJob) {
        return res.status(200).json({
          data: { id: lock.existingJob.id, status: lock.existingJob.status, idempotent: true },
        });
      }
      return res.status(202).json({
        data: {
          id: null,
          status: "queued",
          idempotent: true,
          pending: true,
          retry_after_seconds: lock.retryAfterSeconds,
        },
      });
    }
    metricsService.emit("backpressure_state", admission.loadState === "healthy" ? 0 : admission.loadState === "degraded" ? 1 : 2, {
      tenant_id: req.tenantId!,
      queue_name: queueName,
      load_state: admission.loadState,
      decision: admission.status,
    });

    // Prepare job record
    const jobData: any = {
      tenant_id: req.tenantId,
      sop_config_id: resolvedSopConfigId || null,
      workspace_id: workspace_id || (req as any).currentWorkspace || null,
      created_by: userId,
      status: admission.status,
      job_type: isComparison ? "comparison" : "extraction",
      idempotency_key,
      trace_id: null,
      queue_name: queueName,
      queued_with_delay: admission.status === "queued_with_delay",
    };

    let drhpDoc: any = null;
    let rhpDoc: any = null;

    if (isComparison) {
      if (!jobData.workspace_id) {
        return res.status(400).json({
          error: "workspace_id is required for comparison jobs",
          code: "WORKSPACE_REQUIRED",
        });
      }

      const scopedDocumentQuery = {
        workspaceId: String(jobData.workspace_id),
        domainId: String(req.tenantId),
      };
      drhpDoc = await Document.findOne({ id: drhpId, ...scopedDocumentQuery }).lean();
      rhpDoc = await Document.findOne({ id: rhpId, ...scopedDocumentQuery }).lean();

      if (!drhpDoc || !rhpDoc) {
        const tenantScopedDrhp = await Document.findOne({
          id: drhpId,
          domainId: String(req.tenantId),
        })
          .select("id workspaceId")
          .lean();
        const tenantScopedRhp = await Document.findOne({
          id: rhpId,
          domainId: String(req.tenantId),
        })
          .select("id workspaceId")
          .lean();
        const hasWorkspaceMismatch =
          (!!tenantScopedDrhp && String(tenantScopedDrhp.workspaceId) !== String(jobData.workspace_id)) ||
          (!!tenantScopedRhp && String(tenantScopedRhp.workspaceId) !== String(jobData.workspace_id));
        if (hasWorkspaceMismatch) {
          return res.status(409).json({
            error: "Comparison documents must belong to the active workspace scope",
            code: "DOCUMENT_SCOPE_MISMATCH",
          });
        }
      }

      if (!drhpDoc || !rhpDoc) {
        return res.status(404).json({
          error: "One or both documents not found for comparison",
          code: "DOCUMENTS_NOT_FOUND",
        });
      }

      jobData.drhp_id = drhpId;
      jobData.rhp_id = rhpId;
      jobData.directory_id = directoryId || drhpDoc.directoryId;
      jobData.title = title || `${drhpDoc.name} vs ${rhpDoc.name} Intelligence Report`;
    } else {
      jobData.document_name = document_name;
      jobData.s3_input_key = s3_input_key;
      jobData.s3_output_prefix = `${req.tenantId}/${Date.now()}/`;
      jobData.directory_id = directoryId || null;
    }

    // Create the job in MongoDB
    const job = await Job.create(jobData);
    await idempotencyLockService.bindJob({
      tenantId: String(req.tenantId),
      idempotencyKey: idempotency_key,
      ownerId: idempotencyOwner,
      jobId: String(job.id),
    });
    job.trace_id = job.id;
    await job.save();

    // Dispatch to Python
    try {
      let dispatchUrl = `${PYTHON_API_URL}/jobs/pipeline`;
      let payload: any = {
        job_id: job.id,
        tenant_id: req.tenantId,
        sop_config_id: resolvedSopConfigId || null,
        trace_id: job.id,
        queue_name: queueName,
      };

      if (isComparison) {
        dispatchUrl = `${PYTHON_API_URL}/jobs/comparison`;
        payload = {
          ...payload,
          drhpNamespace: drhpDoc.namespace,
          rhpNamespace: rhpDoc.namespace || rhpDoc.rhpNamespace,
          drhpDocumentId: drhpId,
          rhpDocumentId: rhpId,
          sessionId: job.id,
          domain: req.userDomain || (req as any).user?.domain || null,
          domainId: req.tenantId,
          authorization: req.headers.authorization,
          metadata: {
            title: jobData.title,
            workspaceId: jobData.workspace_id,
            directoryId: jobData.directory_id,
          }
        };
      } else {
        payload.document_name = jobData.document_name;
        payload.s3_input_key = jobData.s3_input_key;
      }

      const signed = buildSignedInternalJsonRequest("POST", dispatchUrl, payload, {
        "X-Trace-Id": job.id,
      });
      const pythonResponse = await axios.post(dispatchUrl, signed.data, {
        headers: signed.headers,
        timeout: 15000,
      });

      if (pythonResponse.data?.job_id || pythonResponse.data?.celery_task_id) {
        job.celery_task_id = pythonResponse.data.celery_task_id || pythonResponse.data.job_id;
        await job.save();
      }

      await metricsService.emitQueueMetrics(req.tenantId!, queueName);
      await brokerQueueTelemetryService.emitBrokerQueueMetrics();
    } catch (dispatchError: any) {
      console.error("Pipeline dispatch error:", dispatchError.message);
      job.status = "failed";
      job.error_message = `Failed to dispatch to pipeline: ${dispatchError.message}`;
      await job.save();

      return res.status(502).json({
        error: "Failed to dispatch job to processing pipeline",
        code: "DISPATCH_FAILED",
        job_id: job.id,
      });
    }

    return res.status(201).json({ data: { id: job.id, status: job.status } });
  } catch (error: any) {
    console.error("createJob error:", error);
    return res.status(500).json({
      error: "Failed to create job",
      code: "CREATE_JOB_FAILED",
      details: error.message
    });
  }
};

// GET /api/jobs — List jobs for current tenant
export const listJobs = async (req: AuthRequest, res: Response) => {
  try {
    const { status, workspace_id, directoryId, limit = "100", offset = "0" } = req.query;

    const filter: Record<string, any> = { ...req.tenantQuery() };
    if (status) filter.status = status;
    if (workspace_id) filter.workspace_id = workspace_id;
    if (directoryId) filter.directory_id = directoryId;

    const jobs = await Job.find(filter)
      .sort({ createdAt: -1 })
      .skip(Number(offset))
      .limit(Math.min(Number(limit), 500))
      .lean();

    const total = await Job.countDocuments(filter);

    return res.json({ data: jobs, total, limit: Number(limit), offset: Number(offset) });
  } catch (error: any) {
    console.error("listJobs error:", error);
    return res.status(500).json({
      error: "Failed to list jobs",
      code: "LIST_JOBS_FAILED",
    });
  }
};

// GET /api/jobs/:id — Get a single job with its section results
export const getJob = async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.tenantQuery().tenant_id;
    const cacheKey = getJobCacheKey(tenantId, req.params.id);
    const cached = await cacheService.getJson<any>(cacheKey);
    if (cached) {
      return res.json(cached);
    }
    const job = await Job.findOne({
      ...req.tenantQuery(),
      id: req.params.id,
    }).lean();

    if (!job) {
      return res.status(404).json({ error: "Job not found", code: "JOB_NOT_FOUND" });
    }

    // Get section results for this job
    const sectionResults = await SectionResult.find({
      ...req.tenantQuery(),
      job_id: job.id,
    })
      .sort({ "section_id": 1 })
      .lean();

    // Get adverse findings
    const adverseFindings = await AdverseFinding.find({
      ...req.tenantQuery(),
      job_id: job.id,
    }).lean();

    const response = {
      data: {
        ...job,
        section_results: sectionResults,
        adverse_findings: adverseFindings,
      },
    };
    await cacheService.setJson(cacheKey, response, JOB_CACHE_TTL_SECONDS);
    return res.json(response);
  } catch (error: any) {
    console.error("getJob error:", error);
    return res.status(500).json({
      error: "Failed to get job",
      code: "GET_JOB_FAILED",
    });
  }
};

// ═══════════════════════════════════════════════════════════════
// INTERNAL ENDPOINTS — Called by Python pipeline (requireInternalSecret)
// ═══════════════════════════════════════════════════════════════

// POST /api/jobs/internal/status — Update job status from pipeline
export const updateJobStatus = async (req: AuthRequest, res: Response) => {
  try {
    const { job_id, tenant_id, retry_count } = req.body;
    const lifecycle = await applyCanonicalInternalJobStatusUpdate(req.body);
    if (lifecycle.statusCode !== 200) {
      return res.status(lifecycle.statusCode).json(lifecycle.body);
    }
    if (!lifecycle.changed) {
      return res.status(lifecycle.statusCode).json(lifecycle.body);
    }
    const job = lifecycle.job;
    if (retry_count !== undefined) {
      metricsService.emit("retry_count", Number(retry_count) || 0, { job_id, tenant_id });
    }
    if (job.queue_name) {
      await metricsService.emitQueueMetrics(tenant_id, job.queue_name);
    }
    await brokerQueueTelemetryService.emitBrokerQueueMetrics();

    // Emit socket event for real-time UI updates
    const { io } = await import("../index");
    if (job.job_type === "comparison") {
      const eventPayload = {
        jobId: job.id,
        status: job.status,
        progress: job.progress_pct,
        stage: job.current_stage,
        error: job.error_message,
      };
      const workspaceRoom = job.workspace_id ? `workspace_${job.workspace_id}` : null;
      const shouldEmit =
        !!workspaceRoom &&
        (await realtimeEventControlService.shouldEmit("compare_status", workspaceRoom, eventPayload));
      if (shouldEmit) {
        io.to(`workspace_${job.workspace_id}`).emit("compare_status", eventPayload);
      }
    }

    await cacheService.del(getJobCacheKey(tenant_id, job_id));
    return res.json({ message: "Status updated", data: { id: job.id, status: job.status } });
  } catch (error: any) {
    console.error("updateJobStatus error:", error);
    return res.status(500).json({
      error: "Failed to update job status",
      code: "UPDATE_STATUS_FAILED",
    });
  }
};

// POST /api/jobs/internal/section-result — Submit a section result from pipeline
export const submitSectionResult = async (req: AuthRequest, res: Response) => {
  try {
    const {
      job_id,
      tenant_id,
      workspace_id,
      domain_id,
      section_id,
      status,
      markdown,
      raw_json,
      tables,
      screenshots,
      gpt_model,
      gpt_input_tokens,
      gpt_output_tokens,
      duration_ms,
      sop_compliance_score,
      sop_compliance_notes,
      error_message,
    } = req.body;

    if (!job_id || !tenant_id || !workspace_id || !domain_id || !section_id) {
      return res.status(400).json({
        error: "job_id, tenant_id, workspace_id, domain_id, and section_id are required",
        code: "INVALID_SECTION_RESULT_BODY",
      });
    }
    if (String(domain_id) !== String(tenant_id)) {
      return res.status(409).json({
        error: "Domain and tenant scope mismatch",
        code: "JOB_SCOPE_MISMATCH",
      });
    }
    const job = await Job.findOne({
      id: job_id,
      tenant_id,
      workspace_id: String(workspace_id),
    })
      .select("id tenant_id workspace_id")
      .lean();
    if (!job) {
      return res.status(404).json({
        error: "Job not found for tenant scope",
        code: "JOB_SCOPE_NOT_FOUND",
      });
    }

    let result: any;
    try {
      result = await SectionResult.findOneAndUpdate(
        { job_id, tenant_id, section_id },
        {
          $set: {
            status: status || "completed",
            markdown,
            raw_json,
            tables: tables || [],
            screenshots: screenshots || [],
            gpt_model,
            gpt_input_tokens: gpt_input_tokens || 0,
            gpt_output_tokens: gpt_output_tokens || 0,
            duration_ms: duration_ms || 0,
            sop_compliance_score,
            sop_compliance_notes,
            error_message,
          },
          $setOnInsert: {
            tenant_id,
            job_id,
            section_id,
          },
        },
        { upsert: true, new: true }
      );
    } catch (error: any) {
      if (error?.code === 11000) {
        const duplicate = await SectionResult.findOne({ job_id, tenant_id, section_id }).lean();
        return res.json({
          message: "Duplicate section result ignored",
          data: { id: duplicate?.id || null, section_id, status: duplicate?.status || status || "completed" },
        });
      }
      throw error;
    }

    await cacheService.del(getJobCacheKey(tenant_id, job_id));
    return res.json({
      message: "Section result saved",
      data: { id: result.id, section_id, status: result.status },
    });
  } catch (error: any) {
    console.error("submitSectionResult error:", error);
    return res.status(500).json({
      error: "Failed to submit section result",
      code: "SUBMIT_SECTION_RESULT_FAILED",
    });
  }
};

// POST /api/jobs/internal/adverse-finding — Submit an adverse finding from pipeline
export const submitAdverseFinding = async (req: AuthRequest, res: Response) => {
  try {
    const finding = req.body;

    if (
      !finding.job_id ||
      !finding.tenant_id ||
      !finding.workspace_id ||
      !finding.domain_id ||
      !finding.title
    ) {
      return res.status(400).json({
        error: "job_id, tenant_id, workspace_id, domain_id, and title are required",
        code: "INVALID_FINDING_BODY",
      });
    }
    if (String(finding.domain_id) !== String(finding.tenant_id)) {
      return res.status(409).json({
        error: "Domain and tenant scope mismatch",
        code: "JOB_SCOPE_MISMATCH",
      });
    }
    const job = await Job.findOne({
      id: finding.job_id,
      tenant_id: finding.tenant_id,
      workspace_id: String(finding.workspace_id),
    })
      .select("id tenant_id workspace_id")
      .lean();
    if (!job) {
      return res.status(404).json({
        error: "Job not found for tenant scope",
        code: "JOB_SCOPE_NOT_FOUND",
      });
    }

    const dedupeKey = crypto
      .createHash("sha256")
      .update(
        `${finding.tenant_id || ""}:${finding.job_id || ""}:${finding.title || ""}:${finding.source_url || ""}:${finding.entity_name || ""}`
      )
      .digest("hex");
    finding.dedupe_key = dedupeKey;
    let created: any;
    try {
      created = await AdverseFinding.findOneAndUpdate(
        { tenant_id: finding.tenant_id, job_id: finding.job_id, dedupe_key: dedupeKey },
        { $setOnInsert: finding },
        { new: true, upsert: true }
      );
    } catch (error: any) {
      if (error?.code === 11000) {
        const existing = await AdverseFinding.findOne({
          tenant_id: finding.tenant_id,
          job_id: finding.job_id,
          dedupe_key: dedupeKey,
        }).lean();
        return res.status(200).json({
          message: "Duplicate adverse finding ignored",
          data: { id: existing?.id || null },
        });
      }
      throw error;
    }

    await cacheService.del(getJobCacheKey(finding.tenant_id, finding.job_id));
    return res.status(201).json({
      message: "Adverse finding saved",
      data: { id: created.id },
    });
  } catch (error: any) {
    console.error("submitAdverseFinding error:", error);
    return res.status(500).json({
      error: "Failed to submit adverse finding",
      code: "SUBMIT_FINDING_FAILED",
    });
  }
};

// DELETE /api/jobs/:id — Delete a job and its associated results
export const deleteJob = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const job = await Job.findOne({
      id,
      ...req.tenantQuery(),
    });

    if (!job) {
      return res.status(404).json({
        error: "Job not found",
        code: "JOB_NOT_FOUND",
      });
    }

    // Delete job, section results, and adverse findings
    // We use the same isolation for cleanup
    const tenantFilter = req.tenantQuery();
    await Job.deleteOne({ id, ...tenantFilter });
    await SectionResult.deleteMany({ job_id: id, ...tenantFilter });
    await AdverseFinding.deleteMany({ job_id: id, ...tenantFilter });

    await cacheService.del(getJobCacheKey(String(job.tenant_id), id));
    return res.json({
      message: "Job deleted successfully",
      data: { id },
    });
  } catch (error: any) {
    console.error("deleteJob error:", error);
    return res.status(500).json({
      error: "Failed to delete job",
      code: "DELETE_JOB_FAILED",
    });
  }
};

export const getBrokerQueueHealth = async (_req: AuthRequest, res: Response) => {
  try {
    const snapshot = await brokerQueueTelemetryService.emitBrokerQueueMetrics();
    return res.json({ data: snapshot });
  } catch (error: any) {
    return res.status(500).json({
      error: "Failed to get broker queue health",
      code: "BROKER_QUEUE_HEALTH_FAILED",
      details: error?.message,
    });
  }
};
