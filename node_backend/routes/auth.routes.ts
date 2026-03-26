import express from "express";
import passport from "passport";
import jwt from "jsonwebtoken";
import { User } from "../models/User";
import { authMiddleware } from "../middleware/auth";
import { authController } from "../controllers/authController";
import { Document } from "../models/Document";
import { Chat } from "../models/Chat";
import { Summary } from "../models/Summary";
import { getPrimaryDomain } from "../config/domainConfig";
import { publishEvent } from "../lib/events";

const router = express.Router();

// --- Email/Password Routes ---
router.post("/register", authController.register);
router.post("/register/verify-otp", authController.verifyRegistrationOtp);
router.post("/login", authController.login);
router.post("/refresh-token", authController.refreshToken);
router.post("/logout", authController.logout);

// Microsoft OAuth login
// Returns the URL where the client should redirect the user to consent.
router.get("/microsoft", (req, res) => {
  const authUrl =
    `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?` +
    `client_id=${process.env.CLIENT_ID}&` +
    `response_type=code&` +
    `redirect_uri=${encodeURIComponent(process.env.REDIRECT_URI!)}&` +
    `scope=${encodeURIComponent("openid profile email")}&` +
    `response_mode=query`;

  res.json({ authUrl });
});

// Microsoft OAuth callback
// Exchanges the authorization code for tokens, upserts a user, and redirects
// back to the frontend with app JWTs in the query string.
router.get("/callback", async (req, res) => {
  try {
    const { code } = req.query;

    if (!code) {
      return res
        .status(400)
        .json({ message: "Authorization code not provided" });
    }

    // Exchange code for token
    const tokenResponse = await fetch(
      "https://login.microsoftonline.com/common/oauth2/v2.0/token",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          client_id: process.env.CLIENT_ID!,
          client_secret: process.env.CLIENT_SECRET!,
          code: code as string,
          redirect_uri: process.env.REDIRECT_URI!,
          grant_type: "authorization_code",
        }),
      }
    );

    const tokenData = await tokenResponse.json();

    if (!tokenData.access_token) {
      return res.status(400).json({ message: "Failed to get access token" });
    }

    // Get user info
    const userResponse = await fetch("https://graph.microsoft.com/v1.0/me", {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
      },
    });

    const userData = await userResponse.json();

    // Find or create user
    let user = await User.findOne({ microsoftId: userData.id });

    if (!user) {
      const email = userData.userPrincipalName as string;
      const domain = getPrimaryDomain(email);
      user = new User({
        microsoftId: userData.id,
        name: userData.displayName,
        email,
        domain,
        createdAt: new Date(),
        lastLogin: new Date(),
      });
      await user.save();
      // Notify admins in this domain about new user
      if (domain) {
        await publishEvent({
          actorUserId: user._id.toString(),
          domain,
          action: "user.registered",
          resourceType: "user",
          resourceId: user._id.toString(),
          title: `New user registered: ${user.name || user.email}`,
          notifyAdminsOnly: true,
        });
      }
    } else {
      user.lastLogin = new Date();
      user.name = userData.displayName;
      user.email = userData.userPrincipalName;
      if (!user.domain && user.email) {
        user.domain = getPrimaryDomain(user.email) || user.domain;
      }
      await user.save();
      
      // Link SharePermissions by email to user ID (for cross-domain shares)
      const { SharePermission } = await import("../models/SharePermission");
      const userEmail = user.email?.toLowerCase();
      const userId = user._id.toString();
      if (userEmail) {
        await SharePermission.updateMany(
          {
            invitedEmail: userEmail,
            scope: "user",
            $or: [
              { principalId: null },
              { principalId: { $exists: false } },
              { principalId: "" }
            ]
          },
          { $set: { principalId: userId } }
        );
      }
    }

    // Generate JWT token
    const token = jwt.sign(
      {
        microsoftId: user.microsoftId,
        name: user.name,
        email: user.email,
      },
      process.env.JWT_SECRET!,
      { expiresIn: "7d" }
    );

    // Generate refresh token
    const refreshToken = jwt.sign(
      {
        microsoftId: user.microsoftId,
        name: user.name,
        email: user.email,
      },
      process.env.JWT_REFRESH_SECRET!,
      { expiresIn: "7d" }
    );

    // Save refresh token
    user.refreshTokens.push(refreshToken);
    await user.save();

    // Redirect to frontend with both tokens
    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:8080";
    res.redirect(
      `${frontendUrl}/auth-callback?token=${token}&refreshToken=${refreshToken}`
    );
  } catch (error) {
    console.error("Auth callback error:", error);
    res.status(500).json({ message: "Authentication failed" });
  }
});

// Get current user
router.get("/me", authMiddleware, async (req: any, res) => {
  try {
    let user = null;
    if (req.user.microsoftId) {
      user = await User.findOne({ microsoftId: req.user.microsoftId });
    } else if (req.user._id) {
      user = await User.findById(req.user._id);
    }

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    res.json({
      user: {
        email: user.email,
        name: user.name,
        microsoftId: user.microsoftId,
        _id: user._id,
      },
    });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

// Get user history
router.get("/history", authMiddleware, async (req: any, res) => {
  try {
    const query: any = {};
    if (req.user.microsoftId) {
      query.microsoftId = req.user.microsoftId;
    } else if (req.user._id) {
      query.userId = req.user._id.toString();
    } else {
      return res.status(400).json({ error: "No user identifier found" });
    }

    const documents = await Document.find(query);
    const summaries = await Summary.find(query);
    const chats = await Chat.find(query);

    res.json({
      documents,
      summaries,
      chats,
    });
  } catch (error) {
    console.error("History error:", error);
    res.status(500).json({ message: "Failed to fetch history" });
  }
});

export default router;
