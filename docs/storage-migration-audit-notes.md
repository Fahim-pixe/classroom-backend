# Cloudinary-to-Supabase Storage Migration: Audit Notes

**Source specification:** `/home/ubuntu/upload/pasted_content_8.txt` (user-provided, reviewed 2026-08-12)

## Mandatory controls captured from the specification

The implementation must be incremental, verifiable, rollback-capable, auditable, idempotent, and zero/minimal-downtime. New writes must move to Supabase before historical migration begins. Cloudinary must remain read-only legacy storage during a stabilization period, and source assets must not be deleted before final, explicitly approved decommissioning.

The target design must place provider-specific APIs behind a backend `StorageService`. Application-domain data must use provider-neutral references such as provider, bucket, object path, filename, MIME type, and size. Private objects require backend authorization before short-lived signed URLs are created. The browser must never receive a Supabase service-role key.

The migration tool must support dry-run, batch size, concurrency, entity filtering, retrying failed items, verification, and reporting. It must verify source existence, target existence, MIME type, file size, target retrieval, and cryptographic hashes where practical before updating database references. It must be resumable and idempotent.

## Completed dependency audit

| Integration | Location | Current usage | Data source / domain field | Planned replacement |
|---|---|---|---|---|
| Resource signed upload | `src/routes/resources.ts` | Generates a SHA-1 Cloudinary upload signature and exposes cloud name/API key to browser | `resources.resourceUrl` | Authorized provider-neutral upload preparation plus Supabase Storage upload; metadata confirmation endpoint |
| Resource browser upload | `classroom-frontend/src/pages/resources.tsx` | Browser submits direct multipart upload to Cloudinary then sends `secure_url` to API | `resources.resourceUrl`, client-supplied MIME/size | Provider-neutral upload API, server-verified object metadata, signed access URL on read |
| Class-banner rendering | `classroom-frontend/src/pages/classes/show.tsx`, `src/lib/cloudinary.ts` | Builds Cloudinary transformations and text overlays through Cloudinary SDK | `classes.bannerUrl`, `classes.bannerCldPubId` | Generic resolved image URL; preserve fallback and move decoration/layout to application UI where required |
| Class-banner persistence | `classroom-backend/src/db/schema/app.ts`, `src/routes/classes.ts` | Stores provider-specific public ID plus URL | `classes.bannerCldPubId`, `classes.bannerUrl` | Transitional asset reference, then provider-neutral class-banner linkage |
| Avatar upload and deletion | `classroom-frontend/src/components/upload-widget.tsx` | Loads Cloudinary browser widget; uses delete token direct to Cloudinary | Better Auth user `image`, `imageCldPubId` | Controlled application upload/deletion flow with provider-neutral asset reference |
| Avatar profile persistence | `classroom-frontend/src/pages/profile.tsx`, `classroom-backend/src/routes/users.ts` | Persists `image` URL and `imageCldPubId` directly | Better Auth user custom fields | Preserve `image` presentation compatibility; introduce application-owned asset mapping without changing authentication source |
| Avatar registration contract | `src/lib/auth.ts`, `classroom-frontend/src/lib/auth-client.ts`, `src/providers/auth.ts` | Custom Better Auth field named `imageCldPubId` | Better Auth user extension | Treat as legacy compatibility only; do not modify `auth.ts` per existing project constraint |
| Assignment and submission attachments | `src/db/schema/app.ts`, `src/routes/assignments.ts` | Attachment URL, name, MIME type, size persisted; no provider-specific SDK call found | Assignment/submission attachment fields | Backfill provider-neutral asset linkage and return authorized access URL |
| Resource and attachment display | API responses, resource UI, assignment UI | Permanent raw URLs are returned and opened directly | URL columns | Resolve access through backend with authorization and short-lived URLs for private content |
| Frontend dependencies | `classroom-frontend/package.json`, `package-lock.json` | `@cloudinary/react` and `@cloudinary/url-gen` are installed | Build dependency | Retain only during transitional legacy-read period; remove at final decommissioning stage |
| Environment configuration | Backend `src/config/app.ts`, frontend `src/constants/index.ts` | Cloudinary variables and widget endpoints are centralized | `CLOUDINARY_*`, `VITE_CLOUDINARY_*` | Backend-only `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`; no service credential in frontend |
| Operations documentation | `docs/production-operations.md` | Names Cloudinary storage and recovery responsibilities | Operations guide | Extend with migration sequence, backup, rollback, and stabilization runbook |

## Current architecture facts and transition risks

1. Resource creation currently accepts a client-supplied URL and metadata after client-side upload. The Supabase write path must not trust client-provided MIME type, byte count, or object path.
2. Resource read access is currently controlled at the listing query but opens the raw stored URL directly. Private asset access requires a new backend authorization-and-signed-URL boundary.
3. The current class and user domain representations include Cloudinary-specific identifier fields. The `imageCldPubId` field is inside the authentication module, which must remain untouched. An application-owned asset mapping is required to eliminate runtime business dependence without changing that protected authentication module.
4. The only discovered Cloudinary transformation is the class-banner image resize/format/quality/DPR plus name text overlay. The equivalent implementation should preserve appearance at the presentation layer without encoding provider transformations into asset references.
5. No tracked backend worker, scheduler, seed, or cleanup migration script currently handles Cloudinary assets. The migration should be an explicit operator-invoked CLI, not an always-on process.

## Items that require deployment/operator input before production execution

- A Supabase project with approved private buckets and tested service credentials.
- Storage policies configured from the final bucket-policy SQL/runbook.
- A verified database backup and restoration rehearsal.
- Cloudinary export/access capability sufficient to read every legacy asset during the stabilization window.
- Authorization to change the previously protected `auth.ts` module only if final removal of the legacy `imageCldPubId` schema field is required. Until then, the field will remain inert compatibility data, not a runtime dependency.

## Audit status

The tracked-source audit is complete for backend routes, configuration, schema, frontend upload/render components, packages, CI, documentation, migrations, and job/worker paths. No Cloudinary background worker, scheduler, seed, or tracked cleanup script was found. The audit is not an inventory of production database records; the proposed inventory tooling must query the production/staging database in dry-run mode after deployment credentials are provided.

## Official Supabase implementation findings

Supabase buckets are private by default. Private-object downloads require an authenticated request permitted by RLS or a time-limited signed URL; public buckets bypass retrieval access controls for anyone holding the URL. Storage operations are governed through RLS policies on `storage.objects`, while service-role credentials bypass RLS and must remain server-only. Standard uploads are recommended for files up to 6 MB; resumable uploads are recommended for larger transfers. Supabase advises against overwriting objects because CDN propagation can serve stale content, which supports versioned object paths for resource replacement.

These findings support a private-bucket design with application-level authorization before signed URL generation, server-only service credentials, no browser-side storage SDK credentials, immutable versioned object paths, and a staged large-upload strategy.

### Sources

1. [Supabase Storage Buckets: access models and default privacy](https://supabase.com/docs/guides/storage/buckets/fundamentals)
2. [Supabase Storage: serving private downloads and signed URLs](https://supabase.com/docs/guides/storage/serving/downloads)
3. [Supabase Storage: RLS-based access control and service-key boundary](https://supabase.com/docs/guides/storage/security/access-control)
4. [Supabase Storage: standard uploads, concurrency, and overwrite guidance](https://supabase.com/docs/guides/storage/uploads/standard-uploads)

## Proposed target design direction

Use two private buckets: `avatars` for user profile images and `learning-assets` for class banners, resources, and assignment/submission attachments. This division is justified by distinct retention/access workflows while avoiding a bucket per entity. All current application-owned file types are private because user profile photos are shown only inside the authenticated classroom application, and learning materials, submissions, and class context are authorization-scoped. The backend will retain policy enforcement and issue short-lived access URLs only after domain authorization. Supabase RLS remains defense in depth rather than the sole business authorization control.

The compatibility migration will add an application-owned `storage_assets` registry that holds provider-neutral metadata and migration state. Existing URL and Cloudinary-identifier columns will remain read-compatible until each record is verified and the stabilization window is complete. New writes will persist an asset registry record with `provider = supabase`, and resource / banner / attachment / avatar consumers will use the registry. Existing Cloudinary rows will remain explicitly marked as `provider = cloudinary`; no provider will be inferred from URL structure.

Because `src/lib/auth.ts` is protected from changes, Better Auth’s `imageCldPubId` column cannot be removed in this implementation. It will become inert legacy compatibility data. A later change to remove the column after decommissioning requires an explicit exception to the existing no-auth-modification constraint.

## Signed and resumable upload findings

Supabase documents `createSignedUploadUrl` for time-limited browser uploads without exposing a service credential. Its resumable Storage endpoint supports signed upload tokens through the `x-signature` header. Supabase recommends its TUS resumable protocol for files over 6 MB, unreliable networks, and progress reporting; it explicitly recommends unique object paths instead of overwrite operations to avoid stale CDN delivery.

The application design will use a backend-authorized upload-preparation endpoint that issues a single-use application upload intent plus a Supabase signed-upload token. The browser will use the returned opaque upload target only; it will not construct bucket paths or receive service credentials. Files at or below the configured standard-upload threshold use the signed-upload flow. A future large-file frontend enhancement can use signed TUS uploads and progress/resume support while preserving the same upload-intent and confirmation API contract.

### Additional sources

5. [Supabase JavaScript reference: createSignedUploadUrl](https://supabase.com/docs/reference/javascript/file-buckets-createsigneduploadurl)
6. [Supabase Storage: resumable uploads and signed upload tokens](https://supabase.com/docs/guides/storage/uploads/resumable-uploads)

7. [Supabase JavaScript reference: uploadToSignedUrl](https://supabase.com/docs/reference/javascript/file-buckets-uploadtosignedurl)

## Implemented transition controls

The implementation now includes an additive `storage_assets` registry, upload-intent records, migration events, and legacy-to-asset links for user avatars, class banners, resources, assignment attachments, and submission attachments. The registry records provider, bucket, object path, source URL and identifier, ownership and class scope, checksum, byte size, verification status, migration status, retry count, failure reason, and timestamps.

The operator-only `storage:inventory` command defaults to dry-run behavior. The explicit `storage:migrate` command copies bounded legacy batches, enforces configured type and size policy, calculates a SHA-256 checksum, verifies destination metadata, preserves Cloudinary source metadata, records an audit event, and never deletes a source object. `storage:verify` validates migrated destination metadata after each batch and can record a failed verification only when `--record-failures` is explicitly supplied.

The cutover is intentionally phased. The secure Supabase upload path is available once its backend credentials are configured, while `STORAGE_SUPABASE_WRITES_ENABLED` controls the later rejection of new legacy Cloudinary URL writes. This permits an overlap in which cached legacy clients and refreshed Supabase clients remain functional before the legacy-write cutoff. Private buckets, server-only service-role credentials, authenticated upload intents, confirmation checks, server-side authorization, short-lived signed reads, audit events, and stable internal redirect paths replace provider URLs in application records.

## Release validation record

The backend TypeScript build and the dedicated storage-tool compiler check passed after the final changes. The frontend test suite, TypeScript validation, Vite production build, whitespace check, and performance budget check also passed. The initial frontend JavaScript payload measured 239.5 KiB gzip against a 250 KiB limit. The production dependency audit contains no high-severity findings; the existing transitive development-tool chain still reports five moderate `esbuild` advisories, whose forced remediation would require a breaking Drizzle Kit downgrade and therefore remains an explicitly tracked follow-up rather than an unreviewed forced upgrade.

No production database migration, Supabase bucket setup, Cloudinary copy, or environment-variable change was executed from the sandbox. Those operations remain operator-controlled and are documented in `storage-cutover-runbook.md`.
