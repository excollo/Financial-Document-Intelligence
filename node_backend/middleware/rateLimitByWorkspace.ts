import { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";

interface WorkspaceRateLimitDocument extends mongoose.Document {
  workspaceDomain: string;
  action: string;
  windowStart: Date;
  count: number;
}

const workspaceRateLimitSchema = new mongoose.Schema<WorkspaceRateLimitDocument>(
  {
    workspaceDomain: { type: String, index: true, required: true },
    action: { type: String, index: true, required: true },
    windowStart: { type: Date, index: true, required: true },
    count: { type: Number, default: 0 },
  },
  { versionKey: false }
);

workspaceRateLimitSchema.index(
  { workspaceDomain: 1, action: 1, windowStart: 1 },
  { unique: true }
);

const WorkspaceRateLimitModel = mongoose.model<WorkspaceRateLimitDocument>(
  "WorkspaceRateLimit",
  workspaceRateLimitSchema
);

export function rateLimitByWorkspace(
  action:
    | "summary:create"
    | "document:create"
    | "document:upload"
    | "chat:create"
    | "chat:message"
    | "report:create"
    | "report:compare"
    | "summary:trigger"
    | "workspace:invite",
  limit: number,
  windowMs: number
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const workspaceDomain =
        (req as any).currentWorkspace || (req as any).userDomain || "global";

      const now = Date.now();
      const windowStart = new Date(now - (now % windowMs));

      const updated = await WorkspaceRateLimitModel.findOneAndUpdate(
        { workspaceDomain, action, windowStart },
        { $inc: { count: 1 } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      ).lean();

      if ((updated?.count || 0) > limit) {
        const retryAfterSec = Math.ceil(
          (windowStart.getTime() + windowMs - now) / 1000
        );
        res.setHeader("Retry-After", String(retryAfterSec));
        return res.status(429).json({
          message: "Workspace rate limit exceeded",
          action,
          limit,
          windowMs,
          retryAfterSec,
          workspaceDomain,
        });
      }

      next();
    } catch (error) {
      return res.status(500).json({ message: "Rate limit error" });
    }
  };
}



