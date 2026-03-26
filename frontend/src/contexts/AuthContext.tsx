// Global auth context: stores decoded user, manages access/refresh tokens,
// auto-refreshes tokens, attaches Authorization header, and provides login/logout.
import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useMemo,
  useRef,
} from "react";
import { jwtDecode } from "jwt-decode";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import axios from "axios";
import { authService } from "@/services/authService";

interface User {
  userId: string;
  email: string;
  name?: string;
  role?: string; // User role (admin or user)
  phoneNumber?: string;
  gender?: "male" | "female" | "other" | "prefer-not-to-say";
  domainId?: string;
  exp?: number; // JWT expiration timestamp
}

interface AuthContextType {
  user: User | null;
  login: (accessToken: string, refreshToken: string) => void;
  logout: (message?: string) => void;
  isAuthenticated: boolean;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};

// Helper function to check if token is expired
const isTokenExpired = (token: string): boolean => {
  try {
    const decoded = jwtDecode(token) as User;
    if (!decoded.exp) return true;

    // Check if token is expired (with 5 minute buffer before actual expiration)
    const currentTime = Math.floor(Date.now() / 1000);
    const bufferSeconds = 5 * 60; // 5 minutes = 300 seconds
    return decoded.exp < currentTime + bufferSeconds;
  } catch {
    return true;
  }
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const tokenCheckInterval = useRef<NodeJS.Timeout | null>(null);

  const logout = useMemo(
    () => async (message?: string) => {
      const refreshToken = localStorage.getItem("refreshToken");
      if (refreshToken) {
        try {
          await authService.logout(refreshToken);
        } catch (error) {
          console.error(
            "Logout failed on server, clearing client-side session.",
            error
          );
        }
      }
      setUser(null);
      localStorage.removeItem("accessToken");
      localStorage.removeItem("refreshToken");
      delete axios.defaults.headers.common["Authorization"];

      // Clear the token check interval
      if (tokenCheckInterval.current) {
        clearInterval(tokenCheckInterval.current);
        tokenCheckInterval.current = null;
      }

      navigate("/login");
      if (message) {
        toast.error(message);
      } else {
        toast.success("Successfully logged out!");
      }
    },
    [navigate]
  );

  // Function to validate current token
  const validateToken = async () => {
    const accessToken = localStorage.getItem("accessToken");
    if (!accessToken) {
      if (user) {
        await logout("Session expired. Please log in again.");
      }
      return;
    }

    if (isTokenExpired(accessToken)) {
      const refreshToken = localStorage.getItem("refreshToken");
      if (refreshToken) {
        try {
          const { accessToken: newAccessToken } =
            await authService.refreshToken(refreshToken);
          localStorage.setItem("accessToken", newAccessToken);
          const decoded = jwtDecode(newAccessToken) as User;
          setUser(decoded);
          axios.defaults.headers.common[
            "Authorization"
          ] = `Bearer ${newAccessToken}`;
        } catch (refreshError) {
          await logout("Session expired. Please log in again.");
        }
      } else {
        await logout("Session expired. Please log in again.");
      }
    }
  };

  useEffect(() => {
    const initAuth = async () => {
      const accessToken = localStorage.getItem("accessToken");

      if (accessToken) {
        try {
          // Check if token is expired
          if (isTokenExpired(accessToken)) {
            // Try to refresh the token
            const refreshToken = localStorage.getItem("refreshToken");
            if (refreshToken) {
              try {
                const { accessToken: newAccessToken } =
                  await authService.refreshToken(refreshToken);
                localStorage.setItem("accessToken", newAccessToken);
                const decoded = jwtDecode(newAccessToken) as User;
                setUser(decoded);
                axios.defaults.headers.common[
                  "Authorization"
                ] = `Bearer ${newAccessToken}`;
              } catch (refreshError) {
                // Refresh failed, clear tokens and redirect to login
                await logout("Session expired. Please log in again.");
                setLoading(false);
                return;
              }
            } else {
              // No refresh token, clear everything
              await logout("Session expired. Please log in again.");
              setLoading(false);
              return;
            }
          } else {
            // Token is valid
            const decoded = jwtDecode(accessToken) as User;
            setUser(decoded);
            axios.defaults.headers.common[
              "Authorization"
            ] = `Bearer ${accessToken}`;
          }
        } catch (error) {
          // Invalid token, clear everything
          await logout("Invalid session. Please log in again.");
          setLoading(false);
          return;
        }
      }
      setLoading(false);
    };
    initAuth();

    const responseInterceptor = axios.interceptors.response.use(
      (response) => response,
      async (error) => {
        const originalRequest = error.config;
        if (error.response?.status === 401 && !originalRequest._retry) {
          originalRequest._retry = true;
          const refreshToken = localStorage.getItem("refreshToken");
          if (refreshToken) {
            try {
              const { accessToken } = await authService.refreshToken(
                refreshToken
              );
              localStorage.setItem("accessToken", accessToken);
              axios.defaults.headers.common[
                "Authorization"
              ] = `Bearer ${accessToken}`;
              originalRequest.headers[
                "Authorization"
              ] = `Bearer ${accessToken}`;
              return axios(originalRequest);
            } catch (refreshError) {
              await logout("Session expired. Please log in again."); // Show session expired
              return Promise.reject(refreshError);
            }
          } else {
            // No refresh token available, logout
            await logout("Session expired. Please log in again.");
          }
        }
        return Promise.reject(error);
      }
    );

    // Set up periodic token validation (every 5 minutes)
    if (user) {
      tokenCheckInterval.current = setInterval(validateToken, 5 * 60 * 1000);
    }

    // Cleanup interceptor and interval on component unmount
    return () => {
      axios.interceptors.response.eject(responseInterceptor);
      if (tokenCheckInterval.current) {
        clearInterval(tokenCheckInterval.current);
      }
    };
  }, [logout]);

  const login = (accessToken: string, refreshToken: string) => {
    try {
      const decoded = jwtDecode(accessToken) as User;
      localStorage.setItem("accessToken", accessToken);
      localStorage.setItem("refreshToken", refreshToken);
      axios.defaults.headers.common["Authorization"] = `Bearer ${accessToken}`;
      setUser(decoded);

      // Set up periodic token validation after login (every 5 minutes)
      if (tokenCheckInterval.current) {
        clearInterval(tokenCheckInterval.current);
      }
      tokenCheckInterval.current = setInterval(
        validateToken,
        5 * 60 * 1000 // Check every 5 minutes
      );

      navigate("/dashboard");
    } catch (error) {
      toast.error("Login failed. Invalid token received.");
    }
  };

  return (
    <AuthContext.Provider
      value={{ user, login, logout, isAuthenticated: !!user, loading }}
    >
      {children}
    </AuthContext.Provider>
  );
};
