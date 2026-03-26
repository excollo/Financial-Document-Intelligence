import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
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
import { toast } from "sonner";
import { Loader2, Eye, EyeOff } from "lucide-react";
import { authService } from "@/services/authService";
import { useNavigate } from "react-router-dom";

// Allow all domains – backend derives and enforces domain

const formSchema = z.object({
  email: z.string().email({ message: "Invalid email address." }),
  password: z
    .string()
    .min(6, { message: "Password must be at least 6 characters." }),
});

export function LoginForm() {
  const { login } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const navigate = useNavigate();
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { email: "", password: "" },
  });

  async function onSubmit(values: z.infer<typeof formSchema>) {
    setIsLoading(true);
    try {
      const { accessToken, refreshToken } = await authService.login(
        values.email,
        values.password
      );
      login(accessToken, refreshToken);
      toast.success("Login successful!");
    } catch (error: any) {
      const errorMessage =
        error?.response?.data?.message ||
        error?.message ||
        "Login failed. Please check your credentials.";

      if (errorMessage.toLowerCase().includes("domain not allowed")) {
        toast.error("Login restricted by backend policy.");
      } else {
        toast.error(errorMessage);
      }
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="space-y-10 w-full max-w-lg mx-auto"
      >
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
                  className="outline-none border border-input rounded-xl px-6 py-6 text-lg focus:ring-0 focus:border-[#E5E5E5] shadow-none bg-white h-16"
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
                    className="outline-none border border-input rounded-xl px-6 py-6 text-lg focus:ring-0 focus:border-[#E5E5E5] shadow-none bg-white pr-12 h-16"
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
            </FormItem>
          )}
        />
        <div className="flex justify-end -mt-6 mb-2">
          <a
            href="/forgot-password"
            className="text-[#4B2A06] text-base font-semibold hover:underline focus:outline-none"
            onClick={(e) => {
              e.preventDefault();
              console.log("Forgot Password link clicked");
              // Try direct window location change instead of React Router
              window.location.href = "/forgot-password";
            }}
            style={{ fontFamily: "Inter, Arial, sans-serif" }}
          >
            Forgot Password?
          </a>
        </div>
        <Button
          type="submit"
          className="w-full bg-[#4B2A06] text-white text-xl font-bold py-6 rounded-xl shadow-none hover:bg-[#3a2004] transition h-16"
          disabled={isLoading}
          style={{ fontFamily: "Inter, Arial, sans-serif" }}
        >
          {isLoading && <Loader2 className="mr-2 h-5 w-5 animate-spin" />}
          Log in
        </Button>

        {/* Social providers */}
        <div className="flex items-center gap-3 justify-center pt-2">
          <button
            type="button"
            aria-label="Continue with Google"
            className="h-11 w-11 rounded-full  bg-white flex items-center justify-center hover:bg-gray-100"
            onClick={() => toast.info("Google sign-in coming soon")}
          >
            {/* Google SVG */}
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
                toast.error("Microsoft sign-in failed to initialize");
              }
            }}
          >
            {/* Microsoft SVG */}
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
    </Form>
  );
}
