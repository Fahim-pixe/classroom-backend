const normalizeOrigin = (origin: string) => origin.trim().replace(/\/$/, "");

const configuredOrigins = (process.env.CORS_ORIGINS ?? "")
  .split(",")
  .map(normalizeOrigin)
  .filter(Boolean);

export const SERVER_CONFIG = {
  port: Number(process.env.PORT) || 8000,
  allowedOrigins: configuredOrigins,
  corsMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  corsHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
};

export const API_PATHS = {
  auth: "/api/auth/*splat",
  prefixed: {
    subjects: "/api/subjects",
    users: "/api/users",
    classes: "/api/classes",
    departments: "/api/departments",
    stats: "/api/stats",
    enrollments: "/api/enrollments",
    announcements: "/api/announcements",
    assignments: "/api/assignments",
    attendance: "/api/attendance",
    gradebook: "/api/gradebook",
    resources: "/api/resources",
  },
  root: {
    subjects: "/subjects",
    users: "/users",
    classes: "/classes",
    departments: "/departments",
    stats: "/stats",
    enrollments: "/enrollments",
    announcements: "/announcements",
    assignments: "/assignments",
    attendance: "/attendance",
    gradebook: "/gradebook",
    resources: "/resources",
  },
} as const;
