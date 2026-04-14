import React, { useState, useRef, useEffect } from "react";
import ReactDOM from "react-dom";
import { Send, User, Loader2, Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { n8nService } from "@/lib/api/n8nService";
import {
  ConversationMemory,
  MemoryContext,
  SessionData,
  sessionService,
} from "@/lib/api/sessionService";
import {
  chatStorageService,
  ChatSession,
  ChatMessage,
} from "@/lib/api/chatStorageService";
import { toast } from "sonner";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import axios from "axios";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface Message {
  id: string;
  content: string;
  isUser: boolean;
  timestamp: Date;
}

interface ChatPanelCustomStyles {
  containerBg?: string;
  inputBg?: string;
  inputBorder?: string;
  sendBtnBg?: string;
  sendBtnIcon?: string;
  userBubble?: string;
  botBubble?: string;
  userText?: string;
  botText?: string;
  timestamp?: string;
  inputRadius?: string;
  inputShadow?: string;
  removeHeader?: boolean;
  removeInputBorder?: boolean;
  inputPlaceholder?: string;
  inputFocusClassName?: string; // optional className applied to the input for focus styles
}

interface ChatPanelProps {
  isDocumentProcessed: boolean;
  currentDocument: {
    id: string;
    name: string;
    uploadedAt: string;
    namespace?: string;
    type?: "DRHP" | "RHP";
  } | null;
  chatId?: string | null;
  onChatCreated?: (chatId: string) => void;
  onProcessingChange?: (isProcessing: boolean) => void;
  customStyles?: ChatPanelCustomStyles;
  newChatTrigger?: number;
}

// Helper function to format bot messages
const formatBotMessage = (content: string): string => {
  if (!content) return "";

  // Split into lines first to handle existing newlines
  const lines = content.split("\n");

  const formattedLines = lines.map((line) => {
    const trimmedLine = line.trim();
    if (trimmedLine.length === 0) return ""; // Keep empty lines

    // Check for bullet points (- , *, +) or numbered list items (1., 2., etc.)
    if (/^[-*+]\s/.test(trimmedLine)) {
      // Replace common bullet point markers with a standard one and keep the rest of the line
      return "•  " + trimmedLine.substring(1).trim();
    } else if (/^\d+\.\s/.test(trimmedLine)) {
      // Keep numbered list items as is
      return trimmedLine;
    } else {
      // For other lines, add a newline after each period followed by a space
      return trimmedLine.replace(/\. \s/g, ".\n");
    }
  });

  // Join processed lines with newlines
  return formattedLines.join("\n");
};

// Utility to normalize markdown tables (removes extra blank lines within tables)
function normalizeTables(markdown: string) {
  return markdown.replace(
    /((?:\|[^\n]*\|(?:\n|$))+)/g,
    (tableBlock) =>
      tableBlock
        .split("\n")
        .filter((line) => line.trim() !== "")
        .join("\n") + "\n"
  );
}

export function ChatPanel({
  isDocumentProcessed,
  currentDocument,
  chatId,
  onChatCreated,
  onProcessingChange,
  customStyles = {},
  newChatTrigger,
}: ChatPanelProps) {
  const [sessionData, setSessionData] = useState<SessionData>(() =>
    sessionService.initializeSession()
  );
  const [conversationMemory, setConversationMemory] = useState<
    ConversationMemory[]
  >([]);
  const [memoryContext, setMemoryContext] = useState<MemoryContext>({
    last_topic: null,
    user_interests: [],
    conversation_summary: "",
  });
  const [messages, setMessages] = useState<Message[]>([]);
  const [currentChatId, setCurrentChatId] = useState<string | null>(
    chatId || null
  );
  const [inputValue, setInputValue] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const [lastDocumentId, setLastDocumentId] = useState<string | null>(null);
  const inactivityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Quick prompt chips for funds-related agencies
  const quickPrompts = [
    "Summarise key risk factors relevant to investors.",
    "What is the issue size, price band, and lot size?",
    "How will the proceeds be used (utilisation of funds)?",
    "Who are the lead managers, registrar, and their roles?",
  ];

  const handleQuickAsk = (prompt: string) => {
    if (!isDocumentProcessed) return;
    setInputValue(prompt);
    setTimeout(() => handleSendMessage(), 0);
  };

  useEffect(() => {
    // Cleanup on unmount
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      if (inactivityTimerRef.current) {
        clearTimeout(inactivityTimerRef.current);
      }
    };
  }, []);

  const handleNewChat = async () => {
    if (!currentDocument) return;
    // Start a fresh transient chat (not persisted) with only the greeting
    setCurrentChatId(null);
    setMessages([
      {
        id: "greet",
        content: `Hello! I'm your DRHP document assistant. Ask a question about ${currentDocument.name} to start a chat.`,
        isUser: false,
        timestamp: new Date(),
      },
    ]);
  };

  useEffect(() => {
    if (newChatTrigger && newChatTrigger > 0) {
      handleNewChat();
    }
  }, [newChatTrigger]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Start inactivity countdown on mount and when session changes
  useEffect(() => {
    if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current);
    inactivityTimerRef.current = setTimeout(() => {
      setCurrentChatId(null);
      setMessages([
        {
          id: "greet",
          content:
            "Hello! I'm your DRHP document assistant. Ask a question to start a chat.",
          isUser: false,
          timestamp: new Date(),
        },
      ]);
    }, 20 * 60 * 1000);
    return () => {
      if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current);
    };
  }, [sessionData.id]);

  // On document change, do NOT auto-create chat history.
  // Let loadChat decide whether to show a local greeting without saving.
  useEffect(() => {
    if (currentDocument && currentDocument.id !== lastDocumentId) {
      setLastDocumentId(currentDocument.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentDocument]);

  // Load chat session when chatId or document changes
  useEffect(() => {
    const loadChat = async () => {
      if (!currentDocument) {
        setMessages([]);
        setCurrentChatId(null);
        return;
      }

      try {
        if (chatId) {
          // If we've already loaded this chat ID in state, don't re-mount everything
          if (chatId === currentChatId && messages.length > 1) return;

          // Load specific chat if chatId is provided
          const chats = await chatStorageService.getChatsForDoc(
            currentDocument.id
          );
          const chat = chats.find((c) => c.id === chatId);
          if (chat && Array.isArray(chat.messages)) {
            setMessages(
              chat.messages.map((m) => ({
                ...m,
                timestamp: new Date(m.timestamp),
              }))
            );
            setCurrentChatId(chat.id);
            return;
          }
        }

        // If session expired (based on last user activity) OR we just reset session on init, show a fresh greeting
        if (sessionService.isSessionExpired(sessionData) || sessionData.resetOnInit) {
          setMessages([
            {
              id: "greet",
              content:
                "Hello! I'm your DRHP document assistant. Ask a question to start a chat.",
              isUser: false,
              timestamp: new Date(),
            },
          ]);
          setCurrentChatId(null);
          return;
        }

        // Default: show a transient greeting in UI without loading previous chats
        setMessages([
          {
            id: "greet",
            content:
              "Hello! I'm your DRHP document assistant. Ask a question to start a chat.",
            isUser: false,
            timestamp: new Date(),
          },
        ]);
        setCurrentChatId(null);
      } catch (error) {
        console.error("Error loading chat:", error);
        setMessages([]);
        setCurrentChatId(null);
      }
    };

    loadChat();
  }, [currentDocument, chatId]);

  useEffect(() => {
    if (scrollAreaRef.current) {
      const viewport = scrollAreaRef.current.querySelector(
        "[data-radix-scroll-area-viewport]"
      );
      if (viewport) {
        viewport.scrollTop = viewport.scrollHeight;
      }
    }
  }, [messages]);

  const handleSendMessage = async () => {
    if (!inputValue.trim() || !currentDocument) return;

    // On user intervention, if session expired, reset to a new session and new chat
    if (sessionService.isSessionExpired(sessionData)) {
      const fresh = sessionService.clearSession();
      setSessionData(fresh);
      setCurrentChatId(null);
      // Start a new transient chat object for this message
      // so that the first user message persists as a new chat
    }

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      content: inputValue,
      isUser: true,
      timestamp: new Date().toISOString(),
    };

    // 1. Optimistically update UI
    setMessages((prev) => [
      ...prev,
      {
        ...userMessage,
        timestamp: new Date(userMessage.timestamp),
      },
    ]);
    setInputValue("");
    setIsTyping(true);
    onProcessingChange?.(true);

    // Update last activity ONLY on user messages and restart inactivity timer
    setSessionData((prev) => sessionService.updateSessionActivity(prev));
    if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current);
    inactivityTimerRef.current = setTimeout(() => {
      // After inactivity, start a new chat UI and clear currentChatId
      setCurrentChatId(null);
      setMessages([
        {
          id: "greet",
          content:
            "Hello! I'm your DRHP document assistant. Ask a question to start a chat.",
          isUser: false,
          timestamp: new Date(),
        },
      ]);
    }, 20 * 60 * 1000);

    let chat: ChatSession | undefined;
    let newChatId = currentChatId;
    let newMessages: Message[] = [];

    try {
      if (!currentChatId) {
        // Create chat with initial bot greeting (UI only; not persisted until user replies)
        const initialBotMessage: ChatMessage = {
          id: (Date.now() - 1).toString(),
          content: `Hello! I'm your DRHP document assistant. Ask a question about ${currentDocument.name} to start a chat.`,
          isUser: false,
          timestamp: new Date().toISOString(),
        };
        // Create a chat object in memory; persistence happens after eligibility check in saveChatForDoc
        chat = await chatStorageService.createChatForDoc(
          currentDocument.id,
          initialBotMessage
        );
        newChatId = chat.id || undefined;

        // Add user message to the chat
        chat.messages.push(userMessage);
        chat.updatedAt = new Date().toISOString();
        await chatStorageService.saveChatForDoc(currentDocument.id, chat);

        // IMPORTANT: Always update currentChatId and sync with URL after first persistent save
        if (chat.id) {
          newChatId = chat.id;
          setCurrentChatId(chat.id);
          if (onChatCreated) onChatCreated(chat.id);
        }

        newMessages = chat.messages.map((m) => ({
          ...m,
          timestamp: new Date(m.timestamp),
        }));
      } else {
        const chats = await chatStorageService.getChatsForDoc(
          currentDocument.id
        );
        chat = chats.find((c) => c.id === currentChatId);
        if (chat) {
          chat.messages.push(userMessage);
          chat.updatedAt = new Date().toISOString();
          await chatStorageService.saveChatForDoc(currentDocument.id, chat);
          newMessages = chat.messages.map((m) => ({
            ...m,
            timestamp: new Date(m.timestamp),
          }));
        }
      }

      // Don't setMessages(newMessages) here, since we've already optimistically rendered the user message
      // setMessages(newMessages);

      // Abort previous request if it exists
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      abortControllerRef.current = new AbortController();

      const response = await n8nService.sendMessage(
        inputValue,
        sessionData,
        conversationMemory,
        currentDocument.namespace,
        (currentDocument.type || "DRHP") as "DRHP" | "RHP",
        abortControllerRef.current.signal
      );

      // Handle n8n-specific error response
      if (response.error) {
        throw new Error(response.error);
      }

      // Update memory context if provided
      if (response.memory_context) {
        setMemoryContext(response.memory_context);
      }

      // Update conversation memory
      const newUserMessageMemory: ConversationMemory = {
        type: "user",
        text: inputValue,
        timestamp: Date.now(),
      };

      const botResponseText = Array.isArray(response.response)
        ? response.response.join("\n")
        : response.response;

      const newBotMessageMemory: ConversationMemory = {
        type: "bot",
        text: botResponseText,
        timestamp: Date.now(),
      };

      setConversationMemory((prev) => [
        ...prev,
        newUserMessageMemory,
        newBotMessageMemory,
      ]);

      const aiResponse: ChatMessage = {
        id: (Date.now() + 1).toString(),
        content: botResponseText,
        isUser: false,
        timestamp: new Date().toISOString(),
      };

      // Save bot response to chat
      if (currentDocument && newChatId) {
        const chats = await chatStorageService.getChatsForDoc(
          currentDocument.id
        );
        const chat = chats.find((c) => c.id === newChatId);
        if (chat) {
          chat.messages.push(aiResponse);
          chat.updatedAt = new Date().toISOString();
          await chatStorageService.saveChatForDoc(currentDocument.id, chat);
          setMessages(
            chat.messages.map((m) => ({
              ...m,
              timestamp: new Date(m.timestamp),
            }))
          );
        }
      }
    } catch (error) {
      console.error("Error in chat:", error);
      const errorMessageContent =
        error instanceof Error
          ? error.message
          : "Sorry, I encountered an error while processing your message.";

      toast.error(errorMessageContent);

      const errorMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        content: errorMessageContent,
        isUser: false,
        timestamp: new Date().toISOString(),
      };
      if (currentDocument && newChatId) {
        try {
          const chats = await chatStorageService.getChatsForDoc(
            currentDocument.id
          );
          const chat = chats.find((c) => c.id === newChatId);
          if (chat) {
            chat.messages.push(errorMessage);
            chat.updatedAt = new Date().toISOString();
            await chatStorageService.saveChatForDoc(currentDocument.id, chat);
            setMessages(
              chat.messages.map((m) => ({
                ...m,
                timestamp: new Date(m.timestamp),
              }))
            );
          } else {
            // If chat not found, just add the error message to current messages
            setMessages((prevMessages) => [
              ...prevMessages,
              { ...errorMessage, timestamp: new Date(errorMessage.timestamp) },
            ]);
          }
        } catch (saveError) {
          console.error("Error saving error message:", saveError);
          // If saving fails, just add the error message to current messages without saving
          setMessages((prevMessages) => [
            ...prevMessages,
            { ...errorMessage, timestamp: new Date(errorMessage.timestamp) },
          ]);
        }
      }
    } finally {
      setIsTyping(false);
      onProcessingChange?.(false);
    }
  };

  const handleDownload = async () => {
    const token = localStorage.getItem("accessToken");
    try {
      const response = await fetch(
        `${import.meta.env.VITE_API_URL}/documents/download/${currentDocument?.id
        } ` ||
        `http://localhost:5000/api/documents/download/${currentDocument?.id}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );
      if (!response.ok) throw new Error("Failed to download file");
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = currentDocument?.name || "document.pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      alert("Download failed: " + err.message);
    }
  };

  return (
    <div
      className="flex flex-col flex-1 min-h-0"
    // style={{ background: customStyles.containerBg || undefined }}
    >
      {/* Download PDF Button */}
      {currentDocument && (
        <div className="flex items-center justify-end p-2 gap-2">
          {/* New Chat Button */}
          {/* <button
            onClick={handleNewChat}
            className="inline-flex items-center gap-2 px-3 py-2 bg-[#4B2A06] text-white rounded hover:bg-[#3A2004] text-sm font-semibold shadow"
            title="Start a new chat for this document"
            type="button"
          >
            <svg
              width="18"
              height="18"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="lucide lucide-message-square-plus"
              viewBox="0 0 24 24"
            >
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <line x1="12" y1="8" x2="12" y2="16" />
              <line x1="8" y1="12" x2="16" y2="12" />
            </svg>
            New Chat
          </button> */}
        </div>
      )}
      {/* Conditionally render header */}
      {!customStyles.removeHeader && (
        <div className="flex items-center justify-between p-4 border-b border-border flex-shrink-0">
          <h2 className="font-semibold mt-50 text-lg text-foreground">
            Chat Assistant
          </h2>
        </div>
      )}
      <ScrollArea
        ref={scrollAreaRef}
        className="flex-1"
      // style={{ background: customStyles.containerBg || undefined }}
      >
        <div className="p-4 space-y-4">
          {messages.map((message, index) => (
            <div
              key={`${message.id}-${index}`}
              className={cn(
                "flex items-start gap-3",
                message.isUser ? "justify-end" : "justify-start"
              )}
            >
              {!message.isUser && (
                <div className="h-8 w-8 rounded-full bg-[#ECE9E2] flex items-center justify-center flex-shrink-0">
                  <Bot className="h-4 w-4 text-muted-foreground" />
                </div>
              )}
              <div
                className={cn(
                  "rounded-2xl p-4 max-w-[75%] ",
                  message.isUser
                    ? "rounded-br-none whitespace-pre-wrap"
                    : "rounded-bl-none"
                )}
                style={{
                  background: message.isUser ? "#e6e3df" : "#e7ebee",
                  color: message.isUser
                    ? "rgba(62, 36, 7, 1)"
                    : "rgba(38, 40, 43, 1)",
                }}
              >
                {message.isUser ? (
                  <p className="text-sm break-words">{message.content}</p>
                ) : (
                  <div className="markdown-chat-message  text-sm break-words">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        h1: ({ children }) => (
                          <h1 className="text-[18px] font-bold text-[#1F2937] my-2">{children}</h1>
                        ),
                        h2: ({ children }) => (
                          <h2 className="text-[16px] font-bold text-[#1F2937] my-2">{children}</h2>
                        ),
                        h3: ({ children }) => (
                          <h3 className="text-[15px] font-bold text-[#1F2937] my-2">{children}</h3>
                        ),
                        h4: ({ children }) => (
                          <h4 className="text-[14px] font-bold text-[#1F2937] my-1.5">{children}</h4>
                        ),
                        h5: ({ children }) => (
                          <h5 className="text-[13px] font-semibold text-[#1F2937] my-1.5">{children}</h5>
                        ),
                        h6: ({ children }) => (
                          <h6 className="text-[12px] font-semibold text-[#1F2937] my-1">{children}</h6>
                        ),
                        p: ({ children }) => (
                          <p className="my-1 leading-relaxed">{children}</p>
                        ),
                        ul: ({ children }) => (
                          <ul className="list-disc pl-5 my-1 space-y-1">{children}</ul>
                        ),
                        ol: ({ children }) => (
                          <ol className="list-decimal pl-5 my-1 space-y-1">{children}</ol>
                        ),
                        li: ({ children }) => <li className="leading-relaxed">{children}</li>,
                        table: ({ children }) => (
                          <table className="min-w-full  border border-gray-300 my-2">
                            {children}
                          </table>
                        ),
                        th: ({ children }) => (
                          <th className="border px-2 py-1 bg-gray-100 font-semibold">
                            {children}
                          </th>
                        ),
                        td: ({ children }) => (
                          <td className="border px-2 py-1">{children}</td>
                        ),
                        a: ({ href, children, ...props }) => (
                          <a
                            href={href as string}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 underline"
                            {...props}
                          >
                            {children}
                          </a>
                        ),
                      }}
                    >
                      {normalizeTables(message.content)}
                    </ReactMarkdown>
                  </div>
                )}
                <span
                  className="text-xs opacity-70 block mt-1"
                  style={{ color: customStyles.timestamp || "#A1A1AA" }}
                >
                  {new Date(message.timestamp).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>
              {message.isUser && (
                <div className="h-8 w-8 rounded-full bg-[#ECE9E2]  flex items-center justify-center flex-shrink-0">
                  <User className="h-4 w-4 text-muted-foreground" />
                </div>
              )}
            </div>
          ))}
          {isTyping && (
            <div className="flex max-w-[80%] mr-auto animate-fade-in items-center gap-3">
              <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                <Bot className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="rounded-2xl p-3 bg-card text-card-foreground">
                <div className="flex space-x-2 items-center">
                  <div className="w-2 h-2 rounded-full bg-muted-foreground/60 animate-pulse"></div>
                  <div className="w-2 h-2 rounded-full bg-muted-foreground/60 animate-pulse delay-150"></div>
                  <div className="w-2 h-2 rounded-full bg-muted-foreground/60 animate-pulse delay-300"></div>
                </div>
              </div>
            </div>
          )}
        </div>
      </ScrollArea>
      <div className="p-4 flex-shrink-0  mb-8 bg-white">
        {/* Quick prompts (chips) - only show for brand-new chat (no user messages yet) */}
        {messages.filter((m) => m.isUser).length === 0 && (
          <div className="flex flex-wrap gap-2 mb-3">
            {quickPrompts.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => handleQuickAsk(p)}
                disabled={!isDocumentProcessed}
                className={cn(
                  "px-3 py-1.5 text-sm rounded-full border border-[#E5E5E5] bg-[#F9F6F2] text-[#4B2A06] hover:bg-[#F1EDE6]",
                  !isDocumentProcessed && "opacity-50 cursor-not-allowed"
                )}
              >
                {p}
              </button>
            ))}
          </div>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSendMessage();
          }}
          className="flex items-center border-t pt-4 gap-2"
        >
          <Input
            ref={inputRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder={
              customStyles.inputPlaceholder ||
              "Ask a question about your document..."
            }
            className={cn(
              "flex-1 chat-input-focus focus:outline-none ring-0",
              customStyles.inputFocusClassName
            )}
            style={{
              background: customStyles.inputBg || undefined,
              borderColor: customStyles.inputBorder || undefined,
              borderRadius: customStyles.inputRadius || undefined,
              boxShadow: customStyles.inputShadow || undefined,
              borderWidth: customStyles.removeInputBorder ? 0 : undefined,
            }}
            disabled={!isDocumentProcessed}
          />
          <Button
            type="submit"
            size="icon"
            style={{
              background: customStyles.sendBtnBg || undefined,
              borderRadius: customStyles.inputRadius || undefined,
              boxShadow: customStyles.inputShadow || undefined,
            }}
            className={cn(
              "text-primary-foreground hover:opacity-90 transition-opacity",
              !isDocumentProcessed && "opacity-50 pointer-events-none"
            )}
            disabled={!isDocumentProcessed}
          >
            {isTyping ? (
              <Loader2
                className="h-4 w-4 animate-spin"
                style={{ color: customStyles.sendBtnIcon || undefined }}
              />
            ) : (
              <Send
                className="h-4 w-4"
                style={{ color: customStyles.sendBtnIcon || undefined }}
              />
            )}
          </Button>
        </form>
      </div>
    </div>
  );
}

export function DocumentPopover({
  documentId,
  documentName,
  renderAsButton = false,
  buttonLabel = "View Document",
  buttonClassName = "text-sm text-[#4B2A06]",
}: {
  documentId: string;
  documentName: string;
  renderAsButton?: boolean;
  buttonLabel?: string;
  buttonClassName?: string;
}) {
  const [docDetails, setDocDetails] = React.useState<any>(null);
  const [loading, setLoading] = React.useState(false);
  const [showPdf, setShowPdf] = React.useState(false);
  const [pdfUrl, setPdfUrl] = React.useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = React.useState(false);

  const fetchDocDetails = async () => {
    setLoading(true);
    try {
      const res = await axios.get(
        `${import.meta.env.VITE_API_URL}/documents/${documentId}`
      );
      setDocDetails(res.data);
    } catch (e) {
      setDocDetails({ text: "Failed to load document details." });
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async () => {
    const token = localStorage.getItem("accessToken");
    try {
      const response = await fetch(
        `${import.meta.env.VITE_API_URL}/documents/download/${documentId} `, // ||`http://localhost:5000/api/documents/download/${documentId}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );
      if (!response.ok) throw new Error("Failed to download file");
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = documentName || "document.pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      alert("Download failed: " + err.message);
    }
  };

  const handleViewPdf = async () => {
    setPdfLoading(true);
    setShowPdf(true); // Show modal immediately
    const token = localStorage.getItem("accessToken");
    try {
      const response = await axios.get(
        `${import.meta.env.VITE_API_URL
        }/documents/download/${documentId}?inline=1`,
        {
          headers: { Authorization: `Bearer ${token}` },
          responseType: "blob",
        }
      );
      const blob = new Blob([response.data], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      setPdfUrl(url);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      alert("Failed to load PDF: " + message);
      setShowPdf(false);
    } finally {
      setPdfLoading(false);
    }
  };

  const handleClosePdf = () => {
    if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    setShowPdf(false);
    setPdfUrl(null);
    setPdfLoading(false);
  };

  return (
    <>
      {/* Trigger to open PDF modal */}
      {renderAsButton ? (
        <button
          type="button"
          className={buttonClassName}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            handleViewPdf();
          }}
        >
          {buttonLabel}
        </button>
      ) : (
        <span
          className="cursor-pointer underline text-base font-semibold text-[#4B2A06] mx-4"
          onClick={handleViewPdf}
        >
          {documentName}
        </span>
      )}
      <Popover
        onOpenChange={(open) => {
          if (open && !docDetails && !loading) fetchDocDetails();
        }}
      >
        {/* Remove PopoverTrigger for document name */}
        <PopoverContent className="max-w-lg">
          {loading ? (
            <div>Loading...</div>
          ) : docDetails ? (
            <>
              {/* <div
                className="mb-2 text-sm text-gray-700"
                style={{ maxHeight: 300, overflowY: "auto" }}
              >
                {docDetails.text || "No text extracted."}
              </div> */}
              {/* Only show download button, no View PDF button */}
              {!showPdf && (
                <>
                  <button
                    onClick={handleDownload}
                    className="inline-block mt-2 px-4 py-2 bg-[#4B2A06] text-white rounded hover:bg-[#3A2004] mr-2"
                  >
                    Download PDF
                  </button>
                </>
              )}
            </>
          ) : (
            <>
              <button
                onClick={fetchDocDetails}
                className="inline-block mt-2 px-4 py-2 bg-[#A1A1AA] text-white rounded cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed mr-2"
                disabled={loading}
              >
                Fetch Text
              </button>
              {!showPdf && (
                <>
                  <button
                    onClick={handleDownload}
                    className="inline-block mt-2 px-4 py-2 bg-[#4B2A06] text-white rounded hover:bg-[#3A2004] mr-2"
                  >
                    Download PDF
                  </button>
                </>
              )}
            </>
          )}
        </PopoverContent>
      </Popover>
      {showPdf &&
        ReactDOM.createPortal(
          <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40">
            <div className="bg-white rounded-lg shadow-2xl p-2 w-full max-w-5xl h-[90vh] flex flex-col relative">
              <button
                className="absolute top-3 right-4 text-2xl font-bold text-gray-500 hover:text-gray-800 z-10"
                onClick={handleClosePdf}
                aria-label="Close PDF"
              >
                ×
              </button>
              {pdfLoading ? (
                <div className="flex-1 flex items-center justify-center">
                  <span className="text-lg font-semibold">Processing...</span>
                </div>
              ) : (
                pdfUrl && (
                  <>
                    <iframe
                      src={pdfUrl}
                      title="PDF Viewer"
                      width="100%"
                      height="100%"
                      className="flex-1 rounded"
                      style={{ border: "none" }}
                    />
                    <button
                      onClick={handleDownload}
                      className="z-[1001] absolute top-5 right-24 p-1.5 bg-[#3c3c3c] text-white hover:bg-[#515a5a] rounded-full"
                    >
                      <svg
                        className="h-5 w-5 text-white"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                        />
                      </svg>
                    </button>
                  </>
                )
              )}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
