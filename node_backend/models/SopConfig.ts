import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";

/**
 * SOP Configuration — per-tenant, versioned.
 *
 * `sections` is a rich array defining every extraction section,
 * the fields to extract, required tables, and special processors.
 * This replaces the hardcoded 12-section structure in prompts.py
 * and makes the pipeline fully data-driven.
 */

// ── Sub-schemas ──

const fieldSchema = new mongoose.Schema(
  {
    field_id: { type: String, required: true },
    label: { type: String, required: true },
    extraction_type: {
      type: String,
      enum: ["TEXT", "TABLE", "SCREENSHOT", "COMPUTED", "WEB_SEARCH"],
      default: "TEXT",
    },
    required: { type: Boolean, default: true },
    prompt_override: { type: String, default: null }, // null = use default system prompt
    section_keywords: { type: [String], default: [] },
  },
  { _id: false }
);

const tableRequiredSchema = new mongoose.Schema(
  {
    table_id: { type: String, required: true },
    label: { type: String, required: true },
    extraction_method: {
      type: String,
      enum: ["CAMELOT_LATTICE", "CAMELOT_STREAM", "SCREENSHOT"],
      default: "CAMELOT_LATTICE",
    },
    screenshot_required: { type: Boolean, default: false },
    multipage: { type: Boolean, default: false },
    post_processor: { type: String, default: null }, // e.g. "calculate_preferential_valuation"
  },
  { _id: false }
);

const sectionSchema = new mongoose.Schema(
  {
    section_id: { type: String, required: true }, // e.g. "s1_basic_details"
    section_number: { type: Number, required: true },
    label: { type: String, required: true },
    enabled: { type: Boolean, default: true },
    fields: { type: [fieldSchema], default: [] },
    tables_required: { type: [tableRequiredSchema], default: [] },
    special_processors: { type: [String], default: [] }, // e.g. ["investor_shareholding_table"]
  },
  { _id: false }
);

// ── Main SopConfig schema ──

const sopConfigSchema = new mongoose.Schema(
  {
    id: { type: String, default: () => uuidv4(), unique: true, index: true },
    tenant_id: { type: String, required: true, index: true }, // references Domain.domainId
    version: { type: Number, required: true, default: 1 },
    name: { type: String, required: true }, // e.g. "Default SOP v2"
    is_active: { type: Boolean, default: true },
    sections: { type: [sectionSchema], required: true },
  },
  { timestamps: true }
);

// Indexes
sopConfigSchema.index({ tenant_id: 1, is_active: 1 });
sopConfigSchema.index({ tenant_id: 1, version: -1 });

export const SopConfig = mongoose.model("SopConfig", sopConfigSchema);
