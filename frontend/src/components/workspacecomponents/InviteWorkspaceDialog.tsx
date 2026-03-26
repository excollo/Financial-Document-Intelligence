import React, { useState, useEffect } from "react";
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
} from "@/components/ui/dialog";
import { Mail, Loader2 } from "lucide-react";
import {
  workspaceInvitationService,
  SendInvitationData,
} from "@/services/workspaceInvitationService";
import { directoryService } from "@/services/api";

interface InviteWorkspaceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  workspaceName: string;
  onInviteSent?: () => void;
}

export function InviteWorkspaceDialog({
  open,
  onOpenChange,
  workspaceId,
  workspaceName,
  onInviteSent,
}: InviteWorkspaceDialogProps) {
  const [loading, setLoading] = useState(false);
  const [directories, setDirectories] = useState<any[]>([]);
  const [dirLoading, setDirLoading] = useState(false);
  const [dirSearch, setDirSearch] = useState("");
  const [selectedDirectories, setSelectedDirectories] = useState<any[]>([]);

  const [formData, setFormData] = useState<SendInvitationData>({
    inviteeEmail: "",
    inviteeName: "",
    invitedRole: "viewer",
    message: "",
    allowedTimeBuckets: ["all"],
    grantedDirectories: [],
  });

  useEffect(() => {
    if (open) {
      loadDirectories();
    }
  }, [open]);

  const loadDirectories = async () => {
    try {
      setDirLoading(true);
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
    } catch (error) {
      console.error("Error loading directories:", error);
      toast.error("Failed to load directories");
    } finally {
      setDirLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.inviteeEmail || !formData.inviteeName) {
      toast.error("Email and name are required");
      return;
    }

    if (selectedDirectories.length === 0) {
      toast.error("Please select at least one directory");
      return;
    }

    try {
      setLoading(true);
      await workspaceInvitationService.sendInvitation({
        ...formData,
        grantedDirectories: selectedDirectories.map((dir) => ({
          directoryId: dir.id,
          role: "viewer", // Default role, can be customized
        })),
      });

      toast.success(`Invitation sent to ${formData.inviteeEmail}`);
      onOpenChange(false);
      
      // Reset form
      setFormData({
        inviteeEmail: "",
        inviteeName: "",
        invitedRole: "viewer",
        message: "",
        allowedTimeBuckets: ["all"],
        grantedDirectories: [],
      });
      setSelectedDirectories([]);
      setDirSearch("");
      
      onInviteSent?.();
    } catch (error: any) {
      console.error("Error sending invitation:", error);
      toast.error(
        error.response?.data?.message || "Failed to send invitation"
      );
    } finally {
      setLoading(false);
    }
  };

  const filteredDirectories = directories.filter((dir) =>
    dir.name.toLowerCase().includes(dirSearch.toLowerCase())
  );

  const toggleDirectory = (directory: any) => {
    setSelectedDirectories((prev) => {
      const exists = prev.find((d) => d.id === directory.id);
      if (exists) {
        return prev.filter((d) => d.id !== directory.id);
      } else {
        return [...prev, directory];
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-gray-50 text-[#4B2A06]" hideClose>
        <DialogHeader>
          <DialogTitle>Invite to {workspaceName}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="email">Email *</Label>
            <Input
              id="email"
              type="email"
              placeholder="user@example.com"
              value={formData.inviteeEmail}
              onChange={(e) =>
                setFormData({ ...formData, inviteeEmail: e.target.value })
              }
              className="border-none focus:outline-none focus:ring-0 bg-white"
              required
            />
          </div>

          <div>
            <Label htmlFor="name">Name *</Label>
            <Input
              id="name"
              type="text"
              placeholder="Full Name"
              value={formData.inviteeName}
              onChange={(e) =>
                setFormData({ ...formData, inviteeName: e.target.value })
              }
              className="border-none focus:outline-none focus:ring-0 bg-white"
              required
            />
          </div>

          <div>
            <Label htmlFor="role">Role</Label>
            <Select
              value={formData.invitedRole}
              onValueChange={(value: "viewer" | "editor") =>
                setFormData({ ...formData, invitedRole: value })
              }
            >
              <SelectTrigger className="border-none focus:outline-none focus:ring-0 bg-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-white border border-gray-200">
                <SelectItem className="bg-white hover:bg-gray-50 data-[highlighted]:bg-gray-50" value="viewer">Viewer</SelectItem>
                <SelectItem className="bg-white hover:bg-gray-50 data-[highlighted]:bg-gray-50" value="editor">Editor</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="message">Message (Optional)</Label>
            <Textarea
              id="message"
              placeholder="Welcome to our workspace..."
              value={formData.message}
              onChange={(e) =>
                setFormData({ ...formData, message: e.target.value })
              }
              className="border-none focus:outline-none focus:ring-0 bg-white"
              rows={3}
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <div>
                <Label>Directory Access *</Label>
                <p className="text-xs text-gray-500 mt-1">Select directories to grant access. Documents within these directories will be accessible to the invited user.</p>
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-700">
                  Available Directories ({directories.length})
                </span>
              </div>
              <Input
                placeholder="Search directories..."
                value={dirSearch}
                onChange={(e) => setDirSearch(e.target.value)}
                className="h-8 bg-white"
              />
              <div className="border rounded bg-white max-h-64 overflow-y-auto">
                {dirLoading ? (
                  <div className="text-xs text-gray-500 p-4 text-center">Loading directories...</div>
                ) : filteredDirectories.length === 0 ? (
                  <div className="text-xs text-gray-500 p-4 text-center">No directories available</div>
                ) : (
                  filteredDirectories.map((dir) => {
                    const isSelected = selectedDirectories.some(
                      (d) => d.id === dir.id
                    );
                    return (
                      <label 
                        key={dir.id} 
                        className="flex items-center gap-3 text-sm px-4 py-3 border-b last:border-b-0 hover:bg-gray-50 cursor-pointer transition-colors"
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleDirectory(dir)}
                          className="w-4 h-4 cursor-pointer"
                        />
                        <span className="truncate flex-1 font-medium">{dir.name}</span>
                        {isSelected && (
                          <span className="text-xs text-green-600 font-medium">Selected</span>
                        )}
                      </label>
                    );
                  })
                )}
              </div>
              {selectedDirectories.length > 0 && (
                <div className="text-xs text-gray-600 bg-blue-50 p-2 rounded">
                  <strong>{selectedDirectories.length}</strong> director{selectedDirectories.length > 1 ? 'ies' : 'y'} selected: {selectedDirectories.map(d => d.name).join(", ")}
                </div>
              )}
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={loading}
              className="bg-gray-200 text-[#4B2A06] hover:bg-gray-200 border-none hover:text-[#4B2A06]"
            >
              Cancel
            </Button>
            <Button 
              type="submit" 
              disabled={loading}
              className="bg-[#4B2A06] text-white hover:bg-[#4B2A06] hover:text-white"
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <Mail className="mr-2 h-4 w-4" />
                  Send Invitation
                </>
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}


