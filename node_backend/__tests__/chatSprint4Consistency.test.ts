import { chatController } from "../controllers/chatController";

jest.mock("../models/Chat", () => {
  const ChatMock: any = jest.fn().mockImplementation((data: any) => ({
    ...data,
    _id: "mongo-chat-id",
    messages: Array.isArray(data?.messages) ? data.messages : [],
    save: jest.fn().mockResolvedValue(undefined),
  }));
  ChatMock.findOne = jest.fn();
  ChatMock.findOneAndUpdate = jest.fn();
  ChatMock.findOneAndDelete = jest.fn();
  ChatMock.deleteOne = jest.fn().mockResolvedValue({ deletedCount: 1 });
  ChatMock.aggregate = jest.fn();
  return { Chat: ChatMock };
});

jest.mock("../models/ChatMessage", () => ({
  ChatMessage: {
    insertMany: jest.fn(),
    updateOne: jest.fn(),
    deleteOne: jest.fn(),
    deleteMany: jest.fn(),
    countDocuments: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
  },
}));

jest.mock("../models/Document", () => ({
  Document: {
    findOne: jest.fn(),
  },
}));

jest.mock("../models/User", () => ({
  User: {
    findById: jest.fn(),
    findOne: jest.fn(),
  },
}));
jest.mock("../services/metricsService", () => ({
  metricsService: {
    emit: jest.fn(),
  },
}));
jest.mock("../services/cacheService", () => ({
  cacheService: {
    setJson: jest.fn().mockResolvedValue(undefined),
  },
}));

function mockRes() {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

function mockChatMessageFind(rows: any[]) {
  const chain: any = {
    sort: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(rows),
  };
  return chain;
}

describe("Sprint 4 chat consistency hardening", () => {
  const { Chat } = jest.requireMock("../models/Chat");
  const { ChatMessage } = jest.requireMock("../models/ChatMessage");
  const { Document } = jest.requireMock("../models/Document");
  const { User } = jest.requireMock("../models/User");
  const { metricsService } = jest.requireMock("../services/metricsService");
  const { cacheService } = jest.requireMock("../services/cacheService");

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("chat.create fails explicitly and rolls back when ChatMessage write fails", async () => {
    Document.findOne.mockResolvedValue({ id: "doc-1" });
    User.findById.mockReturnValue({
      select: jest.fn().mockResolvedValue({ domainId: "tenant-1" }),
    });
    ChatMessage.insertMany.mockRejectedValue(new Error("write failed"));

    const req: any = {
      body: {
        id: "chat-1",
        title: "chat",
        documentId: "doc-1",
        messages: [{ id: "m1", content: "hello", isUser: true, timestamp: new Date().toISOString() }],
      },
      user: { _id: "u-1", microsoftId: "ms-1" },
      userDomain: "acme.com",
      currentWorkspace: "ws-1",
    };
    const res = mockRes();

    await chatController.create(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: "CHAT_MESSAGE_DUAL_WRITE_FAILED" })
    );
    expect(Chat.deleteOne).toHaveBeenCalled();
  });

  it("fetchMessages merges ChatMessage + legacy embedded messages without truncation", async () => {
    ChatMessage.find.mockReturnValue(
      mockChatMessageFind([
        { messageId: "m1", content: "first", isUser: true, timestamp: new Date("2026-01-01T00:00:00Z") },
        { messageId: "m2", content: "second", isUser: false, timestamp: new Date("2026-01-01T00:01:00Z") },
      ])
    );
    Chat.findOne.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          messages: [
            { id: "m1", content: "first", isUser: true, timestamp: new Date("2026-01-01T00:00:00Z") },
            { id: "m3", content: "third", isUser: true, timestamp: new Date("2026-01-01T00:02:00Z") },
          ],
        }),
      }),
    });

    const result = await chatController.fetchMessages("chat-1", 50, 0, { includeLegacy: true });

    expect(result.map((m: any) => m.id)).toEqual(["m1", "m2", "m3"]);
  });

  it("getAdminChatDetail returns legacy messages when ChatMessage rows are missing", async () => {
    Chat.findOne
      .mockReturnValueOnce({
        select: jest.fn().mockResolvedValue({
          id: "chat-1",
          title: "admin chat",
          documentId: "doc-1",
          domain: "acme.com",
          workspaceId: "ws-1",
          microsoftId: "ms-1",
        }),
      })
      .mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue({
            messages: [
              { id: "m-legacy", content: "legacy", isUser: true, timestamp: new Date("2026-01-01T00:00:00Z") },
            ],
          }),
        }),
      });

    Document.findOne.mockReturnValue({
      select: jest.fn().mockResolvedValue({
        id: "doc-1",
        name: "Doc",
        type: "DRHP",
      }),
    });
    User.findOne.mockReturnValue({
      select: jest.fn().mockResolvedValue({
        _id: "u-1",
        name: "User",
        email: "u@example.com",
        microsoftId: "ms-1",
      }),
    });
    ChatMessage.find.mockReturnValue(mockChatMessageFind([]));

    const req: any = {
      params: { id: "chat-1" },
      query: { limit: "50", offset: "0" },
      user: { role: "admin", domain: "acme.com" },
      userDomain: "acme.com",
    };
    const res = mockRes();

    await chatController.getAdminChatDetail(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([expect.objectContaining({ id: "m-legacy" })]),
      })
    );
  });

  it("getMessages returns complete history when counts match but content is mismatched", async () => {
    const firstChatSelect = jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue({ id: "chat-1" }),
    });
    const secondChatSelect = jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        messages: [
          { id: "m1", content: "one", isUser: true, timestamp: new Date("2026-01-01T00:00:00Z") },
          { id: "m3", content: "legacy-only", isUser: false, timestamp: new Date("2026-01-01T00:02:00Z") },
        ],
      }),
    });
    Chat.findOne
      .mockReturnValueOnce({ select: firstChatSelect })
      .mockReturnValueOnce({ select: secondChatSelect });
    ChatMessage.find.mockReturnValue(
      mockChatMessageFind([
        { messageId: "m1", content: "one", isUser: true, timestamp: new Date("2026-01-01T00:00:00Z") },
        { messageId: "m2", content: "two", isUser: false, timestamp: new Date("2026-01-01T00:01:00Z") },
      ])
    );

    const req: any = {
      params: { chatId: "chat-1" },
      query: { limit: "20", offset: "0" },
      user: { microsoftId: "ms-1" },
      userDomain: "acme.com",
      currentWorkspace: "ws-1",
    };
    const res = mockRes();

    await chatController.getMessages(req, res);

    expect(firstChatSelect).toHaveBeenCalledWith("id");
    expect(secondChatSelect).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ id: "m1" }),
        expect.objectContaining({ id: "m2" }),
        expect.objectContaining({ id: "m3" }),
      ])
    );
  });

  it("addMessage rollback does not delete existing message on chat save failure", async () => {
    const save = jest.fn().mockRejectedValue(new Error("chat save failed"));
    Chat.findOne.mockResolvedValue({
      id: "chat-1",
      documentId: "doc-1",
      domain: "acme.com",
      workspaceId: "ws-1",
      microsoftId: "ms-1",
      userId: null,
      messages: [],
      updatedAt: new Date(),
      save,
    });
    ChatMessage.findOne.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          content: "existing",
          isUser: false,
          timestamp: new Date("2026-01-01T00:00:00Z"),
        }),
      }),
    });
    ChatMessage.updateOne.mockResolvedValue({ acknowledged: true });

    const req: any = {
      params: { chatId: "chat-1" },
      body: { id: "m-existing", content: "new-content", isUser: true },
      user: { microsoftId: "ms-1" },
      userDomain: "acme.com",
      currentWorkspace: "ws-1",
    };
    const res = mockRes();

    await chatController.addMessage(req, res);

    expect(ChatMessage.deleteOne).not.toHaveBeenCalled();
    expect(ChatMessage.updateOne).toHaveBeenCalledTimes(2);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it("addMessage emits compensation failure signal when rollback fails", async () => {
    const save = jest.fn().mockRejectedValue(new Error("chat save failed"));
    Chat.findOne.mockResolvedValue({
      id: "chat-1",
      documentId: "doc-1",
      domain: "acme.com",
      workspaceId: "ws-1",
      microsoftId: "ms-1",
      userId: null,
      messages: [],
      updatedAt: new Date(),
      save,
    });
    ChatMessage.findOne.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(null),
      }),
    });
    ChatMessage.updateOne.mockResolvedValue({ acknowledged: true });
    ChatMessage.deleteOne.mockRejectedValue(new Error("rollback delete failed"));

    const req: any = {
      params: { chatId: "chat-1" },
      body: { id: "m-new", content: "new-content", isUser: true },
      user: { microsoftId: "ms-1" },
      userDomain: "acme.com",
      currentWorkspace: "ws-1",
    };
    const res = mockRes();

    await chatController.addMessage(req, res);

    expect(metricsService.emit).toHaveBeenCalledWith(
      "COMPENSATION_FAILURE",
      1,
      expect.objectContaining({ component: "chat_add_message", chat_id: "chat-1", message_id: "m-new" })
    );
    expect(cacheService.setJson).toHaveBeenCalledWith(
      "repair:chat:chat-1:m-new",
      expect.objectContaining({ code: "CHAT_COMPENSATION_FAILED" }),
      86400
    );
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: "CHAT_COMPENSATION_FAILED" })
    );
  });

  it("fetchMessages includeLegacy always uses bounded ChatMessage queries", async () => {
    const rows = Array.from({ length: 120 }).map((_, idx) => ({
      messageId: `m-${idx}`,
      content: `msg-${idx}`,
      isUser: idx % 2 === 0,
      timestamp: new Date(`2026-01-01T00:${String(idx % 60).padStart(2, "0")}:00Z`),
    }));
    const limitSpy = jest.fn().mockImplementation(function (this: any, n: number) {
      this.__limit = n;
      return this;
    });
    const skipSpy = jest.fn().mockImplementation(function (this: any, n: number) {
      this.__skip = n;
      return this;
    });
    ChatMessage.find.mockImplementation(() => {
      const chain: any = {
        __skip: 0,
        __limit: 0,
        sort: jest.fn().mockReturnThis(),
        skip: skipSpy,
        limit: limitSpy,
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockImplementation(function (this: any) {
          const start = this.__skip || 0;
          const end = start + (this.__limit || 0);
          return Promise.resolve(rows.slice(start, end));
        }),
      };
      return chain;
    });
    Chat.findOne.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue({ messages: [] }),
      }),
    });

    await chatController.fetchMessages("chat-1", 20, 80, { includeLegacy: true });
    expect(ChatMessage.find).toHaveBeenCalled();
    expect(limitSpy).toHaveBeenCalled();
  });

  it("update rejects message-array mutation to prevent Chat/ChatMessage divergence", async () => {
    const req: any = {
      params: { id: "chat-1" },
      body: {
        title: "new title",
        messages: [{ id: "m1", content: "mutate", isUser: true, timestamp: new Date().toISOString() }],
      },
      user: { microsoftId: "ms-1" },
      userDomain: "acme.com",
      currentWorkspace: "ws-1",
    };
    const res = mockRes();

    await chatController.update(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: "CHAT_MESSAGES_IMMUTABLE" })
    );
    expect(Chat.findOneAndUpdate).not.toHaveBeenCalled();
  });
});

