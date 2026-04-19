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

router.get(
    "/admin/alert-recipients",
    authMiddleware,
    healthController.getAlertRecipients
);

router.put(
    "/admin/alert-recipients",
    authMiddleware,
    healthController.updateAlertRecipients
);

router.get(
    "/admin/check-toggles",
    authMiddleware,
    healthController.getHealthCheckToggles
);

router.put(
    "/admin/check-toggles",
    authMiddleware,
    healthController.updateHealthCheckToggles
);

export default router;
