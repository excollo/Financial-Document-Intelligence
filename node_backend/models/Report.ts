import mongoose from "mongoose";

const reportSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  title: { type: String, required: true },
  content: { type: String, required: true },
  updatedAt: { type: Date, default: Date.now },
  drhpId: { type: String, required: true },
  rhpId: { type: String, required: true },
  drhpNamespace: { type: String, required: true },
  rhpNamespace: { type: String, required: true },
  domain: { type: String, required: true, index: true }, // Domain isolation (company level) - backward compatibility
  domainId: { type: String, required: true, index: true }, // Link to Domain schema
  workspaceId: { type: String, required: true, index: true }, // Workspace isolation (team level)
  microsoftId: { type: String }, // Optional: for tracking who created it
  userId: { type: String }, // Optional: for tracking who created it
});

export const Report = mongoose.model("Report", reportSchema);
