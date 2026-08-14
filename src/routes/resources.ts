import express from "express";
import crypto from "node:crypto";
import { and, desc, eq, getTableColumns, gt, ilike, isNull, or, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { classes, enrollments, resourceFavorites, resources, resourceViews, storageAssets, subjects } from "../db/schema/index.js";
import { CLOUDINARY_CONFIG, RESOURCE_LIFECYCLE_CONFIG, RESOURCE_LIST_CONFIG, STORAGE_CONFIG } from "../config/app.js";

const router = express.Router();

const accessibleClassCondition = (userId: string, role: string) =>
  role === "admin"
    ? undefined
    : role === "teacher"
      ? eq(classes.teacherId, userId)
      : eq(enrollments.studentId, userId);

const currentUserCanManageExpired = (role: string, value: unknown) =>
  (role === "admin" || role === "teacher") && String(value ?? "").toLowerCase() === "true";

const normalizeTags = (value: unknown) => {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value
    .map((tag) => String(tag).trim())
    .filter((tag) => tag.length > 0 && tag.length <= RESOURCE_LIFECYCLE_CONFIG.metadata.maximumTagLength)
    .filter((tag) => {
      const key = tag.toLocaleLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, RESOURCE_LIFECYCLE_CONFIG.metadata.maximumTagCount);
};

const normalizeFolder = (value: unknown) => {
  if (typeof value !== "string") return null;
  const folder = value.trim();
  return folder && folder.length <= RESOURCE_LIFECYCLE_CONFIG.metadata.maximumFolderLength ? folder : null;
};

const normalizeExpiry = (value: unknown) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
};

const getManagedResource = async (resourceId: number, userId: string, role: string) => {
  const [resource] = await db
    .select({ resource: getTableColumns(resources), teacherId: classes.teacherId })
    .from(resources)
    .innerJoin(classes, eq(resources.classId, classes.id))
    .where(eq(resources.id, resourceId))
    .limit(1);
  if (!resource || (role === "teacher" && resource.teacherId !== userId)) return null;
  return resource.resource;
};

router.post("/upload-signature", requireAuth, requireRole(["admin", "teacher"]), async (req, res) => {
  if (STORAGE_CONFIG.featureFlags.supabaseWritesEnabled) {
    return res.status(410).json({ error: "Cloudinary uploads are disabled after Supabase Storage cutover" });
  }
  if (!CLOUDINARY_CONFIG.cloudName || !CLOUDINARY_CONFIG.apiKey || !CLOUDINARY_CONFIG.apiSecret) {
    return res.status(503).json({ error: "Cloudinary uploads are not configured" });
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const folder = CLOUDINARY_CONFIG.uploadFolder;
  const signaturePayload = `folder=${folder}&timestamp=${timestamp}${CLOUDINARY_CONFIG.apiSecret}`;
  const signature = crypto.createHash("sha1").update(signaturePayload).digest("hex");

  return res.json({
    data: {
      cloudName: CLOUDINARY_CONFIG.cloudName,
      apiKey: CLOUDINARY_CONFIG.apiKey,
      folder,
      timestamp,
      signature,
      resourceType: "auto",
    },
  });
});

router.get("/", requireAuth, async (req, res) => {
  try {
    const search = String(req.query.search ?? "").trim();
    const category = String(req.query.category ?? "").trim();
    const classId = Number(req.query.classId);
    const favoritesOnly = String(req.query[RESOURCE_LIST_CONFIG.queryParams.favoritesOnly] ?? "").toLowerCase() === "true";
    const folder = String(req.query[RESOURCE_LIST_CONFIG.queryParams.folder] ?? "").trim();
    const tag = String(req.query[RESOURCE_LIST_CONFIG.queryParams.tag] ?? "").trim();
    const includeExpired = currentUserCanManageExpired(req.user!.role, req.query[RESOURCE_LIST_CONFIG.queryParams.includeExpired]);
    const requestedPage = Number(req.query.page);
    const requestedLimit = Number(req.query.limit);
    const page = Number.isInteger(requestedPage) && requestedPage > 0
      ? requestedPage
      : RESOURCE_LIST_CONFIG.defaultPage;
    const limit = Number.isInteger(requestedLimit) && requestedLimit > 0
      ? Math.min(requestedLimit, RESOURCE_LIST_CONFIG.maxPageSize)
      : RESOURCE_LIST_CONFIG.defaultPageSize;
    const offset = (page - 1) * limit;
    const currentUser = req.user!;
    const filters = [
      eq(resources.isArchived, false),
      currentUser.role === "student" ? eq(resources.isPublished, true) : undefined,
      search ? or(ilike(resources.title, `%${search}%`), ilike(resources.description, `%${search}%`)) : undefined,
      category ? eq(resources.category, category as any) : undefined,
      Number.isInteger(classId) && classId > 0 ? eq(resources.classId, classId) : undefined,
      folder ? eq(resources.folder, folder) : undefined,
      tag ? sql`${resources.tags} @> ${JSON.stringify([tag])}::jsonb` : undefined,
      includeExpired ? undefined : or(isNull(resources.expiresAt), gt(resources.expiresAt, new Date())),
      favoritesOnly ? sql`${resourceFavorites.id} IS NOT NULL` : undefined,
      accessibleClassCondition(currentUser.id, currentUser.role),
    ].filter(Boolean) as any[];

    const totals = await db
      .select({ total: sql<number>`count(distinct ${resources.id})` })
      .from(resources)
      .innerJoin(classes, eq(resources.classId, classes.id))
      .leftJoin(enrollments, eq(enrollments.classId, classes.id))
      .leftJoin(resourceFavorites, and(eq(resourceFavorites.resourceId, resources.id), eq(resourceFavorites.userId, currentUser.id)))
      .where(and(...filters));
    const total = totals[0]?.total ?? 0;

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
      .orderBy(desc(resources.createdAt))
      .limit(limit)
      .offset(offset);

    return res.json({
      data: rows.map((row) => ({ ...row, isFavorite: Boolean(row.isFavorite) })),
      pagination: {
        total: Number(total ?? 0),
        page,
        limit,
      },
    });
  } catch (error) {
    console.error("GET /resources error:", error);
    return res.status(500).json({ error: "Failed to fetch resources" });
  }
});

router.post("/", requireAuth, requireRole(["teacher", "admin"]), async (req, res) => {
  try {
    const { classId, title, description, category = "other", resourceUrl, storageAssetId, mimeType, fileSizeBytes, isPublished = true, folder, tags, expiresAt } = req.body ?? {};
    const parsedClassId = Number(classId);
    const normalizedStorageAssetId = storageAssetId ? String(storageAssetId) : null;
    const normalizedResourceUrl = resourceUrl ? String(resourceUrl).trim() : "";
    const normalizedFolder = normalizeFolder(folder);
    const normalizedTags = normalizeTags(tags);
    const normalizedExpiry = normalizeExpiry(expiresAt);
    if (!Number.isInteger(parsedClassId) || !title || normalizedExpiry === undefined || (!normalizedResourceUrl && !normalizedStorageAssetId)) {
      return res.status(400).json({ error: "classId, title, and either resourceUrl or storageAssetId are required" });
    }
    const [targetClass] = await db.select({ id: classes.id, teacherId: classes.teacherId }).from(classes).where(eq(classes.id, parsedClassId)).limit(1);
    if (!targetClass) return res.status(404).json({ error: "Class not found" });
    if (req.user!.role === "teacher" && targetClass.teacherId !== req.user!.id) return res.status(403).json({ error: "You can only add resources to your classes" });

    let confirmedAsset: typeof storageAssets.$inferSelect | null = null;
    if (normalizedStorageAssetId) {
      const [asset] = await db.select().from(storageAssets).where(and(
        eq(storageAssets.id, normalizedStorageAssetId),
        eq(storageAssets.ownerId, req.user!.id),
        eq(storageAssets.assetKind, "resource"),
        eq(storageAssets.state, "active"),
        eq(storageAssets.storageProvider, STORAGE_CONFIG.provider)
      )).limit(1);
      if (!asset || asset.classId !== parsedClassId) {
        return res.status(422).json({ error: "The selected storage asset is not authorized for this class resource" });
      }
      confirmedAsset = asset;
    }

    const [created] = await db.insert(resources).values({
      classId: parsedClassId,
      ownerId: req.user!.id,
      title: String(title).trim(),
      description: description ? String(description).trim() : null,
      category,
      resourceUrl: confirmedAsset ? `storage-asset://${confirmedAsset.id}` : normalizedResourceUrl,
      storageAssetId: confirmedAsset?.id ?? null,
      mimeType: confirmedAsset?.mimeType ?? (mimeType ? String(mimeType) : null),
      fileSizeBytes: confirmedAsset?.fileSizeBytes ?? (Number.isInteger(Number(fileSizeBytes)) ? Number(fileSizeBytes) : null),
      isPublished: isPublished !== false,
      folder: normalizedFolder,
      tags: normalizedTags,
      expiresAt: normalizedExpiry,
    }).returning();
    if (created && confirmedAsset) {
      await db.update(storageAssets)
        .set({ entityType: "resource", entityId: String(created.id), updatedAt: new Date() })
        .where(eq(storageAssets.id, confirmedAsset.id));
    }
    return res.status(201).json({ data: created });
  } catch (error) {
    console.error("POST /resources error:", error);
    return res.status(500).json({ error: "Failed to create resource" });
  }
});

router.patch(RESOURCE_LIFECYCLE_CONFIG.routePaths.versionById, requireAuth, requireRole(["teacher", "admin"]), async (req, res) => {
  try {
    const resourceId = Number(req.params.id);
    if (!Number.isInteger(resourceId)) return res.status(400).json({ error: "Invalid resource id" });
    const existing = await getManagedResource(resourceId, req.user!.id, req.user!.role);
    if (!existing) return res.status(404).json({ error: "Resource not found" });

    const normalizedFolder = normalizeFolder(req.body?.folder);
    const normalizedTags = normalizeTags(req.body?.tags);
    const normalizedExpiry = normalizeExpiry(req.body?.expiresAt);
    if (normalizedExpiry === undefined) return res.status(400).json({ error: "Invalid resource expiry" });
    const nextVersion = existing.version + 1;
    if (nextVersion > RESOURCE_LIFECYCLE_CONFIG.metadata.maximumVersion) {
      return res.status(422).json({ error: "Resource revision limit reached" });
    }

    const [updated] = await db.update(resources).set({
      title: req.body?.title ? String(req.body.title).trim() : existing.title,
      description: req.body?.description === undefined ? existing.description : String(req.body.description).trim() || null,
      folder: req.body?.folder === undefined ? existing.folder : normalizedFolder,
      tags: req.body?.tags === undefined ? existing.tags : normalizedTags,
      expiresAt: req.body?.expiresAt === undefined ? existing.expiresAt : normalizedExpiry,
      isPublished: typeof req.body?.isPublished === "boolean" ? req.body.isPublished : existing.isPublished,
      version: nextVersion,
      updatedAt: new Date(),
    }).where(eq(resources.id, resourceId)).returning();
    return res.json({ data: updated });
  } catch (error) {
    console.error("PATCH /resources/:id/version error:", error);
    return res.status(500).json({ error: "Failed to revise resource" });
  }
});

router.post(RESOURCE_LIFECYCLE_CONFIG.routePaths.archiveById, requireAuth, requireRole(["teacher", "admin"]), async (req, res) => {
  try {
    const resourceId = Number(req.params.id);
    const existing = Number.isInteger(resourceId) ? await getManagedResource(resourceId, req.user!.id, req.user!.role) : null;
    if (!existing) return res.status(404).json({ error: "Resource not found" });
    const [updated] = await db.update(resources).set({ isArchived: true, updatedAt: new Date() }).where(eq(resources.id, resourceId)).returning();
    return res.json({ data: updated });
  } catch (error) {
    console.error("POST /resources/:id/archive error:", error);
    return res.status(500).json({ error: "Failed to archive resource" });
  }
});

router.post(RESOURCE_LIFECYCLE_CONFIG.routePaths.restoreById, requireAuth, requireRole(["teacher", "admin"]), async (req, res) => {
  try {
    const resourceId = Number(req.params.id);
    const existing = Number.isInteger(resourceId) ? await getManagedResource(resourceId, req.user!.id, req.user!.role) : null;
    if (!existing) return res.status(404).json({ error: "Resource not found" });
    const [updated] = await db.update(resources).set({ isArchived: false, updatedAt: new Date() }).where(eq(resources.id, resourceId)).returning();
    return res.json({ data: updated });
  } catch (error) {
    console.error("POST /resources/:id/restore error:", error);
    return res.status(500).json({ error: "Failed to restore resource" });
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
