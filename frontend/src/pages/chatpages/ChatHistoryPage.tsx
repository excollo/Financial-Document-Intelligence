import React, { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { chatService } from "@/services/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/contexts/AuthContext";
import { Navbar } from "@/components/sharedcomponents/Navbar";
import { Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export default function ChatHistoryPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [loading, setLoading] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [chats, setChats] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedChatDetail, setSelectedChatDetail] = useState<any | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);

  const fetchChats = async () => {
    setLoading(true);
    try {
      const data =
        showAll && isAdmin
          ? await chatService.getAllAdmin()
          : await chatService.getMine();
      setChats(Array.isArray(data) ? data : []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchChats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAll]);

  const chatsLast30Days = useMemo(() => {
    const now = new Date().getTime();
    const thirtyDays = 1000 * 60 * 60 * 24 * 30;
    return chats.filter((c) => {
      const ts = new Date(c.updatedAt || c.createdAt || Date.now()).getTime();
      return now - ts <= thirtyDays;
    });
  }, [chats]);

  const filteredChats = useMemo(() => {
    if (!searchTerm) return chatsLast30Days;
    return chatsLast30Days.filter((chat) => {
      const title =
        chat.title || `Chat ${String(chat.id || chat._id).slice(-6)}`;
      const documentId = chat.documentId || "";
      return (
        title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        documentId.toLowerCase().includes(searchTerm.toLowerCase())
      );
    });
  }, [chatsLast30Days, searchTerm]);

  const handleOpenDetail = async (chatId: string) => {
    if (!isAdmin) {
      toast.error("Only admins can view chat details");
      return;
    }
    try {
      setDetailLoading(true);
      setDetailOpen(true);
      const detail = await chatService.getAdminDetail(chatId);
      setSelectedChatDetail(detail);
    } catch (error: any) {
      toast.error(error?.response?.data?.error || "Failed to load chat detail");
      setDetailOpen(false);
    } finally {
      setDetailLoading(false);
    }
  };

  const handleDeleteChat = async (chatId: string) => {
    try {
      await chatService.deleteAnyAdmin(chatId);
      toast.success("Chat deleted successfully");
      setChats((prev) =>
        prev.filter((c) => (c.id || c._id) !== chatId)
      );
      if (selectedChatDetail?.chat?.id === chatId) {
        setDetailOpen(false);
        setSelectedChatDetail(null);
      }
    } catch (error: any) {
      toast.error(error?.response?.data?.error || "Failed to delete chat");
    }
  };

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-white">
        <Navbar title="Chat History" showSearch={false} searchValue="" onSearchChange={() => {}} />
        <div className="w-[90vw] mx-auto py-12">
          <div className="text-center text-gray-600">Only admins can access chat history.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      <Navbar
        title="Chat History"
        showSearch={false}
        searchValue=""
        onSearchChange={() => {}}
      />

      <div className="w-[90vw] mx-auto py-8">
        {/* Main Title and Filter */}
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-900">
            Chat History (Last 30 Days)
          </h1>
          <div className="text-sm text-gray-500">
            <Button size="sm" onClick={() => setShowAll((v) => !v)}>
              {showAll ? "Showing: All Users" : "Showing: My Chats"}
            </Button>
          </div>
        </div>

        {/* Search Bar */}
        <div className="mb-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              placeholder="Search Chats"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 bg-gray-100 border-gray-200 rounded-lg"
            />
          </div>
        </div>

        {/* Chat Sessions List */}
        <div className="space-y-4">
          {loading ? (
            <div className="text-center py-8 text-gray-600">
              Loading chats...
            </div>
          ) : filteredChats.length === 0 ? (
            <div className="text-center py-8 text-gray-600">
              No chat history in the last 30 days.
            </div>
          ) : (
            filteredChats.map((chat) => (
              <Card
                key={chat.id || chat._id}
                className="bg-white border border-gray-200 rounded-lg shadow-sm hover:shadow-md transition-shadow cursor-pointer"
                onClick={() => handleOpenDetail(chat.id || chat._id)}
              >
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <h3 className="font-semibold text-gray-900 text-lg mb-2">
                        {chat.title || "New Chat"}
                      </h3>
                      <div className="space-y-1">
                        <p className="text-sm text-gray-600">
                          Messages:{" "}
                          {Array.isArray(chat.messages)
                            ? chat.messages.length
                            : 0}
                        </p>
                        <p className="text-sm text-gray-600">
                          Document: {chat.documentId || "—"}
                        </p>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="ml-4 text-gray-500 hover:text-red-600 hover:bg-transparent"
                      title="Delete chat"
                      onClick={(e) => {
                        e.stopPropagation();
                        const chatId = chat.id || chat._id;
                        if (!chatId) return;
                        if (
                          window.confirm("Are you sure you want to delete this chat?")
                        ) {
                          handleDeleteChat(chatId);
                        }
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>

        <div className="mt-6 flex justify-center">
          <Button
            variant="outline"
            onClick={() => setShowAll((v) => !v)}
            className="px-6"
          >
            {showAll ? "Show My Chats Only" : "Show All Users' Chats"}
          </Button>
        </div>
      </div>

      <Dialog
        open={detailOpen}
        onOpenChange={(open) => {
          setDetailOpen(open);
          if (!open) setSelectedChatDetail(null);
        }}
      >
        <DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-y-auto bg-white">
          <DialogHeader>
            <DialogTitle>Chat Details (Admin)</DialogTitle>
          </DialogHeader>

          {detailLoading ? (
            <div className="text-sm text-gray-500">Loading chat details...</div>
          ) : !selectedChatDetail ? (
            <div className="text-sm text-gray-500">No chat detail found.</div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                <div>
                  <div className="text-gray-500">Document Name</div>
                  <div className="font-medium">
                    {selectedChatDetail.document?.name ||
                      selectedChatDetail.chat?.documentId ||
                      "-"}
                  </div>
                </div>
                <div>
                  <div className="text-gray-500">User Name</div>
                  <div className="font-medium">
                    {selectedChatDetail.user?.name ||
                      selectedChatDetail.user?.email ||
                      selectedChatDetail.chat?.microsoftId ||
                      selectedChatDetail.chat?.userId ||
                      "-"}
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-sm font-semibold text-gray-900">Chat & Response</div>
                {Array.isArray(selectedChatDetail.chat?.messages) &&
                selectedChatDetail.chat.messages.length > 0 ? (
                  <div className="space-y-2">
                    {selectedChatDetail.chat.messages.map((m: any) => (
                      <div
                        key={m.id}
                        className={`rounded-lg p-3 text-sm ${
                          m.isUser
                            ? "bg-blue-50 border border-blue-100"
                            : "bg-gray-50 border border-gray-200"
                        }`}
                      >
                        <div className="text-xs text-gray-500 mb-1">
                          {m.isUser ? "User" : "Assistant"}
                        </div>
                        {m.isUser ? (
                          <div className="whitespace-pre-wrap text-gray-900">
                            {m.content}
                          </div>
                        ) : (
                          <div className="text-gray-900 prose prose-sm max-w-none">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                              {m.content || ""}
                            </ReactMarkdown>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-sm text-gray-500">No messages found.</div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
