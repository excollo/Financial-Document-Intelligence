import express from "express";
import { chatController } from "../controllers/chatController";
import { authMiddleware, authorize } from "../middleware/auth";
import { domainAuthMiddleware } from "../middleware/domainAuth";
import { linkAccess } from "../middleware/linkAccess";
import { rateLimitByWorkspace } from "../middleware/rateLimitByWorkspace";
import { verifyInternalCallbackRequest } from "../middleware/internalRequestVerification";

const router = express.Router();

// Internal callback endpoint must be checked before auth middleware.
router.post(
  "/chat-status/update",
  verifyInternalCallbackRequest,
  chatController.chatStatusUpdate
);

// Process link access FIRST so downstream middlewares can use it
router.use(linkAccess);
// Apply auth middleware to all routes (skipped when linkToken present)
router.use(authMiddleware);
// Apply domain middleware to all routes (respects link access domain)
router.use(domainAuthMiddleware);

// Get all chats for the user
router.get("/", chatController.getAll);

// Admin: Get all chats
router.get("/admin", authorize(["admin"]), chatController.getAllAdmin);

// Admin: Get chat detail
router.get(
  "/admin/:id/detail",
  authorize(["admin"]),
  chatController.getAdminChatDetail
);

// Admin: Chat stats and monitoring
router.get("/admin/stats", authorize(["admin"]), chatController.getStats);

// Get chat history for a document
router.get("/document/:documentId", chatController.getByDocumentId);

// Trigger AI response (Python service)
router.post(
  "/message",
  rateLimitByWorkspace("chat:message", 500, 24 * 60 * 60 * 1000),
  chatController.sendMessage
);

// Create new chat (rate limited)
router.post(
  "/",
  rateLimitByWorkspace("chat:create", 1000, 24 * 60 * 60 * 1000),
  chatController.create
);

// Add message to chat
router.post("/:chatId/messages", chatController.addMessage);
router.get("/:chatId/messages", chatController.getMessages);

// Update chat
router.put("/:id", chatController.update);

// Delete chat (user can delete own chat)
router.delete("/:id", chatController.delete);

// Admin: delete any chat by id (bypass ownership)
router.delete(
  "/admin/:id",
  authorize(["admin"]),
  chatController.deleteAnyAdmin
);

export default router;
