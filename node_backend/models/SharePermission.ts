import mongoose from "mongoose";

const sharePermissionSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true },
    resourceType: { type: String, enum: ["directory", "document"], required: true },
    resourceId: { type: String, required: true },
    domain: { type: String, required: true, index: true },
    scope: { type: String, enum: ["user", "workspace", "link"], required: true },
    principalId: { type: String },
    role: { type: String, enum: ["owner", "editor", "viewer"], required: true },
    invitedEmail: { type: String },
    linkToken: { type: String },
    expiresAt: { type: Date, default: null },
    createdBy: { type: String },
  },
  { timestamps: true }
);

sharePermissionSchema.index({ domain: 1, resourceType: 1, resourceId: 1 });
sharePermissionSchema.index({ scope: 1, principalId: 1 });

// Compound unique index for user/workspace scoped shares (prevents duplicates)
// This replaces the problematic sparse index on linkToken
sharePermissionSchema.index(
  { domain: 1, resourceType: 1, resourceId: 1, scope: 1, principalId: 1 },
  { unique: true, sparse: true }
);

// Unique index for link-scoped shares (linkToken must be unique per scope)
sharePermissionSchema.index(
  { scope: 1, linkToken: 1 },
  { unique: true, sparse: true, partialFilterExpression: { scope: "link", linkToken: { $exists: true } } }
);

export const SharePermission = mongoose.model("SharePermission", sharePermissionSchema);








