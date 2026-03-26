import React, { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { workspaceInvitationService } from "@/services/workspaceInvitationService";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Building2,
  User,
  Mail,
  Calendar,
  MessageSquare,
  CheckCircle,
  XCircle,
} from "lucide-react";

interface InvitationDetails {
  id: string;
  invitationId: string;
  inviterName: string;
  inviterEmail: string;
  workspaceName: string;
  status: string;
  workspaceDomain: string;
  invitedRole: string;
  message?: string;
  expiresAt: string;
}

export default function InvitationPage() {
  const { invitationId } = useParams<{ invitationId: string }>();
  const navigate = useNavigate();
  const { user, login } = useAuth();
  const [invitation, setInvitation] = useState<InvitationDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (invitationId) {
      loadInvitation();
    }
  }, [invitationId]);

  const loadInvitation = async () => {
    try {
      setLoading(true);
      const data = await workspaceInvitationService.getInvitationDetails(
        invitationId!
      );
      setInvitation(data.invitation);
    } catch (error: any) {
      console.error("Error loading invitation:", error);
      setError(error.response?.data?.message || "Failed to load invitation");
    } finally {
      setLoading(false);
    }
  };

  const handleAcceptInvitation = async () => {
    if (!user) {
      // If not authenticated, send to login (not forced register) preserving invitation
      navigate(`/login?invitation=${invitationId}`);
      return;
    }

    // Check if invitation is already accepted before making the request
    if (invitation?.status === "accepted") {
      toast.info("This invitation has already been accepted");
      navigate("/dashboard");
      return;
    }

    try {
      setProcessing(true);
      const result = await workspaceInvitationService.acceptInvitation(
        invitationId!
      );

      // Automatically switch to the invited workspace
      if (result.workspace?.workspaceId) {
        await workspaceInvitationService.switchWorkspace(
          result.workspace.workspaceId
        );
        // Refresh the page to ensure documents are loaded with correct permissions
        window.location.href = "/dashboard";
        return;
      }

      toast.success("Invitation accepted successfully!");
      navigate("/dashboard");
    } catch (error: any) {
      console.error("Error accepting invitation:", error);
      const status = error?.response?.status;
      const invitedEmail = error?.response?.data?.invitedEmail;
      const errorMessage = error?.response?.data?.message;
      
      if (status === 400 && errorMessage?.includes("already been accepted")) {
        // Invitation already accepted - reload the invitation to get updated status
        toast.info("This invitation has already been accepted");
        await loadInvitation(); // Reload to show accepted status
        return;
      }
      
      if (status === 400 && error?.response?.data?.alreadyAccepted) {
        // User already has access
        toast.info("You already have access to this workspace");
        navigate("/dashboard");
        return;
      }
      
      if (status === 403 && invitedEmail) {
        toast.error(
          `Please sign in as ${invitedEmail} to accept this invitation.`
        );
        // Offer redirect to login preserving invitation id
        navigate(`/login?invitation=${invitationId}`);
      } else {
        toast.error(errorMessage || "Failed to accept invitation");
      }
    } finally {
      setProcessing(false);
    }
  };

  const handleDeclineInvitation = async () => {
    if (!user) {
      navigate("/");
      return;
    }

    try {
      setProcessing(true);
      await workspaceInvitationService.declineInvitation(invitationId!);
      toast.success("Invitation declined");
      navigate("/dashboard");
    } catch (error: any) {
      console.error("Error declining invitation:", error);
      toast.error(
        error.response?.data?.message || "Failed to decline invitation"
      );
    } finally {
      setProcessing(false);
    }
  };

  const isExpired = (expiresAt: string) => {
    return new Date(expiresAt) < new Date();
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#4B2A06] mx-auto mb-4"></div>
          <p className="text-gray-600">Loading invitation...</p>
        </div>
      </div>
    );
  }

  if (error || !invitation) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6">
            <div className="text-center">
              <XCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
              <h2 className="text-xl font-semibold mb-2">
                Invitation Not Found
              </h2>
              <p className="text-gray-600 mb-4">
                {error || "This invitation may have expired or been cancelled."}
              </p>
              <Button onClick={() => navigate("/")} variant="outline">
                Go Home
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const expired = isExpired(invitation.expiresAt);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4">
      <Card className="w-full max-w-2xl">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 p-3 bg-[#4B2A06] rounded-full w-fit">
            <Building2 className="h-8 w-8 text-white" />
          </div>
          <CardTitle className="text-2xl">Workspace Invitation</CardTitle>
          <p className="text-gray-600">
            You've been invited to join a workspace
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Invitation Details */}
          <div className="bg-gray-50 rounded-lg p-6 space-y-4">
            <div className="flex items-center gap-3">
              <User className="h-5 w-5 text-gray-500" />
              <div>
                <p className="font-medium">{invitation.inviterName}</p>
                <p className="text-sm text-gray-600">
                  {invitation.inviterEmail}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Building2 className="h-5 w-5 text-gray-500" />
              <div>
                <p className="font-medium">{invitation.workspaceName}</p>
                <p className="text-sm text-gray-600">
                  {invitation.workspaceDomain}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Mail className="h-5 w-5 text-gray-500" />
              <div>
                <p className="font-medium">Your Role</p>
                <Badge variant="outline" className="mt-1">
                  {invitation.invitedRole}
                </Badge>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Calendar className="h-5 w-5 text-gray-500" />
              <div>
                <p className="font-medium">Expires</p>
                <p
                  className={`text-sm ${
                    expired ? "text-red-600" : "text-gray-600"
                  }`}
                >
                  {formatDate(invitation.expiresAt)}
                  {expired && " (Expired)"}
                </p>
              </div>
            </div>

            {invitation.message && (
              <div className="flex items-start gap-3">
                <MessageSquare className="h-5 w-5 text-gray-500 mt-1" />
                <div>
                  <p className="font-medium">Message</p>
                  <p className="text-sm text-gray-600 mt-1">
                    {invitation.message}
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Actions */}
          {invitation.status === "accepted" ? (
            <div className="text-center">
              <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">Invitation Already Accepted</h3>
              <p className="text-gray-600 mb-4">
                This invitation has already been accepted. You have access to this workspace.
              </p>
              <Button onClick={() => navigate("/dashboard")} className="bg-[#4B2A06] hover:bg-[#3A2004] text-white">
                Go to Dashboard
              </Button>
            </div>
          ) : expired ? (
            <div className="text-center">
              <XCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">Invitation Expired</h3>
              <p className="text-gray-600 mb-4">
                This invitation has expired. Please contact the workspace
                administrator for a new invitation.
              </p>
              <Button onClick={() => navigate("/")} variant="outline">
                Go Home
              </Button>
            </div>
          ) : invitation.status === "declined" || invitation.status === "cancelled" ? (
            <div className="text-center">
              <XCircle className="h-12 w-12 text-gray-500 mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">
                Invitation {invitation.status === "declined" ? "Declined" : "Cancelled"}
              </h3>
              <p className="text-gray-600 mb-4">
                This invitation has been {invitation.status}.
              </p>
              <Button onClick={() => navigate("/")} variant="outline">
                Go Home
              </Button>
            </div>
          ) : (
            <div className="flex gap-4 justify-center">
              <Button
                onClick={handleDeclineInvitation}
                variant="outline"
                disabled={processing}
                className="flex items-center gap-2"
              >
                <XCircle className="h-4 w-4" />
                Decline
              </Button>
              <Button
                onClick={handleAcceptInvitation}
                disabled={processing}
                className="flex items-center gap-2 bg-[#4B2A06] hover:bg-[#3A2004] text-white"
              >
                <CheckCircle className="h-4 w-4" />
                {processing ? "Processing..." : "Accept Invitation"}
              </Button>
            </div>
          )}

          {!user && (
            <div className="text-center text-sm text-gray-600">
              <p>You'll need to log in to accept this invitation.</p>
              <p>
                Don't have an account? You can create one after clicking "Accept
                Invitation".
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
