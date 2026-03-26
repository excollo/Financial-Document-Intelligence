import { Router } from "express";
import { authMiddleware } from "../middleware/auth";
import { domainAuthMiddleware } from "../middleware/domainAuth";
import { workspaceController } from "../controllers/workspaceController";

const router = Router();

// Public check endpoint (no domain auth needed for first login check)
router.get("/check-first-login", authMiddleware, workspaceController.checkFirstLogin);

// Admin-only workspace management under current domain
router.use(authMiddleware);
router.use(domainAuthMiddleware);

router.post("/", workspaceController.create);
router.get("/", workspaceController.list);
router.patch("/:workspaceId", workspaceController.update);
router.delete("/:workspaceId", workspaceController.archive);

// Members management
router.get("/:workspaceId/members", workspaceController.listMembers);
router.post("/:workspaceId/members", workspaceController.addMember);
router.delete("/:workspaceId/members/:memberId", workspaceController.removeMember);

// Document management
router.post("/:workspaceId/move-document", workspaceController.moveDocument);

// User's workspaces (via membership)
router.get("/my-workspaces", workspaceController.getMyWorkspaces);

// Migration endpoint (admin only) - migrates legacy accessibleWorkspaces to WorkspaceMembership
router.post("/migrate-legacy-workspaces", workspaceController.migrateLegacyWorkspaces);

export default router;


