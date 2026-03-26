import React, { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { userService, User as UserType } from "@/lib/api/userService";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import {
  Loader2,
  User as UserIcon,
  Shield,
  Calendar,
  Mail,
  Phone,
  Users,
  LogOut,
  Trash2,
  FileText,
  Eye,
  EyeOff,
  Settings,
  Plus,
  X,
  Info,
  Save,
  RefreshCw
} from "lucide-react";
import { domainService, DomainConfig } from "@/services/domainService";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Navbar } from "@/components/sharedcomponents/Navbar";

// Form schemas
const profileSchema = z.object({
  name: z.string().min(1, "Name is required").optional(),
  gender: z.enum(["male", "female", "other", "prefer-not-to-say"]).optional(),
});

const passwordSchema = z
  .object({
    oldPassword: z.string().min(1, "Current password is required"),
    newPassword: z
      .string()
      .min(8, "Password must be at least 8 characters")
      .regex(/[a-z]/, "Password must contain at least one lowercase letter")
      .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
      .regex(/[0-9]/, "Password must contain at least one number")
      .regex(
        /[^a-zA-Z0-9]/,
        "Password must contain at least one special character"
      ),
    confirmPassword: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });

export default function ProfilePage() {
  const { user: currentUser } = useAuth();
  const { logout } = useAuth();
  const [activeTab, setActiveTab] = useState<
    "profile" | "summary" | "security" | "fund-config"
  >("profile");

  // Helper for initials
  const getUserInitials = (user: any) => {
    if (!user) return "U";

    // If user has a name, use first and last name initials
    if (user.name && user.name.trim()) {
      const nameParts = user.name.trim().split(" ");
      if (nameParts.length >= 2) {
        // First and last name initials
        return (
          nameParts[0][0] + nameParts[nameParts.length - 1][0]
        ).toUpperCase();
      } else {
        // Single name, use first two letters
        return user.name.substring(0, 2).toUpperCase();
      }
    }

    // Fallback to email initials
    if (user.email) {
      const [name] = user.email.split("@");
      return name
        .split(".")
        .map((word) => word[0])
        .join("")
        .toUpperCase()
        .slice(0, 2);
    }

    return "U";
  };

  // State
  const [profile, setProfile] = useState<UserType | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [showOldPassword, setShowOldPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // Check URL params for initial tab
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get("tab");
    if (tab === "fund-config" && currentUser?.role === "admin") {
      setActiveTab("fund-config");
    }
  }, [currentUser]);

  // Forms
  const profileForm = useForm<z.infer<typeof profileSchema>>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      name: "",
      gender: "prefer-not-to-say" as const,
    },
  });

  const passwordForm = useForm<z.infer<typeof passwordSchema>>({
    resolver: zodResolver(passwordSchema),
    defaultValues: {
      oldPassword: "",
      newPassword: "",
      confirmPassword: "",
    },
  });

  // Load user profile
  useEffect(() => {
    if (currentUser) {
      loadProfile();
    }
  }, [currentUser]);

  const loadProfile = async () => {
    try {
      setLoading(true);
      const profileData = await userService.getMyProfile();
      setProfile(profileData);
      profileForm.reset({
        name: profileData.name || "",
        gender: profileData.gender || "prefer-not-to-say",
      });
    } catch (error: any) {
      const message =
        error.response?.data?.message ||
        error.message ||
        "Failed to load profile";
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  const [otpOpen, setOtpOpen] = useState(false);
  const [otpValue, setOtpValue] = useState("");
  const [pendingUpdate, setPendingUpdate] = useState<any>(null);

  const handleUpdateProfile = async (data: z.infer<typeof profileSchema>) => {
    try {
      setActionLoading("profile");
      setPendingUpdate(data);
      await userService.initiateProfileUpdateOtp(data);
      setOtpOpen(true);
      toast.success("OTP sent to your email");
    } catch (error: any) {
      const message =
        error.response?.data?.message ||
        error.message ||
        "Failed to initiate verification";
      toast.error(message);
    } finally {
      setActionLoading(null);
    }
  };

  const handleVerifyOtp = async () => {
    try {
      setActionLoading("otp");
      if (pendingUpdate) {
        // Profile update flow
        await userService.verifyProfileUpdateOtp(otpValue);
        toast.success("Profile updated successfully");
      } else {
        // Password change flow
        await userService.verifyPasswordChangeOtp(otpValue);
        toast.success("Password changed successfully");
        passwordForm.reset();
      }
      setOtpOpen(false);
      setOtpValue("");
      setPendingUpdate(null);
      loadProfile();
    } catch (error: any) {
      const message = error.response?.data?.message || error.message || "Failed to verify OTP";
      toast.error(message);
    } finally {
      setActionLoading(null);
    }
  };

  const handleChangePassword = async (data: z.infer<typeof passwordSchema>) => {
    try {
      setActionLoading("password");
      await userService.changeMyPassword({
        oldPassword: data.oldPassword,
        newPassword: data.newPassword,
      });
      // OTP will be sent by backend
      setOtpOpen(true);
      toast.success("OTP sent to your email");
    } catch (error: any) {
      const message =
        error.response?.data?.message || "Failed to change password";
      toast.error(message);
    } finally {
      setActionLoading(null);
    }
  };

  const handleDeleteAccount = async () => {
    const ok = confirm(
      "Are you sure you want to delete your account? This cannot be undone."
    );
    if (!ok) return;
    try {
      // Placeholder: implement API when available
      toast.error("Delete account endpoint not implemented yet.");
    } catch (e) {
      toast.error("Failed to delete account");
    }
  };

  if (loading) {
    return (
      <div className="container mx-auto p-6">
        <div className="flex justify-center items-center h-64">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="container mx-auto p-6">
        <div className="text-center">
          <p className="text-gray-500">Profile not found</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      <Navbar
        title="Settings"
        showSearch={true}
        searchValue=""
        onSearchChange={() => { }}
      />
      <div className="fixed w-[100vw] mx-auto h-[100vh] ">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 ">
          {/* Sidebar */}
          <aside className="w-[22vw] h-[90vh] lg:col-span-1  sticky top-[80px] self-start border-r border-gray-200 py-6 pl-6">
            <h1 className="text-3xl font-bold mb-4">Settings</h1>
            <button
              onClick={() => setActiveTab("profile")}
              className={`w-full text-left px-4 py-8 flex flex-col gap-1 ${activeTab === "profile"
                ? "bg-[#ECE9E2] text-[#4B2A06] border-r-[4px] border-r-[#4B2A06]"
                : "bg-white hover:bg-gray-50"
                }`}
            >
              <div className="flex items-center gap-2 text-base font-semibold">
                <UserIcon className="h-4 w-4" /> Profile
              </div>
              <div className="text-xs leading-snug">
                Settings related to your personal information and account
              </div>
            </button>
            <button
              onClick={() => setActiveTab("summary")}
              className={`w-full text-left px-4 py-8  flex flex-col gap-1 ${activeTab === "summary"
                ? "bg-[#ECE9E2] text-[#4B2A06] border-r-[4px] border-r-[#4B2A06]"
                : "bg-white hover:bg-gray-50"
                }`}
            >
              <div className="flex items-center gap-2 text-base font-semibold">
                <FileText className="h-4 w-4" />
                Account summary
              </div>
              <div className="text-xs leading-snug">
                View account summary
              </div>
            </button>
            <button
              onClick={() => setActiveTab("security")}
              className={`w-full text-left px-4 py-8 flex flex-col gap-1 ${activeTab === "security"
                ? "bg-[#ECE9E2] text-[#4B2A06] border-r-[4px] border-r-[#4B2A06]"
                : "bg-white hover:bg-gray-50"
                }`}
            >
              <div className="flex items-center gap-2 text-base font-semibold">
                <Shield className="h-4 w-4" /> Security
              </div>
              <div className="text-xs leading-snug">
                All settings related to security and password
              </div>
            </button>
            {currentUser?.role === "admin" && (
              <button
                onClick={() => setActiveTab("fund-config")}
                className={`w-full text-left px-4 py-8 flex flex-col gap-1 ${activeTab === "fund-config"
                  ? "bg-[#ECE9E2] text-[#4B2A06] border-r-[4px] border-r-[#4B2A06]"
                  : "bg-white hover:bg-gray-50"
                  }`}
              >
                <div className="flex items-center gap-2 text-base font-semibold">
                  <Settings className="h-4 w-4" /> Fund Configuration
                </div>
                <div className="text-xs leading-snug">
                  Manage AI analysis settings, SOPs, and target investors
                </div>
              </button>
            )}
          </aside>

          {/* Content */}
          <section className=" w-[70vw] lg:col-span-3 space-y-6 max-h-[calc(100vh-100px)]  overflow-y-auto p-6 scrollbar-hide">

            {activeTab === "profile" && (
              <>
                {/* Profile Details */}
                <h1 className="text-3xl font-bold mb-4 mt-2">Profile Settings</h1>
                <div className=" shadow-md border-t  border-gray-200 rounded-xl">

                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-gray-500">
                      <UserIcon className="h-5 w-5 text-gray-500" />
                      Profile Information
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-1 gap-4">
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-500">
                          Email
                        </label>
                        <div className="flex items-center gap-2 p-3 rounded-md bg-white/60 border border-gray-200">
                          <Mail className="h-4 w-4 text-gray-500" />
                          <span className="font-medium">{profile.email}</span>
                        </div>
                        <p className="text-xs text-gray-500">
                          Email cannot be changed
                        </p>
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-500">
                          Role
                        </label>
                        <div className="flex items-center gap-2 p-3 rounded-md bg-white/60 border border-gray-200">
                          <Shield className="h-4 w-4 text-gray-500" />
                          <span className="px-2 py-0.5 rounded-full bg-white/80 border border-gray-200 text-sm">
                            {profile.role}
                          </span>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-500">
                          Status
                        </label>
                        <div className="flex items-center gap-2 p-3 rounded-md bg-white/60 border border-gray-200">
                          <span
                            className={`inline-block h-2.5 w-2.5 rounded-full ${profile.status === "active"
                              ? "bg-green-500"
                              : "bg-red-500"
                              }`}
                          />
                          <span className="px-2 py-0.5 rounded-full bg-white/80 border border-gray-200 text-sm capitalize">
                            {profile.status}
                          </span>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-500">
                          Member Since
                        </label>
                        <div className="flex items-center gap-2 p-3 rounded-md bg-white/60 border border-gray-200">
                          <Calendar className="h-4 w-4 text-gray-500" />
                          <span>
                            {new Date(profile.createdAt).toLocaleDateString()}
                          </span>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </div>

                {/* Profile Display */}
                <div className="shadow-md border-t  border-gray-200 rounded-xl">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <UserIcon className="h-5 w-5" />
                      Profile Display
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center gap-6">
                      <Avatar className="  h-24 w-24 ">
                        <AvatarFallback className="text-2xl font-bold bg-[#ECE9E2] text-[#4B2A06]">
                          {getUserInitials(profile)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="space-y-2">
                        <p className="text-sm text-gray-500">
                          Your profile initials will update automatically when
                          you change your name
                        </p>
                        <div className="text-sm">
                          <p>
                            <strong>Current initials:</strong>{" "}
                            {getUserInitials(profile)}
                          </p>
                          <p>
                            <strong>Based on:</strong>{" "}
                            {profile.name || profile.email}
                          </p>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </div>

                {/* Update Profile */}
                <div className="shadow-md border-t  border-gray-200 rounded-xl">
                  <CardHeader>
                    <CardTitle>Update Profile</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Form {...profileForm}>
                      <form
                        onSubmit={(e) =>
                          profileForm.handleSubmit(handleUpdateProfile)(e)
                        }
                        className="space-y-4 "
                      >
                        <FormField
                          control={profileForm.control}
                          name="name"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-gray-500">
                                Full Name
                              </FormLabel>
                              <FormControl>
                                <Input
                                  className="border border-gray-200 rounded-xl bg-white/60"
                                  placeholder="Enter your full name"
                                  {...field}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        {/* Phone number removed per requirements */}
                        <FormField
                          control={profileForm.control}
                          name="gender"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel className="flex items-center gap-2 text-gray-500">
                                <Users className="h-4 w-4" />
                                Gender
                              </FormLabel>
                              <Select
                                onValueChange={field.onChange}
                                defaultValue={field.value}
                              >
                                <FormControl>
                                  <SelectTrigger className="border border-gray-200 rounded-xl bg-white/60">
                                    <SelectValue placeholder="Select your gender" />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent className="border border-gray-200 rounded-xl bg-white">
                                  <SelectItem value="male">Male</SelectItem>
                                  <SelectItem value="female">Female</SelectItem>
                                  <SelectItem value="other">Other</SelectItem>
                                  <SelectItem value="prefer-not-to-say">
                                    Prefer not to say
                                  </SelectItem>
                                </SelectContent>
                              </Select>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <Button
                          type="submit"
                          className="bg-[#4B2A06] w-full text-white rounded-xl hover:bg-[#3a2004] transition  "
                          disabled={actionLoading === "profile"}
                        >
                          {actionLoading === "profile" && (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          )}
                          Update Profile
                        </Button>
                      </form>
                    </Form>
                  </CardContent>
                </div>

                {/* OTP Modal */}
                {otpOpen && (
                  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
                    <div className="bg-white w-full max-w-sm rounded-xl shadow-lg p-6">
                      <h3 className="text-lg font-semibold mb-2">Verify Profile Update</h3>
                      <p className="text-sm text-gray-500 mb-4">
                        Enter the 6-digit OTP sent to your email address.
                      </p>
                      <Input
                        value={otpValue}
                        onChange={(e) => setOtpValue(e.target.value.replace(/[^0-9]/g, "").slice(0, 6))}
                        placeholder="Enter OTP"
                        className="border border-gray-200 rounded-xl bg-white/60 text-center tracking-widest text-lg"
                      />
                      <div className="flex justify-end gap-2 mt-4">
                        <Button variant="ghost" onClick={() => { setOtpOpen(false); setOtpValue(""); }}>
                          Cancel
                        </Button>
                        <Button className="bg-[#4B2A06] text-white" onClick={handleVerifyOtp} disabled={actionLoading === "otp" || otpValue.length !== 6}>
                          {actionLoading === "otp" && (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          )}
                          Verify
                        </Button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Account actions */}
                <div className="shadow-md border-t  border-gray-200 rounded-xl">
                  <CardHeader>
                    <CardTitle className="text-base">Account actions</CardTitle>
                  </CardHeader>
                  <CardContent className="flex items-center justify-end gap-6 ">
                    <Button
                      variant="ghost"
                      onClick={() => logout()}
                      className="flex items-center gap-2  bg-[#ECE9E2] text-[#4B2A06] hover:bg-[#ECE9E2] transition"
                    >
                      <LogOut className="h-4 w-4" /> Log out
                    </Button>

                  </CardContent>
                </div>
              </>
            )}

            {activeTab === "security" && (
              <>
                <h1 className="text-3xl font-bold mb-4 mt-2">Security Settings</h1>
                <div className="shadow-md border-t w-full border-gray-200 rounded-xl">
                  <CardHeader>
                    <CardTitle className="text-gray-500">
                      Change Password
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Form {...passwordForm}>
                      <form
                        onSubmit={passwordForm.handleSubmit(
                          handleChangePassword
                        )}
                        className="space-y-4 w-full"
                      >
                        <FormField
                          control={passwordForm.control}
                          name="oldPassword"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Current Password</FormLabel>
                              <FormControl>
                                <div className="relative">
                                  <Input
                                    className="border border-gray-200 rounded-xl bg-white/60 pr-10"
                                    type={showOldPassword ? "text" : "password"}
                                    placeholder="Enter current password"
                                    {...field}
                                  />
                                  <button
                                    type="button"
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
                                    onClick={() => setShowOldPassword(!showOldPassword)}
                                  >
                                    {showOldPassword ? (
                                      <EyeOff className="h-4 w-4" />
                                    ) : (
                                      <Eye className="h-4 w-4" />
                                    )}
                                  </button>
                                </div>
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={passwordForm.control}
                          name="newPassword"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>New Password</FormLabel>
                              <FormControl>
                                <div className="relative">
                                  <Input
                                    className="border border-gray-200 rounded-xl bg-white/60 pr-10"
                                    type={showNewPassword ? "text" : "password"}
                                    placeholder="Enter new password"
                                    {...field}
                                  />
                                  <button
                                    type="button"
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
                                    onClick={() => setShowNewPassword(!showNewPassword)}
                                  >
                                    {showNewPassword ? (
                                      <EyeOff className="h-4 w-4" />
                                    ) : (
                                      <Eye className="h-4 w-4" />
                                    )}
                                  </button>
                                </div>
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={passwordForm.control}
                          name="confirmPassword"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Confirm New Password</FormLabel>
                              <FormControl>
                                <div className="relative">
                                  <Input
                                    className="border border-gray-200 rounded-xl bg-white/60 pr-10"
                                    type={
                                      showConfirmPassword ? "text" : "password"
                                    }
                                    placeholder="Confirm new password"
                                    {...field}
                                  />
                                  <button
                                    type="button"
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
                                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                                  >
                                    {showConfirmPassword ? (
                                      <EyeOff className="h-4 w-4" />
                                    ) : (
                                      <Eye className="h-4 w-4" />
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
                          className="bg-[#4B2A06] w-full text-white rounded-xl hover:bg-[#3a2004]  "
                          disabled={actionLoading === "password"}
                        >
                          {actionLoading === "password" && (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          )}
                          Change Password
                        </Button>
                      </form>
                    </Form>
                  </CardContent>
                </div>

                {/* Security Tips */}
                <div className="shadow-md border-t  border-gray-200 rounded-xl">
                  <CardHeader>
                    <CardTitle className="text-lg ">Security Tips</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="text-sm space-y-2">
                      <p className="text-gray-500">
                        • Use a strong, unique password
                      </p>
                      <p className="text-gray-500">
                        • Never share your credentials
                      </p>
                      <p className="text-gray-500">
                        • Log out when using shared devices
                      </p>
                      <p className="text-gray-500">
                        • Keep your email address updated
                      </p>
                    </div>
                  </CardContent>
                </div>
              </>
            )}

            {activeTab === "summary" && (
              <>
                <h1 className="text-3xl font-bold mb-4 mt-2">Account Summary</h1>
                <div className="shadow-md border-t  border-gray-200 rounded-xl">

                  <CardContent className=" mt-4 space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-500">
                        Account Type
                      </span>
                      <Badge
                        variant={
                          profile.role === "admin" ? "default" : "secondary"
                        }
                      >
                        {profile.role === "admin"
                          ? "Administrator"
                          : "Regular User"}
                      </Badge>
                    </div>
                    <Separator />
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-500">
                        Account Status
                      </span>
                      <Badge
                        variant={
                          profile.status === "active"
                            ? "default"
                            : "secondary"
                        }
                      >
                        {profile.status === "active" ? "Active" : "Suspended"}
                      </Badge>
                    </div>
                    <Separator />
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-500">Last Login</span>
                      <span className="text-sm font-medium">
                        {new Date(profile.lastLogin).toLocaleDateString()}
                      </span>
                    </div>
                  </CardContent>
                </div>
              </>
            )}

            {activeTab === "fund-config" && currentUser?.role === "admin" && (
              <FundConfigSection />
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

// Sub-component for Fund Configuration to keep main component clean
function FundConfigSection() {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [config, setConfig] = useState<DomainConfig | null>(null);
  const [newInvestor, setNewInvestor] = useState("");
  const [newMonitoredCompany, setNewMonitoredCompany] = useState("");

  useEffect(() => {
    fetchConfig();
  }, []);

  const fetchConfig = async () => {
    setLoading(true);
    try {
      const data = await domainService.getConfig();
      setConfig(data);
    } catch (error) {
      console.error("Failed to fetch domain config:", error);
      toast.error("Failed to load fund settings");
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!config) return;
    setSaving(true);
    try {
      await domainService.updateConfig(config);
      toast.success("Fund settings updated successfully");
    } catch (error) {
      console.error("Failed to update config:", error);
      toast.error("Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  const handleAddInvestor = () => {
    if (!newInvestor.trim() || !config) return;

    let namesToAdd: string[] = [];

    // 1. Try to parse as JSON array first
    const trimmedInput = newInvestor.trim();
    if (trimmedInput.startsWith('[') && trimmedInput.endsWith(']')) {
      try {
        const parsed = JSON.parse(trimmedInput);
        if (Array.isArray(parsed)) {
          namesToAdd = parsed.map(n => String(n).trim()).filter(n => n.length > 0);
        }
      } catch (e) {
        // If not valid JSON, we'll fall through to delimiter-based splitting
        console.warn("Invalid JSON format for investors, falling back to delimiter split");
      }
    }

    // 2. If JSON parsing didn't find anything, split by common delimiters (comma, newline, semicolon)
    if (namesToAdd.length === 0) {
      namesToAdd = newInvestor
        .split(/[,\n;]+/)
        .map(n => n.trim())
        .filter(n => n.length > 0);
    }

    if (namesToAdd.length === 0) return;

    // Filter out duplicates within the current input and against existing config
    const uniqueIncoming = Array.from(new Set(namesToAdd));
    const currentInvestors = config.target_investors || [];
    const newUniqueNames = uniqueIncoming.filter(name => !currentInvestors.includes(name));

    if (newUniqueNames.length > 0) {
      setConfig({
        ...config,
        target_investors: [...currentInvestors, ...newUniqueNames]
      });

      if (newUniqueNames.length > 1) {
        toast.success(`Successfully added ${newUniqueNames.length} investors`);
      }
    } else if (uniqueIncoming.length > 0) {
      toast.info("Investors already exist in the list");
    }

    setNewInvestor("");
  };

  const handleRemoveInvestor = (investor: string) => {
    if (!config) return;
    setConfig({
      ...config,
      target_investors: config.target_investors.filter(i => i !== investor)
    });
  };

  const handleAddMonitoredCompany = () => {
    if (!newMonitoredCompany.trim() || !config) return;

    const namesToAdd = newMonitoredCompany
      .split(/[,\n;]+/)
      .map(n => n.trim())
      .filter(n => n.length > 0);

    if (namesToAdd.length === 0) return;

    const uniqueIncoming = Array.from(new Set(namesToAdd));
    const currentCompanies = config.monitored_companies || [];
    const newUniqueNames = uniqueIncoming.filter(name => !currentCompanies.includes(name));

    if (newUniqueNames.length > 0) {
      setConfig({
        ...config,
        monitored_companies: [...currentCompanies, ...newUniqueNames]
      });

      if (newUniqueNames.length > 1) {
        toast.success(`Broadened monitoring scope to include ${newUniqueNames.length} entities`);
      } else {
        toast.success(`Broadened monitoring scope to include ${newUniqueNames[0]}`);
      }
    } else if (uniqueIncoming.length > 0) {
      toast.info("Companies already in monitoring list");
    }
    setNewMonitoredCompany("");
  };

  const handleRemoveMonitoredCompany = (company: string) => {
    if (!config) return;
    setConfig({
      ...config,
      monitored_companies: config.monitored_companies.filter(c => c !== company)
    });
  };



  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center justify-between mb-4 mt-2">
        <h1 className="text-3xl font-bold">Admin Configuration</h1>
        <Button onClick={handleSave} disabled={saving} className="gap-2 bg-[#4B2A06] text-white hover:bg-[#3a2004]">
          <Save className="h-4 w-4" />
          {saving ? "Saving..." : "Save Changes"}
        </Button>
      </div>

      <div className="shadow-md border border-gray-200 rounded-xl bg-white mb-6">
        <CardHeader>
          <CardTitle className="text-xl">AI Features</CardTitle>
          <div className="text-sm text-muted-foreground">Customize how the AI analyzes documents for your fund.</div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Toggle 1 */}
            <div className="flex flex-col space-y-3 p-4 border rounded-xl bg-gray-50/50">
              <div className="flex items-center justify-between">
                <Label htmlFor="investor-match" className="font-semibold">Investor Matching</Label>
                <Switch
                  id="investor-match"
                  checked={config?.investor_match_only ?? true}
                  onCheckedChange={(checked) => setConfig(prev => prev ? ({ ...prev, investor_match_only: checked }) : null)}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Identify and extract shareholders from your target list automatically.
              </p>
            </div>

            {/* Toggle 2 */}
            <div className="flex flex-col space-y-3 p-4 border rounded-xl bg-gray-50/50">
              <div className="flex items-center justify-between">
                <Label htmlFor="valuation-match" className="font-semibold">Valuation Analysis</Label>
                <Switch
                  id="valuation-match"
                  checked={config?.valuation_matching ?? true}
                  onCheckedChange={(checked) => setConfig(prev => prev ? ({ ...prev, valuation_matching: checked }) : null)}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Extract share capital history and calculate premium round valuations.
              </p>
            </div>

            {/* Toggle 3 */}
            <div className="flex flex-col space-y-3 p-4 border rounded-xl bg-gray-50/50">
              <div className="flex items-center justify-between">
                <Label htmlFor="adverse-finding" className="font-semibold">Adverse Findings</Label>
                <Switch
                  id="adverse-finding"
                  checked={config?.adverse_finding ?? true}
                  onCheckedChange={(checked) => setConfig(prev => prev ? ({ ...prev, adverse_finding: checked }) : null)}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Run external OSINT checks for red flags and reputational risks.
              </p>
            </div>

            {/* Toggle 4 */}
            <div className="flex flex-col space-y-3 p-4 border rounded-xl bg-gray-50/50">
              <div className="flex items-center justify-between">
                <Label htmlFor="news-monitor" className="font-semibold">Web Crawl (News Monitoring)</Label>
                <Switch
                  id="news-monitor"
                  checked={config?.news_monitor_enabled ?? false}
                  onCheckedChange={(checked) => setConfig(prev => prev ? ({ ...prev, news_monitor_enabled: checked }) : null)}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Monitor news and web updates for specified companies and entities.
              </p>
            </div>

          </div>
        </CardContent>
      </div>



      <div className="shadow-md border border-gray-200 rounded-xl bg-white mb-6">
        <CardHeader>
          <div className="flex items-center gap-2">
            <CardTitle className="text-xl">Target Investors List</CardTitle>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger>
                  <Info className="h-4 w-4 text-muted-foreground" />
                </TooltipTrigger>
                <TooltipContent>
                  <p className="max-w-xs">List specific investors to track. You can paste a single name, a comma-separated list, or a JSON array.</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2 max-w-md">
            <Input
              placeholder="Add name, comma-separated list, or JSON array..."
              value={newInvestor}
              onChange={(e) => setNewInvestor(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddInvestor()}
              className="border-gray-200 bg-white"
            />
            <Button variant="secondary" size="icon" onClick={handleAddInvestor} className="shrink-0">
              <Plus className="h-4 w-4" />
            </Button>
          </div>

          <div className="flex flex-wrap gap-2 p-4 border rounded-xl bg-gray-50/50 min-h-[100px]">
            {config?.target_investors?.length === 0 && (
              <span className="text-sm text-muted-foreground italic self-center">No target investors added yet.</span>
            )}
            {config?.target_investors?.map((investor, idx) => (
              <Badge key={idx} variant="secondary" className="pl-3 pr-2 py-1.5 gap-2 text-sm font-normal bg-white border border-gray-200 shadow-sm">
                {investor}
                <button
                  onClick={() => handleRemoveInvestor(investor)}
                  className="text-gray-400 hover:text-red-500 transition-colors focus:outline-none"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </Badge>
            ))}
          </div>
        </CardContent>
      </div>

      <div className="shadow-md border border-gray-200 rounded-xl bg-white mb-6">
        <CardHeader>
          <div className="flex items-center gap-2">
            <CardTitle className="text-xl">Monitored Companies List</CardTitle>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger>
                  <Info className="h-4 w-4 text-muted-foreground" />
                </TooltipTrigger>
                <TooltipContent>
                  <p className="max-w-xs">List companies or entities to monitor across the web and news sources.</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2 max-w-md">
            <Input
              placeholder="Add company name to monitor..."
              value={newMonitoredCompany}
              onChange={(e) => setNewMonitoredCompany(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddMonitoredCompany()}
              className="border-gray-200 bg-white"
            />
            <Button variant="secondary" size="icon" onClick={handleAddMonitoredCompany} className="shrink-0">
              <Plus className="h-4 w-4" />
            </Button>
          </div>

          <div className="flex flex-wrap gap-2 p-4 border rounded-xl bg-gray-50/50 min-h-[100px]">
            {config?.monitored_companies?.length === 0 && (
              <span className="text-sm text-muted-foreground italic self-center">No companies added for monitoring yet.</span>
            )}
            {config?.monitored_companies?.map((company, idx) => (
              <Badge key={idx} variant="secondary" className="pl-3 pr-2 py-1.5 gap-2 text-sm font-normal bg-white border border-gray-200 shadow-sm">
                {company}
                <button
                  onClick={() => handleRemoveMonitoredCompany(company)}
                  className="text-gray-400 hover:text-red-500 transition-colors focus:outline-none"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </Badge>
            ))}
          </div>
        </CardContent>
      </div>

      <div className="shadow-md border border-gray-200 rounded-xl bg-white mb-6">
        <CardHeader>
          <CardTitle className="text-xl">AI Agent Prompts</CardTitle>
          <div className="text-sm text-muted-foreground">Manage system prompts and subqueries for all extraction agents.</div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label className="font-semibold text-lg">Agent 3 Prompt (Business Table Extractor)</Label>
            <Textarea
              className="min-h-[300px] font-mono text-sm leading-relaxed border-gray-200 bg-gray-50/30 p-4 rounded-xl focus:ring-1 focus:ring-[#4B2A06]"
              placeholder="Enter Agent 3 Prompt..."
              value={config?.agent3_prompt || ""}
              onChange={(e) => setConfig(prev => prev ? ({ ...prev, agent3_prompt: e.target.value }) : null)}
            />
          </div>

          <div className="space-y-2">
            <Label className="font-semibold text-lg">Agent 3 Subqueries (One per line)</Label>
            <Textarea
              className="min-h-[200px] font-mono text-sm leading-relaxed border-gray-200 bg-gray-50/30 p-4 rounded-xl focus:ring-1 focus:ring-[#4B2A06]"
              placeholder="Enter Agent 3 Subqueries..."
              value={config?.agent3_subqueries?.join('\n') || ""}
              onChange={(e) => setConfig(prev => prev ? ({ ...prev, agent3_subqueries: e.target.value.split('\n').filter(s => s.trim() !== "") }) : null)}
            />
          </div>

          <div className="space-y-2">
            <Label className="font-semibold text-lg">Agent 4 Prompt (Main Summary Generator)</Label>
            <Textarea
              className="min-h-[400px] font-mono text-sm leading-relaxed border-gray-200 bg-gray-50/30 p-4 rounded-xl focus:ring-1 focus:ring-[#4B2A06]"
              placeholder="Enter Agent 4 Prompt..."
              value={config?.agent4_prompt || ""}
              onChange={(e) => setConfig(prev => prev ? ({ ...prev, agent4_prompt: e.target.value }) : null)}
            />
          </div>

          <div className="space-y-2">
            <Label className="font-semibold text-lg">Agent 4 Subqueries (One per line)</Label>
            <Textarea
              className="min-h-[300px] font-mono text-sm leading-relaxed border-gray-200 bg-gray-50/30 p-4 rounded-xl focus:ring-1 focus:ring-[#4B2A06]"
              placeholder="Enter Agent 4 Subqueries..."
              value={config?.agent4_subqueries?.join('\n') || ""}
              onChange={(e) => setConfig(prev => prev ? ({ ...prev, agent4_subqueries: e.target.value.split('\n').filter(s => s.trim() !== "") }) : null)}
            />
          </div>

          <div className="space-y-2 pt-4 border-t border-gray-100">
            <Label className="font-semibold text-lg">Agent 5 Prompt (Adverse Findings Research)</Label>
            <Textarea
              className="min-h-[250px] font-mono text-sm leading-relaxed border-gray-200 bg-gray-50/30 p-4 rounded-xl focus:ring-1 focus:ring-[#4B2A06]"
              placeholder="Enter Agent 5 Prompt..."
              value={config?.agent5_prompt || ""}
              onChange={(e) => setConfig(prev => prev ? ({ ...prev, agent5_prompt: e.target.value }) : null)}
            />
          </div>
        </CardContent>
      </div>

      {/* Task 0: Base SOP Text */}
      <div className="shadow-md border border-gray-200 rounded-xl bg-white mb-6">
        <CardHeader>
          <div className="flex items-center gap-2">
            <CardTitle className="text-xl">Fund SOP (Base Document)</CardTitle>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger>
                  <Info className="h-4 w-4 text-muted-foreground" />
                </TooltipTrigger>
                <TooltipContent>
                  <p className="max-w-xs">The raw Standard Operating Procedure (SOP) text analyzed by the AI to build your custom pipeline.</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <div className="text-sm text-muted-foreground">
            View the base text used for pipeline configuration.
          </div>
        </CardHeader>
        <CardContent>
          <Textarea
            className="min-h-[200px] font-mono text-sm leading-relaxed border-gray-200 bg-gray-50/30 p-4 rounded-xl focus:ring-1 focus:ring-[#4B2A06]"
            placeholder="No SOP text available. Upload an SOP via onboarding to populate this."
            value={config?.sop_text || ""}
            onChange={(e) => setConfig(prev => prev ? ({ ...prev, sop_text: e.target.value }) : null)}
          />
        </CardContent>
      </div>
    </>
  );
}
