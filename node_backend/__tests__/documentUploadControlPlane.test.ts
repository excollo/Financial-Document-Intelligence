import { documentController } from "../controllers/documentController";
import axios from "axios";

jest.mock("axios");

jest.mock("../models/Document", () => {
  const DocumentMock: any = jest.fn().mockImplementation((data: any) => ({
    ...data,
    save: jest.fn().mockResolvedValue(undefined),
  }));
  DocumentMock.findOne = jest.fn();
  DocumentMock.findById = jest.fn();
  DocumentMock.findOneAndUpdate = jest.fn();
  return { Document: DocumentMock };
});
jest.mock("../models/Directory", () => ({
  Directory: { findOne: jest.fn(), updateOne: jest.fn() },
}));
jest.mock("../models/Domain", () => ({
  Domain: { findOne: jest.fn() },
}));
jest.mock("../models/User", () => ({
  User: { findById: jest.fn() },
}));
jest.mock("../models/Job", () => ({
  Job: {
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
    create: jest.fn(),
    updateOne: jest.fn(),
  },
}));
jest.mock("../services/storageService", () => ({
  storageService: {
    deleteFile: jest.fn(),
    downloadFile: jest.fn(),
    getFileSize: jest.fn(),
    getPresignedUrl: jest.fn().mockResolvedValue("https://example.com/presigned"),
  },
}));
jest.mock("../lib/events", () => ({
  publishEvent: jest.fn().mockResolvedValue(undefined),
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
}));
jest.mock("../services/idempotencyLockService", () => ({
  idempotencyLockService: {
    acquire: jest.fn(),
    bindJob: jest.fn().mockResolvedValue(undefined),
  },
}));
jest.mock("../services/cacheService", () => ({
  cacheService: {
    del: jest.fn().mockResolvedValue(undefined),
    delByPrefix: jest.fn().mockResolvedValue(undefined),
  },
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
  const { Domain } = jest.requireMock("../models/Domain");
  const { Document } = jest.requireMock("../models/Document");
  const { Job } = jest.requireMock("../models/Job");
  const { storageService } = jest.requireMock("../services/storageService");
  const { jobAdmissionService } = jest.requireMock("../services/jobAdmissionService");
  const { emitToWorkspace } = jest.requireMock("../services/realtimeEmitter");
  const { idempotencyLockService } = jest.requireMock("../services/idempotencyLockService");
  const { metricsService } = jest.requireMock("../services/metricsService");
  const { cacheService } = jest.requireMock("../services/cacheService");
  const mockedAxios = axios as jest.Mocked<typeof axios>;

  beforeEach(() => {
    jest.clearAllMocks();
    User.findById.mockReturnValue({
      select: jest.fn().mockResolvedValue({ domainId: "tenant-1" }),
    });
    Directory.findOne.mockResolvedValue({ id: "dir-1", workspaceId: "ws-1", isShared: false });
    Directory.updateOne.mockResolvedValue({});
    Domain.findOne.mockResolvedValue({});
    Document.findById.mockResolvedValue(null);
    Document.findOne.mockImplementation((query: any) => {
      if (query?.workspaceId && query?.namespace) {
        return { collation: jest.fn().mockResolvedValue(null) };
      }
      if (query?.id) {
        return { lean: jest.fn().mockResolvedValue({ id: query.id, status: "processing" }) };
      }
      return { lean: jest.fn().mockResolvedValue(null) };
    });
    Job.findOne.mockImplementation((query: any) => ({
      id: query?.id || "doc-1",
      tenant_id: query?.tenant_id || "tenant-1",
      workspace_id: "ws-1",
      status: "processing",
      progress_pct: 0,
      current_stage: "upload",
      output_urls: { report: "https://example.com/report.pdf" },
      sort: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(null),
      }),
      lean: jest.fn().mockResolvedValue({
        id: query?.id || "doc-1",
        tenant_id: query?.tenant_id || "tenant-1",
        workspace_id: "ws-1",
        status: "processing",
        progress_pct: 0,
        current_stage: "upload",
        output_urls: { report: "https://example.com/report.pdf" },
      }),
    }));
    Job.findOneAndUpdate.mockResolvedValue({
      id: "doc-1",
      tenant_id: "tenant-1",
      workspace_id: "ws-1",
      status: "processing",
    });
    Job.create.mockResolvedValue({
      id: "job-1",
      save: jest.fn().mockResolvedValue(undefined),
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
    idempotencyLockService.acquire.mockResolvedValue({
      acquired: true,
    });
    storageService.getFileSize.mockResolvedValue(1024);
    mockedAxios.post.mockRejectedValue(new Error("dispatch down"));
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
    idempotencyLockService.acquire.mockResolvedValueOnce({
      acquired: false,
      existingJob: { id: "existing-doc-1", status: "processing" },
      retryAfterSeconds: 30,
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

  it("uses stable idempotency key for same logical upload even when blob key changes", async () => {
    idempotencyLockService.acquire.mockResolvedValue({ acquired: true });
    const reqA: any = {
      file: { originalname: "same.pdf", blobName: "blob-a" },
      body: { id: "doc-a", directoryId: "dir-1", type: "DRHP" },
      user: { _id: "user-1", domain: "tenant-1" },
      currentWorkspace: "ws-1",
    };
    const reqB: any = {
      file: { originalname: "same.pdf", blobName: "blob-b" },
      body: { id: "doc-b", directoryId: "dir-1", type: "DRHP" },
      user: { _id: "user-1", domain: "tenant-1" },
      currentWorkspace: "ws-1",
    };
    await documentController.uploadDocument(reqA, mockRes());
    await documentController.uploadDocument(reqB, mockRes());

    const firstKey = idempotencyLockService.acquire.mock.calls[0][0].idempotencyKey;
    const secondKey = idempotencyLockService.acquire.mock.calls[1][0].idempotencyKey;
    expect(firstKey).toBe(secondKey);
  });

  it("uses different idempotency key for different logical uploads", async () => {
    idempotencyLockService.acquire.mockResolvedValue({ acquired: true });
    const reqA: any = {
      file: { originalname: "same.pdf", blobName: "blob-a" },
      body: { id: "doc-a", directoryId: "dir-1", type: "DRHP" },
      user: { _id: "user-1", domain: "tenant-1" },
      currentWorkspace: "ws-1",
    };
    const reqB: any = {
      file: { originalname: "different.pdf", blobName: "blob-b" },
      body: { id: "doc-b", directoryId: "dir-1", type: "DRHP" },
      user: { _id: "user-1", domain: "tenant-1" },
      currentWorkspace: "ws-1",
    };
    await documentController.uploadDocument(reqA, mockRes());
    await documentController.uploadDocument(reqB, mockRes());

    const firstKey = idempotencyLockService.acquire.mock.calls[0][0].idempotencyKey;
    const secondKey = idempotencyLockService.acquire.mock.calls[1][0].idempotencyKey;
    expect(firstKey).not.toBe(secondKey);
  });

  it("skips buffered validation for large files", async () => {
    storageService.getFileSize.mockResolvedValueOnce(25 * 1024 * 1024);

    const req: any = {
      file: { originalname: "large.pdf", blobName: "blob-large" },
      body: { id: "doc-large-1", directoryId: "dir-1", type: "DRHP" },
      user: { _id: "user-1", domain: "tenant-1" },
      currentWorkspace: "ws-1",
    };
    const res = mockRes();
    await documentController.uploadDocument(req, res);
    expect(storageService.downloadFile).not.toHaveBeenCalled();
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
    expect(Job.findOneAndUpdate).toHaveBeenCalled();
    expect(cacheService.del).toHaveBeenCalledWith("job:status:tenant-1:doc-1");
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

  it("upload callback rejects completed -> processing lifecycle regression", async () => {
    const save = jest.fn().mockResolvedValue(undefined);
    Document.findOne.mockResolvedValueOnce({
      id: "doc-1",
      _id: "mongo-1",
      workspaceId: "ws-1",
      domainId: "tenant-1",
      status: "completed",
      name: "a.pdf",
      type: "DRHP",
      save,
    });
    Job.findOne.mockReturnValueOnce({
      lean: jest.fn().mockResolvedValue({
        id: "doc-1",
        tenant_id: "tenant-1",
        workspace_id: "ws-1",
        status: "completed",
        progress_pct: 100,
        current_stage: "completed",
        output_urls: { report: "https://example.com/report.pdf" },
      }),
    });
    const req: any = {
      body: { jobId: "doc-1", status: "processing", workspaceId: "ws-1", domainId: "tenant-1" },
    };
    const res = mockRes();
    await documentController.uploadStatusUpdate(req, res);
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it("does not mutate document when callback is lifecycle-rejected", async () => {
    const save = jest.fn().mockResolvedValue(undefined);
    Document.findOne.mockResolvedValueOnce({
      id: "doc-1",
      _id: "mongo-1",
      workspaceId: "ws-1",
      domainId: "tenant-1",
      status: "completed",
      name: "a.pdf",
      type: "DRHP",
      save,
    });
    Job.findOne.mockReturnValueOnce({
      lean: jest.fn().mockResolvedValue({
        id: "doc-1",
        tenant_id: "tenant-1",
        workspace_id: "ws-1",
        status: "completed",
        progress_pct: 100,
        current_stage: "completed",
        output_urls: { report: "https://example.com/report.pdf" },
      }),
    });

    const req: any = {
      body: { jobId: "doc-1", status: "processing", workspaceId: "ws-1", domainId: "tenant-1" },
    };
    const res = mockRes();
    await documentController.uploadStatusUpdate(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(save).not.toHaveBeenCalled();
    expect(Job.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it("upload callback rejects completed -> failed terminal mutation", async () => {
    const save = jest.fn().mockResolvedValue(undefined);
    Document.findOne.mockResolvedValueOnce({
      id: "doc-1",
      _id: "mongo-1",
      workspaceId: "ws-1",
      domainId: "tenant-1",
      status: "completed",
      name: "a.pdf",
      type: "DRHP",
      save,
    });
    Job.findOne.mockReturnValueOnce({
      lean: jest.fn().mockResolvedValue({
        id: "doc-1",
        tenant_id: "tenant-1",
        workspace_id: "ws-1",
        status: "completed",
        progress_pct: 100,
        current_stage: "completed",
        output_urls: { report: "https://example.com/report.pdf" },
      }),
    });
    const req: any = {
      body: { jobId: "doc-1", status: "failed", workspaceId: "ws-1", domainId: "tenant-1" },
    };
    const res = mockRes();
    await documentController.uploadStatusUpdate(req, res);
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it("upload callback accepts duplicate terminal update", async () => {
    const save = jest.fn().mockResolvedValue(undefined);
    Document.findOne.mockResolvedValueOnce({
      id: "doc-1",
      _id: "mongo-1",
      workspaceId: "ws-1",
      domainId: "tenant-1",
      status: "completed",
      name: "a.pdf",
      type: "DRHP",
      save,
    });
    Document.findById.mockResolvedValueOnce({ status: "completed" });
    Job.findOne.mockReturnValueOnce({
      lean: jest.fn().mockResolvedValue({
        id: "doc-1",
        tenant_id: "tenant-1",
        workspace_id: "ws-1",
        status: "completed",
        progress_pct: 100,
        current_stage: "document_callback",
        output_urls: { report: "https://example.com/report.pdf" },
      }),
    });
    const req: any = {
      body: { jobId: "doc-1", status: "completed", workspaceId: "ws-1", domainId: "tenant-1" },
    };
    const res = mockRes();
    await documentController.uploadStatusUpdate(req, res);
    expect(res.status).not.toHaveBeenCalledWith(409);
    expect(res.status).not.toHaveBeenCalledWith(400);
  });

  it("invalidates document list cache on update", async () => {
    Document.findOneAndUpdate.mockResolvedValueOnce({
      id: "doc-1",
      workspaceId: "ws-1",
      directoryId: "dir-1",
      name: "renamed.pdf",
    });
    const invalidateSpy = jest
      .spyOn(documentController, "invalidateWorkspaceDocumentCaches")
      .mockResolvedValue(undefined);

    const req: any = {
      params: { id: "doc-1" },
      body: { name: "renamed.pdf" },
      userDomain: "tenant-1",
      currentWorkspace: "ws-1",
    };
    const res = mockRes();
    await documentController.update(req, res);

    expect(invalidateSpy).toHaveBeenCalledWith("ws-1");
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ id: "doc-1" })
    );
    invalidateSpy.mockRestore();
  });

  it("uploadRhp treats accepted dispatch as successful enqueue", async () => {
    const drhpSave = jest.fn().mockResolvedValue(undefined);
    Document.findOne.mockImplementationOnce((query: any) => {
      if (query?.id === "drhp-1" && query?.type === "DRHP") {
        return Promise.resolve({
          id: "drhp-1",
          save: drhpSave,
        });
      }
      return Promise.resolve(null);
    });
    storageService.getFileSize.mockResolvedValueOnce(25 * 1024 * 1024);
    mockedAxios.post.mockResolvedValueOnce({
      data: { status: "accepted", job_id: "celery-rhp-1" },
    } as any);

    const req: any = {
      file: { originalname: "rhp.pdf", blobName: "blob-rhp-1" },
      body: { drhpId: "drhp-1" },
      user: { _id: "user-1", domain: "tenant-1" },
      currentWorkspace: "ws-1",
    };
    const res = mockRes();

    await documentController.uploadRhp(req, res);

    expect(Job.updateOne).toHaveBeenCalledWith(
      { id: "blob-rhp-1", tenant_id: "tenant-1" },
      expect.objectContaining({
        $set: expect.objectContaining({
          status: "processing",
          current_stage: "ingestion",
          celery_task_id: "celery-rhp-1",
        }),
      })
    );
    expect(metricsService.emitQueueMetrics).toHaveBeenCalledWith("tenant-1", "heavy_jobs");
    expect(res.status).toHaveBeenCalledWith(201);
  });
});
