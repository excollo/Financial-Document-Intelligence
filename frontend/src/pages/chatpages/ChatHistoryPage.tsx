import React, { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { chatService } from "@/services/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/contexts/AuthContext";
import { Navbar } from "@/components/sharedcomponents/Navbar";
import { Search, MoreVertical } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export default function ChatHistoryPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [loading, setLoading] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [chats, setChats] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState("");

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
          {isAdmin && (
            <div className="text-sm text-gray-500">
              {isAdmin && (
                <Button
                  size="sm"
                  onClick={() => setShowAll((v) => !v)}
                >
                  {showAll ? "Showing: All Users" : "Showing: My Chats"}
                </Button>
              )}
            </div>
          )}
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
                className="bg-white border border-gray-200 rounded-lg shadow-sm hover:shadow-md transition-shadow"
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
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem>View Chat</DropdownMenuItem>
                        <DropdownMenuItem>Delete Chat</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>

        {/* Admin Toggle Button */}
        {isAdmin && (
          <div className="mt-6 flex justify-center">
            <Button
              variant="outline"
              onClick={() => setShowAll((v) => !v)}
              className="px-6"
            >
              {showAll ? "Show My Chats Only" : "Show All Users' Chats"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
