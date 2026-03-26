import { Router } from "express";
import { authMiddleware } from "../middleware/auth";
import { domainAuthMiddleware } from "../middleware/domainAuth";
import { tenantIsolation } from "../middleware/tenantIsolation";
import {
  listSopConfigs,
  getActiveSopConfig,
  getSopConfig,
  createSopConfig,
  updateSopConfig,
  activateSopConfig,
  deleteSopConfig,
} from "../controllers/sopConfigController";

const router = Router();

// All SOP config routes require authentication + domain resolution + tenant isolation
router.use(authMiddleware, domainAuthMiddleware, tenantIsolation);

router.get("/", listSopConfigs);
router.get("/active", getActiveSopConfig);
router.get("/:id", getSopConfig);
router.post("/", createSopConfig);
router.put("/:id", updateSopConfig);
router.post("/:id/activate", activateSopConfig);
router.delete("/:id", deleteSopConfig);

export default router;
