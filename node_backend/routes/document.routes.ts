import express from "express";
import { documentController } from "../controllers/documentController";
import { authMiddleware, authorize } from "../middleware/auth";
import { domainAuthMiddleware } from "../middleware/domainAuth";
import { linkAccess } from "../middleware/linkAccess";
import { requireCreateInDirectory, requireDocumentPermission } from "../middleware/permissions";
import multer from "multer";
import { Request, Response, NextFunction } from "express";
import { storageService } from "../services/storageService";
import { rateLimitByWorkspace } from "../middleware/rateLimitByWorkspace";
import { verifyInternalCallbackRequest } from "../middleware/internalRequestVerification";
const Mau = require("multer-azure-blob-storage").MulterAzureStorage;

const router = express.Router();

// POST /upload-status/update (for n8n to notify upload status)
router.post(
  "/upload-status/update",
  verifyInternalCallbackRequest,
  documentController.uploadStatusUpdate
);
router.delete(
  "/internal/:id",
  verifyInternalCallbackRequest,
  documentController.deleteInternal
);

// Process link access FIRST so downstream middlewares can use it
router.use(linkAccess);
// Apply auth middleware to all routes (skipped when linkToken present)
router.use(authMiddleware);
// Apply domain middleware to all routes (respects link access domain)
router.use(domainAuthMiddleware);

const azureStorage = new Mau({
  connectionString: process.env.AZURE_BLOB_STORAGE_CONNECTION_STRING,
  accessKey: process.env.AZURE_BLOB_ACCOUNT_KEY,
  accountName: process.env.AZURE_BLOB_ACCOUNT_NAME,
  containerName: process.env.AZURE_BLOB_CONTAINER_NAME || "drhp-files",
  blobName: (req: any, file: any) => {
    return `${Date.now()}-${file.originalname}`;
  },
  metadata: (req: any, file: any) => {
    return { fieldName: file.fieldname };
  },
  contentSettings: (req: any, file: any) => {
    return { contentType: file.mimetype };
  }
});

const upload = multer({
  storage: azureStorage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB limit
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
  (req: Request, _res: Response, next: NextFunction) => {
    console.log("[upload-route] before multer upload.single");
    next();
  },
  upload.single("file"),
  (req: Request, _res: Response, next: NextFunction) => {
    const fileName = (req as any).file?.originalname || "unknown";
    console.log(`[upload-route] after multer upload.single file=${fileName}`);
    next();
  },
  // @ts-ignore
  function (err: any, req: Request, res: Response, next: NextFunction) {
    if (err && err.code === "LIMIT_FILE_SIZE") {
      return res
        .status(413)
        .json({ error: "File too large. Maximum size is 100MB." });
    }
    next(err);
  },
  (req: Request, res: Response, next: NextFunction) => {
    console.log("[upload-route] before controller uploadDocument");
    Promise.resolve(documentController.uploadDocument(req as any, res))
      .catch(next);
  }
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
