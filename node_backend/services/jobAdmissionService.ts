import { Job } from "../models/Job";
import { brokerQueueTelemetryService } from "./brokerQueueTelemetryService";

const MAX_QUEUE_DEPTH = Number(process.env.MAX_QUEUE_DEPTH || "200");
const MAX_ACTIVE_RUNNING_JOBS = Number(process.env.MAX_ACTIVE_RUNNING_JOBS || "50");
const QUEUE_AGE_WARN_SECONDS = Number(process.env.QUEUE_AGE_WARN_SECONDS || "120");
const DEGRADED_QUEUE_DEPTH = Number(process.env.DEGRADED_QUEUE_DEPTH || "120");
const OVERLOADED_QUEUE_AGE_SECONDS = Number(process.env.OVERLOADED_QUEUE_AGE_SECONDS || "300");

export interface AdmissionDecision {
  allow: boolean;
  status: "queued" | "queued_with_delay";
  loadState: "healthy" | "degraded" | "overloaded";
  telemetryStatus: "OK" | "UNAVAILABLE";
  reason?: string;
  queueDepth: number;
  activeRunning: number;
  queueAgeSeconds: number;
}

class JobAdmissionService {
  async check(tenantId: string, queueName: string): Promise<AdmissionDecision> {
    const queuedStatuses = ["queued", "queued_with_delay"];
    const [inferredDepth, activeRunning, oldestQueued, brokerSnapshot] = await Promise.all([
      Job.countDocuments({ tenant_id: tenantId, queue_name: queueName, status: { $in: queuedStatuses } }),
      Job.countDocuments({ tenant_id: tenantId, queue_name: queueName, status: "processing" }),
      Job.findOne({ tenant_id: tenantId, queue_name: queueName, status: { $in: queuedStatuses } })
        .sort({ createdAt: 1 })
        .select("createdAt")
        .lean(),
      brokerQueueTelemetryService.getQueueSnapshot(queueName as "heavy_jobs" | "light_jobs"),
    ]);

    const inferredQueueAgeSeconds = oldestQueued?.createdAt
      ? Math.max(0, Math.floor((Date.now() - new Date(oldestQueued.createdAt).getTime()) / 1000))
      : 0;
    if (brokerSnapshot.telemetry_status === "UNAVAILABLE") {
      return {
        allow: false,
        status: "queued_with_delay",
        loadState: "overloaded",
        telemetryStatus: "UNAVAILABLE",
        reason: "TELEMETRY_UNAVAILABLE",
        queueDepth: inferredDepth,
        activeRunning,
        queueAgeSeconds: inferredQueueAgeSeconds,
      };
    }
    const queueDepth = Math.max(Number(brokerSnapshot.queue_depth || 0), inferredDepth);
    const queueAgeSeconds = Math.max(
      Number(brokerSnapshot.queue_age_seconds || 0),
      inferredQueueAgeSeconds
    );

    if (queueDepth >= MAX_QUEUE_DEPTH || queueAgeSeconds >= OVERLOADED_QUEUE_AGE_SECONDS) {
      return {
        allow: false,
        status: "queued_with_delay",
        loadState: "overloaded",
        telemetryStatus: "OK",
        reason: "QUEUE_OVERLOADED",
        queueDepth,
        activeRunning,
        queueAgeSeconds,
      };
    }

    if (
      activeRunning >= MAX_ACTIVE_RUNNING_JOBS ||
      queueDepth >= DEGRADED_QUEUE_DEPTH ||
      queueAgeSeconds >= QUEUE_AGE_WARN_SECONDS
    ) {
      return {
        allow: true,
        status: "queued_with_delay",
        loadState: "degraded",
        telemetryStatus: "OK",
        reason: "RUNNER_SATURATED",
        queueDepth,
        activeRunning,
        queueAgeSeconds,
      };
    }

    return {
      allow: true,
      status: "queued",
      loadState: "healthy",
      telemetryStatus: "OK",
      queueDepth,
      activeRunning,
      queueAgeSeconds,
    };
  }

  shouldWarnQueueAge(queueAgeSeconds: number) {
    return queueAgeSeconds >= QUEUE_AGE_WARN_SECONDS;
  }
}

export const jobAdmissionService = new JobAdmissionService();
