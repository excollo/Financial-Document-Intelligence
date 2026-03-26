import { Request, Response } from "express";
import { Directory } from "../models/Directory";
import { Document } from "../models/Document";

interface AuthRequest extends Request {
  user?: any;
  userDomain?: string;
}

export const trashController = {
  async list(req: AuthRequest, res: Response) {
    try {
      const { page, pageSize } = (req.query || {}) as { page?: string; pageSize?: string };
      const [dirs, docs] = await Promise.all([
        Directory.find({ domain: req.userDomain, isDeleted: true }).sort({ deletedAt: -1 }),
        Document.find({ domain: req.userDomain, isDeleted: true }).sort({ deletedAt: -1 }),
      ]);

      const items = [
        ...dirs.map((d) => ({ kind: "directory", item: d })),
        ...docs.map((d) => ({ kind: "document", item: d })),
      ];
      const p = Math.max(parseInt(page || "1", 10), 1);
      const ps = Math.min(Math.max(parseInt(pageSize || "50", 10), 1), 200);
      const start = (p - 1) * ps;
      const paged = items.slice(start, start + ps);

      res.json({ total: items.length, page: p, pageSize: ps, items: paged });
    } catch (err) {
      res.status(500).json({ error: "Failed to list bin items" });
    }
  },
};








