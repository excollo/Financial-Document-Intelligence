import axios from "axios";

const API_URL = import.meta.env.VITE_API_URL;
console.log("API_URL in userService:", API_URL);

// Types
export interface User {
  _id: string;
  email: string;
  name?: string;
  domain: string;
  role: "admin" | "user";
  status: "active" | "suspended";
  gender?: "male" | "female" | "other" | "prefer-not-to-say";
  createdAt: string;
  lastLogin: string;
}

export interface CreateUserRequest {
  email: string;
  name?: string;
  password?: string;
  role?: "admin" | "user";
}

export interface UpdateUserRequest {
  name?: string;
  role?: "admin" | "user";
  status?: "active" | "suspended";
}

export interface UpdateProfileRequest {
  name?: string;
  gender?: "male" | "female" | "other" | "prefer-not-to-say";
}

export interface ChangePasswordRequest {
  oldPassword: string;
  newPassword: string;
}

export interface UserStats {
  total: number;
  active: number;
  suspended: number;
  admins: number;
  users: number;
}

export interface UsersResponse {
  users: User[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}

export const userService = {
  // Admin: Get all users with pagination, search, and filters
  async getAllUsers(params: {
    page?: number;
    limit?: number;
    search?: string;
    role?: string;
    status?: string;
  }): Promise<UsersResponse> {
    const queryParams = new URLSearchParams();
    if (params.page) queryParams.append("page", params.page.toString());
    if (params.limit) queryParams.append("limit", params.limit.toString());
    if (params.search) queryParams.append("search", params.search);
    if (params.role) queryParams.append("role", params.role);
    if (params.status) queryParams.append("status", params.status);

    const response = await axios.get(
      `${API_URL}/users?${queryParams.toString()}`
    );
    return response.data;
  },

  // Admin: Get user statistics
  async getUserStats(): Promise<UserStats> {
    const response = await axios.get(`${API_URL}/users/stats`);
    return response.data;
  },

  // Admin: Get single user by ID
  async getUserById(userId: string): Promise<User> {
    const response = await axios.get(`${API_URL}/users/${userId}`);
    return response.data;
  },

  // Admin: Create new user
  async createUser(userData: CreateUserRequest): Promise<User> {
    const response = await axios.post(`${API_URL}/users`, userData);
    return response.data;
  },

  // Admin: Update user
  async updateUser(userId: string, userData: UpdateUserRequest): Promise<User> {
    const response = await axios.put(`${API_URL}/users/${userId}`, userData);
    return response.data;
  },

  // Admin: Delete user (soft delete - sets status to suspended)
  async deleteUser(userId: string): Promise<{ message: string }> {
    const response = await axios.delete(`${API_URL}/users/${userId}`);
    return response.data;
  },

  // Admin: Activate/Reactivate user
  async activateUser(userId: string): Promise<{ message: string; user: User }> {
    const response = await axios.patch(`${API_URL}/users/${userId}/activate`);
    return response.data;
  },

  // User: Get own profile
  async getMyProfile(): Promise<User> {
    const response = await axios.get(`${API_URL}/users/me/profile`);
    return response.data;
  },

  // User: Update own profile
  async updateMyProfile(profileData: UpdateProfileRequest): Promise<User> {
    const response = await axios.put(
      `${API_URL}/users/me/profile`,
      profileData
    );
    return response.data;
  },

  // User: Change own password
  async changeMyPassword(
    passwordData: ChangePasswordRequest
  ): Promise<{ message: string }> {
    const response = await axios.put(
      `${API_URL}/users/me/password`,
      passwordData
    );
    return response.data;
  },

  async verifyPasswordChangeOtp(otp: string): Promise<{ message: string }> {
    const response = await axios.post(
      `${API_URL}/users/me/password/otp-verify`,
      { otp }
    );
    return response.data;
  },

  // User: Initiate OTP for profile update
  async initiateProfileUpdateOtp(pendingUpdate: UpdateProfileRequest): Promise<{ message: string }> {
    const response = await axios.post(
      `${API_URL}/users/me/profile/otp-initiate`,
      { pendingUpdate }
    );
    return response.data;
  },

  // User: Verify OTP and apply update
  async verifyProfileUpdateOtp(otp: string): Promise<{ message: string; user: User }> {
    const response = await axios.post(
      `${API_URL}/users/me/profile/otp-verify`,
      { otp }
    );
    return response.data;
  },
};
