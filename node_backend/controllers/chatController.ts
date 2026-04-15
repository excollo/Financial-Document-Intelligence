import { Request, Response } from "express";
import { Chat } from "../models/Chat";
import { Document } from "../models/Document";
import { User } from "../models/User";
import { io } from "../index";
import axios from "axios";

interface AuthRequest extends Request {
  user?: any;
  userDomain?: string;
  currentWorkspace?: string;
}

export const chatController = {
  async sendMessage(req: AuthRequest, res: Response) {
    try {
      const { message, namespace, documentType, history, sessionId } = req.body;

      if (!message || !namespace || !documentType) {
        return res.status(400).json({ error: "Missing required fields (message, namespace, documentType)" });
      }

      const pythonApiUrl = process.env.PYTHON_API_URL || "http://localhost:8000";
      const INTERNAL_SECRET = process.env.INTERNAL_SECRET || "";

      console.log(`Forwarding chat query to Python: ${namespace}`);

      const payload = {
        message,
        namespace,
        document_type: documentType,
        history: history || [],
        authorization: req.headers.authorization,
        sessionId: sessionId
      };

      const pythonResponse = await axios.post(`${pythonApiUrl}/chats/query`, payload, {
        headers: {
          "X-Internal-Secret": INTERNAL_SECRET,
          "Content-Type": "application/json",
        },
        timeout: 90000 // Chat might take a while, increased to 90s
      });

      if (pythonResponse.data && pythonResponse.data.status === "success") {
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

      const chats = await Chat.find(query).sort({ updatedAt: -1 });
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

      const chats = await Chat.find(query).sort({ updatedAt: -1 });
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
      const message = {
        ...req.body,
        timestamp: new Date(req.body.timestamp || Date.now()),
      };
      chat.messages.push(message);
      chat.updatedAt = new Date();
      await chat.save();
      res.json(chat);
    } catch (error) {
      console.error("Error adding message:", error);
      res.status(500).json({ error: "Failed to add message" });
    }
  },

  async update(req: AuthRequest, res: Response) {
    try {
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
          ...req.body,
          messages: Array.isArray(req.body.messages)
            ? req.body.messages
            : req.body.messages,
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

      const chat = await Chat.findOneAndDelete(query);
      if (!chat) {
        return res.status(404).json({ error: "Chat not found" });
      }
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
      // Only emit on failure
      if (status.trim().toLowerCase() === "failed") {
        io.emit("chat_status", { jobId, status, error });
      }
      res.status(200).json({
        message: "Chat status update processed",
        jobId,
        status,
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

      const chats = await Chat.find(query).sort({ updatedAt: -1 });
      res.json(chats);
    } catch (error) {
      console.error("Error fetching all chats:", error);
      res.status(500).json({ error: "Failed to fetch chats" });
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
      const chat = await Chat.findOneAndDelete({
        id: req.params.id,
        domain, // Ensure admin can only delete chats from their domain
      });
      if (!chat) {
        return res.status(404).json({ error: "Chat not found" });
      }
      res.json({ message: "Chat deleted successfully" });
    } catch (error) {
      console.error("Error deleting chat:", error);
      res.status(500).json({ error: "Failed to delete chat" });
    }
  },
};
