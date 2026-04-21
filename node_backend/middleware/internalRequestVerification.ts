import { NextFunction, Request, Response } from "express";
import crypto from "crypto";
import Redis from "ioredis";

type RawBodyRequest = Request & { rawBody?: Buffer };

const HEADER_SECRET = "x-internal-secret";
const HEADER_TIMESTAMP = "x-timestamp";
const HEADER_NONCE = "x-nonce";
const HEADER_SIGNATURE = "x-signature";

function getConfig() {
  const nodeEnv = (process.env.NODE_ENV || "development").toLowerCase();
  const isProduction = nodeEnv === "production";
  const weakModeRequested = process.env.INTERNAL_CALLBACK_SIGNATURE_REQUIRED === "false";
  return {
    nonceTtlSeconds: Number(process.env.INTERNAL_CALLBACK_NONCE_TTL_SECONDS || 300),
    timestampToleranceSeconds: Number(
      process.env.INTERNAL_CALLBACK_TIMESTAMP_TOLERANCE_SECONDS || 300
    ),
    signingSecret:
      process.env.INTERNAL_CALLBACK_SIGNING_SECRET || process.env.INTERNAL_SECRET || "",
    internalSecret: process.env.INTERNAL_SECRET || "",
    signatureRequired: isProduction ? true : !weakModeRequested,
    isProduction,
  };
}

let redisClient: Redis | null = null;
let redisInitAttempted = false;
const inMemoryNonceCache = new Map<string, number>();

function getRedisClient(): Redis | null {
  if (redisInitAttempted) return redisClient;
  redisInitAttempted = true;

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) return null;

  try {
    redisClient = new Redis(redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableReadyCheck: false,
    });
    redisClient.on("error", (error) => {
      console.warn("[internal-callback-auth] Redis nonce store unavailable", {
        error: error?.message,
      });
    });
    return redisClient;
  } catch (error: any) {
    console.warn("[internal-callback-auth] Failed to initialize Redis nonce store", {
      error: error?.message,
    });
    redisClient = null;
    return null;
  }
}

function deny(
  req: Request,
  res: Response,
  reason: string,
  statusCode = 401,
  ageMs?: number
) {
  console.warn("[internal-callback-auth] denied request", {
    route: req.originalUrl,
    method: req.method,
    reason,
    sourceIp: req.ip,
    ageMs: typeof ageMs === "number" ? ageMs : null,
  });
  return res.status(statusCode).json({ error: "Unauthorized internal request", reason });
}

function buildSigningPayload(
  method: string,
  path: string,
  rawBody: string,
  timestamp: string,
  nonce: string
) {
  return `${method.toUpperCase()}\n${path}\n${rawBody}\n${timestamp}\n${nonce}`;
}

function computeSignature(payload: string, secret: string) {
  return crypto.createHmac("sha256", secret).update(payload, "utf8").digest("hex");
}

async function checkAndStoreNonce(nonce: string): Promise<boolean> {
  const { isProduction } = getConfig();
  const redis = getRedisClient();
  if (redis) {
    try {
      if (redis.status === "wait") {
        await redis.connect();
      }
      const { nonceTtlSeconds } = getConfig();
      const result = await redis.set(
        `internal_callback_nonce:${nonce}`,
        "1",
        "EX",
        nonceTtlSeconds,
        "NX"
      );
      return result === "OK";
    } catch {
      // fall through to in-memory replay protection
    }
  }

  if (isProduction) {
    // Multi-instance deployments require a shared nonce store.
    return false;
  }

  const { nonceTtlSeconds } = getConfig();
  const now = Date.now();
  for (const [key, expiry] of inMemoryNonceCache.entries()) {
    if (expiry <= now) inMemoryNonceCache.delete(key);
  }
  if (inMemoryNonceCache.has(nonce)) {
    return false;
  }
  inMemoryNonceCache.set(nonce, now + nonceTtlSeconds * 1000);
  return true;
}

export async function verifyInternalCallbackRequest(
  req: RawBodyRequest,
  res: Response,
  next: NextFunction
) {
  const { internalSecret, signingSecret, signatureRequired, timestampToleranceSeconds, isProduction } =
    getConfig();

  if (!internalSecret || !signingSecret) {
    return deny(req, res, "internal_secret_not_configured", 503);
  }

  if (isProduction && process.env.INTERNAL_CALLBACK_SIGNATURE_REQUIRED === "false") {
    return deny(req, res, "weak_signature_mode_blocked_in_production", 503);
  }

  const providedSecret = String(req.headers[HEADER_SECRET] || "");
  if (!providedSecret || providedSecret !== internalSecret) {
    return deny(req, res, "invalid_or_missing_internal_secret", 403);
  }

  const timestamp = String(req.headers[HEADER_TIMESTAMP] || "");
  const nonce = String(req.headers[HEADER_NONCE] || "");
  const signature = String(req.headers[HEADER_SIGNATURE] || "");

  if (!timestamp || !nonce || !signature) {
    if (!signatureRequired) {
      return next();
    }
    return deny(req, res, "missing_signed_headers", 401);
  }

  const tsMillis = Number(timestamp) * 1000;
  if (!Number.isFinite(tsMillis)) {
    return deny(req, res, "invalid_timestamp", 401);
  }

  const ageMs = Math.abs(Date.now() - tsMillis);
  if (ageMs > timestampToleranceSeconds * 1000) {
    return deny(req, res, "expired_timestamp", 401, ageMs);
  }

  const nonceAccepted = await checkAndStoreNonce(nonce);
  if (!nonceAccepted) {
    return deny(req, res, "replayed_nonce_or_nonce_store_unavailable", 401, ageMs);
  }

  const path = req.originalUrl.split("?")[0];
  const rawBody = req.rawBody ? req.rawBody.toString("utf8") : JSON.stringify(req.body || {});
  const payload = buildSigningPayload(req.method, path, rawBody, timestamp, nonce);
  const expected = computeSignature(payload, signingSecret);

  const expectedBuffer = Buffer.from(expected, "utf8");
  const providedBuffer = Buffer.from(signature, "utf8");
  const isValid =
    expectedBuffer.length === providedBuffer.length &&
    crypto.timingSafeEqual(expectedBuffer, providedBuffer);

  if (!isValid) {
    return deny(req, res, "invalid_signature", 401, ageMs);
  }

  (req as any).__internalCall = true;
  return next();
}
