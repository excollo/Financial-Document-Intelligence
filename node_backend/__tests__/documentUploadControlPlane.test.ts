import { documentController } from "../controllers/documentController";

jest.mock("../models/Document", () => ({
  Document: {
    findOne: jest.fn(),
    findById: jest.fn(),
  },
}));
jest.mock("../models/Directory", () => ({
  Directory: { findOne: jest.fn() },
}));
jest.mock("../models/User", () => ({
  User: { findById: jest.fn() },
}));
jest.mock("../models/Job", () => ({
  Job: {
    findOne: jest.fn(),
    updateOne: jest.fn(),
  },
}));
jest.mock("../services/storageService", () => ({
  storageService: { deleteFile: jest.fn(), downloadFile: jest.fn() },
}));
jest.mock("../services/jobAdmissionService", () => ({
  jobAdmissionService: { check: jest.fn() },
}));
jest.mock("../services/metricsService", () => ({
  metricsService: { emit: jest.fn(), emitQueueMetrics: jest.fn() },
}));
jest.mock("../services/brokerQueueTelemetryService", () => ({
  brokerQueueTelemetryService: { emitBrokerQueueMetrics: jest.fn() },
}));
jest.mock("../services/realtimeEmitter", () => ({
  emitToWorkspace: jest.fn(),
  emitToTenant: jest.fn(),
}));

function mockRes() {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe("document upload control plane", () => {
  const { User } = jest.requireMock("../models/User");
  const { Directory } = jest.requireMock("../models/Directory");
  const { Document } = jest.requireMock("../models/Document");
  const { Job } = jest.requireMock("../models/Job");
  const { storageService } = jest.requireMock("../services/storageService");
  const { jobAdmissionService } = jest.requireMock("../services/jobAdmissionService");
  const { emitToWorkspace } = jest.requireMock("../services/realtimeEmitter");

  beforeEach(() => {
    jest.clearAllMocks();
    User.findById.mockReturnValue({
      select: jest.fn().mockResolvedValue({ domainId: "tenant-1" }),
    });
    Directory.findOne.mockResolvedValue({ id: "dir-1", workspaceId: "ws-1", isShared: false });
    Document.findOne.mockImplementation((query: any) => {
      if (query?.workspaceId && query?.namespace) {
        return { collation: jest.fn().mockResolvedValue(null) };
      }
      if (query?.id) {
        return { lean: jest.fn().mockResolvedValue({ id: query.id, status: "processing" }) };
      }
      return { lean: jest.fn().mockResolvedValue(null) };
    });
    Job.findOne.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(null),
      }),
    });
    jobAdmissionService.check.mockResolvedValue({
      allow: true,
      status: "queued",
      loadState: "healthy",
      telemetryStatus: "OK",
      queueDepth: 0,
      activeRunning: 0,
      queueAgeSeconds: 0,
    });
  });

  it("rejects overloaded upload before processing and cleans file", async () => {
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
      file: { originalname: "a.pdf", blobName: "blob-a" },
      body: { directoryId: "dir-1", type: "DRHP" },
      user: { _id: "user-1", domain: "tenant-1" },
      currentWorkspace: "ws-1",
    };
    const res = mockRes();
    await documentController.uploadDocument(req, res);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(storageService.deleteFile).toHaveBeenCalledWith("blob-a");
  });

  it("returns idempotent response when in-flight upload job exists", async () => {
    Job.findOne.mockReturnValueOnce({
      sort: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({ id: "existing-doc-1", status: "processing" }),
      }),
    });
    const req: any = {
      file: { originalname: "a.pdf", blobName: "blob-a" },
      body: { id: "existing-doc-1", directoryId: "dir-1", type: "DRHP" },
      user: { _id: "user-1", domain: "tenant-1" },
      currentWorkspace: "ws-1",
    };
    const res = mockRes();
    await documentController.uploadDocument(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ idempotent: true })
    );
  });

  it("syncs job terminal status from document callback", async () => {
    const save = jest.fn().mockResolvedValue(undefined);
    Document.findOne.mockResolvedValueOnce({
      id: "doc-1",
      _id: "mongo-1",
      workspaceId: "ws-1",
      domainId: "tenant-1",
      status: "processing",
      name: "a.pdf",
      type: "DRHP",
      save,
    });
    Document.findById.mockResolvedValueOnce({ status: "completed" });
    Job.updateOne.mockResolvedValue({});

    const req: any = {
      body: {
        jobId: "doc-1",
        status: "completed",
        workspaceId: "ws-1",
        domainId: "tenant-1",
      },
    };
    const res = mockRes();
    await documentController.uploadStatusUpdate(req, res);
    expect(Job.updateOne).toHaveBeenCalledWith(
      { id: "doc-1", tenant_id: "tenant-1" },
      expect.objectContaining({
        $set: expect.objectContaining({ status: "completed" }),
      })
    );
  });

  it("returns deterministic 500 when callback emit fails", async () => {
    emitToWorkspace.mockRejectedValueOnce(new Error("socket down"));
    const save = jest.fn().mockResolvedValue(undefined);
    Document.findOne.mockResolvedValueOnce({
      id: "doc-1",
      _id: "mongo-1",
      workspaceId: "ws-1",
      domainId: "tenant-1",
      status: "processing",
      name: "a.pdf",
      type: "DRHP",
      save,
    });
    Document.findById.mockResolvedValueOnce({ status: "completed" });
    Job.updateOne.mockResolvedValue({});

    const req: any = {
      body: {
        jobId: "doc-1",
        status: "completed",
        workspaceId: "ws-1",
        domainId: "tenant-1",
      },
    };
    const res = mockRes();
    await documentController.uploadStatusUpdate(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: "DOCUMENT_EMIT_FAILED", jobId: "doc-1" })
    );
  });
});
