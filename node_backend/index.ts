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
import { testSmtpConnection } from "./services/emailService";
import { HealthService } from "./services/healthService";

dotenv.config();

export const app = express();

// Trust proxy for Render deployment
app.set('trust proxy', 1);

const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: {
    origin: function (origin, callback) {
      // Allow requests with no origin
      if (!origin) return callback(null, true);

      const allowedOrigins = [
        "https://rhp-document-summarizer.vercel.app",
        "http://localhost:8080",
        "http://localhost:3000",
      ];

      if (allowedOrigins.indexOf(origin) !== -1) {
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

// Make io accessible elsewhere
export { io };

const PORT = process.env.PORT || 5000;

// CORS configuration - must be before other middleware
const allowedOrigins = [
  "https://rhp-document-summarizer.vercel.app",
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
    allowedHeaders: ['Content-Type', 'Authorization', 'x-workspace', 'x-link-token', 'x-internal-secret'],
    exposedHeaders: ['Content-Type', 'Authorization'],
    preflightContinue: false,
    optionsSuccessStatus: 204,
  })
);

// Handle preflight requests explicitly
app.options('*', cors());

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
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
  throw new Error("MONGODB_URI is not set");
}

if (process.env.NODE_ENV !== 'test') {
  mongoose
    .connect(MONGODB_URI, {
      serverSelectionTimeoutMS: 5000, // Timeout after 5s instead of 30s
      socketTimeoutMS: 45000, // Close sockets after 45s of inactivity
      connectTimeoutMS: 10000, // Give up initial connection after 10s
      retryWrites: true,
      retryReads: true,
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
  });
}

// Allow only your frontend domain
