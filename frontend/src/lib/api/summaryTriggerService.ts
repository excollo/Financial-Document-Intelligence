import axios from "axios";
import { SessionData, ConversationMemory } from "./sessionService";

interface SummaryTriggerResponse {
  executionId?: string;
  jobId?: string;
  documentId?: string;
  status?: string;
  httpStatus?: number;
  errorCode?: string;
  response?: any[];
  error?: string;
  memory_context?: {
    last_topic: string | null;
    user_interests: string[];
    conversation_summary: string;
  };
}

export const summaryTriggerService = {
  async createSummary(
    message: string,
    sessionData: SessionData,
    conversationHistory: ConversationMemory[] = [],
    namespace?: string,
    documentId?: string,
    signal?: AbortSignal,
    type?: string,
    rhpNamespace?: string
  ): Promise<SummaryTriggerResponse> {
    try {
      const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000/api";
      const token = localStorage.getItem("accessToken");

      const payload = {
        message,
        sessionId: sessionData.id,
        namespace: type === "RHP" && rhpNamespace ? rhpNamespace : namespace,
        docType: type || "DRHP",
        documentId,
        metadata: {
          timestamp: new Date().toISOString(),
          action: "summary",
        },
      };

      const currentWorkspace = localStorage.getItem("currentWorkspace");
      const response = await axios.post(`${API_URL}/summaries/trigger`, payload, {
        headers: {
          "Content-Type": "application/json",
          Authorization: token ? `Bearer ${token}` : "",
          ...(currentWorkspace && { "x-workspace": currentWorkspace }),
        },
        signal,
      });

      return {
        jobId: response.data?.job_id,
        status: response.data?.status,
        documentId,
        error: response.data?.error,
      };
    } catch (error) {
      if (axios.isCancel(error)) {
        return {
          response: [],
          error: "Request was canceled by the user.",
        };
      }
      if (axios.isAxiosError(error)) {
        const responseData = error.response?.data as any;
        return {
          response: [],
          httpStatus: error.response?.status,
          errorCode: responseData?.code || responseData?.errorCode || responseData?.error_code,
          error: responseData?.error || responseData?.message || error.message || "Unknown error",
        };
      }
      return {
        response: [],
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },
};
