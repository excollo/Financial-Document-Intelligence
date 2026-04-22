import { updateJobStatus } from "../controllers/jobController";

jest.mock("../models/Job", () => ({
  Job: {
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
  },
}));

jest.mock("../services/metricsService", () => ({
  metricsService: { emit: jest.fn(), emitQueueMetrics: jest.fn() },
}));
jest.mock("../services/brokerQueueTelemetryService", () => ({
  brokerQueueTelemetryService: { emitBrokerQueueMetrics: jest.fn().mockResolvedValue({}) },
}));
jest.mock("../services/realtimeEventControlService", () => ({
  realtimeEventControlService: { shouldEmit: jest.fn().mockResolvedValue(true) },
}));

function mockRes() {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe("atomic stage callback dedupe", () => {
  it("returns duplicate ignored when stage event already exists concurrently", async () => {
    const { Job } = jest.requireMock("../models/Job");
    Job.findOne
      .mockReturnValueOnce({
        lean: jest.fn().mockResolvedValue({
          id: "job-1",
          status: "processing",
          progress_pct: 10,
          current_stage: "extracting",
          stages: [],
        }),
      })
      .mockReturnValueOnce({
        lean: jest.fn().mockResolvedValue({
          id: "job-1",
          status: "processing",
          progress_pct: 10,
          current_stage: "extracting",
          stages: [{ stage_event_key: "existing" }],
        }),
      });
    Job.findOneAndUpdate.mockResolvedValueOnce(null);

    const req: any = {
      body: {
        job_id: "job-1",
        tenant_id: "tenant-1",
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
    expect(res.json).toHaveBeenCalledWith({
      message: "Duplicate stage event ignored",
      data: { id: "job-1", status: "processing" },
    });
  });
});
