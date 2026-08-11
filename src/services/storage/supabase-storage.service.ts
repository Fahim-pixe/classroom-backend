import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { STORAGE_CONFIG } from "../../config/app.js";
import {
  type CreateSignedDownloadInput,
  type CreateSignedUploadInput,
  type DownloadedObject,
  type SignedUpload,
  type StorageObjectMetadata,
  type StorageService,
  StorageConfigurationError,
  StorageProviderError,
  type UploadObjectInput,
} from "./storage.types.js";

type StorageInfoResponse = {
  metadata?: {
    size?: number;
    mimetype?: string;
    cacheControl?: string;
  };
  updated_at?: string;
  last_accessed_at?: string;
  eTag?: string;
  etag?: string;
};

const assertStorageResponse = (error: { message: string; statusCode?: string | undefined } | null, operation: string) => {
  if (error) {
    throw new StorageProviderError(`${operation} failed: ${error.message}`, error.statusCode);
  }
};

export class SupabaseStorageService implements StorageService {
  private client: SupabaseClient | null = null;

  isConfigured(): boolean {
    return Boolean(STORAGE_CONFIG.supabase.url && STORAGE_CONFIG.supabase.serviceRoleKey);
  }

  private getClient(): SupabaseClient {
    if (!this.isConfigured()) {
      throw new StorageConfigurationError("Supabase Storage credentials are not configured");
    }

    if (!this.client) {
      this.client = createClient(STORAGE_CONFIG.supabase.url, STORAGE_CONFIG.supabase.serviceRoleKey, {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
          detectSessionInUrl: false,
        },
      });
    }

    return this.client;
  }

  async createSignedUpload(input: CreateSignedUploadInput): Promise<SignedUpload> {
    const { data, error } = await this.getClient()
      .storage
      .from(input.bucket)
      .createSignedUploadUrl(input.objectPath, { upsert: input.allowOverwrite === true });
    assertStorageResponse(error, "Creating signed upload URL");

    if (!data?.signedUrl || !data.token) {
      throw new StorageProviderError("Supabase did not return a complete signed upload capability");
    }

    return {
      signedUrl: data.signedUrl,
      token: data.token,
      objectPath: input.objectPath,
      expiresAt: new Date(Date.now() + input.expiresInSeconds * 1000),
    };
  }

  async createSignedDownloadUrl(input: CreateSignedDownloadInput): Promise<string> {
    const signedUrlOptions = input.downloadFileName
      ? { download: input.downloadFileName }
      : undefined;
    const { data, error } = await this.getClient()
      .storage
      .from(input.bucket)
      .createSignedUrl(input.objectPath, input.expiresInSeconds, signedUrlOptions);
    assertStorageResponse(error, "Creating signed download URL");

    if (!data?.signedUrl) {
      throw new StorageProviderError("Supabase did not return a signed download URL");
    }

    return data.signedUrl;
  }

  async upload(input: UploadObjectInput): Promise<void> {
    const { error } = await this.getClient()
      .storage
      .from(input.bucket)
      .upload(input.objectPath, input.body, {
        contentType: input.contentType,
        cacheControl: String(input.cacheControlSeconds),
        upsert: input.allowOverwrite === true,
      });
    assertStorageResponse(error, "Uploading storage object");
  }

  async download(bucket: string, objectPath: string): Promise<DownloadedObject> {
    const { data, error } = await this.getClient().storage.from(bucket).download(objectPath);
    assertStorageResponse(error, "Downloading storage object");

    if (!data) {
      throw new StorageProviderError("Supabase did not return the requested object");
    }

    const body = new Uint8Array(await data.arrayBuffer());
    return {
      body,
      contentType: data.type || null,
      fileSizeBytes: data.size || body.byteLength,
    };
  }

  async getMetadata(bucket: string, objectPath: string): Promise<StorageObjectMetadata | null> {
    const { data, error } = await this.getClient().storage.from(bucket).info(objectPath);
    if (error) {
      if (error.statusCode === "404") return null;
      assertStorageResponse(error, "Reading storage metadata");
    }

    const metadata = data as StorageInfoResponse | null;
    if (!metadata) return null;
    return {
      contentType: metadata.metadata?.mimetype ?? null,
      fileSizeBytes: metadata.metadata?.size ?? null,
      updatedAt: metadata.updated_at ? new Date(metadata.updated_at) : null,
      etag: metadata.eTag ?? metadata.etag ?? null,
    };
  }

  async exists(bucket: string, objectPath: string): Promise<boolean> {
    const { data, error } = await this.getClient().storage.from(bucket).exists(objectPath);
    if (error) {
      if (error.statusCode === "404") return false;
      assertStorageResponse(error, "Checking storage object existence");
    }
    return data === true;
  }

  async delete(bucket: string, objectPath: string): Promise<void> {
    const { error } = await this.getClient().storage.from(bucket).remove([objectPath]);
    assertStorageResponse(error, "Deleting storage object");
  }
}

export const supabaseStorageService = new SupabaseStorageService();
