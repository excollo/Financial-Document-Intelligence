import { getRedisClient } from "./cacheService";
import { metricsService } from "./metricsService";

type QueueSnapshot = {
  queue_name: "heavy_jobs" | "light_jobs";
  queue_depth: number | null;
  queue_age_seconds: number | null;
  telemetry_status: "OK" | "UNAVAILABLE";
  sampled_at: string;
  source: "redis_broker";
};

const CACHE_TTL_MS = Number(process.env.BROKER_TELEMETRY_CACHE_TTL_MS || "5000");
const AGE_SET_PREFIX = process.env.BROKER_QUEUE_AGE_SET_PREFIX || "celery:queue:enqueued_at";

class BrokerQueueTelemetryService {
  private cache = new Map<string, { ts: number; value: QueueSnapshot }>();

  async getQueueSnapshot(queueName: "heavy_jobs" | "light_jobs"): Promise<QueueSnapshot> {
    const now = Date.now();
    const cached = this.cache.get(queueName);
    if (cached && now - cached.ts < CACHE_TTL_MS) {
      return cached.value;
    }

    const client = getRedisClient();
    if (!client) {
      const fallback: QueueSnapshot = {
        queue_name: queueName,
        queue_depth: null,
        queue_age_seconds: null,
        telemetry_status: "UNAVAILABLE",
        sampled_at: new Date().toISOString(),
        source: "redis_broker",
      };
      this.cache.set(queueName, { ts: now, value: fallback });
      return fallback;
    }

    // Celery Redis transport queue key is queue name by default.
    const depth = await client.llen(queueName);
    // Approximation for queue age using enqueue timestamps persisted at submit time in Redis ZSET.
    const oldest = await client.zrange(`${AGE_SET_PREFIX}:${queueName}`, 0, 0, "WITHSCORES");
    const oldestTsMs = oldest.length >= 2 ? Number(oldest[1]) : 0;
    let ageSeconds = oldestTsMs > 0 ? Math.max(0, Math.floor((Date.now() - oldestTsMs) / 1000)) : 0;
    // Avoid stale queue-age false positives when broker depth is empty.
    if (Number(depth || 0) === 0) {
      ageSeconds = 0;
    }

    const snapshot: QueueSnapshot = {
      queue_name: queueName,
      queue_depth: Number(depth || 0),
      queue_age_seconds: ageSeconds,
      telemetry_status: "OK",
      sampled_at: new Date().toISOString(),
      source: "redis_broker",
    };
    this.cache.set(queueName, { ts: now, value: snapshot });
    return snapshot;
  }

  async emitBrokerQueueMetrics() {
    const [heavy, light] = await Promise.all([
      this.getQueueSnapshot("heavy_jobs"),
      this.getQueueSnapshot("light_jobs"),
    ]);
    for (const snapshot of [heavy, light]) {
      if (snapshot.telemetry_status === "UNAVAILABLE") {
        metricsService.emit("telemetry_unavailable", 1, {
          queue_name: snapshot.queue_name,
          source: snapshot.source,
        });
      } else {
        metricsService.emit("queue_depth", Number(snapshot.queue_depth || 0), {
          queue_name: snapshot.queue_name,
          source: snapshot.source,
        });
        metricsService.emit("queue_age_seconds", Number(snapshot.queue_age_seconds || 0), {
          queue_name: snapshot.queue_name,
          source: snapshot.source,
        });
      }
    }
    return { heavy, light };
  }
}

export const brokerQueueTelemetryService = new BrokerQueueTelemetryService();
