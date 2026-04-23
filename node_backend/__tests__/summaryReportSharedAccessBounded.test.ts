import { summaryController } from "../controllers/summaryController";
import { reportController } from "../controllers/reportController";
jest.mock("../services/realtimeEmitter", () => ({
  emitToWorkspace: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../models/Summary", () => ({
  Summary: {
    find: jest.fn(),
  },
}));
jest.mock("../models/Report", () => ({
  Report: {
    find: jest.fn(),
  },
}));
jest.mock("../models/SharePermission", () => ({
  SharePermission: {
    find: jest.fn(),
  },
}));
jest.mock("../models/Document", () => ({
  Document: {
    find: jest.fn(),
  },
}));
jest.mock("../models/Directory", () => ({
  Directory: {
    find: jest.fn(),
    findOne: jest.fn(),
  },
}));

function mockRes() {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

const listChain = (rows: any[]) => ({
  sort: jest.fn().mockReturnThis(),
  skip: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  lean: jest.fn().mockResolvedValue(rows),
});
const selectChain = (rows: any[]) => ({
  select: jest.fn().mockResolvedValue(rows),
});

describe("summary/report shared access bounded query behavior", () => {
  const { Summary } = jest.requireMock("../models/Summary");
  const { Report } = jest.requireMock("../models/Report");
  const { SharePermission } = jest.requireMock("../models/SharePermission");
  const { Document } = jest.requireMock("../models/Document");
  const { Directory } = jest.requireMock("../models/Directory");

  beforeEach(() => {
    jest.clearAllMocks();
    Summary.find.mockReturnValue(listChain([]));
    Report.find.mockReturnValue(listChain([]));
    SharePermission.find
      .mockResolvedValueOnce([{ resourceId: "dir-1" }, { resourceId: "dir-2" }])
      .mockResolvedValueOnce([{ resourceId: "dir-2" }, { resourceId: "dir-3" }])
      .mockResolvedValueOnce([{ resourceId: "dir-4" }]);
    Directory.find
      .mockImplementationOnce(() =>
        selectChain([
          { id: "dir-1", domain: "acme.com", workspaceId: "ws-1" },
          { id: "dir-2", domain: "acme.com", workspaceId: "ws-1" },
        ])
      )
      .mockResolvedValueOnce([
        {
          id: "shared-copy-1",
          isShared: true,
          sharedFromDirectoryId: "origin-dir-1",
          sharedFromDomain: "acme.com",
          sharedFromWorkspaceId: "ws-2",
        },
        {
          id: "shared-copy-2",
          isShared: true,
          sharedFromDirectoryId: "origin-dir-2",
          sharedFromDomain: "acme.com",
          sharedFromWorkspaceId: "ws-3",
        },
      ])
      .mockImplementationOnce(() =>
        selectChain([
          { id: "origin-dir-1", domain: "acme.com", workspaceId: "ws-2" },
          { id: "origin-dir-2", domain: "acme.com", workspaceId: "ws-3" },
        ])
      );
    Document.find
      .mockResolvedValueOnce([{ id: "doc-a", namespace: "ns-a" }, { id: "doc-b", namespace: "ns-b" }])
      .mockImplementationOnce(() => selectChain([{ id: "doc-c", namespace: "ns-c" }]));
  });

  it("summary.getAll avoids per-directory findOne fanout", async () => {
    const req: any = {
      user: { _id: "user-1", email: "u@example.com" },
      userDomain: "acme.com",
      currentWorkspace: "ws-1",
      query: { limit: "50", offset: "0" },
    };
    const res = mockRes();
    await summaryController.getAll(req, res);

    expect(Directory.findOne).not.toHaveBeenCalled();
    expect(Document.find.mock.calls.length).toBeLessThanOrEqual(2);
    expect(res.status).not.toHaveBeenCalledWith(500);
  });

  it("report.getAll avoids per-directory findOne fanout", async () => {
    SharePermission.find.mockReset();
    SharePermission.find
      .mockResolvedValueOnce([{ resourceId: "dir-1" }])
      .mockResolvedValueOnce([{ resourceId: "dir-2" }])
      .mockResolvedValueOnce([{ resourceId: "dir-3" }]);
    Directory.find.mockReset();
    Directory.find
      .mockImplementationOnce(() =>
        selectChain([{ id: "dir-1", domain: "acme.com", workspaceId: "ws-1" }])
      )
      .mockResolvedValueOnce([
        {
          id: "shared-copy-1",
          isShared: true,
          sharedFromDirectoryId: "origin-dir-1",
          sharedFromDomain: "acme.com",
          sharedFromWorkspaceId: "ws-2",
        },
      ])
      .mockImplementationOnce(() =>
        selectChain([{ id: "origin-dir-1", domain: "acme.com", workspaceId: "ws-2" }])
      );
    Document.find.mockReset();
    Document.find
      .mockResolvedValueOnce([{ id: "doc-a", namespace: "ns-a" }])
      .mockImplementationOnce(() => selectChain([{ id: "doc-b", namespace: "ns-b" }]));

    const req: any = {
      user: { _id: "user-1", email: "u@example.com" },
      userDomain: "acme.com",
      currentWorkspace: "ws-1",
      query: { limit: "50", offset: "0" },
    };
    const res = mockRes();
    await reportController.getAll(req, res);

    expect(Directory.findOne).not.toHaveBeenCalled();
    expect(Document.find.mock.calls.length).toBeLessThanOrEqual(2);
    expect(res.status).not.toHaveBeenCalledWith(500);
  });
});
