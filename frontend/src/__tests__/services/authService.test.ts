import { describe, it, expect, vi, beforeEach } from "vitest";
import axios from "axios";
import { authService } from "@/services/authService";

// Mock axios
vi.mock("axios");
const mockedAxios = axios as any;

describe("authService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("login", () => {
    it("should login successfully with valid credentials", async () => {
      const mockResponse = {
        data: {
          accessToken: "mock-access-token",
          refreshToken: "mock-refresh-token",
        },
      };

      mockedAxios.post.mockResolvedValue(mockResponse);

      const result = await authService.login("test@example.com", "password123");

      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.stringContaining("/auth/login"),
        {
          email: "test@example.com",
          password: "password123",
        }
      );
      expect(result).toEqual(mockResponse.data);
    });

    it("should throw error on invalid credentials", async () => {
      const mockError = {
        response: {
          data: { message: "Invalid credentials" },
          status: 401,
        },
      };

      mockedAxios.post.mockRejectedValue(mockError);

      await expect(
        authService.login("test@example.com", "wrongpassword")
      ).rejects.toEqual(mockError);
    });
  });

  describe("register", () => {
    it("should register successfully with valid data", async () => {
      const mockResponse = {
        data: {
          message: "Registration successful. OTP sent to email.",
        },
      };

      mockedAxios.post.mockResolvedValue(mockResponse);

      const result = await authService.register({
        email: "newuser@example.com",
        password: "password123",
      });

      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.stringContaining("/auth/register"),
        {
          email: "newuser@example.com",
          password: "password123",
        }
      );
      expect(result).toEqual(mockResponse.data);
    });

    it("should throw error if user already exists", async () => {
      const mockError = {
        response: {
          data: { message: "User already exists" },
          status: 409,
        },
      };

      mockedAxios.post.mockRejectedValue(mockError);

      await expect(
        authService.register({
          email: "existing@example.com",
          password: "password123",
        })
      ).rejects.toEqual(mockError);
    });
  });

  describe("forgotPassword", () => {
    it("should send password reset email", async () => {
      const mockResponse = {
        data: {
          message: "Password reset email sent",
        },
      };

      mockedAxios.post.mockResolvedValue(mockResponse);

      const result = await authService.forgotPassword("test@example.com");

      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.stringContaining("/auth/forgot-password"),
        {
          email: "test@example.com",
        }
      );
      expect(result).toEqual(mockResponse.data);
    });
  });


  describe("verifyRegistrationOtp", () => {
    it("should verify OTP successfully", async () => {
      const mockResponse = {
        data: {
          accessToken: "mock-access-token",
          refreshToken: "mock-refresh-token",
          user: {
            id: "user-1",
            email: "test@example.com",
          },
        },
      };

      mockedAxios.post.mockResolvedValue(mockResponse);

      const result = await authService.verifyRegistrationOtp("test@example.com", "123456");

      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.stringContaining("/auth/register/verify-otp"),
        {
          email: "test@example.com",
          otp: "123456",
        }
      );
      expect(result).toEqual(mockResponse.data);
    });
  });

  describe("resetPassword", () => {
    it("should reset password with valid token and email", async () => {
      const mockResponse = {
        data: {
          message: "Password reset successful",
        },
      };

      mockedAxios.post.mockResolvedValue(mockResponse);

      const result = await authService.resetPassword(
        "test@example.com",
        "reset-token",
        "newpassword123"
      );

      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.stringContaining("/auth/reset-password"),
        {
          email: "test@example.com",
          token: "reset-token",
          password: "newpassword123",
        }
      );
      expect(result).toEqual(mockResponse.data);
    });
  });
});

