import { Job } from "../models/Job";
import { IdempotencyLock } from "../models/IdempotencyLock";
import { idempotencyLockService } from "./idempotencyLockService";
import { metricsService } from "./metricsService";

const ACTIVE_JOB_STATUSES = ["queued", "queued_with_delay", "processing"] as const;

const STALE_JOB_QUEUED_TIMEOUT_MS = Number(
  process.env.STALE_JOB_QUEUED_TIMEOUT_MS || 10 * 60 * 1000
);
const STALE_JOB_PROCESSING_TIMEOUT_MS = Number(
  process.env.STALE_JOB_PROCESSING_TIMEOUT_MS || 45 * 60 * 1000
);
const STALE_LOCK_GRACE_MS = Number(process.env.STALE_LOCK_GRACE_MS || 60 * 1000);

type ReaperRunResult = {
  reclaimedJobs: number;
  releasedExpiredLocks: number;
};

class StaleJobReaperService {
  async reapOnce(): Promise<ReaperRunResult> {
    const now = Date.now();
    const queuedCutoff = new Date(now - STALE_JOB_QUEUED_TIMEOUT_MS);
    const processingCutoff = new Date(now - STALE_JOB_PROCESSING_TIMEOUT_MS);

    let reclaimedJobs = 0;
    let releasedExpiredLocks = 0;

    const staleCandidates = await Job.find({
      status: { $in: ACTIVE_JOB_STATUSES as unknown as string[] },
      $or: [
        { status: { $in: ["queued", "queued_with_delay"] }, createdAt: { $lt: queuedCutoff } },
        { status: "processing", createdAt: { $lt: processingCutoff } },
      ],
    })
      .select("id tenant_id status createdAt queue_name workspace_id job_type")
      .sort({ createdAt: 1 })
      .limit(200)
      .lean();

    for (const job of staleCandidates) {
      const status = String(job.status || "");
      const ageMs = now - new Date(job.createdAt as any).getTime();
      const reason =
        status === "processing"
          ? `Stale processing job reclaimed after ${Math.floor(ageMs / 1000)}s`
          : `Stale queued job reclaimed after ${Math.floor(ageMs / 1000)}s`;

      const updated = await Job.updateOne(
        {
          id: String(job.id),
          tenant_id: String(job.tenant_id),
          status: { $in: ACTIVE_JOB_STATUSES as unknown as string[] },
        },
        {
          $set: {
            status: "failed",
            error_reason: reason,
            error_message: reason,
            completed_at: new Date(),
          },
        }
      );

      if ((updated.modifiedCount || 0) > 0) {
        reclaimedJobs += 1;
        await idempotencyLockService.releaseByJobId({
          tenantId: String(job.tenant_id),
          jobId: String(job.id),
        });
        metricsService.emit("stale_job_reclaimed", 1, {
          tenant_id: String(job.tenant_id),
          queue_name: String(job.queue_name || ""),
          job_type: String(job.job_type || ""),
          status,
        });
        console.warn(
          `[StaleJobReaper] Reclaimed stale job ${String(job.id)} (${status}) ageMs=${ageMs}`
        );
      }
    }

    const lockCutoff = new Date(now - STALE_LOCK_GRACE_MS);
    const expiredLocks = await IdempotencyLock.find({
      expires_at: { $lt: lockCutoff },
    })
      .select("_id tenant_id idempotency_key job_id expires_at")
      .limit(500)
      .lean();

    if (expiredLocks.length > 0) {
      const lockIds = expiredLocks.map((lock) => lock._id);
      const deleteResult = await IdempotencyLock.deleteMany({ _id: { $in: lockIds } });
      releasedExpiredLocks = Number(deleteResult.deletedCount || 0);
      if (releasedExpiredLocks > 0) {
        metricsService.emit("stale_idempotency_lock_released", releasedExpiredLocks, {});
        console.warn(
          `[StaleJobReaper] Released ${releasedExpiredLocks} expired idempotency lock(s)`
        );
      }
    }

    return { reclaimedJobs, releasedExpiredLocks };
  }
}

export const staleJobReaperService = new StaleJobReaperService();
