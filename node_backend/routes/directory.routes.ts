import express from "express";
import { directoryController } from "../controllers/directoryController";
import { authMiddleware } from "../middleware/auth";
import { domainAuthMiddleware } from "../middleware/domainAuth";
import { linkAccess } from "../middleware/linkAccess";
import { requireCreateInDirectory, requireDirectoryPermission } from "../middleware/permissions";

const router = express.Router();

router.use(authMiddleware);
router.use(domainAuthMiddleware);
router.use(linkAccess);

// NEW: Search and duplicate check endpoints (before :id routes)
router.get("/search", directoryController.search);
router.post("/check-duplicate", directoryController.checkDuplicate);

router.post("/", requireCreateInDirectory, directoryController.create);
router.get("/:id", requireDirectoryPermission("id", "viewer"), directoryController.getById);
router.get("/:id/children", requireDirectoryPermission("id", "viewer"), directoryController.listChildren);
router.patch("/:id", requireDirectoryPermission("id", "editor"), directoryController.update);
router.post("/:id/move", requireDirectoryPermission("id", "editor"), directoryController.move);
router.delete("/:id", requireDirectoryPermission("id", "editor"), directoryController.delete);
// Restore route removed (trash disabled)
// Future: move subtree endpoint could be added here

export default router;


