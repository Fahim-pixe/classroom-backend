import express from "express";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { attendanceRecords, attendanceSessions, classes, enrollments, user } from "../db/schema/index.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = express.Router();
const idOf = (value: unknown) => { const n = Number(value); return Number.isInteger(n) && n > 0 ? n : null; };
const canTeach = async (classId: number, userId: string, role: string) => {
  if (role === "admin") return true;
  const [row] = await db.select({ teacherId: classes.teacherId }).from(classes).where(eq(classes.id, classId)).limit(1);
  return row?.teacherId === userId;
};
const canAttend = async (classId: number, userId: string, role: string) => {
  if (await canTeach(classId, userId, role)) return true;
  const [row] = await db.select({ id: enrollments.id }).from(enrollments).where(and(eq(enrollments.classId, classId), eq(enrollments.studentId, userId))).limit(1);
  return Boolean(row);
};

router.get("/", requireAuth, async (req, res) => {
  try {
    const classId = idOf(req.query.classId);
    if (!classId || !req.user || !(await canAttend(classId, req.user.id, req.user.role))) return res.status(403).json({ error: "You do not have access to this class" });
    const sessions = await db.select({ id: attendanceSessions.id, classId: attendanceSessions.classId, sessionDate: attendanceSessions.sessionDate, notes: attendanceSessions.notes, teacherId: attendanceSessions.teacherId, createdAt: attendanceSessions.createdAt }).from(attendanceSessions).where(eq(attendanceSessions.classId, classId)).orderBy(desc(attendanceSessions.sessionDate));
    const sessionIds = sessions.map((s) => s.id);
    const records = sessionIds.length ? await db.select({ id: attendanceRecords.id, sessionId: attendanceRecords.sessionId, studentId: attendanceRecords.studentId, status: attendanceRecords.status, note: attendanceRecords.note, student: { id: user.id, name: user.name, email: user.email } }).from(attendanceRecords).innerJoin(user, eq(attendanceRecords.studentId, user.id)).where(inArray(attendanceRecords.sessionId, sessionIds)) : [];
    return res.json({ data: sessions.map((session) => ({ ...session, records: records.filter((record) => record.sessionId === session.id) })) });
  } catch (error) { console.error("GET /attendance error:", error); return res.status(500).json({ error: "Failed to fetch attendance" }); }
});

router.post("/sessions", requireAuth, requireRole(["teacher", "admin"]), async (req, res) => {
  try {
    const classId = idOf(req.body?.classId); const sessionDate = new Date(req.body?.sessionDate); const notes = typeof req.body?.notes === "string" ? req.body.notes.trim().slice(0, 2000) : null; const records = Array.isArray(req.body?.records) ? req.body.records : [];
    if (!classId || Number.isNaN(sessionDate.getTime()) || !records.length) return res.status(400).json({ error: "classId, sessionDate, and records are required" });
    if (!req.user || !(await canTeach(classId, req.user.id, req.user.role))) return res.status(403).json({ error: "You can only manage attendance for assigned classes" });
    const validStatuses = new Set(["present", "absent", "late", "excused"]);
    const cleanRecords = records.filter((r: any) => typeof r?.studentId === "string" && validStatuses.has(r.status)).map((r: any) => ({ studentId: r.studentId, status: r.status, note: typeof r.note === "string" ? r.note.trim().slice(0, 500) : null }));
    if (!cleanRecords.length) return res.status(400).json({ error: "At least one valid attendance record is required" });
    const [session] = await db.insert(attendanceSessions).values({ classId, teacherId: req.user.id, sessionDate, notes }).onConflictDoUpdate({ target: [attendanceSessions.classId, attendanceSessions.sessionDate], set: { notes, updatedAt: new Date() } }).returning();
    if (!session) return res.status(500).json({ error: "Failed to create attendance session" });
    for (const record of cleanRecords) await db.insert(attendanceRecords).values({ sessionId: session.id, ...record }).onConflictDoUpdate({ target: [attendanceRecords.sessionId, attendanceRecords.studentId], set: { status: record.status, note: record.note, updatedAt: new Date() } });
    return res.status(201).json({ data: session });
  } catch (error) { console.error("POST /attendance/sessions error:", error); return res.status(500).json({ error: "Failed to save attendance" }); }
});

export default router;
