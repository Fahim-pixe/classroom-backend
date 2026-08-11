import("apminsight")
  .then(({ default: AgentAPI }) => AgentAPI.config())
  .catch(() => console.log("APM not available in this environment"));

import cors from "cors";
import express from "express";
import { toNodeHandler } from "better-auth/node";
import { requireAuth } from "./middleware/auth.js";
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

import { auth } from "./lib/auth.js";
import { API_PATHS, SERVER_CONFIG } from "./config/app.js";

const app = express();

const PORT = SERVER_CONFIG.port;

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
      return callback(new Error(`CORS blocked for origin: ${origin}`));
    },
    methods: SERVER_CONFIG.corsMethods,
    allowedHeaders: SERVER_CONFIG.corsHeaders,
    credentials: true,
  })
);

// Better Auth Route
app.all(API_PATHS.auth, toNodeHandler(auth));

app.use(express.json());

// Standard /api prefixed routes
app.use(API_PATHS.prefixed.subjects, subjectsRouter);
app.use(API_PATHS.prefixed.users, usersRouter);
app.use(API_PATHS.prefixed.classes, classesRouter);
app.use(API_PATHS.prefixed.departments, departmentsRouter);
app.use(API_PATHS.prefixed.stats, statsRouter);
app.use(API_PATHS.prefixed.enrollments, enrollmentsRouter);
app.use(API_PATHS.prefixed.announcements, announcementsRouter);
app.use(API_PATHS.prefixed.assignments, assignmentsRouter);
app.use(API_PATHS.prefixed.attendance, attendanceRouter);
app.use(API_PATHS.prefixed.gradebook, gradebookRouter);
app.use(API_PATHS.prefixed.resources, resourcesRouter);
app.use(API_PATHS.prefixed.calendar, calendarRouter);

app.use(API_PATHS.root.subjects, requireAuth, subjectsRouter);
app.use(API_PATHS.root.users, requireAuth, usersRouter);
app.use(API_PATHS.root.classes, requireAuth, classesRouter);
// Root-level route aliases (Fixes 404 errors when Refine hits root paths directly)
app.use(API_PATHS.root.subjects, subjectsRouter);
app.use(API_PATHS.root.users, usersRouter);
app.use(API_PATHS.root.classes, classesRouter);
app.use(API_PATHS.root.departments, departmentsRouter);
app.use(API_PATHS.root.stats, statsRouter);
app.use(API_PATHS.root.enrollments, enrollmentsRouter);
app.use(API_PATHS.root.announcements, announcementsRouter);
app.use(API_PATHS.root.assignments, assignmentsRouter);
app.use(API_PATHS.root.attendance, attendanceRouter);
app.use(API_PATHS.root.gradebook, gradebookRouter);
app.use(API_PATHS.root.resources, resourcesRouter);
app.use(API_PATHS.root.calendar, calendarRouter);

app.get("/", (req, res) => {
  res.send("Backend server is running!");
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`);
});