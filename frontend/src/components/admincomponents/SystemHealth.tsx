import React, { useState, useEffect } from "react";
import { healthService } from "@/services/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, XCircle, AlertCircle, RefreshCw, Terminal, Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface ServiceStatus {
    status: "operational" | "degraded" | "error" | "not_configured" | "loading";
    message: string;
    latency?: number;
    error_code?: string;
}

export const SystemHealth: React.FC = () => {
    const [loading, setLoading] = useState(true);
    const [report, setReport] = useState<any>(null);
    const [logs, setLogs] = useState<string[]>([]);

    const addLog = (msg: string) => {
        setLogs(prev => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev.slice(0, 49)]);
    };

    const fetchHealth = async () => {
        setLoading(true);
        addLog("Starting system health check...");
        try {
            const data = await healthService.getDetailedStatus();
            setReport(data);
            addLog(`Health check completed. Overall Status: ${data.overall_status.toUpperCase()}`);
            if (data.overall_status === "error") {
                toast.error("System issues detected!");
            } else {
                toast.success("All systems operational");
            }
        } catch (error: any) {
            const errorMsg = error.response?.data?.message || error.message;
            addLog(`Health check failed: ${errorMsg}`);
            toast.error(`System Health Error: ${errorMsg}`);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchHealth();
    }, []);

    const StatusIcon = ({ status }: { status: string }) => {
        switch (status) {
            case "operational": return <CheckCircle2 className="h-5 w-5 text-green-500" />;
            case "error": return <XCircle className="h-5 w-5 text-red-500" />;
            case "degraded": return <AlertCircle className="h-5 w-5 text-yellow-500" />;
            case "not_configured": return <AlertCircle className="h-5 w-5 text-gray-400" />;
            case "loading": return <RefreshCw className="h-5 w-5 animate-spin text-blue-500" />;
            default: return <AlertCircle className="h-5 w-5 text-gray-300" />;
        }
    };

    const ServiceCard = ({ title, status, details, loading }: { title: string, status: any, details?: any, loading: boolean }) => {
        const s = status || (loading ? { status: "loading", message: "Checking..." } : { status: "error", message: "Failed to connect" });
        return (
            <Card className="hover:shadow-md transition-shadow">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium uppercase tracking-wider">{title}</CardTitle>
                    <StatusIcon status={s.status} />
                </CardHeader>
                <CardContent>
                    <div className="text-xs text-muted-foreground mt-1 line-clamp-2 min-h-8">
                        {s.message}
                    </div>
                    {s.latency && (
                        <div className="mt-2 flex items-center gap-1 text-[10px] font-mono text-blue-600">
                            <Activity className="h-3 w-3" />
                            {s.latency}ms
                        </div>
                    )}
                </CardContent>
            </Card>
        );
    };

    return (
        <div className="space-y-6 animate-in fade-in duration-500">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-2xl font-bold text-[#4B2A06]">System Infrastructure</h2>
                    <p className="text-sm text-gray-500">Real-time health status of all core services and external APIs.</p>
                </div>
                <Button
                    onClick={fetchHealth}
                    disabled={loading}
                    variant="outline"
                    className="gap-2 border-[#4B2A06] text-[#4B2A06] hover:bg-[#4B2A06] hover:text-white"
                >
                    <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
                    Run Manual Check
                </Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* Core Infrastructure */}
                <ServiceCard
                    title="Node.js Backend"
                    status={report?.platform ? { status: report.platform.status, message: `v${report.platform.version}` } : null}
                    loading={loading}
                />
                <ServiceCard
                    title="Python AI Engine"
                    status={report?.services?.ai_platform}
                    loading={loading}
                />
                <ServiceCard title="Database (Mongo)" status={report?.services?.mongodb} loading={loading} />
                <ServiceCard title="Email (Brevo)" status={report?.services?.brevo} loading={loading} />
                <ServiceCard title="Cloudflare R2" status={report?.services?.cloudflare_r2} loading={loading} />
                <ServiceCard title="Azure Storage" status={report?.services?.azure_storage} loading={loading} />

                {/* External AI APIs */}
                <ServiceCard title="OpenAI API" status={report?.services?.external_ai?.openai} loading={loading} />
                <ServiceCard title="Pinecone DB" status={report?.services?.external_ai?.pinecone} loading={loading} />
                <ServiceCard title="Cohere API" status={report?.services?.external_ai?.cohere} loading={loading} />
                <ServiceCard title="Perplexity API" status={report?.services?.external_ai?.perplexity} loading={loading} />
            </div>

            <Card className="bg-[#1A1A1A] border-none shadow-2xl">
                <CardHeader className="border-b border-white/10 pb-3">
                    <CardTitle className="text-sm text-white/70 flex items-center gap-2">
                        <Terminal className="h-4 w-4" />
                        System Health Logs
                    </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                    <div className="h-[200px] overflow-y-auto p-4 font-mono text-xs leading-relaxed">
                        {logs.length === 0 ? (
                            <div className="text-white/30 italic">No logs available. Start check...</div>
                        ) : (
                            logs.map((log, i) => (
                                <div key={i} className={cn(
                                    "mb-1",
                                    log.includes("error") || log.includes("failed") ? "text-red-400" :
                                        log.includes("operational") ? "text-green-400" : "text-white/80"
                                )}>
                                    {log}
                                </div>
                            ))
                        )}
                    </div>
                </CardContent>
            </Card>
        </div>
    );
};
