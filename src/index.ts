import("apminsight")
  .then(({ default: AgentAPI }) => AgentAPI.config())
  .catch(() => console.log("APM not available in this environment"));

import compression from "compression";
import cors from "cors";
import express, { type ErrorRequestHandler } from "express";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { toNodeHandler } from "better-auth/node";
import { requireAuth } from "./middleware/auth.js";
import { requestMonitoring } from "./middleware/monitoring.js";
import subjectsRouter from "./routes/subjects.js";
import usersRouter from "./routes/users.js";
import classesRouter from "./routes/classes.js";
import departmentsRouter from "./routes/departments.js";
import statsRouter from "./routes/stats.js";
import enrollmentsRouter from "./routes/enrollments.js";
import announcementsRouter from "./routes/announcements.js";
import assignmentsRouter from "./routes/assignments.js";
import attendanceRouter from "./routes/attendance.js";
import gradebookRouter from "./routes/gradebook.js";
import resourcesRouter from "./routes/resources.js";
import calendarRouter from "./routes/calendar.js";
import storageRouter from "./routes/storage.js";
import monitoringRouter from "./routes/monitoring.js";

import { auth } from "./lib/auth.js";
import { API_PATHS, SERVER_CONFIG } from "./config/app.js";

const app = express();

app.set("trust proxy", SERVER_CONFIG.trustProxyHops);

const PORT = SERVER_CONFIG.port;

const apiRateLimiter = rateLimit({
  windowMs: SERVER_CONFIG.requestRateLimit.windowMs,
  limit: SERVER_CONFIG.requestRateLimit.limit,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: SERVER_CONFIG.requestRateLimit.message },
});

const authRateLimiter = rateLimit({
  windowMs: SERVER_CONFIG.authRateLimit.windowMs,
  limit: SERVER_CONFIG.authRateLimit.limit,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: SERVER_CONFIG.authRateLimit.message },
});

const getAllowedOrigins = (): string[] => {
  const origins = [
    ...SERVER_CONFIG.allowedOrigins,
    process.env.FRONTEND_URL,
    process.env.BETTER_AUTH_URL,
  ];

  return origins
    .flatMap((url) => (url ? url.split(",") : []))
    .map((origin) => origin.trim().replace(/\/$/, ""));
};

// CORS configuration
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);

      const allowedOrigins = getAllowedOrigins();
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error(SERVER_CONFIG.corsErrorMessage));
    },
    methods: [...SERVER_CONFIG.corsMethods],
    allowedHeaders: [...SERVER_CONFIG.corsHeaders],
    credentials: true,
  })
);

app.use(helmet());
app.use(requestMonitoring);

// Better Auth remains a dedicated boundary. Its rate limit is intentionally tighter than application APIs.
app.use(API_PATHS.authBase, authRateLimiter);
app.all(API_PATHS.auth, toNodeHandler(auth));

// Application responses are compressed after the authentication boundary.
app.use(
  compression({
    threshold: SERVER_CONFIG.responseCompressionThresholdBytes,
  })
);
app.use(express.json({ limit: SERVER_CONFIG.jsonBodyLimit }));
app.use(apiRateLimiter);

// Every application router is protected at the mount point. Route-level role checks remain in place.
app.use(API_PATHS.prefixed.subjects, requireAuth, subjectsRouter);
app.use(API_PATHS.prefixed.users, requireAuth, usersRouter);
app.use(API_PATHS.prefixed.classes, requireAuth, classesRouter);
app.use(API_PATHS.prefixed.departments, requireAuth, departmentsRouter);
app.use(API_PATHS.prefixed.stats, requireAuth, statsRouter);
app.use(API_PATHS.prefixed.enrollments, requireAuth, enrollmentsRouter);
app.use(API_PATHS.prefixed.announcements, requireAuth, announcementsRouter);
app.use(API_PATHS.prefixed.assignments, requireAuth, assignmentsRouter);
app.use(API_PATHS.prefixed.attendance, requireAuth, attendanceRouter);
app.use(API_PATHS.prefixed.gradebook, requireAuth, gradebookRouter);
app.use(API_PATHS.prefixed.resources, requireAuth, resourcesRouter);
app.use(API_PATHS.prefixed.calendar, requireAuth, calendarRouter);
app.use(API_PATHS.prefixed.storage, requireAuth, storageRouter);
app.use(API_PATHS.prefixed.monitoring, requireAuth, monitoringRouter);

// Legacy root aliases remain available for existing clients but now enforce the same session boundary.
app.use(API_PATHS.root.subjects, requireAuth, subjectsRouter);
app.use(API_PATHS.root.users, requireAuth, usersRouter);
app.use(API_PATHS.root.classes, requireAuth, classesRouter);
app.use(API_PATHS.root.departments, requireAuth, departmentsRouter);
app.use(API_PATHS.root.stats, requireAuth, statsRouter);
app.use(API_PATHS.root.enrollments, requireAuth, enrollmentsRouter);
app.use(API_PATHS.root.announcements, requireAuth, announcementsRouter);
app.use(API_PATHS.root.assignments, requireAuth, assignmentsRouter);
app.use(API_PATHS.root.attendance, requireAuth, attendanceRouter);
app.use(API_PATHS.root.gradebook, requireAuth, gradebookRouter);
app.use(API_PATHS.root.resources, requireAuth, resourcesRouter);
app.use(API_PATHS.root.calendar, requireAuth, calendarRouter);
app.use(API_PATHS.root.storage, requireAuth, storageRouter);
app.use(API_PATHS.root.monitoring, requireAuth, monitoringRouter);

app.get("/", (req, res) => {
  res.send("Backend server is running!");
});

const errorHandler: ErrorRequestHandler = (error, _req, res, next) => {
  if (res.headersSent) return next(error);

  if (error instanceof Error && error.message === SERVER_CONFIG.corsErrorMessage) {
    return res.status(403).json({ error: SERVER_CONFIG.corsErrorMessage });
  }

  console.error("Unhandled request error", { requestId: _req.requestId, error });
  return res.status(500).json({ error: SERVER_CONFIG.genericErrorMessage });
};

app.use(errorHandler);

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`);
});