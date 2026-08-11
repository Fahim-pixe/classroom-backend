import express, { type Request, type Response } from "express";
import { and, asc, desc, eq, inArray } from "drizzle-orm";

import { ATTENDANCE_CONFIG, ATTENDANCE_ROUTE_PATHS } from "../config/app.js";
import { db } from "../db/index.js";
import { attendanceRecords, attendanceSessions, classes, enrollments, subjects, user } from "../db/schema/index.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = express.Router();

type AttendanceStatus = "present" | "absent" | "late" | "excused";

const idOf = (value: unknown) => {
  const numericValue = Number(value);
  return Number.isInteger(numericValue) && numericValue > 0 ? numericValue : null;
};

const canTeach = async (classId: number, userId: string, role: string) => {
  if (role === "admin") return true;
  const [classRecord] = await db
    .select({ teacherId: classes.teacherId })
    .from(classes)
    .where(eq(classes.id, classId))
    .limit(1);
  return classRecord?.teacherId === userId;
};

const canAttend = async (classId: number, userId: string, role: string) => {
  if (await canTeach(classId, userId, role)) return true;
  const [enrollment] = await db
    .select({ id: enrollments.id })
    .from(enrollments)
    .where(and(eq(enrollments.classId, classId), eq(enrollments.studentId, userId)))
    .limit(1);
  return Boolean(enrollment);
};

const percentageOf = (qualifying: number, total: number) =>
  total > 0 ? Math.round((qualifying / total) * 100) : null;

const isQualifyingStatus = (status: string) =>
  ATTENDANCE_CONFIG.qualifyingStatuses.some((qualifyingStatus) => qualifyingStatus === status);

router.get(ATTENDANCE_ROUTE_PATHS.accessibleClasses, requireAuth, async (req: Request, res: Response) => {
  try {
    const viewer = req.user;
    if (!viewer) return res.status(401).json({ error: "Unauthorized" });

    const classFields = {
      id: classes.id,
      name: classes.name,
      subjectCode: subjects.code,
      subjectName: subjects.name,
    };

    const data = viewer.role === "admin"
      ? await db.select(classFields).from(classes).innerJoin(subjects, eq(subjects.id, classes.subjectId)).orderBy(asc(classes.name))
      : viewer.role === "teacher"
        ? await db.select(classFields).from(classes).innerJoin(subjects, eq(subjects.id, classes.subjectId)).where(eq(classes.teacherId, viewer.id)).orderBy(asc(classes.name))
        : await db.select(classFields).from(enrollments).innerJoin(classes, eq(classes.id, enrollments.classId)).innerJoin(subjects, eq(subjects.id, classes.subjectId)).where(and(eq(enrollments.studentId, viewer.id), eq(classes.status, "active"))).orderBy(asc(classes.name));

    return res.status(200).json({ data });
  } catch (error) {
    console.error("GET /attendance/classes error:", error);
    return res.status(500).json({ error: "Failed to fetch available attendance classes" });
  }
});

router.get(ATTENDANCE_ROUTE_PATHS.summary, requireAuth, async (req: Request, res: Response) => {
  try {
    const classId = idOf(req.query.classId);
    const viewer = req.user;
    if (!classId) return res.status(400).json({ error: "A valid classId is required" });
    if (!viewer || !(await canAttend(classId, viewer.id, viewer.role))) {
      return res.status(403).json({ error: "You do not have access to this class" });
    }

    const [classRecord] = await db
      .select({ id: classes.id, name: classes.name, subjectCode: subjects.code, subjectName: subjects.name })
      .from(classes)
      .innerJoin(subjects, eq(subjects.id, classes.subjectId))
      .where(eq(classes.id, classId))
      .limit(1);
    if (!classRecord) return res.status(404).json({ error: "Class not found" });

    const classSessions = await db
      .select({ id: attendanceSessions.id })
      .from(attendanceSessions)
      .where(eq(attendanceSessions.classId, classId));
    const sessionIds = classSessions.map((session) => session.id);

    const records = sessionIds.length
      ? await db
          .select({ studentId: attendanceRecords.studentId, status: attendanceRecords.status })
          .from(attendanceRecords)
          .where(
            and(
              inArray(attendanceRecords.sessionId, sessionIds),
              viewer.role === "student" ? eq(attendanceRecords.studentId, viewer.id) : undefined
            )
          )
      : [];

    const qualifyingCount = records.filter((record) =>
      isQualifyingStatus(record.status)
    ).length;
    const attendancePercent = percentageOf(qualifyingCount, records.length);

    const studentProgress = viewer.role === "student"
      ? []
      : await (async () => {
          const roster = await db
            .select({ id: user.id, name: user.name })
            .from(enrollments)
            .innerJoin(user, eq(user.id, enrollments.studentId))
            .where(eq(enrollments.classId, classId))
            .orderBy(asc(user.name));
          const allRecords = sessionIds.length
            ? await db
                .select({ studentId: attendanceRecords.studentId, status: attendanceRecords.status })
                .from(attendanceRecords)
                .where(inArray(attendanceRecords.sessionId, sessionIds))
            : [];

          return roster.map((student) => {
            const studentRecords = allRecords.filter((record) => record.studentId === student.id);
            const studentQualifying = studentRecords.filter((record) =>
              isQualifyingStatus(record.status)
            ).length;
            const studentPercent = percentageOf(studentQualifying, studentRecords.length);
            return {
              id: student.id,
              name: student.name,
              qualifyingCount: studentQualifying,
              recordCount: studentRecords.length,
              attendancePercent: studentPercent,
              atRisk: studentPercent !== null && studentPercent < ATTENDANCE_CONFIG.riskThresholdPercent,
            };
          });
        })();

    const atRiskStudentCount = studentProgress.filter((student) => student.atRisk).length;

    return res.status(200).json({
      data: {
        class: classRecord,
        metrics: {
          sessionCount: classSessions.length,
          recordCount: records.length,
          qualifyingCount,
          attendancePercent,
          riskThresholdPercent: ATTENDANCE_CONFIG.riskThresholdPercent,
          atRisk: attendancePercent !== null && attendancePercent < ATTENDANCE_CONFIG.riskThresholdPercent,
          atRiskStudentCount,
        },
        studentProgress,
      },
    });
  } catch (error) {
    console.error("GET /attendance/summary error:", error);
    return res.status(500).json({ error: "Failed to summarize attendance" });
  }
});

router.get(ATTENDANCE_ROUTE_PATHS.root, requireAuth, async (req: Request, res: Response) => {
  try {
    const classId = idOf(req.query.classId);
    const viewer = req.user;
    if (!classId || !viewer || !(await canAttend(classId, viewer.id, viewer.role))) {
      return res.status(403).json({ error: "You do not have access to this class" });
    }

    const sessions = await db
      .select({
        id: attendanceSessions.id,
        classId: attendanceSessions.classId,
        sessionDate: attendanceSessions.sessionDate,
        notes: attendanceSessions.notes,
        teacherId: attendanceSessions.teacherId,
        createdAt: attendanceSessions.createdAt,
      })
      .from(attendanceSessions)
      .where(eq(attendanceSessions.classId, classId))
      .orderBy(desc(attendanceSessions.sessionDate));

    const sessionIds = sessions.map((session) => session.id);
    const records = sessionIds.length
      ? await db
          .select({
            id: attendanceRecords.id,
            sessionId: attendanceRecords.sessionId,
            studentId: attendanceRecords.studentId,
            status: attendanceRecords.status,
            note: attendanceRecords.note,
            student: { id: user.id, name: user.name, email: user.email },
          })
          .from(attendanceRecords)
          .innerJoin(user, eq(attendanceRecords.studentId, user.id))
          .where(
            and(
              inArray(attendanceRecords.sessionId, sessionIds),
              viewer.role === "student" ? eq(attendanceRecords.studentId, viewer.id) : undefined
            )
          )
      : [];

    const data = sessions.map((session) => {
      const sessionRecords = records.filter((record) => record.sessionId === session.id);
      const present = sessionRecords.filter((record) => record.status === "present").length;
      const absent = sessionRecords.filter((record) => record.status === "absent").length;
      const late = sessionRecords.filter((record) => record.status === "late").length;
      const excused = sessionRecords.filter((record) => record.status === "excused").length;
      return {
        ...session,
        records: sessionRecords,
        summary: { total: sessionRecords.length, present, absent, late, excused },
      };
    });

    return res.status(200).json({ data });
  } catch (error) {
    console.error("GET /attendance error:", error);
    return res.status(500).json({ error: "Failed to fetch attendance" });
  }
});

router.post(ATTENDANCE_ROUTE_PATHS.sessions, requireAuth, requireRole(["teacher", "admin"]), async (req: Request, res: Response) => {
  try {
    const classId = idOf(req.body?.classId);
    const sessionDate = new Date(req.body?.sessionDate);
    const notes = typeof req.body?.notes === "string" ? req.body.notes.trim().slice(0, 2000) : null;
    const records: unknown[] = Array.isArray(req.body?.records) ? req.body.records : [];

    if (!classId || Number.isNaN(sessionDate.getTime()) || !records.length) {
      return res.status(400).json({ error: "classId, sessionDate, and records are required" });
    }
    if (!req.user || !(await canTeach(classId, req.user.id, req.user.role))) {
      return res.status(403).json({ error: "You can only manage attendance for assigned classes" });
    }

    const validStatuses = new Set<AttendanceStatus>(["present", "absent", "late", "excused"]);
    const cleanRecords = records
      .filter((record: unknown): record is { studentId: string; status: AttendanceStatus; note?: unknown } => {
        if (!record || typeof record !== "object") return false;
        const candidate = record as { studentId?: unknown; status?: unknown };
        return typeof candidate.studentId === "string" && validStatuses.has(candidate.status as AttendanceStatus);
      })
      .map((record) => ({
        studentId: record.studentId,
        status: record.status,
        note: typeof record.note === "string" ? record.note.trim().slice(0, 500) : null,
      }));

    if (!cleanRecords.length) return res.status(400).json({ error: "At least one valid attendance record is required" });

    const [session] = await db
      .insert(attendanceSessions)
      .values({ classId, teacherId: req.user.id, sessionDate, notes })
      .onConflictDoUpdate({
        target: [attendanceSessions.classId, attendanceSessions.sessionDate],
        set: { notes, updatedAt: new Date() },
      })
      .returning();

    if (!session) return res.status(500).json({ error: "Failed to create attendance session" });

    for (const record of cleanRecords) {
      await db
        .insert(attendanceRecords)
        .values({ sessionId: session.id, ...record })
        .onConflictDoUpdate({
          target: [attendanceRecords.sessionId, attendanceRecords.studentId],
          set: { status: record.status, note: record.note, updatedAt: new Date() },
        });
    }

    return res.status(201).json({ data: session });
  } catch (error) {
    console.error("POST /attendance/sessions error:", error);
    return res.status(500).json({ error: "Failed to save attendance" });
  }
});

export default router;
