import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";

/**
 * Job — tracks a document processing pipeline run.
 *
 * Created when a user uploads a PDF and triggers processing.
 * Node creates the job, dispatches to Python, and Python updates
 * status/progress as it processes each section.
 */
const jobSchema = new mongoose.Schema(
  {
    id: { type: String, default: () => uuidv4(), unique: true, index: true },
    tenant_id: { type: String, required: true, index: true }, // Domain.domainId
    sop_config_id: { type: String, default: null }, // SopConfig.id (null = use active config)
    
    // Job type: extraction (single doc) or comparison (two docs)
    job_type: { 
      type: String, 
      enum: ["extraction", "comparison"], 
      default: "extraction",
      index: true 
    },

    // Single document extraction fields (optional for comparison jobs)
    document_name: { type: String, default: null },
    s3_input_key: { type: String, default: null }, // e.g. "tenant_slug/job_id/input.pdf"
    s3_output_prefix: { type: String, default: null }, // e.g. "tenant_slug/job_id/"

    // Comparison job fields
    drhp_id: { type: String, default: null },
    rhp_id: { type: String, default: null },
    directory_id: { type: String, default: null, index: true },
    title: { type: String, default: null },

    // Progress tracking
    status: {
      type: String,
      enum: ["queued", "queued_with_delay", "processing", "completed", "completed_with_errors", "failed"],
      default: "queued",
      index: true,
    },
    progress_pct: { type: Number, default: 0, min: 0, max: 100 },
    current_stage: { type: String, default: null }, // e.g. "extraction", "gpt_processing", "output_assembly"
    error_message: { type: String, default: null },
    error_reason: { type: String, default: null },
    started_at: { type: Date, default: null },
    completed_at: { type: Date, default: null },
    trace_id: { type: String, default: null, index: true },
    queue_name: { type: String, default: "heavy_jobs", index: true },
    queued_with_delay: { type: Boolean, default: false },
    idempotency_key: { type: String, default: null, index: true },
    retry_count: { type: Number, default: 0, min: 0 },
    execution_claimed_at: { type: Number, default: null },
    execution_claimed_by: { type: String, default: null },
    claim_expires_at: { type: Number, default: null },
    stages: [
      {
        stage_name: { type: String, required: true },
        stage_event_key: { type: String, default: null },
        start_time: { type: Date, default: null },
        end_time: { type: Date, default: null },
        duration_ms: { type: Number, default: 0 },
        status: { type: String, enum: ["success", "failed"], default: "success" },
        error_reason: { type: String, default: null },
      },
    ],

    // Celery task tracking
    celery_task_id: { type: String, default: null },

    // Metadata
    workspace_id: { type: String, index: true }, // for workspace-level filtering
    created_by: { type: String, default: null }, // user ID who created the job
    output_urls: { type: mongoose.Schema.Types.Mixed, default: null }, // for storing download links (docx, pdf)
  },
  { timestamps: true }
);

// Indexes for efficient querying
jobSchema.index({ tenant_id: 1, status: 1 });
jobSchema.index({ tenant_id: 1, createdAt: -1 });
jobSchema.index({ workspace_id: 1, createdAt: -1 });
jobSchema.index({ tenant_id: 1, idempotency_key: 1, createdAt: -1 });
jobSchema.index({ tenant_id: 1, id: 1 });

export const Job = mongoose.model("Job", jobSchema);
