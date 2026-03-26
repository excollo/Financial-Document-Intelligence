
import React, { useState, useEffect } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { Loader2, Upload, CheckCircle, AlertCircle, RefreshCw, Shield, Brain, Search, Sparkles, ArrowRight, Zap, Plus, X, Info, Users, Building2 } from 'lucide-react';
import { useToast } from "@/components/ui/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from 'react-router-dom';
import { domainService, OnboardingStatus } from '@/services/domainService';
import { Navbar } from "@/components/sharedcomponents/Navbar";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Label } from "@/components/ui/label";

const OnboardingPage = () => {
    const { user } = useAuth();
    const { toast } = useToast();
    const navigate = useNavigate();
    const [isLoading, setIsLoading] = useState(false);
    const [sopFile, setSopFile] = useState<File | null>(null);
    const [onboardingStatus, setOnboardingStatus] = useState<OnboardingStatus | null>(null);
    const [isLoadingStatus, setIsLoadingStatus] = useState(true);
    const [isReOnboarding, setIsReOnboarding] = useState(false);
    const [isCrawling, setIsCrawling] = useState(false);

    const [inputInvestor, setInputInvestor] = useState("");
    const [inputCompany, setInputCompany] = useState("");

    const { control, handleSubmit, register, setValue, watch, formState: { errors } } = useForm({
        defaultValues: {
            investor_match_only: false,
            valuation_matching: false,
            adverse_finding: false,
            news_monitor_enabled: false,
            target_investors: [] as string[],
            monitored_companies: [] as string[],
        }
    });

    const newsMonitorEnabled = watch("news_monitor_enabled");

    // Fetch existing onboarding status on mount
    useEffect(() => {
        const fetchStatus = async () => {
            try {
                const status = await domainService.getOnboardingStatus();
                setOnboardingStatus(status);

                // Pre-fill form with existing toggles
                if (status.toggles) {
                    setValue("investor_match_only", status.toggles.investor_match_only);
                    setValue("valuation_matching", status.toggles.valuation_matching);
                    setValue("adverse_finding", status.toggles.adverse_finding);
                    setValue("news_monitor_enabled", status.toggles.news_monitor_enabled || false);
                }
                if (status.target_investors) {
                    setValue("target_investors", status.target_investors);
                }
                if (status.monitored_companies) {
                    setValue("monitored_companies", status.monitored_companies);
                }

                // If already completed, show re-onboarding mode
                if (status.onboarding_status === "completed" || status.onboarding_status === "completed_no_sop") {
                    setIsReOnboarding(true);
                }
            } catch (err) {
                console.error("Failed to fetch onboarding status:", err);
            } finally {
                setIsLoadingStatus(false);
            }
        };
        fetchStatus();
    }, [setValue]);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];
            if (file.type === "application/pdf" || file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
                setSopFile(file);
            } else {
                toast({
                    title: "Invalid file type",
                    description: "Please upload a PDF or DOCX file.",
                    variant: "destructive"
                });
            }
        }
    };

    const onSubmit = async (data: any) => {
        setIsLoading(true);

        try {
            const config = {
                toggles: {
                    investor_match_only: data.investor_match_only,
                    valuation_matching: data.valuation_matching,
                    adverse_finding: data.adverse_finding,
                    news_monitor_enabled: data.news_monitor_enabled
                },
                targetInvestors: data.target_investors || [],
                monitoredCompanies: data.monitored_companies || []
            };

            if (isReOnboarding) {
                // Re-onboarding requires a file
                if (!sopFile) {
                    toast({
                        title: "SOP File Required",
                        description: "Please upload an updated SOP file for re-onboarding.",
                        variant: "destructive"
                    });
                    setIsLoading(false);
                    return;
                }
                await domainService.reOnboard({ config, file: sopFile });
            } else {
                // Initial onboarding (file is optional)
                await domainService.submitOnboarding({ config, file: sopFile || undefined });
            }

            toast({
                title: isReOnboarding ? "Re-Onboarding Started" : "Onboarding Started",
                description: "Our AI agents are analyzing your SOP and configuring the pipeline. This may take a few minutes.",
            });

            // Redirect to Dashboard after short delay
            setTimeout(() => {
                navigate('/dashboard');
            }, 2500);

        } catch (error: any) {
            console.error(error);
            toast({
                title: "Submission Failed",
                description: error?.response?.data?.error || "There was an error submitting your details. Please try again.",
                variant: "destructive"
            });
        } finally {
            setIsLoading(false);
        }
    };

    if (isLoadingStatus) {
        return (
            <div className="min-h-screen bg-gray-50">
                <Navbar title="Onboarding" showSearch={false} searchValue="" onSearchChange={() => { }} />
                <div className="flex items-center justify-center min-h-[70vh]">
                    <div className="flex flex-col items-center gap-3">
                        <Loader2 className="h-8 w-8 animate-spin text-[#4B2A06]" />
                        <span className="text-sm text-gray-500 font-medium">Loading configuration...</span>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-50">
            <Navbar
                title={isReOnboarding ? "Re-Configure Pipeline" : "Platform Setup"}
                showSearch={false}
                searchValue=""
                onSearchChange={() => { }}
            />

            <div className="max-w-5xl mx-auto px-4 py-8">

                {/* Status Banner */}
                {onboardingStatus && onboardingStatus.onboarding_status !== "pending" && (
                    <div className="bg-white shadow-sm rounded-lg p-5 mb-6 border-l-4"
                        style={{
                            borderLeftColor: onboardingStatus.onboarding_status === "completed" ? "#16a34a" :
                                onboardingStatus.onboarding_status === "processing" ? "#ca8a04" :
                                    onboardingStatus.onboarding_status === "failed" ? "#dc2626" : "#6b7280"
                        }}
                    >
                        <div className="flex items-start gap-4">
                            <div className={`p-2.5 rounded-full ${onboardingStatus.onboarding_status === "completed" ? "bg-green-50 text-green-600" :
                                onboardingStatus.onboarding_status === "processing" ? "bg-yellow-50 text-yellow-600" :
                                    onboardingStatus.onboarding_status === "failed" ? "bg-red-50 text-red-600" :
                                        "bg-gray-100 text-gray-500"
                                }`}>
                                {onboardingStatus.onboarding_status === "completed" ? <CheckCircle className="h-5 w-5" /> :
                                    onboardingStatus.onboarding_status === "processing" ? <Loader2 className="h-5 w-5 animate-spin" /> :
                                        <AlertCircle className="h-5 w-5" />}
                            </div>
                            <div className="flex-1">
                                <h3 className="font-semibold text-[#4B2A06] text-lg">
                                    {onboardingStatus.onboarding_status === "completed" ? "Onboarding Complete" :
                                        onboardingStatus.onboarding_status === "processing" ? "Onboarding In Progress" :
                                            onboardingStatus.onboarding_status === "completed_no_sop" ? "Basic Config Active" :
                                                "Onboarding Status"}
                                </h3>
                                {onboardingStatus.last_onboarded && (
                                    <p className="text-sm text-gray-500 mt-1">
                                        Last configured: {new Date(onboardingStatus.last_onboarded).toLocaleString()}
                                    </p>
                                )}

                                {/* Config Summary */}
                                {(onboardingStatus.onboarding_status === "completed") && (
                                    <div className="mt-4 flex gap-4 flex-wrap">
                                        <div className="flex items-center gap-2 text-sm bg-gray-50 px-3 py-1.5 rounded-md">
                                            <Search className="h-4 w-4 text-[#4B2A06]" />
                                            <span className="text-gray-700 font-medium">{onboardingStatus.custom_subqueries_count} Subqueries</span>
                                        </div>
                                        <div className="flex items-center gap-2 text-sm bg-gray-50 px-3 py-1.5 rounded-md">
                                            <Brain className="h-4 w-4 text-[#4B2A06]" />
                                            <span className="text-gray-700 font-medium">Agent 3: {onboardingStatus.has_agent3_prompt ? "Custom" : "Default"}</span>
                                        </div>
                                        <div className="flex items-center gap-2 text-sm bg-gray-50 px-3 py-1.5 rounded-md">
                                            <Shield className="h-4 w-4 text-[#4B2A06]" />
                                            <span className="text-gray-700 font-medium">Agent 4: {onboardingStatus.has_agent4_prompt ? "Custom" : "Default"}</span>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {/* Page Header */}
                <div className="mb-8 flex items-center justify-between">
                    <div className="w-full">
                        <h1 className="text-2xl font-bold text-[#4B2A06]">
                            {isReOnboarding ? "Update SOP & Re-Configure" : "Welcome to Smart DRHP Platform"}
                        </h1>
                        <p className="text-gray-500 mt-2 text-sm">
                            {isReOnboarding
                                ? "Upload an updated SOP to re-configure your AI pipeline. All custom prompts and subqueries will be regenerated."
                                : "Let's tailor the AI experience for your fund's specific requirements."
                            }
                        </p>
                    </div>
                    {/* Skip Option (first-time only) */}
                    {!isReOnboarding && (
                        <button
                            type="button"
                            onClick={() => navigate('/dashboard')}
                            className="w-50 justify-end text-center text-sm text-[#4B2A06] hover:text-[#4B2A06] transition-colors py-2 border border-[#4B2A06] rounded-md"
                        >
                            Skip for now — use default configuration
                        </button>
                    )}
                </div>

                <form onSubmit={handleSubmit(onSubmit)}>
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

                        {/* Left Column - SOP Upload */}
                        <div className="lg:col-span-7 space-y-5">
                            <div className="bg-white shadow-sm rounded-lg p-5">
                                <div className="flex items-center gap-2 mb-4">
                                    <FileTextIcon className="h-5 w-5 text-[#4B2A06]" />
                                    <h2 className="text-lg font-bold text-[#4B2A06]">
                                        {isReOnboarding ? "Upload Updated SOP" : "Upload Your SOP"}
                                    </h2>
                                    {isReOnboarding && (
                                        <span className="text-xs bg-yellow-50 text-yellow-700 border border-yellow-200 px-2 py-0.5 rounded-full font-medium">Required</span>
                                    )}
                                </div>

                                {/* Upload Area */}
                                <div className={`relative border-2 border-dashed rounded-lg p-8 flex flex-col items-center justify-center text-center transition-all cursor-pointer ${sopFile
                                    ? "border-green-300 bg-green-50/30"
                                    : "border-gray-200 bg-gray-50/50 hover:border-[#4B2A06]/30 hover:bg-gray-50"
                                    }`}>
                                    <input
                                        type="file"
                                        accept=".pdf,.docx"
                                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                        onChange={handleFileChange}
                                    />
                                    {sopFile ? (
                                        <div className="flex flex-col items-center">
                                            <CheckCircle className="h-10 w-10 text-green-500 mb-3" />
                                            <p className="font-semibold text-[rgba(38,40,43,1)]">{sopFile.name}</p>
                                            <p className="text-xs text-gray-500 mt-1">{(sopFile.size / 1024 / 1024).toFixed(2)} MB</p>
                                        </div>
                                    ) : (
                                        <div className="flex flex-col items-center">
                                            <div className="p-3 bg-white rounded-full shadow-sm mb-3">
                                                <Upload className="h-6 w-6 text-[#4B2A06]" />
                                            </div>
                                            <p className="font-semibold text-[rgba(38,40,43,1)]">Upload your Fund's Custom Summary SOP</p>
                                            <p className="text-xs text-gray-400 mt-1">Accepts PDF or DOCX</p>
                                        </div>
                                    )}
                                </div>

                                <p className="text-sm text-gray-500 mt-3">
                                    {isReOnboarding
                                        ? "The Onboarding Agent will re-analyze your SOP, refactor subqueries, and regenerate custom prompts for Agents 3 & 4."
                                        : "Our Onboarding Agent will analyze your SOP document to customize the summary generation structure and validation rules automatically."
                                    }
                                </p>

                                {/* Onboarding Pipeline Steps */}
                                {sopFile && (
                                    <div className="mt-5 bg-gray-50 rounded-lg p-4">
                                        <p className="text-sm font-semibold text-[#4B2A06] mb-3 flex items-center gap-2">
                                            <Sparkles className="h-4 w-4" />
                                            AI Onboarding Pipeline
                                        </p>
                                        <div className="space-y-2.5">
                                            {[
                                                "Analyze SOP & extract section requirements",
                                                `Refactor subqueries for your domain (${isReOnboarding ? "re-" : ""}compare vs 10 defaults)`,
                                                "Customize Summarization Agent (Agent 3) prompt",
                                                "Customize Validation Agent (Agent 4) prompt"
                                            ].map((step, idx) => (
                                                <div key={idx} className="flex items-center gap-3 text-sm">
                                                    <span className="bg-[#4B2A06] text-white rounded-full w-5 h-5 flex items-center justify-center text-xs font-semibold flex-shrink-0">
                                                        {idx + 1}
                                                    </span>
                                                    <span className="text-gray-600">{step}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Target Investors */}
                            <div className="bg-white shadow-sm rounded-lg p-6">
                                <div className="flex items-center gap-2 mb-4">
                                    <Users className="h-5 w-5 text-[#4B2A06]" />
                                    <h2 className="text-lg font-bold text-[#4B2A06]">Target Investors</h2>
                                    <span className="text-xs text-gray-400 font-medium">(Optional)</span>
                                </div>
                                <div className="space-y-4">
                                    <div className="flex gap-2">
                                        <Input
                                            placeholder="Add investor name..."
                                            value={inputInvestor}
                                            onChange={(e) => setInputInvestor(e.target.value)}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') {
                                                    e.preventDefault();
                                                    const val = watch("target_investors") || [];
                                                    if (inputInvestor.trim() && !val.includes(inputInvestor.trim())) {
                                                        setValue("target_investors", [...val, inputInvestor.trim()]);
                                                        setInputInvestor("");
                                                    }
                                                }
                                            }}
                                            className="border-gray-200 bg-white"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => {
                                                const val = watch("target_investors") || [];
                                                if (inputInvestor.trim() && !val.includes(inputInvestor.trim())) {
                                                    setValue("target_investors", [...val, inputInvestor.trim()]);
                                                    setInputInvestor("");
                                                }
                                            }}
                                            className="bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-lg px-3 py-2 transition-colors"
                                        >
                                            <Plus className="h-4 w-4" />
                                        </button>
                                    </div>

                                    <div className="flex flex-wrap gap-2 p-3 border rounded-xl bg-gray-50/50 min-h-[60px]">
                                        {(watch("target_investors") || []).length === 0 && (
                                            <span className="text-xs text-gray-400 italic self-center">No target investors added yet.</span>
                                        )}
                                        {(watch("target_investors") || []).map((investor: string, idx: number) => (
                                            <Badge key={idx} variant="secondary" className="pl-2.5 pr-1.5 py-1 gap-1.5 text-xs font-normal bg-white border border-gray-200 shadow-sm">
                                                {investor}
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        const val = watch("target_investors") || [];
                                                        setValue("target_investors", val.filter((i: string) => i !== investor));
                                                    }}
                                                    className="text-gray-400 hover:text-red-500 transition-colors focus:outline-none"
                                                >
                                                    <X className="h-3 w-3" />
                                                </button>
                                            </Badge>
                                        ))}
                                    </div>
                                </div>
                            </div>

                            {/* Monitored Companies - Conditional */}
                            {newsMonitorEnabled && (
                                <div className="bg-white shadow-sm rounded-lg p-6">
                                    <div className="flex items-center justify-between mb-4">
                                        <div className="flex items-center gap-2">
                                            <Building2 className="h-5 w-5 text-[#4B2A06]" />
                                            <h2 className="text-lg font-bold text-[#4B2A06]">News Monitor: Companies</h2>
                                            <span className="text-xs text-gray-400 font-medium">(Optional)</span>
                                        </div>
                                        {isReOnboarding && (
                                            <button
                                                type="button"
                                                disabled={isCrawling}
                                                onClick={async () => {
                                                    try {
                                                        setIsCrawling(true);
                                                        // 1. Save current config first to ensure crawler uses latest companies
                                                        const data = watch();
                                                        const updateData = {
                                                            news_monitor_enabled: data.news_monitor_enabled,
                                                            monitored_companies: data.monitored_companies || [],
                                                            target_investors: data.target_investors || [],
                                                            investor_match_only: data.investor_match_only,
                                                            valuation_matching: data.valuation_matching,
                                                            adverse_finding: data.adverse_finding,
                                                        };
                                                        await domainService.updateConfig(updateData);

                                                        // 2. Trigger the crawl
                                                        const res = await domainService.triggerNewsCrawl();
                                                        const articleCount = res.article_count || 0;
                                                        toast({
                                                            title: articleCount > 0 ? "Crawl Successful" : "Crawl Completed",
                                                            description: res.message || `Found ${articleCount} new articles.`,
                                                            variant: articleCount > 0 ? "default" : "destructive",
                                                            action: (
                                                                <ToastAction altText="View Articles" onClick={() => navigate("/news-monitor")}>
                                                                    View
                                                                </ToastAction>
                                                            ),
                                                        });
                                                        if (res.errors && res.errors.length > 0) {
                                                            toast({
                                                                title: "Crawl had partial errors",
                                                                description: `Research failed for ${res.errors.length} companies.`,
                                                                variant: "destructive"
                                                            });
                                                            console.warn("Crawl errors:", res.errors);
                                                        }
                                                    } catch (err: any) {
                                                        console.error("Crawl error:", err);
                                                        toast({
                                                            title: "Crawl Failed",
                                                            description: err?.response?.data?.error || err?.response?.data?.detail || "Failed to trigger news crawl.",
                                                            variant: "destructive"
                                                        });
                                                    } finally {
                                                        setIsCrawling(false);
                                                    }
                                                }}
                                                className="flex items-center gap-1.5 text-xs font-semibold py-1.5 px-3 rounded-full border border-[#4B2A06]/20 text-[#4B2A06] hover:bg-[#4B2A06]/5 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                            >
                                                {isCrawling ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                                                {isCrawling ? "Crawling..." : "Run Now"}
                                            </button>
                                        )}
                                    </div>
                                    <div className="space-y-4">
                                        <div className="flex gap-2">
                                            <Input
                                                placeholder="Add company name..."
                                                value={inputCompany}
                                                onChange={(e) => setInputCompany(e.target.value)}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter') {
                                                        e.preventDefault();
                                                        const val = watch("monitored_companies") || [];
                                                        if (inputCompany.trim() && !val.includes(inputCompany.trim())) {
                                                            setValue("monitored_companies", [...val, inputCompany.trim()]);
                                                            setInputCompany("");
                                                        }
                                                    }
                                                }}
                                                className="border-gray-200 bg-white"
                                            />
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    const val = watch("monitored_companies") || [];
                                                    if (inputCompany.trim() && !val.includes(inputCompany.trim())) {
                                                        setValue("monitored_companies", [...val, inputCompany.trim()]);
                                                        setInputCompany("");
                                                    }
                                                }}
                                                className="bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-lg px-3 py-2 transition-colors"
                                            >
                                                <Plus className="h-4 w-4" />
                                            </button>
                                        </div>

                                        <div className="flex flex-wrap gap-2 p-3 border rounded-xl bg-gray-50/50 min-h-[60px]">
                                            {(watch("monitored_companies") || []).length === 0 && (
                                                <span className="text-xs text-gray-400 italic self-center">No companies added for monitoring yet.</span>
                                            )}
                                            {(watch("monitored_companies") || []).map((company: string, idx: number) => (
                                                <Badge key={idx} variant="secondary" className="pl-2.5 pr-1.5 py-1 gap-1.5 text-xs font-normal bg-white border border-gray-200 shadow-sm">
                                                    {company}
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            const val = watch("monitored_companies") || [];
                                                            setValue("monitored_companies", val.filter((c: string) => c !== company));
                                                        }}
                                                        className="text-gray-400 hover:text-red-500 transition-colors focus:outline-none"
                                                    >
                                                        <X className="h-3 w-3" />
                                                    </button>
                                                </Badge>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Right Column - Feature Toggles + Actions */}
                        <div className="lg:col-span-5 space-y-6">

                            <div className="bg-white shadow-sm rounded-lg p-5">
                                <div className="flex items-center gap-2 mb-5">
                                    <SettingsIcon className="h-5 w-5 text-[#4B2A06]" />
                                    <h2 className="text-lg font-bold text-[#4B2A06]">AI Feature Configuration</h2>
                                </div>

                                <div className="space-y-3">
                                    {/* Toggle: Investor Matching */}
                                    <Controller
                                        control={control}
                                        name="investor_match_only"
                                        render={({ field }) => (
                                            <div
                                                className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-all ${field.value ? "border-[#4B2A06]/20 bg-[#4B2A06]/[0.03]" : "border-gray-100 bg-gray-50/30 hover:border-gray-200"
                                                    }`}
                                                onClick={() => field.onChange(!field.value)}
                                            >
                                                <div className="flex-1 pr-4">
                                                    <div className="font-semibold text-sm text-[rgba(38,40,43,1)]">Investor Matching</div>
                                                    <div className="text-xs text-gray-500 mt-0.5">Analyze and match potential investors from the database.</div>
                                                </div>
                                                <ToggleSwitch checked={field.value} />
                                            </div>
                                        )}
                                    />

                                    {/* Toggle: Valuation Analysis */}
                                    <Controller
                                        control={control}
                                        name="valuation_matching"
                                        render={({ field }) => (
                                            <div
                                                className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-all ${field.value ? "border-[#4B2A06]/20 bg-[#4B2A06]/[0.03]" : "border-gray-100 bg-gray-50/30 hover:border-gray-200"
                                                    }`}
                                                onClick={() => field.onChange(!field.value)}
                                            >
                                                <div className="flex-1 pr-4">
                                                    <div className="font-semibold text-sm text-[rgba(38,40,43,1)]">Valuation Analysis</div>
                                                    <div className="text-xs text-gray-500 mt-0.5">Perform detailed valuation comparison with peers.</div>
                                                </div>
                                                <ToggleSwitch checked={field.value} />
                                            </div>
                                        )}
                                    />

                                    {/* Toggle: Adverse Findings */}
                                    <Controller
                                        control={control}
                                        name="adverse_finding"
                                        render={({ field }) => (
                                            <div
                                                className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-all ${field.value ? "border-[#4B2A06]/20 bg-[#4B2A06]/[0.03]" : "border-gray-100 bg-gray-50/30 hover:border-gray-200"
                                                    }`}
                                                onClick={() => field.onChange(!field.value)}
                                            >
                                                <div className="flex-1 pr-4">
                                                    <div className="font-semibold text-sm text-[rgba(38,40,43,1)]">Adverse Findings Research</div>
                                                    <div className="text-xs text-gray-500 mt-0.5">Conduct automated web research for red flags on RHP entities.</div>
                                                </div>
                                                <ToggleSwitch checked={field.value} />
                                            </div>
                                        )}
                                    />

                                    {/* Toggle: News Monitor */}
                                    <Controller
                                        control={control}
                                        name="news_monitor_enabled"
                                        render={({ field }) => (
                                            <div
                                                className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-all ${field.value ? "border-[#4B2A06]/20 bg-[#4B2A06]/[0.03]" : "border-gray-100 bg-gray-50/30 hover:border-gray-200"
                                                    }`}
                                                onClick={() => field.onChange(!field.value)}
                                            >
                                                <div className="flex-1 pr-4">
                                                    <div className="font-semibold text-sm text-[rgba(38,40,43,1)]">Daily News Monitor</div>
                                                    <div className="text-xs text-gray-500 mt-0.5">Enable automated daily 8 AM news crawling for selected companies.</div>
                                                </div>
                                                <ToggleSwitch checked={field.value} />
                                            </div>
                                        )}
                                    />
                                </div>
                            </div>

                            {/* Action Section */}
                            <div className="bg-white shadow-sm rounded-lg p-6">
                                <div className="flex items-center gap-2 mb-4">
                                    <Zap className="h-5 w-5 text-[#4B2A06]" />
                                    <h2 className="text-lg font-bold text-[#4B2A06]">
                                        {isReOnboarding ? "Apply Changes" : "Finalize Setup"}
                                    </h2>
                                </div>
                                <p className="text-sm text-gray-500 mb-5">
                                    {isReOnboarding
                                        ? "Re-run the AI onboarding pipeline with updated configuration and SOP."
                                        : "Configure your pipeline and kickstart the AI onboarding agents."
                                    }
                                </p>

                                <div className="flex gap-3">
                                    {isReOnboarding && (
                                        <button
                                            type="button"
                                            onClick={() => navigate('/dashboard')}
                                            className="px-5 py-2.5 rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
                                        >
                                            Cancel
                                        </button>
                                    )}
                                    <button
                                        type="submit"
                                        disabled={isLoading}
                                        className="flex-1 flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-[#4B2A06] text-white text-sm font-semibold hover:bg-[#3a2105] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        {isLoading ? (
                                            <>
                                                <Loader2 className="h-4 w-4 animate-spin" />
                                                {isReOnboarding ? "Re-Configuring..." : "Configuring AI..."}
                                            </>
                                        ) : isReOnboarding ? (
                                            <>
                                                <RefreshCw className="h-4 w-4" />
                                                Update & Re-Onboard
                                            </>
                                        ) : (
                                            <>
                                                Complete Onboarding
                                                <ArrowRight className="h-4 w-4" />
                                            </>
                                        )}
                                    </button>
                                </div>
                            </div>


                        </div>
                    </div>
                </form>
            </div>
        </div>
    );
};

// Custom Toggle Switch matching the dashboard's brown palette
const ToggleSwitch = ({ checked }: { checked: boolean }) => (
    <div className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${checked ? "bg-[#4B2A06]" : "bg-gray-200"
        }`}>
        <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${checked ? "translate-x-[22px]" : "translate-x-0.5"
            }`} />
    </div>
);

// Simple Icons
const FileTextIcon = (props: any) => (
    <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" /><polyline points="14 2 14 8 20 8" /></svg>
);

const SettingsIcon = (props: any) => (
    <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.1a2 2 0 0 1-1-1.74v-.47a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" /></svg>
);

const UsersIcon = (props: any) => (
    <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
);

const Building2Icon = (props: any) => (
    <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z" /><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2" /><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2" /><path d="M10 6h4" /><path d="M10 10h4" /><path d="M10 14h4" /><path d="M10 18h4" /></svg>
);

export default OnboardingPage;
