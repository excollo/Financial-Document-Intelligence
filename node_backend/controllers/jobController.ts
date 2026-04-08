import { Request, Response } from "express";
import { Job } from "../models/Job";
import { SectionResult } from "../models/SectionResult";
import { AdverseFinding } from "../models/AdverseFinding";
import { SopConfig } from "../models/SopConfig";
import axios from "axios";

const PYTHON_API_URL = process.env["PYTHON-API-URL"] || "http://localhost:8001";
const INTERNAL_SECRET = process.env["INTERNAL-SECRET"] || "";

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

    // Prepare job record
    const jobData: any = {
      tenant_id: req.tenantId,
      sop_config_id: resolvedSopConfigId || null,
      workspace_id: workspace_id || (req as any).currentWorkspace || null,
      created_by: (req as any).user?._id?.toString() || null,
      status: "queued",
      job_type: isComparison ? "comparison" : "extraction",
    };

    let drhpDoc: any = null;
    let rhpDoc: any = null;

    if (isComparison) {
      drhpDoc = await Document.findOne({ id: drhpId }).lean();
      rhpDoc = await Document.findOne({ id: rhpId }).lean();

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

    // Dispatch to Python
    try {
      let dispatchUrl = `${PYTHON_API_URL}/jobs/pipeline`;
      let payload: any = {
        job_id: job.id,
        tenant_id: req.tenantId,
        sop_config_id: resolvedSopConfigId || null,
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

      const pythonResponse = await axios.post(dispatchUrl, payload, {
        headers: {
          "X-Internal-Secret": INTERNAL_SECRET,
          "Content-Type": "application/json",
        },
        timeout: 15000,
      });

      if (pythonResponse.data?.job_id || pythonResponse.data?.celery_task_id) {
        job.celery_task_id = pythonResponse.data.celery_task_id || pythonResponse.data.job_id;
        await job.save();
      }
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

    return res.json({
      data: {
        ...job,
        section_results: sectionResults,
        adverse_findings: adverseFindings,
      },
    });
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
    const { job_id, tenant_id, status, progress_pct, current_stage, error_message, output_urls } =
      req.body;

    if (!job_id || !tenant_id) {
      return res.status(400).json({
        error: "job_id and tenant_id are required",
        code: "INVALID_STATUS_BODY",
      });
    }

    const updateFields: Record<string, any> = {};
    if (status) updateFields.status = status;
    if (progress_pct !== undefined) updateFields.progress_pct = progress_pct;
    if (current_stage) updateFields.current_stage = current_stage;
    if (error_message) updateFields.error_message = error_message;
    if (output_urls) updateFields.output_urls = output_urls;
    if (status === "completed") updateFields.completed_at = new Date();

    const job = await Job.findOneAndUpdate(
      { id: job_id, tenant_id },
      { $set: updateFields },
      { new: true }
    );

    if (!job) {
      return res.status(404).json({ error: "Job not found", code: "JOB_NOT_FOUND" });
    }

    // Emit socket event for real-time UI updates
    const { io } = await import("../index");
    if (job.job_type === "comparison") {
      io.to(`tenant_${tenant_id}`).emit("compare_status", {
        jobId: job.id,
        status: job.status,
        progress: job.progress_pct,
        stage: job.current_stage,
        error: job.error_message,
        // If completed, the Python side should have already called the report creation,
        // but we emit here to tell the frontend to refresh reports if needed.
      });
    }

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

    if (!job_id || !tenant_id || !section_id) {
      return res.status(400).json({
        error: "job_id, tenant_id, and section_id are required",
        code: "INVALID_SECTION_RESULT_BODY",
      });
    }

    // Upsert: update existing or create new
    const result = await SectionResult.findOneAndUpdate(
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

    if (!finding.job_id || !finding.tenant_id || !finding.title) {
      return res.status(400).json({
        error: "job_id, tenant_id, and title are required",
        code: "INVALID_FINDING_BODY",
      });
    }

    const created = await AdverseFinding.create(finding);

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
