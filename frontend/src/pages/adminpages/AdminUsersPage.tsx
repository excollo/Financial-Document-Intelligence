import React, { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import {
  userService,
  User,
  CreateUserRequest,
  UpdateUserRequest,
} from "@/lib/api/userService";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import {
  Loader2,
  Plus,
  Search,
  Edit,
  Trash2,
  UserPlus,
  Users,
  UserCheck,
  UserX,
  MoreVertical,
  Home,
  Globe,
  Settings,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Navbar } from "@/components/sharedcomponents/Navbar";

// Form schemas
const createUserSchema = z.object({
  email: z.string().email("Invalid email address"),
  name: z.string().min(2, "Name must be at least 2 characters"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  role: z.enum(["admin", "user"]),
});

const updateUserSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  role: z.enum(["admin", "user"]),
  status: z.enum(["active", "suspended"]),
});

export default function AdminUsersPage() {
  const { user: currentUser } = useAuth();
  const navigate = useNavigate();

  // State
  const [users, setUsers] = useState<User[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalUsers, setTotalUsers] = useState(0);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
  const [bucketDialogFor, setBucketDialogFor] = useState<User | null>(null);
  const [bucketValue, setBucketValue] = useState<
    "today" | "last7" | "last15" | "last30" | "last90" | "all"
  >("today");

  // Forms
  const createForm = useForm<z.infer<typeof createUserSchema>>({
    resolver: zodResolver(createUserSchema),
    defaultValues: {
      email: "",
      name: "",
      password: "",
      role: "user",
    },
  });

  const updateForm = useForm<z.infer<typeof updateUserSchema>>({
    resolver: zodResolver(updateUserSchema),
    defaultValues: {
      name: "",
      role: "user",
      status: "active",
    },
  });

  // Check if user is admin
  useEffect(() => {
    if (currentUser && currentUser.role !== "admin") {
      toast.error("Access denied. Admin privileges required.");
      navigate("/dashboard");
    }
  }, [currentUser, navigate]);

  // Load users and stats
  useEffect(() => {
    if (currentUser?.role === "admin") {
      loadUsers();
      loadStats();
    }
  }, [currentUser, currentPage, searchTerm, roleFilter, statusFilter]);

  const loadUsers = async () => {
    try {
      setLoading(true);
      const response = await userService.getAllUsers({
        page: currentPage,
        limit: 20,
        search: searchTerm || undefined,
        role: roleFilter !== "all" ? roleFilter : undefined,
        status: statusFilter !== "all" ? statusFilter : undefined,
      });
      setUsers(response.users);
      setTotalPages(response.pagination.pages);
      setTotalUsers(response.pagination.total);
    } catch (error) {
      console.error("Error loading users:", error);
      toast.error("Failed to load users");
    } finally {
      setLoading(false);
    }
  };

  const loadStats = async () => {
    try {
      const statsData = await userService.getUserStats();
      setStats(statsData);
    } catch (error) {
      console.error("Error loading stats:", error);
    }
  };

  const handleCreateUser = async (data: z.infer<typeof createUserSchema>) => {
    try {
      setActionLoading("create");
      const createUserData: CreateUserRequest = {
        email: data.email,
        name: data.name,
        password: data.password,
        role: data.role,
      };
      await userService.createUser(createUserData);
      toast.success("User created successfully");
      setIsCreateDialogOpen(false);
      createForm.reset();
      loadUsers();
      loadStats();
    } catch (error: any) {
      const message = error.response?.data?.message || "Failed to create user";
      toast.error(message);
    } finally {
      setActionLoading(null);
    }
  };

  const handleUpdateUser = async (data: z.infer<typeof updateUserSchema>) => {
    if (!selectedUser) return;

    try {
      setActionLoading("update");
      await userService.updateUser(selectedUser._id, data);
      toast.success("User updated successfully");
      setIsEditDialogOpen(false);
      setSelectedUser(null);
      updateForm.reset();
      loadUsers();
      loadStats();
    } catch (error: any) {
      const message = error.response?.data?.message || "Failed to update user";
      toast.error(message);
    } finally {
      setActionLoading(null);
    }
  };

  const handleDeleteUser = async (userId: string) => {
    if (!confirm("Are you sure you want to deactivate this user?")) return;

    try {
      setActionLoading(`delete-${userId}`);
      await userService.deleteUser(userId);
      toast.success("User deactivated successfully");
      loadUsers();
      loadStats();
    } catch (error: any) {
      const message =
        error.response?.data?.message || "Failed to deactivate user";
      toast.error(message);
    } finally {
      setActionLoading(null);
    }
  };

  const handleActivateUser = async (userId: string) => {
    try {
      setActionLoading(`activate-${userId}`);
      await userService.activateUser(userId);
      toast.success("User activated successfully");
      loadUsers();
      loadStats();
    } catch (error: any) {
      const message =
        error.response?.data?.message || "Failed to activate user";
      toast.error(message);
    } finally {
      setActionLoading(null);
    }
  };

  const openEditDialog = (user: User) => {
    setSelectedUser(user);
    updateForm.reset({
      name: user.name || "",
      role: user.role,
      status: user.status,
    });
    setIsEditDialogOpen(true);
  };

  const handleSearch = (value: string) => {
    setSearchTerm(value);
    setCurrentPage(1);
  };

  const handleFilterChange = (type: "role" | "status", value: string) => {
    if (type === "role") {
      setRoleFilter(value);
    } else {
      setStatusFilter(value);
    }
    setCurrentPage(1);
  };

  const handleSelectUser = (userId: string) => {
    setSelectedUsers((prev) =>
      prev.includes(userId)
        ? prev.filter((id) => id !== userId)
        : [...prev, userId]
    );
  };

  const handleSelectAll = () => {
    if (selectedUsers.length === users.length) {
      setSelectedUsers([]);
    } else {
      setSelectedUsers(users.map((user) => user._id));
    }
  };

  if (currentUser?.role !== "admin") {
    return null;
  }

  return (
    <div className="min-h-screen bg-white">
      <Navbar
        title="User Management"
        showSearch={false}
        searchValue=""
        onSearchChange={() => {}}
      />

      <div className="w-[90vw] mx-auto py-8">
        {/* Key Metrics Cards */}
        {stats && (
          <div className="w-[80vw]  grid grid-cols-1 md:grid-cols-5 gap-4 mb-8">
            <Card className="bg-[rgba(99,117,135,1)] text-white">
              <CardContent className="p-4">
                <div className="flex items-start gap-2">
                  {/* <Users className="h-4 w-4 mt-0.5 flex-shrink-0" /> */}
                  <div className="flex-1">
                    <p className="text-sm text-white font-bold flex items-center">Total Users</p>
                    <p className="text-2xl font-bold">{stats.total}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="bg-[rgba(99,117,135,1)] text-white">
              <CardContent className="p-4">
                <div className="flex items-start gap-2">
                  {/* <UserCheck className="h-4 w-4 mt-0.5 flex-shrink-0" /> */}
                  <div className="flex-1">
                    <p className="text-sm text-white font-bold flex items-center">Active Users</p>
                    <p className="text-2xl font-bold">{stats.active}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="bg-[rgba(99,117,135,1)] text-white">
              <CardContent className="p-4">
                <div className="flex items-start gap-2">
                  {/* <Shield className="h-4 w-4 mt-0.5 flex-shrink-0" /> */}
                  <div className="flex-1">
                    <p className="text-sm text-white flex font-bold items-center">Admins</p>
                    <p className="text-2xl font-bold">{stats.admins}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="bg-[rgba(99,117,135,1)] text-white">
              <CardContent className="p-4">
                <div className="flex items-start gap-2">
                  {/* <Users className="h-4 w-4 mt-0.5 flex-shrink-0" /> */}
                  <div className="flex-1">
                    <p className="text-sm text-white flex font-bold items-center">Regular Users</p>
                    <p className="text-2xl font-bold">{stats.users}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="bg-[rgba(99,117,135,1)] text-white">
              <CardContent className="p-4">
                <div className="flex items-start gap-2">
                  {/* <UserX className="h-4 w-4 mt-0.5 flex-shrink-0" /> */}
                  <div className="flex-1">
                    <p className="text-sm text-white flex font-bold items-center">Suspended</p>
                    <p className="text-2xl font-bold">{stats.suspended}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Search Bar - Full Width */}
        <div className="mb-6">
          <div className="flex items-center justify-between">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                placeholder="Search"
                value={searchTerm}
                onChange={(e) => handleSearch(e.target.value)}
                className="pl-10 bg-gray-100 border-gray-200 rounded-lg focus:ring-0 focus:outline-none bg-white"
              />
            </div>
            <div className="text-sm text-gray-500 ml-4">Date : All</div>
          </div>
        </div>

        {/* Users Section - No Card, No Border */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-gray-900">
              Users ({totalUsers})
            </h2>
            <Dialog
              open={isCreateDialogOpen}
              onOpenChange={setIsCreateDialogOpen}
            >
              <DialogTrigger asChild>
                <Button className="flex items-center gap-2 bg-[rgba(99,117,135,1)] text-white hover:bg-[rgba(99,117,135,1)] hover:text-white focus:ring-0 focus:outline-none">
                  <UserPlus className="h-4 w-4" />
                  Add User
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md bg-white">
                <DialogHeader>
                  <DialogTitle>Create New User</DialogTitle>
                </DialogHeader>
                <Form {...createForm}>
                  <form
                    onSubmit={createForm.handleSubmit(handleCreateUser)}
                    className="space-y-4"
                  >
                    <FormField
                      control={createForm.control}
                      name="email"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Email</FormLabel>
                          <FormControl>
                            <Input placeholder="user@example.com" className="bg-white border border-gray-100 rounded-lg focus:outline-none focus:ring-0" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={createForm.control}
                      name="name"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Name</FormLabel>
                          <FormControl>
                            <Input placeholder="Full Name" className="bg-white border border-gray-100 rounded-lg focus:outline-none focus:ring-0" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={createForm.control}
                      name="password"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Password</FormLabel>
                          <FormControl>
                            <Input
                              type="password"
                              placeholder="Password"
                              className="bg-white border border-gray-100 rounded-lg focus:outline-none focus:ring-0"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={createForm.control}
                      name="role"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Role</FormLabel>
                          <Select
                            onValueChange={field.onChange}
                            defaultValue={field.value}
                          >
                            <FormControl>
                              <SelectTrigger className="bg-gray-100 shadow-md  border-none focus:outline-none focus:ring-0">
                                <SelectValue className="bg-white" placeholder="Select role" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent className="bg-white border border-gray-200">
                              <SelectItem className="bg-white hover:bg-gray-100 data-[highlighted]:bg-gray-100 hover:text-[#4B2A06] " value="user">User</SelectItem>
                              <SelectItem className="bg-white hover:bg-gray-100 data-[highlighted]:bg-gray-100 hover:text-[#4B2A06] " value="admin">Admin</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <div className="flex justify-end gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setIsCreateDialogOpen(false)}
                        className="bg-gray-200 text-[#4B2A06] hover:bg-gray-200 border-none hover:text-[#4B2A06]"
                      >
                        Cancel
                      </Button>
                      <Button
                        type="submit"
                        disabled={actionLoading === "create"}
                        className="bg-[#4B2A06] text-white hover:bg-[#4B2A06]/90 border-none hover:text-white"
                      >
                        {actionLoading === "create" && (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        )}
                        Create User
                      </Button>
                    </div>
                  </form>
                </Form>
              </DialogContent>
            </Dialog>
          </div>

          {loading ? (
            <div className="flex justify-center items-center h-32">
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>
          ) : (
            <>
              <div className=" overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="text-left w-[20vw] p-3">
                        <input
                          type="checkbox"
                          checked={
                            selectedUsers.length === users.length &&
                            users.length > 0
                          }
                          onChange={handleSelectAll}
                          className="rounded border-gray-300"
                        />
                      </th>
                      <th className="text-center w-[20vw] p-3 font-medium text-gray-900">
                        User ID
                      </th>
                      <th className="text-center w-[20vw] p-3 font-medium text-gray-900">
                        User Name
                      </th>
                      <th className="text-center w-[20vw] p-3 font-medium text-gray-900">
                        Role
                      </th>
                      <th className="text-center w-[20vw] p-3 font-medium text-gray-900">
                        Status
                      </th>
                      <th className="text-right w-[20vw] p-3 font-medium text-gray-900">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((user) => (
                      <tr
                        key={user._id}
                        className="border-b border-gray-100 hover:bg-gray-50"
                      >
                        <td className=" w-[20vw] p-3">
                          <input
                            type="checkbox"
                            checked={selectedUsers.includes(user._id)}
                            onChange={() => handleSelectUser(user._id)}
                            className="rounded border-gray-300"
                          />
                        </td>
                        <td className="w-[20vw] text-center p-3 text-gray-600">
                          #{user._id.slice(-4)}
                        </td>
                        <td className="w-[20vw] text-center p-3 font-medium text-gray-900">
                          {user.name || user.email}
                        </td>
                        <td className="w-[20vw] text-center p-3 text-gray-600 capitalize">
                          {user.role}
                        </td>
                        <td className="w-[20vw] text-center p-3">
                          <span
                            className={`px-2 py-1 rounded-full text-xs font-medium ${
                              user.status === "active"
                                ? "bg-green-100 text-green-800"
                                : "bg-red-100 text-red-800"
                            }`}
                          >
                            {user.status}
                          </span>
                        </td>
                        <td className="w-[20vw] text-right p-3">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild className="hover:bg-gray-200 hover:text-[#4B2A06]">
                              <Button variant="ghost" size="sm">
                                <MoreVertical className="h-4 w-4 " />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="bg-white border border-gray-200 " >
                              <DropdownMenuItem
                                onClick={() => openEditDialog(user)}
                                className="hover:bg-white data-[highlighted]:bg-gray-100 hover:text-[#4B2A06] "
                              >
                                <Edit className="mr-2 h-4 w-4" />
                                Edit
                              </DropdownMenuItem>
                              {user.status === "active" ? (
                                <DropdownMenuItem
                                  onClick={() => handleDeleteUser(user._id)}
                                  className="text-red-600 hover:bg-white data-[highlighted]:bg-gray-100 hover:text-[#4B2A06] "
                                >
                                  <Trash2 className="mr-2 h-4 w-4" />
                                  Suspend
                                </DropdownMenuItem>
                              ) : (
                                <DropdownMenuItem
                                  onClick={() => handleActivateUser(user._id)}
                                  className="text-green-600 hover:bg-white data-[highlighted]:bg-gray-100 hover:text-[#4B2A06] "
                                >
                                  <UserCheck className="mr-2 h-4 w-4" />
                                  Activate
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex justify-center items-center gap-2 mt-4">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(currentPage - 1)}
                    disabled={currentPage === 1}
                  >
                    Previous
                  </Button>
                  <span className="text-sm">
                    Page {currentPage} of {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(currentPage + 1)}
                    disabled={currentPage === totalPages}
                  >
                    Next
                  </Button>
                </div>
              )}
            </>
          )}
        </div>

        {/* Edit User Dialog */}
        <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
          <DialogContent className="sm:max-w-md bg-white">
            <DialogHeader>
              <DialogTitle>Edit User</DialogTitle>
            </DialogHeader>
            <Form {...updateForm}>
              <form
                onSubmit={updateForm.handleSubmit(handleUpdateUser)}
                className="space-y-4 bg-white"
              >
                <FormField
                  control={updateForm.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Name</FormLabel>
                      <FormControl>
                        <Input placeholder="Full Name" className="bg-white border border-gray-100 rounded-lg focus:outline-none focus:ring-0" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={updateForm.control}
                  name="role"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Role</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        value={field.value}
                      >
                        <FormControl>
                          <SelectTrigger className="bg-gray-100 shadow-md  border-none focus:outline-none focus:ring-0">
                            <SelectValue placeholder="Select role" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent className="bg-white border border-gray-200">
                          <SelectItem className="bg-white hover:bg-gray-100 data-[highlighted]:bg-gray-100 hover:text-[#4B2A06] " value="user">User</SelectItem>
                          <SelectItem className="bg-white hover:bg-gray-100 data-[highlighted]:bg-gray-100 hover:text-[#4B2A06] " value="admin">Admin</SelectItem>
                          
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={updateForm.control}
                  name="status"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Status</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        value={field.value}
                      >
                        <FormControl>
                          <SelectTrigger className="bg-gray-100 shadow-md  border-none focus:outline-none focus:ring-0">
                            <SelectValue placeholder="Select status" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent className="bg-white border border-gray-200">
                          <SelectItem className="bg-white hover:bg-gray-100 data-[highlighted]:bg-gray-100 hover:text-[#4B2A06] " value="active">Active</SelectItem>
                          <SelectItem className="bg-white hover:bg-gray-100 data-[highlighted]:bg-gray-100 hover:text-[#4B2A06] " value="suspended">Suspended</SelectItem>
                          
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setIsEditDialogOpen(false)}
                    className="bg-gray-200 text-[#4B2A06] hover:bg-gray-200 border-none hover:text-[#4B2A06]"
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={actionLoading === "update"} className="bg-[#4B2A06] text-white hover:bg-[#4B2A06]/90 border-none hover:text-white">
                    {actionLoading === "update" && (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    )}
                    Update User
                  </Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>

        {/* Update Buckets Dialog */}
        <Dialog
          open={!!bucketDialogFor}
          onOpenChange={() => setBucketDialogFor(null)}
        >
          <DialogContent className="sm:max-w-md bg-white">
            <DialogHeader>
              <DialogTitle>Update Document Access</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="text-sm text-gray-600">
                Set how much history the user can access in this workspace.
              </div>
              <Select
                value={bucketValue}
                onValueChange={(v: any) => setBucketValue(v)}
              >
                <SelectTrigger className="bg-gray-100 border-none focus:outline-none focus:ring-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-white border border-gray-200">
                  <SelectItem className="bg-white hover:bg-gray-100 data-[highlighted]:bg-gray-100" value="today">Today</SelectItem>
                  <SelectItem className="bg-white hover:bg-gray-100 data-[highlighted]:bg-gray-100" value="last7">Last 7 days</SelectItem>
                  <SelectItem className="bg-white hover:bg-gray-100 data-[highlighted]:bg-gray-100" value="last15">Last 15 days</SelectItem>
                  <SelectItem className="bg-white hover:bg-gray-100 data-[highlighted]:bg-gray-100" value="last30">Last 30 days</SelectItem>
                  <SelectItem className="bg-white hover:bg-gray-100 data-[highlighted]:bg-gray-100" value="last90">Last 3 months</SelectItem>
                  <SelectItem className="bg-white hover:bg-gray-100 data-[highlighted]:bg-gray-100" value="all">All</SelectItem>
                </SelectContent>
              </Select>
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => setBucketDialogFor(null)}
                  className="bg-gray-200 text-[#4B2A06] hover:bg-gray-200 border-none hover:text-[#4B2A06]"
                >
                  Cancel
                </Button>
                <Button
                  onClick={async () => {
                    if (!bucketDialogFor) return;
                    try {
                      setActionLoading("update-buckets");
                      const svc = (
                        await import("@/services/workspaceInvitationService")
                      ).default;
                      await svc.updateUserBuckets(bucketDialogFor.email, [
                        bucketValue,
                      ]);
                      toast.success("Access updated");
                      setBucketDialogFor(null);
                    } catch (e: any) {
                      toast.error(
                        e.response?.data?.message || "Failed to update"
                      );
                    } finally {
                      setActionLoading(null);
                    }
                  }}
                  disabled={actionLoading === "update-buckets"}
                  className="bg-[#4B2A06] text-white hover:bg-[#4B2A06]/90 border-none hover:text-white"
                >
                  {actionLoading === "update-buckets" && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  Update
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
