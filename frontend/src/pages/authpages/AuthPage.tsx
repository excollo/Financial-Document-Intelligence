import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LoginForm } from "@/components/authcomponents/LoginForm";
import { RegisterForm } from "@/components/authcomponents/RegisterForm";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { authService } from "@/services/authService";
import { Loader2 } from "lucide-react";
import { useNavigate, useLocation } from "react-router-dom";
import React from "react";

const MicrosoftLogo = () => (
  <svg
    role="img"
    width="24"
    height="24"
    viewBox="0 0 16 16"
    className="mx-2"
    aria-hidden
  >
    <rect width="7" height="7" x="1" y="1" fill="#F35325" />
    <rect width="7" height="7" x="8" y="1" fill="#81BC06" />
    <rect width="7" height="7" x="1" y="8" fill="#05A6F0" />
    <rect width="7" height="7" x="8" y="8" fill="#FFBA08" />
  </svg>
);

const GoogleLogo = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" className="mx-2" aria-hidden>
    <g>
      <path
        d="M21.805 12.023c0-.638-.057-1.252-.163-1.84H12v3.481h5.617c-.242 1.242-1.469 3.648-5.617 3.648-3.375 0-6.125-2.789-6.125-6.148s2.75-6.148 6.125-6.148c1.922 0 3.211.82 3.953 1.523l2.703-2.633C16.992 2.93 14.781 2 12 2 6.477 2 2 6.477 2 12s4.477 10 10 10c5.781 0 9.594-4.055 9.594-9.773 0-.656-.07-1.156-.156-1.648z"
        fill="#4285F4"
      />
      <path
        d="M3.545 7.548l3.281 2.406c.891-1.781 2.531-2.953 4.449-2.953 1.078 0 2.078.375 2.859 1.016l2.719-2.648C15.369 4.002 13.461 3.15 11.273 3.15c-3.594 0-6.625 2.344-7.719 5.547z"
        fill="#34A853"
      />
      <path
        d="M12 22c2.438 0 4.484-.805 5.977-2.188l-2.781-2.273c-.781.523-1.781.836-3.195.836-2.484 0-4.594-1.68-5.352-3.953l-3.25 2.516C4.883 20.055 8.023 22 12 22z"
        fill="#FBBC05"
      />
      <path
        d="M21.805 12.023c0-.638-.057-1.252-.163-1.84H12v3.481h5.617c-.242 1.242-1.469 3.648-5.617 3.648-3.375 0-6.125-2.789-6.125-6.148s2.75-6.148 6.125-6.148c1.922 0 3.211.82 3.953 1.523l2.703-2.633C16.992 2.93 14.781 2 12 2 6.477 2 2 6.477 2 12s4.477 10 10 10c5.781 0 9.594-4.055 9.594-9.773 0-.656-.07-1.156-.156-1.648z"
        fill="#EA4335"
      />
    </g>
    <g>
      <path
        d="M12 22c5.523 0 10-4.477 10-10s-4.477-10-10-10S2 6.477 2 12s4.477 10 10 10z"
        fill="none"
      />
      <path
        d="M12 2c2.781 0 4.992.93 6.727 2.523l-2.703 2.633C15.211 6.82 13.922 6 12 6c-3.375 0-6.125 2.789-6.125 6.148s2.75 6.148 6.125 6.148c4.148 0 5.375-2.406 5.617-3.648H12v-3.481h9.805c.106.588.163 1.202.163 1.84 0 5.718-3.813 9.773-9.594 9.773C6.477 22 2 17.523 2 12S6.477 2 12 2z"
        fill="none"
      />
    </g>
  </svg>
);

export default function AuthPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const view = params.get("view");
  const [formView, setFormView] = useState(
    view === "register" ? "register" : "login"
  );

  // Keep formView in sync with URL
  React.useEffect(() => {
    setFormView(view === "register" ? "register" : "login");
  }, [view]);

  return (
    <div
      className="min-h-screen bg-white flex flex-col font-sans"
      style={{ fontFamily: "Inter, Arial, sans-serif" }}
    >
      {/* LOGO top left */}
      <div
        className="absolute left-0 top-0 p-8 text-2xl font-extrabold tracking-tight text-black"
        style={{ fontFamily: "Inter, Arial, sans-serif" }}
      >
        LOGO
      </div>
      <div className="flex-1 flex items-center justify-center">
        <Card className="w-full max-w-lg shadow-none border-none bg-transparent min-h-[650px] flex flex-col justify-center">
          <CardHeader className="text-center pb-2">
            <CardTitle
              className="text-5xl md:text-6xl font-extrabold mb-8"
              style={{
                color: "#232323",
                fontFamily: "Inter, Arial, sans-serif",
                fontWeight: 800,
              }}
            >
              {formView === "register" ? "Register" : "Log in"}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col justify-center">
            <div className="space-y-8">
              {formView === "register" ? (
                <RegisterForm
                  onSwitchToLogin={() => {
                    navigate("/login");
                  }}
                />
              ) : (
                <LoginForm />
              )}
              
              <div
                className="text-center text-xl mt-6"
                style={{
                  fontFamily: "Inter, Arial, sans-serif",
                  color: "#A1A1AA",
                  fontWeight: 600,
                }}
              >
                {formView === "register" ? (
                  <>
                    Already have an account?{" "}
                    <button
                      onClick={() => navigate("/login")}
                      className="font-bold hover:underline"
                      style={{
                        color: "#4B2A06",
                        fontFamily: "Inter, Arial, sans-serif",
                      }}
                    >
                      Log in
                    </button>
                  </>
                ) : (
                  <>
                    Don't have an Account ?{" "}
                    <button
                      onClick={() => navigate("/login?view=register")}
                      className="font-bold hover:underline"
                      style={{
                        color: "#4B2A06",
                        fontFamily: "Inter, Arial, sans-serif",
                      }}
                    >
                      Register
                    </button>
                    <div className="mt-4">
                      <a
                        href="/forgot-password"
                        className="font-bold hover:underline"
                        style={{
                          color: "#4B2A06",
                          fontFamily: "Inter, Arial, sans-serif",
                        }}
                        onClick={(e) => {
                          e.preventDefault();
                          console.log(
                            "Forgot Password link clicked from AuthPage"
                          );
                          window.location.href = "/forgot-password";
                        }}
                      >
                        Forgot Password?
                      </a>
                    </div>
                  </>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
