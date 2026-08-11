import { and, eq } from "drizzle-orm";

import { db } from "../src/db/index.js";
import { storageAssets, storageMigrationEvents } from "../src/db/schema/index.js";
import { STORAGE_CONFIG } from "../src/config/app.js";
import { supabaseStorageService } from "../src/services/storage/supabase-storage.service.js";

const argumentsSet = new Set(process.argv.slice(2));
const valueAfter = (flag: string) => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const hasFlag = (flag: string) => argumentsSet.has(flag);
const requestedLimit = Number(valueAfter("--limit") ?? STORAGE_CONFIG.migration.defaultBatchSize);
const requestedOffset = Number(valueAfter("--offset") ?? 0);
const limit = Math.min(Math.max(1, Number.isInteger(requestedLimit) ? requestedLimit : STORAGE_CONFIG.migration.defaultBatchSize), STORAGE_CONFIG.migration.maximumBatchSize);
const offset = Math.max(0, Number.isInteger(requestedOffset) ? requestedOffset : 0);
const assetId = valueAfter("--asset-id");
const writeFailures = hasFlag("--record-failures");

if (!supabaseStorageService.isConfigured()) {
  throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for storage verification");
}

async function main() {
  const filters = [
    eq(storageAssets.storageProvider, STORAGE_CONFIG.provider),
    eq(storageAssets.migrationStatus, "verified"),
    eq(storageAssets.state, "active"),
  ];
  if (assetId) filters.push(eq(storageAssets.id, assetId));

  const assets = await db.select()
    .from(storageAssets)
    .where(and(...filters))
    .limit(limit)
    .offset(offset);

  const report = {
    checked: assets.length,
    verified: 0,
    failed: 0,
    failures: [] as Array<{ assetId: string; reason: string }>,
    nextOffset: offset + assets.length,
    writeFailures,
  };

  for (const asset of assets) {
    try {
      if (!asset.bucket || !asset.objectPath || !asset.fileSizeBytes) {
        throw new Error("Asset is missing required verified storage metadata");
      }
      const metadata = await supabaseStorageService.getMetadata(asset.bucket, asset.objectPath);
      if (!metadata) throw new Error("Destination object was not found");
      if (metadata.fileSizeBytes !== asset.fileSizeBytes) {
        throw new Error(`Destination size mismatch: expected ${asset.fileSizeBytes}, received ${metadata.fileSizeBytes}`);
      }
      report.verified += 1;
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Unknown verification error";
      report.failed += 1;
      report.failures.push({ assetId: asset.id, reason });
      if (writeFailures) {
        await db.update(storageAssets)
          .set({ verificationStatus: "failed", lastError: reason, updatedAt: new Date() })
          .where(eq(storageAssets.id, asset.id));
        await db.insert(storageMigrationEvents).values({
          assetId: asset.id,
          eventName: "verification_failed",
          severity: "error",
          details: { reason },
        });
      }
    }
  }

  console.log(JSON.stringify(report, null, 2));
  if (report.failed > 0) process.exitCode = 1;
}

void main().catch((error) => {
  console.error("Storage verification command failed:", error);
  process.exitCode = 1;
});
