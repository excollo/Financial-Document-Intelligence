jest.mock("../models/IdempotencyLock", () => ({
  IdempotencyLock: {
    findOneAndUpdate: jest.fn(),
    findOne: jest.fn(),
    updateOne: jest.fn(),
  },
}));

jest.mock("../models/Job", () => ({
  Job: {
    findOne: jest.fn(),
  },
}));

describe("idempotencyLockService", () => {
  const { IdempotencyLock } = jest.requireMock("../models/IdempotencyLock");
  const { Job } = jest.requireMock("../models/Job");

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("allows recovery when stale lock points to terminal job", async () => {
    const { idempotencyLockService } = await import("../services/idempotencyLockService");

    IdempotencyLock.findOne.mockResolvedValue({
      _id: "lock-1",
      owner_id: "owner-1",
      job_id: "job-terminal",
      expires_at: new Date(Date.now() - 1000),
    });
    IdempotencyLock.findOneAndUpdate.mockResolvedValue({
      _id: "lock-1",
      owner_id: "owner-2",
      job_id: null,
      expires_at: new Date(Date.now() + 60000),
    });
    Job.findOne.mockReturnValue({
      select: () => ({ lean: async () => ({ id: "job-terminal", status: "completed" }) }),
    });

    const result = await idempotencyLockService.acquire({
      tenantId: "tenant-1",
      idempotencyKey: "key-1",
      ownerId: "owner-2",
    });
    expect(result.acquired).toBe(true);
  });

  it("does not allow takeover when expired lock points to active job", async () => {
    const { idempotencyLockService } = await import("../services/idempotencyLockService");

    IdempotencyLock.findOne.mockResolvedValue({
      _id: "lock-1",
      owner_id: "owner-1",
      job_id: "job-active",
      expires_at: new Date(Date.now() - 1000),
    });
    Job.findOne.mockReturnValue({
      select: () => ({ lean: async () => ({ id: "job-active", status: "processing" }) }),
    });

    const result = await idempotencyLockService.acquire({
      tenantId: "tenant-1",
      idempotencyKey: "key-1",
      ownerId: "owner-2",
    });
    expect(result.acquired).toBe(false);
    if (result.acquired) {
      throw new Error("Expected active-job expired lock acquire to be rejected");
    }
    expect(result.existingJob).toEqual({ id: "job-active", status: "processing" });
    expect(IdempotencyLock.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it("allows takeover when lock is expired and has no bound job", async () => {
    const { idempotencyLockService } = await import("../services/idempotencyLockService");
    IdempotencyLock.findOne.mockResolvedValue({
      _id: "lock-1",
      owner_id: "owner-1",
      job_id: null,
      expires_at: new Date(Date.now() - 1000),
    });
    IdempotencyLock.findOneAndUpdate.mockResolvedValue({
      _id: "lock-1",
      owner_id: "owner-2",
      job_id: null,
      expires_at: new Date(Date.now() + 60000),
    });

    const result = await idempotencyLockService.acquire({
      tenantId: "tenant-1",
      idempotencyKey: "key-1",
      ownerId: "owner-2",
    });
    expect(result.acquired).toBe(true);
  });

  it("keeps single-owner under parallel expired-lock reacquire", async () => {
    const { idempotencyLockService } = await import("../services/idempotencyLockService");
    const lockState: any = {
      _id: "lock-1",
      owner_id: "owner-1",
      job_id: null,
      expires_at: new Date(Date.now() - 1000),
    };
    IdempotencyLock.findOne.mockImplementation(async () => ({ ...lockState }));
    IdempotencyLock.findOneAndUpdate.mockImplementation(async (filter: any, update: any) => {
      if (filter._id === lockState._id && filter.owner_id === lockState.owner_id) {
        lockState.owner_id = update.$set.owner_id;
        lockState.expires_at = update.$set.expires_at;
        lockState.job_id = update.$set.job_id;
        return { ...lockState };
      }
      return null;
    });

    const [a, b] = await Promise.all([
      idempotencyLockService.acquire({
        tenantId: "tenant-1",
        idempotencyKey: "key-1",
        ownerId: "owner-2",
      }),
      idempotencyLockService.acquire({
        tenantId: "tenant-1",
        idempotencyKey: "key-1",
        ownerId: "owner-3",
      }),
    ]);

    expect(Number(a.acquired) + Number(b.acquired)).toBe(1);
  });

  it("isolates locks by tenant and key", async () => {
    const { idempotencyLockService } = await import("../services/idempotencyLockService");
    IdempotencyLock.findOne.mockResolvedValue(null);
    IdempotencyLock.findOneAndUpdate.mockImplementation(async (_filter: any, update: any) => {
      return {
        owner_id: update.$set.owner_id,
        job_id: null,
        expires_at: new Date(Date.now() + 60000),
      };
    });

    const a = await idempotencyLockService.acquire({
      tenantId: "tenant-1",
      idempotencyKey: "key-a",
      ownerId: "owner-a",
    });
    const b = await idempotencyLockService.acquire({
      tenantId: "tenant-2",
      idempotencyKey: "key-a",
      ownerId: "owner-b",
    });
    const c = await idempotencyLockService.acquire({
      tenantId: "tenant-1",
      idempotencyKey: "key-b",
      ownerId: "owner-c",
    });
    expect(a.acquired).toBe(true);
    expect(b.acquired).toBe(true);
    expect(c.acquired).toBe(true);
  });
});
