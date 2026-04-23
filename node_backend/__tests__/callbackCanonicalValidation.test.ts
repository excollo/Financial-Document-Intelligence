import { documentController } from "../controllers/documentController";
import { summaryController } from "../controllers/summaryController";
import { reportController } from "../controllers/reportController";

jest.mock("../models/Job", () => ({
  Job: {
    findOne: jest.fn(),
    updateOne: jest.fn(),
  },
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

describe("callback canonical validation", () => {
  it("rejects conflicting documentId and jobId", async () => {
    const req: any = {
      body: {
        documentId: "doc-1",
        jobId: "doc-2",
        status: "completed",
        workspaceId: "ws-1",
        domainId: "tenant-1",
      },
    };
    const res = mockRes();
    await documentController.uploadStatusUpdate(req, res);
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it("rejects document callback missing scoped metadata", async () => {
    const req: any = {
      body: {
        documentId: "doc-1",
        status: "completed",
      },
    };
    const res = mockRes();
    await documentController.uploadStatusUpdate(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("rejects summary callback for unknown job", async () => {
    const { Job } = require("../models/Job");
    Job.findOne.mockReturnValue({ select: () => ({ lean: async () => null }) });
    const req: any = {
      body: {
        jobId: "unknown-summary-job",
        status: "completed",
        workspaceId: "ws-1",
        domainId: "tenant-1",
      },
    };
    const res = mockRes();
    await summaryController.summaryStatusUpdate(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("rejects report callback for unknown job", async () => {
    const { Job } = require("../models/Job");
    Job.findOne.mockReturnValue({ select: () => ({ lean: async () => null }) });
    const req: any = {
      body: {
        jobId: "unknown-report-job",
        status: "completed",
        workspaceId: "ws-1",
        domainId: "tenant-1",
      },
    };
    const res = mockRes();
    await reportController.reportStatusUpdate(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("rejects summary callback scope mismatch", async () => {
    const { Job } = require("../models/Job");
    Job.findOne.mockReturnValue({
      select: () => ({ lean: async () => ({ id: "job-1", workspace_id: "ws-a", tenant_id: "t-a" }) }),
    });
    const req: any = {
      body: {
        jobId: "job-1",
        status: "completed",
        workspaceId: "ws-other",
        domainId: "t-a",
      },
    };
    const res = mockRes();
    await summaryController.summaryStatusUpdate(req, res);
    expect(res.status).toHaveBeenCalledWith(409);
  });
});

