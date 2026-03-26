import { Router } from "express";
import { healthController } from "../controllers/healthController";
import { authMiddleware } from "../middleware/auth";

const router = Router();

// Public health check
router.get("/basic", healthController.basicHealth);

// Admin health check
router.get(
    "/admin/detailed",
    authMiddleware,
    healthController.getSystemHealth
);

export default router;
