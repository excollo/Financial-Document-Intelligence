import crypto from "crypto";
import { getRedisClient } from "./cacheService";

const WINDOW_SECONDS = Number(process.env.ALERT_AGG_WINDOW_SECONDS || "300");
const BURST_THRESHOLD = Number(process.env.ALERT_AGG_BURST_THRESHOLD || "5");

class AlertAggregationService {
  async recordAlert(params: {
    alertType: string;
    metric: string;
    severity: "warning" | "error";
    service: "node" | "python";
  }) {
    const client = getRedisClient();
    if (!client) return { count: 1, burst: false, aggregated: false };

    const signature = `${params.service}:${params.severity}:${params.alertType}:${params.metric}`;
    const hash = crypto.createHash("sha1").update(signature).digest("hex");
    const key = `alert:agg:${hash}`;
    const count = await client.incr(key);
    if (count === 1) {
      await client.expire(key, WINDOW_SECONDS);
    }

    const burst = count >= BURST_THRESHOLD;
    if (burst) {
      console.warn(
        JSON.stringify({
          type: "alert_aggregate",
          signal: "alert_burst_detected",
          service: params.service,
          severity: params.severity,
          alert_type: params.alertType,
          metric: params.metric,
          alert_count_window: count,
          window_seconds: WINDOW_SECONDS,
          threshold: BURST_THRESHOLD,
          ts: new Date().toISOString(),
        })
      );
    } else {
      console.info(
        JSON.stringify({
          type: "alert_aggregate",
          signal: "alert_count_window",
          service: params.service,
          severity: params.severity,
          alert_type: params.alertType,
          metric: params.metric,
          alert_count_window: count,
          window_seconds: WINDOW_SECONDS,
          ts: new Date().toISOString(),
        })
      );
    }
    return { count, burst, aggregated: true };
  }
}

export const alertAggregationService = new AlertAggregationService();
