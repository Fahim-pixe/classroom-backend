export const STORAGE_PROVIDER_VALUES = ["cloudinary", "supabase"] as const;
export type StorageProvider = (typeof STORAGE_PROVIDER_VALUES)[number];

export const STORAGE_ASSET_KIND_VALUES = [
  "avatar",
  "class_banner",
  "resource",
  "assignment_attachment",
  "submission_attachment",
] as const;
export type StorageAssetKind = (typeof STORAGE_ASSET_KIND_VALUES)[number];

export const STORAGE_VISIBILITY_VALUES = ["private"] as const;
export type StorageVisibility = (typeof STORAGE_VISIBILITY_VALUES)[number];

export const STORAGE_ASSET_STATE_VALUES = ["pending", "active", "archived", "deleted"] as const;
export type StorageAssetState = (typeof STORAGE_ASSET_STATE_VALUES)[number];

export const STORAGE_MIGRATION_STATUS_VALUES = [
  "not_required",
  "pending",
  "in_progress",
  "migrated",
  "verified",
  "failed",
  "skipped",
] as const;
export type StorageMigrationStatus = (typeof STORAGE_MIGRATION_STATUS_VALUES)[number];

export const STORAGE_VERIFICATION_STATUS_VALUES = ["pending", "verified", "failed"] as const;
export type StorageVerificationStatus = (typeof STORAGE_VERIFICATION_STATUS_VALUES)[number];

export const STORAGE_UPLOAD_INTENT_STATUS_VALUES = ["pending", "completed", "expired", "cancelled"] as const;
export type StorageUploadIntentStatus = (typeof STORAGE_UPLOAD_INTENT_STATUS_VALUES)[number];

export type StorageObjectMetadata = {
  contentType: string | null;
  fileSizeBytes: number | null;
  updatedAt: Date | null;
  etag: string | null;
};

export type SignedUpload = {
  signedUrl: string;
  token: string;
  objectPath: string;
  expiresAt: Date;
};

export type CreateSignedUploadInput = {
  bucket: string;
  objectPath: string;
  expiresInSeconds: number;
  allowOverwrite?: boolean;
};

export type CreateSignedDownloadInput = {
  bucket: string;
  objectPath: string;
  expiresInSeconds: number;
  downloadFileName?: string;
};

export type UploadObjectInput = {
  bucket: string;
  objectPath: string;
  body: Uint8Array;
  contentType: string;
  cacheControlSeconds: number;
  allowOverwrite?: boolean;
};

export type DownloadedObject = {
  body: Uint8Array;
  contentType: string | null;
  fileSizeBytes: number | null;
};

export interface StorageService {
  isConfigured(): boolean;
  createSignedUpload(input: CreateSignedUploadInput): Promise<SignedUpload>;
  createSignedDownloadUrl(input: CreateSignedDownloadInput): Promise<string>;
  upload(input: UploadObjectInput): Promise<void>;
  download(bucket: string, objectPath: string): Promise<DownloadedObject>;
  getMetadata(bucket: string, objectPath: string): Promise<StorageObjectMetadata | null>;
  exists(bucket: string, objectPath: string): Promise<boolean>;
  delete(bucket: string, objectPath: string): Promise<void>;
}

export class StorageConfigurationError extends Error {
  constructor(message = "Storage is not configured") {
    super(message);
    this.name = "StorageConfigurationError";
  }
}

export class StorageProviderError extends Error {
  constructor(message: string, public readonly causeCode?: string) {
    super(message);
    this.name = "StorageProviderError";
  }
}
