import { submitAdverseFinding, submitSectionResult } from "../controllers/jobController";

jest.mock("../models/Job", () => ({
  Job: {
    findOne: jest.fn(),
  },
}));
jest.mock("../models/SectionResult", () => ({
  SectionResult: {
    findOneAndUpdate: jest.fn(),
    findOne: jest.fn(),
  },
}));
jest.mock("../models/AdverseFinding", () => ({
  AdverseFinding: {
    findOneAndUpdate: jest.fn(),
    findOne: jest.fn(),
  },
}));
jest.mock("../services/cacheService", () => ({
  cacheService: {
    del: jest.fn().mockResolvedValue(undefined),
  },
}));

function mockRes() {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe("internal write referential validation", () => {
  const { Job } = jest.requireMock("../models/Job");
  const { SectionResult } = jest.requireMock("../models/SectionResult");
  const { AdverseFinding } = jest.requireMock("../models/AdverseFinding");

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("rejects section result for unknown job", async () => {
    Job.findOne.mockReturnValue({
      select: () => ({ lean: async () => null }),
    });
    const req: any = {
      body: {
        job_id: "job-unknown",
        tenant_id: "tenant-1",
        workspace_id: "ws-1",
        domain_id: "tenant-1",
        section_id: "sec-1",
      },
    };
    const res = mockRes();
    await submitSectionResult(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(SectionResult.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it("rejects adverse finding for wrong-tenant job", async () => {
    Job.findOne.mockReturnValue({
      select: () => ({ lean: async () => null }),
    });
    const req: any = {
      body: {
        job_id: "job-1",
        tenant_id: "tenant-other",
        workspace_id: "ws-1",
        domain_id: "tenant-other",
        title: "risk",
      },
    };
    const res = mockRes();
    await submitAdverseFinding(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(AdverseFinding.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it("rejects section result for existing job with wrong workspace", async () => {
    Job.findOne.mockReturnValue({
      select: () => ({ lean: async () => null }),
    });
    const req: any = {
      body: {
        job_id: "job-1",
        tenant_id: "tenant-1",
        workspace_id: "ws-wrong",
        domain_id: "tenant-1",
        section_id: "sec-1",
      },
    };
    const res = mockRes();
    await submitSectionResult(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("rejects missing scope fields for section result", async () => {
    const req: any = {
      body: {
        job_id: "job-1",
        tenant_id: "tenant-1",
        section_id: "sec-1",
      },
    };
    const res = mockRes();
    await submitSectionResult(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("accepts valid scoped section result write", async () => {
    Job.findOne.mockReturnValue({
      select: () => ({ lean: async () => ({ id: "job-1", tenant_id: "tenant-1", workspace_id: "ws-1" }) }),
    });
    SectionResult.findOneAndUpdate.mockResolvedValue({
      id: "result-1",
      status: "completed",
    });
    const req: any = {
      body: {
        job_id: "job-1",
        tenant_id: "tenant-1",
        workspace_id: "ws-1",
        domain_id: "tenant-1",
        section_id: "sec-1",
      },
    };
    const res = mockRes();
    await submitSectionResult(req, res);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Section result saved" })
    );
  });

  it("rejects adverse finding for missing scope fields", async () => {
    const req: any = {
      body: {
        job_id: "job-1",
        tenant_id: "tenant-1",
        title: "risk",
      },
    };
    const res = mockRes();
    await submitAdverseFinding(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("rejects adverse finding for domain/tenant mismatch", async () => {
    const req: any = {
      body: {
        job_id: "job-1",
        tenant_id: "tenant-1",
        workspace_id: "ws-1",
        domain_id: "tenant-other",
        title: "risk",
      },
    };
    const res = mockRes();
    await submitAdverseFinding(req, res);
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it("keeps duplicate valid adverse finding idempotent", async () => {
    Job.findOne.mockReturnValue({
      select: () => ({ lean: async () => ({ id: "job-1", tenant_id: "tenant-1", workspace_id: "ws-1" }) }),
    });
    AdverseFinding.findOneAndUpdate.mockRejectedValue({ code: 11000 });
    AdverseFinding.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue({ id: "existing-finding" }),
    });

    const req: any = {
      body: {
        job_id: "job-1",
        tenant_id: "tenant-1",
        workspace_id: "ws-1",
        domain_id: "tenant-1",
        title: "duplicate finding",
        entity_name: "entity",
      },
    };
    const res = mockRes();
    await submitAdverseFinding(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Duplicate adverse finding ignored" })
    );
  });
});
