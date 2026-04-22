import axios from "axios";
import { summaryController } from "../controllers/summaryController";
import { reportController } from "../controllers/reportController";
import { emitToTenant, emitToWorkspace } from "../services/realtimeEmitter";

jest.mock("axios");
jest.mock("../models/Job", () => ({
  Job: {
    create: jest.fn(),
    findOne: jest.fn(),
    updateOne: jest.fn(),
  },
}));
jest.mock("../models/User", () => ({
  User: { findById: jest.fn() },
}));
jest.mock("../services/jobAdmissionService", () => ({
  jobAdmissionService: { check: jest.fn(), shouldWarnQueueAge: jest.fn().mockReturnValue(false) },
}));
jest.mock("../services/metricsService", () => ({
  metricsService: { emit: jest.fn(), emitQueueMetrics: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock("../services/brokerQueueTelemetryService", () => ({
  brokerQueueTelemetryService: { emitBrokerQueueMetrics: jest.fn().mockResolvedValue({}) },
}));
jest.mock("../services/realtimeEmitter", () => ({
  emitToWorkspace: jest.fn().mockResolvedValue(undefined),
  emitToTenant: jest.fn().mockResolvedValue(undefined),
}));

function mockRes() {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe("summary/report control plane hardening", () => {
  const { Job } = jest.requireMock("../models/Job");
  const { jobAdmissionService } = jest.requireMock("../services/jobAdmissionService");
  const mockedAxios = axios as jest.Mocked<typeof axios>;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.PYTHON_API_URL = "http://python:8000";
    jobAdmissionService.check.mockResolvedValue({
      allow: true,
      status: "queued",
      loadState: "healthy",
      telemetryStatus: "OK",
      queueDepth: 0,
      activeRunning: 0,
      queueAgeSeconds: 0,
    });
    Job.findOne.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(null),
      }),
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({ id: "job-1", tenant_id: "tenant-1", workspace_id: "ws-1" }),
      }),
    });
    Job.create.mockResolvedValue({});
    Job.updateOne.mockResolvedValue({});
    mockedAxios.post.mockResolvedValue({ data: { status: "accepted", job_id: "job-1" } } as any);
  });

  it("summary trigger respects admission backpressure", async () => {
    jobAdmissionService.check.mockResolvedValueOnce({
      allow: false,
      status: "queued_with_delay",
      loadState: "overloaded",
      telemetryStatus: "OK",
      reason: "QUEUE_OVERLOADED",
      queueDepth: 999,
      activeRunning: 99,
      queueAgeSeconds: 999,
    });
    const req: any = {
      body: { documentId: "doc-1", namespace: "ns-1", docType: "drhp" },
      user: { _id: "u-1", domainId: "tenant-1", domain: "tenant-1" },
      userDomain: "tenant-1",
      currentWorkspace: "ws-1",
      headers: { authorization: "Bearer token" },
    };
    const res = mockRes();
    await summaryController.triggerSummary(req, res);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(Job.create).not.toHaveBeenCalled();
  });

  it("report compare respects idempotency and returns existing in-flight job", async () => {
    Job.findOne.mockReturnValueOnce({
      sort: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({ id: "existing-job", status: "processing" }),
      }),
    });
    const req: any = {
      body: { drhpId: "d-1", rhpId: "r-1", drhpNamespace: "drhp", rhpNamespace: "rhp" },
      user: { _id: "u-1", domainId: "tenant-1", domain: "tenant-1" },
      userDomain: "tenant-1",
      currentWorkspace: "ws-1",
      headers: { authorization: "Bearer token" },
    };
    const res = mockRes();
    await reportController.compareDocuments(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ job_id: "existing-job", idempotent: true })
    );
    expect(Job.create).not.toHaveBeenCalled();
  });

  it("report compare respects admission backpressure", async () => {
    jobAdmissionService.check.mockResolvedValueOnce({
      allow: false,
      status: "queued_with_delay",
      loadState: "overloaded",
      telemetryStatus: "OK",
      reason: "QUEUE_OVERLOADED",
      queueDepth: 999,
      activeRunning: 99,
      queueAgeSeconds: 999,
    });
    const req: any = {
      body: { drhpId: "d-1", rhpId: "r-1", drhpNamespace: "drhp", rhpNamespace: "rhp" },
      user: { _id: "u-1", domainId: "tenant-1", domain: "tenant-1" },
      userDomain: "tenant-1",
      currentWorkspace: "ws-1",
      headers: { authorization: "Bearer token" },
    };
    const res = mockRes();
    await reportController.compareDocuments(req, res);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(Job.create).not.toHaveBeenCalled();
  });

  it("summary callback rejects missing scope metadata", async () => {
    const req: any = { body: { jobId: "job-1", status: "completed" } };
    const res = mockRes();
    await summaryController.summaryStatusUpdate(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("report callback rejects scope mismatch", async () => {
    const req: any = {
      body: { jobId: "job-1", status: "completed", workspaceId: "wrong", domainId: "tenant-1" },
    };
    const res = mockRes();
    await reportController.reportStatusUpdate(req, res);
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it("summary dispatch failure marks job failed", async () => {
    mockedAxios.post.mockRejectedValueOnce(new Error("dispatch down"));
    const req: any = {
      body: { documentId: "doc-1", namespace: "ns-1", docType: "drhp" },
      user: { _id: "u-1", domainId: "tenant-1", domain: "tenant-1" },
      userDomain: "tenant-1",
      currentWorkspace: "ws-1",
      headers: { authorization: "Bearer token" },
    };
    const res = mockRes();
    await summaryController.triggerSummary(req, res);
    expect(Job.updateOne).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        $set: expect.objectContaining({ status: "failed" }),
      })
    );
  });

  it("report dispatch failure marks job failed", async () => {
    mockedAxios.post.mockRejectedValueOnce(new Error("dispatch down"));
    const req: any = {
      body: { drhpId: "d-1", rhpId: "r-1", drhpNamespace: "drhp", rhpNamespace: "rhp" },
      user: { _id: "u-1", domainId: "tenant-1", domain: "tenant-1" },
      userDomain: "tenant-1",
      currentWorkspace: "ws-1",
      headers: { authorization: "Bearer token" },
    };
    const res = mockRes();
    await reportController.compareDocuments(req, res);
    expect(Job.updateOne).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        $set: expect.objectContaining({ status: "failed" }),
      })
    );
  });

  it("summary callback returns deterministic error when emit fails", async () => {
    (emitToWorkspace as jest.Mock).mockRejectedValueOnce(new Error("socket down"));
    const req: any = {
      body: { jobId: "job-1", status: "completed", workspaceId: "ws-1", domainId: "tenant-1" },
    };
    const res = mockRes();
    await summaryController.summaryStatusUpdate(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: "SUMMARY_EMIT_FAILED", jobId: "job-1" })
    );
  });

  it("report callback returns deterministic error when emit fails", async () => {
    (emitToWorkspace as jest.Mock).mockRejectedValueOnce(new Error("socket down"));
    const req: any = {
      body: { jobId: "job-1", status: "completed", workspaceId: "ws-1", domainId: "tenant-1" },
    };
    const res = mockRes();
    await reportController.reportStatusUpdate(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: "REPORT_EMIT_FAILED", jobId: "job-1" })
    );
  });
});
