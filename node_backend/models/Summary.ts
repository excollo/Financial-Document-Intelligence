import mongoose from "mongoose";

const summarySchema = new mongoose.Schema({
  id: { type: mongoose.Schema.Types.Mixed, required: true, unique: true },
  title: { type: String, required: true },
  content: { type: String, required: true },
  format: { type: String, enum: ["html", "markdown"], default: "html" }, // Content format
  updatedAt: { type: Date, default: Date.now },
  documentId: { type: String, required: true },
  domain: { type: String, required: true, index: true }, // Domain isolation (company level) - backward compatibility
  domainId: { type: String, required: true, index: true }, // Link to Domain schema
  workspaceId: { type: String, required: true, index: true }, // Workspace isolation (team level)
  microsoftId: { type: String }, // Optional: for tracking who created it
  userId: { type: String }, // Optional: for tracking who created it
});


export const Summary = mongoose.model("Summary", summarySchema);
