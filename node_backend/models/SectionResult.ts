import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";

/**
 * SectionResult — stores the output for each SOP section within a job.
 *
 * One document per section_id per job. Populated by the Python pipeline
 * as each section is processed. Contains extracted markdown, raw data,
 * GPT usage, and any screenshots/tables.
 */
const sectionResultSchema = new mongoose.Schema(
  {
    id: { type: String, default: () => uuidv4(), unique: true, index: true },
    job_id: { type: String, required: true, index: true }, // references Job.id
    tenant_id: { type: String, required: true, index: true },
    section_id: { type: String, required: true }, // e.g. "s1_basic_details"

    // Status
    status: {
      type: String,
      enum: ["pending", "running", "completed", "failed", "skipped"],
      default: "pending",
    },
    error_message: { type: String, default: null },

    // Outputs
    markdown: { type: String, default: null }, // Extracted markdown
    raw_json: { type: mongoose.Schema.Types.Mixed, default: null }, // Raw structured data (investor JSON, capital table, etc.)
    tables: {
      type: [
        {
          table_id: String,
          markdown: String,
          csv_s3_key: String, // S3 key for CSV export
          screenshot_s3_key: String, // S3 key for table screenshot
        },
      ],
      default: [],
    },
    screenshots: {
      type: [
        {
          screenshot_id: String,
          s3_key: String,
          page_number: Number,
          caption: String,
        },
      ],
      default: [],
    },

    // GPT cost tracking
    gpt_model: { type: String, default: null },
    gpt_input_tokens: { type: Number, default: 0 },
    gpt_output_tokens: { type: Number, default: 0 },
    duration_ms: { type: Number, default: 0 },

    // SOP compliance
    sop_compliance_score: { type: Number, default: null, min: 0, max: 100 },
    sop_compliance_notes: { type: String, default: null },
  },
  { timestamps: true }
);

// Compound indexes
sectionResultSchema.index({ job_id: 1, section_id: 1 }, { unique: true });
sectionResultSchema.index({ tenant_id: 1, job_id: 1, section_id: 1 }, { unique: true });
sectionResultSchema.index({ tenant_id: 1, job_id: 1 });

export const SectionResult = mongoose.model("SectionResult", sectionResultSchema);
