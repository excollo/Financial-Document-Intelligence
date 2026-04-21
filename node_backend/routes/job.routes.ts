import { Router } from "express";
import { authMiddleware } from "../middleware/auth";
import { domainAuthMiddleware } from "../middleware/domainAuth";
import {
  tenantIsolation,
} from "../middleware/tenantIsolation";
import { verifyInternalCallbackRequest } from "../middleware/internalRequestVerification";
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
  verifyInternalCallbackRequest,
  tenantIsolation,
  updateJobStatus
);
router.post(
  "/internal/section-result",
  verifyInternalCallbackRequest,
  tenantIsolation,
  submitSectionResult
);
router.post(
  "/internal/adverse-finding",
  verifyInternalCallbackRequest,
  tenantIsolation,
  submitAdverseFinding
);

export default router;
