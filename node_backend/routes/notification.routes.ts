import express from "express";
import { authMiddleware } from "../middleware/auth";
import { domainAuthMiddleware } from "../middleware/domainAuth";
import { notificationController } from "../controllers/notificationController";

const router = express.Router();

router.use(authMiddleware);
router.use(domainAuthMiddleware);

router.get("/", notificationController.list);
router.post("/:id/read", notificationController.markRead);
router.post("/read-all", notificationController.markAllRead);
router.delete("/:id", notificationController.delete);

export default router;



