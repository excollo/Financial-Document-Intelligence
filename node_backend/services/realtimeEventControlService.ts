import { getRedisClient } from "./cacheService";

const DEDUPE_TTL_SECONDS = Number(process.env.REALTIME_EVENT_DEDUPE_TTL_SECONDS || "5");
const BURST_LIMIT = Number(process.env.REALTIME_EVENT_BURST_LIMIT || "25");
const BURST_WINDOW_SECONDS = Number(process.env.REALTIME_EVENT_BURST_WINDOW_SECONDS || "10");

class RealtimeEventControlService {
  async shouldEmit(event: string, scope: string, payload: Record<string, any>) {
    const status = String(payload.status || "").toLowerCase();
    const isTerminal =
      status === "completed" || status === "failed" || status === "completed_with_errors";
    // Terminal transitions must always be visible to clients.
    if (isTerminal) return true;

    const jobId = String(payload.jobId || payload.job_id || "unknown");
    const statusSig = `${payload.status || ""}:${payload.progress || payload.progress_pct || ""}:${payload.stage || payload.current_stage || ""}`;
    const dedupeKey = `rt:dedupe:${scope}:${event}:${jobId}:${statusSig}`;
    const burstKey = `rt:burst:${scope}:${event}:${jobId}`;
    const redis = getRedisClient();

    if (!redis) return true;

    const dedupeSet = await redis.set(dedupeKey, "1", "EX", DEDUPE_TTL_SECONDS, "NX");
    if (!dedupeSet) return false;

    const burstCount = await redis.incr(burstKey);
    if (burstCount === 1) {
      await redis.expire(burstKey, BURST_WINDOW_SECONDS);
    }
    if (burstCount > BURST_LIMIT) {
      return false;
    }
    return true;
  }
}

export const realtimeEventControlService = new RealtimeEventControlService();
