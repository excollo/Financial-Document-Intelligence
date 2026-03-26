import express from "express";
import { reportController } from "../controllers/reportController";
import { authMiddleware } from "../middleware/auth";
import { domainAuthMiddleware } from "../middleware/domainAuth";
import { rateLimitByWorkspace } from "../middleware/rateLimitByWorkspace";
import { requireReportPermission, requireBodyDocumentPermission } from "../middleware/permissions";
import { linkAccess } from "../middleware/linkAccess";

const router = express.Router();

// Allow link access for related reports
router.use(linkAccess);
// Apply auth (skipped if linkToken provided)
router.use(authMiddleware);
// Apply domain (respects link domain)
router.use(domainAuthMiddleware);

// Get all reports for the user
router.get("/", reportController.getAll);

// Admin: Get all reports across all workspaces
router.get("/admin", reportController.getAllAdmin);

// Get single report
router.get("/:id", requireReportPermission("id", "viewer"), reportController.getById);

// Trigger document comparison (Python service)
router.post(
  "/compare",
  rateLimitByWorkspace("report:compare", 50, 24 * 60 * 60 * 1000),
  requireBodyDocumentPermission("drhpId", "editor"),
  reportController.compareDocuments
);

// Create new report (rate limited)
router.post(
  "/create-report",
  rateLimitByWorkspace("report:create", 100, 24 * 60 * 60 * 1000),
  // Need at least editor on DRHP to create a report
  requireBodyDocumentPermission("drhpId", "editor"),
  reportController.create
);

// Update report
router.put("/:id", requireReportPermission("id", "editor"), reportController.update);

// Delete report
router.delete("/:id", requireReportPermission("id", "owner"), reportController.delete);

// Download DOCX for a report
router.get("/:id/download-docx", reportController.downloadDocx);

// Download PDF generated from HTML content for a report
router.get("/:id/download-html-pdf", reportController.downloadPdfFromHtml);

// POST /report-status/update (for n8n to notify status)
router.post("/report-status/update", reportController.reportStatusUpdate);

export default router;
