import { createJob } from "../controllers/jobController";

jest.mock("../models/Job", () => ({
  Job: {
    findOne: jest.fn(),
    create: jest.fn(),
  },
}));
jest.mock("../models/SopConfig", () => ({
  SopConfig: {
    findOne: jest.fn(),
  },
}));
jest.mock("../models/Document", () => ({
  Document: {
    findOne: jest.fn(),
  },
}));
jest.mock("../services/jobAdmissionService", () => ({
  jobAdmissionService: {
    check: jest.fn(),
    shouldWarnQueueAge: jest.fn().mockReturnValue(false),
  },
}));
jest.mock("../services/metricsService", () => ({
  metricsService: {
    emit: jest.fn(),
    emitQueueMetrics: jest.fn().mockResolvedValue(undefined),
  },
}));
jest.mock("../services/brokerQueueTelemetryService", () => ({
  brokerQueueTelemetryService: {
    emitBrokerQueueMetrics: jest.fn().mockResolvedValue(undefined),
  },
}));
jest.mock("axios", () => ({
  post: jest.fn(),
}));

function mockRes() {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe("comparison intake scope security", () => {
  const { Job } = jest.requireMock("../models/Job");
  const { Document } = jest.requireMock("../models/Document");
  const { SopConfig } = jest.requireMock("../models/SopConfig");
  const { jobAdmissionService } = jest.requireMock("../services/jobAdmissionService");
  const axios = require("axios");

  beforeEach(() => {
    jest.clearAllMocks();
    SopConfig.findOne.mockReturnValue({ select: () => ({ lean: async () => null }) });
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

  it("allows same-scope comparison pair", async () => {
    const docFind = jest
      .fn()
      .mockReturnValueOnce({
        lean: async () => ({
          id: "drhp-1",
          namespace: "drhp-ns",
          directoryId: "dir-1",
          name: "drhp.pdf",
          workspaceId: "ws-1",
          domainId: "tenant-1",
        }),
      })
      .mockReturnValueOnce({
        lean: async () => ({
          id: "rhp-1",
          namespace: "rhp-ns",
          directoryId: "dir-1",
          name: "rhp.pdf",
          workspaceId: "ws-1",
          domainId: "tenant-1",
        }),
      });
    Document.findOne.mockImplementation(docFind);
    const save = jest.fn().mockResolvedValue(undefined);
    Job.create.mockResolvedValue({ id: "job-1", save, status: "queued" });
    axios.post.mockResolvedValue({ data: { status: "accepted", job_id: "job-1" } });

    const req: any = {
      body: { drhpId: "drhp-1", rhpId: "rhp-1", workspace_id: "ws-1" },
      tenantId: "tenant-1",
      tenantQuery: () => ({ tenant_id: "tenant-1" }),
      user: { _id: "user-1", domain: "acme.com" },
      userDomain: "acme.com",
      currentWorkspace: "ws-1",
      headers: {},
    };
    const res = mockRes();

    await createJob(req, res);
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("rejects cross-workspace pair deterministically", async () => {
    Document.findOne
      .mockReturnValueOnce({ lean: async () => null }) // scoped drhp miss
      .mockReturnValueOnce({ lean: async () => ({ id: "rhp-1", workspaceId: "ws-1", domainId: "tenant-1" }) }) // scoped rhp
      .mockReturnValueOnce({
        select: () => ({ lean: async () => ({ id: "drhp-1", workspaceId: "ws-other" }) }),
      }) // tenant-scoped drhp exists elsewhere
      .mockReturnValueOnce({
        select: () => ({ lean: async () => ({ id: "rhp-1", workspaceId: "ws-1" }) }),
      }); // tenant-scoped rhp

    const req: any = {
      body: { drhpId: "drhp-1", rhpId: "rhp-1", workspace_id: "ws-1" },
      tenantId: "tenant-1",
      tenantQuery: () => ({ tenant_id: "tenant-1" }),
      user: { _id: "user-1", domain: "acme.com" },
      userDomain: "acme.com",
      currentWorkspace: "ws-1",
      headers: {},
    };
    const res = mockRes();

    await createJob(req, res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: "DOCUMENT_SCOPE_MISMATCH" })
    );
  });

  it("rejects missing scoped document", async () => {
    Document.findOne
      .mockReturnValueOnce({ lean: async () => null })
      .mockReturnValueOnce({ lean: async () => null })
      .mockReturnValueOnce({ select: () => ({ lean: async () => null }) })
      .mockReturnValueOnce({ select: () => ({ lean: async () => null }) });

    const req: any = {
      body: { drhpId: "drhp-1", rhpId: "rhp-1", workspace_id: "ws-1" },
      tenantId: "tenant-1",
      tenantQuery: () => ({ tenant_id: "tenant-1" }),
      user: { _id: "user-1", domain: "acme.com" },
      userDomain: "acme.com",
      currentWorkspace: "ws-1",
      headers: {},
    };
    const res = mockRes();

    await createJob(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });
});
