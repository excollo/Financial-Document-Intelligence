import { Job } from "../models/Job";
import { IdempotencyLock } from "../models/IdempotencyLock";

const DEFAULT_LEASE_SECONDS = Number(process.env.IDEMPOTENCY_LOCK_LEASE_SECONDS || "180");
const ACTIVE_JOB_STATUSES = new Set(["queued", "queued_with_delay", "processing"]);

type AcquireParams = {
  tenantId: string;
  idempotencyKey: string;
  ownerId: string;
  leaseSeconds?: number;
};

type AcquireResult =
  | { acquired: true }
  | {
      acquired: false;
      existingJob?: { id: string; status: string };
      retryAfterSeconds: number;
    };

class IdempotencyLockService {
  private async runQuery<T = any>(query: any): Promise<T | null> {
    if (!query) return null;
    if (typeof query.lean === "function") {
      return query.lean();
    }
    return query;
  }

  async acquire(params: AcquireParams): Promise<AcquireResult> {
    const leaseSeconds =
      Number.isFinite(params.leaseSeconds) && Number(params.leaseSeconds) > 0
        ? Number(params.leaseSeconds)
        : DEFAULT_LEASE_SECONDS;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + leaseSeconds * 1000);

    let existingLock = await this.runQuery<any>(
      IdempotencyLock.findOne({
        tenant_id: params.tenantId,
        idempotency_key: params.idempotencyKey,
      })
    );
    if (!existingLock) {
      try {
        const inserted = await this.runQuery<any>(
          IdempotencyLock.findOneAndUpdate(
            {
              tenant_id: params.tenantId,
              idempotency_key: params.idempotencyKey,
              owner_id: params.ownerId,
            },
            {
              $setOnInsert: {
                tenant_id: params.tenantId,
                idempotency_key: params.idempotencyKey,
              },
              $set: {
                owner_id: params.ownerId,
                expires_at: expiresAt,
                job_id: null,
              },
            },
            { upsert: true, new: true }
          )
        );
        if (inserted?.owner_id === params.ownerId) {
          return { acquired: true };
        }
      } catch (error: any) {
        if (error?.code !== 11000) throw error;
      }
      existingLock = await this.runQuery<any>(
        IdempotencyLock.findOne({
          tenant_id: params.tenantId,
          idempotency_key: params.idempotencyKey,
        })
      );
    }
    if (!existingLock) {
      return { acquired: false, retryAfterSeconds: leaseSeconds };
    }

    if (existingLock.owner_id === params.ownerId) {
      const renewed = await this.runQuery<any>(
        IdempotencyLock.findOneAndUpdate(
          {
            _id: existingLock._id,
            owner_id: params.ownerId,
          },
          {
            $set: {
              expires_at: expiresAt,
            },
          },
          { new: true }
        )
      );
      if (renewed?.owner_id === params.ownerId) {
        return { acquired: true };
      }
    }

    const existingJob = await this.resolveActiveJob(existingLock.job_id || null, params.tenantId);
    const expired = new Date(existingLock.expires_at).getTime() <= Date.now();
    if (existingJob?.active) {
      const ttlMs = Math.max(0, new Date(existingLock.expires_at).getTime() - Date.now());
      return {
        acquired: false,
        existingJob: existingJob.job,
        retryAfterSeconds: Math.max(1, Math.ceil(ttlMs / 1000)),
      };
    }

    if (expired && (!existingLock.job_id || !existingJob?.active)) {
      const reclaimed = await this.runQuery<any>(
        IdempotencyLock.findOneAndUpdate(
          {
            _id: existingLock._id,
            owner_id: existingLock.owner_id,
          },
          {
            $set: {
              owner_id: params.ownerId,
              expires_at: expiresAt,
              job_id: null,
            },
          },
          { new: true }
        )
      );
      if (reclaimed?.owner_id === params.ownerId) {
        return { acquired: true };
      }
    }

    const ttlMs = Math.max(0, new Date(existingLock.expires_at).getTime() - Date.now());
    const existingActiveJob = (existingJob as any)?.active ? (existingJob as any).job : undefined;
    return {
      acquired: false,
      existingJob: existingActiveJob,
      retryAfterSeconds: Math.max(1, Math.ceil(ttlMs / 1000)),
    };
  }

  async bindJob(params: {
    tenantId: string;
    idempotencyKey: string;
    ownerId: string;
    jobId: string;
  }): Promise<void> {
    await IdempotencyLock.updateOne(
      {
        tenant_id: params.tenantId,
        idempotency_key: params.idempotencyKey,
        owner_id: params.ownerId,
      },
      { $set: { job_id: params.jobId } }
    );
  }

  async releaseByOwner(params: {
    tenantId: string;
    idempotencyKey: string;
    ownerId: string;
  }): Promise<void> {
    await IdempotencyLock.deleteOne({
      tenant_id: params.tenantId,
      idempotency_key: params.idempotencyKey,
      owner_id: params.ownerId,
    });
  }

  async releaseByJobId(params: { tenantId: string; jobId: string }): Promise<void> {
    await IdempotencyLock.deleteMany({
      tenant_id: params.tenantId,
      job_id: params.jobId,
    });
  }

  async releaseByIdempotencyKey(params: { tenantId: string; idempotencyKey: string }): Promise<void> {
    await IdempotencyLock.deleteMany({
      tenant_id: params.tenantId,
      idempotency_key: params.idempotencyKey,
    });
  }

  private async resolveActiveJob(jobId: string | null, tenantId: string) {
    if (!jobId) return null;
    const job = await this.runQuery<any>(
      Job.findOne({ id: jobId, tenant_id: tenantId }).select("id status")
    );
    if (!job) return { active: false as const };
    if (!ACTIVE_JOB_STATUSES.has(String(job.status))) return { active: false as const };
    return { active: true as const, job: { id: String(job.id), status: String(job.status) } };
  }
}

export const idempotencyLockService = new IdempotencyLockService();
