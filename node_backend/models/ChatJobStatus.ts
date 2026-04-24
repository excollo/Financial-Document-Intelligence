import mongoose from "mongoose";

const chatJobStatusSchema = new mongoose.Schema(
  {
    job_id: { type: String, required: true, unique: true, index: true },
    chat_id: { type: String, default: null, index: true },
    namespace: { type: String, default: null },
    workspace_id: { type: String, required: true, index: true },
    domain_id: { type: String, required: true, index: true },
    user_id: { type: String, default: null, index: true },
    status: { type: String, default: "processing", index: true },
    error_message: { type: String, default: null },
  },
  { timestamps: true }
);

chatJobStatusSchema.index({ workspace_id: 1, updatedAt: -1 });
chatJobStatusSchema.index({ domain_id: 1, updatedAt: -1 });

export const ChatJobStatus = mongoose.model("ChatJobStatus", chatJobStatusSchema);
