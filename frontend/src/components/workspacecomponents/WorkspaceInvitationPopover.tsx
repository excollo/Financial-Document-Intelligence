import React, { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  UserPlus,
  Mail,
  MoreVertical,
  Trash2,
  Edit,
  CheckCircle,
  Clock,
  XCircle,
  Loader2,
  Users,
  Calendar,
  Shield,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  workspaceInvitationService,
  WorkspaceInvitation,
} from "@/services/workspaceInvitationService";
import { shareService, directoryService } from "@/services/api";

type TimeBucket = "today" | "last7" | "last15" | "last30" | "last90" | "all";

export const WorkspaceInvitationPopover: React.FC = () => {
  const { user } = useAuth();
  const [invitations, setInvitations] = useState<WorkspaceInvitation[]>([]);
  const [filteredInvitations, setFilteredInvitations] = useState<
    WorkspaceInvitation[]
  >([]);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [isSendDialogOpen, setIsSendDialogOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(5);
  const [directories, setDirectories] = useState<any[]>([]);
  const [dirLoading, setDirLoading] = useState(false);
  const [dirSearch, setDirSearch] = useState("");
  const [showDirSearch, setShowDirSearch] = useState(false);

  // Form state for sending invitation
  const [inviteForm, setInviteForm] = useState({
    email: "",
    name: "",
    role: "viewer" as "viewer" | "editor",
    message: "",
    allowedTimeBuckets: ["all"] as TimeBucket[], // Default to "all" since documents filtered by directory
    selectedDirectories: [] as any[],
    directoryRole: "viewer" as "viewer" | "editor",
  });

  useEffect(() => {
    if (user?.role === "admin") {
      loadInvitations();
      loadDirectories();
    }
  }, [user]);

  const loadDirectories = async () => {
    try {
      setDirLoading(true);
      console.log("Loading directories...");
      const res = await directoryService.listChildren("root", {
        pageSize: 200,
        sort: "name",
        order: "asc",
      });
      console.log("Directories response:", res);
      
      // Extract only directories from the response
      const allItems = res?.items || [];
      const dirs = allItems
        .filter((item: any) => item.kind === "directory")
        .map((item: any) => item.item);
      
      setDirectories(dirs);
      console.log("Set directories:", dirs);
    } catch (error) {
      console.error("Error loading directories:", error);
      toast.error("Failed to load directories");
      setDirectories([]);
    } finally {
      setDirLoading(false);
    }
  };

  // Filter invitations based on search and status
  useEffect(() => {
    let filtered = invitations;

    // Filter by search term
    if (searchTerm) {
      filtered = filtered.filter(
        (invitation) =>
          invitation.inviterEmail
            .toLowerCase()
            .includes(searchTerm.toLowerCase()) ||
          invitation.inviterName
            .toLowerCase()
            .includes(searchTerm.toLowerCase())
      );
    }

    // Filter by status
    if (statusFilter !== "all") {
      filtered = filtered.filter(
        (invitation) => invitation.status === statusFilter
      );
    }

    setFilteredInvitations(filtered);
    setCurrentPage(1); // Reset to first page when filtering
  }, [invitations, searchTerm, statusFilter]);

  const loadInvitations = async () => {
    try {
      setLoading(true);
      const data = await workspaceInvitationService.getWorkspaceInvitations();
      setInvitations(data);
    } catch (error) {
      console.error("Error loading invitations:", error);
      toast.error("Failed to load invitations");
    } finally {
      setLoading(false);
    }
  };

  const handleSendInvitation = async () => {
    if (!inviteForm.email || !inviteForm.name) {
      toast.error("Email and name are required");
      return;
    }

    if (inviteForm.selectedDirectories.length === 0) {
      toast.error("Please select at least one directory");
      return;
    }

    try {
      setActionLoading("send");
      
      // Send invitation with directory access
      // When directories are selected, set allowedTimeBuckets to ["all"] 
      // since documents will be filtered by directory access
      const invitation = await workspaceInvitationService.sendInvitation({
        inviteeEmail: inviteForm.email,
        inviteeName: inviteForm.name,
        invitedRole: inviteForm.role,
        message: inviteForm.message,
        allowedTimeBuckets: ["all"], // All documents in granted directories
        grantedDirectories: inviteForm.selectedDirectories.map(dir => ({
          directoryId: dir.id,
          role: inviteForm.directoryRole,
        })),
      });

        toast.success(`Invitation sent with access to ${inviteForm.selectedDirectories.length} director${inviteForm.selectedDirectories.length > 1 ? 'ies' : 'y'}`);
      
      setIsSendDialogOpen(false);
      setInviteForm({
        email: "",
        name: "",
        role: "viewer",
        message: "",
        allowedTimeBuckets: ["all"],
        selectedDirectories: [],
        directoryRole: "viewer",
      });
      loadInvitations();
    } catch (error: any) {
      const message =
        error.response?.data?.message || "Failed to send invitation";
      toast.error(message);
    } finally {
      setActionLoading(null);
    }
  };

  const handleCancelInvitation = async (invitationId: string) => {
    try {
      setActionLoading(`cancel-${invitationId}`);
      await workspaceInvitationService.cancelInvitation(invitationId);
      toast.success("Invitation cancelled");
      loadInvitations();
      
    } catch (error: any) {
      const message =
        error.response?.data?.message || "Failed to cancel invitation";
      toast.error(message);
    } finally {
      setActionLoading(null);
    }
  };

  const handleDeleteInvitation = async (invitationId: string) => {
    if (!confirm("Are you sure you want to delete this invitation?")) return;

    try {
      setActionLoading(`delete-${invitationId}`);
      await workspaceInvitationService.deleteInvitation(invitationId);
      toast.success("Invitation deleted");
      loadInvitations();
      window.location.reload();
    } catch (error: any) {
      const message =
        error.response?.data?.message || "Failed to delete invitation";
      toast.error(message);
    } finally {
      setActionLoading(null);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "accepted":
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case "pending":
        return <Clock className="h-4 w-4 text-yellow-500" />;
      case "declined":
      case "cancelled":
      case "expired":
        return <XCircle className="h-4 w-4 text-red-500" />;
      default:
        return <Clock className="h-4 w-4 text-gray-500" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "accepted":
        return "bg-green-100 text-green-800";
      case "pending":
        return "bg-yellow-100 text-yellow-800";
      case "declined":
      case "cancelled":
      case "expired":
        return "bg-red-100 text-red-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  // Pagination logic
  const totalPages = Math.ceil(filteredInvitations.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const currentInvitations = filteredInvitations.slice(startIndex, endIndex);

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
  };

  if (user?.role !== "admin") {
    return null;
  }

  return (
    <div className="w-full h-full flex flex-col bg-gray-50 rounded-lg">
      <div className="p-4 flex-shrink-0">
        <div className="flex items-center justify-between ">
          <h3 className="text-lg font-semibold flex items-center ">
            <Users className="h-5 w-5" />
            Workspace Invitations
          </h3>
          <Dialog open={isSendDialogOpen} onOpenChange={setIsSendDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="flex items-center gap-2 bg-[#4B2A06] text-white shadow-md hover:bg-[#4B2A06] transition">
                <UserPlus className="h-4 w-4" />
                Send Invitation
              </Button>
            </DialogTrigger>
            <DialogContent  
              className="sm:max-w-2xl max-h-[90vh] overflow-y-auto bg-gray-50 text-[#4B2A06]" 
              hideClose
              onInteractOutside={(e) => {
                // Prevent closing when clicking outside if form has data
                if (inviteForm.email || inviteForm.name || inviteForm.selectedDirectories.length > 0) {
                  if (!confirm("Are you sure you want to cancel? All entered data will be lost.")) {
                    e.preventDefault();
                  } else {
                    // Reset form when closing
                    setInviteForm({
                      email: "",
                      name: "",
                      role: "viewer",
                      message: "",
                      allowedTimeBuckets: ["all"],
                      selectedDirectories: [],
                      directoryRole: "viewer",
                    });
                    setDirSearch("");
                    setShowDirSearch(false);
                  }
                }
              }}
            >
              <DialogHeader>
                <DialogTitle>Send Workspace Invitation</DialogTitle>
                <DialogDescription>Invite a user to join your workspace with specific directory access. Only selected directories will be accessible to the invited user.</DialogDescription>
              </DialogHeader>
              <div className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="email" className="text-sm font-medium">Email *</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="user@example.com"
                    value={inviteForm.email}
                    className="h-10 border-gray-300 focus:outline-none focus:ring-2 focus:ring-[#4B2A06] bg-white"
                    onChange={(e) =>
                      setInviteForm({ ...inviteForm, email: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="name" className="text-sm font-medium">Name *</Label>
                  <Input
                    id="name"
                    placeholder="Full Name"
                    value={inviteForm.name}
                    className="h-10 border-gray-300 focus:outline-none focus:ring-2 focus:ring-[#4B2A06] bg-white"
                    onChange={(e) =>
                      setInviteForm({ ...inviteForm, name: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="role" className="text-sm font-medium">Role</Label>
                  <Select
                    value={inviteForm.role}
                    onValueChange={(value: "viewer" | "editor") =>
                      setInviteForm({ ...inviteForm, role: value })
                    }
                  >
                    <SelectTrigger className="h-10 border-gray-300 focus:outline-none focus:ring-2 focus:ring-[#4B2A06] bg-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-white border border-gray-200">
                      <SelectItem className="bg-white hover:bg-gray-50 data-[highlighted]:bg-gray-50" value="viewer">Viewer</SelectItem>
                      <SelectItem className="bg-white hover:bg-gray-50 data-[highlighted]:bg-gray-50" value="editor">Editor</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <Label className="text-base font-semibold">Directory Access *</Label>
                      <p className="text-xs text-gray-600 mt-1.5">
                        Select directories to grant access. <strong className="font-semibold">Only selected directories</strong> will be accessible to the invited user. Documents within these directories will be accessible.
                      </p>
                    </div>
                    <div className="flex-shrink-0">
                      <Label className="text-xs text-gray-600 mb-1 block">Access Level</Label>
                      <Select 
                        value={inviteForm.directoryRole} 
                        onValueChange={(value: "viewer" | "editor") =>
                          setInviteForm({ ...inviteForm, directoryRole: value })
                        }
                      >
                        <SelectTrigger className="w-28 h-9 bg-white border-gray-300">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-white border border-gray-200">
                          <SelectItem value="viewer">Viewer</SelectItem>
                          <SelectItem value="editor">Editor</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-gray-700">
                        Available Directories ({directories.length})
                      </span>
                      {directories.length > 5 && (
                        <button
                          type="button"
                          onClick={() => {
                            setShowDirSearch(!showDirSearch);
                            if (showDirSearch) setDirSearch("");
                          }}
                          className="text-xs text-blue-600 hover:text-blue-800 underline"
                        >
                          {showDirSearch ? "Hide Search" : "Show Search"}
                        </button>
                      )}
                    </div>
                    {showDirSearch && (
                      <Input
                        placeholder="Search directories..."
                        value={dirSearch}
                        onChange={(e) => setDirSearch(e.target.value)}
                        className="h-8 bg-white"
                      />
                    )}
                    <div className="border border-gray-300 rounded-md bg-white max-h-64 overflow-y-auto shadow-sm">
                      {dirLoading ? (
                        <div className="text-sm text-gray-500 p-4 text-center">Loading directories...</div>
                      ) : directories.length === 0 ? (
                        <div className="text-sm text-gray-500 p-4 text-center">No directories available</div>
                      ) : (
                        (directories || [])
                          .filter((d: any) =>
                            dirSearch ? (d.name || "").toLowerCase().includes(dirSearch.toLowerCase()) : true
                          )
                          .map((d: any) => {
                            const checked = inviteForm.selectedDirectories.some((s) => s.id === d.id);
                            return (
                              <label 
                                key={d.id} 
                                className={`flex items-center gap-3 text-sm px-4 py-2.5 border-b border-gray-200 last:border-b-0 hover:bg-gray-50 cursor-pointer transition-colors ${
                                  checked ? 'bg-blue-50' : ''
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      setInviteForm({
                                        ...inviteForm,
                                        selectedDirectories: [...inviteForm.selectedDirectories, { id: d.id, name: d.name }]
                                      });
                                    } else {
                                      setInviteForm({
                                        ...inviteForm,
                                        selectedDirectories: inviteForm.selectedDirectories.filter((x) => x.id !== d.id)
                                      });
                                    }
                                  }}
                                  className="w-4 h-4 cursor-pointer accent-[#4B2A06]"
                                />
                                <span className={`truncate flex-1 ${checked ? 'font-semibold text-[#4B2A06]' : 'font-medium text-gray-700'}`}>
                                  {d.name}
                                </span>
                                {checked && (
                                  <span className="text-xs text-green-600 font-semibold bg-green-100 px-2 py-0.5 rounded">Selected</span>
                                )}
                              </label>
                            );
                          })
                      )}
                    </div>
                    {inviteForm.selectedDirectories.length === 0 && (
                      <div className="flex items-start gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-300 p-3 rounded-md">
                        <span className="text-amber-600 font-bold text-base leading-none">▲</span>
                        <span className="flex-1 font-medium">Please select at least one directory to grant access.</span>
                      </div>
                    )}
                    {inviteForm.selectedDirectories.length > 0 && (
                      <div className="text-sm text-gray-700 bg-green-50 border border-green-200 p-3 rounded-md">
                        <div className="font-semibold text-green-900 mb-2 flex items-center gap-2">
                          <span className="text-green-600">✓</span>
                          <span>{inviteForm.selectedDirectories.length} director{inviteForm.selectedDirectories.length > 1 ? 'ies' : 'y'} selected</span>
                        </div>
                        <div className="text-green-800 max-h-24 overflow-y-auto space-y-1 mb-2">
                          {inviteForm.selectedDirectories.map((d, idx) => (
                            <div key={d.id} className="flex items-center gap-2">
                              <span className="text-green-600 font-bold">•</span>
                              <span className="truncate">{d.name}</span>
                            </div>
                          ))}
                        </div>
                        <div className="text-green-700 mt-2 pt-2 border-t border-green-200 font-medium text-xs">
                          Only these directories will be accessible to the invited user.
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="message" className="text-sm font-medium">Message (Optional)</Label>
                  <Textarea
                    id="message"
                    placeholder="Welcome to our workspace..."
                    value={inviteForm.message}
                    className="border-gray-300 focus:outline-none focus:ring-2 focus:ring-[#4B2A06] bg-white resize-none"
                    onChange={(e) =>
                      setInviteForm({ ...inviteForm, message: e.target.value })
                    }
                    rows={3}
                  />
                </div>
                <div className="flex justify-end gap-3 pt-2 border-t border-gray-200">
                  <Button
                    variant="outline"
                    onClick={() => {
                      // Reset form when canceling
                      setInviteForm({
                        email: "",
                        name: "",
                        role: "viewer",
                        message: "",
                        allowedTimeBuckets: ["all"],
                        selectedDirectories: [],
                        directoryRole: "viewer",
                      });
                      setDirSearch("");
                      setShowDirSearch(false);
                      setIsSendDialogOpen(false);
                    }}
                    className="h-10 px-6 bg-white text-[#4B2A06] hover:bg-gray-50 border-gray-300 hover:border-gray-400"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleSendInvitation}
                    disabled={actionLoading === "send" || inviteForm.selectedDirectories.length === 0}
                    className="h-10 px-6 bg-[#4B2A06] text-white hover:bg-[#3A2004] disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {actionLoading === "send" && (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    )}
                    Send Invitation
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
        <p className="text-sm text-gray-600 mb-3">
          Manage workspace invitations and user access
        </p>

        {/* Search and Filter Controls */}
        <div className="flex gap-2 mb-3">
          <div className="flex-1">
            <Input
              placeholder="Search by email or inviter name..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="h-8 bg-white border-none focus:outline-none focus:ring-0"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-32 h-8 bg-white border-none focus:outline-none focus:ring-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-white border border-gray-200">
              <SelectItem className="bg-white hover:bg-gray-50 data-[highlighted]:bg-gray-50" value="all">All Status</SelectItem>
              <SelectItem className="bg-white hover:bg-gray-50 data-[highlighted]:bg-gray-50" value="pending">Pending</SelectItem>
              <SelectItem className="bg-white hover:bg-gray-50 data-[highlighted]:bg-gray-50" value="accepted">Accepted</SelectItem>
              <SelectItem className="bg-white hover:bg-gray-50 data-[highlighted]:bg-gray-50" value="declined">Declined</SelectItem>
              <SelectItem className="bg-white hover:bg-gray-50 data-[highlighted]:bg-gray-50" value="cancelled">Cancelled</SelectItem>
              <SelectItem className="bg-white hover:bg-gray-50 data-[highlighted]:bg-gray-50" value="expired">Expired</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Content Area - Scrollable when no pagination, Fixed height when pagination */}
      <div
        className={`flex-1 ${
          filteredInvitations.length <= itemsPerPage ? "overflow-y-auto" : ""
        }`}
      >
        <div className="p-4">
          {loading ? (
            <div className="flex justify-center items-center h-20">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : filteredInvitations.length === 0 ? (
            <div className="text-center text-gray-500 py-8">
              <Mail className="h-12 w-12 mx-auto mb-2 text-gray-300" />
              <p key="message">
                {invitations.length === 0
                  ? "No invitations yet"
                  : "No invitations match your search"}
              </p>
              <p key="submessage" className="text-sm">
                {invitations.length === 0
                  ? "Send your first invitation to get started"
                  : "Try adjusting your search or filter"}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {currentInvitations.map((invitation) => (
                <div
                  key={invitation.id}
                  className="border border-gray-200 rounded-lg p-3 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h4 className="font-medium text-sm truncate">
                          {invitation.inviteeEmail}
                        </h4>
                        {getStatusIcon(invitation.status)}
                      </div>
                      <div className="flex items-center gap-2 mb-2">
                        <Badge
                          key={`status-badge-${invitation.id}`}
                          variant="secondary"
                          className={`text-xs ${getStatusColor(
                            invitation.status
                          )}`}
                        >
                          {invitation.status}
                        </Badge>
                        <Badge key={`role-badge-${invitation.id}`} variant="outline" className="text-xs">
                          {invitation.invitedRole}
                        </Badge>
                      </div>
                      <div className="text-xs text-gray-500 space-y-1">
                        <div key={`date-${invitation.id}`} className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          Sent: {formatDate(invitation.createdAt)}
                        </div>
                        <div key={`role-${invitation.id}`} className="flex items-center gap-1">
                          <Shield className="h-3 w-3" />
                          Role: {invitation.invitedRole}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {invitation.status === "accepted" && (
                        <PerUserAccessEditor key={`editor-${invitation.id}`} invite={invitation} />
                      )}
                      <DropdownMenu>
                        
                        <DropdownMenuContent align="end">
                          {invitation.status === "pending" && (
                            <DropdownMenuItem
                              key={`cancel-${invitation.id}`}
                              onClick={() =>
                                handleCancelInvitation(invitation.invitationId)
                              }
                              className="text-yellow-600"
                            >
                              <XCircle className="mr-2 h-4 w-4" />
                              Cancel
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem
                            key={`delete-${invitation.id}`}
                            onClick={() =>
                              handleDeleteInvitation(invitation.invitationId)
                            }
                            className="text-red-600"
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Pagination Controls - Only show when needed */}
      {filteredInvitations.length > itemsPerPage && (
        <div className="p-4 border-t bg-gray-50 flex-shrink-0">
          <div className="flex items-center justify-between">
            <div className="text-sm text-gray-600">
              Showing {startIndex + 1}-
              {Math.min(endIndex, filteredInvitations.length)} of{" "}
              {filteredInvitations.length} invitations
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handlePageChange(currentPage - 1)}
                disabled={currentPage === 1}
              >
                Previous
              </Button>
              <div className="flex items-center gap-1">
                {Array.from({ length: totalPages }, (_, i) => i + 1).map(
                  (page) => (
                    <Button
                      key={page}
                      variant={currentPage === page ? "default" : "outline"}
                      size="sm"
                      onClick={() => handlePageChange(page)}
                      className="w-8 h-8 p-0"
                    >
                      {page}
                    </Button>
                  )
                )}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handlePageChange(currentPage + 1)}
                disabled={currentPage === totalPages}
              >
                Next
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// PerUserAccessEditor component for updating user access
function PerUserAccessEditor({ invite }: { invite: WorkspaceInvitation }) {
  const [saving, setSaving] = useState(false);
  const [bucket, setBucket] = useState<
    "today" | "last7" | "last15" | "last30" | "last90" | "all"
  >("today");
  const [dirRole, setDirRole] = useState<"viewer" | "editor">("viewer");
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [sharesLoading, setSharesLoading] = useState(false);
  const [shares, setShares] = useState<any[]>([]);
  const [directories, setDirectories] = useState<any[]>([]);
  const [dirLoading, setDirLoading] = useState(false);
  const [dirSearch, setDirSearch] = useState("");
  const [selectedDirs, setSelectedDirs] = useState<any[]>([]);
  const [granting, setGranting] = useState(false);
  const [grantedDirectories, setGrantedDirectories] = useState<any[]>([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  useEffect(() => {
    if (isDialogOpen) {
      const loadRootDirs = async () => {
        try {
          setDirLoading(true);
          console.log("Loading directories in PerUserAccessEditor...");
          const res = await directoryService.listChildren("root", {
            pageSize: 200,
            sort: "name",
            order: "asc",
          });
          console.log("Directories response in PerUserAccessEditor:", res);
          
          // Extract only directories from the response
          const allItems = res?.items || [];
          const dirs = allItems
            .filter((item: any) => item.kind === "directory")
            .map((item: any) => item.item);
          
          setDirectories(dirs);
          console.log("Set directories in PerUserAccessEditor:", dirs);
        } catch (error) {
          console.error("Error loading directories in PerUserAccessEditor:", error);
          setDirectories([]);
        } finally {
          setDirLoading(false);
        }
      };
      loadRootDirs();
      loadGrantedDirectories();
    }
  }, [isDialogOpen]);

  const loadGrantedDirectories = async () => {
    try {
      // Get all directories this user has access to using the new service
      const data = await workspaceInvitationService.getUserDirectories(invite.inviteeEmail);
      setGrantedDirectories(data.directories);
    } catch (error) {
      console.error("Error loading granted directories:", error);
      setGrantedDirectories([]);
    }
  };

  const update = async () => {
    try {
      setSaving(true);
      await workspaceInvitationService.updateUserBuckets(invite.inviteeEmail, [
        bucket,
      ]);
      toast.success("Access window updated");
    } catch (e: any) {
      toast.error(e.response?.data?.message || "Failed to update");
    } finally {
      setSaving(false);
    }
  };

  const grantDirAccess = async () => {
    if (selectedDirs.length === 0) {
      toast.error("Select at least one directory");
      return;
    }
    try {
      setGranting(true);
      const directoryIds = selectedDirs.map(d => d.id);
      const result = await workspaceInvitationService.grantDirectoryAccess(
        invite.inviteeEmail,
        directoryIds,
          dirRole
        );
      toast.success(`Access granted to ${result.granted.length} director${result.granted.length > 1 ? "ies" : "y"}`);
      if (result.errors && result.errors.length > 0) {
        toast.error(`Some errors: ${result.errors.join(", ")}`);
      }
      setSelectedDirs([]);
      await loadGrantedDirectories();
      // Reload directories list to refresh available directories
      const res = await directoryService.listChildren("root", {
        pageSize: 200,
        sort: "name",
        order: "asc",
      });
      const allItems = res?.items || [];
      const dirs = allItems
        .filter((item: any) => item.kind === "directory")
        .map((item: any) => item.item);
      setDirectories(dirs);
    } catch (e: any) {
      toast.error(e.response?.data?.message || "Failed to grant access");
    } finally {
      setGranting(false);
    }
  };

  const revoke = async (directoryId: string) => {
    try {
      await workspaceInvitationService.revokeDirectoryAccess(invite.inviteeEmail, directoryId);
      toast.success("Access revoked");
      await loadGrantedDirectories();
      // Reload directories list to show the revoked directory in available list
      const res = await directoryService.listChildren("root", {
        pageSize: 200,
        sort: "name",
        order: "asc",
      });
      const allItems = res?.items || [];
      const dirs = allItems
        .filter((item: any) => item.kind === "directory")
        .map((item: any) => item.item);
      setDirectories(dirs);
    } catch (e: any) {
      toast.error(e.response?.data?.message || "Failed to revoke");
    }
  };

  return (
    <div className="flex items-center gap-2 ">
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm" className="h-8 px-3 bg-white hover:bg-white border-gray-300">Update Access</Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-lg bg-gray-50 text-[#4B2A06]" hideClose>
          <DialogHeader>
            <DialogTitle>Update Access for {invite.inviteeEmail}</DialogTitle>
            <DialogDescription>Manage time bucket permissions and directory access for this user</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Select value={bucket} onValueChange={(v: any) => setBucket(v)}>
                <SelectTrigger className="w-[180px] h-8 bg-white border-gray-300">
                  <SelectValue placeholder="Today" />
                </SelectTrigger>
                <SelectContent className="bg-white border border-gray-200">
                  <SelectItem value="today">Today</SelectItem>
                  <SelectItem value="last7">Last 7 days</SelectItem>
                  <SelectItem value="last15">Last 15 days</SelectItem>
                  <SelectItem value="last30">Last 30 days</SelectItem>
                  <SelectItem value="last90">Last 3 months</SelectItem>
                  <SelectItem value="all">All</SelectItem>
                </SelectContent>
              </Select>
              <Button onClick={async () => { await update(); setIsDialogOpen(false); }} disabled={saving} className="h-8 px-3 bg-[#4B2A06] text-white hover:bg-[#3A2004]">
                {saving ? "Saving..." : "Update"}
              </Button>
            </div>

            <div className="text-sm font-medium text-gray-700">Directory Access Management</div>
            
            {/* Grant new directory access */}
            <div className="space-y-2">
              <div className="text-xs font-medium text-gray-600">
                Grant Directory Access ({directories.filter((d: any) => !grantedDirectories.some((gd: any) => gd.directoryId === d.id)).length} available)
              </div>
              <div className="flex gap-2">
                <Input
                  placeholder="Search directories..."
                  value={dirSearch}
                  onChange={(e) => setDirSearch(e.target.value)}
                  className="h-8 bg-white"
                />
                <Select 
                  value={dirRole} 
                  onValueChange={(v: any) => setDirRole(v)}
                >
                  <SelectTrigger className="w-28 h-8 bg-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-white border border-gray-200">
                    <SelectItem value="viewer">Viewer</SelectItem>
                    <SelectItem value="editor">Editor</SelectItem>
                  </SelectContent>
                </Select>
                <Button size="sm" onClick={grantDirAccess} disabled={granting || selectedDirs.length === 0} className="h-8 px-3 bg-[#4B2A06] text-white hover:bg-[#3A2004]">
                  {granting ? "Granting..." : "Grant Access"}
                </Button>
              </div>
              <div className="max-h-32 overflow-y-auto border rounded bg-white">
                {dirLoading ? (
                  <div className="text-xs text-gray-500 p-2">Loading directories...</div>
            ) : (
                  (directories || [])
                    .filter((d: any) => {
                      // Filter by search term
                      const matchesSearch = dirSearch ? (d.name || "").toLowerCase().includes(dirSearch.toLowerCase()) : true;
                      // Filter out already granted directories
                      const isGranted = grantedDirectories.some((gd: any) => gd.directoryId === d.id);
                      return matchesSearch && !isGranted;
                    })
                    .map((d: any) => {
                      const checked = selectedDirs.some((s) => s.id === d.id);
                      return (
                        <label key={d.id} className="flex items-center gap-2 text-sm px-2 py-1 border-b last:border-b-0 hover:bg-gray-50">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedDirs((prev) => [...prev, { id: d.id, name: d.name }]);
                              } else {
                                setSelectedDirs((prev) => prev.filter((x) => x.id !== d.id));
                              }
                            }}
                          />
                          <span className="truncate">{d.name}</span>
                        </label>
                      );
                    })
                )}
              </div>
            </div>

            {/* Currently granted directories */}
            <div className="space-y-2">
              <div className="text-xs font-medium text-gray-600">Current Directory Access ({grantedDirectories.length} granted)</div>
              <div className="max-h-48 overflow-y-auto space-y-2">
                {grantedDirectories.length === 0 ? (
                  <div className="text-xs text-gray-500">No directories shared to this user.</div>
                ) : (
                  grantedDirectories.map((dir) => (
                    <div key={dir.directoryId} className="flex items-center justify-between px-3 py-2 bg-white border border-gray-200 rounded">
                      <div className="truncate pr-3">
                        <div className="text-sm font-medium text-gray-800 truncate">{dir.directoryName}</div>
                        <div className="text-xs text-gray-500">Role: {dir.role}</div>
                      </div>
                      <Button size="sm" variant="destructive" className="h-7 px-3" onClick={async () => { await revoke(dir.directoryId); }}>
                        Remove Access
                      </Button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <Button
        variant="destructive"
        size="sm"
        className="h-8 px-3"
        onClick={async () => {
          try {
            await workspaceInvitationService.revokeUserAccess(invite.invitationId);
            toast.success("Invitee removed and all access revoked");
          } catch (e: any) {
            toast.error(e.response?.data?.message || "Failed to remove invitee");
          }
        }}
      >
        Delete Invitee
      </Button>
    </div>
  );
}
