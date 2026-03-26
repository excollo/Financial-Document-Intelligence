import express from "express";
import multer from "multer";
import { domainController } from "../controllers/domainController";
import { authMiddleware } from "../middleware/auth";

const router = express.Router();

// Multer config for SOP file uploads (memory storage for proxy forwarding)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max
    fileFilter: (_req, file, cb) => {
        const allowedTypes = [
            "application/pdf",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "text/plain",
        ];
        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error("Only PDF, DOCX, and TXT files are allowed"));
        }
    },
});

// ── Domain Configuration ──
// Get domain configuration (All authenticated users can read)
router.get("/config", authMiddleware, domainController.getConfig);

// Update domain configuration (Admin only)
router.put("/config", authMiddleware, domainController.updateConfig);

// ── Onboarding ──
// Get onboarding status
router.get("/onboarding/status", authMiddleware, domainController.getOnboardingStatus);

// Initial onboarding setup (Admin only, proxies to Python AI Platform)
router.post("/onboarding/setup", authMiddleware, upload.single("file"), domainController.setupOnboarding);

// Re-onboarding with updated SOP (Admin only, proxies to Python AI Platform)
router.post("/onboarding/re-onboard", authMiddleware, upload.single("file"), domainController.reOnboard);

// Trigger instant news monitor crawl
router.post("/trigger-news-crawl", authMiddleware, domainController.triggerInstantNewsCrawl);

export default router;
