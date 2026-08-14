import crypto from "node:crypto";
import express from "express";
import { and, eq } from "drizzle-orm";
import { STORAGE_CONFIG } from "../config/app.js";
import { db } from "../db/index.js";
import { storageAssets, storageMigrationEvents, storageUploadIntents } from "../db/schema/index.js";
import { requireAuth } from "../middleware/auth.js";
import { authorizeAssetRead, authorizeUpload, StorageAuthorizationError } from "../services/storage/storage-policy.service.js";
import { bucketForAssetKind, createStorageObjectPath, sanitizeStorageFileName } from "../services/storage/storage-paths.js";
import { supabaseStorageService } from "../services/storage/supabase-storage.service.js";
import {
  STORAGE_ASSET_KIND_VALUES,
  type StorageAssetKind,
  StorageConfigurationError,
  StorageProviderError,
} from "../services/storage/storage.types.js";

const router = express.Router();

const entityTypesByAssetKind: Record<StorageAssetKind, string> = {
  avatar: "user",
  class_banner: "class",
  resource: "resource",
  assignment_attachment: "assignment",
  submission_attachment: "submission",
};

const uploadPolicyByAssetKind = {
  avatar: {
    maximumBytes: STORAGE_CONFIG.uploads.maximumBytesByKind.avatar,
    allowedMimeTypes: STORAGE_CONFIG.uploads.allowedMimeTypesByKind.avatar,
  },
  class_banner: {
    maximumBytes: STORAGE_CONFIG.uploads.maximumBytesByKind.classBanner,
    allowedMimeTypes: STORAGE_CONFIG.uploads.allowedMimeTypesByKind.classBanner,
  },
  resource: {
    maximumBytes: STORAGE_CONFIG.uploads.maximumBytesByKind.resource,
    allowedMimeTypes: STORAGE_CONFIG.uploads.allowedMimeTypesByKind.resource,
  },
  assignment_attachment: {
    maximumBytes: STORAGE_CONFIG.uploads.maximumBytesByKind.assignmentAttachment,
    allowedMimeTypes: STORAGE_CONFIG.uploads.allowedMimeTypesByKind.assignmentAttachment,
  },
  submission_attachment: {
    maximumBytes: STORAGE_CONFIG.uploads.maximumBytesByKind.submissionAttachment,
    allowedMimeTypes: STORAGE_CONFIG.uploads.allowedMimeTypesByKind.submissionAttachment,
  },
} as const;

const parseAssetKind = (value: unknown): StorageAssetKind | null =>
  typeof value === "string" && (STORAGE_ASSET_KIND_VALUES as readonly string[]).includes(value)
    ? value as StorageAssetKind
    : null;

const parseOptionalPositiveInteger = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const numberValue = Number(value);
  return Number.isInteger(numberValue) && numberValue > 0 ? numberValue : null;
};

const parseUploadSize = (value: unknown): number | null => {
  const numberValue = Number(value);
  return Number.isInteger(numberValue) && numberValue > 0 ? numberValue : null;
};

const normalizeRequestedFile = (body: Record<string, unknown>, assetKind: StorageAssetKind) => {
  const fileName = typeof body.fileName === "string" ? sanitizeStorageFileName(body.fileName) : "";
  const mimeType = typeof body.mimeType === "string" ? body.mimeType.trim().toLowerCase() : "";
  const fileSizeBytes = parseUploadSize(body.fileSizeBytes);
  const policy = uploadPolicyByAssetKind[assetKind];

  if (!fileName || !mimeType || !fileSizeBytes) {
    return { error: "fileName, mimeType, and fileSizeBytes are required" } as const;
  }
  if (!policy.allowedMimeTypes.includes(mimeType as never)) {
    return { error: "This file type is not permitted for the selected upload purpose" } as const;
  }
  if (fileSizeBytes > policy.maximumBytes) {
    return { error: "This file exceeds the configured size limit for the selected upload purpose" } as const;
  }

  return { fileName, mimeType, fileSizeBytes } as const;
};

const setSignedAccessCacheHeaders = (res: express.Response, expiresInSeconds: number) => {
  const cacheSeconds = Math.max(0, expiresInSeconds - STORAGE_CONFIG.signedUrlCacheSafetySeconds);
  res.setHeader("Cache-Control", `private, max-age=${cacheSeconds}, must-revalidate`);
  res.setHeader("Vary", "Cookie");
};

const respondStorageError = (res: express.Response, error: unknown, fallbackMessage: string) => {
  if (error instanceof StorageAuthorizationError) {
    return res.status(403).json({ error: error.message });
  }
  if (error instanceof StorageConfigurationError) {
    return res.status(503).json({ error: "Storage is temporarily unavailable" });
  }
  if (error instanceof StorageProviderError) {
    console.error("Storage provider error:", error.message);
    return res.status(502).json({ error: "Storage provider request failed" });
  }
  console.error(fallbackMessage, error);
  return res.status(500).json({ error: fallbackMessage });
};

router.post(STORAGE_CONFIG.routePaths.uploadIntents, requireAuth, async (req, res) => {
  try {
    if (!supabaseStorageService.isConfigured()) {
      return res.status(503).json({ error: "Supabase storage uploads are not configured" });
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const assetKind = parseAssetKind(body.assetKind);
    if (!assetKind) return res.status(400).json({ error: "A supported assetKind is required" });

    const normalizedFile = normalizeRequestedFile(body, assetKind);
    if ("error" in normalizedFile) return res.status(400).json({ error: normalizedFile.error });

    const classId = parseOptionalPositiveInteger(body.classId);
    const requestedEntityId = body.entityId === null || body.entityId === undefined || body.entityId === ""
      ? null
      : String(body.entityId);
    const entityType = entityTypesByAssetKind[assetKind];
    const entityId = assetKind === "avatar" ? req.user!.id : requestedEntityId;

    await authorizeUpload(req.user!, { assetKind, classId, entityType, entityId });

    const intentId = crypto.randomUUID();
    const bucket = bucketForAssetKind(assetKind);
    const objectPath = createStorageObjectPath({
      assetKind,
      ownerId: req.user!.id,
      classId,
      entityId,
      originalFileName: normalizedFile.fileName,
      uploadIntentId: intentId,
    });
    const expiresAt = new Date(Date.now() + STORAGE_CONFIG.signedUrlTtlSeconds.uploadIntent * 1000);
    const signedUpload = await supabaseStorageService.createSignedUpload({
      bucket,
      objectPath,
      expiresInSeconds: STORAGE_CONFIG.signedUrlTtlSeconds.uploadIntent,
      allowOverwrite: false,
    });

    await db.insert(storageUploadIntents).values({
      id: intentId,
      assetKind,
      ownerId: req.user!.id,
      classId,
      entityType,
      entityId,
      bucket,
      objectPath,
      fileName: normalizedFile.fileName,
      requestedMimeType: normalizedFile.mimeType,
      requestedFileSizeBytes: normalizedFile.fileSizeBytes,
      expiresAt,
    });

    return res.status(201).json({
      data: {
        uploadIntentId: intentId,
        signedUploadUrl: signedUpload.signedUrl,
        uploadToken: signedUpload.token,
        objectPath,
        expiresAt: expiresAt.toISOString(),
        requiredHeaders: { "content-type": normalizedFile.mimeType },
      },
    });
  } catch (error) {
    return respondStorageError(res, error, "Failed to create an upload intent");
  }
});

router.post(STORAGE_CONFIG.routePaths.uploadIntentConfirm, requireAuth, async (req, res) => {
  try {
    const intentId = typeof req.params.intentId === "string" ? req.params.intentId : "";
    if (!intentId) return res.status(400).json({ error: "A valid upload intent is required" });
    const [intent] = await db
      .select()
      .from(storageUploadIntents)
      .where(and(eq(storageUploadIntents.id, intentId), eq(storageUploadIntents.ownerId, req.user!.id)))
      .limit(1);

    if (!intent) return res.status(404).json({ error: "Upload intent not found" });
    if (intent.status !== "pending") return res.status(409).json({ error: "Upload intent is no longer pending" });
    if (intent.expiresAt.getTime() < Date.now()) {
      await db.update(storageUploadIntents).set({ status: "expired", updatedAt: new Date() }).where(eq(storageUploadIntents.id, intent.id));
      return res.status(410).json({ error: "Upload intent has expired" });
    }

    const metadata = await supabaseStorageService.getMetadata(intent.bucket, intent.objectPath);
    const policy = uploadPolicyByAssetKind[intent.assetKind];
    if (!metadata?.contentType || !metadata.fileSizeBytes) {
      return res.status(422).json({ error: "Uploaded object metadata is unavailable" });
    }
    if (metadata.contentType.toLowerCase() !== intent.requestedMimeType || !policy.allowedMimeTypes.includes(metadata.contentType.toLowerCase() as never)) {
      return res.status(422).json({ error: "Uploaded object type does not match the authorized upload" });
    }
    if (metadata.fileSizeBytes > policy.maximumBytes || metadata.fileSizeBytes > intent.requestedFileSizeBytes) {
      return res.status(422).json({ error: "Uploaded object exceeds the authorized size" });
    }

    const [asset] = await db.insert(storageAssets).values({
      assetKind: intent.assetKind,
      entityType: intent.entityType,
      entityId: intent.entityId,
      ownerId: intent.ownerId,
      classId: intent.classId,
      storageProvider: STORAGE_CONFIG.provider,
      bucket: intent.bucket,
      objectPath: intent.objectPath,
      fileName: intent.fileName,
      mimeType: metadata.contentType,
      fileSizeBytes: metadata.fileSizeBytes,
      visibility: STORAGE_CONFIG.visibility.private,
      state: "active",
      migrationStatus: "not_required",
      verificationStatus: "verified",
      verifiedAt: new Date(),
    }).returning();

    if (!asset) return res.status(500).json({ error: "Storage asset could not be recorded" });

    await db.update(storageUploadIntents)
      .set({ status: "completed", completedAssetId: asset.id, updatedAt: new Date() })
      .where(eq(storageUploadIntents.id, intent.id));
    await db.insert(storageMigrationEvents).values({
      assetId: asset.id,
      eventName: "upload_confirmed",
      details: { objectPath: intent.objectPath, provider: STORAGE_CONFIG.provider },
    });

    return res.status(201).json({ data: asset });
  } catch (error) {
    return respondStorageError(res, error, "Failed to confirm uploaded object");
  }
});

router.post(STORAGE_CONFIG.routePaths.uploadIntentCancel, requireAuth, async (req, res) => {
  try {
    const intentId = typeof req.params.intentId === "string" ? req.params.intentId : "";
    if (!intentId) return res.status(400).json({ error: "A valid upload intent is required" });
    const [intent] = await db.select().from(storageUploadIntents).where(and(
      eq(storageUploadIntents.id, intentId),
      eq(storageUploadIntents.ownerId, req.user!.id),
    )).limit(1);
    if (!intent) return res.status(404).json({ error: "Upload intent not found" });
    if (intent.status !== "pending") return res.status(409).json({ error: "Upload intent is no longer pending" });

    await db.update(storageUploadIntents)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(eq(storageUploadIntents.id, intent.id));
    return res.status(204).send();
  } catch (error) {
    return respondStorageError(res, error, "Failed to cancel upload intent");
  }
});

router.get(STORAGE_CONFIG.routePaths.redirectByAssetId, requireAuth, async (req, res) => {
  try {
    const assetId = typeof req.params.assetId === "string" ? req.params.assetId : "";
    if (!assetId) return res.status(400).json({ error: "A valid storage asset is required" });
    const [asset] = await db
      .select()
      .from(storageAssets)
      .where(and(eq(storageAssets.id, assetId), eq(storageAssets.state, "active")))
      .limit(1);
    if (!asset) return res.status(404).json({ error: "Storage asset not found" });
    if (asset.storageProvider !== STORAGE_CONFIG.provider || !asset.bucket || !asset.objectPath) {
      return res.status(409).json({ error: "This asset has not completed the Supabase Storage transition" });
    }

    await authorizeAssetRead(req.user!, asset);
    const url = await supabaseStorageService.createSignedDownloadUrl({
      bucket: asset.bucket,
      objectPath: asset.objectPath,
      expiresInSeconds: STORAGE_CONFIG.signedUrlTtlSeconds.preview,
    });
    await db.insert(storageMigrationEvents).values({
      assetId: asset.id,
      eventName: "signed_redirect_issued",
      details: { expiresInSeconds: STORAGE_CONFIG.signedUrlTtlSeconds.preview, actorId: req.user!.id },
    });

    res.setHeader("Cache-Control", "private, no-store");
    return res.redirect(302, url);
  } catch (error) {
    return respondStorageError(res, error, "Failed to create a storage asset redirect");
  }
});

router.get(STORAGE_CONFIG.routePaths.accessByAssetId, requireAuth, async (req, res) => {
  try {
    const assetId = typeof req.params.assetId === "string" ? req.params.assetId : "";
    if (!assetId) return res.status(400).json({ error: "A valid storage asset is required" });
    const [asset] = await db
      .select()
      .from(storageAssets)
      .where(and(eq(storageAssets.id, assetId), eq(storageAssets.state, "active")))
      .limit(1);
    if (!asset) return res.status(404).json({ error: "Storage asset not found" });
    if (asset.storageProvider !== STORAGE_CONFIG.provider || !asset.bucket || !asset.objectPath) {
      return res.status(409).json({ error: "This asset has not completed the Supabase Storage transition" });
    }

    await authorizeAssetRead(req.user!, asset);
    const requestedMode = req.query.mode === STORAGE_CONFIG.accessModes.download
      ? STORAGE_CONFIG.accessModes.download
      : STORAGE_CONFIG.accessModes.preview;
    const expiresInSeconds = requestedMode === STORAGE_CONFIG.accessModes.download
      ? STORAGE_CONFIG.signedUrlTtlSeconds.download
      : STORAGE_CONFIG.signedUrlTtlSeconds.preview;
    const downloadOptions = requestedMode === STORAGE_CONFIG.accessModes.download
      ? { downloadFileName: asset.fileName }
      : {};
    const url = await supabaseStorageService.createSignedDownloadUrl({
      bucket: asset.bucket,
      objectPath: asset.objectPath,
      expiresInSeconds,
      ...downloadOptions,
    });

    await db.insert(storageMigrationEvents).values({
      assetId: asset.id,
      eventName: "signed_access_issued",
      details: { mode: requestedMode, expiresInSeconds, actorId: req.user!.id },
    });

    setSignedAccessCacheHeaders(res, expiresInSeconds);
    return res.json({
      data: {
        url,
        mode: requestedMode,
        expiresAt: new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
      },
    });
  } catch (error) {
    return respondStorageError(res, error, "Failed to create storage access URL");
  }
});

export default router;
