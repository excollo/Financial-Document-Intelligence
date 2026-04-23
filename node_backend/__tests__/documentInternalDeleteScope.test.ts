import { documentController } from "../controllers/documentController";

jest.mock("../models/Document", () => ({
  Document: {
    findOne: jest.fn(),
    deleteOne: jest.fn(),
  },
}));
jest.mock("../models/Summary", () => ({
  Summary: {
    deleteMany: jest.fn(),
  },
}));
jest.mock("../models/Chat", () => ({
  Chat: {
    deleteMany: jest.fn(),
  },
}));
jest.mock("../models/Report", () => ({
  Report: {
    deleteMany: jest.fn(),
  },
}));
jest.mock("../services/storageService", () => ({
  storageService: {
    deleteFile: jest.fn().mockResolvedValue(undefined),
  },
}));
jest.mock("../services/realtimeEmitter", () => ({
  emitToWorkspace: jest.fn(),
}));

function mockRes() {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe("internal delete cascade scoping", () => {
  const { Document } = jest.requireMock("../models/Document");
  const { Summary } = jest.requireMock("../models/Summary");
  const { Chat } = jest.requireMock("../models/Chat");
  const { Report } = jest.requireMock("../models/Report");
  const { emitToWorkspace } = jest.requireMock("../services/realtimeEmitter");

  beforeEach(() => {
    jest.clearAllMocks();
    jest
      .spyOn(documentController, "invalidateWorkspaceDocumentCaches")
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("scopes all deletes to document workspace/domain", async () => {
    Document.findOne.mockResolvedValue({
      id: "doc-1",
      name: "Doc",
      namespace: "ns-1",
      workspaceId: "ws-1",
      domainId: "tenant-1",
      fileKey: "blob-1",
    });
    Document.deleteOne.mockResolvedValue({ deletedCount: 1 });
    Summary.deleteMany.mockResolvedValue({ deletedCount: 1 });
    Chat.deleteMany.mockResolvedValue({ deletedCount: 1 });
    Report.deleteMany.mockResolvedValue({ deletedCount: 1 });

    const req: any = {
      params: { id: "doc-1" },
      body: { documentId: "doc-1", workspaceId: "ws-1", domainId: "tenant-1" },
    };
    const res = mockRes();
    await documentController.deleteInternal(req, res);

    expect(Summary.deleteMany).toHaveBeenCalledWith({
      documentId: "doc-1",
      workspaceId: "ws-1",
      domainId: "tenant-1",
    });
    expect(Chat.deleteMany).toHaveBeenCalledWith({
      documentId: "doc-1",
      workspaceId: "ws-1",
      domainId: "tenant-1",
    });
    expect(Report.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "ws-1",
        domainId: "tenant-1",
      })
    );
    expect(Document.deleteOne).toHaveBeenCalledWith({
      id: "doc-1",
      workspaceId: "ws-1",
      domainId: "tenant-1",
    });
  });

  it("report namespace cleanup remains scoped under collisions", async () => {
    Document.findOne.mockResolvedValue({
      id: "doc-2",
      name: "Doc 2",
      namespace: "same-ns",
      workspaceId: "ws-main",
      domainId: "tenant-main",
      fileKey: "blob-2",
    });
    Document.deleteOne.mockResolvedValue({ deletedCount: 1 });
    Summary.deleteMany.mockResolvedValue({ deletedCount: 1 });
    Chat.deleteMany.mockResolvedValue({ deletedCount: 1 });
    Report.deleteMany.mockResolvedValue({ deletedCount: 1 });

    const req: any = {
      params: { id: "doc-2" },
      body: { documentId: "doc-2", workspaceId: "ws-main", domainId: "tenant-main" },
    };
    const res = mockRes();
    await documentController.deleteInternal(req, res);

    const reportDeleteCall = Report.deleteMany.mock.calls[0][0];
    expect(reportDeleteCall.workspaceId).toBe("ws-main");
    expect(reportDeleteCall.domainId).toBe("tenant-main");
    expect(reportDeleteCall.$or).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ drhpNamespace: "same-ns" }),
        expect.objectContaining({ rhpNamespace: "same-ns" }),
      ])
    );
  });

  it("rejects missing delete scope metadata", async () => {
    const req: any = { params: { id: "doc-3" }, body: { documentId: "doc-3" } };
    const res = mockRes();
    await documentController.deleteInternal(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(Document.findOne).not.toHaveBeenCalled();
  });

  it("rejects path/body document id mismatch", async () => {
    const req: any = {
      params: { id: "doc-3" },
      body: { documentId: "doc-other", workspaceId: "ws-1", domainId: "tenant-1" },
    };
    const res = mockRes();
    await documentController.deleteInternal(req, res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(Document.findOne).not.toHaveBeenCalled();
  });

  it("rejects delete for wrong workspace/domain scope", async () => {
    Document.findOne.mockResolvedValue(null);
    const req: any = {
      params: { id: "doc-3" },
      body: { documentId: "doc-3", workspaceId: "ws-wrong", domainId: "tenant-wrong" },
    };
    const res = mockRes();
    await documentController.deleteInternal(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("returns 502 when delete succeeds but realtime emit fails", async () => {
    Document.findOne.mockResolvedValue({
      id: "doc-4",
      name: "Doc 4",
      namespace: "ns-4",
      workspaceId: "ws-1",
      domainId: "tenant-1",
      fileKey: "blob-4",
    });
    Document.deleteOne.mockResolvedValue({ deletedCount: 1 });
    Summary.deleteMany.mockResolvedValue({ deletedCount: 1 });
    Chat.deleteMany.mockResolvedValue({ deletedCount: 1 });
    Report.deleteMany.mockResolvedValue({ deletedCount: 1 });
    emitToWorkspace.mockRejectedValueOnce(new Error("socket down"));

    const req: any = {
      params: { id: "doc-4" },
      body: { documentId: "doc-4", workspaceId: "ws-1", domainId: "tenant-1" },
    };
    const res = mockRes();
    await documentController.deleteInternal(req, res);
    expect(res.status).toHaveBeenCalledWith(502);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: "REALTIME_EMIT_FAILED" })
    );
  });
});
