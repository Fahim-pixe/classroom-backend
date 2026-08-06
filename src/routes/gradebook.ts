import express from "express";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { classes, enrollments, gradebookEntries, user } from "../db/schema/index.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = express.Router();
const idOf = (value: unknown) => { const n = Number(value); return Number.isInteger(n) && n > 0 ? n : null; };
const textOf = (value: unknown, max: number) => typeof value === "string" ? value.trim().slice(0, max) : "";
const canTeach = async (classId: number, userId: string, role: string) => {
  if (role === "admin") return true;
  const [row] = await db.select({ teacherId: classes.teacherId }).from(classes).where(eq(classes.id, classId)).limit(1);
  return row?.teacherId === userId;
};
const canAccess = async (classId: number, userId: string, role: string) => {
  if (await canTeach(classId, userId, role)) return true;
  const [row] = await db.select({ id: enrollments.id }).from(enrollments).where(and(eq(enrollments.classId, classId), eq(enrollments.studentId, userId))).limit(1);
  return Boolean(row);
};

router.get("/", requireAuth, async (req, res) => {
  try {
    const classId = idOf(req.query.classId);
    if (!classId || !req.user || !(await canAccess(classId, req.user.id, req.user.role))) return res.status(403).json({ error: "You do not have access to this gradebook" });
    const data = await db.select({ id: gradebookEntries.id, classId: gradebookEntries.classId, teacherId: gradebookEntries.teacherId, studentId: gradebookEntries.studentId, title: gradebookEntries.title, points: gradebookEntries.points, maxPoints: gradebookEntries.maxPoints, feedback: gradebookEntries.feedback, createdAt: gradebookEntries.createdAt, updatedAt: gradebookEntries.updatedAt, student: { id: user.id, name: user.name, email: user.email } }).from(gradebookEntries).innerJoin(user, eq(gradebookEntries.studentId, user.id)).where(and(eq(gradebookEntries.classId, classId), req.user.role === "student" ? eq(gradebookEntries.studentId, req.user.id) : undefined)).orderBy(desc(gradebookEntries.updatedAt));
    return res.json({ data });
  } catch (error) { console.error("GET /gradebook error:", error); return res.status(500).json({ error: "Failed to fetch gradebook" }); }
});

router.post("/", requireAuth, requireRole(["teacher", "admin"]), async (req, res) => {
  try {
    const classId = idOf(req.body?.classId); const studentId = textOf(req.body?.studentId, 200); const title = textOf(req.body?.title, 200); const points = Number(req.body?.points); const maxPoints = Number(req.body?.maxPoints); const feedback = typeof req.body?.feedback === "string" ? req.body.feedback.trim().slice(0, 5000) : null;
    if (!classId || !studentId || !title || !Number.isInteger(points) || !Number.isInteger(maxPoints) || points < 0 || maxPoints <= 0 || points > maxPoints) return res.status(400).json({ error: "classId, studentId, title, and valid points are required" });
    if (!req.user || !(await canTeach(classId, req.user.id, req.user.role))) return res.status(403).json({ error: "You can only grade assigned classes" });
    const [enrollment] = await db.select({ id: enrollments.id }).from(enrollments).where(and(eq(enrollments.classId, classId), eq(enrollments.studentId, studentId))).limit(1);
    if (!enrollment) return res.status(400).json({ error: "Student is not enrolled in this class" });
    const [created] = await db.insert(gradebookEntries).values({ classId, teacherId: req.user.id, studentId, title, points, maxPoints, feedback }).returning();
    return res.status(201).json({ data: created });
  } catch (error) { console.error("POST /gradebook error:", error); return res.status(500).json({ error: "Failed to create grade" }); }
});

router.patch("/:id", requireAuth, requireRole(["teacher", "admin"]), async (req, res) => {
  try {
    const id = idOf(req.params.id); const points = Number(req.body?.points); const maxPoints = Number(req.body?.maxPoints); const feedback = typeof req.body?.feedback === "string" ? req.body.feedback.trim().slice(0, 5000) : null;
    if (!id || !Number.isInteger(points) || !Number.isInteger(maxPoints) || points < 0 || maxPoints <= 0 || points > maxPoints) return res.status(400).json({ error: "Valid points and maxPoints are required" });
    const [existing] = await db.select({ classId: gradebookEntries.classId }).from(gradebookEntries).where(eq(gradebookEntries.id, id)).limit(1);
    if (!existing || !req.user || !(await canTeach(existing.classId, req.user.id, req.user.role))) return res.status(403).json({ error: "You cannot edit this grade" });
    const [updated] = await db.update(gradebookEntries).set({ points, maxPoints, feedback, updatedAt: new Date() }).where(eq(gradebookEntries.id, id)).returning();
    return res.json({ data: updated });
  } catch (error) { console.error("PATCH /gradebook error:", error); return res.status(500).json({ error: "Failed to update grade" }); }
});

export default router;
