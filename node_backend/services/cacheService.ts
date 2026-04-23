import Redis from "ioredis";

class CacheService {
  private client: Redis | null = null;
  private initialized = false;

  private init() {
    if (this.initialized) return;
    this.initialized = true;
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) return;
    try {
      this.client = new Redis(redisUrl, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        enableReadyCheck: false,
      });
      this.client.on("error", () => {
        // Non-fatal, cache should degrade gracefully.
      });
    } catch {
      this.client = null;
    }
  }

  private async getClient(): Promise<Redis | null> {
    this.init();
    if (!this.client) return null;
    try {
      if (this.client.status === "wait") {
        await this.client.connect();
      }
      return this.client;
    } catch {
      return null;
    }
  }

  async getRawClient(): Promise<Redis | null> {
    return this.getClient();
  }

  getRawClientSync(): Redis | null {
    this.init();
    return this.client;
  }

  async getJson<T>(key: string): Promise<T | null> {
    const client = await this.getClient();
    if (!client) return null;
    try {
      const value = await client.get(key);
      if (!value) return null;
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  }

  async setJson(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    const client = await this.getClient();
    if (!client) return;
    try {
      await client.set(key, JSON.stringify(value), "EX", Math.max(1, ttlSeconds));
    } catch {
      return;
    }
  }

  async del(key: string): Promise<void> {
    const client = await this.getClient();
    if (!client) return;
    try {
      await client.del(key);
    } catch {
      return;
    }
  }

  async delByPrefix(prefix: string, batchSize = 100): Promise<void> {
    const client = await this.getClient();
    if (!client) return;
    try {
      let cursor = "0";
      do {
        const [nextCursor, keys] = await client.scan(cursor, "MATCH", `${prefix}*`, "COUNT", batchSize);
        cursor = nextCursor;
        if (keys.length > 0) {
          await client.del(...keys);
        }
      } while (cursor !== "0");
    } catch {
      return;
    }
  }
}

export const cacheService = new CacheService();

export const getRedisClient = (): Redis | null => cacheService.getRawClientSync();

export const withCache = async <T>(
  key: string,
  fetcher: () => Promise<T>,
  ttl = 3600
): Promise<T> => {
  const cached = await cacheService.getJson<T>(key);
  if (cached !== null) return cached;
  const fresh = await fetcher();
  if (fresh !== null && fresh !== undefined) {
    await cacheService.setJson(key, fresh, ttl);
  }
  return fresh;
};

export const invalidateCache = async (pattern: string): Promise<void> => {
  if (pattern.includes("*")) {
    const prefix = pattern.replace(/\*+$/, "");
    await cacheService.delByPrefix(prefix);
    return;
  }
  await cacheService.del(pattern);
};
