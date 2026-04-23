import crypto from "crypto";
import { Job } from "../models/Job";
import { cacheService } from "./cacheService";

const TERMINAL_JOB_STATUSES = new Set(["completed", "completed_with_errors", "failed"]);
const STAGE_ORDER = [
  "initialization",
  "preparation",
  "ingestion",
  "chunking",
  "extracting_sections",
  "extracting",
  "embedding",
  "vector_upsert",
  "running_adverse_research",
  "summary",
  "output_assembly",
  "upload",
  "comparison",
  "document_callback",
  "comparison_callback",
  "summary_callback",
  "completed_with_errors",
  "completed",
  "failed",
];
const STAGE_RANK = new Map(STAGE_ORDER.map((stage, index) => [stage, index]));
const getJobCacheKey = (tenantId: string, jobId: string) => `job:status:${tenantId}:${jobId}`;

function hasCanonicalOutputEvidence(incomingOutputUrls: unknown, existingOutputUrls: unknown): boolean {
  const hasNonEmptyObject = (value: unknown) =>
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value as Record<string, unknown>).length > 0;
  return hasNonEmptyObject(incomingOutputUrls) || hasNonEmptyObject(existingOutputUrls);
}

function normalizeStage(stage?: string | null): string | null {
  if (!stage) return null;
  const s = String(stage).toLowerCase();
  if (s.startsWith("extracting:")) return "extracting";
  if (s.startsWith("extracting_")) return "extracting";
  return s;
}

function stageRank(stage?: string | null): number {
  const normalized = normalizeStage(stage);
  if (!normalized) return -1;
  return STAGE_RANK.has(normalized) ? Number(STAGE_RANK.get(normalized)) : -1;
}

function maxObservedStageRank(job: any): number {
  const fromCurrent = stageRank(job?.current_stage || null);
  const fromStages = Array.isArray(job?.stages)
    ? job.stages.reduce((max: number, stage: any) => Math.max(max, stageRank(stage?.stage_name || null)), -1)
    : -1;
  return Math.max(fromCurrent, fromStages);
}

export type CanonicalStatusUpdateInput = {
  job_id: string;
  tenant_id: string;
  status?: string;
  progress_pct?: number;
  current_stage?: string;
  error_message?: string;
  output_urls?: unknown;
  retry_count?: number;
  stage_event?: any;
};

export type CanonicalStatusUpdateResult = {
  statusCode: number;
  body: any;
  job?: any;
  changed: boolean;
};

export async function applyCanonicalInternalJobStatusUpdate(
  input: CanonicalStatusUpdateInput
): Promise<CanonicalStatusUpdateResult> {
  const resolveQuery = async (query: any) => {
    if (query && typeof query.lean === "function") {
      return query.lean();
    }
    return query;
  };
  const {
    job_id,
    tenant_id,
    status,
    progress_pct,
    current_stage,
    error_message,
    output_urls,
    retry_count,
    stage_event,
  } = input;

  if (!job_id || !tenant_id) {
    return {
      statusCode: 400,
      body: { error: "job_id and tenant_id are required", code: "INVALID_STATUS_BODY" },
      changed: false,
    };
  }

  const allowedStatuses = new Set([
    "queued",
    "queued_with_delay",
    "processing",
    "completed",
    "completed_with_errors",
    "failed",
  ]);
  const normalizedStatus =
    typeof status === "string" && status.toLowerCase() === "success" ? "completed" : status;
  if (normalizedStatus && !allowedStatuses.has(normalizedStatus)) {
    return {
      statusCode: 400,
      body: { error: "Invalid status value", code: "INVALID_STATUS_VALUE" },
      changed: false,
    };
  }

  const existingJob = await resolveQuery(Job.findOne({ id: job_id, tenant_id }));
  if (!existingJob) {
    return {
      statusCode: 404,
      body: { error: "Job not found", code: "JOB_NOT_FOUND" },
      changed: false,
    };
  }

  const isTerminal = TERMINAL_JOB_STATUSES.has(existingJob.status);
  const incomingIsTerminal = !!normalizedStatus && TERMINAL_JOB_STATUSES.has(normalizedStatus);
  const outputMatchesExisting =
    output_urls === undefined ||
    JSON.stringify(output_urls) === JSON.stringify((existingJob as any).output_urls ?? null);
  const errorMatchesExisting =
    error_message === undefined || error_message === (existingJob as any).error_message;
  const duplicateTerminalUpdate =
    isTerminal &&
    normalizedStatus &&
    normalizedStatus === existingJob.status &&
    !stage_event &&
    (progress_pct === undefined || progress_pct === existingJob.progress_pct) &&
    (current_stage === undefined || current_stage === existingJob.current_stage) &&
    outputMatchesExisting &&
    errorMatchesExisting;
  if (duplicateTerminalUpdate) {
    return {
      statusCode: 200,
      body: { message: "Duplicate status ignored", data: { id: existingJob.id, status: existingJob.status } },
      job: existingJob,
      changed: false,
    };
  }
  if (isTerminal) {
    return {
      statusCode: 409,
      body: {
        error: incomingIsTerminal
          ? "Terminal job status cannot change to a different terminal state"
          : "Terminal job status cannot transition to non-terminal state",
        code: "TERMINAL_STATE_IMMUTABLE",
      },
      changed: false,
    };
  }

  const observedStageRank = maxObservedStageRank(existingJob);
  const incomingStageRank = stageRank(current_stage);
  const incomingStageEventRank = stageRank(stage_event?.stage_name || null);
  if (
    progress_pct !== undefined &&
    Number.isFinite(Number(progress_pct)) &&
    Number(progress_pct) < Number(existingJob.progress_pct || 0)
  ) {
    return {
      statusCode: 202,
      body: { message: "Stale progress update ignored", data: { id: existingJob.id, status: existingJob.status } },
      job: existingJob,
      changed: false,
    };
  }
  if (incomingStageRank >= 0 && observedStageRank >= 0 && incomingStageRank < observedStageRank && !incomingIsTerminal) {
    return {
      statusCode: 202,
      body: { message: "Stale stage update ignored", data: { id: existingJob.id, status: existingJob.status } },
      job: existingJob,
      changed: false,
    };
  }

  if (
    normalizedStatus &&
    (normalizedStatus === "completed" || normalizedStatus === "completed_with_errors") &&
    !hasCanonicalOutputEvidence(output_urls, (existingJob as any).output_urls)
  ) {
    return {
      statusCode: 400,
      body: {
        error: "Canonical output evidence is required before marking a job completed",
        code: "MISSING_OUTPUT_EVIDENCE",
      },
      changed: false,
    };
  }

  const updateFields: Record<string, any> = {};
  if (normalizedStatus) updateFields.status = normalizedStatus;
  if (progress_pct !== undefined) updateFields.progress_pct = Number(progress_pct);
  if (
    current_stage &&
    !(incomingStageRank >= 0 && observedStageRank >= 0 && incomingStageRank < observedStageRank && !incomingIsTerminal)
  ) {
    updateFields.current_stage = current_stage;
  }
  if (error_message) updateFields.error_message = error_message;
  if (error_message) updateFields.error_reason = error_message;
  if (output_urls) updateFields.output_urls = output_urls;
  if (retry_count !== undefined) updateFields.retry_count = Number(retry_count) || 0;
  if (normalizedStatus === "processing") updateFields.started_at = new Date();
  if (normalizedStatus === "completed" || normalizedStatus === "completed_with_errors") {
    updateFields.completed_at = new Date();
  }

  let stagePush: any = null;
  let stageEventKey: string | null = null;
  if (
    stage_event?.stage_name &&
    !(incomingStageEventRank >= 0 && observedStageRank >= 0 && incomingStageEventRank < observedStageRank && !incomingIsTerminal)
  ) {
    stageEventKey = crypto
      .createHash("sha256")
      .update(
        `${job_id}:${stage_event.stage_name}:${stage_event.status || "success"}:${stage_event.start_time || ""}:${stage_event.end_time || ""}:${stage_event.error_reason || ""}`
      )
      .digest("hex");
    const alreadyHasStage =
      Array.isArray(existingJob.stages) &&
      existingJob.stages.some((s: any) => s?.stage_event_key && s.stage_event_key === stageEventKey);
    if (!alreadyHasStage) {
      const safeDuration =
        stage_event.duration_ms !== undefined
          ? Number(stage_event.duration_ms)
          : stage_event.start_time && stage_event.end_time
          ? Math.max(0, new Date(stage_event.end_time).getTime() - new Date(stage_event.start_time).getTime())
          : 0;
      stagePush = {
        stages: {
          stage_name: stage_event.stage_name,
          stage_event_key: stageEventKey,
          start_time: stage_event.start_time ? new Date(stage_event.start_time) : null,
          end_time: stage_event.end_time ? new Date(stage_event.end_time) : null,
          duration_ms: safeDuration,
          status: stage_event.status || "success",
          error_reason: stage_event.error_reason || null,
        },
      };
    }
  }

  const stageFilter =
    stagePush && stageEventKey
      ? { id: job_id, tenant_id, "stages.stage_event_key": { $ne: stageEventKey } }
      : { id: job_id, tenant_id };
  const job = await Job.findOneAndUpdate(
    stageFilter,
    stagePush ? { $set: updateFields, $push: stagePush } : { $set: updateFields },
    { new: true, runValidators: true }
  );
  if (!job) {
    if (stagePush && stageEventKey) {
      const duplicate = await resolveQuery(Job.findOne({ id: job_id, tenant_id }));
      if (duplicate) {
        return {
          statusCode: 200,
          body: { message: "Duplicate stage event ignored", data: { id: duplicate.id, status: duplicate.status } },
          job: duplicate,
          changed: false,
        };
      }
    }
    return {
      statusCode: 404,
      body: { error: "Job not found", code: "JOB_NOT_FOUND" },
      changed: false,
    };
  }
  await cacheService.del(getJobCacheKey(String(tenant_id), String(job_id)));

  return {
    statusCode: 200,
    body: { message: "Status updated", data: { id: job.id, status: job.status } },
    job,
    changed: true,
  };
}
