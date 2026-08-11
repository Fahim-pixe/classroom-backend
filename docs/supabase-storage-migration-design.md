# Cloudinary-to-Supabase Storage Migration Design

**Status:** implementation design approved for staged code delivery; production cutover is blocked until Supabase infrastructure, backup rehearsal, staging validation, and operator approval are complete.

## Executive decision

The platform will move to a **provider-neutral, private-object storage model**. Application routes will call a storage service interface; only its infrastructure implementation will call Supabase Storage. Cloudinary remains an explicit legacy-read provider during the controlled migration and stabilization window. No permanent dual-write will be introduced.

> All newly written assets must first be verified in Supabase before their application records refer to them. Historical Cloudinary records will remain usable until each individual asset is verified and its reference is changed atomically.

This design reflects Supabase’s private-bucket model: private objects cannot be served by public URLs and require either an authorized request or a time-limited signed URL.[1] Supabase Storage authorization is implemented through policies on `storage.objects`; a service key bypasses those controls and must therefore remain backend-only.[3]

## Audited scope

| Asset domain | Current persistence | Current provider coupling | Target ownership |
|---|---|---|---|
| User avatar | Better Auth `user.image`, `user.imageCldPubId` | Cloudinary widget and delete token | Application-owned avatar asset registry plus authenticated access gateway; protected auth schema remains unchanged |
| Class banner | `classes.banner_url`, `classes.banner_cld_pub_id` | Cloudinary public ID and transformation helper | `storage_assets` record and class banner asset link |
| Resource file | `resources.resource_url`, MIME type, byte count | Browser upload signed by Cloudinary, raw URL storage | Private `learning-assets` object with `storage_assets` record and authorized signed access |
| Assignment attachment | URL/name/MIME/byte count columns | Provider-agnostic fields but raw URL consumption | Private `learning-assets` object with `storage_assets` record |
| Submission attachment | URL/name/MIME/byte count columns | Provider-agnostic fields but raw URL consumption | Private `learning-assets` object with `storage_assets` record |
| Announcement/faculty/subject/branding media | No stored attachment or provider path was found | None found | Excluded until a schema/API workflow is introduced |

The current only active Cloudinary transformation renders class banners with resize, quality/format, DPR, and text-overlay behavior. The replacement will use a resolved safe image URL and application UI decoration rather than embed Cloudinary transformation syntax in the domain or presentation model.

## Target architecture

```text
React presentation
    │ provider-neutral upload/access API
Express route and authorization policy
    │
StorageService interface
    ├── SupabaseStorageService (new writes, private reads, object metadata)
    └── CloudinaryLegacyStorageService (temporary read-only migration source)
    │
Supabase Storage / Cloudinary legacy
```

The frontend never constructs a bucket path, never sends a service credential, and never creates a Supabase service client. It receives only an upload intent with a short-lived signed-upload capability and, for reads, an application access endpoint or resolved short-lived access URL.

## Bucket and visibility design

| Bucket | Visibility | Object classes | Rationale |
|---|---|---|---|
| `avatars` | Private | Profile images | Profile images are application-facing identity data and should not be enumerable or retrievable outside an authenticated classroom session. |
| `learning-assets` | Private | Class banners, resources, assignment attachments, submissions | These assets require different classroom, faculty, student-owner, and publication-state authorization checks but share a single academic retention boundary. |

The buckets will be private. Supabase notes that public buckets bypass retrieval access controls for any holder of the URL, whereas private buckets require an authorized request or signed URL.[1] The application backend will be the authorization authority; Storage RLS remains defense in depth. There will be **no broad browser `SELECT`, `INSERT`, `UPDATE`, or `DELETE` policy**. The backend service credential performs storage operations and creates narrowly scoped signed upload/download tokens after application authorization.

### Operator-applied bucket policy baseline

The infrastructure runbook will create both buckets as private with maximum size and MIME restrictions. No permissive policies should be added to `storage.objects`. An explicit review query must verify that no broad anonymous/authenticated allow policy exists for these two bucket IDs. Direct signed uploads are created by the trusted backend; service credentials bypass RLS and are never emitted in frontend code.[3]

## Provider-neutral data model

A new application-owned `storage_assets` registry will be the source of truth for storage metadata. Existing URL and Cloudinary ID fields remain legacy compatibility fields during the migration only.

| Field group | Proposed columns and purpose |
|---|---|
| Identity and linkage | `id`, `asset_kind`, `entity_type`, `entity_id`, `owner_id`, `class_id`, `subject_id` |
| Neutral provider reference | `storage_provider`, `bucket`, `object_path`, `source_provider`, `source_identifier`, `source_url` |
| File metadata | `file_name`, `mime_type`, `file_size_bytes`, `checksum_sha256`, `visibility` |
| Lifecycle and versioning | `version`, `state`, `replaced_by_asset_id`, `deleted_at` |
| Migration and verification | `migration_status`, `verification_status`, `verified_at`, `migration_attempts`, `last_error` |
| Audit trail | `created_at`, `updated_at`, `created_by`, structured migration-event records |

A companion `storage_upload_intents` table will make browser uploads controlled and recoverable. It records the authenticated actor, intended asset kind, authorized class/entity context, server-generated object path, declared metadata, expiry, completion status, and the resulting asset ID. Intent creation accepts filename, MIME claim, and size claim only for policy selection; confirmation reads the uploaded object metadata and refuses any mismatch. The database persists server-observed metadata, not a raw client URL.

Asset registry records carry explicit `storage_provider = cloudinary | supabase`. The provider is never inferred from URL text. Asset links for resources, classes, assignments, and submissions will use nullable asset IDs during transition; legacy columns remain readable until the stabilization period ends. The protected `auth.ts` module will **not** be modified. Instead, `user_storage_assets` will map a user ID to the avatar asset, while Better Auth’s legacy `imageCldPubId` remains inert compatibility data until an explicitly approved final schema cleanup.

## Object paths, versioning, and retention

Object keys are generated server-side from stable IDs, UUIDs, and a sanitized display-safe filename suffix. They contain no raw user path input and are immutable.

| Asset kind | Bucket and path pattern |
|---|---|
| Avatar | `avatars/{user-id}/{uuid}.{derived-extension}` |
| Class banner | `learning-assets/class-banners/{class-id}/v{version}/{uuid}-{safe-name}` |
| Resource | `learning-assets/resources/{class-id}/{upload-intent-id}/v1/{uuid}-{safe-name}` |
| Assignment attachment | `learning-assets/assignments/{assignment-id-or-intent}/v1/{uuid}-{safe-name}` |
| Submission attachment | `learning-assets/submissions/{submission-id-or-intent}/v1/{uuid}-{safe-name}` |

The server strips control characters, path separators, null bytes, excessive filename length, and unsupported extensions. It generates a UUID component regardless of the sanitized name. Resource replacement will create a new asset/version; it will not overwrite an existing object, consistent with Supabase’s warning that overwrite propagation can serve stale CDN content.[4]

Academic materials use logical archival first. Avatar removal clears the active mapping and marks the registry record deleted; physical deletion is a separately controlled operation after a retention period. Migration tooling never deletes a Cloudinary source object.

## Authorization and access contracts

Every private asset read begins at an authenticated backend endpoint. The endpoint looks up the asset registry, evaluates domain authorization, and only then asks the storage service for a short-lived signed download URL. It returns a no-store redirect or an opaque access URL; database/API responses do not expose bucket/object-path internals or permanent provider URLs.

| Asset kind | Read rule | Write/replace rule |
|---|---|---|
| Avatar | Any authenticated application user may view profile identity images. | Owner may create/replace/delete their avatar; administrators retain audited support access. |
| Class banner | Users with access to the class may view. | Assigned teacher or administrator only. |
| Resource | Administrator; class teacher; enrolled student only if published and not archived. | Assigned teacher or administrator only. |
| Assignment attachment | Administrator; class teacher; enrolled student for the assignment’s class. | Assignment author or administrator. |
| Submission attachment | Student owner; assignment class teacher; administrator. | Student owner while submission is allowed; staff only under existing authorization. |

The backend will use shared, testable policy helpers rather than copy authorization checks between routes. Signed URLs are intentionally short-lived: preview/download defaults will be configuration-owned and no longer than necessary. Signed URLs remain usable until expiry even after Auth key changes, so issuance TTL is the practical containment boundary.[2]

## Upload contract

The initial write path is a two-step protocol:

1. The browser asks `POST /storage/upload-intents` for an authenticated, domain-authorized upload intent with asset kind, applicable class/entity, filename claim, MIME claim, and size claim.
2. The backend validates the actor and context, applies allowlisted type/size policy, generates the target path, creates a short-lived Supabase signed upload capability, and persists a pending intent. It returns the intent ID and opaque upload data only.
3. The browser uploads directly to Supabase; application-server bandwidth is not used for file payloads.
4. The browser calls `POST /storage/upload-intents/:id/confirm`. The backend checks expiry/ownership, reads the object metadata, validates observed size/type against policy and declared limits, creates the asset registry record, and marks the intent complete.
5. The relevant application mutation attaches the returned asset ID in its database transaction. A failed attachment leaves a reconciliable pending/verified asset rather than falsely claiming success.

Supabase supports signed upload URLs specifically for uploads delegated to an untrusted client, and its resumable TUS flow supports the signed token through `x-signature`.[5] Standard uploads are appropriate below the configured threshold; Supabase recommends resumable uploads for larger than 6 MB transfers or unreliable networks.[4] The phase-one frontend uses documented signed uploads for the existing resource/avatar sizes. A phase-two large-file adapter may add TUS progress, retry, cancellation, and resume while retaining this same intent/confirmation contract.[6]

## Migration execution and verification

The migration command is an **operator-invoked one-off CLI**, not a scheduler or permanent worker. It supports `--dry-run`, `--batch-size`, `--concurrency`, `--from`, `--to`, `--entity-type`, `--retry-failed`, `--verify`, and `--report`.

For every candidate, the tool discovers a legacy source row, upserts a deterministic inventory record, calculates a target path, downloads the Cloudinary source, computes SHA-256, uploads the immutable Supabase target, retrieves and verifies it, and only then transacts the registry/reference change. It records source existence, target existence, byte count, MIME type, retrieval result, checksum, attempt count, and failure classification. If storage succeeds but database update fails, the registry remains recoverable and the next idempotent run reconciles it; the tool never assumes external storage and the database are atomic.

Default migration execution begins with 25 assets, batch size 50, concurrency 4, exponential backoff with capped jitter, and a strict retry classification. Operators tune concurrency only after throughput, latency, and failure-rate measurement. The tool creates reports for failed assets and suspected source/target/database orphans; it never deletes an orphan automatically.

## Rollout and rollback

| Stage | Gate | Safe rollback |
|---|---|---|
| Infrastructure | Private buckets, size/type restrictions, credential validation, no broad policies | Remove new configuration; no application records changed. |
| Schema and abstraction | Migration added; feature flag defaults to legacy reads/writes | Revert application deployment; schema is additive. |
| Staging write canary | Avatar/resource create, preview, delete, authorization tests, backup restore rehearsal | Disable write feature flag and retain created target objects for diagnosis. |
| Production new-write cutover | Supabase upload/confirm success and zero service-key exposure check | Disable Supabase new-write flag; legacy reads remain intact. |
| Canary legacy migration | Representative image, PDF, office document, Unicode filename, missing source | Restore previous reference/provider from audit record; target object is retained. |
| Incremental migration | Verification success, error-rate threshold, reconciliation reports | Per-asset provider rollback; Cloudinary original remains source. |
| Stabilization | 7–30 days of access/upload/preview monitoring | Re-enable legacy-read flag if a verified asset regression occurs. |
| Decommission | Explicit approval, zero unresolved failures/orphans, final export | No automatic rollback; source deletion is a separate approved action. |

Before any production reference change, operators must produce a verified database backup, export inventory, and document a restoration rehearsal. Production is not the first full migration: staging must complete the same process first.

## Observability, testing, and acceptance gates

The storage boundary emits structured, secret-safe events such as `storage.upload.started`, `storage.upload.completed`, `storage.upload.failed`, `storage.authorization.denied`, `storage.migration.started`, `storage.migration.completed`, `storage.migration.failed`, `storage.verification.failed`, and `storage.orphan.detected`. Tokens, service credentials, file bodies, and unnecessary personal data are never logged.

Backend tests will cover policy decisions, filename/path safety, intent expiry/ownership, metadata mismatch rejection, service error mapping, migration idempotency, and no reference update before verification. Frontend tests cover success/failure state and never expose provider path construction. Release checks include TypeScript/build, existing application tests, migration CLI compilation, and a scan that forbids service-role variables in frontend source/bundles. Staging acceptance covers anonymous denial, unauthorized student/faculty denial, avatar/resource/attachment flows, direct-object denial, signed expiry, legacy fallback, checksum verification, retry, rollback, and report generation.

## Required deployment configuration

| Scope | Required setting | Rule |
|---|---|---|
| Backend | `SUPABASE_URL` | Server only; validated at startup when Supabase write feature is enabled. |
| Backend | `SUPABASE_SERVICE_ROLE_KEY` | Server only; never logged, returned, or included in frontend build variables. |
| Backend | Storage feature flags, bucket IDs, TTLs, upload size/type policy | Centralized in `src/config/app.ts`; default to conservative legacy behavior until cutover. |
| Supabase | Private `avatars` and `learning-assets` buckets, CORS for application origin, allowed types/limits | Provisioned in staging before application feature enablement. |
| Frontend | Application API endpoints only | No service credential and no provider-path construction. |

## Non-goals and current constraints

This migration does not rewrite Better Auth, replace Neon/PostgreSQL, alter unrelated Refine UI, create a worker queue, or delete Cloudinary assets. `auth.ts` remains untouched. The actual production asset inventory, staging migration results, production migration results, performance comparison, final orphan analysis, stabilization result, and Cloudinary decommissioning cannot truthfully be declared complete until credentials, infrastructure, backups, and staged execution have occurred.

## References

[1] [Supabase Storage Buckets: private/public access models](https://supabase.com/docs/guides/storage/buckets/fundamentals)

[2] [Supabase Storage: private downloads and signed URLs](https://supabase.com/docs/guides/storage/serving/downloads)

[3] [Supabase Storage: access control and service-key boundary](https://supabase.com/docs/guides/storage/security/access-control)

[4] [Supabase Storage: standard uploads, size guidance, and overwrite behavior](https://supabase.com/docs/guides/storage/uploads/standard-uploads)

[5] [Supabase JavaScript: createSignedUploadUrl](https://supabase.com/docs/reference/javascript/file-buckets-createsigneduploadurl)

[6] [Supabase Storage: resumable uploads and signed upload tokens](https://supabase.com/docs/guides/storage/uploads/resumable-uploads)
