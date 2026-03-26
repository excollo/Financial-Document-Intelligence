import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";

/**
 * AdverseFinding — stores individual adverse research findings for a job.
 *
 * Populated by the Python research pipeline (SerpAPI/web search + GPT analysis).
 * Each finding represents one discrete adverse event found about the company or promoters.
 */
const adverseFindingSchema = new mongoose.Schema(
  {
    id: { type: String, default: () => uuidv4(), unique: true, index: true },
    job_id: { type: String, required: true, index: true }, // references Job.id
    tenant_id: { type: String, required: true, index: true },

    // What was found
    entity_name: { type: String, required: true }, // Company name or promoter name
    entity_type: {
      type: String,
      enum: ["company", "promoter", "director", "group_company"],
      default: "company",
    },
    finding_type: {
      type: String,
      enum: [
        "sanction",
        "enforcement_action",
        "criminal_case",
        "regulatory_action",
        "civil_litigation",
        "media_adverse",
        "financial_fraud",
        "environmental",
        "other",
      ],
      required: true,
    },
    severity: {
      type: String,
      enum: ["critical", "high", "medium", "low"],
      required: true,
    },
    title: { type: String, required: true },
    description: { type: String, required: true },
    source_url: { type: String, default: null },
    source_name: { type: String, default: null },
    published_date: { type: Date, default: null },

    // Status and confidence
    confidence_score: { type: Number, default: null, min: 0, max: 1 },
    verified: { type: Boolean, default: false },

    // Overall risk assessment (stored on last finding for the job)
    risk_assessment: {
      type: {
        overall_risk_level: {
          type: String,
          enum: ["Low", "Medium", "High", "Critical"],
        },
        overall_risk_score: Number,
        recommended_action: {
          type: String,
          enum: ["proceed", "enhanced_due_diligence", "escalate", "reject"],
        },
      },
      default: null,
    },
  },
  { timestamps: true }
);

// Indexes
adverseFindingSchema.index({ job_id: 1, severity: 1 });
adverseFindingSchema.index({ tenant_id: 1, entity_name: 1 });

export const AdverseFinding = mongoose.model(
  "AdverseFinding",
  adverseFindingSchema
);
