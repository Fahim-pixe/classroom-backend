import express from "express";
import { and, asc, desc, eq, getTableColumns, gte, isNull, lte, sql } from "drizzle-orm";

import { CALENDAR_CONFIG, PRODUCTIVITY_REPORTING_CONFIG } from "../config/app.js";
import { db } from "../db/index.js";
import {
  announcements,
  assignments,
  attendanceRecords,
  attendanceSessions,
  classes,
  departments,
  enrollments,
  gradebookEntries,
  subjects,
  submissions,
  user,
} from "../db/schema/index.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

// Overview counts for core entities
router.get("/overview", async (req, res) => {
  try {
    const [
      usersCount,
      teachersCount,
      adminsCount,
      subjectsCount,
      departmentsCount,
      classesCount,
    ] = await Promise.all([
      db.select({ count: sql<number>`count(*)` }).from(user),
      db
        .select({ count: sql<number>`count(*)` })
        .from(user)
        .where(eq(user.role, "teacher")),
      db
        .select({ count: sql<number>`count(*)` })
        .from(user)
        .where(eq(user.role, "admin")),
      db.select({ count: sql<number>`count(*)` }).from(subjects),
      db.select({ count: sql<number>`count(*)` }).from(departments),
      db.select({ count: sql<number>`count(*)` }).from(classes),
    ]);

    res.status(200).json({
      data: {
        users: usersCount[0]?.count ?? 0,
        teachers: teachersCount[0]?.count ?? 0,
        admins: adminsCount[0]?.count ?? 0,
        subjects: subjectsCount[0]?.count ?? 0,
        departments: departmentsCount[0]?.count ?? 0,
        classes: classesCount[0]?.count ?? 0,
      },
    });
  } catch (error) {
    console.error("GET /stats/overview error:", error);
    res.status(500).json({ error: "Failed to fetch overview stats" });
  }
});

// Latest activity summaries
router.get("/latest", async (req, res) => {
  try {
    const { limit = 5 } = req.query;
    const limitPerPage = Math.max(1, +limit);

    const [latestClasses, latestTeachers] = await Promise.all([
      db
        .select({
          ...getTableColumns(classes),
          subject: {
            ...getTableColumns(subjects),
          },
          teacher: {
            ...getTableColumns(user),
          },
        })
        .from(classes)
        .leftJoin(subjects, eq(classes.subjectId, subjects.id))
        .leftJoin(user, eq(classes.teacherId, user.id))
        .orderBy(desc(classes.createdAt))
        .limit(limitPerPage),
      db
        .select()
        .from(user)
        .where(eq(user.role, "teacher"))
        .orderBy(desc(user.createdAt))
        .limit(limitPerPage),
    ]);

    res.status(200).json({
      data: {
        latestClasses,
        latestTeachers,
      },
    });
  } catch (error) {
    console.error("GET /stats/latest error:", error);
    res.status(500).json({ error: "Failed to fetch latest stats" });
  }
});

// Aggregates for charts
router.get("/charts", async (req, res) => {
  try {
    const [usersByRole, subjectsByDepartment, classesBySubject] =
      await Promise.all([
        db
          .select({
            role: user.role,
            total: sql<number>`count(*)`,
          })
          .from(user)
          .groupBy(user.role),
        db
          .select({
            departmentId: departments.id,
            departmentName: departments.name,
            totalSubjects: sql<number>`count(${subjects.id})`,
          })
          .from(departments)
          .leftJoin(subjects, eq(subjects.departmentId, departments.id))
          .groupBy(departments.id),
        db
          .select({
            subjectId: subjects.id,
            subjectName: subjects.name,
            totalClasses: sql<number>`count(${classes.id})`,
          })
          .from(subjects)
          .leftJoin(classes, eq(classes.subjectId, subjects.id))
          .groupBy(subjects.id),
      ]);

    res.status(200).json({
      data: {
        usersByRole,
        subjectsByDepartment,
        classesBySubject,
      },
    });
  } catch (error) {
    console.error("GET /stats/charts error:", error);
    res.status(500).json({ error: "Failed to fetch chart stats" });
  }
});

// Consolidated, role-aware dashboard payload. Aggregation stays in the database so the
// frontend never needs to download every student, class, or enrollment record.
router.get("/dashboard", requireAuth, async (req, res) => {
  try {
    const viewer = req.user!;
    const now = new Date();
    const deadlineWindowEnd = new Date(now);
    deadlineWindowEnd.setDate(now.getDate() + PRODUCTIVITY_REPORTING_CONFIG.deadlines.upcomingWindowDays);
    if (viewer.role === "admin") {
      const [students, faculty, activeClasses, subjectCount, studentDistribution, enrollmentTrend, recentClasses, recentEnrollments, recentSubjects, recentAssignments, subjectDistribution, atRiskStudents] = await Promise.all([
        db.select({ value: sql<number>`count(*)` }).from(user).where(eq(user.role, "student")),
        db.select({ value: sql<number>`count(*)` }).from(user).where(eq(user.role, "teacher")),
        db.select({ value: sql<number>`count(*)` }).from(classes).where(eq(classes.status, "active")),
        db.select({ value: sql<number>`count(*)` }).from(subjects),
        db.select({ departmentId: departments.id, departmentName: departments.name, students: sql<number>`count(distinct ${enrollments.studentId})` })
          .from(departments)
          .leftJoin(subjects, eq(subjects.departmentId, departments.id))
          .leftJoin(classes, eq(classes.subjectId, subjects.id))
          .leftJoin(enrollments, eq(enrollments.classId, classes.id))
          .groupBy(departments.id, departments.name),
        db.select({ month: sql<string>`to_char(date_trunc('month', ${enrollments.createdAt}), 'YYYY-MM')`, newEnrollments: sql<number>`count(*)` })
          .from(enrollments)
          .groupBy(sql`date_trunc('month', ${enrollments.createdAt})`)
          .orderBy(sql`date_trunc('month', ${enrollments.createdAt})`),
        db.select({ id: classes.id, name: classes.name, createdAt: classes.createdAt }).from(classes).orderBy(desc(classes.createdAt)).limit(5),
        db.select({ id: enrollments.id, createdAt: enrollments.createdAt, studentName: user.name, className: classes.name })
          .from(enrollments).innerJoin(user, eq(user.id, enrollments.studentId)).innerJoin(classes, eq(classes.id, enrollments.classId)).orderBy(desc(enrollments.createdAt)).limit(5),
        db.select({ id: subjects.id, name: subjects.name, updatedAt: subjects.updatedAt }).from(subjects).orderBy(desc(subjects.updatedAt)).limit(5),
        db.select({ id: assignments.id, title: assignments.title, createdAt: assignments.createdAt }).from(assignments).orderBy(desc(assignments.createdAt)).limit(5),
        db.select({ departmentId: departments.id, departmentName: departments.name, subjects: sql<number>`count(${subjects.id})` })
          .from(departments)
          .leftJoin(subjects, eq(subjects.departmentId, departments.id))
          .groupBy(departments.id, departments.name)
          .orderBy(asc(departments.name)),
        db.select({
          id: user.id,
          name: user.name,
          attendanceRate: sql<number>`round(100.0 * sum(case when ${attendanceRecords.status} in ('present', 'late', 'excused') then 1 else 0 end) / nullif(count(${attendanceRecords.id}), 0))`,
          attendanceRecords: sql<number>`count(${attendanceRecords.id})`,
        })
          .from(user)
          .innerJoin(attendanceRecords, eq(attendanceRecords.studentId, user.id))
          .where(eq(user.role, "student"))
          .groupBy(user.id, user.name)
          .having(sql`count(${attendanceRecords.id}) >= ${PRODUCTIVITY_REPORTING_CONFIG.atRiskStudents.minimumAttendanceRecords} and 100.0 * sum(case when ${attendanceRecords.status} in ('present', 'late', 'excused') then 1 else 0 end) / nullif(count(${attendanceRecords.id}), 0) < ${PRODUCTIVITY_REPORTING_CONFIG.atRiskStudents.attendanceThresholdPercent}`)
          .orderBy(asc(sql`100.0 * sum(case when ${attendanceRecords.status} in ('present', 'late', 'excused') then 1 else 0 end) / nullif(count(${attendanceRecords.id}), 0)`))
          .limit(PRODUCTIVITY_REPORTING_CONFIG.atRiskStudents.maximumAlerts),
      ]);

      const activity = [
        ...recentClasses.map((item) => ({ type: "class", title: "New class created", description: item.name, createdAt: item.createdAt })),
        ...recentEnrollments.map((item) => ({ type: "enrollment", title: "Student enrolled", description: `${item.studentName} joined ${item.className}`, createdAt: item.createdAt })),
        ...recentSubjects.map((item) => ({ type: "subject", title: "Subject updated", description: item.name, createdAt: item.updatedAt })),
        ...recentAssignments.map((item) => ({ type: "assignment", title: "Assignment created", description: item.title, createdAt: item.createdAt })),
      ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 8);

      return res.json({ data: {
        role: "admin",
        metrics: {
          totalStudents: Number(students[0]?.value ?? 0),
          faculty: Number(faculty[0]?.value ?? 0),
          activeClasses: Number(activeClasses[0]?.value ?? 0),
          subjects: Number(subjectCount[0]?.value ?? 0),
          comparisons: { totalStudents: null, faculty: null, activeClasses: null, subjects: null },
        },
        studentDistribution,
        enrollmentTrend,
        productivity: {
          subjectDistribution,
          atRiskStudents: atRiskStudents.map((student) => ({
            ...student,
            attendanceRate: Number(student.attendanceRate ?? 0),
            attendanceRecords: Number(student.attendanceRecords ?? 0),
          })),
        },
        recentActivity: activity,
        upcomingEvents: [],
      }});
    }

    if (viewer.role === "teacher") {
      const [myClasses, studentCount, pendingAssignments, recentAssignments, recentAnnouncements, assignmentCompletionByClass, attendanceByClass, assignedSubjects] = await Promise.all([
        db.select({ id: classes.id, name: classes.name, schedules: classes.schedules, subjectName: subjects.name })
          .from(classes).innerJoin(subjects, eq(subjects.id, classes.subjectId))
          .where(and(eq(classes.teacherId, viewer.id), eq(classes.status, "active"))).orderBy(asc(classes.name)),
        db.select({ value: sql<number>`count(distinct ${enrollments.studentId})` }).from(enrollments).innerJoin(classes, eq(classes.id, enrollments.classId)).where(and(eq(classes.teacherId, viewer.id), eq(classes.status, "active"))),
        db.select({ value: sql<number>`count(*)` }).from(assignments).where(and(eq(assignments.authorId, viewer.id), gte(assignments.dueAt, now))),
        db.select({ id: assignments.id, title: assignments.title, dueAt: assignments.dueAt, className: classes.name }).from(assignments).innerJoin(classes, eq(classes.id, assignments.classId)).where(eq(assignments.authorId, viewer.id)).orderBy(desc(assignments.createdAt)).limit(6),
        db.select({ id: announcements.id, title: announcements.title, createdAt: announcements.createdAt, className: classes.name }).from(announcements).innerJoin(classes, eq(classes.id, announcements.classId)).where(eq(announcements.authorId, viewer.id)).orderBy(desc(announcements.createdAt)).limit(5),
        db.select({
          classId: classes.id,
          className: classes.name,
          expectedSubmissions: sql<number>`count(distinct case when ${assignments.id} is not null and ${enrollments.studentId} is not null then ${assignments.id}::text || ':' || ${enrollments.studentId} end)`,
          completedSubmissions: sql<number>`count(distinct ${submissions.id})`,
          completionRate: sql<number>`coalesce(round(100.0 * count(distinct ${submissions.id}) / nullif(count(distinct case when ${assignments.id} is not null and ${enrollments.studentId} is not null then ${assignments.id}::text || ':' || ${enrollments.studentId} end), 0)), 0)`,
        })
          .from(classes)
          .leftJoin(assignments, eq(assignments.classId, classes.id))
          .leftJoin(enrollments, eq(enrollments.classId, classes.id))
          .leftJoin(submissions, and(eq(submissions.assignmentId, assignments.id), eq(submissions.studentId, enrollments.studentId)))
          .where(and(eq(classes.teacherId, viewer.id), eq(classes.status, "active")))
          .groupBy(classes.id, classes.name)
          .orderBy(asc(classes.name)),
        db.select({
          classId: classes.id,
          className: classes.name,
          recordedSessions: sql<number>`count(distinct ${attendanceSessions.id})`,
          attendanceRate: sql<number>`coalesce(round(100.0 * sum(case when ${attendanceRecords.status} in ('present', 'late', 'excused') then 1 else 0 end) / nullif(count(${attendanceRecords.id}), 0)), 0)`,
        })
          .from(classes)
          .leftJoin(attendanceSessions, eq(attendanceSessions.classId, classes.id))
          .leftJoin(attendanceRecords, eq(attendanceRecords.sessionId, attendanceSessions.id))
          .where(and(eq(classes.teacherId, viewer.id), eq(classes.status, "active")))
          .groupBy(classes.id, classes.name)
          .orderBy(asc(classes.name)),
        db.select({ value: sql<number>`count(distinct ${classes.subjectId})` })
          .from(classes)
          .where(and(eq(classes.teacherId, viewer.id), eq(classes.status, "active"))),
      ]);
      return res.json({ data: {
        role: "teacher",
        metrics: { myClasses: myClasses.length, myStudents: Number(studentCount[0]?.value ?? 0), assignedSubjects: Number(assignedSubjects[0]?.value ?? 0), todaysClasses: 0, pendingWork: Number(pendingAssignments[0]?.value ?? 0) },
        todaySchedule: myClasses,
        pendingAssignments: recentAssignments,
        recentAnnouncements,
        productivity: {
          assignmentCompletionByClass: assignmentCompletionByClass.map((summary) => ({
            ...summary,
            expectedSubmissions: Number(summary.expectedSubmissions ?? 0),
            completedSubmissions: Number(summary.completedSubmissions ?? 0),
            completionRate: Number(summary.completionRate ?? 0),
          })),
          attendanceByClass: attendanceByClass.map((summary) => ({
            ...summary,
            recordedSessions: Number(summary.recordedSessions ?? 0),
            attendanceRate: Number(summary.attendanceRate ?? 0),
          })),
        },
        studentDistribution: [],
        enrollmentTrend: [],
        recentActivity: [],
        upcomingEvents: [],
      }});
    }

    const [myClasses, attendance, upcomingAssignments, pendingWork, recentAnnouncements, progressByClass, upcomingDeadlineSummary] = await Promise.all([
      db.select({ id: classes.id, name: classes.name, schedules: classes.schedules, subjectName: subjects.name })
        .from(enrollments).innerJoin(classes, eq(classes.id, enrollments.classId)).innerJoin(subjects, eq(subjects.id, classes.subjectId))
        .where(and(eq(enrollments.studentId, viewer.id), eq(classes.status, "active"))).orderBy(asc(classes.name)),
      db.select({ present: sql<number>`sum(case when ${attendanceRecords.status} = 'present' then 1 else 0 end)`, total: sql<number>`count(*)` })
        .from(attendanceRecords).innerJoin(attendanceSessions, eq(attendanceSessions.id, attendanceRecords.sessionId)).where(eq(attendanceRecords.studentId, viewer.id)),
      db.select({
        id: assignments.id,
        title: assignments.title,
        dueAt: assignments.dueAt,
        className: classes.name,
        submission: { id: submissions.id, submittedAt: submissions.submittedAt, grade: submissions.grade, feedback: submissions.feedback },
      })
        .from(assignments)
        .innerJoin(classes, eq(classes.id, assignments.classId))
        .innerJoin(enrollments, eq(enrollments.classId, classes.id))
        .leftJoin(submissions, and(eq(submissions.assignmentId, assignments.id), eq(submissions.studentId, viewer.id)))
        .where(and(eq(enrollments.studentId, viewer.id), gte(assignments.dueAt, now)))
        .orderBy(asc(assignments.dueAt))
        .limit(6),
      db.select({ value: sql<number>`count(*)` })
        .from(assignments)
        .innerJoin(classes, eq(classes.id, assignments.classId))
        .innerJoin(enrollments, eq(enrollments.classId, classes.id))
        .leftJoin(submissions, and(eq(submissions.assignmentId, assignments.id), eq(submissions.studentId, viewer.id)))
        .where(and(eq(enrollments.studentId, viewer.id), gte(assignments.dueAt, now), isNull(submissions.id))),
      db.select({ id: announcements.id, title: announcements.title, createdAt: announcements.createdAt, className: classes.name })
        .from(announcements).innerJoin(classes, eq(classes.id, announcements.classId)).innerJoin(enrollments, eq(enrollments.classId, classes.id))
        .where(eq(enrollments.studentId, viewer.id)).orderBy(desc(announcements.createdAt)).limit(5),
      db.select({
        classId: classes.id,
        className: classes.name,
        releasedEntries: sql<number>`count(${gradebookEntries.id})`,
        progressPercent: sql<number>`coalesce(round(100.0 * sum(${gradebookEntries.points}) / nullif(sum(${gradebookEntries.maxPoints}), 0)), 0)`,
      })
        .from(gradebookEntries)
        .innerJoin(classes, eq(classes.id, gradebookEntries.classId))
        .where(and(eq(gradebookEntries.studentId, viewer.id), eq(gradebookEntries.isReleased, true)))
        .groupBy(classes.id, classes.name)
        .orderBy(asc(classes.name)),
      db.select({
        dueInWindow: sql<number>`count(*)`,
        nextDueAt: sql<Date | null>`min(${assignments.dueAt})`,
      })
        .from(assignments)
        .innerJoin(classes, eq(classes.id, assignments.classId))
        .innerJoin(enrollments, eq(enrollments.classId, classes.id))
        .leftJoin(submissions, and(eq(submissions.assignmentId, assignments.id), eq(submissions.studentId, viewer.id)))
        .where(and(eq(enrollments.studentId, viewer.id), isNull(submissions.id), gte(assignments.dueAt, now), lte(assignments.dueAt, deadlineWindowEnd))),
    ]);
    const attendanceTotal = Number(attendance[0]?.total ?? 0);
    const attendancePresent = Number(attendance[0]?.present ?? 0);
    const currentWeekday = CALENDAR_CONFIG.weekdayNames[now.getDay()];
    const todaySchedule = myClasses.flatMap((classRecord) => {
      const schedules = Array.isArray(classRecord.schedules)
        ? classRecord.schedules.filter((schedule) => schedule.day === currentWeekday)
        : [];
      return schedules.length ? [{ ...classRecord, schedules }] : [];
    });
    return res.json({ data: {
      role: "student",
      metrics: {
        myClasses: myClasses.length,
        attendance: attendanceTotal ? Math.round((attendancePresent / attendanceTotal) * 100) : null,
        assignments: Number(pendingWork[0]?.value ?? 0),
        upcoming: upcomingAssignments.length,
      },
      todaySchedule,
      upcomingAssignments,
      recentAnnouncements,
      productivity: {
        progressByClass: progressByClass.map((progress) => ({
          ...progress,
          releasedEntries: Number(progress.releasedEntries ?? 0),
          progressPercent: Number(progress.progressPercent ?? 0),
        })),
        upcomingDeadlineSummary: {
          dueInWindow: Number(upcomingDeadlineSummary[0]?.dueInWindow ?? 0),
          nextDueAt: upcomingDeadlineSummary[0]?.nextDueAt ?? null,
        },
      },
      studentDistribution: [],
      enrollmentTrend: [],
      recentActivity: [],
      upcomingEvents: [],
    }});
  } catch (error) {
    console.error("GET /stats/dashboard error:", error);
    return res.status(500).json({ error: "Failed to fetch dashboard data" });
  }
});

export default router;