import mongoose from "mongoose";
import axios from "axios";
import { r2Client, R2_BUCKET } from "../config/r2";
import { ListBucketsCommand } from "@aws-sdk/client-s3";
import { testSmtpConnection } from "./emailService";
import sendEmail from "./emailService";

export interface ServiceStatus {
    status: "operational" | "degraded" | "error" | "not_configured";
    message: string;
    latency?: number;
    error_code?: string;
    details?: any;
}

export interface SystemHealthReport {
    overall_status: string;
    timestamp: string;
    platform?: {
        name: string;
        version: string;
        status: string;
    };
    services: {
        mongodb: ServiceStatus;
        brevo: ServiceStatus;
        cloudflare_r2: ServiceStatus;
        azure_storage: ServiceStatus;
        ai_platform: ServiceStatus;
        external_ai?: {
            openai: ServiceStatus;
            pinecone: ServiceStatus;
            cohere: ServiceStatus;
            perplexity?: ServiceStatus;
        };
    };
}

export class HealthService {
    private static lastReport: SystemHealthReport | null = null;

    static async checkMongoDB(): Promise<ServiceStatus> {
        const start = Date.now();
        const state = mongoose.connection.readyState;
        // 0 = disconnected, 1 = connected, 2 = connecting, 3 = disconnecting
        if (state === 1) {
            return {
                status: "operational",
                message: "Connected to MongoDB",
                latency: Date.now() - start,
            };
        }
        return {
            status: "error",
            message: `MongoDB connection state: ${state}`,
            error_code: "DB_CONNECTION_ERROR",
        };
    }

    static async checkBrevo(): Promise<ServiceStatus> {
        const isReady = await testSmtpConnection();
        return {
            status: isReady ? "operational" : "error",
            message: isReady ? "Brevo (SMTP) is ready" : "Brevo configuration is incomplete or failing",
        };
    }

    static async checkCloudflareR2(): Promise<ServiceStatus> {
        const start = Date.now();
        try {
            // Use HeadBucket or ListObjects instead of ListBuckets (which often requires account-level permissions)
            const { ListObjectsV2Command } = await import("@aws-sdk/client-s3");
            await r2Client.send(new ListObjectsV2Command({ Bucket: R2_BUCKET, MaxKeys: 1 }));

            return {
                status: "operational",
                message: `Successfully connected to Cloudflare R2 (Bucket: ${R2_BUCKET})`,
                latency: Date.now() - start,
            };
        } catch (error: any) {
            console.error("R2 Health Check Error:", error);
            return {
                status: "error",
                message: error.name === "AccessDenied" ? "Access Denied (Check token permissions)" : error.message,
                error_code: "R2_ACCESS_ERROR",
            };
        }
    }

    static async checkAzureStorage(): Promise<ServiceStatus> {
        // Placeholder for future Azure integration
        if (!process.env.AZURE_STORAGE_CONNECTION_STRING && !process.env.AZURE_STORAGE_ACCOUNT_NAME) {
            return {
                status: "not_configured",
                message: "Azure Storage variables not set. Skipping.",
            };
        }
        return {
            status: "operational",
            message: "Azure Storage check configured (Future)",
        };
    }

    static async checkAIPlatform(): Promise<ServiceStatus> {
        const start = Date.now();
        const pythonUrl = process.env.PYTHON_API_URL || "http://localhost:8001";
        const INTERNAL_SECRET = process.env.INTERNAL_SECRET || "";
        try {
            const response = await axios.get(`${pythonUrl}/health/detailed`, { 
                headers: {
                    "X-Internal-Secret": INTERNAL_SECRET
                },
                timeout: 10000 
            });
            return {
                status: "operational",
                message: "Successfully connected to AI Python Platform",
                latency: Date.now() - start,
                details: response.data,
            };
        } catch (error: any) {
            return {
                status: "error",
                message: `Failed to connect to AI Python Platform: ${error.message}`,
                error_code: "AI_PLATFORM_UNREACHABLE",
            };
        }
    }

    static async generateFullReport(): Promise<SystemHealthReport> {
        console.log("HealthService: Starting full report generation...");
        let mongodb, brevo, cloudflare_r2, azure_storage, ai_platform;

        try {
            [mongodb, brevo, cloudflare_r2, azure_storage, ai_platform] = await Promise.all([
                this.checkMongoDB().catch(e => ({ status: "error", message: `MongoDB Check Crash: ${e.message}` } as ServiceStatus)),
                this.checkBrevo().catch(e => ({ status: "error", message: `Brevo Check Crash: ${e.message}` } as ServiceStatus)),
                this.checkCloudflareR2().catch(e => ({ status: "error", message: `R2 Check Crash: ${e.message}` } as ServiceStatus)),
                this.checkAzureStorage().catch(e => ({ status: "error", message: `Azure Check Crash: ${e.message}` } as ServiceStatus)),
                this.checkAIPlatform().catch(e => ({ status: "error", message: `AI Platform Check Crash: ${e.message}` } as ServiceStatus)),
            ]);
            console.log("HealthService Results:", {
                mongodb: mongodb.status,
                brevo: brevo.status,
                cloudflare_r2: cloudflare_r2.status,
                ai_platform: ai_platform.status,
                ai_platform_overall: ai_platform.details?.overall_status
            });
        } catch (e: any) {
            console.error("HealthService: Promise.all failed critically:", e);
            throw e;
        }

        let overall = "operational";
        if ([mongodb, brevo, cloudflare_r2, ai_platform].some(s => s.status === "error")) {
            overall = "error";
        } else if (ai_platform.details?.overall_status === "error") {
            overall = "error";
        } else if ([mongodb, brevo, cloudflare_r2, ai_platform].some(s => s.status === "degraded")) {
            overall = "degraded";
        }

        const externalAiServices = ai_platform.details?.services || {};

        const report: SystemHealthReport = {
            overall_status: overall,
            timestamp: new Date().toISOString(),
            platform: {
                name: "Node.js Backend",
                version: "1.0.0",
                status: "operational",
            },
            services: {
                mongodb,
                brevo,
                cloudflare_r2,
                azure_storage,
                ai_platform,
                external_ai: {
                    openai: externalAiServices.openai || { status: "not_configured", message: "Not checked" },
                    pinecone: externalAiServices.pinecone || { status: "not_configured", message: "Not checked" },
                    cohere: externalAiServices.cohere || { status: "not_configured", message: "Not checked" },
                    perplexity: externalAiServices.perplexity || { status: "not_configured", message: "Not checked" },
                }
            },
        };

        // If critical error, send email alert
        if (overall === "error" && this.shouldSendAlert(report)) {
            console.log("HealthService: Triggering email alert...");
            this.sendEmailAlert(report).catch(err => console.error("HealthService: Async email alert failed:", err));
        }

        this.lastReport = report;
        return report;
    }

    private static shouldSendAlert(report: SystemHealthReport): boolean {
        // Basic throttle logic: don't spam emails
        // For now, if Status changed to error, send alert.
        if (!this.lastReport || this.lastReport.overall_status !== "error") {
            return true;
        }
        return false;
    }

    private static async sendEmailAlert(report: SystemHealthReport) {
        const adminEmail = process.env.ADMIN_EMAIL || process.env.BREVO_FROM_EMAIL;
        if (!adminEmail) return;

        try {
            const failingServices = Object.entries(report.services)
                .filter(([_, s]: any) => s.status === "error" || (s.details?.overall_status === "error"))
                .map(([name, _]) => name);

            await sendEmail({
                to: adminEmail,
                subject: `[CRITICAL] System Health Alert - ${failingServices.join(", ")}`,
                template: "system-alert",
                data: {
                    timestamp: report.timestamp,
                    overall_status: report.overall_status,
                    services: report.services,
                    failingServices,
                    dashboardUrl: `${process.env.FRONTEND_URL}/admin/dashboard?tab=health`
                }
            });
            console.log("Health alert email sent to admin");
        } catch (error) {
            console.error("Failed to send health alert email:", error);
        }
    }
}
