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
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { authService } from "@/services/authService";
import { useNavigate } from "react-router-dom";

const formSchema = z.object({
  email: z.string().email({ message: "Invalid email address." }),
});

export function ForgotPasswordForm() {
  const [isLoading, setIsLoading] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const navigate = useNavigate();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { email: "" },
  });

  async function onSubmit(values: z.infer<typeof formSchema>) {
    console.log("Form submitted with email:", values.email);
    setIsLoading(true);
    try {
      console.log("Calling authService.forgotPassword");
      await authService.forgotPassword(values.email);
      console.log("forgotPassword API call successful");
      setEmailSent(true);
      toast.success("If that email is registered, a reset link has been sent.");
    } catch (error) {
      console.error("Error in forgotPassword:", error);
      // We don't show specific errors to prevent email enumeration
      toast.success("If that email is registered, a reset link has been sent.");
      setEmailSent(true);
    } finally {
      setIsLoading(false);
    }
  }

  if (emailSent) {
    return (
      <div className="w-full max-w-lg mx-auto text-center space-y-6">
        <h2 className="text-2xl font-bold text-[#444]">Check your email</h2>
        <p className="text-[#666]">
          We've sent a password reset link to your email address. Please check
          your inbox and follow the instructions.
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

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="space-y-6 w-full max-w-lg mx-auto"
      >
        <div className="text-center mb-6">
          <h2 className="text-2xl font-bold text-[#444] mb-2">
            Forgot your password?
          </h2>
          <p className="text-[#666]">
            Enter your email address and we'll send you a link to reset your
            password.
          </p>
        </div>

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

        <div className="flex flex-col space-y-4">
          <Button
            type="submit"
            className="w-full bg-[#4B2A06] text-white text-xl font-bold py-6 rounded-xl shadow-none hover:bg-[#3a2004] transition h-16"
            disabled={isLoading}
            style={{ fontFamily: "Inter, Arial, sans-serif" }}
          >
            {isLoading && <Loader2 className="mr-2 h-5 w-5 animate-spin" />}
            Send Reset Link
          </Button>

          <Button
            type="button"
            variant="outline"
            onClick={() => navigate("/login")}
            className="w-full border-[#4B2A06] text-[#4B2A06] text-xl font-bold py-6 rounded-xl shadow-none hover:bg-[#f9f5f1] transition h-16"
            style={{ fontFamily: "Inter, Arial, sans-serif" }}
          >
            Back to Login
          </Button>
        </div>
      </form>
    </Form>
  );
}
