import { createJob, updateJobStatus } from "../controllers/jobController";

jest.mock("../models/Job", () => ({
  Job: {
    findOne: jest.fn(),
    create: jest.fn(),
    findOneAndUpdate: jest.fn(),
  },
}));

jest.mock("../services/jobAdmissionService", () => ({
  jobAdmissionService: {
    check: jest.fn().mockResolvedValue({
      allow: true,
      status: "queued",
      queueDepth: 1,
      activeRunning: 0,
      queueAgeSeconds: 0,
    }),
    shouldWarnQueueAge: jest.fn().mockReturnValue(false),
  },
}));

jest.mock("../services/metricsService", () => ({
  metricsService: {
    emit: jest.fn(),
    emitQueueMetrics: jest.fn(),
  },
}));

jest.mock("../services/brokerQueueTelemetryService", () => ({
  brokerQueueTelemetryService: {
    getQueueSnapshot: jest.fn().mockResolvedValue({ queue_depth: 0, queue_age_seconds: 0 }),
    emitBrokerQueueMetrics: jest.fn().mockResolvedValue({
      heavy: { queue_depth: 0, queue_age_seconds: 0 },
      light: { queue_depth: 0, queue_age_seconds: 0 },
    }),
  },
}));

jest.mock("../services/realtimeEventControlService", () => ({
  realtimeEventControlService: {
    shouldEmit: jest.fn().mockResolvedValue(true),
  },
}));

jest.mock("../models/SopConfig", () => ({
  SopConfig: {
    findOne: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(null),
      }),
    }),
  },
}));

function mockRes() {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe("job idempotency and stage tracking", () => {
  it("returns existing in-flight job for same idempotency key", async () => {
    const { Job } = jest.requireMock("../models/Job");
    Job.findOne.mockReturnValueOnce({
      sort: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({ id: "existing-job-1", status: "processing" }),
      }),
    });

    const req: any = {
      body: { document_name: "a.pdf", s3_input_key: "raw/a.pdf" },
      tenantId: "tenant-1",
      tenantQuery: () => ({ tenant_id: "tenant-1" }),
      user: { _id: "user-1" },
      headers: {},
    };
    const res = mockRes();
    await createJob(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      data: { id: "existing-job-1", status: "processing", idempotent: true },
    });
  });

  it("persists stage events from internal callback", async () => {
    const { Job } = jest.requireMock("../models/Job");
    Job.findOne.mockReturnValueOnce({
      lean: jest.fn().mockResolvedValue({
        id: "job-1",
        status: "processing",
        progress_pct: 5,
        current_stage: "initialization",
        stages: [],
      }),
    });
    Job.findOneAndUpdate.mockResolvedValue({
      id: "job-1",
      status: "processing",
      progress_pct: 10,
      current_stage: "extraction",
      error_message: null,
      job_type: "extraction",
      queue_name: "heavy_jobs",
    });

    const req: any = {
      body: {
        job_id: "job-1",
        tenant_id: "tenant-1",
        status: "processing",
        stage_event: {
          stage_name: "extraction",
          start_time: new Date().toISOString(),
          end_time: new Date().toISOString(),
          status: "success",
        },
      },
    };
    const res = mockRes();
    await updateJobStatus(req, res);
    expect(Job.findOneAndUpdate).toHaveBeenCalled();
    const updateArg = Job.findOneAndUpdate.mock.calls[0][1];
    expect(updateArg.$push?.stages?.stage_name).toBe("extraction");
  });

  it("ignores duplicate terminal callback updates", async () => {
    const { Job } = jest.requireMock("../models/Job");
    Job.findOne.mockReturnValueOnce({
      lean: jest.fn().mockResolvedValue({
        id: "job-1",
        status: "completed",
        progress_pct: 100,
        current_stage: "completed",
        stages: [],
      }),
    });

    const req: any = {
      body: {
        job_id: "job-1",
        tenant_id: "tenant-1",
        status: "completed",
        progress_pct: 100,
        current_stage: "completed",
      },
    };
    const res = mockRes();
    await updateJobStatus(req, res);
    expect(res.json).toHaveBeenCalledWith({
      message: "Duplicate status ignored",
      data: { id: "job-1", status: "completed" },
    });
  });
});
