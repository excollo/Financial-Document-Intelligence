import React, { useEffect, useState } from "react";
import { shareService } from "@/services/api";
import { userService } from "@/lib/api/userService";
import { X, Copy, Trash2, Search, User as UserIcon, Mail } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";

type ResourceType = "directory" | "document";

interface ShareDialogProps {
  resourceType: ResourceType;
  resourceId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const ShareDialog: React.FC<ShareDialogProps> = ({ resourceType, resourceId, open, onOpenChange }) => {
  const [loading, setLoading] = useState(false);
  const [shares, setShares] = useState<any[]>([]);
  const [role, setRole] = useState<"viewer" | "editor">("viewer");
  const [scope, setScope] = useState<"user" | "link">("user");
  const [principalId, setPrincipalId] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const { user } = useAuth();
  const isAdmin = (user?.role || "").toLowerCase() === "admin";

  const load = async () => {
    if (!resourceId) return;
    setLoading(true);
    try {
      const res = await shareService.list(resourceType, resourceId);
      setShares(res || []);
    } catch (e) {
      toast.error("Failed to load shares");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      load();
    }
  }, [open, resourceId]);

  // Ensure role is always viewer or editor
  useEffect(() => {
    if (role !== "viewer" && role !== "editor") {
      setRole("viewer");
    }
  }, [role]);

  const searchUsers = async (query: string) => {
    if (!query || query.length < 2) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    try {
      const response = await userService.getAllUsers({
        search: query,
        limit: 20,
      });
      setSearchResults(response.users || []);
    } catch (e) {
      console.error("Failed to search users:", e);
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  };

  useEffect(() => {
    if (scope === "user" && searchQuery) {
      const debounceTimer = setTimeout(() => {
        searchUsers(searchQuery);
      }, 300);
      return () => clearTimeout(debounceTimer);
    } else {
      setSearchResults([]);
    }
  }, [searchQuery, scope]);

  const addShare = async () => {
    if (!resourceId) return;
    
    // Validate inputs based on scope
    if (scope === "user" && !principalId && !userEmail) {
      toast.error("Please select a user or enter an email address");
      return;
    }

    try {
      await shareService.create({ 
        resourceType, 
        resourceId, 
        scope, 
        role, 
        principalId: scope === "link" ? undefined : principalId,
        invitedEmail: scope === "user" && userEmail ? userEmail : undefined,
      });
      setPrincipalId("");
      setUserEmail("");
      setSearchQuery("");
      setSearchResults([]);
      await load();
      toast.success("Share added successfully");
    } catch (e: any) {
      const errorMsg = e?.response?.data?.error || e?.response?.data?.message || "Failed to add share";
      toast.error(errorMsg);
    }
  };

  const selectUser = (selectedUser: any) => {
    setPrincipalId(selectedUser._id);
    setUserEmail(selectedUser.email);
    setSearchQuery(selectedUser.name || selectedUser.email);
    setSearchResults([]);
  };

  const revoke = async (id: string) => {
    try {
      await shareService.revoke(id);
      await load();
      toast.success("Share revoked");
    } catch (e) {
      toast.error("Failed to revoke share");
    }
  };

  const createLink = async () => {
    if (!resourceId) return;
    try {
      const { token } = await shareService.createOrRotateLink(resourceType, resourceId, role);
      setLinkToken(token);
      await load();
      toast.success("Link created");
    } catch (e) {
      toast.error("Failed to create link");
    }
  };

  const copyLink = async () => {
    if (!linkToken) return;
    const url = `${window.location.origin}/dashboard?linkToken=${encodeURIComponent(linkToken)}`;
    await navigator.clipboard.writeText(url);
    toast.success("Link copied");
  };

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden" style={{borderRadius: 16}}>
        {/* Header */}
        <div className=" px-6 py-4 flex items-center justify-between">
        <div className="text-lg font-extrabold item-right text-[#232323]">Share</div>
          <button onClick={() => onOpenChange(false)} className="text-gray-500 hover:text-gray-700   ">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="h-px bg-[#EFEAE4]" />
        {/* Body */}
        <div className="px-6 py-5">
          {/* Scope Selection */}
          <div className="mb-4">
            <div className="text-sm text-[#232323] mb-3 font-semibold">Share with</div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setScope("user")}
                className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  scope === "user"
                    ? "bg-[#4B2A06] text-white"
                    : "bg-[#F5F3EF] text-[#232323] hover:bg-[#E8E2DA]"
                }`}
              >
                <UserIcon className="h-4 w-4 inline mr-2" />
                User
              </button>
              <button
                onClick={() => setScope("link")}
                className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  scope === "link"
                    ? "bg-[#4B2A06] text-white"
                    : "bg-[#F5F3EF] text-[#232323] hover:bg-[#E8E2DA]"
                }`}
              >
                <Copy className="h-4 w-4 inline mr-2" />
                Link
              </button>
            </div>
          </div>

          {/* User Selection */}
          {scope === "user" && (
            <div className="mb-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search users by name or email, or enter email address"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    if (!e.target.value.includes("@")) {
                      setUserEmail("");
                    } else {
                      setUserEmail(e.target.value);
                    }
                  }}
                  className="w-full pl-10 pr-4 py-2 rounded-lg bg-[#F5F3EF] border border-[#E8E2DA] text-[#232323] text-sm focus:outline-none focus:ring-2 focus:ring-[#4B2A06]"
                />
              </div>
              {/* Search Results Dropdown */}
              {searchResults.length > 0 && (
                <div className="mt-2 max-h-48 overflow-y-auto border border-[#E8E2DA] rounded-lg bg-white shadow-lg">
                  {searchResults.map((u) => (
                    <button
                      key={u._id}
                      onClick={() => selectUser(u)}
                      className="w-full px-4 py-2 text-left hover:bg-[#F5F3EF] flex items-center gap-3"
                    >
                      <div className="h-8 w-8 rounded-full bg-[#4B2A06] text-white flex items-center justify-center text-xs font-semibold">
                        {(u.name || u.email || "U").charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-[#232323] truncate">
                          {u.name || "No name"}
                        </div>
                        <div className="text-xs text-[#7C7C7C] truncate">{u.email}</div>
                        {u.domain && (
                          <div className="text-xs text-[#7C7C7C]">Domain: {u.domain}</div>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {/* Email input hint - show when email is entered but not selected from search */}
              {userEmail && userEmail.includes("@") && !principalId && (
                <div className="mt-2 px-3 py-2 rounded-lg bg-blue-50 border border-blue-200 flex items-center gap-2">
                  <Mail className="h-4 w-4 text-blue-600" />
                  <div className="flex-1">
                    <div className="text-sm font-medium text-blue-900">Share with email</div>
                    <div className="text-xs text-blue-700">{userEmail}</div>
                    <div className="text-xs text-blue-600 mt-1">An email notification will be sent to this address</div>
                  </div>
                </div>
              )}
              {/* Selected user display */}
              {principalId && (
                <div className="mt-2 px-3 py-2 rounded-lg bg-[#F9F6F2] flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="h-8 w-8 rounded-full bg-[#4B2A06] text-white flex items-center justify-center text-xs font-semibold">
                      {(userEmail || "U").charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div className="text-sm font-medium text-[#232323]">
                        {searchQuery || userEmail}
                      </div>
                      <div className="text-xs text-[#7C7C7C]">{userEmail}</div>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      setPrincipalId("");
                      setUserEmail("");
                      setSearchQuery("");
                    }}
                    className="text-red-600 hover:text-red-700"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Role Selection */}
          <div className="mb-4">
            <div className="text-sm text-[#232323] mb-2 font-semibold">Access level</div>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as "viewer" | "editor")}
              className="w-full px-4 py-2 rounded-lg bg-[#F5F3EF] border border-[#E8E2DA] text-[#232323] text-sm focus:outline-none focus:ring-2 focus:ring-[#4B2A06]"
            >
              <option value="viewer">Viewer</option>
              <option value="editor">Editor</option>
            </select>
          </div>

          {/* Add Share Button */}
          {scope !== "link" && (
            <button
              onClick={addShare}
              disabled={!principalId && !userEmail}
              className="w-full bg-[#4B2A06] text-white px-4 py-2 rounded-lg hover:bg-[#3A2004] disabled:opacity-50 disabled:cursor-not-allowed mb-4"
            >
              Add User
            </button>
          )}

          {/* Link actions */}
          {scope === "link" && (
            <div className="mb-4 flex justify-center gap-2 w-full">
              <button
                onClick={createLink}
                className="inline-flex items-center gap-2 bg-[#4B2A06] text-white px-4 py-2 rounded-md hover:bg-[#3A2004] disabled:opacity-50"
                title="Create share link"
              >
                Create link
              </button>
              <button
                onClick={copyLink}
                className="inline-flex items-center gap-2 bg-[#4B2A06] text-white px-4 py-2 rounded-md hover:bg-[#3A2004] disabled:opacity-50"
                disabled={!linkToken}
                title={!linkToken ? "Create a link first" : "Copy link to clipboard"}
              >
                <Copy className="h-4 w-4" /> Copy link
              </button>
            </div>
          )}

          {/* Existing shares */}
          <div className="mt-4 w-full border-t border-[#EFEAE4] pt-4">
            <div className="text-sm font-semibold mb-2 text-[#232323]">People with access</div>
            <div className="space-y-2 max-h-48 overflow-y-auto w-full">
              {loading ? (
                <div className="text-gray-500 text-sm text-center py-4">Loading...</div>
              ) : shares.length === 0 ? (
                <div className="text-gray-500 text-sm text-center py-4">No shares yet</div>
              ) : (
                shares.map((s: any) => (
                  <div key={s.id} className="flex items-center justify-between rounded-lg bg-[#F9F6F2] px-3 py-2">
                    <div className="text-sm text-[#232323] flex-1 min-w-0">
                      <div className="font-medium truncate">
                        {s.scope === "link" ? (
                          <span className="flex items-center gap-2">
                            <Copy className="h-3 w-3" /> Share Link
                          </span>
                        ) : (
                          <span className="flex items-center gap-2">
                            <UserIcon className="h-3 w-3" /> {s.invitedEmail || s.principalId || "User"}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-[#7C7C7C]">Role: {s.role}</div>
                      {s.invitedEmail && s.scope === "user" && (
                        <div className="text-xs text-[#7C7C7C]">Email: {s.invitedEmail}</div>
                      )}
                    </div>
                    <button
                      className="text-red-600 hover:text-red-700 flex-shrink-0 ml-2"
                      onClick={() => revoke(s.id)}
                      title="Revoke"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};



