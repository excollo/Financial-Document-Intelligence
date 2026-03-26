import express from "express";
import { summaryController } from "../controllers/summaryController";
import { authMiddleware } from "../middleware/auth";
import { domainAuthMiddleware } from "../middleware/domainAuth";
import { rateLimitByWorkspace } from "../middleware/rateLimitByWorkspace";
import { requireBodyDocumentPermission, requireSummaryPermission } from "../middleware/permissions";

const router = express.Router();

// POST /summary-status/update (for n8n to notify status) - Must be before auth middleware
router.post("/summary-status/update", summaryController.summaryStatusUpdate);

// Enable link access to summaries of shared documents
import { linkAccess } from "../middleware/linkAccess";
router.use(linkAccess);
// Apply auth (skipped if linkToken provided)
router.use(authMiddleware);
// Apply domain (respects link domain)
router.use(domainAuthMiddleware);

// Get all summaries for the user
router.get("/", summaryController.getAll);

// Admin: Get all summaries across all workspaces
router.get("/admin", summaryController.getAllAdmin);

// Admin metrics: total summaries count
router.get("/admin/metrics/count", async (req, res) => {
  try {
    const { Summary } = await import("../models/Summary");
    const total = await Summary.countDocuments({
      domain: (req as any).user?.domain,
    });
    res.json({ total });
  } catch (e) {
    res.status(500).json({ message: "Failed to load summary count" });
  }
});

// Get summaries for a document
router.get("/document/:documentId", summaryController.getByDocumentId);

// Trigger summary generation (Python service)
router.post(
  "/trigger",
  rateLimitByWorkspace("summary:trigger", 100, 24 * 60 * 60 * 1000),
  requireBodyDocumentPermission("documentId", "editor"),
  summaryController.triggerSummary
);

// Create new summary (rate limited)
router.post(
  "/create",
  rateLimitByWorkspace("summary:create", 300, 24 * 60 * 60 * 1000),
  requireBodyDocumentPermission("documentId", "editor"),
  summaryController.create
);

// Update summary
router.put("/:id", requireSummaryPermission("id", "editor"), summaryController.update);

// Delete summary
router.delete("/:id", summaryController.delete);

// Download DOCX for a summary
router.get("/:id/download-docx", summaryController.downloadDocx);

// Download PDF generated from HTML content for a summary
router.get("/:id/download-html-pdf", summaryController.downloadHtmlPdf);

export default router;
