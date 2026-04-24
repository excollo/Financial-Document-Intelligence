import { chatService } from "../../services/api";

// Chat storage service for localStorage (future: swap to backend)
export interface ChatMessage {
  id: string;
  content: string;
  isUser: boolean;
  timestamp: string;
}

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  updatedAt: string;
  documentId: string;
}

const STORAGE_KEY = "doc_chats";

function getAllChats() {
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw ? JSON.parse(raw) : {};
}

function saveAllChats(data: any) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export const chatStorageService = {
  normalizeChat(chat: any): ChatSession {
    return {
      ...chat,
      messages: Array.isArray(chat?.messages) ? chat.messages : [],
      updatedAt: chat?.updatedAt || new Date().toISOString(),
      documentId: chat?.documentId || "",
      title: chat?.title || "New Chat",
      id: String(chat?.id || ""),
    };
  },

  async getChatsForDoc(documentId: string): Promise<ChatSession[]> {
    try {
      const chats = await chatService.getByDocumentId(documentId);
      if (!Array.isArray(chats)) return [];
      return chats.map((chat: any) => this.normalizeChat(chat));
    } catch (error) {
      console.error("Error fetching chats:", error);
      return [];
    }
  },

  async getChatById(
    documentId: string,
    chatId: string
  ): Promise<ChatSession | undefined> {
    try {
      const chats = await chatService.getByDocumentId(documentId);
      if (!Array.isArray(chats)) return undefined;
      const chat = chats.find((row: any) => row.id === chatId);
      return chat ? this.normalizeChat(chat) : undefined;
    } catch (error) {
      console.error("Error fetching chat:", error);
      return undefined;
    }
  },

  async getMessagesForChat(chatId: string): Promise<ChatMessage[]> {
    try {
      const rows = await chatService.getMessages(chatId, { limit: 200, offset: 0 });
      if (!Array.isArray(rows)) return [];
      return rows
        .filter((m: any) => !!m?.id && typeof m?.content === "string")
        .map((m: any) => ({
          id: String(m.id),
          content: String(m.content || ""),
          isUser: Boolean(m.isUser),
          timestamp: new Date(m.timestamp || Date.now()).toISOString(),
        }));
    } catch (error) {
      console.error("Error fetching chat messages:", error);
      return [];
    }
  },

  async saveChatForDoc(documentId: string, chat: ChatSession) {
    try {
      // Only persist chats that have at least 1 user message or >1 bot messages
      const userCount = chat.messages.filter((m) => m.isUser).length;
      const botCount = chat.messages.filter((m) => !m.isUser).length;
      const shouldPersist = userCount >= 1 || botCount > 1;

      if (!shouldPersist) {
        // If chat exists on backend, delete it; else, simply skip creating
        if (chat.id) {
          try { await chatService.delete(chat.id); } catch {}
        }
        return;
      }

      // If chat has exactly two messages (bot greeting + first user message) and title is 'New Chat', update title to first user message
      if (
        chat.messages.length === 2 &&
        chat.title === "New Chat" &&
        chat.messages[1].isUser
      ) {
        chat.title =
          chat.messages[1].content.slice(0, 30) +
          (chat.messages[1].content.length > 30 ? "..." : "");
      }
      if (!chat.id) {
        const newChat = await chatService.create({
          ...chat,
          documentId,
        });
        chat.id = newChat.id;
      } else {
        const messages = Array.isArray(chat.messages) ? chat.messages : [];
        const latestMessage =
          messages.length > 0 ? messages[messages.length - 1] : undefined;
        const { messages: _ignoredMessages, ...chatMetadata } = chat as any;
        try {
          // Backend blocks message-array updates via PUT /chats/:id.
          // Update only chat metadata, and persist message content through addMessage.
          await chatService.update(chat.id, {
            ...chatMetadata,
            documentId,
          });
          if (latestMessage?.id && latestMessage?.content) {
            await chatService.addMessage(chat.id, latestMessage);
          }
        } catch (err: any) {
          const immutableMessageUpdate =
            err?.response?.status === 400 &&
            err?.response?.data?.code === "CHAT_MESSAGES_IMMUTABLE";
          if (immutableMessageUpdate) {
            await chatService.update(chat.id, {
              ...chatMetadata,
              documentId,
            });
            if (latestMessage?.id && latestMessage?.content) {
              await chatService.addMessage(chat.id, latestMessage);
            }
            return;
          }
          if (err?.response?.status === 404) {
            const newChat = await chatService.create({
              ...chat,
              documentId,
            });
            chat.id = newChat.id;
          } else {
            throw err;
          }
        }
      }
    } catch (error) {
      console.error("Error saving chat:", error);
      throw error;
    }
  },

  async listChatsForDoc(documentId: string): Promise<ChatSession[]> {
    return this.getChatsForDoc(documentId);
  },

  async createChatForDoc(
    documentId: string,
    initialMessage: ChatMessage
  ): Promise<ChatSession> {
    // Create chat in memory first; only persist after eligibility check in saveChatForDoc
    const chat: ChatSession = {
      id: Date.now().toString(),
      title: "New Chat", // Always use 'New Chat' as the default title
      messages: [initialMessage],
      updatedAt: new Date().toISOString(),
      documentId,
    };
    return chat;
  },

  async updateChatTitle(documentId: string, chatId: string, title: string) {
    try {
      const chat = await this.getChatById(documentId, chatId);
      if (chat) {
        chat.title = title;
        chat.updatedAt = new Date().toISOString();
        await this.saveChatForDoc(documentId, chat);
      }
    } catch (error) {
      console.error("Error updating chat title:", error);
      throw error;
    }
  },

  async deleteChatForDoc(documentId: string, chatId: string) {
    try {
      await chatService.delete(chatId);
    } catch (error) {
      console.error("Error deleting chat:", error);
      throw error;
    }
  },
};
