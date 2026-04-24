jest.mock("../models/Job", () => ({
  Job: {
    countDocuments: jest.fn(),
    findOne: jest.fn(),
  },
}));

jest.mock("../services/brokerQueueTelemetryService", () => ({
  brokerQueueTelemetryService: {
    getQueueSnapshot: jest.fn(),
  },
}));

describe("admission telemetry fail-safe", () => {
  it("forces overloaded when telemetry unavailable", async () => {
    process.env.QUEUE_ADMISSION_STRICT = "true";
    jest.resetModules();
    const { jobAdmissionService } = await import("../services/jobAdmissionService");
    const { Job } = jest.requireMock("../models/Job");
    const { brokerQueueTelemetryService } = jest.requireMock("../services/brokerQueueTelemetryService");
    Job.countDocuments.mockResolvedValueOnce(3).mockResolvedValueOnce(1);
    Job.findOne.mockReturnValueOnce({
      sort: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue(null),
        }),
      }),
    });
    brokerQueueTelemetryService.getQueueSnapshot.mockResolvedValue({
      queue_name: "heavy_jobs",
      queue_depth: null,
      queue_age_seconds: null,
      telemetry_status: "UNAVAILABLE",
      sampled_at: new Date().toISOString(),
      source: "redis_broker",
    });

    const decision = await jobAdmissionService.check("tenant-1", "heavy_jobs");
    expect(decision.allow).toBe(false);
    expect(decision.loadState).toBe("overloaded");
    expect(decision.telemetryStatus).toBe("UNAVAILABLE");
    expect(decision.reason).toBe("TELEMETRY_UNAVAILABLE");
    delete process.env.QUEUE_ADMISSION_STRICT;
  });
});
