import axios from "axios";
import { SessionData, ConversationMemory } from "./sessionService";

const N8N_WEBHOOK_URLS = {
  DRHP: import.meta.env.VITE_N8N_CHAT_DRHP_WEBHOOK_URL,
  RHP: import.meta.env.VITE_N8N_CHAT_RHP_WEBHOOK_URL
};

interface N8nResponse {
  response: any[];
  jobId?: string;
  status?: string;
  error?: string;
  memory_context?: {
    last_topic: string | null;
    user_interests: string[];
    conversation_summary: string;
  };
}

export const n8nService = {
  async sendMessage(
    message: string,
    sessionData: SessionData,
    conversationHistory: ConversationMemory[] = [],
    namespace?: string,
    documentType?: "DRHP" | "RHP",
    signal?: AbortSignal
  ): Promise<N8nResponse> {
    try {
      console.log("Sending chat message to backend:", message, "namespace:", namespace, "documentType:", documentType);

      const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000/api";
      const token = localStorage.getItem("accessToken");

      const payload = {
        message,
        sessionId: sessionData.id,
        namespace,
        documentType,
        history: conversationHistory.map((msg) => ({
          role: msg.type === "user" ? "user" : "assistant",
          content: msg.text,
        })),
        timestamp: new Date().toISOString()
      };

      const response = await axios.post(`${API_URL}/chats/message`, payload, {
        headers: {
          "Content-Type": "application/json",
          "Authorization": token ? `Bearer ${token}` : ""
        },
        signal,
      });

      console.log("Response received from backend:", response.data);

      return {
        response: response.data.response,
        jobId: response.data.job_id,
        status: response.data.status,
        memory_context: response.data.memory_context,
      };
    } catch (error) {
      if (axios.isCancel(error)) {
        console.log("Chat request canceled:", error.message);
        return {
          response: [],
          error: "Request was canceled by the user.",
        };
      }
      console.error("Error sending message to backend:", error);
      return {
        response: [],
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },
};
