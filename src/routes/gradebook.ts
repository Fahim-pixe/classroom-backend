import express, { type Request, type Response } from "express";
import { and, asc, desc, eq, sql } from "drizzle-orm";

import { GRADEBOOK_ROUTE_PATHS } from "../config/app.js";
import { db } from "../db/index.js";
import { classes, enrollments, gradebookEntries, subjects, user } from "../db/schema/index.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = express.Router();

const idOf = (value: unknown) => {
  const numericValue = Number(value);
  return Number.isInteger(numericValue) && numericValue > 0 ? numericValue : null;
};

const textOf = (value: unknown, maxLength: number) =>
  typeof value === "string" ? value.trim().slice(0, maxLength) : "";

const canTeach = async (classId: number, userId: string, role: string) => {
  if (role === "admin") return true;
  const [classRecord] = await db
    .select({ teacherId: classes.teacherId })
    .from(classes)
    .where(eq(classes.id, classId))
    .limit(1);
  return classRecord?.teacherId === userId;
};

const canAccess = async (classId: number, userId: string, role: string) => {
  if (await canTeach(classId, userId, role)) return true;
  const [enrollment] = await db
    .select({ id: enrollments.id })
    .from(enrollments)
    .where(and(eq(enrollments.classId, classId), eq(enrollments.studentId, userId)))
    .limit(1);
  return Boolean(enrollment);
};

router.get(GRADEBOOK_ROUTE_PATHS.accessibleClasses, requireAuth, async (req: Request, res: Response) => {
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
      ? await db
          .select(classFields)
          .from(classes)
          .innerJoin(subjects, eq(subjects.id, classes.subjectId))
          .orderBy(asc(classes.name))
      : viewer.role === "teacher"
        ? await db
            .select(classFields)
            .from(classes)
            .innerJoin(subjects, eq(subjects.id, classes.subjectId))
            .where(eq(classes.teacherId, viewer.id))
            .orderBy(asc(classes.name))
        : await db
            .select(classFields)
            .from(enrollments)
            .innerJoin(classes, eq(classes.id, enrollments.classId))
            .innerJoin(subjects, eq(subjects.id, classes.subjectId))
            .where(and(eq(enrollments.studentId, viewer.id), eq(classes.status, "active")))
            .orderBy(asc(classes.name));

    return res.status(200).json({ data });
  } catch (error) {
    console.error("GET /gradebook/classes error:", error);
    return res.status(500).json({ error: "Failed to fetch available academic records" });
  }
});

router.get(GRADEBOOK_ROUTE_PATHS.summary, requireAuth, async (req: Request, res: Response) => {
  try {
    const classId = idOf(req.query.classId);
    const viewer = req.user;

    if (!classId) return res.status(400).json({ error: "A valid classId is required" });
    if (!viewer || !(await canAccess(classId, viewer.id, viewer.role))) {
      return res.status(403).json({ error: "You do not have access to this academic record" });
    }

    const [classRecord] = await db
      .select({
        id: classes.id,
        name: classes.name,
        subjectCode: subjects.code,
        subjectName: subjects.name,
      })
      .from(classes)
      .innerJoin(subjects, eq(subjects.id, classes.subjectId))
      .where(eq(classes.id, classId))
      .limit(1);

    if (!classRecord) return res.status(404).json({ error: "Class not found" });

    const entryScope = and(
      eq(gradebookEntries.classId, classId),
      viewer.role === "student" ? eq(gradebookEntries.studentId, viewer.id) : undefined
    );

    const [summary] = await db
      .select({
        evaluationCount: sql<number>`count(${gradebookEntries.id})`,
        gradedStudents: sql<number>`count(distinct ${gradebookEntries.studentId})`,
        earnedPoints: sql<number>`coalesce(sum(${gradebookEntries.points}), 0)`,
        possiblePoints: sql<number>`coalesce(sum(${gradebookEntries.maxPoints}), 0)`,
      })
      .from(gradebookEntries)
      .where(entryScope);

    const earnedPoints = Number(summary?.earnedPoints ?? 0);
    const possiblePoints = Number(summary?.possiblePoints ?? 0);

    return res.status(200).json({
      data: {
        class: classRecord,
        metrics: {
          evaluationCount: Number(summary?.evaluationCount ?? 0),
          gradedStudents: Number(summary?.gradedStudents ?? 0),
          earnedPoints,
          possiblePoints,
          percentage: possiblePoints > 0 ? Math.round((earnedPoints / possiblePoints) * 100) : null,
        },
      },
    });
  } catch (error) {
    console.error("GET /gradebook/summary error:", error);
    return res.status(500).json({ error: "Failed to summarize academic records" });
  }
});

router.get(GRADEBOOK_ROUTE_PATHS.root, requireAuth, async (req: Request, res: Response) => {
  try {
    const classId = idOf(req.query.classId);
    const viewer = req.user;

    if (!classId || !viewer || !(await canAccess(classId, viewer.id, viewer.role))) {
      return res.status(403).json({ error: "You do not have access to this gradebook" });
    }

    const data = await db
      .select({
        id: gradebookEntries.id,
        classId: gradebookEntries.classId,
        teacherId: gradebookEntries.teacherId,
        studentId: gradebookEntries.studentId,
        title: gradebookEntries.title,
        points: gradebookEntries.points,
        maxPoints: gradebookEntries.maxPoints,
        feedback: gradebookEntries.feedback,
        createdAt: gradebookEntries.createdAt,
        updatedAt: gradebookEntries.updatedAt,
        student: { id: user.id, name: user.name, email: user.email },
      })
      .from(gradebookEntries)
      .innerJoin(user, eq(gradebookEntries.studentId, user.id))
      .where(
        and(
          eq(gradebookEntries.classId, classId),
          viewer.role === "student" ? eq(gradebookEntries.studentId, viewer.id) : undefined
        )
      )
      .orderBy(desc(gradebookEntries.updatedAt));

    return res.status(200).json({ data });
  } catch (error) {
    console.error("GET /gradebook error:", error);
    return res.status(500).json({ error: "Failed to fetch gradebook" });
  }
});

router.post(GRADEBOOK_ROUTE_PATHS.root, requireAuth, requireRole(["teacher", "admin"]), async (req: Request, res: Response) => {
  try {
    const classId = idOf(req.body?.classId);
    const studentId = textOf(req.body?.studentId, 200);
    const title = textOf(req.body?.title, 200);
    const points = Number(req.body?.points);
    const maxPoints = Number(req.body?.maxPoints);
    const feedback = typeof req.body?.feedback === "string"
      ? req.body.feedback.trim().slice(0, 5000)
      : null;

    if (!classId || !studentId || !title || !Number.isInteger(points) || !Number.isInteger(maxPoints) || points < 0 || maxPoints <= 0 || points > maxPoints) {
      return res.status(400).json({ error: "classId, studentId, title, and valid points are required" });
    }

    if (!req.user || !(await canTeach(classId, req.user.id, req.user.role))) {
      return res.status(403).json({ error: "You can only grade assigned classes" });
    }

    const [enrollment] = await db
      .select({ id: enrollments.id })
      .from(enrollments)
      .where(and(eq(enrollments.classId, classId), eq(enrollments.studentId, studentId)))
      .limit(1);

    if (!enrollment) return res.status(400).json({ error: "Student is not enrolled in this class" });

    const [created] = await db
      .insert(gradebookEntries)
      .values({ classId, teacherId: req.user.id, studentId, title, points, maxPoints, feedback })
      .returning();

    return res.status(201).json({ data: created });
  } catch (error) {
    console.error("POST /gradebook error:", error);
    return res.status(500).json({ error: "Failed to create grade" });
  }
});

router.patch(GRADEBOOK_ROUTE_PATHS.entryById, requireAuth, requireRole(["teacher", "admin"]), async (req: Request, res: Response) => {
  try {
    const entryId = idOf(req.params.id);
    const points = Number(req.body?.points);
    const maxPoints = Number(req.body?.maxPoints);
    const feedback = typeof req.body?.feedback === "string"
      ? req.body.feedback.trim().slice(0, 5000)
      : null;

    if (!entryId || !Number.isInteger(points) || !Number.isInteger(maxPoints) || points < 0 || maxPoints <= 0 || points > maxPoints) {
      return res.status(400).json({ error: "Valid points and maxPoints are required" });
    }

    const [existing] = await db
      .select({ classId: gradebookEntries.classId })
      .from(gradebookEntries)
      .where(eq(gradebookEntries.id, entryId))
      .limit(1);

    if (!existing || !req.user || !(await canTeach(existing.classId, req.user.id, req.user.role))) {
      return res.status(403).json({ error: "You cannot edit this grade" });
    }

    const [updated] = await db
      .update(gradebookEntries)
      .set({ points, maxPoints, feedback, updatedAt: new Date() })
      .where(eq(gradebookEntries.id, entryId))
      .returning();

    return res.status(200).json({ data: updated });
  } catch (error) {
    console.error("PATCH /gradebook error:", error);
    return res.status(500).json({ error: "Failed to update grade" });
  }
});

export default router;
