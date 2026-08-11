import "dotenv/config";
import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../src/db/index.js";
import {
  assignments,
  classes,
  resources,
  storageAssets,
  storageMigrationEvents,
  submissions,
  user,
  userStorageAssets,
} from "../src/db/schema/index.js";
import { API_PATHS, STORAGE_CONFIG } from "../src/config/app.js";
import { bucketForAssetKind, createStorageObjectPath, sanitizeStorageFileName } from "../src/services/storage/storage-paths.js";
import { supabaseStorageService } from "../src/services/storage/supabase-storage.service.js";
import type { StorageAssetKind } from "../src/services/storage/storage.types.js";

type MigrationMode = "dry-run" | "apply";

type LegacyAssetCandidate = {
  assetKind: StorageAssetKind;
  entityType: "user" | "class" | "resource" | "assignment" | "submission";
  entityId: string;
  ownerId: string;
  classId: number | null;
  sourceUrl: string;
  sourceIdentifier: string | null;
  fileName: string;
  expectedMimeType: string | null;
};

type MigrationReport = {
  mode: MigrationMode;
  discovered: number;
  skipped: number;
  migrated: number;
  failed: number;
  candidatesByKind: Partial<Record<StorageAssetKind, number>>;
  failures: Array<{ entityType: string; entityId: string; sourceUrl: string; error: string }>;
};

const commandArguments = new Set(process.argv.slice(2));
const hasFlag = (flag: string) => commandArguments.has(flag);
const valueAfter = (flag: string) => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

const requestedLimit = Number(valueAfter("--limit") ?? STORAGE_CONFIG.migration.defaultBatchSize);
const requestedOffset = Number(valueAfter("--offset") ?? 0);
const sourceOffset = Math.max(0, Number.isInteger(requestedOffset) ? requestedOffset : 0);
const batchLimit = Math.min(
  Math.max(1, Number.isInteger(requestedLimit) ? requestedLimit : STORAGE_CONFIG.migration.defaultBatchSize),
  STORAGE_CONFIG.migration.maximumBatchSize,
);
const mode: MigrationMode = hasFlag("--apply") ? "apply" : "dry-run";
const retryFailed = hasFlag("--retry-failed");
const assetKindFilter = valueAfter("--asset-kind") as StorageAssetKind | undefined;
const allowedAssetKinds = new Set<StorageAssetKind>([
  "avatar",
  "class_banner",
  "resource",
  "assignment_attachment",
  "submission_attachment",
]);

if (assetKindFilter && !allowedAssetKinds.has(assetKindFilter)) {
  throw new Error("--asset-kind must be a supported storage asset kind");
}
if (mode === "apply" && !supabaseStorageService.isConfigured()) {
  throw new Error("Refusing to apply: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
}

const hasLegacyUrl = (url: string | null | undefined) => Boolean(url && /^https?:\/\//i.test(url));
const inferFileName = (url: string, fallback: string) => {
  try {
    const lastSegment = new URL(url).pathname.split("/").filter(Boolean).pop();
    return sanitizeStorageFileName(decodeURIComponent(lastSegment ?? fallback));
  } catch {
    return sanitizeStorageFileName(fallback);
  }
};
const sourceContentType = (header: string | null, fallback: string | null) =>
  (header?.split(";", 1)[0]?.trim().toLowerCase() || fallback || "application/octet-stream").toLowerCase();
const maximumBytesFor = (assetKind: StorageAssetKind) => {
  const { maximumBytesByKind } = STORAGE_CONFIG.uploads;
  switch (assetKind) {
    case "avatar": return maximumBytesByKind.avatar;
    case "class_banner": return maximumBytesByKind.classBanner;
    case "resource": return maximumBytesByKind.resource;
    case "assignment_attachment": return maximumBytesByKind.assignmentAttachment;
    case "submission_attachment": return maximumBytesByKind.submissionAttachment;
  }
};
const allowedMimeTypesFor = (assetKind: StorageAssetKind) => {
  const { allowedMimeTypesByKind } = STORAGE_CONFIG.uploads;
  switch (assetKind) {
    case "avatar": return allowedMimeTypesByKind.avatar;
    case "class_banner": return allowedMimeTypesByKind.classBanner;
    case "resource": return allowedMimeTypesByKind.resource;
    case "assignment_attachment": return allowedMimeTypesByKind.assignmentAttachment;
    case "submission_attachment": return allowedMimeTypesByKind.submissionAttachment;
  }
};

async function listLegacyCandidates(limit: number): Promise<LegacyAssetCandidate[]> {
  const candidates: LegacyAssetCandidate[] = [];
  const [users, classRows, resourceRows, assignmentRows, submissionRows] = await Promise.all([
    db.select({ id: user.id, image: user.image, imageCldPubId: user.imageCldPubId }).from(user).limit(limit).offset(sourceOffset),
    db.select({ id: classes.id, teacherId: classes.teacherId, bannerUrl: classes.bannerUrl, bannerCldPubId: classes.bannerCldPubId }).from(classes).limit(limit).offset(sourceOffset),
    db.select({ id: resources.id, ownerId: resources.ownerId, classId: resources.classId, resourceUrl: resources.resourceUrl, mimeType: resources.mimeType }).from(resources).limit(limit).offset(sourceOffset),
    db.select({ id: assignments.id, authorId: assignments.authorId, classId: assignments.classId, attachmentUrl: assignments.attachmentUrl, attachmentName: assignments.attachmentName, attachmentMimeType: assignments.attachmentMimeType }).from(assignments).limit(limit).offset(sourceOffset),
    db.select({ id: submissions.id, studentId: submissions.studentId, assignmentId: submissions.assignmentId, attachmentUrl: submissions.attachmentUrl, attachmentName: submissions.attachmentName, attachmentMimeType: submissions.attachmentMimeType, classId: assignments.classId }).from(submissions).innerJoin(assignments, eq(submissions.assignmentId, assignments.id)).limit(limit).offset(sourceOffset),
  ]);

  for (const row of users) {
    if (hasLegacyUrl(row.image)) candidates.push({ assetKind: "avatar", entityType: "user", entityId: row.id, ownerId: row.id, classId: null, sourceUrl: row.image!, sourceIdentifier: row.imageCldPubId, fileName: inferFileName(row.image!, "avatar"), expectedMimeType: null });
  }
  for (const row of classRows) {
    if (hasLegacyUrl(row.bannerUrl)) candidates.push({ assetKind: "class_banner", entityType: "class", entityId: String(row.id), ownerId: row.teacherId, classId: row.id, sourceUrl: row.bannerUrl!, sourceIdentifier: row.bannerCldPubId, fileName: inferFileName(row.bannerUrl!, `class-${row.id}-banner`), expectedMimeType: null });
  }
  for (const row of resourceRows) {
    if (hasLegacyUrl(row.resourceUrl)) candidates.push({ assetKind: "resource", entityType: "resource", entityId: String(row.id), ownerId: row.ownerId, classId: row.classId, sourceUrl: row.resourceUrl, sourceIdentifier: null, fileName: inferFileName(row.resourceUrl, `resource-${row.id}`), expectedMimeType: row.mimeType });
  }
  for (const row of assignmentRows) {
    if (hasLegacyUrl(row.attachmentUrl)) candidates.push({ assetKind: "assignment_attachment", entityType: "assignment", entityId: String(row.id), ownerId: row.authorId, classId: row.classId, sourceUrl: row.attachmentUrl!, sourceIdentifier: null, fileName: sanitizeStorageFileName(row.attachmentName || inferFileName(row.attachmentUrl!, `assignment-${row.id}`)), expectedMimeType: row.attachmentMimeType });
  }
  for (const row of submissionRows) {
    if (hasLegacyUrl(row.attachmentUrl)) candidates.push({ assetKind: "submission_attachment", entityType: "submission", entityId: String(row.id), ownerId: row.studentId, classId: row.classId, sourceUrl: row.attachmentUrl!, sourceIdentifier: null, fileName: sanitizeStorageFileName(row.attachmentName || inferFileName(row.attachmentUrl!, `submission-${row.id}`)), expectedMimeType: row.attachmentMimeType });
  }

  return candidates.filter((candidate) => !assetKindFilter || candidate.assetKind === assetKindFilter).slice(0, limit);
}

async function findExistingAsset(candidate: LegacyAssetCandidate) {
  const [existing] = await db.select().from(storageAssets).where(and(
    eq(storageAssets.assetKind, candidate.assetKind),
    eq(storageAssets.entityType, candidate.entityType),
    eq(storageAssets.entityId, candidate.entityId),
    eq(storageAssets.sourceUrl, candidate.sourceUrl),
  )).limit(1);
  return existing ?? null;
}

const storageRedirectPath = (assetId: string) =>
  `${API_PATHS.prefixed.storage}${STORAGE_CONFIG.routePaths.redirectByAssetId.replace(":assetId", assetId)}`;

async function linkMigratedAsset(candidate: LegacyAssetCandidate, assetId: string) {
  const redirectPath = storageRedirectPath(assetId);
  switch (candidate.entityType) {
    case "user":
      await db.insert(userStorageAssets).values({ userId: candidate.entityId, avatarAssetId: assetId }).onConflictDoUpdate({
        target: userStorageAssets.userId,
        set: { avatarAssetId: assetId, updatedAt: new Date() },
      });
      await db.update(user).set({ image: redirectPath, updatedAt: new Date() }).where(eq(user.id, candidate.entityId));
      break;
    case "class":
      await db.update(classes).set({ bannerAssetId: assetId, bannerUrl: redirectPath, updatedAt: new Date() }).where(eq(classes.id, Number(candidate.entityId)));
      break;
    case "resource":
      await db.update(resources).set({ storageAssetId: assetId, resourceUrl: redirectPath, updatedAt: new Date() }).where(eq(resources.id, Number(candidate.entityId)));
      break;
    case "assignment":
      await db.update(assignments).set({ attachmentAssetId: assetId, attachmentUrl: redirectPath, updatedAt: new Date() }).where(eq(assignments.id, Number(candidate.entityId)));
      break;
    case "submission":
      await db.update(submissions).set({ attachmentAssetId: assetId, attachmentUrl: redirectPath, updatedAt: new Date() }).where(eq(submissions.id, Number(candidate.entityId)));
      break;
  }
}

async function migrateCandidate(candidate: LegacyAssetCandidate, report: MigrationReport) {
  const existing = await findExistingAsset(candidate);
  if (existing?.migrationStatus === "verified" && existing.state === "active") {
    report.skipped += 1;
    return;
  }
  if (existing?.migrationStatus === "failed" && !retryFailed) {
    report.skipped += 1;
    return;
  }
  if (mode === "dry-run") return;

  const bucket = bucketForAssetKind(candidate.assetKind);
  const asset = existing ?? (await db.insert(storageAssets).values({
    assetKind: candidate.assetKind,
    entityType: candidate.entityType,
    entityId: candidate.entityId,
    ownerId: candidate.ownerId,
    classId: candidate.classId,
    storageProvider: STORAGE_CONFIG.provider,
    bucket,
    objectPath: null,
    sourceProvider: "cloudinary",
    sourceIdentifier: candidate.sourceIdentifier,
    sourceUrl: candidate.sourceUrl,
    fileName: candidate.fileName,
    visibility: STORAGE_CONFIG.visibility.private,
    state: "pending",
    migrationStatus: "pending",
    verificationStatus: "pending",
  }).returning())[0];

  if (!asset) throw new Error("Migration asset record could not be created");
  const objectPath = asset.objectPath ?? createStorageObjectPath({
    assetKind: candidate.assetKind,
    ownerId: candidate.ownerId,
    classId: candidate.classId,
    entityId: candidate.entityId,
    originalFileName: candidate.fileName,
    uploadIntentId: asset.id,
  });
  const attempt = (asset.migrationAttempts ?? 0) + 1;
  await db.update(storageAssets).set({ objectPath, bucket, migrationStatus: "in_progress", migrationAttempts: attempt, lastError: null, updatedAt: new Date() }).where(eq(storageAssets.id, asset.id));
  await db.insert(storageMigrationEvents).values({ assetId: asset.id, eventName: "migration_started", attempt, details: { sourceUrl: candidate.sourceUrl, objectPath } });

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    const response = await fetch(candidate.sourceUrl, { signal: controller.signal, redirect: "follow" });
    clearTimeout(timeout);
    if (!response.ok) throw new Error(`Legacy download failed with HTTP ${response.status}`);
    const contentLength = Number(response.headers.get("content-length") ?? 0);
    const maximumBytes = maximumBytesFor(candidate.assetKind);
    if (contentLength && contentLength > maximumBytes) throw new Error("Legacy object exceeds the configured destination limit");
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.byteLength) throw new Error("Legacy object download was empty");
    if (buffer.byteLength > maximumBytes) throw new Error("Legacy object exceeds the configured destination limit");
    const mimeType = sourceContentType(response.headers.get("content-type"), candidate.expectedMimeType);
    if (!allowedMimeTypesFor(candidate.assetKind).includes(mimeType as never)) {
      throw new Error(`Legacy object MIME type ${mimeType} is not permitted for ${candidate.assetKind}`);
    }
    const checksumSha256 = crypto.createHash("sha256").update(buffer).digest("hex");
    await supabaseStorageService.upload({ bucket, objectPath, body: buffer, contentType: mimeType, cacheControlSeconds: STORAGE_CONFIG.objectPathPolicy.cacheControlSeconds, allowOverwrite: false });
    const metadata = await supabaseStorageService.getMetadata(bucket, objectPath);
    if (!metadata || metadata.fileSizeBytes !== buffer.byteLength) throw new Error("Destination verification failed: object size mismatch");
    await db.update(storageAssets).set({
      objectPath,
      bucket,
      mimeType,
      fileSizeBytes: buffer.byteLength,
      checksumSha256,
      state: "active",
      migrationStatus: "verified",
      verificationStatus: "verified",
      verifiedAt: new Date(),
      lastError: null,
      updatedAt: new Date(),
    }).where(eq(storageAssets.id, asset.id));
    await linkMigratedAsset(candidate, asset.id);
    await db.insert(storageMigrationEvents).values({ assetId: asset.id, eventName: "migration_verified", attempt, details: { objectPath, byteLength: buffer.byteLength, checksumSha256 } });
    report.migrated += 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown migration error";
    await db.update(storageAssets).set({ migrationStatus: "failed", verificationStatus: "failed", lastError: message, updatedAt: new Date() }).where(eq(storageAssets.id, asset.id));
    await db.insert(storageMigrationEvents).values({ assetId: asset.id, eventName: "migration_failed", severity: "error", attempt, details: { message } });
    report.failed += 1;
    report.failures.push({ entityType: candidate.entityType, entityId: candidate.entityId, sourceUrl: candidate.sourceUrl, error: message });
  }
}

async function main() {
  const candidates = await listLegacyCandidates(batchLimit);
  const report: MigrationReport = {
    mode,
    discovered: candidates.length,
    skipped: 0,
    migrated: 0,
    failed: 0,
    candidatesByKind: {},
    failures: [],
  };
  for (const candidate of candidates) {
    report.candidatesByKind[candidate.assetKind] = (report.candidatesByKind[candidate.assetKind] ?? 0) + 1;
    await migrateCandidate(candidate, report);
  }
  console.log(JSON.stringify({ ...report, sourceOffset, nextOffset: sourceOffset + batchLimit, assetKindFilter: assetKindFilter ?? "all" }, null, 2));
  if (report.failed > 0) process.exitCode = 1;
}

void main().catch((error) => {
  console.error("Storage migration command failed:", error);
  process.exitCode = 1;
});
