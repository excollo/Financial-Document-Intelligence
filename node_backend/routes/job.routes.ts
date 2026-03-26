import { Router } from "express";
import { authMiddleware } from "../middleware/auth";
import { domainAuthMiddleware } from "../middleware/domainAuth";
import {
  tenantIsolation,
  requireInternalSecret,
} from "../middleware/tenantIsolation";
import {
  createJob,
  listJobs,
  getJob,
  deleteJob,
  updateJobStatus,
  submitSectionResult,
  submitAdverseFinding,
} from "../controllers/jobController";

const router = Router();

// ── User-facing routes (JWT + domain + tenant isolation) ──
router.post(
  "/",
  authMiddleware,
  domainAuthMiddleware,
  tenantIsolation,
  createJob
);
router.get(
  "/",
  authMiddleware,
  domainAuthMiddleware,
  tenantIsolation,
  listJobs
);
router.get(
  "/:id",
  authMiddleware,
  domainAuthMiddleware,
  tenantIsolation,
  getJob
);
router.delete(
  "/:id",
  authMiddleware,
  domainAuthMiddleware,
  tenantIsolation,
  deleteJob
);

// ── Internal routes (Python pipeline → Node, validated by INTERNAL_SECRET) ──
router.post(
  "/internal/status",
  requireInternalSecret,
  tenantIsolation,
  updateJobStatus
);
router.post(
  "/internal/section-result",
  requireInternalSecret,
  tenantIsolation,
  submitSectionResult
);
router.post(
  "/internal/adverse-finding",
  requireInternalSecret,
  tenantIsolation,
  submitAdverseFinding
);

export default router;
