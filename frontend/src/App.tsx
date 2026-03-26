import React from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigationType } from "react-router-dom";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import ChatSummaryLayout from "./pages/documentpages/ChatSummaryLayout";
import NotFound from "./pages/sharedpages/NotFound";
import ChatHistoryPage from "./pages/chatpages/ChatHistoryPage";
import LandingPage from "./pages/sharedpages/LandingPage";
import AuthPage from "./pages/authpages/AuthPage";
import AuthCallbackPage from "./pages/authpages/AuthCallbackPage";
import ForgotPasswordPage from "./pages/authpages/ForgotPasswordPage";
import ResetPasswordPage from "./pages/authpages/ResetPasswordPage";
import ProtectedLayout from "./pages/sharedpages/ProtectedLayout";
import AppLayout from "./AppLayout";
import { Loader2 } from "lucide-react";
import { MainLayout } from "./components/sharedcomponents/MainLayout";
import StartConversationPage from "./pages/documentpages/StartConversationPage";
import ComparePage from "./pages/documentpages/ComparePage";
import ProfilePage from "./pages/sharedpages/ProfilePage";
import AdminDashboardPage from "./pages/adminpages/AdminDashboardPage";
import AdminUsersPage from "./pages/adminpages/AdminUsersPage";
import AdminWorkspaceManagement from "./pages/workspacepages/AdminWorkspaceManagement";
import InvitationPage from "./pages/workspacepages/InvitationPage";
import { useAuthProtection } from "./hooks/useAuthProtection";
import NotificationsPage from "./pages/sharedpages/NotificationsPage";
import TrashPage from "./pages/sharedpages/TrashPage";
import NewsArticles from "./pages/newsmonitor/NewsArticles";
import OnboardingPage from "./pages/onboarding/OnboardingPage";

const queryClient = new QueryClient();

const Root = () => {
  const { isAuthenticated, loading } = useAuth();
  if (loading) {
    return (
      <div className="h-screen w-full flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }
  return isAuthenticated ? <Navigate to="/dashboard" /> : <Navigate to="/" />;
};

const AppRoutes = () => {
  // Add authentication protection
  useAuthProtection();

  // Scroll position restoration (robust)
  const ScrollRestorer = () => {
    const location = useLocation();
    const navType = useNavigationType();

    React.useEffect(() => {
      const key = `scroll:${location.pathname}${location.search}`;
      const stored = sessionStorage.getItem(key);
      const y = stored != null ? Number(stored) : null;

      // Always try to restore if we have a stored value; otherwise go to top
      requestAnimationFrame(() => {
        if (y !== null && !Number.isNaN(y)) {
          window.scrollTo(0, y);
        } else {
          window.scrollTo(0, 0);
        }
      });

      // Save on unmount or before leaving the route
      return () => {
        const currentY = window.scrollY || document.documentElement.scrollTop || 0;
        sessionStorage.setItem(key, String(currentY));
      };
    }, [location.pathname, location.search, navType]);

    // Also save on page unload
    React.useEffect(() => {
      const handler = () => {
        const key = `scroll:${location.pathname}${location.search}`;
        const currentY = window.scrollY || document.documentElement.scrollTop || 0;
        sessionStorage.setItem(key, String(currentY));
      };
      window.addEventListener("beforeunload", handler);
      return () => window.removeEventListener("beforeunload", handler);
    }, [location.pathname, location.search]);

    return null;
  };

  return (
    <>
      <ScrollRestorer />
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<LandingPage />} />
          <Route path="/login" element={<AuthPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/auth-callback" element={<AuthCallbackPage />} />
          <Route path="/invitation/:invitationId" element={<InvitationPage />} />

          <Route element={<ProtectedLayout />}>
            <Route path="/dashboard" element={<StartConversationPage />} />
            <Route path="/notifications" element={<NotificationsPage />} />
            <Route path="/bin" element={<TrashPage />} />
            <Route path="/compare/:drhpId" element={<ComparePage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/news-monitor" element={<NewsArticles />} />

            {/* Admin Routes */}
            <Route path="/admin" element={<AdminDashboardPage />} />
            <Route path="/admin/users" element={<AdminUsersPage />} />
            <Route path="/admin/workspaces" element={<AdminWorkspaceManagement />} />
            <Route path="/onboarding" element={<OnboardingPage />} />
            {/* Domain Config removed */}

            <Route element={<MainLayout />}>
              <Route path="/doc/:namespace" element={<ChatSummaryLayout />} />
              <Route path="/chat-history" element={<ChatHistoryPage />} />
              <Route path="/settings" element={<ProfilePage />} />
            </Route>
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Route>

          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </>
  );
};

const HealthMonitor = () => {
  React.useEffect(() => {
    const handleHealthError = (event: any) => {
      const { message } = event.detail;
      // We use a custom alert here or a toast
      alert(`⚠️ ${message}`);
    };
    window.addEventListener('api-health-error', handleHealthError);
    return () => window.removeEventListener('api-health-error', handleHealthError);
  }, []);
  return null;
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <HealthMonitor />
      <BrowserRouter
        future={{
          v7_startTransition: true,
          v7_relativeSplatPath: true,
        }}
      >
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
