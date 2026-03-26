import React, { useState, useEffect } from "react";
import { Building2, Check, X, Clock, User as UserIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { workspaceService } from "@/services/workspaceService";
import { toast } from "sonner";
import axios from "axios";

interface WorkspaceRequest {
  _id: string;
  userId: {
    _id: string;
    email: string;
    name: string;
  };
  workspaceId: string;
  workspace: {
    workspaceId: string;
    name: string;
  } | null;
  status: "pending" | "approved" | "rejected";
  requestedAt: string;
  reviewedAt?: string;
  rejectionReason?: string;
  message?: string;
}

interface WorkspaceRequestsManagerProps {
  workspaceId: string;
  workspaceName: string;
}

export function WorkspaceRequestsManager({
  workspaceId,
  workspaceName,
}: WorkspaceRequestsManagerProps) {
  const [requests, setRequests] = useState<WorkspaceRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState<string | null>(null);

  useEffect(() => {
    loadRequests();
  }, [workspaceId]);

  const loadRequests = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem("accessToken");
      const res = await axios.get(
        `${import.meta.env.VITE_API_URL}/workspace-requests/workspace/${workspaceId}/pending`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      setRequests(res.data.requests || []);
    } catch (error: any) {
      console.error("Error loading requests:", error);
      if (error.response?.status !== 403) {
        toast.error("Failed to load workspace requests");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleReview = async (requestId: string, action: "approve" | "reject") => {
    try {
      setProcessing(requestId);
      const token = localStorage.getItem("accessToken");
      await axios.post(
        `${import.meta.env.VITE_API_URL}/workspace-requests/${requestId}/review`,
        { action },
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      toast.success(
        action === "approve" ? "Workspace access approved" : "Workspace access rejected"
      );
      await loadRequests();
    } catch (error: any) {
      console.error("Error reviewing request:", error);
      toast.error(error.response?.data?.message || "Failed to review request");
    } finally {
      setProcessing(null);
    }
  };

  if (loading) {
    return <div className="text-sm text-gray-500 py-4">Loading requests...</div>;
  }

  if (requests.length === 0) {
    return (
      <div className="text-sm text-gray-500 py-4">No pending requests for this workspace.</div>
    );
  }

  return (
    <div className="space-y-3">
      <h4 className="text-sm font-semibold text-gray-700">Pending Requests for {workspaceName}</h4>
      {requests.map((req) => (
        <div
          key={req._id}
          className="p-3 border border-gray-200 rounded-md bg-white"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <UserIcon className="h-4 w-4 text-gray-500" />
                <span className="text-sm font-medium text-gray-900">
                  {req.userId.name || req.userId.email}
                </span>
              </div>
              <p className="text-xs text-gray-600 mb-1">{req.userId.email}</p>
              {req.message && (
                <p className="text-xs text-gray-500 mt-1 italic">"{req.message}"</p>
              )}
              <div className="flex items-center gap-2 mt-2">
                <Badge variant="outline" className="text-xs">
                  <Clock className="h-3 w-3 mr-1" />
                  Requested {new Date(req.requestedAt).toLocaleDateString()}
                </Badge>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <Button
                size="sm"
                onClick={() => handleReview(req._id, "approve")}
                disabled={processing === req._id}
                className="bg-green-600 hover:bg-green-700 text-white text-xs px-3 py-1 h-7"
              >
                {processing === req._id ? (
                  "Processing..."
                ) : (
                  <>
                    <Check className="h-3 w-3 mr-1" />
                    Approve
                  </>
                )}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleReview(req._id, "reject")}
                disabled={processing === req._id}
                className="text-red-600 border-red-300 hover:bg-red-50 text-xs px-3 py-1 h-7"
              >
                <X className="h-3 w-3 mr-1" />
                Reject
              </Button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}





