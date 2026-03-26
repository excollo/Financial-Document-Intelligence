// Handles OAuth callback by extracting tokens from query and logging in, then redirects.
// Shows a loading state while processing.
import React, { useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

const AuthCallbackPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const { login } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    const token = searchParams.get("token");
    const refreshToken = searchParams.get("refreshToken");

    if (token && refreshToken) {
      try {
        login(token, refreshToken);
        navigate("/dashboard");
      } catch (error) {
        console.error("Error processing token:", error);
        toast.error("Authentication failed. Please try again.");
        navigate("/login");
      }
    } else {
      toast.error("No authentication token received.");
      navigate("/login");
    }
  }, [searchParams, login, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
      <div className="text-center">
        <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4" />
        <h2 className="text-xl font-semibold text-gray-900">
          Completing sign in...
        </h2>
        <p className="text-gray-600 mt-2">
          Please wait while we complete your authentication.
        </p>
      </div>
    </div>
  );
};

export default AuthCallbackPage;
