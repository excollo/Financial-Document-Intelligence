import mongoose from "mongoose";

const workspaceInvitationSchema = new mongoose.Schema({
  // Invitation details
  invitationId: { type: String, required: true, unique: true, index: true },

  // Inviter (workspace owner/admin)
  inviterId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  inviterEmail: { type: String, required: true },
  inviterName: { type: String, required: true },

  // Invitee (person being invited)
  inviteeEmail: { type: String, required: true, index: true },
  inviteeName: { type: String },

  // Workspace details
  workspaceDomain: { type: String, required: true, index: true }, // Keep for backward compatibility
  workspaceId: { type: String, required: true, index: true }, // Link to Workspace.workspaceId
  workspaceName: { type: String, required: true },

  // Invitation status
  status: {
    type: String,
    enum: ["pending", "accepted", "declined", "expired", "cancelled"],
    default: "pending",
    index: true,
  },

  // Permissions/role for the invited user
  invitedRole: {
    type: String,
    enum: ["user", "viewer", "editor"],
    default: "user",
  },
  // Directory access permissions (for cross-domain invitations)
  grantedDirectories: {
    type: [
      {
        directoryId: { type: String, required: true },
        directoryName: { type: String },
        role: {
          type: String,
          enum: ["viewer", "editor"],
          default: "viewer",
        },
        permissions: {
          type: [String],
          enum: ["read", "write", "delete"],
          default: ["read"],
        },
      },
    ],
    default: [],
  },
  // Requested time-bucket permissions for this invite
  allowedTimeBuckets: {
    type: [
      {
        type: String,
        enum: ["today", "last7", "last15", "last30", "last90", "all"],
      },
    ],
    default: ["today"],
  },

  // Invitation metadata
  message: { type: String }, // Optional message from inviter
  expiresAt: { type: Date, required: true, index: true },

  // Timestamps
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  acceptedAt: { type: Date },
  declinedAt: { type: Date },

  // Email tracking
  emailSent: { type: Boolean, default: false },
  emailSentAt: { type: Date },
  lastReminderSent: { type: Date },
  reminderCount: { type: Number, default: 0 },
});

// Indexes for efficient queries
workspaceInvitationSchema.index({ inviteeEmail: 1, status: 1 });
workspaceInvitationSchema.index({ workspaceDomain: 1, status: 1 });
workspaceInvitationSchema.index({ workspaceId: 1, status: 1 }); // Index for workspaceId queries
workspaceInvitationSchema.index({ inviterId: 1, status: 1 });
workspaceInvitationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // Auto-delete expired invitations

// Pre-save middleware to update updatedAt
workspaceInvitationSchema.pre("save", function (next) {
  this.updatedAt = new Date();
  next();
});

// Static method to generate unique invitation ID
workspaceInvitationSchema.statics.generateInvitationId = function (): string {
  return `inv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

// Static method to check if invitation is expired
workspaceInvitationSchema.methods.isExpired = function (): boolean {
  return new Date() > this.expiresAt;
};

// Static method to check if invitation can be accepted
workspaceInvitationSchema.methods.canBeAccepted = function (): boolean {
  return this.status === "pending" && !this.isExpired();
};

export const WorkspaceInvitation = mongoose.model(
  "WorkspaceInvitation",
  workspaceInvitationSchema
);
