import express from "express";
import { and, desc, eq } from "drizzle-orm";

import { db } from "../db/index.js";
import { assignments, classes, enrollments, storageAssets, submissions, user } from "../db/schema/index.js";
import { API_PATHS, STORAGE_CONFIG } from "../config/app.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = express.Router();

const parseId = (value: unknown) => {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
};

const textValue = (value: unknown, max: number) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

const normalizeStorageAssetId = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const storageRedirectPath = (assetId: string) =>
  `${API_PATHS.prefixed.storage}${STORAGE_CONFIG.routePaths.redirectByAssetId.replace(":assetId", assetId)}`;

const getOwnedActiveAttachmentAsset = async ({
  assetId,
  ownerId,
  assetKind,
  classId,
  expectedEntityId,
}: {
  assetId: string;
  ownerId: string;
  assetKind: "assignment_attachment" | "submission_attachment";
  classId: number;
  expectedEntityId?: string;
}) => {
  const [asset] = await db.select().from(storageAssets).where(and(
    eq(storageAssets.id, assetId),
    eq(storageAssets.ownerId, ownerId),
    eq(storageAssets.assetKind, assetKind),
    eq(storageAssets.classId, classId),
    eq(storageAssets.state, "active"),
    eq(storageAssets.storageProvider, STORAGE_CONFIG.provider),
  )).limit(1);
  if (!asset || (expectedEntityId && asset.entityId !== expectedEntityId)) return null;
  return asset;
};

const getAssignment = async (id: number) => {
  const [assignment] = await db
    .select({ id: assignments.id, classId: assignments.classId, maxPoints: assignments.maxPoints })
    .from(assignments)
    .where(eq(assignments.id, id))
    .limit(1);
  return assignment;
};

const canAccessClass = async (classId: number, userId: string, role: string) => {
  const [classRecord] = await db
    .select({ teacherId: classes.teacherId })
    .from(classes)
    .where(eq(classes.id, classId))
    .limit(1);
  if (!classRecord) return false;
  if (role === "admin" || (role === "teacher" && classRecord.teacherId === userId)) return true;
  const [enrollment] = await db
    .select({ id: enrollments.id })
    .from(enrollments)
    .where(and(eq(enrollments.classId, classId), eq(enrollments.studentId, userId)))
    .limit(1);
  return Boolean(enrollment);
};

router.get("/", requireAuth, async (req, res) => {
  try {
    const classId = parseId(req.query.classId);
    if (!classId) return res.status(400).json({ error: "A valid classId is required" });
    if (!req.user || !(await canAccessClass(classId, req.user.id, req.user.role))) {
      return res.status(403).json({ error: "You do not have access to this class" });
    }

    const data = await db
      .select({
        id: assignments.id,
        classId: assignments.classId,
        authorId: assignments.authorId,
        title: assignments.title,
        description: assignments.description,
        dueAt: assignments.dueAt,
        maxPoints: assignments.maxPoints,
        attachmentUrl: assignments.attachmentUrl,
        attachmentName: assignments.attachmentName,
        attachmentMimeType: assignments.attachmentMimeType,
        attachmentSizeBytes: assignments.attachmentSizeBytes,
        attachmentAssetId: assignments.attachmentAssetId,
        createdAt: assignments.createdAt,
        updatedAt: assignments.updatedAt,
        submission: {
          id: submissions.id,
          content: submissions.content,
          attachmentUrl: submissions.attachmentUrl,
          attachmentName: submissions.attachmentName,
          attachmentMimeType: submissions.attachmentMimeType,
          attachmentSizeBytes: submissions.attachmentSizeBytes,
          attachmentAssetId: submissions.attachmentAssetId,
          submittedAt: submissions.submittedAt,
          grade: submissions.grade,
          feedback: submissions.feedback,
        },
      })
      .from(assignments)
      .leftJoin(
        submissions,
        and(eq(assignments.id, submissions.assignmentId), eq(submissions.studentId, req.user!.id))
      )
      .where(eq(assignments.classId, classId))
      .orderBy(desc(assignments.dueAt), desc(assignments.createdAt));

    return res.json({ data });
  } catch (error) {
    console.error("GET /assignments error:", error);
    return res.status(500).json({ error: "Failed to fetch assignments" });
  }
});

router.get("/:id", requireAuth, async (req, res) => {
  try {
    const assignmentId = parseId(req.params.id);
    if (!assignmentId) return res.status(400).json({ error: "Invalid assignment id" });

    const assignment = await getAssignment(assignmentId);
    if (!assignment) return res.status(404).json({ error: "Assignment not found" });

    if (!req.user || !(await canAccessClass(assignment.classId, req.user.id, req.user.role))) {
      return res.status(403).json({ error: "You do not have access to this assignment" });
    }

    const [details] = await db
      .select({
        id: assignments.id,
        classId: assignments.classId,
        authorId: assignments.authorId,
        title: assignments.title,
        description: assignments.description,
        dueAt: assignments.dueAt,
        maxPoints: assignments.maxPoints,
        attachmentUrl: assignments.attachmentUrl,
        attachmentName: assignments.attachmentName,
        attachmentMimeType: assignments.attachmentMimeType,
        attachmentSizeBytes: assignments.attachmentSizeBytes,
        attachmentAssetId: assignments.attachmentAssetId,
        createdAt: assignments.createdAt,
        updatedAt: assignments.updatedAt,
        className: classes.name,
      })
      .from(assignments)
      .innerJoin(classes, eq(classes.id, assignments.classId))
      .where(eq(assignments.id, assignmentId))
      .limit(1);

    return res.json({ data: details });
  } catch (error) {
    console.error("GET /assignments/:id error:", error);
    return res.status(500).json({ error: "Failed to fetch assignment details" });
  }
});

router.post("/", requireAuth, requireRole(["teacher", "admin"]), async (req, res) => {
  try {
    const classId = parseId(req.body?.classId);
    const title = textValue(req.body?.title, 200);
    const description = textValue(req.body?.description, 10000);
    const maxPoints = Number(req.body?.maxPoints ?? 100);
    const dueAt = req.body?.dueAt ? new Date(req.body.dueAt) : null;
    const attachmentUrl = textValue(req.body?.attachmentUrl, 2000) || null;
    const attachmentName = textValue(req.body?.attachmentName, 255) || null;
    const attachmentMimeType = textValue(req.body?.attachmentMimeType, 120) || null;
    const attachmentSizeBytes = Number.isInteger(Number(req.body?.attachmentSizeBytes)) ? Number(req.body.attachmentSizeBytes) : null;
    const attachmentAssetId = normalizeStorageAssetId(req.body?.attachmentAssetId);

    if (!classId || !title || !description || !Number.isInteger(maxPoints) || maxPoints <= 0) {
      return res.status(400).json({ error: "classId, title, description, and positive maxPoints are required" });
    }
    if (dueAt && Number.isNaN(dueAt.getTime())) return res.status(400).json({ error: "Invalid dueAt" });
    if (req.user?.role === "teacher" && !(await canAccessClass(classId, req.user.id, "teacher"))) {
      return res.status(403).json({ error: "You can only create assignments for your assigned classes" });
    }

    const confirmedAttachment = attachmentAssetId
      ? await getOwnedActiveAttachmentAsset({
        assetId: attachmentAssetId,
        ownerId: req.user!.id,
        assetKind: "assignment_attachment",
        classId,
      })
      : null;
    if (attachmentAssetId && !confirmedAttachment) {
      return res.status(422).json({ error: "The selected assignment attachment is not active or is not authorized for this class" });
    }
    if (STORAGE_CONFIG.featureFlags.supabaseWritesEnabled && !confirmedAttachment && attachmentUrl) {
      return res.status(410).json({ error: "Direct assignment attachment URLs are disabled after Supabase Storage cutover" });
    }

    const [created] = await db
      .insert(assignments)
      .values({
        classId,
        authorId: req.user!.id,
        title,
        description,
        maxPoints,
        dueAt,
        attachmentAssetId: confirmedAttachment?.id ?? null,
        attachmentUrl: confirmedAttachment ? storageRedirectPath(confirmedAttachment.id) : attachmentUrl,
        attachmentName: confirmedAttachment?.fileName ?? attachmentName,
        attachmentMimeType: confirmedAttachment?.mimeType ?? attachmentMimeType,
        attachmentSizeBytes: confirmedAttachment?.fileSizeBytes ?? attachmentSizeBytes,
      })
      .returning();
    if (created && confirmedAttachment) {
      await db.update(storageAssets)
        .set({ entityType: "assignment", entityId: String(created.id), updatedAt: new Date() })
        .where(eq(storageAssets.id, confirmedAttachment.id));
    }
    return res.status(201).json({ data: created });
  } catch (error) {
    console.error("POST /assignments error:", error);
    return res.status(500).json({ error: "Failed to create assignment" });
  }
});

router.post("/:id/submissions", requireAuth, requireRole(["student"]), async (req, res) => {
  try {
    const assignmentId = parseId(req.params.id);
    const content = textValue(req.body?.content, 20000);
    const attachmentUrl = textValue(req.body?.attachmentUrl, 2000) || null;
    const attachmentName = textValue(req.body?.attachmentName, 255) || null;
    const attachmentMimeType = textValue(req.body?.attachmentMimeType, 120) || null;
    const attachmentSizeBytes = Number.isInteger(Number(req.body?.attachmentSizeBytes)) ? Number(req.body.attachmentSizeBytes) : null;
    const attachmentAssetId = normalizeStorageAssetId(req.body?.attachmentAssetId);
    if (!assignmentId || !content) return res.status(400).json({ error: "Assignment id and submission content are required" });

    const assignment = await getAssignment(assignmentId);
    if (!assignment || !(await canAccessClass(assignment.classId, req.user!.id, "student"))) {
      return res.status(403).json({ error: "You cannot submit to this assignment" });
    }

    const confirmedAttachment = attachmentAssetId
      ? await getOwnedActiveAttachmentAsset({
        assetId: attachmentAssetId,
        ownerId: req.user!.id,
        assetKind: "submission_attachment",
        classId: assignment.classId,
        expectedEntityId: String(assignmentId),
      })
      : null;
    if (attachmentAssetId && !confirmedAttachment) {
      return res.status(422).json({ error: "The selected submission attachment is not active or is not authorized for this assignment" });
    }
    if (STORAGE_CONFIG.featureFlags.supabaseWritesEnabled && !confirmedAttachment && attachmentUrl) {
      return res.status(410).json({ error: "Direct submission attachment URLs are disabled after Supabase Storage cutover" });
    }

    const [existing] = await db
      .select({ id: submissions.id })
      .from(submissions)
      .where(and(eq(submissions.assignmentId, assignmentId), eq(submissions.studentId, req.user!.id)))
      .limit(1);

    const [saved] = existing
      ? await db.update(submissions).set({
        content,
        attachmentAssetId: confirmedAttachment?.id ?? null,
        attachmentUrl: confirmedAttachment ? storageRedirectPath(confirmedAttachment.id) : attachmentUrl,
        attachmentName: confirmedAttachment?.fileName ?? attachmentName,
        attachmentMimeType: confirmedAttachment?.mimeType ?? attachmentMimeType,
        attachmentSizeBytes: confirmedAttachment?.fileSizeBytes ?? attachmentSizeBytes,
        submittedAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(submissions.id, existing.id)).returning()
      : await db.insert(submissions).values({
        assignmentId,
        studentId: req.user!.id,
        content,
        attachmentAssetId: confirmedAttachment?.id ?? null,
        attachmentUrl: confirmedAttachment ? storageRedirectPath(confirmedAttachment.id) : attachmentUrl,
        attachmentName: confirmedAttachment?.fileName ?? attachmentName,
        attachmentMimeType: confirmedAttachment?.mimeType ?? attachmentMimeType,
        attachmentSizeBytes: confirmedAttachment?.fileSizeBytes ?? attachmentSizeBytes,
      }).returning();
    if (saved && confirmedAttachment) {
      await db.update(storageAssets)
        .set({ entityType: "submission", entityId: String(saved.id), updatedAt: new Date() })
        .where(eq(storageAssets.id, confirmedAttachment.id));
    }

    return res.status(existing ? 200 : 201).json({ data: saved });
  } catch (error) {
    console.error("POST /assignments/:id/submissions error:", error);
    return res.status(500).json({ error: "Failed to save submission" });
  }
});

router.get("/:id/submissions", requireAuth, async (req, res) => {
  try {
    const assignmentId = parseId(req.params.id);
    if (!assignmentId) return res.status(400).json({ error: "Invalid assignment id" });
    const assignment = await getAssignment(assignmentId);
    if (!assignment || !req.user || !(await canAccessClass(assignment.classId, req.user.id, req.user.role))) {
      return res.status(403).json({ error: "You do not have access to these submissions" });
    }

    const data = await db
      .select({
        id: submissions.id,
        assignmentId: submissions.assignmentId,
        studentId: submissions.studentId,
        content: submissions.content,
        submittedAt: submissions.submittedAt,
        grade: submissions.grade,
        feedback: submissions.feedback,
        attachmentUrl: submissions.attachmentUrl,
        attachmentName: submissions.attachmentName,
        attachmentMimeType: submissions.attachmentMimeType,
        attachmentSizeBytes: submissions.attachmentSizeBytes,
        attachmentAssetId: submissions.attachmentAssetId,
        student: { id: user.id, name: user.name, email: user.email, image: user.image },
      })
      .from(submissions)
      .innerJoin(user, eq(submissions.studentId, user.id))
      .where(and(eq(submissions.assignmentId, assignmentId), req.user.role === "student" ? eq(submissions.studentId, req.user.id) : undefined))
      .orderBy(desc(submissions.submittedAt));

    return res.json({ data });
  } catch (error) {
    console.error("GET /assignments/:id/submissions error:", error);
    return res.status(500).json({ error: "Failed to fetch submissions" });
  }
});

router.patch("/:assignmentId/submissions/:submissionId", requireAuth, requireRole(["teacher", "admin"]), async (req, res) => {
  try {
    const assignmentId = parseId(req.params.assignmentId);
    const submissionId = parseId(req.params.submissionId);
    const grade = Number(req.body?.grade);
    const feedback = typeof req.body?.feedback === "string" ? req.body.feedback.trim().slice(0, 5000) : null;
    if (!assignmentId || !submissionId || !Number.isInteger(grade) || grade < 0) return res.status(400).json({ error: "Valid assignment, submission, and grade are required" });

    const assignment = await getAssignment(assignmentId);
    if (!assignment || (req.user?.role === "teacher" && !(await canAccessClass(assignment.classId, req.user.id, "teacher")))) {
      return res.status(403).json({ error: "You cannot grade this assignment" });
    }
    if (grade > assignment.maxPoints) return res.status(400).json({ error: "Grade cannot exceed maxPoints" });

    const [updated] = await db.update(submissions).set({ grade, feedback, updatedAt: new Date() }).where(and(eq(submissions.id, submissionId), eq(submissions.assignmentId, assignmentId))).returning();
    if (!updated) return res.status(404).json({ error: "Submission not found" });
    return res.json({ data: updated });
  } catch (error) {
    console.error("PATCH /assignments submissions error:", error);
    return res.status(500).json({ error: "Failed to grade submission" });
  }
});

export default router;
