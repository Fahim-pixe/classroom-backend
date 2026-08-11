-- Run in the Supabase SQL editor only after reviewing the bucket names against
-- STORAGE_CONFIG.supabase.buckets in src/config/app.ts.
--
-- Security model:
--   * Buckets remain private.
--   * The browser has no Supabase key and no storage.objects policies.
--   * The backend is the only Supabase caller and uses SUPABASE_SERVICE_ROLE_KEY.
--   * Browser access occurs only through backend-authorized signed upload and read URLs.
--
-- This script intentionally does NOT add public, anon, or authenticated policies
-- on storage.objects. Do not add broad SELECT, INSERT, UPDATE, or DELETE policies.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  (
    'avatars',
    'avatars',
    false,
    5242880,
    array['image/jpeg', 'image/png', 'image/webp']::text[]
  ),
  (
    'learning-assets',
    'learning-assets',
    false,
    52428800,
    array[
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/plain',
      'image/jpeg',
      'image/png',
      'image/webp'
    ]::text[]
  )
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Verification query: both rows must show public = false.
select id, public, file_size_limit, allowed_mime_types
from storage.buckets
where id in ('avatars', 'learning-assets')
order by id;

-- Verification query: no client-facing storage policies should exist for these buckets.
select policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'storage'
  and tablename = 'objects'
order by policyname;
