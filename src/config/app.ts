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

export const CLOUDINARY_CONFIG = {
  cloudName: process.env.CLOUDINARY_CLOUD_NAME ?? "",
  apiKey: process.env.CLOUDINARY_API_KEY ?? "",
  apiSecret: process.env.CLOUDINARY_API_SECRET ?? "",
  uploadFolder: process.env.CLOUDINARY_UPLOAD_FOLDER ?? "classroom/resources",
};

export const CALENDAR_CONFIG = {
  weekStartsOn: 1,
  weekdayNames: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
} as const;

export const ATTENDANCE_CONFIG = {
  riskThresholdPercent: 75,
  qualifyingStatuses: ["present", "late", "excused"],
} as const;

export const ATTENDANCE_ROUTE_PATHS = {
  root: "/",
  sessions: "/sessions",
  accessibleClasses: "/classes",
  summary: "/summary",
} as const;

export const GRADEBOOK_ROUTE_PATHS = {
  root: "/",
  accessibleClasses: "/classes",
  summary: "/summary",
  entryById: "/:id",
} as const;

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
    calendar: "/api/calendar",
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
    calendar: "/calendar",
  },
} as const;
