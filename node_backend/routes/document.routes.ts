import express from "express";
import { documentController } from "../controllers/documentController";
import { authMiddleware, authorize } from "../middleware/auth";
import { domainAuthMiddleware } from "../middleware/domainAuth";
import { linkAccess } from "../middleware/linkAccess";
import { requireCreateInDirectory, requireDocumentPermission } from "../middleware/permissions";
import multer from "multer";
import { Request, Response, NextFunction } from "express";
import { r2Client, R2_BUCKET } from "../config/r2";
import { rateLimitByWorkspace } from "../middleware/rateLimitByWorkspace";
import multerS3 from "multer-s3";

const router = express.Router();

// POST /upload-status/update (for n8n to notify upload status)
router.post("/upload-status/update", documentController.uploadStatusUpdate);
router.delete("/internal/:id", documentController.deleteInternal);

// Process link access FIRST so downstream middlewares can use it
router.use(linkAccess);
// Apply auth middleware to all routes (skipped when linkToken present)
router.use(authMiddleware);
// Apply domain middleware to all routes (respects link access domain)
router.use(domainAuthMiddleware);

const upload = multer({
  storage: multerS3({
    s3: r2Client,
    bucket: R2_BUCKET,
    contentType: multerS3.AUTO_CONTENT_TYPE,
    key: function (
      req: Request,
      file: Express.Multer.File,
      cb: (error: Error | null, key?: string) => void
    ) {
      // Use a unique key for each file, e.g., timestamp + original name
      const uniqueKey = `${Date.now()}-${file.originalname}`;
      cb(null, uniqueKey);
    },
    acl: "private", // or 'public-read' if you want public access
  }),
  limits: { fileSize: 100 * 1024 * 1024 }, // 50MB limit
});

// Get all documents for current user (supports directoryId and includeDeleted)
router.get("/", documentController.getAll);

// Admin: Get all documents across all workspaces
router.get("/admin", documentController.getAllAdmin);

// Check if document exists by namespace
router.get("/check-existing", documentController.checkExistingByNamespace);

// Get single document
router.get("/:id", requireDocumentPermission("id", "viewer"), documentController.getById);

// Create document
router.post("/", requireCreateInDirectory, documentController.create);

// Upload PDF document
router.post(
  "/upload",
  rateLimitByWorkspace("document:upload", 100, 24 * 60 * 60 * 1000),
  upload.single("file"),
  // @ts-ignore
  function (err: any, req: Request, res: Response, next: NextFunction) {
    if (err && err.code === "LIMIT_FILE_SIZE") {
      return res
        .status(413)
        .json({ error: "File too large. Maximum size is 100MB." });
    }
    next(err);
  },
  documentController.uploadDocument
);

// Upload RHP document
router.post(
  "/upload-rhp",
  rateLimitByWorkspace("document:upload", 100, 24 * 60 * 60 * 1000),
  upload.single("file"), // @ts-ignore
  // @ts-ignore
  function (err: any, req: Request, res: Response, next: NextFunction) {
    if (err && err.code === "LIMIT_FILE_SIZE") {
      return res
        .status(413)
        .json({ error: "File too large. Maximum size is 100MB." });
    }
    next(err);
  },
  documentController.uploadRhp
);

// Download/view PDF document
router.get("/download/:id", documentController.downloadDocument);

// Update document
router.put("/:id", requireDocumentPermission("id", "editor"), documentController.update);

// Delete document
router.delete("/:id", requireDocumentPermission("id", "editor"), documentController.delete);

// Get available documents for comparison
router.get("/available-for-compare/:id", requireDocumentPermission("id", "viewer"), documentController.getAvailableForCompare);

// Link documents for comparison
router.post("/link-for-compare", documentController.linkForCompare);

// Restore route removed (trash disabled for now)

export default router;
