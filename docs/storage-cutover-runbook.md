# Supabase Storage Cutover Runbook

This runbook performs the migration from Cloudinary to private Supabase Storage without modifying the protected authentication implementation, deleting Cloudinary objects, or exposing Supabase credentials to the browser. It applies to the additive database migration `0009_nosy_legion.sql` and the provider-neutral storage routes introduced in this release.

> **Safety invariant:** Keep `STORAGE_LEGACY_CLOUDINARY_READS_ENABLED=true` throughout the stabilization window. No Cloudinary object may be deleted until the migration inventory, verification report, rollback readiness, and business retention review are complete.

## 1. Preflight

Provision the two private Supabase buckets by reviewing and running [`supabase-storage-setup.sql`](./supabase-storage-setup.sql) in the Supabase SQL editor. Confirm that `avatars` and `learning-assets` both report `public = false`. Do not create `storage.objects` browser policies; the application design intentionally grants capabilities only through the backend.

Set the following Railway backend variables. The service-role key is server-only and must never be placed in Vercel or other browser-visible configuration.

| Variable | Required value or purpose |
|---|---|
| `SUPABASE_URL` | Supabase project URL. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only key used to issue short-lived upload and download capabilities. |
| `SUPABASE_AVATARS_BUCKET` | `avatars`, unless the centralized backend configuration has been changed deliberately. |
| `SUPABASE_LEARNING_ASSETS_BUCKET` | `learning-assets`, unless the centralized backend configuration has been changed deliberately. |
| `STORAGE_SUPABASE_WRITES_ENABLED` | Initially `false`; becomes `true` only after the new frontend is deployed and legacy upload paths are ready to be closed. |
| `STORAGE_LEGACY_CLOUDINARY_READS_ENABLED` | `true` during the entire migration and stabilization window. |
| `STORAGE_STABILIZATION_WINDOW_DAYS` | Retention period before considering Cloudinary decommissioning; default is fourteen days. |

Apply the additive schema migration on Railway before deploying the storage-enabled backend:

```bash
npm run db:migrate
```

## 2. Backend-first, dual-write-capable deployment

Deploy the backend with the Supabase variables configured but with `STORAGE_SUPABASE_WRITES_ENABLED=false`. The protected Supabase endpoints will now be available for the updated frontend, while existing Cloudinary upload paths continue to serve clients that still have the previous frontend release cached.

Verify that unauthenticated requests to `/api/storage/upload-intents` return `401`, and authenticated authorized requests receive either a capability response or a meaningful `503` only when Supabase configuration is absent. Verify that no response includes `SUPABASE_SERVICE_ROLE_KEY`, a permanent provider URL, or an object key not already authorized by the server.

## 3. Frontend deployment

Deploy the frontend after the backend is healthy. The new UI sends all avatar, class-banner, resource, and student submission uploads through authenticated upload intents. It uploads directly to a short-lived signed URL, confirms the object with the backend, and persists only the confirmed internal asset reference.

During this overlap period, existing browser sessions may still use Cloudinary while refreshed sessions use Supabase. This is intentional and prevents an upload interruption during a progressive deployment.

## 4. Historical inventory and migration

Run the inventory command first. It is read-only and defaults to a bounded batch.

```bash
npm run storage:inventory -- --limit 50 --offset 0
```

Review the JSON report by asset kind and record the next offset. To copy a bounded batch after verifying private buckets and credentials, use the explicit apply command:

```bash
npm run storage:migrate -- --limit 50 --offset 0
```

The migration command downloads each legacy object, enforces the configured type and size policy, calculates a SHA-256 checksum, uploads without overwrite, compares destination metadata, stores an audit event, and updates the application record to a stable authenticated internal redirect only after verification. It never deletes Cloudinary data. Repeat deterministic batches using the reported `nextOffset`; retry failed candidates only with `--retry-failed` after resolving their cause.

## 5. Verification gate

After each migration batch, verify copies without deleting or rolling back anything automatically:

```bash
npm run storage:verify -- --limit 50 --offset 0
```

Use `--record-failures` only after reviewing the report when you need failed verification status and audit-event records persisted. A non-zero exit code means the batch is not ready for cutover.

Verify representative authorized and unauthorized behavior for each domain: profile avatar, class banner, learning resource, assignment attachment, and submission attachment. Authorized users must receive short-lived access only; users without the appropriate class, ownership, enrollment, or role relationship must receive `403` or `404`, never a signed provider URL.

## 6. Legacy-write cutoff

Once the frontend release is serving normally and no active workflow requires direct Cloudinary uploads, set:

```text
STORAGE_SUPABASE_WRITES_ENABLED=true
```

Redeploy Railway. The backend will reject new legacy resource and attachment URLs while preserving legacy reads for already-existing records. Monitor upload-intent creation, confirmation failures, signed-access issuance, `4xx` authorization failures, provider errors, and migration audit events for the stabilization period.

## 7. Rollback

If a verified Supabase asset or the provider becomes unavailable, keep Cloudinary objects untouched and restore the legacy record reference from `storage_assets.source_url` for the affected asset. The asset registry stores the source provider, source URL, identifiers, migration state, checksums, attempts, verification state, and audit events specifically for this purpose.

For a temporary broad rollback, redeploy the previous frontend release, retain `STORAGE_LEGACY_CLOUDINARY_READS_ENABLED=true`, set `STORAGE_SUPABASE_WRITES_ENABLED=false`, and restore only the affected application references. Do not delete Supabase copies or Cloudinary source objects during incident response.

## 8. Decommission decision

Only after the configured stabilization window, a complete zero-failure verification run, confirmed backup and restore testing, and explicit business approval may Cloudinary decommissioning be considered. Before removal, retain the immutable inventory and audit evidence, remove obsolete application credentials from Railway, remove the remaining backend legacy-read path in a separate reviewed release, and perform a final security review.

> This release intentionally does not delete Cloudinary objects or credentials. Decommissioning is a later, separately approved operation.
