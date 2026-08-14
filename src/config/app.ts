const normalizeOrigin = (origin: string) => origin.trim().replace(/\/$/, "");

const configuredOrigins = (process.env.CORS_ORIGINS ?? "")
  .split(",")
  .map(normalizeOrigin)
  .filter(Boolean);

export const SERVER_CONFIG = {
  port: Number(process.env.PORT) || 8000,
  trustProxyHops: Number(process.env.TRUST_PROXY_HOPS ?? 1),
  allowedOrigins: configuredOrigins,
  corsMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  corsHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  corsErrorMessage: "Origin is not permitted to access this service",
  genericErrorMessage: "Unexpected server error",
  responseCompressionThresholdBytes: 1024,
  jsonBodyLimit: "1mb",
  requestRateLimit: {
    windowMs: 15 * 60 * 1000,
    limit: 600,
    message: "Too many requests. Please try again later.",
  },
  authRateLimit: {
    windowMs: 15 * 60 * 1000,
    limit: 20,
    message: "Too many authentication attempts. Please try again later.",
  },
  monitoring: {
    enabled: process.env.MONITORING_ENABLED !== "false",
    requestIdHeader: "x-request-id",
    slowRequestThresholdMilliseconds: Number(process.env.MONITORING_SLOW_REQUEST_THRESHOLD_MS ?? 1_000),
    webVitalMaximumValue: Number(process.env.MONITORING_WEB_VITAL_MAXIMUM_VALUE ?? 60_000),
    webVitalMetricNames: ["CLS", "FCP", "INP", "LCP", "TTFB"],
    webVitalRatings: ["good", "needs-improvement", "poor"],
    eventNames: {
      requestCompleted: "api_request_completed",
      requestFailed: "api_request_failed",
      webVitalReceived: "web_vital_received",
    },
  },
} as const;

export const CLOUDINARY_CONFIG = {
  cloudName: process.env.CLOUDINARY_CLOUD_NAME ?? "",
  apiKey: process.env.CLOUDINARY_API_KEY ?? "",
  apiSecret: process.env.CLOUDINARY_API_SECRET ?? "",
  uploadFolder: process.env.CLOUDINARY_UPLOAD_FOLDER ?? "classroom/resources",
  legacyReadEnabled: process.env.STORAGE_LEGACY_CLOUDINARY_READS_ENABLED !== "false",
} as const;

export const STORAGE_CONFIG = {
  provider: "supabase",
  featureFlags: {
    supabaseWritesEnabled: process.env.STORAGE_SUPABASE_WRITES_ENABLED === "true",
    legacyCloudinaryReadsEnabled: process.env.STORAGE_LEGACY_CLOUDINARY_READS_ENABLED !== "false",
  },
  supabase: {
    url: process.env.SUPABASE_URL ?? "",
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    buckets: {
      avatars: process.env.SUPABASE_AVATARS_BUCKET ?? "avatars",
      learningAssets: process.env.SUPABASE_LEARNING_ASSETS_BUCKET ?? "learning-assets",
    },
  },
  routePaths: {
    root: "/",
    uploadIntents: "/upload-intents",
    uploadIntentById: "/upload-intents/:intentId",
    uploadIntentConfirm: "/upload-intents/:intentId/confirm",
    uploadIntentCancel: "/upload-intents/:intentId/cancel",
    accessByAssetId: "/assets/:assetId/access",
    redirectByAssetId: "/assets/:assetId/redirect",
  },
  visibility: {
    private: "private",
  },
  accessModes: {
    preview: "preview",
    download: "download",
  },
  signedUrlTtlSeconds: {
    preview: Number(process.env.STORAGE_PREVIEW_URL_TTL_SECONDS ?? 300),
    download: Number(process.env.STORAGE_DOWNLOAD_URL_TTL_SECONDS ?? 900),
    uploadIntent: Number(process.env.STORAGE_UPLOAD_INTENT_TTL_SECONDS ?? 900),
  },
  signedUrlCacheSafetySeconds: Number(process.env.STORAGE_SIGNED_URL_CACHE_SAFETY_SECONDS ?? 30),
  uploads: {
    standardUploadMaximumBytes: Number(process.env.STORAGE_STANDARD_UPLOAD_MAXIMUM_BYTES ?? 6 * 1024 * 1024),
    maximumBytesByKind: {
      avatar: Number(process.env.STORAGE_AVATAR_MAXIMUM_BYTES ?? 5 * 1024 * 1024),
      classBanner: Number(process.env.STORAGE_CLASS_BANNER_MAXIMUM_BYTES ?? 8 * 1024 * 1024),
      resource: Number(process.env.STORAGE_RESOURCE_MAXIMUM_BYTES ?? 50 * 1024 * 1024),
      assignmentAttachment: Number(process.env.STORAGE_ASSIGNMENT_ATTACHMENT_MAXIMUM_BYTES ?? 25 * 1024 * 1024),
      submissionAttachment: Number(process.env.STORAGE_SUBMISSION_ATTACHMENT_MAXIMUM_BYTES ?? 25 * 1024 * 1024),
    },
    allowedMimeTypesByKind: {
      avatar: ["image/jpeg", "image/png", "image/webp"],
      classBanner: ["image/jpeg", "image/png", "image/webp"],
      resource: [
        "application/pdf",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "text/plain",
        "image/jpeg",
        "image/png",
        "image/webp",
      ],
      assignmentAttachment: [
        "application/pdf",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "text/plain",
        "image/jpeg",
        "image/png",
        "image/webp",
      ],
      submissionAttachment: [
        "application/pdf",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "text/plain",
        "image/jpeg",
        "image/png",
        "image/webp",
      ],
    },
  },
  objectPathPolicy: {
    maximumFileNameLength: 96,
    maximumVersion: 1000,
    cacheControlSeconds: 3600,
  },
  migration: {
    defaultBatchSize: 50,
    maximumBatchSize: 200,
    defaultConcurrency: 4,
    maximumConcurrency: 10,
    retryMaximumAttempts: 3,
    retryBaseDelayMilliseconds: 500,
    stabilizationWindowDays: Number(process.env.STORAGE_STABILIZATION_WINDOW_DAYS ?? 14),
  },
} as const;

export const ASSIGNMENT_WORKFLOW_CONFIG = {
  rubric: {
    maximumCriteria: 12,
    maximumTitleLength: 120,
    maximumDescriptionLength: 500,
  },
  resubmission: {
    defaultAllowed: false,
  },
} as const;

export const RESOURCE_LIST_CONFIG = {
  defaultPage: 1,
  defaultPageSize: 24,
  maxPageSize: 100,
  queryParams: {
    favoritesOnly: "favoritesOnly",
    folder: "folder",
    tag: "tag",
    includeExpired: "includeExpired",
  },
} as const;

export const RESOURCE_LIFECYCLE_CONFIG = {
  metadata: {
    maximumFolderLength: 120,
    maximumTagCount: 12,
    maximumTagLength: 48,
    maximumVersion: 1_000,
  },
  routePaths: {
    resourceById: "/:id",
    archiveById: "/:id/archive",
    restoreById: "/:id/restore",
    versionById: "/:id/version",
  },
} as const;

export const CLASS_LIFECYCLE_CONFIG = {
  inviteCodeLength: 10,
  duplicateNameSuffix: "(Copy)",
  routePaths: {
    archiveById: "/:id/archive",
    restoreById: "/:id/restore",
    duplicateById: "/:id/duplicate",
    rotateInviteById: "/:id/invite-code",
  },
} as const;

export const MONITORING_ROUTE_PATHS = {
  root: "/",
  webVitals: "/web-vitals",
} as const;

export const CALENDAR_CONFIG = {
  weekStartsOn: 1,
  weekdayNames: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
  eventTypes: ["class_session", "assignment_due", "exam", "holiday", "custom"],
  recurrenceValues: ["none", "weekly", "monthly"],
  defaultRecurrence: "none",
  defaultEventType: "custom",
  validation: {
    maximumTitleLength: 200,
    maximumDescriptionLength: 5_000,
    maximumRangeDays: 93,
    maximumRecurrenceOccurrences: 1_000,
    millisecondsPerDay: 86_400_000,
  },
} as const;
export const CALENDAR_ROUTE_PATHS = {
  root: "/",
  myWeek: "/my-week",
  accessibleClasses: "/classes",
  eventById: "/:id",
} as const;
export const NOTIFICATION_CONFIG = {
  defaultInAppPreferences: {
    class_session: true,
    assignment_due: true,
    exam: true,
    holiday: true,
    custom: true,
  },
  defaultEmailPreferences: {
    class_session: false,
    assignment_due: false,
    exam: false,
    holiday: false,
    custom: false,
  },
} as const;
export const NOTIFICATION_ROUTE_PATHS = {
  preferences: "/preferences",
} as const;

export const ATTENDANCE_CONFIG = {
  riskThresholdPercent: 75,
  qualifyingStatuses: ["present", "late", "excused"],
  correction: {
    maximumReasonLength: 1_000,
    maximumReviewNoteLength: 1_000,
    reviewStatuses: ["approved", "rejected"],
  },
} as const;

export const ATTENDANCE_ROUTE_PATHS = {
  root: "/",
  sessions: "/sessions",
  accessibleClasses: "/classes",
  summary: "/summary",
  corrections: "/corrections",
  correctionById: "/corrections/:id",
} as const;

export const PRODUCTIVITY_REPORTING_CONFIG = {
  atRiskStudents: {
    attendanceThresholdPercent: ATTENDANCE_CONFIG.riskThresholdPercent,
    minimumAttendanceRecords: 2,
    maximumAlerts: 25,
  },
  deadlines: {
    upcomingWindowDays: 7,
  },
} as const;

export const GRADEBOOK_WORKFLOW_CONFIG = {
  category: {
    maximumTitleLength: 120,
    minimumWeight: 1,
    maximumWeight: 100,
  },
  entry: {
    maximumTitleLength: 200,
    maximumFeedbackLength: 5_000,
  },
  export: {
    contentType: "text/csv; charset=utf-8",
    attachmentFileName: "gradebook.csv",
  },
} as const;

export const GRADEBOOK_ROUTE_PATHS = {
  root: "/",
  accessibleClasses: "/classes",
  summary: "/summary",
  categories: "/categories",
  entryById: "/:id",
  entryReleaseById: "/:id/release",
  entryAuditById: "/:id/audit",
  export: "/export",
} as const;

export const API_PATHS = {
  authBase: "/api/auth",
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
    notifications: "/api/notifications",
    storage: "/api/storage",
    monitoring: "/api/monitoring",
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
    notifications: "/notifications",
    storage: "/storage",
    monitoring: "/monitoring",
  },
} as const;
