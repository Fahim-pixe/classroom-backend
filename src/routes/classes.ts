import express from "express";
import { and, desc, eq, getTableColumns, ilike, or, sql } from "drizzle-orm";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { db } from "../db/index.js";
import { classes, departments, enrollments, storageAssets, subjects, user } from "../db/schema/index.js";
import { API_PATHS, STORAGE_CONFIG } from "../config/app.js";

const router = express.Router();

const normalizeStorageAssetId = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const getOwnedActiveBannerAsset = async (assetId: string, ownerId: string) => {
  const [asset] = await db
    .select()
    .from(storageAssets)
    .where(and(
      eq(storageAssets.id, assetId),
      eq(storageAssets.ownerId, ownerId),
      eq(storageAssets.assetKind, "class_banner"),
      eq(storageAssets.state, "active"),
      eq(storageAssets.storageProvider, STORAGE_CONFIG.provider),
    ))
    .limit(1);
  return asset ?? null;
};

const storageRedirectPath = (assetId: string) =>
  `${API_PATHS.prefixed.storage}${STORAGE_CONFIG.routePaths.redirectByAssetId.replace(":assetId", assetId)}`;

// Get all classes with optional search, subject, teacher filters, and pagination
router.get("/", async (req, res) => {
  try {
    const { search, subject, teacher, teacherId, page = 1, limit = 10 } = req.query;

    const parsedPage = Number(page);
    const parsedLimit = Number(limit);
    const currentPage = Number.isFinite(parsedPage)
      ? Math.max(1, Math.floor(parsedPage))
      : 1;
    const limitPerPage = Number.isFinite(parsedLimit)
      ? Math.min(100, Math.max(1, Math.floor(parsedLimit)))
      : 10;
    const offset = (currentPage - 1) * limitPerPage;

    const filterConditions = [];

    if (search) {
      filterConditions.push(
        or(
          ilike(classes.name, `%${search}%`),
          ilike(classes.inviteCode, `%${search}%`)
        )
      );
    }

    if (subject) {
      filterConditions.push(ilike(subjects.name, `%${subject}%`));
    }

    if (teacher) {
      filterConditions.push(ilike(user.name, `%${teacher}%`));
    }

    if (teacherId) {
      filterConditions.push(eq(classes.teacherId, String(teacherId)));
    }

    const whereClause =
      filterConditions.length > 0 ? and(...filterConditions) : undefined;

    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(classes)
      .leftJoin(subjects, eq(classes.subjectId, subjects.id))
      .leftJoin(user, eq(classes.teacherId, user.id))
      .where(whereClause);

    const totalCount = countResult[0]?.count ?? 0;

    const classesList = await db
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
      .where(whereClause)
      .orderBy(desc(classes.createdAt))
      .limit(limitPerPage)
      .offset(offset);

    res.status(200).json({
      data: classesList,
      pagination: {
        page: currentPage,
        limit: limitPerPage,
        total: totalCount,
        totalPages: Math.ceil(totalCount / limitPerPage),
      },
    });
  } catch (error) {
    console.error("GET /classes error:", error);
    res.status(500).json({ error: "Failed to fetch classes" });
  }
});

router.post("/", requireAuth, requireRole(["admin", "teacher"]), async (req, res) => {
  try { // <-- MISSING TRY BLOCK ADDED HERE
    const {
      name,
      teacherId,
      subjectId,
      capacity,
      description,
      status,
      bannerUrl,
      bannerCldPubId,
      bannerAssetId,
      schedules, // <-- Extract schedules from the request
    } = req.body;

    // Optional but highly recommended: Add basic validation here
    if (!name || !teacherId || !subjectId) {
       return res.status(400).json({ error: "Missing required fields" });
    }

    const normalizedBannerAssetId = normalizeStorageAssetId(bannerAssetId);
    const confirmedBannerAsset = normalizedBannerAssetId
      ? await getOwnedActiveBannerAsset(normalizedBannerAssetId, req.user!.id)
      : null;
    if (normalizedBannerAssetId && !confirmedBannerAsset) {
      return res.status(422).json({ error: "The selected class banner is not active or does not belong to you" });
    }
    if (STORAGE_CONFIG.featureFlags.supabaseWritesEnabled && !confirmedBannerAsset && bannerUrl) {
      return res.status(410).json({ error: "Direct class-banner URLs are disabled after Supabase Storage cutover" });
    }

    const [createdClass] = await db
      .insert(classes)
      .values({
        subjectId,
        inviteCode: Math.random().toString(36).substring(2, 9),
        name,
        teacherId,
        bannerAssetId: confirmedBannerAsset?.id ?? null,
        bannerCldPubId: confirmedBannerAsset ? null : bannerCldPubId,
        bannerUrl: confirmedBannerAsset ? storageRedirectPath(confirmedBannerAsset.id) : bannerUrl,
        capacity,
        description,
        schedules: schedules || [], 
        status,
      })
      .returning({ id: classes.id });

    if (!createdClass) {
       return res.status(500).json({ error: "Failed to create class" });
    }
    if (confirmedBannerAsset) {
      await db.update(storageAssets).set({
        entityType: "class",
        entityId: String(createdClass.id),
        classId: createdClass.id,
        updatedAt: new Date(),
      }).where(eq(storageAssets.id, confirmedBannerAsset.id));
    }
    
    res.status(201).json({ data: createdClass });

  } catch (error) {
    console.error("POST /classes error:", error);
    res.status(500).json({ error: "Failed to create class" });
  }
});

// Get class details with counts
router.get("/:id", async (req, res) => {
  try {
    const classId = Number(req.params.id);

    if (!Number.isFinite(classId)) {
      return res.status(400).json({ error: "Invalid class id" });
    }

    const [classDetails] = await db
      .select({
        ...getTableColumns(classes),
        subject: {
          ...getTableColumns(subjects),
        },
        department: {
          ...getTableColumns(departments),
        },
        teacher: {
          ...getTableColumns(user),
        },
      })
      .from(classes)
      .leftJoin(subjects, eq(classes.subjectId, subjects.id))
      .leftJoin(departments, eq(subjects.departmentId, departments.id))
      .leftJoin(user, eq(classes.teacherId, user.id))
      .where(eq(classes.id, classId));

    if (!classDetails) {
      return res.status(404).json({ error: "Class not found" });
    }

    res.status(200).json({ data: classDetails });
  } catch (error) {
    console.error("GET /classes/:id error:", error);
    res.status(500).json({ error: "Failed to fetch class details" });
  }
});

// List users in a class by role with pagination
router.get("/:id/users", async (req, res) => {
  try {
    const classId = Number(req.params.id);
    const { role, page = 1, limit = 10 } = req.query;

    if (!Number.isFinite(classId)) {
      return res.status(400).json({ error: "Invalid class id" });
    }

    if (role !== "teacher" && role !== "student") {
      return res.status(400).json({ error: "Invalid role" });
    }

    const parsedPage = Number(page);
    const parsedLimit = Number(limit);
    const currentPage = Number.isFinite(parsedPage)
      ? Math.max(1, Math.floor(parsedPage))
      : 1;
    const limitPerPage = Number.isFinite(parsedLimit)
      ? Math.min(100, Math.max(1, Math.floor(parsedLimit)))
      : 10;
    const offset = (currentPage - 1) * limitPerPage;

    const baseSelect = {
      id: user.id,
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
      image: user.image,
      role: user.role,
      imageCldPubId: user.imageCldPubId,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };

    const groupByFields = [
      user.id,
      user.name,
      user.email,
      user.emailVerified,
      user.image,
      user.role,
      user.imageCldPubId,
      user.createdAt,
      user.updatedAt,
    ];

    const countResult =
      role === "teacher"
        ? await db
            .select({ count: sql<number>`count(distinct ${user.id})` })
            .from(user)
            .leftJoin(classes, eq(user.id, classes.teacherId))
            .where(and(eq(user.role, role), eq(classes.id, classId)))
        : await db
            .select({ count: sql<number>`count(distinct ${user.id})` })
            .from(user)
            .leftJoin(enrollments, eq(user.id, enrollments.studentId))
            .where(and(eq(user.role, role), eq(enrollments.classId, classId)));

    const totalCount = countResult[0]?.count ?? 0;

    const usersList =
      role === "teacher"
        ? await db
            .select(baseSelect)
            .from(user)
            .leftJoin(classes, eq(user.id, classes.teacherId))
            .where(and(eq(user.role, role), eq(classes.id, classId)))
            .groupBy(...groupByFields)
            .orderBy(desc(user.createdAt))
            .limit(limitPerPage)
            .offset(offset)
        : await db
            .select(baseSelect)
            .from(user)
            .leftJoin(enrollments, eq(user.id, enrollments.studentId))
            .where(and(eq(user.role, role), eq(enrollments.classId, classId)))
            .groupBy(...groupByFields)
            .orderBy(desc(user.createdAt))
            .limit(limitPerPage)
            .offset(offset);

    res.status(200).json({
      data: usersList,
      pagination: {
        page: currentPage,
        limit: limitPerPage,
        total: totalCount,
        totalPages: Math.ceil(totalCount / limitPerPage),
      },
    });
  } catch (error) {
    console.error("GET /classes/:id/users error:", error);
    res.status(500).json({ error: "Failed to fetch class users" });
  }
});

// UPDATE a class
router.put("/:id", requireAuth, requireRole(["admin", "teacher"]), async (req, res) => {
  try {
    const classId = Number(req.params.id);
    if (!Number.isFinite(classId)) return res.status(400).json({ error: "Invalid class id" });

    const {
      name, teacherId, subjectId, capacity, description, status, bannerUrl, bannerCldPubId, bannerAssetId
    } = req.body;
    const hasBannerAssetField = Object.hasOwn(req.body ?? {}, "bannerAssetId");
    const normalizedBannerAssetId = normalizeStorageAssetId(bannerAssetId);
    const confirmedBannerAsset = normalizedBannerAssetId
      ? await getOwnedActiveBannerAsset(normalizedBannerAssetId, req.user!.id)
      : null;
    if (normalizedBannerAssetId && !confirmedBannerAsset) {
      return res.status(422).json({ error: "The selected class banner is not active or does not belong to you" });
    }
    if (STORAGE_CONFIG.featureFlags.supabaseWritesEnabled && !confirmedBannerAsset && bannerUrl) {
      return res.status(410).json({ error: "Direct class-banner URLs are disabled after Supabase Storage cutover" });
    }

    const [updatedClass] = await db
      .update(classes)
      .set({
        name, teacherId, subjectId, capacity, description, status,
        bannerAssetId: confirmedBannerAsset?.id ?? (hasBannerAssetField ? null : undefined),
        bannerUrl: confirmedBannerAsset ? storageRedirectPath(confirmedBannerAsset.id) : (hasBannerAssetField ? null : bannerUrl),
        bannerCldPubId: confirmedBannerAsset || hasBannerAssetField ? null : bannerCldPubId,
      })
      .where(eq(classes.id, classId))
      .returning();

    if (!updatedClass) return res.status(404).json({ error: "Class not found" });
    if (confirmedBannerAsset) {
      await db.update(storageAssets).set({
        entityType: "class",
        entityId: String(classId),
        classId,
        updatedAt: new Date(),
      }).where(eq(storageAssets.id, confirmedBannerAsset.id));
    }
    res.status(200).json({ data: updatedClass });
  } catch (error) {
    console.error("PUT /classes/:id error:", error);
    res.status(500).json({ error: "Failed to update class" });
  }
});

// DELETE a class
router.delete("/:id", requireAuth, requireRole(["admin", "teacher"]), async (req, res) => {
  try {
    const classId = Number(req.params.id);
    if (!Number.isFinite(classId)) return res.status(400).json({ error: "Invalid class id" });

    const [deletedClass] = await db
      .delete(classes)
      .where(eq(classes.id, classId))
      .returning({ id: classes.id });

    if (!deletedClass) return res.status(404).json({ error: "Class not found" });
    res.status(200).json({ data: deletedClass, message: "Class deleted successfully" });
  } catch (error) {
    console.error("DELETE /classes/:id error:", error);
    res.status(500).json({ error: "Failed to delete class" });
  }
});

export default router;