import { updateJobStatus } from "../controllers/jobController";

jest.mock("../models/Job", () => ({
  Job: {
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
  },
}));
jest.mock("../services/cacheService", () => ({
  cacheService: {
    del: jest.fn(),
  },
}));
jest.mock("../services/brokerQueueTelemetryService", () => ({
  brokerQueueTelemetryService: {
    emitBrokerQueueMetrics: jest.fn().mockResolvedValue(undefined),
  },
}));
jest.mock("../services/metricsService", () => ({
  metricsService: {
    emit: jest.fn(),
    emitQueueMetrics: jest.fn().mockResolvedValue(undefined),
  },
}));

function mockRes() {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe("internal job status validation", () => {
  const { Job } = jest.requireMock("../models/Job");
  const mockFindOne = (value: any) => {
    Job.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue(value),
    });
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("rejects invalid status values", async () => {
    const req: any = {
      body: {
        job_id: "job-1",
        tenant_id: "tenant-1",
        status: "totally_invalid",
      },
    };
    const res = mockRes();
    await updateJobStatus(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("rejects completed -> processing transition", async () => {
    mockFindOne({
      id: "job-1",
      status: "completed",
      progress_pct: 100,
      current_stage: "done",
      output_urls: { report: "https://example.com/report.pdf" },
      error_message: null,
      queue_name: "light_jobs",
      job_type: "extraction",
    });
    const req: any = {
      body: {
        job_id: "job-1",
        tenant_id: "tenant-1",
        status: "processing",
      },
    };
    const res = mockRes();
    await updateJobStatus(req, res);
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it("rejects failed -> processing transition", async () => {
    mockFindOne({
      id: "job-2",
      status: "failed",
      progress_pct: 10,
      current_stage: "extract",
      output_urls: null,
      error_message: "boom",
      queue_name: "light_jobs",
      job_type: "extraction",
    });
    const req: any = {
      body: {
        job_id: "job-2",
        tenant_id: "tenant-1",
        status: "processing",
      },
    };
    const res = mockRes();
    await updateJobStatus(req, res);
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it("accepts strict duplicate terminal update", async () => {
    mockFindOne({
      id: "job-3",
      status: "completed",
      progress_pct: 100,
      current_stage: "done",
      output_urls: { report: "https://example.com/report.pdf" },
      error_message: null,
      queue_name: "light_jobs",
      job_type: "extraction",
    });
    const req: any = {
      body: {
        job_id: "job-3",
        tenant_id: "tenant-1",
        status: "completed",
        progress_pct: 100,
        current_stage: "done",
      },
    };
    const res = mockRes();
    await updateJobStatus(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Duplicate status ignored" })
    );
  });

  it("rejects different terminal payload", async () => {
    mockFindOne({
      id: "job-4",
      status: "completed",
      progress_pct: 100,
      current_stage: "done",
      output_urls: { report: "https://example.com/report.pdf" },
      error_message: null,
      queue_name: "light_jobs",
      job_type: "extraction",
    });
    const req: any = {
      body: {
        job_id: "job-4",
        tenant_id: "tenant-1",
        status: "failed",
      },
    };
    const res = mockRes();
    await updateJobStatus(req, res);
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it("rejects completed without output proof", async () => {
    mockFindOne({
      id: "job-5",
      status: "processing",
      progress_pct: 80,
      current_stage: "finalize",
      output_urls: null,
      error_message: null,
      queue_name: "light_jobs",
      job_type: "extraction",
    });
    const req: any = {
      body: {
        job_id: "job-5",
        tenant_id: "tenant-1",
        status: "completed",
      },
    };
    const res = mockRes();
    await updateJobStatus(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("rejects completed_with_errors without output proof", async () => {
    mockFindOne({
      id: "job-6",
      status: "processing",
      progress_pct: 90,
      current_stage: "assemble",
      output_urls: null,
      error_message: null,
      queue_name: "light_jobs",
      job_type: "extraction",
    });
    const req: any = {
      body: {
        job_id: "job-6",
        tenant_id: "tenant-1",
        status: "completed_with_errors",
      },
    };
    const res = mockRes();
    await updateJobStatus(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("accepts completed with valid output proof", async () => {
    mockFindOne({
      id: "job-7",
      status: "processing",
      progress_pct: 95,
      current_stage: "assemble",
      output_urls: null,
      error_message: null,
      queue_name: "light_jobs",
      job_type: "extraction",
    });
    Job.findOneAndUpdate.mockResolvedValue({
      id: "job-7",
      status: "completed",
      queue_name: "light_jobs",
      job_type: "extraction",
      progress_pct: 100,
      current_stage: "done",
      error_message: null,
    });
    const req: any = {
      body: {
        job_id: "job-7",
        tenant_id: "tenant-1",
        status: "completed",
        output_urls: { report: "https://example.com/report.pdf" },
      },
    };
    const res = mockRes();
    await updateJobStatus(req, res);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Status updated" })
    );
  });

  it("ignores progress regression updates", async () => {
    mockFindOne({
      id: "job-8",
      status: "processing",
      progress_pct: 60,
      current_stage: "output_assembly",
      output_urls: null,
      error_message: null,
      queue_name: "light_jobs",
      job_type: "extraction",
      stages: [],
    });
    const req: any = {
      body: {
        job_id: "job-8",
        tenant_id: "tenant-1",
        status: "processing",
        progress_pct: 30,
      },
    };
    const res = mockRes();
    await updateJobStatus(req, res);
    expect(res.status).toHaveBeenCalledWith(202);
    expect(Job.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it("ignores stage rollback updates", async () => {
    mockFindOne({
      id: "job-9",
      status: "processing",
      progress_pct: 80,
      current_stage: "output_assembly",
      output_urls: null,
      error_message: null,
      queue_name: "light_jobs",
      job_type: "extraction",
      stages: [{ stage_name: "vector_upsert" }],
    });
    const req: any = {
      body: {
        job_id: "job-9",
        tenant_id: "tenant-1",
        status: "processing",
        current_stage: "chunking",
      },
    };
    const res = mockRes();
    await updateJobStatus(req, res);
    expect(res.status).toHaveBeenCalledWith(202);
    expect(Job.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it("ignores out-of-order stage events behind observed timeline", async () => {
    mockFindOne({
      id: "job-10",
      status: "processing",
      progress_pct: 70,
      current_stage: "output_assembly",
      output_urls: null,
      error_message: null,
      queue_name: "light_jobs",
      job_type: "extraction",
      stages: [{ stage_name: "embedding", stage_event_key: "a" }],
    });
    const req: any = {
      body: {
        job_id: "job-10",
        tenant_id: "tenant-1",
        status: "processing",
        stage_event: {
          stage_name: "chunking",
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
    expect(updateArg.$push).toBeUndefined();
  });
});

