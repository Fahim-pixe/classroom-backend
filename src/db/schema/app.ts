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
    submittedAt: timestamp("submitted_at").defaultNow().notNull(),
    grade: integer("grade"),
    feedback: text("feedback"),

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
    title: varchar("title", { length: 200 }).notNull(),
    points: integer("points").notNull(),
    maxPoints: integer("max_points").notNull(),
    feedback: text("feedback"),

    ...timestamps,
  },
  (table) => ({
    classStudentIdx: index("gradebook_entries_class_student_idx").on(table.classId, table.studentId),
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

export const gradebookEntriesRelations = relations(gradebookEntries, ({ one }) => ({
  class: one(classes, { fields: [gradebookEntries.classId], references: [classes.id] }),
  teacher: one(user, { fields: [gradebookEntries.teacherId], references: [user.id] }),
  student: one(user, { fields: [gradebookEntries.studentId], references: [user.id] }),
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

export type GradebookEntry = typeof gradebookEntries.$inferSelect;
export type NewGradebookEntry = typeof gradebookEntries.$inferInsert;