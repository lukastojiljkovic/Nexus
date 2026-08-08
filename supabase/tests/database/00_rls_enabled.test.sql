-- THE MIGRATION-DRIFT GUARD. Requires a live database:
--   supabase start && supabase db reset && supabase test db
--
-- WHY THIS EXISTS ALONGSIDE THE STATIC CHECKER. `supabase/scripts/check-rls-wall.mjs`
-- reads the migrations and proves that the wall is WRITTEN. This reads
-- `pg_class` and `pg_policy` and proves that the wall IS THERE. They are not the
-- same claim and the gap between them is where real incidents live: a policy
-- dropped in the dashboard's SQL editor during an incident and never restored, a
-- table created by a migration that was reverted in git but already applied, a
-- Supabase platform upgrade that resets something. None of those touch a file in
-- this repository, so none of them can be caught by reading files.
--
-- EVERY ASSERTION IS PHRASED AS `is_empty`, NEVER AS A COUNT. „No table lacks
-- RLS" written as `is(count(*), 0)` reports a failure as „expected 0, got 3",
-- which tells you the wall is broken and not where. `is_empty` prints the
-- offending rows, so a red run names the tables. A test that fails without
-- saying what failed gets muted.

begin;

select plan(21);

-- ---------------------------------------------------------------------------
-- 1–4. ENABLE and FORCE on everything this repository creates.
-- ---------------------------------------------------------------------------
-- Both, on every table, and the pair is checked separately so a failure says
-- which half is missing. ENABLE alone exempts the table owner — the role that
-- runs every migration, every seed and every console session — so under ENABLE
-- alone a policy bug is invisible from the only place anybody tests from.
select is_empty(
  $$ select n.nspname || '.' || c.relname
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity $$,
  'every table in the exposed schema has row level security ENABLED'
);

select is_empty(
  $$ select n.nspname || '.' || c.relname
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relforcerowsecurity $$,
  'every table in the exposed schema has row level security FORCED'
);

select is_empty(
  $$ select n.nspname || '.' || c.relname
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'private' and c.relkind = 'r' and not c.relrowsecurity $$,
  'every table in the private schema has row level security ENABLED'
);

select is_empty(
  $$ select n.nspname || '.' || c.relname
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'private' and c.relkind = 'r' and not c.relforcerowsecurity $$,
  'every table in the private schema has row level security FORCED'
);

-- ---------------------------------------------------------------------------
-- 5–8. The two tables Supabase created, which are the two nobody checks.
-- ---------------------------------------------------------------------------
-- Migration 004 may only have been able to WARN about these, if the migration
-- role was not a member of the owning role. That is exactly why these four
-- assertions exist and why they are not conditional: a wall may be reported
-- missing, but it must never be reported present when it is not.
select ok(
  (select relrowsecurity from pg_class where oid = 'storage.objects'::regclass),
  'storage.objects has row level security ENABLED'
);
select ok(
  (select relforcerowsecurity from pg_class where oid = 'storage.objects'::regclass),
  'storage.objects has row level security FORCED'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'realtime.messages'::regclass),
  'realtime.messages has row level security ENABLED'
);
select ok(
  (select relforcerowsecurity from pg_class where oid = 'realtime.messages'::regclass),
  'realtime.messages has row level security FORCED'
);

-- ---------------------------------------------------------------------------
-- 9–10. Deletion is a tombstone, and a permissive FOR ALL is a DELETE policy.
-- ---------------------------------------------------------------------------
-- `polcmd` is 'd' for DELETE and '*' for ALL. The second assertion is the one
-- that gets missed: a permissive `FOR ALL` policy grants DELETE along with
-- everything else, so it is a DELETE policy written in a way that does not
-- contain the word.
select is_empty(
  $$ select n.nspname || '.' || c.relname || ' / ' || p.polname
       from pg_policy p
       join pg_class c on c.oid = p.polrelid
       join pg_namespace n on n.oid = c.relnamespace
      where p.polcmd = 'd' $$,
  'no DELETE policy exists anywhere — rows are tombstoned'
);

select is_empty(
  $$ select n.nspname || '.' || c.relname || ' / ' || p.polname
       from pg_policy p
       join pg_class c on c.oid = p.polrelid
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname in ('public', 'storage', 'realtime')
        and p.polcmd = '*' and p.polpermissive $$,
  'no permissive FOR ALL policy — it would grant DELETE without saying so'
);

-- ---------------------------------------------------------------------------
-- 11. Every walled table carries a restrictive gate.
-- ---------------------------------------------------------------------------
-- Permissive policies OR together, so a second permissive policy WIDENS access.
-- Narrowing requires `as restrictive`, which ANDs. A table with only permissive
-- policies has an owner check and no session check at all.
select is_empty(
  $$ select n.nspname || '.' || c.relname
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
        and not exists (
          select 1 from pg_policy p where p.polrelid = c.oid and not p.polpermissive
        ) $$,
  'every exposed table has at least one AS RESTRICTIVE gate'
);

-- ---------------------------------------------------------------------------
-- 12. A policy with no roles is addressed to PUBLIC.
-- ---------------------------------------------------------------------------
-- `polroles = '{0}'` is the catalog's way of saying PUBLIC, which includes
-- `anon` — the role behind the publishable key. Such a policy reads as though it
-- merely omits a detail; it is a policy addressed to the internet.
select is_empty(
  $$ select n.nspname || '.' || c.relname || ' / ' || p.polname
       from pg_policy p
       join pg_class c on c.oid = p.polrelid
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname in ('public', 'private', 'storage', 'realtime')
        and p.polroles = '{0}'::oid[] $$,
  'no policy is addressed to PUBLIC'
);

-- ---------------------------------------------------------------------------
-- 13–14. Privileges, which fail in a different direction from policies.
-- ---------------------------------------------------------------------------
-- Supabase ships `alter default privileges in schema public grant all on tables
-- to anon, authenticated, service_role`. Every table in migration 001 was
-- therefore handed to `anon` at the instant of creation, before a policy
-- existed. RLS hides the rows so nothing looks wrong — but a missing privilege
-- is a 403 nobody can talk past, while a missing policy is a quiet empty result
-- that the next „fix" turns into a leak. Both walls, checked separately.
select is_empty(
  $$ select table_schema || '.' || table_name || ' / ' || privilege_type
       from information_schema.role_table_grants
      where grantee = 'anon' and table_schema in ('public', 'private') $$,
  'anon holds no privilege on any Nexus table'
);

select is_empty(
  $$ select table_schema || '.' || table_name
       from information_schema.role_table_grants
      where grantee = 'authenticated' and privilege_type = 'DELETE'
        and table_schema in ('public', 'private') $$,
  'authenticated holds no DELETE privilege anywhere'
);

-- ---------------------------------------------------------------------------
-- 15. Metadata in the clear is the conceded risk; the schema is the disclosure.
-- ---------------------------------------------------------------------------
-- A column added without a comment is a leak nobody has written down, and the
-- disclosure silently becomes a description of one afternoon in 2026 rather than
-- a property of the schema.
select is_empty(
  $$ select n.nspname || '.' || c.relname || '.' || a.attname
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       join pg_attribute a on a.attrelid = c.oid
      where n.nspname in ('public', 'private') and c.relkind = 'r'
        and a.attnum > 0 and not a.attisdropped
        and col_description(c.oid, a.attnum) is null $$,
  'every column states what it leaks'
);

-- ---------------------------------------------------------------------------
-- 16. No function this repository wrote may have a mutable search_path.
-- ---------------------------------------------------------------------------
-- A function called from an RLS policy whose search_path is mutable is a
-- privilege-escalation primitive: whoever can create a schema earlier in the
-- path can shadow the table the predicate reads and make it return true.
-- Extension-owned functions are excluded — they are not ours to fix, and pgTAP
-- itself would otherwise fail this.
select is_empty(
  $$ select n.nspname || '.' || p.proname
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'private')
        and p.prokind = 'f'
        and not exists (select 1 from pg_depend d
                         where d.objid = p.oid and d.deptype = 'e')
        and (p.proconfig is null
             or not exists (select 1 from unnest(p.proconfig) cfg
                             where cfg like 'search\_path=%')) $$,
  'every function here pins its search_path'
);

-- ---------------------------------------------------------------------------
-- 16b–16c. Columns a client may never write.
-- ---------------------------------------------------------------------------
-- THE WALL THAT IS NEITHER A POLICY NOR A CONSTRAINT. Every column below is a
-- value some other rule treats as a fact — the server's clock, the server's
-- cursor, a row's identity, a single-use latch, the flag that says whether a
-- client is a browser. None of that survives a table-level `grant insert, update`,
-- and nothing about such a grant looks wrong: the policies are unchanged, the
-- constraints are unchanged, and every isolation assertion in `01_two_users`
-- still passes. What changes is that a client now chooses values the design
-- states.
--
-- Asserted against `information_schema.column_privileges` rather than against the
-- migration text, because that view expands a TABLE-level grant into one row per
-- column — so „somebody replaced the column list with a table grant" and
-- „somebody added one column to the list" produce the same failure here, which is
-- correct: they are the same defect.
select is_empty(
  $$ select p.table_name || '.' || p.column_name
       from information_schema.column_privileges p
       join (values ('sync_objects', 'user_id'), ('sync_objects', 'profile_id'),
                    ('sync_objects', 'collection'), ('sync_objects', 'object_id'),
                    ('sync_objects', 'seq'), ('sync_objects', 'created_at'),
                    ('sync_objects', 'updated_at'),
                    ('devices', 'user_id'), ('devices', 'session_id'),
                    ('devices', 'platform'), ('devices', 'created_at'),
                    ('key_wraps', 'user_id'), ('key_wraps', 'kind'),
                    ('key_wraps', 'profile_id'), ('key_wraps', 'created_at'),
                    ('pairing', 'user_id'), ('pairing', 'code_id'),
                    ('pairing', 'initiator_pub'), ('pairing', 'sealed_payload'),
                    ('pairing', 'completion_token_hash'), ('pairing', 'attempts'),
                    ('pairing', 'consumed_at'), ('pairing', 'expires_at'),
                    ('sync_state', 'user_id'), ('sync_state', 'device_id'),
                    ('sync_state', 'profile_id'), ('sync_state', 'collection')
            ) as f(tbl, col) on f.tbl = p.table_name and f.col = p.column_name
      where p.grantee = 'authenticated' and p.table_schema = 'public'
        and p.privilege_type = 'UPDATE' $$,
  'no identity, latch or server-stated column is UPDATABLE by a client'
);

-- INSERT is a shorter list, because most of these columns must be writable once:
-- a client states its own `user_id` and its own `object_id`. `platform` is on the
-- list at INSERT as well as UPDATE, and it is the only column here for which that
-- is true — it is the one value the server states about a client at the moment
-- the client first appears, and a client that can state it can call itself a
-- desktop.
select is_empty(
  $$ select p.table_name || '.' || p.column_name
       from information_schema.column_privileges p
       join (values ('sync_objects', 'seq'), ('sync_objects', 'created_at'),
                    ('sync_objects', 'updated_at'),
                    ('devices', 'platform'), ('devices', 'created_at'),
                    ('devices', 'revoked_at'),
                    ('pairing', 'attempts'), ('pairing', 'consumed_at'),
                    ('pairing', 'expires_at'), ('pairing', 'responder_pub'),
                    ('pairing', 'responder_confirm')
            ) as f(tbl, col) on f.tbl = p.table_name and f.col = p.column_name
      where p.grantee = 'authenticated' and p.table_schema = 'public'
        and p.privilege_type = 'INSERT' $$,
  'no server-stated column is INSERTABLE by a client'
);

-- ---------------------------------------------------------------------------
-- 17–18. The transition rules RLS structurally cannot express.
-- ---------------------------------------------------------------------------
select has_trigger(
  'public', 'sync_objects', 'sync_objects_guard_before_write',
  'sync_objects carries its BEFORE INSERT OR UPDATE guard'
);

select has_trigger(
  'public', 'key_wraps', 'key_wraps_guard_before_update',
  'key_wraps carries the guard that refuses a re-wrap at the old nonce'
);

select has_trigger(
  'public', 'devices', 'devices_guard_before_update',
  'devices carries the guard that makes revoked_at terminal'
);

select * from finish();

rollback;
