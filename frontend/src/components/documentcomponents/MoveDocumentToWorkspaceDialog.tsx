import React, { useEffect, useState } from "react";
import { workspaceService } from "@/services/workspaceService";
import { toast } from "sonner";
import { Building2, Loader2, X } from "lucide-react";

export interface MoveDocumentToWorkspaceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  documentId: string;
  documentName: string;
  onMoveComplete?: () => void;
}

export const MoveDocumentToWorkspaceDialog: React.FC<
  MoveDocumentToWorkspaceDialogProps
> = ({ open, onOpenChange, documentId, documentName, onMoveComplete }) => {
  const [workspaces, setWorkspaces] = useState<
    Array<{
      workspaceId: string;
      name: string;
      slug: string;
    }>
  >([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>("");
  const [currentWorkspaceId, setCurrentWorkspaceId] = useState<string>("");

  useEffect(() => {
    if (open) {
      loadWorkspaces();
      loadCurrentWorkspace();
    }
  }, [open]);

  const loadWorkspaces = async () => {
    try {
      setLoading(true);
      const result = await workspaceService.listWorkspaces();
      setWorkspaces(result.workspaces || []);
    } catch (error: any) {
      toast.error("Failed to load workspaces");
      console.error("Error loading workspaces:", error);
    } finally {
      setLoading(false);
    }
  };

  const loadCurrentWorkspace = () => {
    const stored = localStorage.getItem("currentWorkspace");
    if (stored) {
      setCurrentWorkspaceId(stored);
    }
  };

  const handleMove = async () => {
    if (!selectedWorkspaceId || !documentId) {
      toast.error("Please select a workspace");
      return;
    }

    if (selectedWorkspaceId === currentWorkspaceId) {
      toast.error("Document is already in this workspace");
      return;
    }

    try {
      setSubmitting(true);
      const token = localStorage.getItem("accessToken");
      const response = await fetch(
        `${import.meta.env.VITE_API_URL}/workspaces/${currentWorkspaceId}/move-document`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            "x-workspace": currentWorkspaceId,
          },
          body: JSON.stringify({
            documentId,
            targetWorkspaceId: selectedWorkspaceId,
          }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || "Failed to move document");
      }

      toast.success("Document moved successfully");
      onOpenChange(false);
      onMoveComplete?.();
    } catch (error: any) {
      console.error("Error moving document:", error);
      toast.error(error.message || "Failed to move document");
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-30">
      <div className="bg-white rounded-lg shadow-lg w-full max-w-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-[#4B2A06]" />
            <h3 className="text-lg font-semibold">Move Document to Workspace</h3>
          </div>
          <button
            className="text-gray-500 hover:text-gray-700"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mb-4">
          <p className="text-sm text-gray-600 mb-2">
            Moving: <span className="font-medium">{documentName}</span>
          </p>
          <p className="text-xs text-gray-500">
            Select a workspace to move this document to. The document and its folder will be moved.
          </p>
        </div>

        <div className="border rounded-md max-h-72 overflow-y-auto mb-4">
          {loading ? (
            <div className="flex items-center justify-center py-10 text-gray-500">
              <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading workspaces...
            </div>
          ) : workspaces.length === 0 ? (
            <div className="p-4 text-sm text-gray-500">No workspaces available.</div>
          ) : (
            <ul>
              {workspaces.map((ws) => (
                <li
                  key={ws.workspaceId}
                  className={`flex items-center gap-2 px-3 py-2 border-b last:border-b-0 cursor-pointer ${
                    selectedWorkspaceId === ws.workspaceId
                      ? "bg-[#ECE9E2]"
                      : "hover:bg-gray-50"
                  } ${
                    ws.workspaceId === currentWorkspaceId ? "opacity-50" : ""
                  }`}
                  onClick={() => {
                    if (ws.workspaceId !== currentWorkspaceId) {
                      setSelectedWorkspaceId(ws.workspaceId);
                    }
                  }}
                >
                  <input
                    type="radio"
                    name="target-workspace"
                    checked={selectedWorkspaceId === ws.workspaceId}
                    onChange={() => {
                      if (ws.workspaceId !== currentWorkspaceId) {
                        setSelectedWorkspaceId(ws.workspaceId);
                      }
                    }}
                    disabled={ws.workspaceId === currentWorkspaceId}
                    className="h-4 w-4 accent-[#4B2A06]"
                  />
                  <Building2 className="h-4 w-4 text-[#4B2A06]" />
                  <span className="truncate">
                    {ws.name}
                    {ws.workspaceId === currentWorkspaceId && " (Current)"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-end gap-2">
          <button
            className="px-4 py-2 rounded bg-gray-200 hover:bg-gray-300 text-sm"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            className="px-4 py-2 rounded bg-[#4B2A06] text-white text-sm hover:bg-[#3A2004] disabled:opacity-50"
            onClick={handleMove}
            disabled={submitting || !selectedWorkspaceId}
          >
            {submitting ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Moving...
              </span>
            ) : (
              "Move Document"
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default MoveDocumentToWorkspaceDialog;





