import axios from "axios";
import { SessionData, ConversationMemory } from "./sessionService";

const SUMMARY_N8N_WEBHOOK_URL = import.meta.env.VITE_N8N_SUMMARY_DRHP_WEBHOOK_URL;
const RHP_SUMMARY_N8N_WEBHOOK_URL = import.meta.env.VITE_N8N_SUMMARY_RHP_WEBHOOK_URL;

interface N8nSummaryResponse {
  executionId?: string;
  jobId?: string;
  documentId?: string;
  status?: string;
  response?: any[];
  error?: string;
  memory_context?: {
    last_topic: string | null;
    user_interests: string[];
    conversation_summary: string;
  };
}

export const summaryN8nService = {
  async createSummary(
    message: string,
    sessionData: SessionData,
    conversationHistory: ConversationMemory[] = [],
    namespace?: string,
    documentId?: string,
    signal?: AbortSignal,
    type?: string, // Add type parameter to determine which webhook to use
    rhpNamespace?: string // Add rhpNamespace parameter for RHP documents
  ): Promise<N8nSummaryResponse> {
    try {
      // attachments: domain, domainId, and workspaceId are handled by the backend
      const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000/api";
      const token = localStorage.getItem("accessToken");

      const payload = {
        message,
        sessionId: sessionData.id,
        namespace: (type === "RHP" && rhpNamespace) ? rhpNamespace : namespace,
        docType: type || "DRHP",
        documentId,
        metadata: {
          timestamp: new Date().toISOString(),
          action: "summary"
        }
      };

      console.log("📤 Sending summary request to backend:", payload);

      const currentWorkspace = localStorage.getItem("currentWorkspace");
      const response = await axios.post(`${API_URL}/summaries/trigger`, payload, {
        headers: {
          "Content-Type": "application/json",
          "Authorization": token ? `Bearer ${token}` : "",
          ...(currentWorkspace && { "x-workspace": currentWorkspace }),
        },
        signal,
      });

      console.log("Summary trigger response:", response.data);

      return {
        jobId: response.data?.job_id,
        status: response.data?.status,
        documentId: documentId,
        error: response.data?.error,
      };
    } catch (error) {
      if (axios.isCancel(error)) {
        return {
          response: [],
          error: "Request was canceled by the user.",
        };
      }
      return {
        response: [],
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },
};
