import express from "express";
import { and, desc, eq, getTableColumns, ilike, or } from "drizzle-orm";
import { db } from "../db/index.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { classes, enrollments, resourceFavorites, resources, resourceViews, subjects } from "../db/schema/index.js";

const router = express.Router();

const accessibleClassCondition = (userId: string, role: string) =>
  role === "admin"
    ? undefined
    : role === "teacher"
      ? eq(classes.teacherId, userId)
      : eq(enrollments.studentId, userId);

router.get("/", requireAuth, async (req, res) => {
  try {
    const search = String(req.query.search ?? "").trim();
    const category = String(req.query.category ?? "").trim();
    const classId = Number(req.query.classId);
    const currentUser = req.user!;
    const filters = [
      eq(resources.isArchived, false),
      currentUser.role === "student" ? eq(resources.isPublished, true) : undefined,
      search ? or(ilike(resources.title, `%${search}%`), ilike(resources.description, `%${search}%`)) : undefined,
      category ? eq(resources.category, category as any) : undefined,
      Number.isInteger(classId) && classId > 0 ? eq(resources.classId, classId) : undefined,
      accessibleClassCondition(currentUser.id, currentUser.role),
    ].filter(Boolean) as any[];

    const rows = await db
      .selectDistinct({
        ...getTableColumns(resources),
        className: classes.name,
        subjectName: subjects.name,
        isFavorite: resourceFavorites.id,
        lastViewedAt: resourceViews.lastViewedAt,
      })
      .from(resources)
      .innerJoin(classes, eq(resources.classId, classes.id))
      .innerJoin(subjects, eq(classes.subjectId, subjects.id))
      .leftJoin(enrollments, eq(enrollments.classId, classes.id))
      .leftJoin(resourceFavorites, and(eq(resourceFavorites.resourceId, resources.id), eq(resourceFavorites.userId, currentUser.id)))
      .leftJoin(resourceViews, and(eq(resourceViews.resourceId, resources.id), eq(resourceViews.userId, currentUser.id)))
      .where(and(...filters))
      .orderBy(desc(resources.createdAt));

    return res.json({ data: rows.map((row) => ({ ...row, isFavorite: Boolean(row.isFavorite) })) });
  } catch (error) {
    console.error("GET /resources error:", error);
    return res.status(500).json({ error: "Failed to fetch resources" });
  }
});

router.post("/", requireAuth, requireRole(["teacher", "admin"]), async (req, res) => {
  try {
    const { classId, title, description, category = "other", resourceUrl, mimeType, fileSizeBytes, isPublished = true } = req.body ?? {};
    const parsedClassId = Number(classId);
    if (!Number.isInteger(parsedClassId) || !title || !resourceUrl) {
      return res.status(400).json({ error: "classId, title, and resourceUrl are required" });
    }
    const [targetClass] = await db.select({ id: classes.id, teacherId: classes.teacherId }).from(classes).where(eq(classes.id, parsedClassId)).limit(1);
    if (!targetClass) return res.status(404).json({ error: "Class not found" });
    if (req.user!.role === "teacher" && targetClass.teacherId !== req.user!.id) return res.status(403).json({ error: "You can only add resources to your classes" });
    const [created] = await db.insert(resources).values({ classId: parsedClassId, ownerId: req.user!.id, title: String(title).trim(), description: description ? String(description).trim() : null, category, resourceUrl: String(resourceUrl).trim(), mimeType: mimeType ? String(mimeType) : null, fileSizeBytes: Number.isInteger(Number(fileSizeBytes)) ? Number(fileSizeBytes) : null, isPublished: isPublished !== false }).returning();
    return res.status(201).json({ data: created });
  } catch (error) {
    console.error("POST /resources error:", error);
    return res.status(500).json({ error: "Failed to create resource" });
  }
});

router.post("/:id/favorite", requireAuth, async (req, res) => {
  try {
    const resourceId = Number(req.params.id);
    const [existing] = await db.select({ id: resourceFavorites.id }).from(resourceFavorites).where(and(eq(resourceFavorites.resourceId, resourceId), eq(resourceFavorites.userId, req.user!.id))).limit(1);
    if (existing) {
      await db.delete(resourceFavorites).where(eq(resourceFavorites.id, existing.id));
      return res.json({ data: { isFavorite: false } });
    }
    await db.insert(resourceFavorites).values({ resourceId, userId: req.user!.id });
    return res.json({ data: { isFavorite: true } });
  } catch (error) {
    console.error("POST /resources/:id/favorite error:", error);
    return res.status(500).json({ error: "Failed to update favorite" });
  }
});

router.post("/:id/view", requireAuth, async (req, res) => {
  try {
    const resourceId = Number(req.params.id);
    const [existing] = await db.select({ id: resourceViews.id }).from(resourceViews).where(and(eq(resourceViews.resourceId, resourceId), eq(resourceViews.userId, req.user!.id))).limit(1);
    if (existing) await db.update(resourceViews).set({ lastViewedAt: new Date(), updatedAt: new Date() }).where(eq(resourceViews.id, existing.id));
    else await db.insert(resourceViews).values({ resourceId, userId: req.user!.id });
    return res.status(204).send();
  } catch (error) {
    console.error("POST /resources/:id/view error:", error);
    return res.status(500).json({ error: "Failed to record resource view" });
  }
});

export default router;
