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

import { auth } from "./lib/auth.js";

const app = express();

const PORT = Number(process.env.PORT) || 8000;

const getAllowedOrigins = (): string[] => {
  const origins = [
    process.env.FRONTEND_URL,
    process.env.BETTER_AUTH_URL,
    "http://localhost:5173",
    "http://localhost:3000",
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
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
    credentials: true,
  })
);

// Better Auth Route
app.all("/api/auth/*splat", toNodeHandler(auth));

app.use(express.json());

// Standard /api prefixed routes
app.use("/api/subjects", subjectsRouter);
app.use("/api/users", usersRouter);
app.use("/api/classes", classesRouter);
app.use("/api/departments", departmentsRouter);
app.use("/api/stats", statsRouter);
app.use("/api/enrollments", enrollmentsRouter);
app.use("/api/announcements", announcementsRouter);
app.use("/api/assignments", assignmentsRouter);
app.use("/api/attendance", attendanceRouter);
app.use("/api/gradebook", gradebookRouter);
app.use("/api/resources", resourcesRouter);

app.use("/subjects", requireAuth, subjectsRouter);
app.use("/users", requireAuth, usersRouter);
app.use("/classes", requireAuth, classesRouter);
// Root-level route aliases (Fixes 404 errors when Refine hits root paths directly)
app.use("/subjects", subjectsRouter);
app.use("/users", usersRouter);
app.use("/classes", classesRouter);
app.use("/departments", departmentsRouter);
app.use("/stats", statsRouter);
app.use("/enrollments", enrollmentsRouter);
app.use("/announcements", announcementsRouter);
app.use("/assignments", assignmentsRouter);
app.use("/attendance", attendanceRouter);
app.use("/gradebook", gradebookRouter);
app.use("/resources", resourcesRouter);

app.get("/", (req, res) => {
  res.send("Backend server is running!");
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`);
});