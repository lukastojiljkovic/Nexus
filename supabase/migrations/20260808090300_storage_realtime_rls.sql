-- Nexus sync — migration 004: the same wall over `storage.objects` and
-- `realtime.messages`.
--
-- WHY THESE TWO NEED SAYING OUT LOUD. They are the two tables a reviewer of this
-- schema will not think to check, because nobody created them: Supabase ships
-- them. They are also the two that carry the most damaging content — the file
-- bytes and the live change stream — and they are reachable from the same access
-- token as everything else. A project that has locked down every table it wrote
-- and left these two on stock settings has not built a wall; it has built a
-- fence with a gate in the part of the garden it did not survey.
--
-- OWNERSHIP, AND WHY THIS FILE MAY WARN INSTEAD OF FAILING. `storage.objects` is
-- owned by `supabase_storage_admin` and `realtime.messages` by
-- `supabase_realtime_admin`. In most Supabase projects the migration role is a
-- member of both and everything below simply applies. Where it is not, `alter
-- table` raises `insufficient_privilege`, and there is no good answer that ends
-- the deploy: aborting the migration takes the whole schema with it over a table
-- this file did not create. So each block catches that one error, converts it
-- into a WARNING naming the exact statement a human must run, and lets the
-- deploy continue — and `supabase/tests/database/00_rls_enabled.test.sql` then
-- FAILS, loudly, because it asserts the end state rather than the attempt. The
-- rule this arrangement follows is that a wall may be reported missing but must
-- never be reported present when it is not.

-- No `begin;`/`commit;` — the CLI wraps each migration file in a transaction of
-- its own; migration 001's header has the full reasoning.

-- ---------------------------------------------------------------------------
-- storage.objects
-- ---------------------------------------------------------------------------
-- ONE PRIVATE BUCKET, AND THE PATH IS THE TENANCY KEY. `storage.objects` has no
-- `user_id` column to write a policy against, so ownership has to be read out of
-- the object's path. The convention is fixed here and nowhere else:
--
--     <user_id>/<profile_id>/<object_id>
--
-- and the policy asserts the first segment. This is why the bucket is created in
-- this file rather than by hand in the dashboard: a bucket created by hand is a
-- bucket whose `public` flag is whatever the person clicking remembered, and a
-- public bucket serves every byte in it to anyone with the URL, RLS untouched —
-- `public` is not a policy, it is a bypass of the entire concept.
--
-- The file bytes are already encrypted by the client before upload; the bucket
-- being private is the second wall, not the first.
--
-- Wrapped, like everything else touching a schema this repository does not own.
-- `storage.buckets` belongs to `supabase_storage_admin` too, so a migration role
-- that is not a member of it fails here — and failing here would abort the whole
-- deploy over a bucket, before the policies below have been attempted.
do $$
begin
  insert into storage.buckets (id, name, public, file_size_limit)
  values ('nexus-attachments', 'nexus-attachments', false, 52428800)
  on conflict (id) do update
    -- Re-asserted rather than ignored on conflict, because the failure mode this
    -- guards against is a bucket that was flipped to public in the dashboard at
    -- some point and never flipped back. `do nothing` would leave it public, and
    -- `public` is not a weak policy — it is a bypass of the entire concept,
    -- serving every byte in the bucket to anyone holding the URL.
    set public = false, file_size_limit = 52428800;
exception when insufficient_privilege then
  raise warning
    'Nexus: could not create/repair the nexus-attachments bucket. Create it as '
    'the storage owner, PRIVATE, with a 50 MiB object limit.';
end;
$$;

do $$
begin
  execute 'alter table storage.objects enable row level security';
  execute 'alter table storage.objects force row level security';
exception when insufficient_privilege then
  raise warning
    'Nexus: could not force RLS on storage.objects (owned by %). Run as that '
    'owner: ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY; ALTER TABLE '
    'storage.objects FORCE ROW LEVEL SECURITY;',
    (select pg_get_userbyid(relowner) from pg_class where oid = 'storage.objects'::regclass);
end;
$$;

do $$
begin
  -- DROP-THEN-CREATE, so this block is idempotent. The earlier version relied on
  -- a `duplicate_object` handler, which is a hole rather than a safeguard: if
  -- two of the four policies already existed and the third did not, the block
  -- aborted on the first and the missing one was never created — leaving a
  -- half-built wall and a migration that reported success. `create policy` has
  -- no `if not exists`, so the only idempotent shape is this one.
  drop policy if exists nexus_storage_owner_select on storage.objects;
  drop policy if exists nexus_storage_owner_insert on storage.objects;
  drop policy if exists nexus_storage_owner_update on storage.objects;
  drop policy if exists nexus_storage_live_session on storage.objects;

  -- Owner policies. SELECT/INSERT/UPDATE only; no DELETE policy, for the same
  -- reason no table in migration 002 has one — an attachment is removed by
  -- tombstoning the `sync_objects` row that references it, and the bytes are
  -- reaped by a service-role job that can see both sides. A client-issued DELETE
  -- would let a single compromised session erase files that other devices have
  -- not yet downloaded, with no tombstone left to explain the hole.
  execute $p$
    create policy nexus_storage_owner_select on storage.objects
      for select to authenticated
      using (
        bucket_id = 'nexus-attachments'
        and (storage.foldername(name))[1] = (select auth.uid())::text
      )
  $p$;
  execute $p$
    create policy nexus_storage_owner_insert on storage.objects
      for insert to authenticated
      with check (
        bucket_id = 'nexus-attachments'
        and (storage.foldername(name))[1] = (select auth.uid())::text
      )
  $p$;
  execute $p$
    create policy nexus_storage_owner_update on storage.objects
      for update to authenticated
      using (
        bucket_id = 'nexus-attachments'
        and (storage.foldername(name))[1] = (select auth.uid())::text
      )
      with check (
        bucket_id = 'nexus-attachments'
        and (storage.foldername(name))[1] = (select auth.uid())::text
      )
  $p$;

  -- The restrictive gate, unconditional across every bucket rather than scoped
  -- to `nexus-attachments`. Scoping it would read as tidier and would be wrong:
  -- this project hosts exactly one application, so a bucket that is not Nexus'
  -- is a bucket nobody meant to create, and the correct treatment of an
  -- unexplained bucket is that a password-only session cannot touch it either.
  execute $p$
    create policy nexus_storage_live_session on storage.objects
      as restrictive for all to authenticated
      using ((select private.nexus_session_is_live()))
      with check ((select private.nexus_session_is_live()))
  $p$;
exception when insufficient_privilege then
  raise warning
    'Nexus: could not create storage.objects policies. Run this migration''s '
    'storage block as the storage owner.';
end;
$$;

-- ---------------------------------------------------------------------------
-- realtime.messages
-- ---------------------------------------------------------------------------
-- THIS TABLE IS THE CHANGE STREAM, and on a stock project every authenticated
-- session can subscribe to every topic, including topics it invents. That is a
-- cross-tenant channel: user B joins `nexus:<A's uuid>` and watches A's writes
-- arrive in real time. The ciphertext stays shut, but the traffic pattern — when
-- A works, which collection, how often — is exactly the metadata this design
-- concedes reluctantly on its own rows and has no reason to hand out on
-- somebody else's.
--
-- The topic namespace is fixed here: `nexus:<user_id>`. `realtime.topic()` is
-- the Realtime server's view of the channel being joined, so the predicate is an
-- equality against the caller's own uuid and there is no wildcard in it.
do $$
begin
  execute 'alter table realtime.messages enable row level security';
  execute 'alter table realtime.messages force row level security';
exception when insufficient_privilege then
  raise warning
    'Nexus: could not force RLS on realtime.messages (owned by %). Run as that '
    'owner: ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY; ALTER TABLE '
    'realtime.messages FORCE ROW LEVEL SECURITY;',
    (select pg_get_userbyid(relowner) from pg_class where oid = 'realtime.messages'::regclass);
end;
$$;

do $$
begin
  -- Idempotent, for the reason spelled out in the storage block above.
  drop policy if exists nexus_realtime_owner_select on realtime.messages;
  drop policy if exists nexus_realtime_owner_insert on realtime.messages;
  drop policy if exists nexus_realtime_live_session on realtime.messages;

  execute $p$
    create policy nexus_realtime_owner_select on realtime.messages
      for select to authenticated
      using (realtime.topic() = 'nexus:' || (select auth.uid())::text)
  $p$;
  execute $p$
    create policy nexus_realtime_owner_insert on realtime.messages
      for insert to authenticated
      with check (realtime.topic() = 'nexus:' || (select auth.uid())::text)
  $p$;
  -- No UPDATE and no DELETE policy: a broadcast is an event, and an event that
  -- can be edited after the fact is not an event.
  execute $p$
    create policy nexus_realtime_live_session on realtime.messages
      as restrictive for all to authenticated
      using ((select private.nexus_session_is_live()))
      with check ((select private.nexus_session_is_live()))
  $p$;
exception when insufficient_privilege then
  raise warning
    'Nexus: could not create realtime.messages policies. Run this '
    'migration''s realtime block as the realtime owner.';
end;
$$;

