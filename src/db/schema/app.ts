import { relations } from "drizzle-orm";
import {
  integer,
  boolean,
  jsonb,
  index,
  uniqueIndex,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { user } from "./auth.js";

const timestamps = {
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
};

export type AssignmentRubricCriterion = {
  id: string;
  title: string;
  description?: string;
  maxPoints: number;
};

export type SubmissionRubricScore = {
  criterionId: string;
  points: number;
  feedback?: string;
};

export const classStatusEnum = pgEnum("class_status", [
  "active",
  "inactive",
  "archived",
]);

export const departments = pgTable("departments", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  code: varchar("code", { length: 50 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),

  ...timestamps,
});

export const subjects = pgTable("subjects", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),

  departmentId: integer("department_id")
    .notNull()
    .references(() => departments.id, { onDelete: "restrict" }),

  name: varchar("name", { length: 255 }).notNull(),
  code: varchar("code", { length: 50 }).notNull().unique(),
  description: text("description"),

  ...timestamps,
});

export const storageProviderEnum = pgEnum("storage_provider", ["cloudinary", "supabase"]);
export const storageAssetKindEnum = pgEnum("storage_asset_kind", [
  "avatar",
  "class_banner",
  "resource",
  "assignment_attachment",
  "submission_attachment",
]);
export const storageVisibilityEnum = pgEnum("storage_visibility", ["private"]);
export const storageAssetStateEnum = pgEnum("storage_asset_state", ["pending", "active", "archived", "deleted"]);
export const storageMigrationStatusEnum = pgEnum("storage_migration_status", [
  "not_required",
  "pending",
  "in_progress",
  "migrated",
  "verified",
  "failed",
  "skipped",
]);
export const storageVerificationStatusEnum = pgEnum("storage_verification_status", ["pending", "verified", "failed"]);
export const storageUploadIntentStatusEnum = pgEnum("storage_upload_intent_status", ["pending", "completed", "expired", "cancelled"]);

export const storageAssets = pgTable(
  "storage_assets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    assetKind: storageAssetKindEnum("asset_kind").notNull(),
    entityType: varchar("entity_type", { length: 80 }).notNull(),
    entityId: text("entity_id"),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    classId: integer("class_id"),
    subjectId: integer("subject_id"),
    storageProvider: storageProviderEnum("storage_provider").notNull(),
    bucket: varchar("bucket", { length: 120 }),
    objectPath: text("object_path"),
    sourceProvider: storageProviderEnum("source_provider"),
    sourceIdentifier: text("source_identifier"),
    sourceUrl: text("source_url"),
    fileName: varchar("file_name", { length: 255 }).notNull(),
    mimeType: varchar("mime_type", { length: 120 }),
    fileSizeBytes: integer("file_size_bytes"),
    checksumSha256: varchar("checksum_sha256", { length: 64 }),
    visibility: storageVisibilityEnum("visibility").notNull().default("private"),
    version: integer("version").notNull().default(1),
    state: storageAssetStateEnum("state").notNull().default("pending"),
    migrationStatus: storageMigrationStatusEnum("migration_status").notNull().default("not_required"),
    verificationStatus: storageVerificationStatusEnum("verification_status").notNull().default("pending"),
    verifiedAt: timestamp("verified_at"),
    migrationAttempts: integer("migration_attempts").notNull().default(0),
    lastError: text("last_error"),
    replacedByAssetId: uuid("replaced_by_asset_id"),
    deletedAt: timestamp("deleted_at"),
    ...timestamps,
  },
  (table) => ({
    entityIdx: index("storage_assets_entity_idx").on(table.entityType, table.entityId),
    classIdx: index("storage_assets_class_idx").on(table.classId),
    ownerIdx: index("storage_assets_owner_idx").on(table.ownerId),
    providerPathUnique: uniqueIndex("storage_assets_provider_path_unique").on(table.storageProvider, table.bucket, table.objectPath),
    migrationIdx: index("storage_assets_migration_idx").on(table.migrationStatus, table.verificationStatus),
  })
);

export const storageUploadIntents = pgTable(
  "storage_upload_intents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    assetKind: storageAssetKindEnum("asset_kind").notNull(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    classId: integer("class_id"),
    entityType: varchar("entity_type", { length: 80 }).notNull(),
    entityId: text("entity_id"),
    bucket: varchar("bucket", { length: 120 }).notNull(),
    objectPath: text("object_path").notNull().unique(),
    fileName: varchar("file_name", { length: 255 }).notNull(),
    requestedMimeType: varchar("requested_mime_type", { length: 120 }).notNull(),
    requestedFileSizeBytes: integer("requested_file_size_bytes").notNull(),
    status: storageUploadIntentStatusEnum("status").notNull().default("pending"),
    expiresAt: timestamp("expires_at").notNull(),
    completedAssetId: uuid("completed_asset_id").references(() => storageAssets.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (table) => ({
    ownerStatusIdx: index("storage_upload_intents_owner_status_idx").on(table.ownerId, table.status),
    expiresAtIdx: index("storage_upload_intents_expires_at_idx").on(table.expiresAt),
  })
);

export const storageMigrationEvents = pgTable(
  "storage_migration_events",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    assetId: uuid("asset_id").references(() => storageAssets.id, { onDelete: "cascade" }),
    eventName: varchar("event_name", { length: 120 }).notNull(),
    severity: varchar("severity", { length: 20 }).notNull().default("info"),
    attempt: integer("attempt").notNull().default(0),
    details: jsonb("details"),
    ...timestamps,
  },
  (table) => ({
    assetEventIdx: index("storage_migration_events_asset_event_idx").on(table.assetId, table.createdAt),
    eventNameIdx: index("storage_migration_events_event_name_idx").on(table.eventName),
  })
);

export const userStorageAssets = pgTable(
  "user_storage_assets",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
    avatarAssetId: uuid("avatar_asset_id").references(() => storageAssets.id, { onDelete: "set null" }),
    ...timestamps,
  }
);

export const classes = pgTable(
  "classes",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),

    subjectId: integer("subject_id")
      .notNull()
      .references(() => subjects.id, { onDelete: "cascade" }),
    teacherId: text("teacher_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),

    inviteCode: varchar("invite_code", { length: 50 }).notNull().unique(),
    name: varchar("name", { length: 255 }).notNull(),
    bannerCldPubId: text("banner_cld_pub_id"),
    bannerUrl: text("banner_url"),
    bannerAssetId: uuid("banner_asset_id").references(() => storageAssets.id, { onDelete: "set null" }),
    capacity: integer("capacity").notNull().default(50),
    description: text("description"),
    status: classStatusEnum("status").notNull().default("active"),
    schedules: jsonb("schedules").$type<Schedule[]>().notNull(),

    ...timestamps,
  },
  (table) => ({
    subjectIdIdx: index("classes_subject_id_idx").on(table.subjectId),
    teacherIdIdx: index("classes_teacher_id_idx").on(table.teacherId),
  })
);

export const resourceCategoryEnum = pgEnum("resource_category", [
  "lecture_notes",
  "videos",
  "practice",
  "references",
  "syllabus",
  "other",
]);

export const resources = pgTable(
  "resources",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    classId: integer("class_id")
      .notNull()
      .references(() => classes.id, { onDelete: "cascade" }),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    title: varchar("title", { length: 200 }).notNull(),
    description: text("description"),
    category: resourceCategoryEnum("category").notNull().default("other"),
    resourceUrl: text("resource_url").notNull(),
    storageAssetId: uuid("storage_asset_id").references(() => storageAssets.id, { onDelete: "set null" }),
    mimeType: varchar("mime_type", { length: 120 }),
    fileSizeBytes: integer("file_size_bytes"),
    isPublished: boolean("is_published").notNull().default(true),
    isArchived: boolean("is_archived").notNull().default(false),
    ...timestamps,
  },
  (table) => ({
    classIdIdx: index("resources_class_id_idx").on(table.classId),
    ownerIdIdx: index("resources_owner_id_idx").on(table.ownerId),
    categoryIdx: index("resources_category_idx").on(table.category),
    classCategoryCreatedIdx: index("resources_class_category_created_idx").on(table.classId, table.category, table.createdAt),
    publishedIdx: index("resources_published_idx").on(table.isPublished, table.isArchived),
  })
);

export const resourceFavorites = pgTable(
  "resource_favorites",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    resourceId: integer("resource_id")
      .notNull()
      .references(() => resources.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    ...timestamps,
  },
  (table) => ({
    resourceUserUnique: uniqueIndex("resource_favorites_resource_user_unique").on(table.resourceId, table.userId),
    userIdIdx: index("resource_favorites_user_id_idx").on(table.userId),
  })
);

export const resourceViews = pgTable(
  "resource_views",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    resourceId: integer("resource_id")
      .notNull()
      .references(() => resources.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    lastViewedAt: timestamp("last_viewed_at").defaultNow().notNull(),
    ...timestamps,
  },
  (table) => ({
    resourceUserUnique: uniqueIndex("resource_views_resource_user_unique").on(table.resourceId, table.userId),
    userViewedIdx: index("resource_views_user_viewed_idx").on(table.userId, table.lastViewedAt),
  })
);

export const announcements = pgTable(
  "announcements",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    classId: integer("class_id")
      .notNull()
      .references(() => classes.id, { onDelete: "cascade" }),
    authorId: text("author_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    title: varchar("title", { length: 200 }).notNull(),
    content: text("content").notNull(),
    isPinned: boolean("is_pinned").notNull().default(false),

    ...timestamps,
  },
  (table) => ({
    classIdIdx: index("announcements_class_id_idx").on(table.classId),
    authorIdIdx: index("announcements_author_id_idx").on(table.authorId),
  })
);

export const assignments = pgTable(
  "assignments",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    classId: integer("class_id")
      .notNull()
      .references(() => classes.id, { onDelete: "cascade" }),
    authorId: text("author_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    title: varchar("title", { length: 200 }).notNull(),
    description: text("description").notNull(),
    dueAt: timestamp("due_at"),
    maxPoints: integer("max_points").notNull().default(100),
    rubric: jsonb("rubric").$type<AssignmentRubricCriterion[]>().notNull().default([]),
    allowResubmissions: boolean("allow_resubmissions").notNull().default(false),
    resubmissionDeadline: timestamp("resubmission_deadline"),
    attachmentUrl: text("attachment_url"),
    attachmentAssetId: uuid("attachment_asset_id").references(() => storageAssets.id, { onDelete: "set null" }),
    attachmentName: varchar("attachment_name", { length: 255 }),
    attachmentMimeType: varchar("attachment_mime_type", { length: 120 }),
    attachmentSizeBytes: integer("attachment_size_bytes"),

    ...timestamps,
  },
  (table) => ({
    classIdIdx: index("assignments_class_id_idx").on(table.classId),
    dueAtIdx: index("assignments_due_at_idx").on(table.dueAt),
  })
);

export const submissions = pgTable(
  "submissions",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    assignmentId: integer("assignment_id")
      .notNull()
      .references(() => assignments.id, { onDelete: "cascade" }),
    studentId: text("student_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    attachmentUrl: text("attachment_url"),
    attachmentAssetId: uuid("attachment_asset_id").references(() => storageAssets.id, { onDelete: "set null" }),
    attachmentName: varchar("attachment_name", { length: 255 }),
    attachmentMimeType: varchar("attachment_mime_type", { length: 120 }),
    attachmentSizeBytes: integer("attachment_size_bytes"),
    submittedAt: timestamp("submitted_at").defaultNow().notNull(),
    grade: integer("grade"),
    feedback: text("feedback"),
    rubricScores: jsonb("rubric_scores").$type<SubmissionRubricScore[]>().notNull().default([]),

    ...timestamps,
  },
  (table) => ({
    assignmentIdIdx: index("submissions_assignment_id_idx").on(table.assignmentId),
    studentIdIdx: index("submissions_student_id_idx").on(table.studentId),
    assignmentStudentUnique: uniqueIndex("submissions_assignment_student_unique").on(
      table.assignmentId,
      table.studentId
    ),
  })
);

export const attendanceStatusEnum = pgEnum("attendance_status", [
  "present",
  "absent",
  "late",
  "excused",
]);

export const attendanceSessions = pgTable(
  "attendance_sessions",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    classId: integer("class_id")
      .notNull()
      .references(() => classes.id, { onDelete: "cascade" }),
    teacherId: text("teacher_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    sessionDate: timestamp("session_date").notNull(),
    notes: text("notes"),

    ...timestamps,
  },
  (table) => ({
    classDateUnique: uniqueIndex("attendance_sessions_class_date_unique").on(table.classId, table.sessionDate),
    classIdIdx: index("attendance_sessions_class_id_idx").on(table.classId),
  })
);

export const attendanceRecords = pgTable(
  "attendance_records",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    sessionId: integer("session_id")
      .notNull()
      .references(() => attendanceSessions.id, { onDelete: "cascade" }),
    studentId: text("student_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    status: attendanceStatusEnum("status").notNull().default("present"),
    note: text("note"),

    ...timestamps,
  },
  (table) => ({
    sessionStudentUnique: uniqueIndex("attendance_records_session_student_unique").on(table.sessionId, table.studentId),
    sessionIdIdx: index("attendance_records_session_id_idx").on(table.sessionId),
    studentSessionIdx: index("attendance_records_student_session_idx").on(table.studentId, table.sessionId),
  })
);

export const attendanceCorrectionStatusEnum = pgEnum("attendance_correction_status", [
  "pending",
  "approved",
  "rejected",
]);

export const attendanceCorrections = pgTable(
  "attendance_corrections",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    attendanceRecordId: integer("attendance_record_id")
      .notNull()
      .references(() => attendanceRecords.id, { onDelete: "cascade" }),
    studentId: text("student_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    requestedStatus: attendanceStatusEnum("requested_status").notNull(),
    reason: text("reason").notNull(),
    status: attendanceCorrectionStatusEnum("status").notNull().default("pending"),
    reviewerId: text("reviewer_id").references(() => user.id, { onDelete: "restrict" }),
    reviewNote: text("review_note"),
    reviewedAt: timestamp("reviewed_at"),

    ...timestamps,
  },
  (table) => ({
    recordIdIdx: index("attendance_corrections_record_id_idx").on(table.attendanceRecordId),
    studentStatusIdx: index("attendance_corrections_student_status_idx").on(table.studentId, table.status),
    statusCreatedIdx: index("attendance_corrections_status_created_idx").on(table.status, table.createdAt),
  })
);

export const gradebookCategories = pgTable(
  "gradebook_categories",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    classId: integer("class_id")
      .notNull()
      .references(() => classes.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 120 }).notNull(),
    weight: integer("weight").notNull(),
    isActive: boolean("is_active").notNull().default(true),

    ...timestamps,
  },
  (table) => ({
    classActiveIdx: index("gradebook_categories_class_active_idx").on(table.classId, table.isActive),
  })
);

export const gradebookEntries = pgTable(
  "gradebook_entries",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    classId: integer("class_id")
      .notNull()
      .references(() => classes.id, { onDelete: "cascade" }),
    teacherId: text("teacher_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    studentId: text("student_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    categoryId: integer("category_id").references(() => gradebookCategories.id, { onDelete: "set null" }),
    title: varchar("title", { length: 200 }).notNull(),
    points: integer("points").notNull(),
    maxPoints: integer("max_points").notNull(),
    feedback: text("feedback"),
    isReleased: boolean("is_released").notNull().default(true),
    releasedAt: timestamp("released_at"),

    ...timestamps,
  },
  (table) => ({
    classStudentIdx: index("gradebook_entries_class_student_idx").on(table.classId, table.studentId),
    classReleaseIdx: index("gradebook_entries_class_release_idx").on(table.classId, table.isReleased),
    categoryIdx: index("gradebook_entries_category_idx").on(table.categoryId),
  })
);

export const gradebookEntryAudits = pgTable(
  "gradebook_entry_audits",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    gradebookEntryId: integer("gradebook_entry_id")
      .notNull()
      .references(() => gradebookEntries.id, { onDelete: "cascade" }),
    actorId: text("actor_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    action: varchar("action", { length: 32 }).notNull(),
    details: jsonb("details").notNull(),
    ...timestamps,
  },
  (table) => ({
    entryCreatedIdx: index("gradebook_entry_audits_entry_created_idx").on(table.gradebookEntryId, table.createdAt),
  })
);

export const enrollments = pgTable(
  "enrollments",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),

    studentId: text("student_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    classId: integer("class_id")
      .notNull()
      .references(() => classes.id, { onDelete: "cascade" }),

    ...timestamps,
  },
  (table) => ({
    studentIdIdx: index("enrollments_student_id_idx").on(table.studentId),
    classIdIdx: index("enrollments_class_id_idx").on(table.classId),
    studentClassUnique: uniqueIndex("enrollments_student_class_unique").on(
      table.studentId,
      table.classId
    ),
  })
);

export const departmentsRelations = relations(departments, ({ many }) => ({
  subjects: many(subjects),
}));

export const subjectsRelations = relations(subjects, ({ one, many }) => ({
  department: one(departments, {
    fields: [subjects.departmentId],
    references: [departments.id],
  }),
  classes: many(classes),
}));

export const classesRelations = relations(classes, ({ one, many }) => ({
  subject: one(subjects, {
    fields: [classes.subjectId],
    references: [subjects.id],
  }),
  teacher: one(user, {
    fields: [classes.teacherId],
    references: [user.id],
  }),
  enrollments: many(enrollments),
  announcements: many(announcements),
  assignments: many(assignments),
  attendanceSessions: many(attendanceSessions),
  gradebookEntries: many(gradebookEntries),
  gradebookCategories: many(gradebookCategories),
}));

export const assignmentsRelations = relations(assignments, ({ one, many }) => ({
  class: one(classes, {
    fields: [assignments.classId],
    references: [classes.id],
  }),
  author: one(user, {
    fields: [assignments.authorId],
    references: [user.id],
  }),
  submissions: many(submissions),
}));

export const submissionsRelations = relations(submissions, ({ one }) => ({
  assignment: one(assignments, {
    fields: [submissions.assignmentId],
    references: [assignments.id],
  }),
  student: one(user, {
    fields: [submissions.studentId],
    references: [user.id],
  }),
}));

export const resourcesRelations = relations(resources, ({ one, many }) => ({
  class: one(classes, { fields: [resources.classId], references: [classes.id] }),
  owner: one(user, { fields: [resources.ownerId], references: [user.id] }),
  favorites: many(resourceFavorites),
  views: many(resourceViews),
}));

export const resourceFavoritesRelations = relations(resourceFavorites, ({ one }) => ({
  resource: one(resources, { fields: [resourceFavorites.resourceId], references: [resources.id] }),
  user: one(user, { fields: [resourceFavorites.userId], references: [user.id] }),
}));

export const resourceViewsRelations = relations(resourceViews, ({ one }) => ({
  resource: one(resources, { fields: [resourceViews.resourceId], references: [resources.id] }),
  user: one(user, { fields: [resourceViews.userId], references: [user.id] }),
}));

export const announcementsRelations = relations(announcements, ({ one }) => ({
  class: one(classes, {
    fields: [announcements.classId],
    references: [classes.id],
  }),
  author: one(user, {
    fields: [announcements.authorId],
    references: [user.id],
  }),
}));

export const attendanceSessionsRelations = relations(attendanceSessions, ({ one, many }) => ({
  class: one(classes, { fields: [attendanceSessions.classId], references: [classes.id] }),
  teacher: one(user, { fields: [attendanceSessions.teacherId], references: [user.id] }),
  records: many(attendanceRecords),
}));

export const attendanceRecordsRelations = relations(attendanceRecords, ({ one }) => ({
  session: one(attendanceSessions, { fields: [attendanceRecords.sessionId], references: [attendanceSessions.id] }),
  student: one(user, { fields: [attendanceRecords.studentId], references: [user.id] }),
}));

export const gradebookCategoriesRelations = relations(gradebookCategories, ({ one, many }) => ({
  class: one(classes, { fields: [gradebookCategories.classId], references: [classes.id] }),
  entries: many(gradebookEntries),
}));

export const gradebookEntriesRelations = relations(gradebookEntries, ({ one, many }) => ({
  class: one(classes, { fields: [gradebookEntries.classId], references: [classes.id] }),
  teacher: one(user, { fields: [gradebookEntries.teacherId], references: [user.id] }),
  student: one(user, { fields: [gradebookEntries.studentId], references: [user.id] }),
  category: one(gradebookCategories, { fields: [gradebookEntries.categoryId], references: [gradebookCategories.id] }),
  audits: many(gradebookEntryAudits),
}));

export const gradebookEntryAuditsRelations = relations(gradebookEntryAudits, ({ one }) => ({
  gradebookEntry: one(gradebookEntries, { fields: [gradebookEntryAudits.gradebookEntryId], references: [gradebookEntries.id] }),
  actor: one(user, { fields: [gradebookEntryAudits.actorId], references: [user.id] }),
}));

export const enrollmentsRelations = relations(enrollments, ({ one }) => ({
  student: one(user, {
    fields: [enrollments.studentId],
    references: [user.id],
  }),
  class: one(classes, {
    fields: [enrollments.classId],
    references: [classes.id],
  }),
}));

export type Department = typeof departments.$inferSelect;
export type NewDepartment = typeof departments.$inferInsert;

export type Subject = typeof subjects.$inferSelect;
export type NewSubject = typeof subjects.$inferInsert;

export type Class = typeof classes.$inferSelect;
export type NewClass = typeof classes.$inferInsert;

export type Resource = typeof resources.$inferSelect;
export type NewResource = typeof resources.$inferInsert;
export type ResourceFavorite = typeof resourceFavorites.$inferSelect;
export type ResourceView = typeof resourceViews.$inferSelect;

export type Announcement = typeof announcements.$inferSelect;
export type NewAnnouncement = typeof announcements.$inferInsert;

export type Assignment = typeof assignments.$inferSelect;
export type NewAssignment = typeof assignments.$inferInsert;

export type Submission = typeof submissions.$inferSelect;
export type NewSubmission = typeof submissions.$inferInsert;

export type Enrollment = typeof enrollments.$inferSelect;
export type NewEnrollment = typeof enrollments.$inferInsert;

export type AttendanceSession = typeof attendanceSessions.$inferSelect;
export type NewAttendanceSession = typeof attendanceSessions.$inferInsert;

export type AttendanceRecord = typeof attendanceRecords.$inferSelect;
export type NewAttendanceRecord = typeof attendanceRecords.$inferInsert;

export type GradebookCategory = typeof gradebookCategories.$inferSelect;
export type NewGradebookCategory = typeof gradebookCategories.$inferInsert;

export type GradebookEntry = typeof gradebookEntries.$inferSelect;
export type NewGradebookEntry = typeof gradebookEntries.$inferInsert;

export type GradebookEntryAudit = typeof gradebookEntryAudits.$inferSelect;
export type NewGradebookEntryAudit = typeof gradebookEntryAudits.$inferInsert;