import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import dotenv from "dotenv";
import passport from "passport";
import documentRoutes from "./routes/document.routes";
import chatRoutes from "./routes/chat.routes";
import summaryRoutes from "./routes/summary.routes";
import authRoutes from "./routes/auth.routes";
import reportRoutes from "./routes/report.routes";
import userRoutes from "./routes/user.routes";
import workspaceInvitationRoutes from "./routes/workspaceInvitation.routes";
import publicInvitationRoutes from "./routes/publicInvitation.routes";
import directoryRoutes from "./routes/directory.routes";
// import trashRoutes from "./routes/trash.routes";
import shareRoutes from "./routes/share.routes";
import notificationRoutes from "./routes/notification.routes";
import workspaceRoutes from "./routes/workspace.routes";
import workspaceRequestRoutes from "./routes/workspaceRequest.routes";
import newsCrawlRoutes from "./routes/newsCrawl.routes";
import newsArticleRoutes from "./routes/newsArticle.routes";
import domainRoutes from "./routes/domain.routes";
import healthRoutes from "./routes/health.routes";
import sopConfigRoutes from "./routes/sopConfig.routes";
import jobRoutes from "./routes/job.routes";
import http from "http";
import { Server as SocketIOServer } from "socket.io";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import jwt from "jsonwebtoken";
import { User } from "./models/User";
import { resolveAuthorizedWorkspaceIds } from "./services/socketRoomResolver";
import { testSmtpConnection } from "./services/emailService";
import { HealthService } from "./services/healthService";
import { checkPandocAvailable } from "./services/docxService";
import { emitToWorkspace } from "./services/realtimeEmitter";
import { requestMetricsMiddleware } from "./middleware/requestMetrics";
import { brokerQueueTelemetryService } from "./services/brokerQueueTelemetryService";
import { buildSignedInternalRawRequest } from "./services/internalRequestSigning";
import { staleJobReaperService } from "./services/staleJobReaperService";

dotenv.config();

const REQUIRED_RUNTIME_ENV_VARS = [
  "MONGODB_URI",
  "JWT_SECRET",
  "JWT_REFRESH_SECRET",
  "INTERNAL_SECRET",
  "PYTHON_API_URL",
];

// ============================================================================
// AZURE KEY VAULT AUTO-LOADER
// ============================================================================
function shouldLoadKeyVaultSecrets(): boolean {
  if (process.env.USE_KEYVAULT === "true") {
    return true;
  }

  if (process.env.NODE_ENV !== "production") {
    return false;
  }

  const missingCriticalEnvVars = REQUIRED_RUNTIME_ENV_VARS.filter(
    (name) => !String(process.env[name] || "").trim()
  );

  if (missingCriticalEnvVars.length === 0) {
    console.log(
      "🔐 Skipping Key Vault sync because required runtime env vars are already set"
    );
    return false;
  }

  console.warn(
    `🔐 Attempting Key Vault sync because required env vars are missing: ${missingCriticalEnvVars.join(", ")}`
  );
  return true;
}

async function loadKeyVaultSecrets() {
  const vaultUri = "https://fdi-keyvault.vault.azure.net/";
  if (!shouldLoadKeyVaultSecrets()) {
    return;
  }

  try {
    const { DefaultAzureCredential } = await import("@azure/identity");
    const { SecretClient } = await import("@azure/keyvault-secrets");

    console.log(`🔐 Connecting to Key Vault: ${vaultUri}`);
    const credential = new DefaultAzureCredential();
    const client = new SecretClient(vaultUri, credential);

    let count = 0;
    for await (const secretProperties of client.listPropertiesOfSecrets()) {
      if (secretProperties.enabled) {
        const secret = await client.getSecret(secretProperties.name);
        process.env[secret.name] = secret.value;
        count++;
      }
    }
    console.log(`✅ Loaded ${count} secrets from Key Vault`);
  } catch (error: any) {
    console.error("❌ Failed to load secrets from Key Vault:", error.message);
  }
}

export const app = express();

// Initialize secrets before starting services
if (process.env.NODE_ENV !== 'test') {
  loadKeyVaultSecrets().then(() => {
    // Re-check mandatory environment variables after loading from KV
    if (!process.env.MONGODB_URI) {
       console.warn("⚠️ MONGODB-URI still not found after Key Vault sync");
    }
  });
}

// Trust proxy for Render deployment
app.set('trust proxy', 1);

const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: {
    origin: function (origin, callback) {
      // Allow requests with no origin
      if (!origin) return callback(null, true);

      const allowedOrigins = [
        "https://financial-document-intelligence.vercel.app",
        "https://financial-document-intelligence-2s7.vercel.app",
        "http://localhost:8080",
        "http://localhost:3000",
      ];

      if (allowedOrigins.indexOf(origin) !== -1) {
        callback(null, true);
      } else if (origin.endsWith('.vercel.app') || origin.endsWith('.excollo.com')) {
        callback(null, true);
      } else if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
    methods: ['GET', 'POST'],
  },
});

io.on("connection", async (socket) => {
  try {
    const authHeader =
      (socket.handshake.headers.authorization as string | undefined) ||
      (socket.handshake.auth?.token as string | undefined);
    const rawToken = authHeader?.replace(/^Bearer\s+/i, "").trim();
    if (!rawToken || !process.env.JWT_SECRET) {
      socket.disconnect(true);
      return;
    }

    const decoded = jwt.verify(rawToken, process.env.JWT_SECRET) as any;
    let user: any = null;
    if (decoded?.microsoftId) {
      user = await User.findOne({ microsoftId: decoded.microsoftId }).select(
        "_id domainId currentWorkspace"
      );
    } else if (decoded?.userId) {
      user = await User.findById(decoded.userId).select("_id domainId currentWorkspace");
    }
    if (!user) {
      socket.disconnect(true);
      return;
    }

    socket.join(`user_${user._id.toString()}`);

    const workspaceIds = await resolveAuthorizedWorkspaceIds(
      user._id.toString(),
      user.currentWorkspace
    );
    if (
      user.currentWorkspace &&
      !workspaceIds.includes(String(user.currentWorkspace))
    ) {
      console.warn("[socket-auth] rejected non-membership currentWorkspace join", {
        userId: user._id.toString(),
        requestedWorkspaceId: String(user.currentWorkspace),
      });
    }
    for (const workspaceId of workspaceIds) {
      socket.join(`workspace_${workspaceId}`);
    }
  } catch {
    socket.disconnect(true);
  }
});

// Make io accessible elsewhere
export { io };

const PORT = process.env["PORT"] || 5000;

// CORS configuration - must be before other middleware
const allowedOrigins = [
  "https://financial-document-intelligence.vercel.app",
  "http://localhost:8080",
  "http://localhost:3000",
];

app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests with no origin (like mobile apps or curl requests)
      if (!origin) return callback(null, true);

      if (allowedOrigins.indexOf(origin) !== -1) {
        callback(null, true);
      } else if (origin.endsWith('.vercel.app') || origin.endsWith('.excollo.com')) {
        callback(null, true);
      } else {
        // For development, allow any localhost origin
        if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
          callback(null, true);
        } else {
          callback(new Error('Not allowed by CORS'));
        }
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'x-workspace',
      'x-link-token',
      'x-internal-secret',
      'x-timestamp',
      'x-nonce',
      'x-signature',
    ],
    exposedHeaders: ['Content-Type', 'Authorization'],
    preflightContinue: false,
    optionsSuccessStatus: 204,
  })
);

// Handle preflight requests explicitly
app.options('*', cors());

app.use(
  express.json({
    limit: "50mb",
    verify: (req: any, _res, buf) => {
      const path = String(req.originalUrl || req.url || "").split("?")[0];
      const needsRawBody =
        path === "/api/jobs/internal/status" ||
        path === "/api/jobs/internal/section-result" ||
        path === "/api/jobs/internal/adverse-finding" ||
        path === "/api/jobs/internal/queue-health" ||
        path === "/api/documents/upload-status/update" ||
        /^\/api\/documents\/internal\/[^/]+$/.test(path) ||
        path === "/api/summaries/summary-status/update" ||
        path === "/api/reports/report-status/update" ||
        path === "/api/chats/chat-status/update";
      if (needsRawBody) {
        req.rawBody = Buffer.from(buf);
      }
    },
  })
);
app.use(express.urlencoded({ limit: "50mb", extended: true }));
app.use(requestMetricsMiddleware);
const shouldLogHttpRequests = process.env.LOG_HTTP_REQUESTS !== "false";
const noisyRequestPrefixes = ["/api/notifications", "/api/jobs", "/api/documents/check-existing"];
app.use((req, res, next) => {
  const isNoisyPoll = noisyRequestPrefixes.some((prefix) => req.url.startsWith(prefix));
  if (shouldLogHttpRequests && !isNoisyPoll) {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  }
  next();
});
app.use(passport.initialize());

// Security middleware - configure helmet to work with CORS
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    crossOriginEmbedderPolicy: false,
  })
);

// Rate limiting middleware
// More lenient rate limiter for GET requests (read operations)
// This allows bulk data fetching without hitting rate limits
const readLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute window
  max: 500, // Allow 500 GET requests per minute per IP (for bulk operations like fetching all reports/summaries)
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many read requests, please try again later',
  skip: (req) => {
    // Skip rate limiting for non-GET requests (they'll use writeLimiter)
    return req.method !== 'GET';
  },
  // Use IP-based rate limiting (user auth happens after rate limiting)
  keyGenerator: (req) => {
    return req.ip || req.socket.remoteAddress || 'unknown';
  },
});

// Stricter rate limiter for write operations (POST, PUT, DELETE, PATCH)
const writeLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute window
  max: 500, // Allow 500 write requests per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many write requests, please try again later',
  skip: (req) => {
    // Skip rate limiting for GET requests (they use readLimiter)
    return req.method === 'GET';
  },
  // Use IP-based rate limiting (user auth happens after rate limiting)
  keyGenerator: (req) => {
    return req.ip || req.socket.remoteAddress || 'unknown';
  },
});

// Apply read limiter to all routes
app.use(readLimiter);
// Apply write limiter to all routes
app.use(writeLimiter);

// MongoDB Connection
const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  throw new Error("MONGODB_URI (or COSMOSDB_URI) is not set");
}

if (process.env.NODE_ENV !== 'test') {
  console.log(`[DB] Connecting to MongoDB... URI starts with: ${MONGODB_URI.substring(0, 30)}***`);
  mongoose
    .connect(MONGODB_URI, {
      serverSelectionTimeoutMS: 30000,  // Give more time for Cosmos/firewall
      socketTimeoutMS: 60000,
      connectTimeoutMS: 30000,
      retryWrites: false, // Must be false for Cosmos DB
      retryReads: true,
      tls: MONGODB_URI.includes("cosmos.azure.com"), // Force TLS for CosmosDB
    })
    .then(async () => {
      console.log("Connected to MongoDB");
      // Test SMTP connection on startup (non-blocking)
      testSmtpConnection().catch((err) => {
        console.error("SMTP test error:", err);
      });
      // Initial System Health Check (non-blocking)
      HealthService.generateFullReport().then(report => {
        console.log(`System Startup Health: ${report.overall_status.toUpperCase()}`);
      }).catch(err => {
        console.error("Startup Health Check Error:", err);
      });
    })
    .catch((error) => {
      console.error("MongoDB connection error:", error);
    });
}

// Handle MongoDB connection errors after initial connect
mongoose.connection.on('error', (err) => {
  console.error('MongoDB connection error:', err);
});

mongoose.connection.on('disconnected', () => {
  console.warn('MongoDB disconnected. Attempting to reconnect...');
});

mongoose.connection.on('reconnected', () => {
  console.log('MongoDB reconnected');
});

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/documents", documentRoutes);
app.use("/api/chats", chatRoutes);
app.use("/api/summaries", summaryRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/users", userRoutes);
app.use("/api/workspace-invitations", workspaceInvitationRoutes);
app.use("/api/invitation", publicInvitationRoutes);
app.use("/api/directories", directoryRoutes);
// app.use("/api/trash", trashRoutes); // disabled for now
app.use("/api/shares", shareRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/workspaces", workspaceRoutes);
app.use("/api/workspace-requests", workspaceRequestRoutes);
app.use("/api/news-crawl", newsCrawlRoutes);
app.use("/api/news-articles", newsArticleRoutes);
app.use("/api/domain", domainRoutes);
app.use("/api/health", healthRoutes);
app.use("/api/sop-configs", sopConfigRoutes);
app.use("/api/jobs", jobRoutes);

// Health check endpoint
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

// App Service startup probes often hit "/" by default.
// Keep this route fast and dependency-free so warmup succeeds.
app.get("/", (_req, res) => {
  res.status(200).json({ status: "ok", service: "node-backend" });
});

// Global error handlers to prevent server crashes
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  // Don't exit the process, just log the error
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Don't exit the process, just log the error
});

// Handle EPIPE errors specifically
process.on('SIGPIPE', () => {
  console.log('SIGPIPE received, ignoring...');
});

if (process.env.NODE_ENV !== 'test') {
  server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    checkPandocAvailable()
      .then((ok) => {
        if (ok) {
          console.log("✅ Pandoc detected. DOCX export will use Pandoc.");
        } else {
          console.warn("⚠️ Pandoc not found. DOCX export will use HTML fallback.");
        }
      })
      .catch((err) => {
        console.warn("⚠️ Pandoc startup check failed:", err?.message || err);
      });
  });
}

if (process.env.NODE_ENV !== "test") {
  setInterval(() => {
    brokerQueueTelemetryService.emitBrokerQueueMetrics().catch((err) => {
      console.warn("broker telemetry collection failed", err?.message || err);
    });
  }, Number(process.env.BROKER_TELEMETRY_POLL_MS || "10000")).unref();
}

if (process.env.NODE_ENV !== "test" && process.env.STALE_JOB_REAPER_ENABLED !== "false") {
  const intervalMs = Number(process.env.STALE_JOB_REAPER_INTERVAL_MS || "60000");
  setTimeout(() => {
    staleJobReaperService.reapOnce().catch((err) => {
      console.error("[StaleJobReaper] Initial run failed:", err?.message || err);
    });
    setInterval(() => {
      staleJobReaperService.reapOnce().catch((err) => {
        console.error("[StaleJobReaper] Interval run failed:", err?.message || err);
      });
    }, intervalMs).unref();
  }, 15000).unref();
  console.log(
    `🛡️ Stale job reaper started (interval=${intervalMs}ms, queuedTimeout=${process.env.STALE_JOB_QUEUED_TIMEOUT_MS || 600000}ms, processingTimeout=${process.env.STALE_JOB_PROCESSING_TIMEOUT_MS || 2700000}ms)`
  );
}

// ============================================================================
// STALE DOCUMENT RECOVERY WATCHER
// Runs every 5 minutes. Finds documents stuck in "processing" for >20 minutes
// and auto-resolves them. This is a safety net for failed Python→Node callbacks.
// ============================================================================
async function recoverStaleDocuments() {
  try {
    // If DB isn't connected, skip to avoid buffered timeouts.
    if (mongoose.connection.readyState !== 1) {
      console.warn("⚠️ [StaleWatcher] MongoDB not connected yet. Skipping this cycle.");
      return;
    }
    const { Document } = await import("./models/Document");
    const STALE_THRESHOLD_MS = 20 * 60 * 1000; // 20 minutes
    const cutoff = new Date(Date.now() - STALE_THRESHOLD_MS);

    const staleDocs = await Document.find({
      status: "processing",
      uploadedAt: { $lt: cutoff },
    }).limit(20);

    if (staleDocs.length === 0) return;

    console.warn(`⚠️ [StaleWatcher] Found ${staleDocs.length} document(s) stuck in 'processing' for >20 min. Attempting recovery...`);

    for (const doc of staleDocs) {
      try {
        // Try to query the Python API Celery job status for this document
        const pythonApiUrl = process.env.PYTHON_API_URL || "http://localhost:8000";
        const axios = (await import("axios")).default;

        let resolved = false;

        try {
          // Check if Celery has a job for this document's id (job_id may equal documentId due to our fix)
          const statusUrl = `${pythonApiUrl}/jobs/${encodeURIComponent(String(doc.id))}`;
          const signed = buildSignedInternalRawRequest("GET", statusUrl, "");
          const jobRes = await axios.get(statusUrl, {
            headers: signed.headers,
            timeout: 5000,
          });

          const celeryState = jobRes.data?.state;
          console.log(`🔍 [StaleWatcher] Doc ${doc.id} Celery state: ${celeryState}`);

          if (celeryState === "SUCCESS") {
            doc.status = "completed";
            await doc.save();
            emitToWorkspace(doc.workspaceId, "upload_status", { jobId: doc.id, status: "completed" });
            console.log(`✅ [StaleWatcher] Recovered doc ${doc.id} → completed (Celery SUCCESS)`);
            resolved = true;
          } else if (celeryState === "FAILURE") {
            doc.status = "failed";
            doc.error = { message: "Processing failed in Celery worker. Please re-upload." };
            await doc.save();
            emitToWorkspace(doc.workspaceId, "upload_status", {
              jobId: doc.id,
              status: "failed",
              error: "Processing failed",
            });
            console.log(`❌ [StaleWatcher] Recovered doc ${doc.id} → failed (Celery FAILURE)`);
            resolved = true;
          }
        } catch (jobCheckErr: any) {
          // Celery job lookup failed (job may have been cleaned up already)
          console.warn(`⚠️ [StaleWatcher] Could not check Celery state for doc ${doc.id}: ${jobCheckErr.message}`);
        }

        if (!resolved) {
          // If we can NOT determine state from Celery, mark as failed after >30 additional minutes
          const HARD_TIMEOUT_MS = 50 * 60 * 1000; // 50 min total = give up
          const hardCutoff = new Date(Date.now() - HARD_TIMEOUT_MS);
          if (doc.uploadedAt < hardCutoff) {
            doc.status = "failed";
            doc.error = { message: "Processing timed out. Please re-upload the document." };
            await doc.save();
            emitToWorkspace(doc.workspaceId, "upload_status", {
              jobId: doc.id,
              status: "failed",
              error: "Timed out",
            });
            console.log(`⏱️ [StaleWatcher] Hard-timeout doc ${doc.id} → failed after 50 min`);
          } else {
            // Still within grace period — just emit a refresh signal to the frontend
            emitToWorkspace(doc.workspaceId, "upload_status", { jobId: doc.id, status: "processing" });
            console.log(`🔄 [StaleWatcher] Doc ${doc.id} still processing, refreshed frontend`);
          }
        }
      } catch (docErr: any) {
        console.error(`❌ [StaleWatcher] Error processing doc ${doc.id}:`, docErr.message);
      }
    }
  } catch (err: any) {
    console.error("❌ [StaleWatcher] Error in stale document recovery:", err.message);
  }
}

// Start the stale document watcher (5 minute interval)
if (process.env.NODE_ENV !== 'test') {
  // Run first check after 2 minutes (let server stabilize)
  setTimeout(() => {
    recoverStaleDocuments();
    setInterval(recoverStaleDocuments, 5 * 60 * 1000);
  }, 2 * 60 * 1000);
  console.log("🛡️ Stale document recovery watcher started (checks every 5 minutes)");
}

// Allow only your frontend domain
