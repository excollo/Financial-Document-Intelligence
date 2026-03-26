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
    }
};
