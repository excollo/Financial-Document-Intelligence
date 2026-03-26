import React, { useState, useEffect } from "react";
import { Building2, Plus, CheckCircle, Clock, XCircle } from "lucide-react";
import { workspaceService } from "@/services/workspaceService";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

interface AvailableWorkspace {
  workspaceId: string;
  name: string;
  slug: string;
  description?: string;
  hasPendingRequest: boolean;
}

export function AvailableWorkspacesList() {
  const [workspaces, setWorkspaces] = useState<AvailableWorkspace[]>([]);
  const [loading, setLoading] = useState(false);
  const [requesting, setRequesting] = useState<string | null>(null);

  useEffect(() => {
    loadAvailableWorkspaces();
  }, []);

  const loadAvailableWorkspaces = async () => {
    try {
      setLoading(true);
      const result = await workspaceService.getAvailableWorkspaces();
      setWorkspaces(result.workspaces || []);
    } catch (error: any) {
      console.error("Error loading available workspaces:", error);
      toast.error("Failed to load available workspaces");
    } finally {
      setLoading(false);
    }
  };

  const handleRequestAccess = async (workspaceId: string, workspaceName: string) => {
    try {
      setRequesting(workspaceId);
      await workspaceService.requestWorkspaceAccess(workspaceId);
      toast.success(`Request sent for "${workspaceName}"`);
      
      // Reload to update hasPendingRequest status
      await loadAvailableWorkspaces();
    } catch (error: any) {
      console.error("Error requesting access:", error);
      toast.error(error.response?.data?.message || "Failed to request access");
    } finally {
      setRequesting(null);
    }
  };

  if (loading) {
    return (
      <div className="text-sm text-gray-500 py-4">Loading available workspaces...</div>
    );
  }

  // Don't show message when there are no available workspaces
  // This component is only shown when user has no workspaces, so we don't need this message
  if (workspaces.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-gray-700 mb-2">Available Workspaces</h3>
      {workspaces.map((ws) => (
        <div
          key={ws.workspaceId}
          className="flex items-center justify-between p-3 border border-gray-200 rounded-md hover:bg-gray-50"
        >
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <Building2 className="h-4 w-4 text-[#4B2A06] flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">{ws.name}</p>
              {ws.description && (
                <p className="text-xs text-gray-500 truncate">{ws.description}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {ws.hasPendingRequest ? (
              <div className="flex items-center gap-1 text-xs text-amber-600">
                <Clock className="h-3 w-3" />
                <span>Pending</span>
              </div>
            ) : (
              <Button
                size="sm"
                onClick={() => handleRequestAccess(ws.workspaceId, ws.name)}
                disabled={requesting === ws.workspaceId}
                className="bg-[#4B2A06] text-white hover:bg-[#3A2004] text-xs p-1"
              >
                {requesting === ws.workspaceId ? (
                  "Requesting..."
                ) : (
                  <>
                    <Plus className="h-3 w-3 mr-1" />
                    Join
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

