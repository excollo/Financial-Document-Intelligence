jest.mock("../models/Job", () => ({
  Job: {
    find: jest.fn(),
    updateOne: jest.fn(),
  },
}));

jest.mock("../models/IdempotencyLock", () => ({
  IdempotencyLock: {
    find: jest.fn(),
    deleteMany: jest.fn(),
  },
}));

jest.mock("../services/idempotencyLockService", () => ({
  idempotencyLockService: {
    releaseByJobId: jest.fn(),
  },
}));

jest.mock("../services/metricsService", () => ({
  metricsService: {
    emit: jest.fn(),
  },
}));

import { staleJobReaperService } from "../services/staleJobReaperService";
import { Job } from "../models/Job";
import { IdempotencyLock } from "../models/IdempotencyLock";
import { idempotencyLockService } from "../services/idempotencyLockService";

describe("staleJobReaperService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("marks stale active jobs as failed and releases their locks", async () => {
    const staleJob = {
      _id: "1",
      id: "job-1",
      tenant_id: "tenant-1",
      status: "queued",
      createdAt: new Date(Date.now() - 20 * 60 * 1000),
      queue_name: "light_jobs",
      job_type: "extraction",
    };

    (Job.find as jest.Mock).mockReturnValue({
      select: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([staleJob]),
    });
    (Job.updateOne as jest.Mock).mockResolvedValue({ modifiedCount: 1 });
    (IdempotencyLock.find as jest.Mock).mockReturnValue({
      select: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([]),
    });

    const result = await staleJobReaperService.reapOnce();

    expect(result.reclaimedJobs).toBe(1);
    expect(Job.updateOne).toHaveBeenCalled();
    expect(idempotencyLockService.releaseByJobId).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      jobId: "job-1",
    });
  });

  it("deletes expired idempotency locks", async () => {
    (Job.find as jest.Mock).mockReturnValue({
      select: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([]),
    });
    (IdempotencyLock.find as jest.Mock).mockReturnValue({
      select: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([{ _id: "lock-1" }, { _id: "lock-2" }]),
    });
    (IdempotencyLock.deleteMany as jest.Mock).mockResolvedValue({ deletedCount: 2 });

    const result = await staleJobReaperService.reapOnce();

    expect(IdempotencyLock.deleteMany).toHaveBeenCalledWith({
      _id: { $in: ["lock-1", "lock-2"] },
    });
    expect(result.releasedExpiredLocks).toBe(2);
  });
});
