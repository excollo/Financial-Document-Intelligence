import mongoose from "mongoose";
import axios from "axios";
import { blobServiceClient, AZURE_BLOB_CONTAINER } from "../config/azureStorage";
import { testSmtpConnection } from "./emailService";
import sendEmail from "./emailService";
import { Domain } from "../models/Domain";

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
        azure_storage: ServiceStatus;
        ai_platform: ServiceStatus;
        external_ai?: {
            openai: ServiceStatus;
            pinecone: ServiceStatus;
            cohere: ServiceStatus;
            perplexity?: ServiceStatus;
            serper?: ServiceStatus;
        };
    };
}

export interface HealthCheckToggles {
    mongodb: boolean;
    brevo: boolean;
    azure_storage: boolean;
    ai_platform: boolean;
    external_ai: {
        openai: boolean;
        pinecone: boolean;
        cohere: boolean;
        perplexity: boolean;
        serper: boolean;
    };
}

export class HealthService {
    private static lastReport: SystemHealthReport | null = null;
    private static lastAlertSentAt: number | null = null;
    private static lastAlertFingerprint: string | null = null;
    private static readonly ALERT_COOLDOWN_MS = 15 * 60 * 1000;
    private static readonly EXCOLLO_DOMAIN = "excollo.com";
    private static readonly DEFAULT_ALERT_RECIPIENTS = [
        "sonuv@excollo.com",
        "development@excollo.com",
        "chinmaygupta@excollo.com",
    ];
    private static readonly DEFAULT_HEALTH_CHECK_TOGGLES: HealthCheckToggles = {
        mongodb: true,
        brevo: true,
        azure_storage: true,
        ai_platform: true,
        external_ai: {
            openai: true,
            pinecone: true,
            cohere: true,
            perplexity: false,
            serper: true,
        },
    };

    private static isHealthAlertsEnabled(): boolean {
        const explicitSetting = process.env.HEALTH_ALERTS_ENABLED;
        if (typeof explicitSetting === "string" && explicitSetting.trim() !== "") {
            return explicitSetting.toLowerCase() === "true";
        }

        const env = (process.env.NODE_ENV || "development").toLowerCase();
        return env === "production";
    }

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

    static async checkAzureBlobStorage(): Promise<ServiceStatus> {
        const start = Date.now();
        try {
            if (!blobServiceClient) {
                return {
                    status: "not_configured",
                    message: "Azure Blob Storage is not configured",
                };
            }

            const containerClient = blobServiceClient.getContainerClient(AZURE_BLOB_CONTAINER);
            const exists = await containerClient.exists();

            if (!exists) {
                return {
                    status: "error",
                    message: `Azure Container '${AZURE_BLOB_CONTAINER}' does not exist`,
                    error_code: "AZURE_STORAGE_CONTAINER_MISSING",
                };
            }

            return {
                status: "operational",
                message: `Successfully connected to Azure Blob Storage (Container: ${AZURE_BLOB_CONTAINER})`,
                latency: Date.now() - start,
            };
        } catch (error: any) {
            console.error("Azure Storage Health Check Error:", error);
            return {
                status: "error",
                message: error.message,
                error_code: "AZURE_STORAGE_ERROR",
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
        const pythonUrl = process.env.PYTHON_API_URL || "http://localhost:8000";
        const INTERNAL_SECRET = process.env.INTERNAL_SECRET || "";
        const normalizedBase = pythonUrl.replace(/\/+$/, "").replace(/\/api$/i, "");
        const localAltBase = normalizedBase.includes("localhost:8000")
            ? normalizedBase.replace("localhost:8000", "localhost:8001")
            : normalizedBase.includes("127.0.0.1:8000")
                ? normalizedBase.replace("127.0.0.1:8000", "127.0.0.1:8001")
                : null;
        const candidateUrls = [
            `${normalizedBase}/health/detailed`,
            `${pythonUrl.replace(/\/+$/, "")}/health/detailed`,
            `${pythonUrl.replace(/\/+$/, "")}/api/health/detailed`,
            ...(localAltBase ? [`${localAltBase}/health/detailed`] : []),
            "http://localhost:8000/health/detailed",
            "http://localhost:8001/health/detailed",
            "http://127.0.0.1:8000/health/detailed",
            "http://127.0.0.1:8001/health/detailed",
        ];
        const dedupedCandidateUrls = Array.from(new Set(candidateUrls));

        let lastError: any = null;
        const attemptErrors: string[] = [];
        try {
            for (const url of dedupedCandidateUrls) {
                try {
                    const response = await axios.get(url, {
                        headers: {
                            "X-Internal-Secret": INTERNAL_SECRET
                        },
                        timeout: 30000
                    });

                    return {
                        status: "operational",
                        message: "Successfully connected to AI Python Platform",
                        latency: Date.now() - start,
                        details: response.data,
                    };
                } catch (error: any) {
                    lastError = error;
                    attemptErrors.push(`${url} -> ${error?.message || "Unknown error"}`);
                }
            }

            return {
                status: "error",
                message: `Failed to connect to AI Python Platform: ${lastError?.message || "Unknown error"}`,
                error_code: "AI_PLATFORM_UNREACHABLE",
                details: { attempts: attemptErrors },
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
        try {
            const toggles = await this.getHealthCheckToggles();
            const disabledStatus = (name: string): ServiceStatus => ({
                status: "not_configured",
                message: `${name} health check disabled by admin`,
            });

            const [mongodb, brevo, azure_storage, ai_platform] = await Promise.all([
                toggles.mongodb
                    ? this.checkMongoDB().catch(e => ({ status: "error", message: `MongoDB Check Crash: ${e.message}` } as ServiceStatus))
                    : Promise.resolve(disabledStatus("MongoDB")),
                toggles.brevo
                    ? this.checkBrevo().catch(e => ({ status: "error", message: `Brevo Check Crash: ${e.message}` } as ServiceStatus))
                    : Promise.resolve(disabledStatus("Brevo")),
                toggles.azure_storage
                    ? this.checkAzureBlobStorage().catch(e => ({ status: "error", message: `Azure Check Crash: ${e.message}` } as ServiceStatus))
                    : Promise.resolve(disabledStatus("Azure Storage")),
                toggles.ai_platform
                    ? this.checkAIPlatform().catch(e => ({ status: "error", message: `AI Platform Check Crash: ${e.message}` } as ServiceStatus))
                    : Promise.resolve(disabledStatus("AI Platform")),
            ]);
            console.log("HealthService Results:", {
                mongodb: mongodb.status,
                brevo: brevo.status,
                azure_storage: azure_storage.status,
                ai_platform: ai_platform.status,
                ai_platform_overall: ai_platform.details?.overall_status
            });

            // Status aggregation
            let overall = "operational";
            if ([mongodb, brevo, azure_storage, ai_platform].some(s => s.status === "error")) {
                overall = "error";
            } else if (ai_platform.details?.overall_status === "error") {
                overall = "error";
            } else if ([mongodb, brevo, azure_storage, ai_platform].some(s => s.status === "degraded")) {
                overall = "degraded";
            }

        const externalAiServices = ai_platform.details?.services || ai_platform.details?.ai_services || {};
        const externalServiceStatus = (name: keyof HealthCheckToggles["external_ai"]): ServiceStatus => {
            if (!toggles.external_ai[name]) {
                return {
                    status: "not_configured",
                    message: `${name.toUpperCase()} health check disabled by admin`,
                };
            }
            return externalAiServices[name] || { status: "not_configured", message: "Not checked" };
        };

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
                azure_storage,
                ai_platform,
                external_ai: {
                    openai: externalServiceStatus("openai"),
                    pinecone: externalServiceStatus("pinecone"),
                    cohere: externalServiceStatus("cohere"),
                    perplexity: externalServiceStatus("perplexity"),
                    serper: externalServiceStatus("serper"),
                }
            },
        };

        // If critical error, send email alert
        if (this.isHealthAlertsEnabled() && overall === "error" && this.shouldSendAlert(report)) {
            console.log("HealthService: Triggering email alert...");
            this.sendEmailAlert(report).catch(err => console.error("HealthService: Async email alert failed:", err));
        }

        this.lastReport = report;
        return report;
        } catch (error: any) {
            console.error("HealthService: Error generating report:", error);
            throw error;
        }
    }

    private static shouldSendAlert(report: SystemHealthReport): boolean {
        const currentFingerprint = JSON.stringify({
            overall_status: report.overall_status,
            services: report.services,
        });

        if (this.lastAlertFingerprint !== currentFingerprint) {
            return true;
        }

        if (!this.lastAlertSentAt) {
            return true;
        }

        return Date.now() - this.lastAlertSentAt >= this.ALERT_COOLDOWN_MS;
    }

    private static async sendEmailAlert(report: SystemHealthReport) {
        const alertRecipients = await this.getAlertRecipients();
        if (!alertRecipients.length) {
            console.warn("HealthService: No valid health alert recipients configured");
            return;
        }

        try {
            const failingServices: string[] = [];
            const failureDetails: Array<{
                service: string;
                status: string;
                message: string;
                error_code?: string;
                details?: any;
            }> = [];

            const pushFailure = (service: string, serviceStatus: any) => {
                failingServices.push(service);
                failureDetails.push({
                    service,
                    status: serviceStatus?.status || "error",
                    message: serviceStatus?.message || "Unknown service health error",
                    error_code: serviceStatus?.error_code,
                    details: serviceStatus?.details,
                });
            };

            for (const [serviceName, serviceState] of Object.entries(report.services)) {
                if (serviceName === "external_ai" && serviceState) {
                    for (const [externalName, externalStatus] of Object.entries(serviceState as Record<string, any>)) {
                        if (externalStatus?.status === "error") {
                            pushFailure(`external_ai.${externalName}`, externalStatus);
                        }
                    }
                    continue;
                }

                const typedState = serviceState as any;
                if (typedState?.status === "error" || typedState?.details?.overall_status === "error") {
                    pushFailure(serviceName, typedState);
                }
            }

            await sendEmail({
                to: alertRecipients,
                subject: `[CRITICAL] System Health Alert - ${failingServices.join(", ")}`,
                template: "system-alert",
                data: {
                    timestamp: report.timestamp,
                    overall_status: report.overall_status,
                    services: report.services,
                    failingServices,
                    failureDetails,
                    dashboardUrl: `${process.env.FRONTEND_URL}/admin/dashboard?tab=health`
                }
            });
            console.log(`Health alert email sent to: ${alertRecipients.join(", ")}`);
            this.lastAlertSentAt = Date.now();
            this.lastAlertFingerprint = JSON.stringify({
                overall_status: report.overall_status,
                services: report.services,
            });
        } catch (error) {
            console.error("Failed to send health alert email:", error);
        }
    }

    static async getAlertRecipients(domainName?: string): Promise<string[]> {
        const targetDomain = (domainName || this.EXCOLLO_DOMAIN).trim().toLowerCase();
        const domainDoc = await Domain.findOne({ domainName: targetDomain })
            .select("health_alert_recipients")
            .lean();
        const persistedRecipients = Array.isArray((domainDoc as any)?.health_alert_recipients)
            ? (domainDoc as any).health_alert_recipients
            : [];

        const configuredList: string[] = persistedRecipients.length > 0
            ? persistedRecipients
            : process.env.HEALTH_ALERT_RECIPIENTS
            ? process.env.HEALTH_ALERT_RECIPIENTS.split(",").map((email) => email.trim()).filter(Boolean)
            : this.DEFAULT_ALERT_RECIPIENTS;

        const validRecipients = configuredList.filter((email: string) => this.isValidExcolloEmail(email));
        const invalidRecipients = configuredList.filter((email: string) => !this.isValidExcolloEmail(email));

        if (invalidRecipients.length > 0) {
            console.warn(
                `HealthService: Ignoring invalid health alert recipients (must be @${this.EXCOLLO_DOMAIN}): ${invalidRecipients.join(", ")}`
            );
        }
        if (validRecipients.length === 0) {
            console.error(
                `HealthService: No valid health alert recipients configured. Set HEALTH_ALERT_RECIPIENTS or domain health_alert_recipients.`
            );
        }

        return Array.from(new Set(validRecipients));
    }

    static async updateAlertRecipients(emails: string[], updatedBy?: string, domainName?: string): Promise<string[]> {
        const normalized = (emails || []).map((email) => String(email || "").trim().toLowerCase()).filter(Boolean);
        const validRecipients = normalized.filter((email) => this.isValidExcolloEmail(email));
        const uniqueValidRecipients = Array.from(new Set(validRecipients));

        if (uniqueValidRecipients.length === 0) {
            throw new Error(`At least one valid @${this.EXCOLLO_DOMAIN} recipient is required`);
        }

        const targetDomain = (domainName || this.EXCOLLO_DOMAIN).trim().toLowerCase();
        const domainDoc = await Domain.findOneAndUpdate(
            { domainName: targetDomain },
            {
                $set: {
                    health_alert_recipients: uniqueValidRecipients,
                    health_alert_updated_by: updatedBy || null,
                    updatedAt: new Date(),
                },
            },
            { new: true }
        ).select("domainName");

        if (!domainDoc) {
            throw new Error(`Domain '${targetDomain}' not found`);
        }

        return uniqueValidRecipients;
    }

    static async getHealthCheckToggles(domainName?: string): Promise<HealthCheckToggles> {
        const targetDomain = (domainName || this.EXCOLLO_DOMAIN).trim().toLowerCase();
        const domainDoc = await Domain.findOne({ domainName: targetDomain })
            .select("health_check_toggles")
            .lean();
        const saved = (domainDoc as any)?.health_check_toggles || {};
        return {
            ...this.DEFAULT_HEALTH_CHECK_TOGGLES,
            ...saved,
            external_ai: {
                ...this.DEFAULT_HEALTH_CHECK_TOGGLES.external_ai,
                ...(saved.external_ai || {}),
            },
        };
    }

    static async updateHealthCheckToggles(
        toggles: Partial<HealthCheckToggles>,
        updatedBy?: string,
        domainName?: string
    ): Promise<HealthCheckToggles> {
        const targetDomain = (domainName || this.EXCOLLO_DOMAIN).trim().toLowerCase();
        const current = await this.getHealthCheckToggles(targetDomain);
        const next: HealthCheckToggles = {
            ...current,
            ...toggles,
            external_ai: {
                ...current.external_ai,
                ...(toggles.external_ai || {}),
            },
        };

        const domainDoc = await Domain.findOneAndUpdate(
            { domainName: targetDomain },
            {
                $set: {
                    health_check_toggles: next,
                    health_alert_updated_by: updatedBy || null,
                    updatedAt: new Date(),
                },
            },
            { new: true }
        ).select("domainName");

        if (!domainDoc) {
            throw new Error(`Domain '${targetDomain}' not found`);
        }

        return next;
    }

    private static isValidExcolloEmail(email: string): boolean {
        return /^[^\s@]+@excollo\.com$/i.test(email);
    }
}
