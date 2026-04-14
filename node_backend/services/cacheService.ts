import Redis from "ioredis";

// Centralized Redis instance
let redisClient: Redis | null = null;
let isConnected = false;

// Create and configure the Redis client
export const getRedisClient = (): Redis | null => {
  if (!redisClient && process.env.REDIS_URL) {
    try {
      console.log(`[Cache] Initializing Redis connection...`);
      redisClient = new Redis(process.env.REDIS_URL, {
        maxRetriesPerRequest: 3,
        retryStrategy(times) {
          const delay = Math.min(times * 50, 2000);
          return delay;
        },
        enableReadyCheck: true,
      });

      redisClient.on("connect", () => {
        isConnected = true;
        console.log(`✅ [Cache] Subsystem Connected successfully`);
      });

      redisClient.on("error", (err) => {
        isConnected = false;
        console.error(`❌ [Cache] Connection Error:`, err.message);
      });
    } catch (err: any) {
      console.error(`❌ [Cache] Initialization failed: ${err.message}`);
    }
  } else if (!redisClient && !process.env.REDIS_URL && process.env.NODE_ENV !== "test") {
    console.warn("⚠️ REDIS_URL not set. Caching disabled.");
  }
  return isConnected ? redisClient : null;
};

// Start connection gracefully
getRedisClient();

/**
 * Cache wrapper for database queries
 * @param key Unique cache string
 * @param ttl Time To Live in seconds (Default: 3600 = 1 hour)
 * @param fetcher Async function to fetch data if cache misses
 */
export const withCache = async <T>(key: string, fetcher: () => Promise<T>, ttl: number = 3600): Promise<T> => {
  const client = getRedisClient();
  if (!client) {
    // Fallback to direct DB call if Redis is disconnected or unconfigured
    return await fetcher();
  }

  try {
    const cached = await client.get(key);
    if (cached) {
      return JSON.parse(cached) as T;
    }
  } catch (err) {
    console.warn(`[Cache] GET Error for key ${key}:`, err);
  }

  // Cache MISS - Call the DB
  const freshData = await fetcher();

  // Don't cache nulls/undefined unless necessary
  if (freshData !== null && freshData !== undefined) {
    try {
      await client.setex(key, ttl, JSON.stringify(freshData));
    } catch (err) {
      console.warn(`[Cache] SET Error for key ${key}:`, err);
    }
  }

  return freshData;
};

/**
 * Delete specific keys (use this in POST/PUT/DELETE routes)
 * @param pattern Key pattern to delete (e.g. "directories:W-123*")
 */
export const invalidateCache = async (pattern: string): Promise<void> => {
  const client = getRedisClient();
  if (!client) return;

  try {
    // If it doesn't have a wildcard, just delete the exact key
    if (!pattern.includes("*")) {
      await client.del(pattern);
      return;
    }

    // Pattern matching deletion using SCAN (prevent blocking)
    let cursor = "0";
    do {
      const result = await client.scan(cursor, "MATCH", pattern, "COUNT", 100);
      cursor = result[0];
      const keys = result[1];
      
      if (keys.length > 0) {
        await client.del(...keys);
      }
    } while (cursor !== "0");
    
    console.log(`[Cache] Invalidated keys matching: ${pattern}`);
  } catch (err) {
    console.error(`[Cache] Invalidation Error [${pattern}]:`, err);
  }
};
