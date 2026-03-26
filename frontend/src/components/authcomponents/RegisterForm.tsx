import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { useAuth } from "@/contexts/AuthContext";
import { useLocation, useNavigate } from "react-router-dom";
import { workspaceInvitationService } from "@/services/workspaceInvitationService";
import { toast } from "sonner";
import { authService } from "@/services/authService";

// Allow all domains – backend enforces domain handling

const formSchema = z
  .object({
    email: z.string().email({ message: "Invalid email address." }),
    password: z
      .string()
      .min(8, { message: "Password must be at least 8 characters long." })
      .regex(/[a-z]/, {
        message: "Password must contain at least one lowercase letter.",
      })
      .regex(/[A-Z]/, {
        message: "Password must contain at least one uppercase letter.",
      })
      .regex(/[0-9]/, { message: "Password must contain at least one number." })
      .regex(/[^a-zA-Z0-9]/, {
        message: "Password must contain at least one special character.",
      }),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });

// Email/password registration form with OTP verification step.
// Step 1: submit email+password -> backend sends OTP
// Step 2: enter OTP -> verify -> auto-login and proceed
export function RegisterForm({
  onSwitchToLogin,
}: {
  onSwitchToLogin: () => void;
}) {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [isLoading, setIsLoading] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [pendingEmail, setPendingEmail] = useState<string>("");
  const [otp, setOtp] = useState<string>("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      email: "",
      password: "",
      confirmPassword: "",
    },
  });

  async function onSubmit(values: z.infer<typeof formSchema>) {
    setIsLoading(true);
    try {
      // Step 1: initiate registration (sends OTP)
      await authService.register({
        email: values.email,
        password: values.password,
      });
      setPendingEmail(values.email);
      setIsVerifying(true);
      toast.success("OTP sent to your email. Please verify to complete registration.");
      return;

      // If user came with an invitation, auto-accept now
      const params = new URLSearchParams(location.search);
      const invitationId = params.get("invitation");
      if (invitationId) {
        try {
          const result = await workspaceInvitationService.acceptInvitation(
            invitationId
          );

          // Automatically switch to the invited workspace
          if (result.workspace?.domain) {
            await workspaceInvitationService.switchWorkspace(
              result.workspace.domain
            );
            // Refresh the page to ensure documents are loaded with correct permissions
            window.location.href = "/dashboard";
            return;
          }

          toast.success("Invitation accepted. Welcome to the workspace!");
          navigate("/dashboard");
          return;
        } catch (e: any) {
          toast.error(
            e?.response?.data?.message || "Failed to accept invitation"
          );
        }
      }
    } catch (error: any) {
      const errorMessage =
        error?.response?.data?.message ||
        "Registration failed. Please try again.";

      if (errorMessage.toLowerCase().includes("user already exists")) {
        toast.error("Email already registered.", {
          action: {
            label: "Log In",
            onClick: onSwitchToLogin,
          },
        });
      } else {
        toast.error(errorMessage);
      }
    } finally {
      setIsLoading(false);
    }
  }

  async function onVerifyOtp() {
    if (!pendingEmail || !otp) {
      toast.error("Enter the OTP sent to your email");
      return;
    }
    setIsLoading(true);
    try {
      const { accessToken, refreshToken } = await authService.verifyRegistrationOtp(
        pendingEmail,
        otp
      );
      login(accessToken, refreshToken);
      toast.success("Email verified. Account created successfully!");

      // Invitation handling remains the same after successful login
      const params = new URLSearchParams(location.search);
      const invitationId = params.get("invitation");
      if (invitationId) {
        try {
          const result = await workspaceInvitationService.acceptInvitation(
            invitationId
          );
          if (result.workspace?.domain) {
            await workspaceInvitationService.switchWorkspace(
              result.workspace.domain
            );
            window.location.href = "/dashboard";
            return;
          }
          toast.success("Invitation accepted. Welcome to the workspace!");
          navigate("/dashboard");
          return;
        } catch (e: any) {
          toast.error(
            e?.response?.data?.message || "Failed to accept invitation"
          );
        }
      }
      navigate("/dashboard");
    } catch (error: any) {
      const msg = error?.response?.data?.message || "OTP verification failed";
      toast.error(msg);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <Form {...form}>
      <div className="w-full max-w-lg mx-auto min-h-[520px] flex flex-col justify-center">
        {!isVerifying ? (
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel
                  className="text-xl font-extrabold text-[#444] mb-2"
                  style={{ fontFamily: "Inter, Arial, sans-serif" }}
                >
                  Email
                </FormLabel>
                <FormControl>
                  <Input
                    placeholder="Your email"
                    className="rounded-xl border border-[#E5E5E5] px-6 py-6 text-lg focus:ring-0 focus:border-[#E5E5E5] shadow-none bg-white h-16 outline-none"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <FormLabel
                  className="text-xl font-extrabold text-[#444] mb-2"
                  style={{ fontFamily: "Inter, Arial, sans-serif" }}
                >
                  Password
                </FormLabel>
                <FormControl>
                  <div className="relative">
                    <Input
                      type={showPassword ? "text" : "password"}
                      placeholder="Your password"
                      className="rounded-xl border border-[#E5E5E5] px-6 py-6 text-lg focus:ring-0 focus:border-[#E5E5E5] shadow-none bg-white pr-12 h-16 outline-none"
                      {...field}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute inset-y-0 right-0 flex items-center pr-4 text-muted-foreground"
                    >
                      {showPassword ? (
                        <EyeOff className="h-6 w-6" />
                      ) : (
                        <Eye className="h-6 w-6" />
                      )}
                    </button>
                  </div>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="confirmPassword"
            render={({ field }) => (
              <FormItem>
                <FormLabel
                  className="text-xl font-extrabold text-[#444] mb-2"
                  style={{ fontFamily: "Inter, Arial, sans-serif" }}
                >
                  Confirm Password
                </FormLabel>
                <FormControl>
                  <div className="relative">
                    <Input
                      type={showConfirmPassword ? "text" : "password"}
                      placeholder="Confirm password"
                      className="rounded-xl border border-[#E5E5E5] px-6 py-6 text-lg focus:ring-0 focus:border-[#E5E5E5] shadow-none bg-white pr-12 h-16 outline-none"
                      {...field}
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setShowConfirmPassword(!showConfirmPassword)
                      }
                      className="absolute inset-y-0 right-0 flex items-center pr-4 text-muted-foreground"
                    >
                      {showConfirmPassword ? (
                        <EyeOff className="h-6 w-6" />
                      ) : (
                        <Eye className="h-6 w-6" />
                      )}
                    </button>
                  </div>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button
            type="submit"
            className="w-full bg-[#4B2A06] text-white text-base font-semibold py-3 rounded-lg shadow-none hover:bg-[#3a2004] transition"
            disabled={isLoading}
          >
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Register
          </Button>

          {/* Social providers */}
          <div className="flex items-center gap-3 justify-center pt-2">
            <button
              type="button"
              aria-label="Continue with Google"
              className="h-11 w-11 rounded-full  bg-white flex items-center justify-center hover:bg-gray-100"
              onClick={() => toast.info("Google sign-up coming soon")}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 48 48"
                className="h-5 w-5"
              >
                <path
                  fill="#FFC107"
                  d="M43.611,20.083H42V20H24v8h11.303c-1.649,4.657-6.08,8-11.303,8c-6.627,0-12-5.373-12-12c0-6.627,5.373-12,12-12c3.059,0,5.842,1.156,7.961,3.039l5.657-5.657C33.64,6.053,29.082,4,24,4C12.955,4,4,12.955,4,24c0,11.045,8.955,20,20,20c11.045,0,20-8.955,20-20C44,22.659,43.862,21.35,43.611,20.083z"
                />
                <path
                  fill="#FF3D00"
                  d="M6.306,14.691l6.571,4.819C14.655,16.108,18.961,13,24,13c3.059,0,5.842,1.156,7.961,3.039l5.657-5.657C33.64,6.053,29.082,4,24,4C16.318,4,9.656,8.337,6.306,14.691z"
                />
                <path
                  fill="#4CAF50"
                  d="M24,44c5.166,0,9.86-1.977,13.409-5.197l-6.19-5.238C29.211,35.091,26.715,36,24,36c-5.202,0-9.619-3.317-11.283-7.946l-6.51,5.02C9.518,39.556,16.227,44,24,44z"
                />
                <path
                  fill="#1976D2"
                  d="M43.611,20.083H42V20H24v8h11.303c-0.792,2.237-2.231,4.166-4.094,5.565c0.001-0.001,0.002-0.001,0.003-0.002l6.19,5.238C36.971,39.205,44,34,44,24C44,22.659,43.862,21.35,43.611,20.083z"
                />
              </svg>
            </button>
            <button
              type="button"
              aria-label="Continue with Microsoft"
              className="h-11 w-11 rounded-full  bg-white flex items-center justify-center hover:bg-gray-100"
              onClick={async () => {
                try {
                  const url = await authService.getMicrosoftAuthUrl();
                  window.location.href = url;
                } catch {
                  toast.error("Microsoft sign-up failed to initialize");
                }
              }}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 23 23"
                className="h-5 w-5"
              >
                <path fill="#F25022" d="M1 1h10v10H1z" />
                <path fill="#7FBA00" d="M12 1h10v10H12z" />
                <path fill="#00A4EF" d="M1 12h10v10H1z" />
                <path fill="#FFB900" d="M12 12h10v10H12z" />
              </svg>
            </button>
          </div>
        </form>
        ) : (
          <div className="space-y-6">
            <div>
              <div className="text-xl font-extrabold text-[#444] mb-2" style={{ fontFamily: "Inter, Arial, sans-serif" }}>
                Enter OTP sent to {pendingEmail}
              </div>
              <Input
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                placeholder="6-digit OTP"
                className="rounded-xl border border-[#E5E5E5] px-6 py-6 text-lg focus:ring-0 focus:border-[#E5E5E5] shadow-none bg-white h-16 outline-none"
                maxLength={6}
              />
            </div>
            <Button
              type="button"
              onClick={onVerifyOtp}
              className="w-full bg-[#4B2A06] text-white text-base font-semibold py-3 rounded-lg shadow-none hover:bg-[#3a2004] transition"
              disabled={isLoading}
            >
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Verify & Complete Registration
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => { setIsVerifying(false); setOtp(""); }}
            >
              Back
            </Button>
          </div>
        )}
      </div>
    </Form>
  );
}
