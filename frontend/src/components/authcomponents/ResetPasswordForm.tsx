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
import { toast } from "sonner";
import { authService } from "@/services/authService";
import { useNavigate, useLocation } from "react-router-dom";

const formSchema = z
  .object({
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

export function ResetPasswordForm() {
  const [isLoading, setIsLoading] = useState(false);
  const [resetComplete, setResetComplete] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  // Get token and email from URL parameters
  const params = new URLSearchParams(location.search);
  const token = params.get("token");
  const email = params.get("email");

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      password: "",
      confirmPassword: "",
    },
  });

  async function onSubmit(values: z.infer<typeof formSchema>) {
    if (!token || !email) {
      toast.error("Invalid reset link. Please request a new password reset.");
      return;
    }

    setIsLoading(true);
    try {
      await authService.resetPassword(email, token, values.password);
      setResetComplete(true);
      toast.success("Password has been reset successfully!");
    } catch (error) {
      const errorMessage =
        error?.response?.data?.message ||
        "Password reset failed. The link may be invalid or expired.";
      toast.error(errorMessage);
    } finally {
      setIsLoading(false);
    }
  }

  if (!token || !email) {
    return (
      <div className="w-full max-w-lg mx-auto text-center space-y-6">
        <h2 className="text-2xl font-bold text-[#444]">Invalid Reset Link</h2>
        <p className="text-[#666]">
          The password reset link is invalid or has expired. Please request a
          new password reset.
        </p>
        <Button
          onClick={() => navigate("/login")}
          className="mt-4 bg-[#4B2A06] text-white hover:bg-[#3a2004]"
        >
          Return to Login
        </Button>
      </div>
    );
  }

  if (resetComplete) {
    return (
      <div className="w-full max-w-lg mx-auto text-center space-y-6">
        <h2 className="text-2xl font-bold text-[#444]">
          Password Reset Complete
        </h2>
        <p className="text-[#666]">
          Your password has been reset successfully. You can now log in with
          your new password.
        </p>
        <Button
          onClick={() => navigate("/login")}
          className="mt-4 bg-[#4B2A06] text-white hover:bg-[#3a2004]"
        >
          Go to Login
        </Button>
      </div>
    );
  }

  return (
    <Form {...form}>
      <div className="w-full max-w-lg mx-auto min-h-[520px] flex flex-col justify-center">
        <div className="text-center mb-6">
          <h2 className="text-2xl font-bold text-[#444] mb-2">
            Reset Your Password
          </h2>
          <p className="text-[#666]">Please enter your new password below.</p>
        </div>

        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <FormLabel
                  className="text-xl font-extrabold text-[#444] mb-2"
                  style={{ fontFamily: "Inter, Arial, sans-serif" }}
                >
                  New Password
                </FormLabel>
                <FormControl>
                  <div className="relative">
                    <Input
                      type={showPassword ? "text" : "password"}
                      placeholder="Enter new password"
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
                      placeholder="Confirm new password"
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
            Reset Password
          </Button>
        </form>
      </div>
    </Form>
  );
}
