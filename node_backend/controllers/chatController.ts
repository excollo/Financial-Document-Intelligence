import { Request, Response } from "express";
import { Chat } from "../models/Chat";
import { ChatMessage } from "../models/ChatMessage";
import { ChatJobStatus } from "../models/ChatJobStatus";
import { Document } from "../models/Document";
import { User } from "../models/User";
import axios from "axios";
import { buildSignedInternalJsonRequest } from "../services/internalRequestSigning";
import { metricsService } from "../services/metricsService";
import { cacheService } from "../services/cacheService";
import { emitToWorkspace } from "../services/realtimeEmitter";

interface AuthRequest extends Request {
  user?: any;
  userDomain?: string;
  currentWorkspace?: string;
}

const parsePagination = (query: any) => {
  const limitRaw = Number(query?.limit ?? query?.pageSize ?? 50);
  const offsetRaw = Number(query?.offset ?? ((Number(query?.page || 1) - 1) * limitRaw));
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50;
  const offset = Number.isFinite(offsetRaw) ? Math.max(offsetRaw, 0) : 0;
  return { limit, offset };
};

const normalizeMessage = (m: any) => ({
  id: m?.id || m?.messageId || null,
  content: m?.content,
  isUser: !!m?.isUser,
  timestamp: new Date(m?.timestamp || Date.now()),
});

const messageDedupeKey = (m: any) => {
  if (m.id) return `id:${m.id}`;
  return `fallback:${m.content || ""}:${m.isUser ? 1 : 0}:${new Date(m.timestamp).toISOString()}`;
};

const REPAIR_FLAG_TTL_SECONDS = 24 * 60 * 60;

export const chatController = {
  async sendMessage(req: AuthRequest, res: Response) {
    try {
      const { message, namespace, documentType, history, sessionId } = req.body;

      if (!message || !namespace || !documentType) {
        return res.status(400).json({ error: "Missing required fields (message, namespace, documentType)" });
      }

      const pythonApiUrl = process.env.PYTHON_API_URL || "http://localhost:8000";
      const CHAT_TIMEOUT_MS = Number(process.env.CHAT_TIMEOUT_MS || 240000);

      console.log(`Forwarding chat query to Python: ${namespace}`);

      const payload = {
        message,
        namespace,
        document_type: documentType,
        history: history || [],
        authorization: req.headers.authorization,
        sessionId: sessionId
      };

      const chatUrl = `${pythonApiUrl}/chats/query`;
      const signed = buildSignedInternalJsonRequest("POST", chatUrl, payload);
      const pythonResponse = await axios.post(chatUrl, signed.data, {
        headers: signed.headers,
        timeout: Number.isFinite(CHAT_TIMEOUT_MS) && CHAT_TIMEOUT_MS > 0 ? CHAT_TIMEOUT_MS : 240000,
      });

      if (pythonResponse.data && pythonResponse.data.status === "success") {
        const callbackJobId = String(pythonResponse.data.job_id || "").trim();
        if (callbackJobId) {
          let domainId = String((req.user as any)?.domainId || "");
          if (!domainId && (req.user as any)?._id) {
            const userWithDomain = await User.findById((req.user as any)._id).select("domainId").lean();
            domainId = String((userWithDomain as any)?.domainId || "");
          }
          const workspaceId = String(req.currentWorkspace || req.userDomain || "");
          if (workspaceId && domainId) {
            await ChatJobStatus.findOneAndUpdate(
              { job_id: callbackJobId },
              {
                $set: {
                  chat_id: String(req.body?.chatId || req.body?.sessionId || ""),
                  namespace: String(namespace || ""),
                  workspace_id: workspaceId,
                  domain_id: domainId,
                  user_id: String((req.user as any)?._id || ""),
                  status: "processing",
                  error_message: null,
                },
              },
              { upsert: true, new: true }
            );
          }
        }
        return res.json({
          response: pythonResponse.data.output,
          job_id: pythonResponse.data.job_id,
          usage: pythonResponse.data.usage,
          duration: pythonResponse.data.duration
        });
      }

      res.status(500).json({ error: "Failed to get response from Chat AI", details: pythonResponse.data });
    } catch (error: any) {
      console.error("Error in sendMessage:", error.message);
      res.status(500).json({ error: "Chat processing failed", message: error.message });
    }
  },

  async getAll(req: AuthRequest, res: Response) {
    try {
      // Get current workspace from request
      const currentWorkspace = req.currentWorkspace || req.userDomain;

      const query: any = {
        domain: req.userDomain, // Filter by user's domain
        workspaceId: currentWorkspace, // Filter by user's workspace
      };

      // Always scope to requesting user (separate chats by user)
      if (req.user?.microsoftId) {
        query.microsoftId = req.user.microsoftId;
      } else if (req.user?._id) {
        query.userId = req.user._id.toString();
      } else {
        return res.status(400).json({ error: "No user identifier found" });
      }

      const { limit, offset } = parsePagination(req.query);
      const chats = await Chat.find(query)
        .sort({ updatedAt: -1 })
        .skip(offset)
        .limit(limit)
        .select("id title updatedAt documentId domain domainId workspaceId microsoftId userId")
        .lean();
      res.json(chats);
    } catch (error) {
      console.error("Error fetching chats:", error);
      res.status(500).json({ error: "Failed to fetch chats" });
    }
  },

  async getByDocumentId(req: AuthRequest, res: Response) {
    try {
      const linkAccess = (req as any).linkAccess;
      const currentWorkspace = req.currentWorkspace || req.userDomain;
      const query: any = {
        documentId: req.params.documentId,
        domain: req.userDomain, // Filter by user's domain (or link domain)
        workspaceId: currentWorkspace, // Ensure same workspace
      };

      // Handle link access - allow access to chats for linked document
      if (linkAccess && linkAccess.resourceType === "document" && linkAccess.resourceId === req.params.documentId) {
        // For link access, don't filter by user - show all chats for the document
        // This allows shared document recipients to see existing chats
      } else {
        // Always scope to requesting user for normal access
        if (req.user?.microsoftId) {
          query.microsoftId = req.user.microsoftId;
        } else if (req.user?._id) {
          query.userId = req.user._id.toString();
        } else {
          return res.status(400).json({ error: "No user identifier found" });
        }
      }

      const { limit, offset } = parsePagination(req.query);
      const chats = await Chat.find(query)
        .sort({ updatedAt: -1 })
        .skip(offset)
        .limit(limit)
        .select("id title updatedAt documentId domain domainId workspaceId microsoftId userId")
        .lean();
      res.json(chats);
    } catch (error) {
      console.error("Error fetching chats:", error);
      res.status(500).json({ error: "Failed to fetch chats" });
    }
  },

  async create(req: AuthRequest, res: Response) {
    try {
      const user = req.user;
      const chatData = { ...req.body };

      // Get current workspace from request
      const currentWorkspace = req.currentWorkspace || req.userDomain;

      // Check if the document exists by id and belongs to user's domain and workspace
      const document = await Document.findOne({
        id: chatData.documentId,
        domain: req.userDomain,
        workspaceId: currentWorkspace,
      });
      if (!document) {
        return res.status(404).json({ error: "Document not found" });
      }

      // Get user's domainId
      const userWithDomain = await User.findById(user._id).select("domainId");
      if (!userWithDomain?.domainId) {
        return res.status(400).json({ error: "User domainId not found. Please contact administrator." });
      }

      // Add domain, domainId, and workspace to chat data
      chatData.domain = req.userDomain;
      chatData.domainId = userWithDomain.domainId; // Link to Domain schema
      chatData.workspaceId = currentWorkspace;

      if (user.microsoftId) {
        chatData.microsoftId = user.microsoftId;
      } else if (user._id) {
        chatData.userId = user._id.toString();
      } else {
        return res.status(400).json({ error: "No user identifier found" });
      }

      chatData.messages = Array.isArray(req.body.messages)
        ? req.body.messages
        : [req.body.messages];
      const chat = new Chat(chatData);
      await chat.save();

      // Dual-write chat messages to the scalable message collection.
      if (Array.isArray(chatData.messages) && chatData.messages.length > 0) {
        const messageDocs = chatData.messages
          .filter((m: any) => !!m?.id && !!m?.content)
          .map((m: any) => ({
            chatId: chatData.id,
            messageId: m.id,
            documentId: chatData.documentId,
            domain: chatData.domain,
            workspaceId: chatData.workspaceId,
            microsoftId: chatData.microsoftId || null,
            userId: chatData.userId || null,
            content: m.content,
            isUser: !!m.isUser,
            timestamp: new Date(m.timestamp || Date.now()),
          }));
        if (messageDocs.length > 0) {
          try {
            await ChatMessage.insertMany(messageDocs, { ordered: false });
          } catch (dualWriteError) {
            await Chat.deleteOne({ _id: (chat as any)._id }).catch(() => undefined);
            return res.status(500).json({
              error: "Failed to persist chat messages",
              code: "CHAT_MESSAGE_DUAL_WRITE_FAILED",
            });
          }
        }
      }
      res.status(201).json(chat);
    } catch (error) {
      console.error("Error creating chat:", error);
      res.status(500).json({ error: "Failed to create chat" });
    }
  },

  async addMessage(req: AuthRequest, res: Response) {
    try {
      const currentWorkspace = req.currentWorkspace || req.userDomain;
      const query: any = {
        id: req.params.chatId,
        domain: req.userDomain, // Ensure user can only access chats from their domain
        workspaceId: currentWorkspace,
      };

      // Always scope to requesting user
      if (req.user?.microsoftId) {
        query.microsoftId = req.user.microsoftId;
      } else if (req.user?._id) {
        query.userId = req.user._id.toString();
      } else {
        return res.status(400).json({ error: "No user identifier found" });
      }

      const chat = await Chat.findOne(query);
      if (!chat) {
        return res.status(404).json({ error: "Chat not found" });
      }
      if (!req.body?.id || !req.body?.content) {
        return res.status(400).json({
          error: "Message id and content are required",
          code: "INVALID_CHAT_MESSAGE",
        });
      }
      const message = {
        ...req.body,
        timestamp: new Date(req.body.timestamp || Date.now()),
      };
      const existingMessage = await ChatMessage.findOne({
        chatId: chat.id,
        messageId: message.id,
      })
        .select("content isUser timestamp")
        .lean();
      try {
        await ChatMessage.updateOne(
          { chatId: chat.id, messageId: message.id },
          {
            $setOnInsert: {
              chatId: chat.id,
              messageId: message.id,
              documentId: chat.documentId,
              domain: chat.domain,
              workspaceId: chat.workspaceId,
              microsoftId: chat.microsoftId || null,
              userId: chat.userId || null,
            },
            $set: {
              content: message.content,
              isUser: !!message.isUser,
              timestamp: new Date(message.timestamp || Date.now()),
            },
          },
          { upsert: true }
        );
      } catch (error) {
        return res.status(500).json({
          error: "Failed to persist chat message",
          code: "CHAT_MESSAGE_DUAL_WRITE_FAILED",
        });
      }
      chat.messages.push(message);
      chat.updatedAt = new Date();
      try {
        await chat.save();
      } catch (error) {
        let rollbackError: any = null;
        try {
          if (existingMessage) {
            await ChatMessage.updateOne(
              { chatId: chat.id, messageId: message.id },
              {
                $set: {
                  content: existingMessage.content,
                  isUser: !!existingMessage.isUser,
                  timestamp: new Date(existingMessage.timestamp),
                },
              }
            );
          } else {
            await ChatMessage.deleteOne({ chatId: chat.id, messageId: message.id });
          }
        } catch (rollbackFailure: any) {
          rollbackError = rollbackFailure;
        }
        if (rollbackError) {
          console.error(
            JSON.stringify({
              event: "chat_compensation_failed",
              code: "CHAT_COMPENSATION_FAILED",
              chatId: chat.id,
              messageId: message.id,
              workspaceId: chat.workspaceId || null,
              domain: chat.domain || null,
              rollbackError: rollbackError?.message || String(rollbackError),
            })
          );
          metricsService.emit("COMPENSATION_FAILURE", 1, {
            component: "chat_add_message",
            chat_id: chat.id,
            message_id: message.id,
            workspace_id: chat.workspaceId || "unknown",
            domain: chat.domain || "unknown",
          });
          await cacheService
            .setJson(
              `repair:chat:${chat.id}:${message.id}`,
              {
                code: "CHAT_COMPENSATION_FAILED",
                chatId: chat.id,
                messageId: message.id,
                workspaceId: chat.workspaceId || null,
                domain: chat.domain || null,
                createdAt: new Date().toISOString(),
              },
              REPAIR_FLAG_TTL_SECONDS
            )
            .catch(() => undefined);
          return res.status(500).json({
            error: "Failed to compensate chat write",
            code: "CHAT_COMPENSATION_FAILED",
          });
        }
        return res.status(500).json({
          error: "Failed to persist chat",
          code: "CHAT_WRITE_FAILED",
        });
      }
      res.json(chat);
    } catch (error) {
      console.error("Error adding message:", error);
      res.status(500).json({ error: "Failed to add message" });
    }
  },

  async update(req: AuthRequest, res: Response) {
    try {
      if (Object.prototype.hasOwnProperty.call(req.body || {}, "messages")) {
        return res.status(400).json({
          error: "Updating messages via chat update is not supported. Use addMessage endpoint.",
          code: "CHAT_MESSAGES_IMMUTABLE",
        });
      }
      const currentWorkspace = req.currentWorkspace || req.userDomain;
      const query: any = {
        id: req.params.id,
        domain: req.userDomain, // Ensure user can only update chats from their domain
        workspaceId: currentWorkspace,
      };

      // Always scope to requesting user
      if (req.user?.microsoftId) {
        query.microsoftId = req.user.microsoftId;
      } else if (req.user?._id) {
        query.userId = req.user._id.toString();
      } else {
        return res.status(400).json({ error: "No user identifier found" });
      }

      const chat = await Chat.findOneAndUpdate(
        query,
        {
          ...Object.fromEntries(
            Object.entries(req.body || {}).filter(([key]) => key !== "messages")
          ),
          updatedAt: new Date(),
        },
        { new: true }
      );
      if (!chat) {
        return res.status(404).json({ error: "Chat not found" });
      }
      res.json(chat);
    } catch (error) {
      console.error("Error updating chat:", error);
      res.status(500).json({ error: "Failed to update chat" });
    }
  },

  async delete(req: AuthRequest, res: Response) {
    try {
      const currentWorkspace = req.currentWorkspace || req.userDomain;
      const query: any = {
        id: req.params.id,
        domain: req.userDomain, // Ensure user can only delete chats from their domain
        workspaceId: currentWorkspace,
      };

      // Always scope to requesting user
      if (req.user?.microsoftId) {
        query.microsoftId = req.user.microsoftId;
      } else if (req.user?._id) {
        query.userId = req.user._id.toString();
      } else {
        return res.status(400).json({ error: "No user identifier found" });
      }

      const deleted: any = await Chat.findOneAndDelete(query);
      const chat = deleted?.value || deleted;
      if (!chat) {
        return res.status(404).json({ error: "Chat not found" });
      }
      await ChatMessage.deleteMany({ chatId: chat.id });
      res.json({ message: "Chat deleted successfully" });
    } catch (error) {
      console.error("Error deleting chat:", error);
      res.status(500).json({ error: "Failed to delete chat" });
    }
  },

  async chatStatusUpdate(req: Request, res: Response) {
    try {
      const { jobId, status, error } = req.body;
      if (!jobId || !status) {
        return res.status(400).json({ message: "Missing jobId or status" });
      }
      const normalizedStatus = String(status).toLowerCase() === "success"
        ? "completed"
        : String(status).toLowerCase();
      const mappedStatus = ["completed", "failed", "processing", "completed_with_errors"].includes(normalizedStatus)
        ? normalizedStatus
        : "processing";
      const tracked = await ChatJobStatus.findOneAndUpdate(
        { job_id: String(jobId) },
        {
          $set: {
            status: mappedStatus,
            error_message: typeof error === "string" ? error : error?.message || null,
          },
        },
        { new: true }
      ).lean();
      if (!tracked) {
        console.warn("chatStatusUpdate received without tracked mapping", {
          jobId,
          status: mappedStatus,
          hasError: !!error,
        });
      } else {
        await emitToWorkspace(String(tracked.workspace_id), "chat_status", {
          jobId: String(jobId),
          status: mappedStatus,
          error,
          chatId: tracked.chat_id || undefined,
        });
      }
      res.status(200).json({
        message: "Chat status update processed",
        jobId,
        status: mappedStatus,
        error,
      });
    } catch (err) {
      res.status(500).json({
        message: "Failed to process chat status update",
        error: err instanceof Error ? err.message : err,
      });
    }
  },

  // Admin: Get all chats (filtered by domain)
  async getAllAdmin(req: AuthRequest, res: Response) {
    try {
      const user = req.user;
      if (!user || user.role !== "admin") {
        return res.status(403).json({ error: "Admin access required" });
      }

      const query: any = {
        domain: req.user?.domain || req.userDomain, // Filter by user's domain
      };

      const { limit, offset } = parsePagination(req.query);
      const chats = await Chat.find(query)
        .sort({ updatedAt: -1 })
        .skip(offset)
        .limit(limit)
        .select("id title updatedAt documentId domain domainId workspaceId microsoftId userId")
        .lean();
      res.json(chats);
    } catch (error) {
      console.error("Error fetching all chats:", error);
      res.status(500).json({ error: "Failed to fetch chats" });
    }
  },

  // Admin: Get detailed chat with user/document context
  async getAdminChatDetail(req: AuthRequest, res: Response) {
    try {
      const user = req.user;
      if (!user || user.role !== "admin") {
        return res.status(403).json({ error: "Admin access required" });
      }

      const domain = req.user?.domain || req.userDomain;
      const chatId = req.params.id;

      const chat = await Chat.findOne({
        id: chatId,
        domain,
      }).select("id title updatedAt documentId domain workspaceId microsoftId userId");

      if (!chat) {
        return res.status(404).json({ error: "Chat not found" });
      }

      const document = await Document.findOne({
        id: chat.documentId,
        domain,
      }).select("id name type namespace rhpNamespace");

      let chatUser: any = null;
      if (chat.microsoftId) {
        chatUser = await User.findOne({ microsoftId: chat.microsoftId, domain }).select(
          "_id name email microsoftId"
        );
      } else if (chat.userId) {
        chatUser = await User.findById(chat.userId).select(
          "_id name email microsoftId"
        );
      }

      const { limit, offset } = parsePagination(req.query);
      const pagedMessages = await chatController.fetchMessages(chat.id, limit, offset, {
        includeLegacy: true,
      });

      return res.json({
        chat,
        document: document
          ? {
              id: document.id,
              name: document.name,
              type: document.type,
              namespace: document.namespace,
              rhpNamespace: document.rhpNamespace,
            }
          : null,
        user: chatUser
          ? {
              id: String(chatUser._id),
              name: chatUser.name || null,
              email: chatUser.email || null,
              microsoftId: chatUser.microsoftId || null,
            }
          : null,
        messages: pagedMessages,
      });
    } catch (error) {
      console.error("Error fetching admin chat detail:", error);
      res.status(500).json({ error: "Failed to fetch chat detail" });
    }
  },

  // Admin: Get chat statistics
  async getStats(req: AuthRequest, res: Response) {
    try {
      const user = req.user;
      if (!user || user.role !== "admin") {
        return res.status(403).json({ error: "Admin access required" });
      }

      const domain = req.user?.domain || req.userDomain;
      const domainFilter = { domain };

      const totalChats = await Chat.countDocuments(domainFilter);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const chatsToday = await Chat.countDocuments({
        ...domainFilter,
        updatedAt: { $gte: today },
      });

      const thisWeek = new Date();
      thisWeek.setDate(thisWeek.getDate() - 7);
      const chatsThisWeek = await Chat.countDocuments({
        ...domainFilter,
        updatedAt: { $gte: thisWeek },
      });

      const thisMonth = new Date();
      thisMonth.setMonth(thisMonth.getMonth() - 1);
      const chatsThisMonth = await Chat.countDocuments({
        ...domainFilter,
        updatedAt: { $gte: thisMonth },
      });

      // Get top documents by chat count (filtered by domain)
      const topDocuments = await Chat.aggregate([
        {
          $match: domainFilter,
        },
        {
          $group: {
            _id: "$documentId",
            chatCount: { $sum: 1 },
          },
        },
        {
          $sort: { chatCount: -1 },
        },
        {
          $limit: 10,
        },
      ]);

      res.json({
        totalChats,
        chatsToday,
        chatsThisWeek,
        chatsThisMonth,
        topDocuments,
      });
    } catch (error) {
      console.error("Error fetching chat stats:", error);
      res.status(500).json({ error: "Failed to fetch chat statistics" });
    }
  },

  // Admin: Delete any chat by id (filtered by domain)
  async deleteAnyAdmin(req: AuthRequest, res: Response) {
    try {
      const user = req.user;
      if (!user || user.role !== "admin") {
        return res.status(403).json({ error: "Admin access required" });
      }

      const domain = req.user?.domain || req.userDomain;
      const deleted: any = await Chat.findOneAndDelete({
        id: req.params.id,
        domain, // Ensure admin can only delete chats from their domain
      });
      const chat = deleted?.value || deleted;
      if (!chat) {
        return res.status(404).json({ error: "Chat not found" });
      }
      await ChatMessage.deleteMany({ chatId: chat.id });
      res.json({ message: "Chat deleted successfully" });
    } catch (error) {
      console.error("Error deleting chat:", error);
      res.status(500).json({ error: "Failed to delete chat" });
    }
  },

  async getMessages(req: AuthRequest, res: Response) {
    try {
      const currentWorkspace = req.currentWorkspace || req.userDomain;
      const chatId = req.params.chatId;
      const query: any = {
        id: chatId,
        domain: req.userDomain,
        workspaceId: currentWorkspace,
      };

      if (req.user?.microsoftId) {
        query.microsoftId = req.user.microsoftId;
      } else if (req.user?._id) {
        query.userId = req.user._id.toString();
      } else {
        return res.status(400).json({ error: "No user identifier found" });
      }

      const chat = await Chat.findOne(query).select("id").lean();
      if (!chat) {
        return res.status(404).json({ error: "Chat not found" });
      }
      const { limit, offset } = parsePagination(req.query);
      const messages = await chatController.fetchMessages(chat.id, limit, offset, {
        includeLegacy: true,
      });
      res.json(messages);
    } catch (error) {
      console.error("Error fetching chat messages:", error);
      res.status(500).json({ error: "Failed to fetch chat messages" });
    }
  },

  async fetchMessages(
    chatId: string,
    limit: number,
    offset: number,
    options: { includeLegacy?: boolean } = {}
  ) {
    if (!options.includeLegacy) {
      const rows = await ChatMessage.find({ chatId })
        .sort({ timestamp: -1 })
        .skip(offset)
        .limit(limit)
        .select("messageId content isUser timestamp -_id")
        .lean();
      return rows
        .map((m: any) => ({
          id: m.messageId,
          content: m.content,
          isUser: m.isUser,
          timestamp: m.timestamp,
        }))
        .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    }

    const merged = new Map<string, any>();
    const targetSize = offset + limit;
    const batchSize = Math.min(Math.max(limit + offset, 50), 200);
    const maxIterations = Math.min(50, Math.max(5, Math.ceil((targetSize + 1) / batchSize) + 5));
    let messageOffset = 0;
    let legacyOffset = 0;
    let messageDone = false;
    let legacyDone = false;
    let iteration = 0;

    while (
      iteration < maxIterations &&
      (!messageDone || !legacyDone) &&
      merged.size < targetSize + batchSize
    ) {
      iteration += 1;
      if (!messageDone) {
        const rows = await ChatMessage.find({ chatId })
          .sort({ timestamp: 1 })
          .skip(messageOffset)
          .limit(batchSize)
          .select("messageId content isUser timestamp -_id")
          .lean();
        messageOffset += rows.length;
        if (rows.length < batchSize) {
          messageDone = true;
        }
        for (const row of rows) {
          const normalized = normalizeMessage(row);
          merged.set(messageDedupeKey(normalized), normalized);
        }
      }
      if (!legacyDone) {
        const legacyChat = await Chat.findOne({ id: chatId })
          .select({
            messages: { $slice: [legacyOffset, batchSize] },
          })
          .lean();
        const legacyMessages = Array.isArray((legacyChat as any)?.messages)
          ? (legacyChat as any).messages
          : [];
        legacyOffset += legacyMessages.length;
        if (legacyMessages.length < batchSize) {
          legacyDone = true;
        }
        for (const row of legacyMessages) {
          const normalized = normalizeMessage(row);
          if (!normalized.content) continue;
          const key = messageDedupeKey(normalized);
          if (!merged.has(key)) {
            merged.set(key, normalized);
          }
        }
      }
    }

    const ordered = Array.from(merged.values()).sort(
      (a: any, b: any) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
    return ordered.slice(offset, offset + limit);
  },
};
