import axios from "axios";

const API_URL = import.meta.env.VITE_API_URL;

export interface DomainConfig {
    domainId: string;
    domainName: string;
    // Feature toggles
    investor_match_only: boolean;
    valuation_matching: boolean;
    adverse_finding: boolean;
    news_monitor_enabled: boolean;
    monitored_companies: string[];
    target_investors: string[];
    // SOP & Prompts
    sop_text: string;
    agent3_prompt: string;
    agent3_subqueries: string[];
    agent4_prompt: string;
    agent4_subqueries: string[];
    agent5_prompt: string;
    // Onboarding status
    onboarding_status: "pending" | "processing" | "completed" | "completed_no_sop" | "failed";
    last_onboarded: string | null;
    // Custom config indicators
    has_custom_subqueries: boolean;
    custom_subqueries_count: number;
    has_agent3_prompt: boolean;
    has_agent4_prompt: boolean;
}

export interface OnboardingStatus {
    status: string;
    domainId?: string;
    domainName?: string;
    onboarding_status: string;
    last_onboarded: string | null;
    has_sop: boolean;
    has_custom_subqueries: boolean;
    custom_subqueries_count: number;
    has_agent3_prompt: boolean;
    has_agent4_prompt: boolean;
    subquery_analysis: Record<string, any>;
    toggles: {
        investor_match_only: boolean;
        valuation_matching: boolean;
        adverse_finding: boolean;
    };
    target_investors: string[];
    onboarding_required?: boolean;
}

export const domainService = {
    // Get current domain configuration
    getConfig: async (): Promise<DomainConfig> => {
        const token = localStorage.getItem("accessToken");
        const response = await axios.get(`${API_URL}/domain/config`, {
            headers: {
                Authorization: `Bearer ${token}`
            }
        });
        return response.data;
    },

    // Update domain configuration
    updateConfig: async (config: Partial<DomainConfig>): Promise<DomainConfig> => {
        const token = localStorage.getItem("accessToken");
        const response = await axios.put(`${API_URL}/domain/config`, config, {
            headers: {
                Authorization: `Bearer ${token}`
            }
        });
        return response.data.config;
    },

    // Get onboarding status
    getOnboardingStatus: async (): Promise<OnboardingStatus> => {
        const token = localStorage.getItem("accessToken");
        const response = await axios.get(`${API_URL}/domain/onboarding/status`, {
            headers: {
                Authorization: `Bearer ${token}`
            }
        });
        return response.data;
    },

    // Submit onboarding setup (with optional SOP file)
    submitOnboarding: async (data: {
        config: {
            toggles: Record<string, boolean>;
            targetInvestors: string[];
        };
        file?: File;
    }): Promise<any> => {
        const token = localStorage.getItem("accessToken");
        const formData = new FormData();
        formData.append("config", JSON.stringify(data.config));

        if (data.file) {
            formData.append("file", data.file);
        }

        const response = await axios.post(`${API_URL}/domain/onboarding/setup`, formData, {
            headers: {
                Authorization: `Bearer ${token}`,
                // Don't set Content-Type - axios will set it with boundary for FormData
            }
        });
        return response.data;
    },

    // Re-onboard with updated SOP
    reOnboard: async (data: {
        config: {
            toggles: Record<string, boolean>;
            targetInvestors: string[];
        };
        file: File;
    }): Promise<any> => {
        const token = localStorage.getItem("accessToken");
        const formData = new FormData();
        formData.append("config", JSON.stringify(data.config));
        formData.append("file", data.file);

        const response = await axios.post(`${API_URL}/domain/onboarding/re-onboard`, formData, {
            headers: {
                Authorization: `Bearer ${token}`,
            }
        });
        return response.data;
    },


};
