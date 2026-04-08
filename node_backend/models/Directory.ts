import mongoose from "mongoose";

const directorySchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  parentId: { type: String, default: null },
  domain: { type: String, required: true, index: true }, // Domain isolation (company level) - backward compatibility
  domainId: { type: String, required: true, index: true }, // Link to Domain schema
  workspaceId: { type: String, required: true, index: true }, // Workspace isolation (team level)
  ownerUserId: { type: String },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  
  // NEW: Normalized name for duplicate detection and fuzzy matching
  normalizedName: { 
    type: String, 
    required: true, 
    index: true 
  },
  
  // NEW: Statistics for better UX UI
  documentCount: { type: Number, default: 0 },
  drhpCount: { type: Number, default: 0 },
  rhpCount: { type: Number, default: 0 },
  lastDocumentUpload: { type: Date },
  
  // NEW: For cross-domain directory sharing
  // If this directory is a shared copy from another domain/workspace
  sharedFromDirectoryId: { type: String, index: true }, // Original directory ID
  sharedFromDomain: { type: String }, // Original domain
  sharedFromWorkspaceId: { type: String }, // Original workspace
  sharedWithUserId: { type: String, index: true }, // User who received the share
  isShared: { type: Boolean, default: false }, // Flag to identify shared directories
});

// Index for workspace-based directory hierarchy
directorySchema.index({ workspaceId: 1, parentId: 1, name: 1 });

// Index for domain-level queries (admin access)
directorySchema.index({ domain: 1, parentId: 1, name: 1 });

// Index for finding directories within workspace
directorySchema.index({ workspaceId: 1, id: 1 });

// NEW: Index for fast normalized name lookup (critical for duplicate detection)
directorySchema.index({ workspaceId: 1, normalizedName: 1 });

// NEW: Index for sorting by popularity/recent activity
directorySchema.index({ workspaceId: 1, documentCount: -1, lastDocumentUpload: -1 });

export const Directory = mongoose.model("Directory", directorySchema);
