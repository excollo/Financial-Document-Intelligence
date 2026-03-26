import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FileText, Plus, Search, ArrowLeft, Trash2 } from "lucide-react";
import { documentService, chatService } from "@/services/api";
import { format } from "date-fns";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";

interface ChatMessage {
  id: string;
  content: string;
  isUser: boolean;
  timestamp: string;
}

interface Chat {
  id: string;
  title: string;
  messages: ChatMessage[];
  updatedAt: string;
  documentId: string;
  docName?: string;
}

function groupChatsByDay(chats: Chat[]) {
  const now = new Date();
  const today: Chat[] = [];
  const yesterday: Chat[] = [];
  const lastWeek: Chat[] = [];
  const older: Chat[] = [];

  chats.forEach((chat) => {
    const chatDate = new Date(chat.updatedAt);
    const diffDays = Math.floor(
      (now.getTime() - chatDate.getTime()) / (1000 * 60 * 60 * 24)
    );
    if (diffDays === 0) today.push(chat);
    else if (diffDays === 1) yesterday.push(chat);
    else if (diffDays <= 7) lastWeek.push(chat);
    else older.push(chat);
  });

  return [
    { label: "Today", chats: today },
    { label: "Yesterday", chats: yesterday },
    { label: "Last Week", chats: lastWeek },
    { label: "Older", chats: older },
  ].filter((g) => g.chats.length > 0);
}

export interface SidebarProps {
  selectedDocumentId?: string;
  selectedChatId?: string;
  onSelectDocument?: (doc: any | null) => void;
  onSelectChat?: (chat: any) => void;
  onNewChat?: () => void;
  onBack?: () => void;
  onClose?: () => void;
}
export const Sidebar: React.FC<SidebarProps> = ({
  selectedDocumentId,
  selectedChatId,
  onSelectDocument,
  onSelectChat,
  onNewChat,
  onBack,
  onClose,
}) => {
  const navigate = useNavigate();
  const [documents, setDocuments] = useState<any[]>([]);
  const [chats, setChats] = useState<Chat[]>([]);
  const [docSearch, setDocSearch] = useState("");
  const [chatSearch, setChatSearch] = useState("");
  const [docSearchVisible, setDocSearchVisible] = useState(false);
  const [chatSearchVisible, setChatSearchVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [documentToDelete, setDocumentToDelete] = useState<any | null>(null);

  useEffect(() => {
    const fetchDocuments = async () => {
      try {
        const docs = await documentService.getAll();
        setDocuments(docs);
      } catch (err) {
        console.error("Error fetching documents:", err);
        setError("Failed to load documents");
      }
    };
    fetchDocuments();
  }, []);

  useEffect(() => {
    const fetchChatsForDocument = async () => {
      if (!selectedDocumentId) {
        setChats([]);
        return;
      }
      try {
        setError(null);
        const fetchedChats = await chatService.getByDocumentId(
          selectedDocumentId
        );

        const currentDoc = documents.find(
          (doc) => doc.id === selectedDocumentId
        );

        const chatsWithDocName = fetchedChats.map((c: any) => ({
          ...c,
          docName: currentDoc?.name,
        }));

        chatsWithDocName.sort(
          (a, b) =>
            new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        );
        setChats(chatsWithDocName);
      } catch (err) {
        console.error(
          `Error fetching chats for doc ${selectedDocumentId}:`,
          err
        );
        setError("Failed to load chat history");
        setChats([]);
      }
    };

    if (selectedDocumentId) {
      if (documents.length > 0) {
        fetchChatsForDocument();
      }
    } else {
      setChats([]);
    }
  }, [selectedDocumentId, documents]);

  // Get the selected document's directoryId to filter documents
  const selectedDocument = documents.find((doc) => doc.id === selectedDocumentId);
  const selectedDirectoryId = selectedDocument?.directoryId;

  // Filter documents: only show documents from the same directory as the selected document
  const filteredDocs = documents.filter((doc) => {
    const matchesSearch = doc.name.toLowerCase().includes(docSearch.toLowerCase());
    // If a document is selected, only show documents from the same directory
    if (selectedDirectoryId) {
      return matchesSearch && doc.directoryId === selectedDirectoryId;
    }
    // If no document is selected, show all documents (or none)
    return matchesSearch;
  });

  const filteredChats = chats.filter(
    (chat) =>
      (chat.docName?.toLowerCase().includes(chatSearch.toLowerCase()) ||
        chat.title.toLowerCase().includes(chatSearch.toLowerCase())) &&
      Array.isArray(chat.messages) &&
      chat.messages.length > 1
  );

  const groupedChats = useMemo(
    () => groupChatsByDay(filteredChats),
    [filteredChats]
  );

  const handleDelete = async (chatId: string) => {
    try {
      await chatService.delete(chatId);
      setChats(chats.filter((chat) => chat.id !== chatId));
    } catch (err) {
      console.error("Error deleting chat:", err);
      setError("Failed to delete chat");
    }
  };

  const handleDeleteDocClick = (e: React.MouseEvent, doc: any) => {
    e.stopPropagation();
    setDocumentToDelete(doc);
  };

  const handleDocDeleteConfirm = async () => {
    if (!documentToDelete) return;

    try {
      await documentService.delete(documentToDelete.id);
      setDocuments((prev) =>
        prev.filter((doc) => doc.id !== documentToDelete.id)
      );
      setChats((prev) =>
        prev.filter((chat) => chat.documentId !== documentToDelete.id)
      );
      toast.success("Document deleted successfully");

      if (selectedDocumentId === documentToDelete.id && onSelectDocument) {
        onSelectDocument(null);
      }
    } catch (error) {
      console.error("Error deleting document:", error);
      toast.error("Failed to delete document");
    } finally {
      setDocumentToDelete(null);
    }
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    return format(date, "h:mm a");
  };

  const visibleDocs = filteredDocs;
  return (
    <div
      className="w-full bg-[#F5F3EF] h-full flex flex-col p-4"
      style={{
        fontFamily: "Inter, Arial, sans-serif",
        boxShadow: "none",
        border: "none",
        height: "100vh",
      }}
    >
      {/* Top Navigation Bar with Back and Close buttons */}
      <div className="flex items-center justify-between mb-4">
        <button
          className="flex items-center gap-2 text-[#7C7C7C] hover:text-[#4B2A06] transition-colors"
          onClick={onClose || onBack}
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        
      </div>
      {/* New Chat Button */}
      <button
        className="w-full flex items-center justify-between bg-[#ECE9E2] rounded-2xl px-5 py-4 mb-6 text-[#4B2A06] text-[1.1rem] font-bold shadow-none border-none hover:bg-[#E0D7CE] transition"
        style={{ fontWeight: 700, fontSize: "1.1rem", borderRadius: "18px" }}
        onClick={onNewChat}
      >
        <span>New Chat</span>
        <Plus className="h-7 w-7 text-[#4B2A06]" />
      </button>
      {/* Split area for Documents and Chat History */}
      <div className="flex-1 flex flex-col gap-6 min-h-0">
        {/* Documents Section (top 50%) */}
        <div
          className="flex-1 min-h-0 overflow-y-auto pr-1 scrollbar-hide"
          style={{ maxHeight: "50%" }}
        >
          <div className="flex items-center justify-between mb-4 mt-2">
            <span className="text-xl font-extrabold text-[#232323] tracking-tight">
              Documents
            </span>
            <Search
              className=" outline-none h-5 w-5 text-[#232323] cursor-pointer"
              onClick={() => setDocSearchVisible(!docSearchVisible)}
            />
          </div>
          
          {docSearchVisible && (
            <div className="mb-4">
              <input
                type="text"
                value={docSearch}
                onChange={(e) => setDocSearch(e.target.value)}
                placeholder="Search documents..."
                className="outline-none  w-full rounded-xl px-3 py-2 bg-[#F5F3EF] border border-[#ECECEC] text-[#232323] text-sm focus:outline-none placeholder:text-[#A1A1AA]"
                style={{ fontSize: "0.98rem", borderRadius: "12px" }}
                autoFocus
              />
            </div>
          )}
          <div className="space-y-1">
            {visibleDocs.length === 0 ? (
              <div className="text-sm text-muted-foreground p-2">
                {selectedDirectoryId 
                  ? "No documents found in this directory" 
                  : "Select a document to see related documents"}
              </div>
            ) : (
              visibleDocs.map((doc) => (
                <div
                  key={doc.id}
                  className={`group flex items-center justify-between w-full p-2 rounded-xl text-left text-sm font-medium truncate transition cursor-pointer ${
                    selectedDocumentId === doc.id
                      ? "bg-[#ECE9E2] text-[#4B2A06] font-bold"
                      : "bg-transparent text-[#232323] hover:bg-[#ECE9E2]/60 font-medium"
                  }`}
                  style={{ fontSize: "0.98rem", borderRadius: "12px" }}
                  onClick={() => onSelectDocument && onSelectDocument(doc)}
                >
                  <div className="flex items-center gap-2 truncate">
                    <FileText className="h-5 w-5 flex-shrink-0" />
                    <span className="truncate">{doc.name}</span>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      className="text-muted-foreground hover:text-destructive p-1"
                      onClick={(e) => handleDeleteDocClick(e, doc)}
                      title="Delete document"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
        {/* Horizontal divider between Documents and Chat History */}
        <div className="w-full h-[1.5px] bg-[#ECECEC]  rounded-full" />
        {/* Chat History Section (bottom 50%) */}
        <div
          className="flex-1 min-h-0 overflow-y-auto pr-1"
          style={{ maxHeight: "50%" }}
        >
          <div className=" flex items-center justify-between mb-4 mt-2">
            <span className="text-xl font-extrabold text-[#232323] tracking-tight">
              Chat History
            </span>
            <Search
              className=" outline-none h-5 w-5 text-[#232323] cursor-pointer"
              onClick={() => setChatSearchVisible(!chatSearchVisible)}
            />
          </div>
          {chatSearchVisible && (
            <div className="mb-4">
              <input
                type="text"
                value={chatSearch}
                onChange={(e) => setChatSearch(e.target.value)}
                placeholder="Search chats..."
                className="outline-none w-full rounded-xl px-3 py-2 bg-[#F5F3EF] border border-[#ECECEC] text-[#232323] text-sm focus:outline-none placeholder:text-[#A1A1AA]"
                style={{ fontSize: "0.98rem", borderRadius: "12px" }}
                autoFocus
              />
            </div>
          )}
          <div className="space-y-1">
            {error && <p className="text-destructive text-sm">{error}</p>}
            {groupedChats.length === 0 && !error ? (
              <p className="text-muted-foreground text-sm ml-1">No chats yet.</p>
            ) : (
              groupedChats.map((group) => (
                <div key={group.label} className="mb-4">
                  <div className="text-xs text-muted-foreground mb-1 uppercase tracking-wider">
                    {group.label}
                  </div>
                  <ul className="space-y-1">
                    {group.chats.map((chat) => (
                      <li
                        key={chat.id}
                        className={`group flex items-center p-2 rounded-lg transition-colors cursor-pointer ${
                          selectedChatId === chat.id
                            ? "bg-[#ECE9E2] text-[#4B2A06] font-bold"
                            : "hover:bg-[#ECE9E2]/60 text-foreground"
                        }`}
                        onClick={() => onSelectChat && onSelectChat(chat)}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">
                            {chat.title === "New Chat" &&
                            chat.messages.length > 1
                              ? chat.messages[1].content.slice(0, 30) + "..."
                              : chat.title}
                          </div>
                          <div className="text-xs text-muted-foreground truncate">
                            {chat.docName} - {formatTime(chat.updatedAt)}
                          </div>
                        </div>
                        <button
                          className="ml-2 text-xs text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(chat.id);
                          }}
                          title="Delete chat"
                        >
                          &#10005;
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
      <AlertDialog
        open={!!documentToDelete}
        onOpenChange={() => setDocumentToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Document</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{documentToDelete?.name}"? This
              action cannot be undone and will delete all associated chats.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDocDeleteConfirm}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
