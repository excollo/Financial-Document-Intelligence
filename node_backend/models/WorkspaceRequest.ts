import mongoose from "mongoose";

// Workspace access request from users (non-admin)
const workspaceRequestSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true,
  },
  workspaceId: {
    type: String,
    required: true,
    index: true,
  },
  domainId: {
    type: String,
    required: true,
    index: true,
  },
  status: {
    type: String,
    enum: ["pending", "approved", "rejected"],
    default: "pending",
    index: true,
  },
  requestedAt: {
    type: Date,
    default: Date.now,
  },
  reviewedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
  },
  reviewedAt: {
    type: Date,
  },
  message: {
    type: String, // Optional message from user
  },
  rejectionReason: {
    type: String, // Optional reason if rejected
  },
});

// Compound index to prevent duplicate requests
workspaceRequestSchema.index({ userId: 1, workspaceId: 1 }, { unique: true });
workspaceRequestSchema.index({ workspaceId: 1, status: 1 });

export const WorkspaceRequest = mongoose.model("WorkspaceRequest", workspaceRequestSchema);





















