import { and, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { assignments, classes, enrollments, resources, submissions, userStorageAssets } from "../../db/schema/index.js";
import type { User } from "../../db/schema/index.js";
import type { StorageAssetKind } from "./storage.types.js";

export type StorageActor = Pick<User, "id" | "role">;

export type UploadAuthorizationInput = {
  assetKind: StorageAssetKind;
  classId: number | null;
  entityType: string;
  entityId: string | null;
};

export class StorageAuthorizationError extends Error {
  constructor(message = "You do not have permission to access this storage asset") {
    super(message);
    this.name = "StorageAuthorizationError";
  }
}

const isAdministrator = (actor: StorageActor) => actor.role === "admin";

const isClassTeacher = async (actor: StorageActor, classId: number): Promise<boolean> => {
  if (isAdministrator(actor)) return true;
  if (actor.role !== "teacher") return false;
  const [classRecord] = await db
    .select({ id: classes.id })
    .from(classes)
    .where(and(eq(classes.id, classId), eq(classes.teacherId, actor.id)))
    .limit(1);
  return Boolean(classRecord);
};

const isEnrolledInClass = async (actor: StorageActor, classId: number): Promise<boolean> => {
  if (isAdministrator(actor) || actor.role === "teacher") return isClassTeacher(actor, classId);
  const [enrollment] = await db
    .select({ id: enrollments.id })
    .from(enrollments)
    .where(and(eq(enrollments.classId, classId), eq(enrollments.studentId, actor.id)))
    .limit(1);
  return Boolean(enrollment);
};

const parseEntityId = (entityId: string | null, expectedName: string): number => {
  const value = Number(entityId);
  if (!Number.isInteger(value) || value < 1) {
    throw new StorageAuthorizationError(`${expectedName} is required for this upload`);
  }
  return value;
};

export const authorizeUpload = async (actor: StorageActor, input: UploadAuthorizationInput): Promise<void> => {
  if (input.assetKind === "avatar") {
    if (input.entityType !== "user" || (input.entityId && input.entityId !== actor.id)) {
      throw new StorageAuthorizationError("You can only upload an avatar for your own account");
    }
    return;
  }

  if (input.assetKind === "class_banner" && !input.classId) {
    if (actor.role !== "teacher" && !isAdministrator(actor)) {
      throw new StorageAuthorizationError("Only teachers and administrators can prepare a class banner");
    }
    return;
  }

  if (!input.classId || !Number.isInteger(input.classId)) {
    throw new StorageAuthorizationError("A valid class is required for this upload");
  }

  if (input.assetKind === "class_banner" || input.assetKind === "resource" || input.assetKind === "assignment_attachment") {
    if (!await isClassTeacher(actor, input.classId)) {
      throw new StorageAuthorizationError("You can only upload materials for classes you teach");
    }
    return;
  }

  if (input.assetKind === "submission_attachment") {
    const assignmentId = parseEntityId(input.entityId, "Assignment");
    const [assignment] = await db
      .select({ classId: assignments.classId })
      .from(assignments)
      .where(eq(assignments.id, assignmentId))
      .limit(1);

    if (!assignment || assignment.classId !== input.classId) {
      throw new StorageAuthorizationError("The submission attachment does not match the selected class");
    }

    if (!await isEnrolledInClass(actor, input.classId)) {
      throw new StorageAuthorizationError("You are not enrolled in this class");
    }
  }
};

export type StorageAssetReadContext = {
  id: string;
  assetKind: StorageAssetKind;
  entityType: string;
  entityId: string | null;
  ownerId: string;
  classId: number | null;
};

export const authorizeAssetRead = async (actor: StorageActor, asset: StorageAssetReadContext): Promise<void> => {
  if (asset.assetKind === "avatar") {
    const [linkedAvatar] = await db.select({ userId: userStorageAssets.userId })
      .from(userStorageAssets)
      .where(eq(userStorageAssets.avatarAssetId, asset.id))
      .limit(1);
    if (!linkedAvatar) throw new StorageAuthorizationError();
    return;
  }
  if (isAdministrator(actor)) return;

  if (asset.assetKind === "submission_attachment") {
    const submissionId = parseEntityId(asset.entityId, "Submission");
    const [submission] = await db
      .select({ studentId: submissions.studentId, classId: assignments.classId, teacherId: classes.teacherId })
      .from(submissions)
      .innerJoin(assignments, eq(submissions.assignmentId, assignments.id))
      .innerJoin(classes, eq(assignments.classId, classes.id))
      .where(eq(submissions.id, submissionId))
      .limit(1);

    if (!submission || (submission.studentId !== actor.id && submission.teacherId !== actor.id)) {
      throw new StorageAuthorizationError();
    }
    return;
  }

  if (!asset.classId || !await isEnrolledInClass(actor, asset.classId)) {
    throw new StorageAuthorizationError();
  }

  if (asset.assetKind === "resource" && actor.role === "student") {
    const resourceId = parseEntityId(asset.entityId, "Resource");
    const [resource] = await db
      .select({ isPublished: resources.isPublished, isArchived: resources.isArchived })
      .from(resources)
      .where(eq(resources.id, resourceId))
      .limit(1);
    if (!resource || !resource.isPublished || resource.isArchived) {
      throw new StorageAuthorizationError();
    }
  }
};
