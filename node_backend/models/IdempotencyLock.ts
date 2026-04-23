import mongoose from "mongoose";

const idempotencyLockSchema = new mongoose.Schema(
  {
    tenant_id: { type: String, required: true, index: true },
    idempotency_key: { type: String, required: true, index: true },
    owner_id: { type: String, required: true },
    job_id: { type: String, default: null, index: true },
    expires_at: { type: Date, required: true, index: true },
  },
  { timestamps: true }
);

idempotencyLockSchema.index({ tenant_id: 1, idempotency_key: 1 }, { unique: true });

export const IdempotencyLock = mongoose.model("IdempotencyLock", idempotencyLockSchema);
