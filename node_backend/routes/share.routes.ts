import express from "express";
import { authMiddleware } from "../middleware/auth";
import { domainAuthMiddleware } from "../middleware/domainAuth";
import { shareController } from "../controllers/shareController";

const router = express.Router();

router.use(authMiddleware);
router.use(domainAuthMiddleware);

router.get("/", shareController.list);
router.post("/", shareController.create);
router.delete("/:id", shareController.revoke);
router.post("/link", shareController.linkCreateOrRotate);
router.get("/link/:token", shareController.linkResolve);

export default router;








