import { reportController } from "../controllers/reportController";

jest.mock("../services/realtimeEmitter", () => ({
  emitToWorkspace: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../models/Report", () => ({
  Report: {
    findOneAndUpdate: jest.fn(),
    deleteMany: jest.fn(),
  },
}));
jest.mock("../models/Document", () => ({
  Document: {
    findOne: jest.fn().mockResolvedValue(null),
  },
}));
jest.mock("../models/Directory", () => ({
  Directory: {
    updateOne: jest.fn().mockResolvedValue(undefined),
  },
}));

function mockRes() {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe("report create atomicity", () => {
  const { Report } = jest.requireMock("../models/Report");

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("uses atomic upsert and does not delete existing reports first", async () => {
    Report.findOneAndUpdate.mockResolvedValue({
      id: "report-1",
      title: "R",
      content: "C",
    });

    const req: any = {
      body: {
        title: "R",
        content: "C",
        drhpId: "drhp-1",
        rhpId: "rhp-1",
        drhpNamespace: "drhp.pdf",
        rhpNamespace: "rhp.pdf",
        domainId: "tenant-1",
        domain: "tenant.example",
      },
      currentWorkspace: "ws-1",
      userDomain: "tenant.example",
    };
    const res = mockRes();

    await reportController.create(req, res);

    expect(Report.deleteMany).not.toHaveBeenCalled();
    expect(Report.findOneAndUpdate).toHaveBeenCalledWith(
      {
        domainId: "tenant-1",
        workspaceId: "ws-1",
        drhpNamespace: "drhp.pdf",
        rhpNamespace: "rhp.pdf",
      },
      expect.objectContaining({
        $set: expect.objectContaining({
          title: "R",
          content: "C",
        }),
        $setOnInsert: expect.objectContaining({
          id: expect.any(String),
        }),
      }),
      expect.objectContaining({
        upsert: true,
        new: true,
      })
    );
    expect(res.status).toHaveBeenCalledWith(201);
  });
});
