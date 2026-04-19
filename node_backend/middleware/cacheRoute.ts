import { Request, Response, NextFunction } from "express";
import { getRedisClient } from "../services/cacheService";

export const cacheRoute = (ttlSeconds: number = 300) => {
  return async (req: any, res: Response, next: NextFunction) => {
    const client = getRedisClient();
    if (!client || req.method !== "GET") {
      return next();
    }

    // Determine Workspace (critical for multi-tenant cache isolation)
    const currentWorkspace = req.currentWorkspace || Math.random().toString();
    const userId = req.user?._id?.toString() || "anon";
    
    // Create unique cache key representing URL and params + Auth identity
    const key = `express:cache:${currentWorkspace}:${userId}:${req.originalUrl}`;

    try {
      const cachedResponse = await client.get(key);
      if (cachedResponse) {
        return res.json(JSON.parse(cachedResponse));
      }

      // Hijack the res.json to catch the return payload from controllers
      const originalJson = res.json;
      res.json = function (body) {
        // Save to cache asynchronously, don't await so we don't slow down response
        client.setex(key, ttlSeconds, JSON.stringify(body))
          .catch(err => console.error(`[Cache] Set error for ${key}:`, err));
        
        // Restore original and call it
        return originalJson.call(this, body);
      };

      next();
    } catch (err) {
      console.error("[Cache Route] Middleware Error:", err);
      next();
    }
  };
};

export const clearCachePrefix = async (req: any, res: Response, next: NextFunction) => {
  next(); // Always proceed and execute main controller
  
  // Cleanup asynchronously after completion
  res.on('finish', async () => {
    // Only cleanup on mutating operations
    if (req.method === "GET") return;
    if (res.statusCode >= 400) return; // Ignore failed requests
    
    const client = getRedisClient();
    if (!client) return;

    const currentWorkspace = req.currentWorkspace || "*";
    
    // We clear all list/get caches for the current workspace when a mutation occurs.
    const pattern = `express:cache:${currentWorkspace}:*`;
    
    try {
      let cursor = "0";
      do {
        const result = await client.scan(cursor, "MATCH", pattern, "COUNT", 100);
        cursor = result[0];
        const keys = result[1];
        if (keys.length > 0) {
          await client.del(...keys);
        }
      } while (cursor !== "0");
      // console.log(`[Cache] Cleared mutated workspace cache: ${pattern}`);
    } catch (e) {
      console.error("[Cache] Invalidating error:", e);
    }
  });
};
