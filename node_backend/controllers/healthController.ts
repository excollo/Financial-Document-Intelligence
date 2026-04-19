import { Request, Response } from "express";
import { HealthService } from "../services/healthService";

export const healthController = {
    async getSystemHealth(req: Request, res: Response) {
        try {
            // Check if user is admin
            const user = (req as any).user;
            if (!user || user.role !== "admin") {
                return res.status(403).json({ error: "Access denied. Admin only." });
            }

            const report = await HealthService.generateFullReport();
            res.json(report);
        } catch (error: any) {
            console.error("Error in getSystemHealth:", error);
            res.status(500).json({ error: "Failed to generate health report", message: error.message });
        }
    },

    async basicHealth(req: Request, res: Response) {
        res.json({ status: "operational", timestamp: new Date().toISOString() });
    },

    async getAlertRecipients(req: Request, res: Response) {
        try {
            const user = (req as any).user;
            if (!user || user.role !== "admin") {
                return res.status(403).json({ error: "Access denied. Admin only." });
            }

            const recipients = await HealthService.getAlertRecipients(user.domain);
            return res.json({ recipients });
        } catch (error: any) {
            console.error("Error in getAlertRecipients:", error);
            return res.status(500).json({ error: "Failed to load alert recipients", message: error.message });
        }
    },

    async updateAlertRecipients(req: Request, res: Response) {
        try {
            const user = (req as any).user;
            if (!user || user.role !== "admin") {
                return res.status(403).json({ error: "Access denied. Admin only." });
            }

            const recipients = Array.isArray(req.body?.recipients) ? req.body.recipients : [];
            const updated = await HealthService.updateAlertRecipients(
                recipients,
                user.email || user.id || user._id?.toString?.(),
                user.domain
            );

            return res.json({
                message: "Health alert recipients updated successfully",
                recipients: updated,
            });
        } catch (error: any) {
            console.error("Error in updateAlertRecipients:", error);
            return res.status(400).json({ error: "Failed to update alert recipients", message: error.message });
        }
    },

    async getHealthCheckToggles(req: Request, res: Response) {
        try {
            const user = (req as any).user;
            if (!user || user.role !== "admin") {
                return res.status(403).json({ error: "Access denied. Admin only." });
            }

            const toggles = await HealthService.getHealthCheckToggles(user.domain);
            return res.json({ toggles });
        } catch (error: any) {
            console.error("Error in getHealthCheckToggles:", error);
            return res.status(500).json({ error: "Failed to load health check toggles", message: error.message });
        }
    },

    async updateHealthCheckToggles(req: Request, res: Response) {
        try {
            const user = (req as any).user;
            if (!user || user.role !== "admin") {
                return res.status(403).json({ error: "Access denied. Admin only." });
            }

            const toggles = req.body?.toggles || {};
            const updated = await HealthService.updateHealthCheckToggles(
                toggles,
                user.email || user.id || user._id?.toString?.(),
                user.domain
            );

            return res.json({
                message: "Health check toggles updated successfully",
                toggles: updated,
            });
        } catch (error: any) {
            console.error("Error in updateHealthCheckToggles:", error);
            return res.status(400).json({ error: "Failed to update health check toggles", message: error.message });
        }
    },
};
