import { Job } from "../models/Job";
import { alertAggregationService } from "./alertAggregationService";

type MetricValue = number;

class MetricsService {
  private noisyMetrics = new Set([
    "event_loop_lag_ms",
    "heap_used_mb",
    "request_latency_ms",
    "response_size_bytes",
    "queue_depth",
    "queue_age_seconds",
  ]);
  private thresholds = {
    queueDepth: Number(process.env.ALERT_QUEUE_DEPTH_THRESHOLD || "300"),
    queueAgeSeconds: Number(process.env.ALERT_QUEUE_AGE_SECONDS_THRESHOLD || "180"),
    retryCount: Number(process.env.ALERT_RETRY_COUNT_THRESHOLD || "3"),
    jobRuntimeMs: Number(process.env.ALERT_JOB_RUNTIME_MS_THRESHOLD || "900000"),
    workerRssMb: Number(process.env.ALERT_WORKER_RSS_MB_THRESHOLD || "2048"),
  };

  emit(metric: string, value: MetricValue, tags: Record<string, string | number | boolean> = {}) {
    const verboseMetrics = process.env.METRICS_VERBOSE === "true";
    const shouldLogMetric = verboseMetrics || !this.noisyMetrics.has(metric);
    if (shouldLogMetric) {
      // Structured output intended for centralized log ingestion.
      // Avoid plain console-only unstructured logs.
      console.info(
        JSON.stringify({
          type: "metric",
          metric,
          value,
          tags,
          ts: new Date().toISOString(),
        })
      );
    }
    this.emitAlertIfThreshold(metric, value, tags);
  }

  emitAlertIfThreshold(
    metric: string,
    value: MetricValue,
    tags: Record<string, string | number | boolean> = {}
  ) {
    const triggered =
      (metric === "queue_depth" && value >= this.thresholds.queueDepth) ||
      (metric === "queue_age_seconds" && value >= this.thresholds.queueAgeSeconds) ||
      (metric === "retry_count" && value >= this.thresholds.retryCount) ||
      (metric === "job_runtime_ms" && value >= this.thresholds.jobRuntimeMs) ||
      (metric === "worker_rss_mb" && value >= this.thresholds.workerRssMb);
    if (!triggered) return;

    console.warn(
      JSON.stringify({
        type: "alert_signal",
        signal: `threshold_exceeded:${metric}`,
        metric,
        value,
        threshold:
          metric === "queue_depth"
            ? this.thresholds.queueDepth
            : metric === "queue_age_seconds"
            ? this.thresholds.queueAgeSeconds
            : metric === "retry_count"
            ? this.thresholds.retryCount
            : metric === "job_runtime_ms"
            ? this.thresholds.jobRuntimeMs
            : this.thresholds.workerRssMb,
        tags,
        ts: new Date().toISOString(),
      })
    );
    void alertAggregationService.recordAlert({
      alertType: "threshold_exceeded",
      metric,
      severity: "warning",
      service: "node",
    });
  }

  async emitQueueMetrics(tenantId: string, queueName: string) {
    const queuedStatuses = ["queued", "queued_with_delay"];
    const [queueDepth, oldest] = await Promise.all([
      Job.countDocuments({ tenant_id: tenantId, queue_name: queueName, status: { $in: queuedStatuses } }),
      Job.findOne({ tenant_id: tenantId, queue_name: queueName, status: { $in: queuedStatuses } })
        .sort({ createdAt: 1 })
        .select("createdAt")
        .lean(),
    ]);

    const queueAgeSeconds = oldest?.createdAt
      ? Math.max(0, Math.floor((Date.now() - new Date(oldest.createdAt).getTime()) / 1000))
      : 0;

    this.emit("queue_depth", queueDepth, { tenant_id: tenantId, queue_name: queueName });
    this.emit("queue_age_seconds", queueAgeSeconds, { tenant_id: tenantId, queue_name: queueName });
  }
}

export const metricsService = new MetricsService();
