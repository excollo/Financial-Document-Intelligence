import mongoose from "mongoose";

const messageSchema = new mongoose.Schema({
  id: { type: String, required: true },
  content: { type: String, required: true },
  isUser: { type: Boolean, required: true },
  timestamp: { type: Date, required: true },
});

const chatSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  title: { type: String, required: true },
  messages: [messageSchema],
  updatedAt: { type: Date, default: Date.now },
  documentId: { type: String, required: true },
  domain: { type: String, required: true, index: true }, // Domain isolation (company level) - backward compatibility
  domainId: { type: String, required: true, index: true }, // Link to Domain schema
  workspaceId: { type: String, required: true, index: true }, // Workspace isolation (team level)
  microsoftId: { type: String },
  userId: { type: String },
});

chatSchema.pre("validate", function (next) {
  if (!this.microsoftId && !this.userId) {
    next(new Error("Either microsoftId or userId must be present."));
  } else {
    next();
  }
});

export const Chat = mongoose.model("Chat", chatSchema);
