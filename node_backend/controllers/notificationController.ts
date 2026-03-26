import { Request, Response } from "express";
import { Notification } from "../models/Notification";

interface AuthRequest extends Request {
  user?: any;
  userDomain?: string;
}

export const notificationController = {
  // List notifications for the authenticated user, scoped to the current workspace/domain.
  async list(req: AuthRequest, res: Response) {
    try {
      const { unread, page, pageSize } = (req.query || {}) as any;
      const filter: any = { userId: req.user?._id?.toString?.(), domain: req.userDomain };
      if (String(unread) === "true") filter.isRead = false;
      const p = Math.max(parseInt(page || "1", 10), 1);
      const ps = Math.min(Math.max(parseInt(pageSize || "20", 10), 1), 100);
      const items = await Notification.find(filter)
        .sort({ createdAt: -1 })
        .skip((p - 1) * ps)
        .limit(ps);
      const total = await Notification.countDocuments(filter);
      res.json({ total, page: p, pageSize: ps, items });
    } catch (err) {
      res.status(500).json({ error: "Failed to list notifications" });
    }
  },
  // Mark a single notification as read for the current user.
  async markRead(req: AuthRequest, res: Response) {
    try {
      const { id } = req.params;
      await Notification.updateOne({ id, userId: req.user?._id?.toString?.() }, { $set: { isRead: true } });
      res.json({ message: "Notification marked as read" });
    } catch (err) {
      res.status(500).json({ error: "Failed to mark read" });
    }
  },
  // Mark all notifications as read for the current user.
  async markAllRead(req: AuthRequest, res: Response) {
    try {
      await Notification.updateMany({ userId: req.user?._id?.toString?.() }, { $set: { isRead: true } });
      res.json({ message: "All notifications marked as read" });
    } catch (err) {
      res.status(500).json({ error: "Failed to mark all read" });
    }
  },
  // Delete a notification for the current user.
  async delete(req: AuthRequest, res: Response) {
    try {
      const { id } = req.params;
      const result = await Notification.deleteOne({ id, userId: req.user?._id?.toString?.() });
      if (result.deletedCount === 0) {
        return res.status(404).json({ error: "Notification not found" });
      }
      res.json({ message: "Notification deleted successfully" });
    } catch (err) {
      res.status(500).json({ error: "Failed to delete notification" });
    }
  },
};



