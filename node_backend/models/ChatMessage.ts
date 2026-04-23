import mongoose from "mongoose";

const chatMessageSchema = new mongoose.Schema(
  {
    chatId: { type: String, required: true, index: true },
    messageId: { type: String, required: true },
    documentId: { type: String, required: true, index: true },
    domain: { type: String, required: true, index: true },
    workspaceId: { type: String, required: true, index: true },
    microsoftId: { type: String, default: null, index: true },
    userId: { type: String, default: null, index: true },
    content: { type: String, required: true },
    isUser: { type: Boolean, required: true },
    timestamp: { type: Date, required: true, index: true },
  },
  { timestamps: true }
);

chatMessageSchema.index({ chatId: 1, timestamp: -1 });
chatMessageSchema.index({ workspaceId: 1, documentId: 1, timestamp: -1 });
chatMessageSchema.index({ domain: 1, workspaceId: 1, chatId: 1, timestamp: -1 });
chatMessageSchema.index({ chatId: 1, messageId: 1 }, { unique: true });

export const ChatMessage = mongoose.model("ChatMessage", chatMessageSchema);

