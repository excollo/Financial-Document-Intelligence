import express from "express";
import { directoryController } from "../controllers/directoryController";
import { authMiddleware } from "../middleware/auth";
import { domainAuthMiddleware } from "../middleware/domainAuth";
import { linkAccess } from "../middleware/linkAccess";
import { requireCreateInDirectory, requireDirectoryPermission } from "../middleware/permissions";

import { cacheRoute, clearCachePrefix } from "../middleware/cacheRoute";

const router = express.Router();

router.use(authMiddleware);
router.use(domainAuthMiddleware);
router.use(linkAccess);

// NEW: Search and duplicate check endpoints (before :id routes)
router.get("/search", cacheRoute(60), directoryController.search);
router.post("/check-duplicate", directoryController.checkDuplicate);

// Add clearCachePrefix hook so POST/DELETE clears directories cache
router.use(clearCachePrefix);

router.post("/", requireCreateInDirectory, directoryController.create);
router.get("/:id", requireDirectoryPermission("id", "viewer"), cacheRoute(600), directoryController.getById);
router.get("/:id/children", requireDirectoryPermission("id", "viewer"), cacheRoute(600), directoryController.listChildren);
router.patch("/:id", requireDirectoryPermission("id", "editor"), directoryController.update);
router.post("/:id/move", requireDirectoryPermission("id", "editor"), directoryController.move);
router.delete("/:id", requireDirectoryPermission("id", "editor"), directoryController.delete);
// Restore route removed (trash disabled)
// Future: move subtree endpoint could be added here

export default router;


