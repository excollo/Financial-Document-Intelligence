import { Request, Response, NextFunction } from "express";
import { metricsService } from "../services/metricsService";

let lastTick = process.hrtime.bigint();
let eventLoopLagMs = 0;

setInterval(() => {
  const now = process.hrtime.bigint();
  const diffMs = Number(now - lastTick) / 1_000_000;
  eventLoopLagMs = Math.max(0, diffMs - 1000);
  lastTick = now;
  metricsService.emit("event_loop_lag_ms", Number(eventLoopLagMs.toFixed(2)));
  metricsService.emit("heap_used_mb", Number((process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)));
}, 1000).unref();

export function requestMetricsMiddleware(req: Request, res: Response, next: NextFunction) {
  const startedAt = process.hrtime.bigint();
  const originalEnd = res.end.bind(res);

  res.end = ((chunk?: any, encoding?: any, cb?: any) => {
    const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    const contentLengthHeader = res.getHeader("content-length");
    const responseBytes =
      typeof contentLengthHeader === "string"
        ? Number(contentLengthHeader)
        : Buffer.isBuffer(chunk)
        ? chunk.length
        : typeof chunk === "string"
        ? Buffer.byteLength(
            chunk,
            typeof encoding === "string" ? (encoding as BufferEncoding) : undefined
          )
        : 0;

    metricsService.emit("request_latency_ms", Number(elapsedMs.toFixed(2)), {
      method: req.method,
      route: req.path,
      status_code: res.statusCode,
    });
    metricsService.emit("response_size_bytes", responseBytes, {
      method: req.method,
      route: req.path,
      status_code: res.statusCode,
    });

    return originalEnd(chunk, encoding, cb);
  }) as any;

  next();
}
