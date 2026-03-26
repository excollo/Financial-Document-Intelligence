import mongoose from "mongoose";

// Core user record with domain, role and optional password (email/password users).
// Also stores OTP flows for profile updates, password changes and registration.
const userSchema = new mongoose.Schema({
  microsoftId: { type: String, unique: true, sparse: true },
  name: { type: String },
  email: { type: String, required: true, unique: true },
  domain: { type: String, required: true, index: true }, // Primary domain (for backward compatibility)
  domainId: { type: String, required: true, index: true }, // Link to Domain schema
  password: { type: String }, // Optional: only for email/password users
  role: { type: String, enum: ["admin", "user"], default: "user", index: true },
  status: {
    type: String,
    enum: ["active", "suspended"],
    default: "active",
    index: true,
  },

  // Workspace access management
  accessibleWorkspaces: [
    {
      workspaceDomain: { type: String, required: true },
      workspaceName: { type: String, required: true },
      role: {
        type: String,
        enum: ["user", "viewer", "editor"],
        default: "user",
      },
      // Time-bucket permissions for documents within this workspace
      allowedTimeBuckets: {
        type: [
          {
            type: String,
            enum: ["today", "last7", "last15", "last30", "last90", "all"],
          },
        ],
        default: ["last7"],
      },
      // Explicit overrides
      extraDocumentIds: { type: [{ type: String }], default: [] },
      blockedDocumentIds: { type: [{ type: String }], default: [] },
      invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      joinedAt: { type: Date, default: Date.now },
      isActive: { type: Boolean, default: true },
    },
  ],

  // Current active workspace (for UI)
  currentWorkspace: {
    type: String,
    default: function (this: any) {
      return this.domain;
    }, // Default to user's primary domain
  },

  gender: {
    type: String,
    enum: ["male", "female", "other", "prefer-not-to-say"],
    default: "prefer-not-to-say",
  },
  refreshTokens: { type: [{ type: String }], default: [] }, // To store active refresh tokens
  createdAt: { type: Date, default: Date.now },
  lastLogin: { type: Date, default: Date.now },
  resetPasswordToken: { type: String },
  resetPasswordExpires: { type: Date },

  // Profile update OTP flow
  profileUpdateOTP: { type: String },
  profileUpdateOTPExpires: { type: Date },
  profileUpdatePendingData: { type: mongoose.Schema.Types.Mixed },

  // Password change OTP flow
  passwordChangeOTP: { type: String },
  passwordChangeOTPExpires: { type: Date },
  passwordChangePendingHash: { type: String },

  // Registration email verification OTP flow
  registrationOTP: { type: String },
  registrationOTPExpires: { type: Date },
});

export const User = mongoose.model("User", userSchema);
