import { Router } from "express";
import { authMiddleware } from "../middleware/auth";
import { domainAuthMiddleware } from "../middleware/domainAuth";
import { workspaceRequestController } from "../controllers/workspaceRequestController";

const router = Router();

// All routes require authentication
router.use(authMiddleware);
router.use(domainAuthMiddleware);

// User requests access to a workspace
router.post("/request", workspaceRequestController.requestAccess);

// Get available workspaces user can request (workspaces they don't have access to)
router.get("/available", workspaceRequestController.getAvailableWorkspaces);

// Get user's own requests
router.get("/my-requests", workspaceRequestController.getMyRequests);

// Admin: Get pending requests for a workspace
router.get("/workspace/:workspaceId/pending", workspaceRequestController.getPendingRequests);

// Admin: Approve or reject a request
router.post("/:requestId/review", workspaceRequestController.reviewRequest);

export default router;





















