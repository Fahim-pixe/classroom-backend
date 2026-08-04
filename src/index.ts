import("apminsight")
  .then(({ default: AgentAPI }) => AgentAPI.config())
  .catch(() => console.log("APM not available in this environment"));

import cors from "cors";
import express from "express";
import { toNodeHandler } from "better-auth/node";

import subjectsRouter from "./routes/subjects.js";
import usersRouter from "./routes/users.js";
import classesRouter from "./routes/classes.js";
import departmentsRouter from "./routes/departments.js";
import statsRouter from "./routes/stats.js";
import enrollmentsRouter from "./routes/enrollments.js";

// import securityMiddleware from "./middleware/security.js";
import { auth } from "./lib/auth.js";

const app = express();

const PORT = Number(process.env.PORT) || 8000;

// Helper to parse comma-separated frontend URLs and strip trailing slashes
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

// 1. CORS Middleware (Must be top level)
const corsOptions: cors.CorsOptions = {
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
};

app.use(cors(corsOptions));

// 2. Add explicit Preflight handler for ALL routes (REQUIRED for CORS preflight)
app.options("*", cors(corsOptions));

// 3. Mount Better Auth Handler
app.all("/api/auth/*splat", toNodeHandler(auth));

// 4. Body Parser
app.use(express.json());

// app.use(securityMiddleware);

// 5. API Routes
app.use("/api/subjects", subjectsRouter);
app.use("/api/users", usersRouter);
app.use("/api/classes", classesRouter);
app.use("/api/departments", departmentsRouter);
app.use("/api/stats", statsRouter);
app.use("/api/enrollments", enrollmentsRouter);

// Fallback redirects / direct routes (Fixes requesting /users directly)
app.use("/users", usersRouter); 

app.get("/", (req, res) => {
  res.send("Backend server is running!");
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`);
});