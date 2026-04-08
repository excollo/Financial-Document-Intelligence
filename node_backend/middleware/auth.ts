import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { User } from "../models/User";

export interface AuthRequest extends Request {
  user?: any;
  userDomain?: string;
  currentWorkspace?: string;
}

// Verifies Bearer JWT, loads the user, checks status, and attaches
// `req.user` and `req.currentWorkspace` for downstream handlers.
export const authMiddleware = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    // Check for link access first - allow unauthenticated access via link
    const linkToken = req.query.linkToken as string;
    if (linkToken) {
      // Skip authentication for link access - will be handled by linkAccess middleware
      return next();
    }

    const token = req.header("Authorization")?.replace("Bearer ", "");

    if (!token) {
      return res
        .status(401)
        .json({ message: "No token, authorization denied" });
    }

    const decoded = jwt.verify(token, process.env["JWT-SECRET"]!) as any;

    // Try to find user by microsoftId first, then by _id
    let user = null;
    if (decoded.microsoftId) {
      user = await User.findOne({ microsoftId: decoded.microsoftId });
    } else if (decoded.userId) {
      user = await User.findById(decoded.userId);
    }

    if (!user) {
      return res.status(401).json({ message: "Token is not valid" });
    }

    if (user.status === "suspended") {
      return res.status(403).json({ message: "Account is suspended" });
    }

    req.user = user;

    // Extract workspace from headers
    const workspaceHeader = req.header("x-workspace");
    if (workspaceHeader) {
      req.currentWorkspace = workspaceHeader;
    } else {
      // Fallback to user's domain if no workspace header
      req.currentWorkspace = user.domain;
    }

    // Set userDomain for consistency
    req.userDomain = user.domainId;

    next();
  } catch (error) {
    res.status(401).json({ message: "Token is not valid" });
  }
};

export const authorize = (roles: Array<"admin" | "user">) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    const currentUser = req.user;
    if (!currentUser) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    if (!roles.includes(currentUser.role)) {
      return res.status(403).json({ message: "Forbidden" });
    }
    next();
  };
};
