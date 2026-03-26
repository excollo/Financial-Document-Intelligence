import { Request, Response, NextFunction } from "express";
import { SharePermission } from "../models/SharePermission";

export async function linkAccess(req: Request, res: Response, next: NextFunction) {
  try {
    const token = (req.query.linkToken as string) || (req.headers["x-link-token"] as string);
    if (!token) return next();
    const link = await SharePermission.findOne({ scope: "link", linkToken: token });
    if (!link) return res.status(403).json({ message: "Invalid link token" });
    if (link.expiresAt && link.expiresAt.getTime() < Date.now()) {
      return res.status(410).json({ message: "Link expired" });
    }
    (req as any).linkAccess = {
      role: link.role,
      resourceType: link.resourceType,
      resourceId: link.resourceId,
      domain: link.domain,
    };
    next();
  } catch (err) {
    console.error('LinkAccess middleware error:', err);
    res.status(500).json({ message: "Failed to process link token" });
  }
}



