import mongoose from "mongoose";

// Many-to-many relationship between Users and Workspaces
const workspaceMembershipSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true,
  },
  workspaceId: {
    type: String, // References Workspace.workspaceId
    required: true,
    index: true,
  },
  role: {
    type: String,
    enum: ["admin", "editor", "viewer"], // Changed "member" to "editor" for consistency
    default: "editor",
    required: true,
  },
  invitedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
  },
  invitedAt: {
    type: Date,
    default: Date.now,
  },
  joinedAt: {
    type: Date,
    default: Date.now,
  },
  status: {
    type: String,
    enum: ["pending", "active", "suspended"],
    default: "active",
    index: true,
  },
});

// Compound index for efficient queries
workspaceMembershipSchema.index({ userId: 1, workspaceId: 1 }, { unique: true });
workspaceMembershipSchema.index({ workspaceId: 1, status: 1 });
workspaceMembershipSchema.index({ userId: 1, status: 1 });

export const WorkspaceMembership = mongoose.model(
  "WorkspaceMembership",
  workspaceMembershipSchema
);



