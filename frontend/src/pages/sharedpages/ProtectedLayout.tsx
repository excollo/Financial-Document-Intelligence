import { Navigate, Outlet, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Loader2 } from "lucide-react";
import { useState, useEffect } from "react";
import { workspaceService } from "@/services/workspaceService";
import { CreateWorkspaceModal } from "@/components/workspacecomponents/CreateWorkspaceModal";

export interface ProtectedLayoutContext {
  recentDocuments: any[];
  currentDocument: any;
  isSidebarOpen: boolean;
  setIsSidebarOpen: (isOpen: boolean) => void;
  handleDocumentSelect: (doc: any) => void;
  handleUploadComplete: (
    documentId: string,
    fileName: string,
    namespace: string
  ) => void;
}

const ProtectedLayout = () => {
  const { isAuthenticated, loading, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // State lifted up for MainLayout and its children
  const [recentDocuments, setRecentDocuments] = useState(() => {
    const savedDocs = localStorage.getItem("recent_documents");
    return savedDocs ? JSON.parse(savedDocs) : [];
  });
  const [currentDocument, setCurrentDocument] = useState(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  // First-login workspace creation
  const [showWorkspaceModal, setShowWorkspaceModal] = useState(false);
  const [checkingFirstLogin, setCheckingFirstLogin] = useState(true);

  // Additional check to ensure authentication is properly validated
  useEffect(() => {
    if (!loading && !isAuthenticated) {
      navigate("/login", { replace: true });
    }
  }, [isAuthenticated, loading, navigate]);

  // Check if admin needs to create workspace AND/OR complete onboarding (first-login)
  useEffect(() => {
    const checkFirstLogin = async () => {
      if (!loading && isAuthenticated && user) {
        try {
          const result = await workspaceService.checkFirstLogin();

          if (result.needsWorkspace && result.isAdmin) {
            // Step 1: Admin needs to create workspace first
            setShowWorkspaceModal(true);
          } else if (result.isAdmin && result.needsOnboarding && location.pathname !== "/onboarding") {
            // Step 2: Admin has workspace but hasn't completed onboarding — redirect
            console.log("🔄 Admin has not completed onboarding — redirecting to /onboarding");
            navigate("/onboarding", { replace: true });
          }
        } catch (error) {
          console.error("Error checking first login:", error);
        } finally {
          setCheckingFirstLogin(false);
        }
      } else {
        setCheckingFirstLogin(false);
      }
    };

    checkFirstLogin();
  }, [loading, isAuthenticated, user]);

  const handleDocumentSelect = (doc) => {
    setCurrentDocument(doc);
    navigate(`/doc/${doc.namespace}`);
  };

  const handleUploadComplete = (documentId, fileName, namespace) => {
    const newDoc = {
      id: documentId,
      name: fileName,
      uploadedAt: new Date().toISOString(),
      namespace,
    };
    const updatedDocs = [newDoc, ...recentDocuments.slice(0, 4)];
    setRecentDocuments(updatedDocs);
    localStorage.setItem("recent_documents", JSON.stringify(updatedDocs));
    setCurrentDocument(newDoc);
    navigate(`/doc/${namespace || documentId}`);
  };

  // Show loading spinner while authentication is being checked or first-login check
  if (loading || checkingFirstLogin) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  // Redirect to login if not authenticated
  if (!isAuthenticated || !user) {
    return <Navigate to="/login" replace />;
  }

  // Pass down state and handlers to all protected routes
  const context = {
    recentDocuments,
    currentDocument,
    isSidebarOpen,
    setIsSidebarOpen,
    handleDocumentSelect,
    handleUploadComplete,
  };

  return (
    <>
      <CreateWorkspaceModal
        open={showWorkspaceModal}
        onOpenChange={setShowWorkspaceModal}
        isFirstLogin={true}
        onCreated={() => {
          setShowWorkspaceModal(false);
          // After creating workspace on first login, redirect to onboarding
          // so admin can upload SOP and configure AI pipeline
          navigate("/onboarding", { replace: true });
        }}
      />
      <Outlet context={context satisfies ProtectedLayoutContext} />
    </>
  );
};

export default ProtectedLayout;
