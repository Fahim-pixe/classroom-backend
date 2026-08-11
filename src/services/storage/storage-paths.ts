import crypto from "node:crypto";
import { STORAGE_CONFIG } from "../../config/app.js";
import type { StorageAssetKind } from "./storage.types.js";

const UNSAFE_PATH_CHARACTERS = /[\\/\u0000-\u001F\u007F]+/g;
const UNSAFE_FILE_CHARACTERS = /[^a-zA-Z0-9._-]+/g;
const REPEATED_SEPARATOR = /[-_.]{2,}/g;
const LEADING_OR_TRAILING_SEPARATOR = /^[-_.]+|[-_.]+$/g;

const fallbackFileName = "file";

export const sanitizeStorageFileName = (rawFileName: string): string => {
  const normalized = rawFileName
    .normalize("NFKC")
    .replace(UNSAFE_PATH_CHARACTERS, "-")
    .replace(UNSAFE_FILE_CHARACTERS, "-")
    .replace(REPEATED_SEPARATOR, "-")
    .replace(LEADING_OR_TRAILING_SEPARATOR, "");

  const limited = normalized.slice(0, STORAGE_CONFIG.objectPathPolicy.maximumFileNameLength);
  return limited || fallbackFileName;
};

const fileExtensionFor = (fileName: string): string => {
  const sanitized = sanitizeStorageFileName(fileName);
  const lastDotIndex = sanitized.lastIndexOf(".");
  if (lastDotIndex <= 0 || lastDotIndex === sanitized.length - 1) return "";
  return sanitized.slice(lastDotIndex).toLowerCase();
};

const newObjectId = () => crypto.randomUUID();

export const bucketForAssetKind = (assetKind: StorageAssetKind): string => {
  if (assetKind === "avatar") return STORAGE_CONFIG.supabase.buckets.avatars;
  return STORAGE_CONFIG.supabase.buckets.learningAssets;
};

export type StoragePathInput = {
  assetKind: StorageAssetKind;
  ownerId: string;
  classId?: number | null;
  entityId?: string | number | null;
  version?: number;
  originalFileName: string;
  uploadIntentId?: string;
};

export const createStorageObjectPath = (input: StoragePathInput): string => {
  const extension = fileExtensionFor(input.originalFileName);
  const safeFileName = sanitizeStorageFileName(input.originalFileName);
  const objectId = newObjectId();
  const version = Math.min(
    Math.max(1, Math.floor(input.version ?? 1)),
    STORAGE_CONFIG.objectPathPolicy.maximumVersion
  );

  if (input.assetKind === "avatar") {
    return `${input.ownerId}/${objectId}${extension}`;
  }

  const scopedEntity = input.entityId ?? input.uploadIntentId ?? objectId;
  const classScope = input.classId ?? "unscoped";
  const folderByKind: Record<Exclude<StorageAssetKind, "avatar">, string> = {
    class_banner: "class-banners",
    resource: "resources",
    assignment_attachment: "assignments",
    submission_attachment: "submissions",
  };

  return `${folderByKind[input.assetKind]}/${classScope}/${scopedEntity}/v${version}/${objectId}-${safeFileName}`;
};
