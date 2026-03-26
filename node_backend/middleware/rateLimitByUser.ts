import { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";

interface RateLimitDocument extends mongoose.Document {
  userId: string;
  action: string;
  windowStart: Date;
  count: number;
}

const rateLimitSchema = new mongoose.Schema<RateLimitDocument>(
  {
    userId: { type: String, index: true, required: true },
    action: { type: String, index: true, required: true },
    windowStart: { type: Date, index: true, required: true },
    count: { type: Number, default: 0 },
  },
  { versionKey: false }
);

rateLimitSchema.index(
  { userId: 1, action: 1, windowStart: 1 },
  { unique: true }
);

const RateLimitModel = mongoose.model<RateLimitDocument>(
  "RateLimit",
  rateLimitSchema
);

export function rateLimitByUser(
  action:
    | "summary:create"
    | "document:create"
    | "document:upload"
    | "chat:create"
    | "report:create"
    | "workspace:invite",
  limit: number,
  windowMs: number
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user: any = (req as any).user;
      const userId = user?._id?.toString() || user?.microsoftId || "anonymous";

      const now = Date.now();
      const windowStart = new Date(now - (now % windowMs));

      // Upsert the counter for this user/action/window
      const updated = await RateLimitModel.findOneAndUpdate(
        { userId, action, windowStart },
        { $inc: { count: 1 } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      ).lean();

      if ((updated?.count || 0) > limit) {
        const retryAfterSec = Math.ceil(
          (windowStart.getTime() + windowMs - now) / 1000
        );
        res.setHeader("Retry-After", String(retryAfterSec));
        return res.status(429).json({
          message: "Rate limit exceeded",
          action,
          limit,
          windowMs,
          retryAfterSec,
        });
      }

      next();
    } catch (error) {
      return res.status(500).json({ message: "Rate limit error" });
    }
  };
}
