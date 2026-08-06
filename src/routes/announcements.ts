import express from "express";
import { and, desc, eq, sql } from "drizzle-orm";

import { db } from "../db/index.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { announcements, classes, enrollments, user } from "../db/schema/index.js";

const router = express.Router();

const parseClassId = (value: unknown) => {
  const classId = Number(value);
  return Number.isInteger(classId) && classId > 0 ? classId : null;
};

const normalizeText = (value: unknown, maxLength: number) =>
  typeof value === "string" ? value.trim().slice(0, maxLength) : "";

const canAccessClass = async (classId: number, userId: string, role: string) => {
  const [classRecord] = await db
    .select({ id: classes.id, teacherId: classes.teacherId })
    .from(classes)
    .where(eq(classes.id, classId))
    .limit(1);

  if (!classRecord) return false;
  if (role === "teacher" || role === "admin") {
    return role === "admin" || classRecord.teacherId === userId;
  }

  const [enrollment] = await db
    .select({ id: enrollments.id })
    .from(enrollments)
    .where(and(eq(enrollments.classId, classId), eq(enrollments.studentId, userId)))
    .limit(1);

  return Boolean(enrollment);
};

router.get("/", requireAuth, async (req, res) => {
  try {
    const classId = parseClassId(req.query.classId);
    if (!classId) return res.status(400).json({ error: "A valid classId is required" });

    const currentUser = req.user;
    if (!currentUser || !(await canAccessClass(classId, currentUser.id, currentUser.role))) {
      return res.status(403).json({ error: "You do not have access to this class" });
    }

    const data = await db
      .select({
        id: announcements.id,
        classId: announcements.classId,
        authorId: announcements.authorId,
        title: announcements.title,
        content: announcements.content,
        isPinned: announcements.isPinned,
        createdAt: announcements.createdAt,
        updatedAt: announcements.updatedAt,
        author: {
          id: user.id,
          name: user.name,
          image: user.image,
        },
        className: classes.name,
      })
      .from(announcements)
      .innerJoin(user, eq(announcements.authorId, user.id))
      .innerJoin(classes, eq(announcements.classId, classes.id))
      .where(eq(announcements.classId, classId))
      .orderBy(desc(announcements.isPinned), desc(announcements.createdAt));

    return res.status(200).json({ data });
  } catch (error) {
    console.error("GET /announcements error:", error);
    return res.status(500).json({ error: "Failed to fetch announcements" });
  }
});

router.post("/", requireAuth, requireRole(["teacher", "admin"]), async (req, res) => {
  try {
    const classId = parseClassId(req.body?.classId);
    const title = normalizeText(req.body?.title, 200);
    const content = normalizeText(req.body?.content, 5000);
    const isPinned = req.body?.isPinned === true;

    if (!classId || !title || !content) {
      return res.status(400).json({ error: "classId, title, and content are required" });
    }

    if (req.user?.role === "teacher" && !(await canAccessClass(classId, req.user.id, "teacher"))) {
      return res.status(403).json({ error: "You can only post announcements to your assigned classes" });
    }

    const [created] = await db
      .insert(announcements)
      .values({
        classId,
        authorId: req.user!.id,
        title,
        content,
        isPinned,
      })
      .returning();

    return res.status(201).json({ data: created });
  } catch (error) {
    console.error("POST /announcements error:", error);
    return res.status(500).json({ error: "Failed to create announcement" });
  }
});

router.put("/:id", requireAuth, requireRole(["teacher", "admin"]), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const title = normalizeText(req.body?.title, 200);
    const content = normalizeText(req.body?.content, 5000);

    if (!Number.isInteger(id) || id <= 0 || !title || !content) {
      return res.status(400).json({ error: "Valid id, title, and content are required" });
    }

    const [existing] = await db
      .select({ id: announcements.id, authorId: announcements.authorId, classId: announcements.classId })
      .from(announcements)
      .where(eq(announcements.id, id))
      .limit(1);

    if (!existing) return res.status(404).json({ error: "Announcement not found" });
    if (req.user?.role === "teacher" && !(await canAccessClass(existing.classId, req.user.id, "teacher"))) {
      return res.status(403).json({ error: "You can only edit announcements in your assigned classes" });
    }

    const [updated] = await db
      .update(announcements)
      .set({ title, content, isPinned: req.body?.isPinned === true, updatedAt: new Date() })
      .where(eq(announcements.id, id))
      .returning();

    return res.status(200).json({ data: updated });
  } catch (error) {
    console.error("PUT /announcements/:id error:", error);
    return res.status(500).json({ error: "Failed to update announcement" });
  }
});

router.delete("/:id", requireAuth, requireRole(["teacher", "admin"]), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid announcement id" });

    const [existing] = await db
      .select({ id: announcements.id, classId: announcements.classId })
      .from(announcements)
      .where(eq(announcements.id, id))
      .limit(1);

    if (!existing) return res.status(404).json({ error: "Announcement not found" });
    if (req.user?.role === "teacher" && !(await canAccessClass(existing.classId, req.user.id, "teacher"))) {
      return res.status(403).json({ error: "You can only delete announcements in your assigned classes" });
    }

    await db.delete(announcements).where(eq(announcements.id, id));
    return res.status(204).send();
  } catch (error) {
    console.error("DELETE /announcements/:id error:", error);
    return res.status(500).json({ error: "Failed to delete announcement" });
  }
});

export default router;
