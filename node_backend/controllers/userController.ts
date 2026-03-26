import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import { User } from "../models/User";
import { sendEmail } from "../services/emailService";
import { rateLimitByWorkspace } from "../middleware/rateLimitByWorkspace";

interface AuthRequest extends Request {
  user?: any;
  userDomain?: string;
}

export const userController = {
  // Admin: Get all users with pagination, search, and filters
  async getAllUsers(req: AuthRequest, res: Response) {
    try {
      const {
        page = 1,
        limit = 20,
        search = "",
        role = "",
        status = "",
      } = req.query;

      const query: any = { domain: req.user?.domain };

      // Search by email or name
      if (search) {
        query.$or = [
          { email: { $regex: search, $options: "i" } },
          { name: { $regex: search, $options: "i" } },
        ];
      }

      // Filter by role
      if (role && role !== "all") {
        query.role = role;
      }

      // Filter by status
      if (status && status !== "all") {
        query.status = status;
      }

      const skip = (Number(page) - 1) * Number(limit);
      const users = await User.find(query)
        .select(
          "-password -refreshTokens -resetPasswordToken -resetPasswordExpires"
        )
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit));

      const total = await User.countDocuments(query);

      res.json({
        users,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          pages: Math.ceil(total / Number(limit)),
        },
      });
    } catch (error) {
      console.error("Error fetching users:", error);
      res.status(500).json({ message: "Failed to fetch users" });
    }
  },

  // Admin: Get single user by ID
  async getUserById(req: AuthRequest, res: Response) {
    try {
      const user = await User.findOne({
        _id: req.params.id,
        domain: req.user?.domain,
      }).select(
        "-password -refreshTokens -resetPasswordToken -resetPasswordExpires"
      );
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      res.json(user);
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  },

  // Admin: Create new user
  async createUser(req: AuthRequest, res: Response) {
    try {
      const { email, name, password, role = "user" } = req.body;

      // Check if user already exists
      const existingUser = await User.findOne({ email });
      if (existingUser) {
        return res.status(400).json({ message: "User already exists" });
      }

      // Hash password if provided
      let hashedPassword;
      if (password) {
        hashedPassword = await bcrypt.hash(password, 10);
      }

      const user = new User({
        email,
        name,
        password: hashedPassword,
        role,
        status: "active",
        domain: req.user?.domain,
      });

      await user.save();

      // Return user without sensitive data
      const userResponse = user.toObject();
      const {
        password: _,
        refreshTokens: __,
        resetPasswordToken: ___,
        resetPasswordExpires: ____,
        ...safeUserData
      } = userResponse;

      res.status(201).json(safeUserData);
    } catch (error) {
      console.error("Error creating user:", error);
      res.status(500).json({ message: "Failed to create user" });
    }
  },

  // Admin: Update user
  async updateUser(req: AuthRequest, res: Response) {
    try {
      const { name, role, status } = req.body;
      const updateData: any = {};

      if (name !== undefined) updateData.name = name;
      if (role !== undefined) updateData.role = role;
      if (status !== undefined) updateData.status = status;

      const user = await User.findOneAndUpdate(
        { _id: req.params.id, domain: req.user?.domain },
        updateData,
        { new: true }
      ).select(
        "-password -refreshTokens -resetPasswordToken -resetPasswordExpires"
      );

      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      res.json(user);
    } catch (error) {
      console.error("Error updating user:", error);
      res.status(500).json({ message: "Failed to update user" });
    }
  },

  // Admin: Delete user (soft delete by setting status to suspended)
  async deleteUser(req: AuthRequest, res: Response) {
    try {
      const user = await User.findOne({
        _id: req.params.id,
        domain: req.user?.domain,
      });
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      // Soft delete by setting status to suspended
      user.status = "suspended";
      await user.save();

      res.json({ message: "User deactivated successfully" });
    } catch (error) {
      console.error("Error deleting user:", error);
      res.status(500).json({ message: "Failed to delete user" });
    }
  },

  // Admin: Activate/Reactivate user
  async activateUser(req: AuthRequest, res: Response) {
    try {
      const user = await User.findOneAndUpdate(
        { _id: req.params.id, domain: req.user?.domain },
        { status: "active" },
        { new: true }
      ).select(
        "-password -refreshTokens -resetPasswordToken -resetPasswordExpires"
      );

      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      res.json({ message: "User activated successfully", user });
    } catch (error) {
      console.error("Error activating user:", error);
      res.status(500).json({ message: "Failed to activate user" });
    }
  },

  // User: Get own profile
  async getMyProfile(req: AuthRequest, res: Response) {
    try {
      const user = await User.findById(req.user._id).select(
        "-password -refreshTokens -resetPasswordToken -resetPasswordExpires"
      );
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      res.json(user);
    } catch (error) {
      console.error("Error fetching profile:", error);
      res.status(500).json({ message: "Failed to fetch profile" });
    }
  },

  // User: Update own profile
  async updateMyProfile(req: AuthRequest, res: Response) {
    try {
      const { name, gender } = req.body;
      const updateData: any = {};

      if (name !== undefined) updateData.name = name;
      if (gender !== undefined) updateData.gender = gender;

      const user = await User.findByIdAndUpdate(req.user._id, updateData, {
        new: true,
      }).select(
        "-password -refreshTokens -resetPasswordToken -resetPasswordExpires"
      );

      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      res.json(user);
    } catch (error) {
      console.error("Error updating profile:", error);
      res.status(500).json({ message: "Failed to update profile" });
    }
  },

  // User: Initiate OTP for profile update
  async initiateProfileUpdateOtp(req: AuthRequest, res: Response) {
    try {
      const { pendingUpdate } = req.body || {};
      if (!pendingUpdate || typeof pendingUpdate !== "object") {
        return res.status(400).json({ message: "pendingUpdate is required" });
      }

      const user = await User.findById(req.user?._id);
      if (!user) return res.status(404).json({ message: "User not found" });

      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      const expires = new Date(Date.now() + 10 * 60 * 1000);

      user.profileUpdateOTP = otp;
      user.profileUpdateOTPExpires = expires;
      user.profileUpdatePendingData = pendingUpdate;
      await user.save();

      await sendEmail({
        to: user.email,
        subject: "Verify your profile update",
        template: "profile-update-otp",
        data: { otp, expiresMinutes: 10 },
      });

      return res.json({ message: "OTP sent to your email" });
    } catch (error) {
      console.error("Error initiating profile update OTP:", error);
      res.status(500).json({ message: "Failed to initiate profile update" });
    }
  },

  // User: Verify OTP and apply profile update
  async verifyProfileUpdateOtp(req: AuthRequest, res: Response) {
    try {
      const { otp } = req.body || {};
      if (!otp) return res.status(400).json({ message: "OTP is required" });

      const user = await User.findById(req.user?._id);
      if (!user) return res.status(404).json({ message: "User not found" });

      if (!user.profileUpdateOTP || !user.profileUpdateOTPExpires) {
        return res.status(400).json({ message: "No OTP in progress" });
      }

      if (String(otp) !== String(user.profileUpdateOTP)) {
        return res.status(400).json({ message: "Invalid OTP" });
      }

      if (new Date() > new Date(user.profileUpdateOTPExpires)) {
        return res.status(400).json({ message: "OTP expired" });
      }

      const pending = (user.profileUpdatePendingData || {}) as any;
      const updateData: any = {};
      if (pending.name !== undefined) updateData.name = pending.name;
      if (pending.gender !== undefined) updateData.gender = pending.gender;

      // Apply updates
      Object.assign(user, updateData);

      // Clear OTP data
      user.profileUpdateOTP = undefined as any;
      user.profileUpdateOTPExpires = undefined as any;
      user.profileUpdatePendingData = undefined as any;
      await user.save();

      const safeUser = await User.findById(user._id).select(
        "-password -refreshTokens -resetPasswordToken -resetPasswordExpires"
      );

      return res.json({ message: "Profile updated successfully", user: safeUser });
    } catch (error) {
      console.error("Error verifying profile update OTP:", error);
      res.status(500).json({ message: "Failed to verify OTP" });
    }
  },

  // User: Change own password
  async changeMyPassword(req: AuthRequest, res: Response) {
    try {
      const { oldPassword, newPassword } = req.body;

      if (!oldPassword || !newPassword) {
        return res.status(400).json({
          message: "Old password and new password are required",
        });
      }

      const user = await User.findById(req.user._id);
      if (!user || !user.password) {
        return res
          .status(400)
          .json({ message: "User not found or no password set" });
      }

      // Verify old password
      const isMatch = await bcrypt.compare(oldPassword, user.password);
      if (!isMatch) {
        return res.status(400).json({ message: "Invalid old password" });
      }

      // Initiate OTP for password change instead of applying immediately
      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      const expires = new Date(Date.now() + 10 * 60 * 1000);
      const hashedPassword = await bcrypt.hash(newPassword, 10);

      user.passwordChangeOTP = otp;
      user.passwordChangeOTPExpires = expires;
      user.passwordChangePendingHash = hashedPassword;
      await user.save();

      await sendEmail({
        to: user.email,
        subject: "Verify your password change",
        template: "password-change-otp",
        data: { otp, expiresMinutes: 10 },
      });

      res.json({ message: "OTP sent to your email to verify password change" });
    } catch (error) {
      console.error("Error changing password:", error);
      res.status(500).json({ message: "Failed to change password" });
    }
  },

  // User: Verify OTP and apply password change
  async verifyPasswordChangeOtp(req: AuthRequest, res: Response) {
    try {
      const { otp } = req.body || {};
      if (!otp) return res.status(400).json({ message: "OTP is required" });

      const user = await User.findById(req.user?._id);
      if (!user) return res.status(404).json({ message: "User not found" });

      if (!user.passwordChangeOTP || !user.passwordChangeOTPExpires || !user.passwordChangePendingHash) {
        return res.status(400).json({ message: "No password change in progress" });
      }

      if (String(otp) !== String(user.passwordChangeOTP)) {
        return res.status(400).json({ message: "Invalid OTP" });
      }

      if (new Date() > new Date(user.passwordChangeOTPExpires)) {
        return res.status(400).json({ message: "OTP expired" });
      }

      // Apply new password
      user.password = user.passwordChangePendingHash;
      user.passwordChangeOTP = undefined as any;
      user.passwordChangeOTPExpires = undefined as any;
      user.passwordChangePendingHash = undefined as any;
      await user.save();

      res.json({ message: "Password changed successfully" });
    } catch (error) {
      console.error("Error verifying password change OTP:", error);
      res.status(500).json({ message: "Failed to verify password change" });
    }
  },

  // Admin: Get user statistics
  async getUserStats(req: AuthRequest, res: Response) {
    try {
      const domain = req.user?.domain;
      const totalUsers = await User.countDocuments({ domain });
      const activeUsers = await User.countDocuments({
        status: "active",
        domain,
      });
      const suspendedUsers = await User.countDocuments({
        status: "suspended",
        domain,
      });
      const adminUsers = await User.countDocuments({ role: "admin", domain });
      const regularUsers = await User.countDocuments({ role: "user", domain });

      res.json({
        total: totalUsers,
        active: activeUsers,
        suspended: suspendedUsers,
        admins: adminUsers,
        users: regularUsers,
      });
    } catch (error) {
      console.error("Error fetching user stats:", error);
      res.status(500).json({ message: "Failed to fetch user statistics" });
    }
  },
};
