import express, { type Request, type Response } from "express";
import { and, asc, desc, eq, sql } from "drizzle-orm";

import { GRADEBOOK_ROUTE_PATHS, GRADEBOOK_WORKFLOW_CONFIG } from "../config/app.js";
import { db } from "../db/index.js";
import {
  classes,
  enrollments,
  gradebookCategories,
  gradebookEntries,
  gradebookEntryAudits,
  subjects,
  user,
} from "../db/schema/index.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = express.Router();

type GradebookAuditAction = "created" | "updated" | "release_updated";

type EntrySnapshot = {
  categoryId: number | null;
  points: number;
  maxPoints: number;
  isReleased: boolean;
};

const idOf = (value: unknown) => {
  const numericValue = Number(value);
  return Number.isInteger(numericValue) && numericValue > 0 ? numericValue : null;
};

const optionalIdOf = (value: unknown) => (value === null || value === undefined || value === "" ? null : idOf(value));

const textOf = (value: unknown, maxLength: number) =>
  typeof value === "string" ? value.trim().slice(0, maxLength) : "";

const booleanOf = (value: unknown, fallback: boolean) => (typeof value === "boolean" ? value : fallback);

const csvCell = (value: unknown) => {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replaceAll("\"", "\"\"")}"`;
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

const canAccess = async (classId: number, userId: string, role: string) => {
  if (await canTeach(classId, userId, role)) return true;
  const [enrollment] = await db
    .select({ id: enrollments.id })
    .from(enrollments)
    .where(and(eq(enrollments.classId, classId), eq(enrollments.studentId, userId)))
    .limit(1);
  return Boolean(enrollment);
};

const categoryBelongsToClass = async (categoryId: number, classId: number) => {
  const [category] = await db
    .select({ id: gradebookCategories.id })
    .from(gradebookCategories)
    .where(and(eq(gradebookCategories.id, categoryId), eq(gradebookCategories.classId, classId)))
    .limit(1);
  return Boolean(category);
};

const writeAudit = async (
  gradebookEntryId: number,
  actorId: string,
  action: GradebookAuditAction,
  snapshot: EntrySnapshot,
) => {
  await db.insert(gradebookEntryAudits).values({
    gradebookEntryId,
    actorId,
    action,
    details: { snapshot },
  });
};

const weightedPercentage = (
  entries: Array<{ points: number; maxPoints: number; categoryId: number | null }>,
  categories: Array<{ id: number; weight: number }>,
) => {
  const categoryWeights = new Map(categories.map((category) => [category.id, category.weight]));
  const groups = new Map<string, { earned: number; possible: number; weight: number }>();

  for (const entry of entries) {
    const key = entry.categoryId === null ? "uncategorized" : String(entry.categoryId);
    const current = groups.get(key) ?? {
      earned: 0,
      possible: 0,
      weight: entry.categoryId === null ? GRADEBOOK_WORKFLOW_CONFIG.category.maximumWeight : categoryWeights.get(entry.categoryId) ?? GRADEBOOK_WORKFLOW_CONFIG.category.maximumWeight,
    };
    current.earned += entry.points;
    current.possible += entry.maxPoints;
    groups.set(key, current);
  }

  const weightedGroups = [...groups.values()].filter((group) => group.possible > 0);
  const totalWeight = weightedGroups.reduce((sum, group) => sum + group.weight, 0);
  if (totalWeight === 0) return null;

  return Math.round(
    weightedGroups.reduce((sum, group) => sum + (group.earned / group.possible) * group.weight, 0) / totalWeight * 100,
  );
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
      viewer.role === "student" ? eq(gradebookEntries.studentId, viewer.id) : undefined,
      viewer.role === "student" ? eq(gradebookEntries.isReleased, true) : undefined,
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

    const entries = await db
      .select({
        points: gradebookEntries.points,
        maxPoints: gradebookEntries.maxPoints,
        categoryId: gradebookEntries.categoryId,
      })
      .from(gradebookEntries)
      .where(entryScope);
    const categories = await db
      .select({ id: gradebookCategories.id, weight: gradebookCategories.weight })
      .from(gradebookCategories)
      .where(and(eq(gradebookCategories.classId, classId), eq(gradebookCategories.isActive, true)));

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
          weightedPercentage: weightedPercentage(entries, categories),
        },
      },
    });
  } catch (error) {
    console.error("GET /gradebook/summary error:", error);
    return res.status(500).json({ error: "Failed to summarize academic records" });
  }
});

router.get(GRADEBOOK_ROUTE_PATHS.categories, requireAuth, async (req: Request, res: Response) => {
  try {
    const classId = idOf(req.query.classId);
    const viewer = req.user;
    if (!classId || !viewer || !(await canAccess(classId, viewer.id, viewer.role))) {
      return res.status(403).json({ error: "You do not have access to these grade categories" });
    }

    const data = await db
      .select()
      .from(gradebookCategories)
      .where(and(eq(gradebookCategories.classId, classId), viewer.role === "student" ? eq(gradebookCategories.isActive, true) : undefined))
      .orderBy(asc(gradebookCategories.title));

    return res.status(200).json({ data });
  } catch (error) {
    console.error("GET /gradebook/categories error:", error);
    return res.status(500).json({ error: "Failed to fetch grade categories" });
  }
});

router.post(GRADEBOOK_ROUTE_PATHS.categories, requireAuth, requireRole(["teacher", "admin"]), async (req: Request, res: Response) => {
  try {
    const classId = idOf(req.body?.classId);
    const title = textOf(req.body?.title, GRADEBOOK_WORKFLOW_CONFIG.category.maximumTitleLength);
    const weight = Number(req.body?.weight);

    if (!classId || !title || !Number.isInteger(weight) || weight < GRADEBOOK_WORKFLOW_CONFIG.category.minimumWeight || weight > GRADEBOOK_WORKFLOW_CONFIG.category.maximumWeight) {
      return res.status(400).json({ error: "A class, category title, and valid weight are required" });
    }

    if (!req.user || !(await canTeach(classId, req.user.id, req.user.role))) {
      return res.status(403).json({ error: "You can only manage grade categories for assigned classes" });
    }

    const [created] = await db
      .insert(gradebookCategories)
      .values({ classId, title, weight })
      .returning();

    return res.status(201).json({ data: created });
  } catch (error) {
    console.error("POST /gradebook/categories error:", error);
    return res.status(500).json({ error: "Failed to create grade category" });
  }
});

router.get(GRADEBOOK_ROUTE_PATHS.export, requireAuth, requireRole(["teacher", "admin"]), async (req: Request, res: Response) => {
  try {
    const classId = idOf(req.query.classId);
    if (!classId || !req.user || !(await canTeach(classId, req.user.id, req.user.role))) {
      return res.status(403).json({ error: "You can only export gradebooks for assigned classes" });
    }

    const entries = await db
      .select({
        studentName: user.name,
        studentEmail: user.email,
        title: gradebookEntries.title,
        category: gradebookCategories.title,
        weight: gradebookCategories.weight,
        points: gradebookEntries.points,
        maxPoints: gradebookEntries.maxPoints,
        isReleased: gradebookEntries.isReleased,
        feedback: gradebookEntries.feedback,
        updatedAt: gradebookEntries.updatedAt,
      })
      .from(gradebookEntries)
      .innerJoin(user, eq(gradebookEntries.studentId, user.id))
      .leftJoin(gradebookCategories, eq(gradebookEntries.categoryId, gradebookCategories.id))
      .where(eq(gradebookEntries.classId, classId))
      .orderBy(asc(user.name), asc(gradebookEntries.title));

    const csvRows = [
      ["Student", "Email", "Assessment", "Category", "Category weight", "Points", "Maximum points", "Released", "Feedback", "Last updated"],
      ...entries.map((entry) => [
        entry.studentName,
        entry.studentEmail,
        entry.title,
        entry.category,
        entry.weight,
        entry.points,
        entry.maxPoints,
        entry.isReleased ? "Yes" : "No",
        entry.feedback,
        entry.updatedAt.toISOString(),
      ]),
    ];

    res.setHeader("Content-Type", GRADEBOOK_WORKFLOW_CONFIG.export.contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${GRADEBOOK_WORKFLOW_CONFIG.export.attachmentFileName}"`);
    return res.status(200).send(csvRows.map((row) => row.map(csvCell).join(",")).join("\n"));
  } catch (error) {
    console.error("GET /gradebook/export error:", error);
    return res.status(500).json({ error: "Failed to export gradebook" });
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
        categoryId: gradebookEntries.categoryId,
        title: gradebookEntries.title,
        points: gradebookEntries.points,
        maxPoints: gradebookEntries.maxPoints,
        feedback: gradebookEntries.feedback,
        isReleased: gradebookEntries.isReleased,
        releasedAt: gradebookEntries.releasedAt,
        createdAt: gradebookEntries.createdAt,
        updatedAt: gradebookEntries.updatedAt,
        student: { id: user.id, name: user.name, email: user.email },
        category: { id: gradebookCategories.id, title: gradebookCategories.title, weight: gradebookCategories.weight },
      })
      .from(gradebookEntries)
      .innerJoin(user, eq(gradebookEntries.studentId, user.id))
      .leftJoin(gradebookCategories, eq(gradebookEntries.categoryId, gradebookCategories.id))
      .where(
        and(
          eq(gradebookEntries.classId, classId),
          viewer.role === "student" ? eq(gradebookEntries.studentId, viewer.id) : undefined,
          viewer.role === "student" ? eq(gradebookEntries.isReleased, true) : undefined,
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
    const categoryId = optionalIdOf(req.body?.categoryId);
    const title = textOf(req.body?.title, GRADEBOOK_WORKFLOW_CONFIG.entry.maximumTitleLength);
    const points = Number(req.body?.points);
    const maxPoints = Number(req.body?.maxPoints);
    const isReleased = booleanOf(req.body?.isReleased, true);
    const feedback = typeof req.body?.feedback === "string"
      ? req.body.feedback.trim().slice(0, GRADEBOOK_WORKFLOW_CONFIG.entry.maximumFeedbackLength)
      : null;

    if (!classId || !studentId || !title || !Number.isInteger(points) || !Number.isInteger(maxPoints) || points < 0 || maxPoints <= 0 || points > maxPoints) {
      return res.status(400).json({ error: "classId, studentId, title, and valid points are required" });
    }

    if (!req.user || !(await canTeach(classId, req.user.id, req.user.role))) {
      return res.status(403).json({ error: "You can only grade assigned classes" });
    }

    if (categoryId !== null && !(await categoryBelongsToClass(categoryId, classId))) {
      return res.status(400).json({ error: "The selected grade category does not belong to this class" });
    }

    const [enrollment] = await db
      .select({ id: enrollments.id })
      .from(enrollments)
      .where(and(eq(enrollments.classId, classId), eq(enrollments.studentId, studentId)))
      .limit(1);

    if (!enrollment) return res.status(400).json({ error: "Student is not enrolled in this class" });

    const [created] = await db
      .insert(gradebookEntries)
      .values({
        classId,
        teacherId: req.user.id,
        studentId,
        categoryId,
        title,
        points,
        maxPoints,
        feedback,
        isReleased,
        releasedAt: isReleased ? new Date() : null,
      })
      .returning();

    if (!created) return res.status(500).json({ error: "Failed to create grade" });

    await writeAudit(created.id, req.user.id, "created", {
      categoryId: created.categoryId,
      points: created.points,
      maxPoints: created.maxPoints,
      isReleased: created.isReleased,
    });

    return res.status(201).json({ data: created });
  } catch (error) {
    console.error("POST /gradebook error:", error);
    return res.status(500).json({ error: "Failed to create grade" });
  }
});

router.patch(GRADEBOOK_ROUTE_PATHS.entryReleaseById, requireAuth, requireRole(["teacher", "admin"]), async (req: Request, res: Response) => {
  try {
    const entryId = idOf(req.params.id);
    const isReleased = req.body?.isReleased;
    if (!entryId || typeof isReleased !== "boolean") {
      return res.status(400).json({ error: "A valid release state is required" });
    }

    const [existing] = await db
      .select({ classId: gradebookEntries.classId })
      .from(gradebookEntries)
      .where(eq(gradebookEntries.id, entryId))
      .limit(1);

    if (!existing || !req.user || !(await canTeach(existing.classId, req.user.id, req.user.role))) {
      return res.status(403).json({ error: "You cannot change this grade release state" });
    }

    const [updated] = await db
      .update(gradebookEntries)
      .set({ isReleased, releasedAt: isReleased ? new Date() : null, updatedAt: new Date() })
      .where(eq(gradebookEntries.id, entryId))
      .returning();

    if (!updated) return res.status(404).json({ error: "Grade entry not found" });

    await writeAudit(updated.id, req.user.id, "release_updated", {
      categoryId: updated.categoryId,
      points: updated.points,
      maxPoints: updated.maxPoints,
      isReleased: updated.isReleased,
    });

    return res.status(200).json({ data: updated });
  } catch (error) {
    console.error("PATCH /gradebook/:id/release error:", error);
    return res.status(500).json({ error: "Failed to update grade release state" });
  }
});

router.get(GRADEBOOK_ROUTE_PATHS.entryAuditById, requireAuth, requireRole(["teacher", "admin"]), async (req: Request, res: Response) => {
  try {
    const entryId = idOf(req.params.id);
    if (!entryId) return res.status(400).json({ error: "A valid grade entry is required" });

    const [entry] = await db
      .select({ classId: gradebookEntries.classId })
      .from(gradebookEntries)
      .where(eq(gradebookEntries.id, entryId))
      .limit(1);

    if (!entry || !req.user || !(await canTeach(entry.classId, req.user.id, req.user.role))) {
      return res.status(403).json({ error: "You cannot view this grade audit history" });
    }

    const data = await db
      .select({
        id: gradebookEntryAudits.id,
        action: gradebookEntryAudits.action,
        details: gradebookEntryAudits.details,
        createdAt: gradebookEntryAudits.createdAt,
        actor: { id: user.id, name: user.name },
      })
      .from(gradebookEntryAudits)
      .innerJoin(user, eq(gradebookEntryAudits.actorId, user.id))
      .where(eq(gradebookEntryAudits.gradebookEntryId, entryId))
      .orderBy(desc(gradebookEntryAudits.createdAt));

    return res.status(200).json({ data });
  } catch (error) {
    console.error("GET /gradebook/:id/audit error:", error);
    return res.status(500).json({ error: "Failed to fetch grade audit history" });
  }
});

router.patch(GRADEBOOK_ROUTE_PATHS.entryById, requireAuth, requireRole(["teacher", "admin"]), async (req: Request, res: Response) => {
  try {
    const entryId = idOf(req.params.id);
    const points = Number(req.body?.points);
    const maxPoints = Number(req.body?.maxPoints);
    const categoryId = optionalIdOf(req.body?.categoryId);
    const feedback = typeof req.body?.feedback === "string"
      ? req.body.feedback.trim().slice(0, GRADEBOOK_WORKFLOW_CONFIG.entry.maximumFeedbackLength)
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

    if (categoryId !== null && !(await categoryBelongsToClass(categoryId, existing.classId))) {
      return res.status(400).json({ error: "The selected grade category does not belong to this class" });
    }

    const [updated] = await db
      .update(gradebookEntries)
      .set({ categoryId, points, maxPoints, feedback, updatedAt: new Date() })
      .where(eq(gradebookEntries.id, entryId))
      .returning();

    if (!updated) return res.status(404).json({ error: "Grade entry not found" });

    await writeAudit(updated.id, req.user.id, "updated", {
      categoryId: updated.categoryId,
      points: updated.points,
      maxPoints: updated.maxPoints,
      isReleased: updated.isReleased,
    });

    return res.status(200).json({ data: updated });
  } catch (error) {
    console.error("PATCH /gradebook error:", error);
    return res.status(500).json({ error: "Failed to update grade" });
  }
});

export default router;
