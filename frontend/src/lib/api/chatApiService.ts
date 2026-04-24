import axios from "axios";
import { SessionData, ConversationMemory } from "./sessionService";

interface ChatApiResponse {
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

export const chatApiService = {
  async sendMessage(
    message: string,
    sessionData: SessionData,
    conversationHistory: ConversationMemory[] = [],
    namespace?: string,
    documentType?: "DRHP" | "RHP",
    chatId?: string,
    signal?: AbortSignal
  ): Promise<ChatApiResponse> {
    try {
      const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000/api";
      const token = localStorage.getItem("accessToken");

      const payload = {
        message,
        sessionId: sessionData.id,
        chatId,
        namespace,
        documentType,
        history: conversationHistory.map((msg) => ({
          role: msg.type === "user" ? "user" : "assistant",
          content: msg.text,
        })),
        timestamp: new Date().toISOString(),
      };

      const response = await axios.post(`${API_URL}/chats/message`, payload, {
        headers: {
          "Content-Type": "application/json",
          Authorization: token ? `Bearer ${token}` : "",
        },
        signal,
      });

      return {
        response: response.data.response,
        jobId: response.data.job_id,
        status: response.data.status,
        memory_context: response.data.memory_context,
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
