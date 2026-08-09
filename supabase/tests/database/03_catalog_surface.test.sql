-- THE SURFACE, not the policies. Requires a live database:
--   supabase start && supabase db reset && supabase test db
--
-- `00` proves the wall is present and `01` proves it holds against a second
-- user. Both look at tables and policies. This file looks at everything ELSE a
-- client can reach, because every one of those is a way to arrive at the same
-- rows without a policy being consulted:
--
--   - a VIEW is not covered by the underlying table's RLS unless it is
--     `security_invoker`; a view owned by `postgres` over `sync_objects` reads
--     every user's ciphertext and no policy ever runs;
--   - a `security definer` function runs as its owner, so it is a hole with a
--     name — the point of one is precisely to bypass the caller's rights;
--   - a function without a pinned `search_path` can be made to call an
--     attacker's `public.now()` if the caller controls their own search path;
--   - the `anon` role is what the publishable key presents as, so „anon reads
--     nothing" is the only assertion that speaks to an attacker who has no
--     account at all — `01` uses two real users and cannot see this gap;
--   - a PUBLIC storage bucket serves every byte in it to anyone with the URL,
--     with RLS untouched.
--
-- WHAT IS DELIBERATELY NOT ASSERTED HERE. `graphql`/`graphql_public` keep their
-- stock grants. Supabase's `issue_pg_graphql_access` event trigger re-grants
-- them on every DDL statement, so a `revoke` in a migration is undone by the
-- next migration and would be a gate that reports a state it does not hold. The
-- substantive protection is that `pg_graphql` resolves as the CALLING role, so
-- every policy in `00`/`01` applies identically through it — GraphQL is a second
-- door into the same walled room, not a second room. `config.toml`'s
-- `schemas = ["public"]` keeps it off the HTTP surface as well.

begin;

set local search_path = public, extensions;

select plan(14);

-- ---------------------------------------------------------------------------
-- 1. Nothing but ordinary tables in the two schemas this repository owns.
-- ---------------------------------------------------------------------------
-- No allowlist, and that is the design: a view over these tables is a decision
-- that has to be argued for, and the way to argue for it is to add it here with
-- `security_invoker` asserted alongside. A test with an empty allowlist that
-- someone has to edit is a test that gets read at the moment it matters.
-- `relkind`: v = view, m = materialized view, f = foreign table, p = partitioned.
-- `relkind` is `"char"` and `text || "char"` has no unique operator, hence the
-- explicit cast rather than the obvious concatenation.
select is_empty(
  $$ select n.nspname || '.' || c.relname || ' (relkind ' || c.relkind::text || ')'
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname in ('public', 'private')
        and c.relkind in ('v', 'm', 'f', 'p') $$,
  'no view, materialized view, foreign table or partitioned table exists'
);

-- ---------------------------------------------------------------------------
-- 2–3. No function bypasses the caller's rights, and none can be misdirected.
-- ---------------------------------------------------------------------------
-- `security definer` is not forbidden forever — tombstone GC will need one. It
-- is forbidden until someone adds it here with its reason, because the whole
-- point of the modifier is to run as the owner, and the owner is `postgres`,
-- which has `bypassrls`.
select is_empty(
  $$ select n.nspname || '.' || p.proname
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'private') and p.prosecdef $$,
  'no SECURITY DEFINER routine exists in the schemas this repository owns'
);

-- Every routine pins `search_path`, definer or not. An invoker function is run
-- with the CALLER's search path, so an unqualified `now()` inside a trigger
-- resolves against whatever the caller put in front of `pg_catalog` — which for
-- `sync_objects_guard` would mean a client choosing what „server clock" means.
select is_empty(
  $$ select n.nspname || '.' || p.proname
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'private')
        and not exists (
          select 1 from unnest(coalesce(p.proconfig, '{}')) as cfg
           where cfg like 'search_path=%'
        ) $$,
  'every routine pins its own search_path'
);

-- ---------------------------------------------------------------------------
-- 4. `anon` cannot call anything.
-- ---------------------------------------------------------------------------
-- `anon` is the role the publishable key presents as — the key that ships inside
-- the web bundle and is therefore public by construction. The RPCs are called by
-- the Edge Function with the secret key, so `service_role` is the only caller
-- any of them needs.
select is_empty(
  $$ select n.nspname || '.' || p.proname
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'private')
        and has_function_privilege('anon', p.oid, 'EXECUTE') $$,
  'anon holds EXECUTE on no routine in public or private'
);

-- ---------------------------------------------------------------------------
-- 5. The private schema is private.
-- ---------------------------------------------------------------------------
-- `authenticated` keeps USAGE deliberately: the restrictive session gate calls
-- `private.nexus_session_is_live()` as the invoking role, so revoking this would
-- not tighten the wall, it would remove it. What keeps the schema off the wire
-- is `config.toml`'s `schemas = ["public"]`, and what keeps it off `anon` is
-- this.
select ok(
  not has_schema_privilege('anon', 'private', 'USAGE'),
  'anon has no USAGE on the private schema'
);

-- ---------------------------------------------------------------------------
-- 6. Every bucket is private.
-- ---------------------------------------------------------------------------
-- `public = true` is not a weak policy; it is a bypass of the entire concept,
-- and it is one click in the dashboard. The bytes are client-encrypted before
-- upload, so this is the second wall — but a second wall that is down is the
-- reason the first one is the only one.
select is_empty(
  $$ select id from storage.buckets where public $$,
  'no storage bucket is public'
);

select ok(
  exists (select 1 from storage.buckets where id = 'nexus-attachments' and not public),
  'the nexus-attachments bucket exists and is private'
);

-- ---------------------------------------------------------------------------
-- 7–13. `anon` reads nothing, from any exposed table.
-- ---------------------------------------------------------------------------
-- Seeded first, as the migration role, so that „anon sees nothing" is a claim
-- about the wall and not about an empty database. Every one of these tables has
-- rows underneath the assertion.
insert into auth.users (instance_id, id, aud, role, email, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000',
        'cccccccc-0000-4000-8000-000000000003',
        'authenticated', 'authenticated', 'c@nexus.test', now(), now());

insert into public.devices (id, user_id, session_id, platform, name_nonce, name_ciphertext)
values ('d0000000-0000-4000-8000-00000000000c', 'cccccccc-0000-4000-8000-000000000003',
        'c5000000-0000-4000-8000-000000000003', 'desktop',
        decode(repeat('33', 24), 'hex'), decode(repeat('cc', 32), 'hex'));

-- The content-key wrap first: a row may only name a generation whose key is
-- stored (migration 003, NX007).
insert into public.key_wraps (user_id, kind, profile_id, epoch, nonce, wrapped, commit_tag)
values ('cccccccc-0000-4000-8000-000000000003', 'ck_under_mk',
        '33333333-3333-4333-8333-333333333333', 1,
        decode(repeat('c1', 24), 'hex'), decode(repeat('c2', 48), 'hex'),
        decode(repeat('c4', 32), 'hex'));

insert into public.sync_objects
  (user_id, profile_id, collection, object_id, version, nonce, ciphertext)
values ('cccccccc-0000-4000-8000-000000000003', '33333333-3333-4333-8333-333333333333',
        'tasks', 'c0000000-0000-4000-8000-000000000003', 1,
        decode(repeat('33', 24), 'hex'), decode(repeat('cc', 32), 'hex'));

-- The parameter NAMES are `Argon2idParams` in `@nexus/sync-crypto`'s `port.ts`,
-- not libsodium's `m`/`t`/`p`. This fixture used the short names, which nothing
-- in the product has ever written — and `key_wraps_kdf_params_floor` now checks
-- the shape as well as the values, so an invented spelling is a failing test
-- instead of a wrap a future client cannot read.
insert into public.key_wraps (user_id, kind, nonce, wrapped, commit_tag, kdf_salt, kdf_params)
values ('cccccccc-0000-4000-8000-000000000003', 'mk_under_kwrap',
        decode(repeat('33', 24), 'hex'), decode(repeat('cc', 48), 'hex'),
        decode(repeat('c3', 32), 'hex'),
        decode(repeat('33', 16), 'hex'),
        '{"memoryKiB":262144,"iterations":4,"parallelism":1}'::jsonb);

insert into public.sync_state (user_id, device_id, profile_id, collection, last_seq)
values ('cccccccc-0000-4000-8000-000000000003',
        'd0000000-0000-4000-8000-00000000000c',
        '33333333-3333-4333-8333-333333333333', 'tasks', 1);

insert into public.pairing
  (user_id, code_id, initiator_pub, sealed_payload, completion_token_hash)
values ('cccccccc-0000-4000-8000-000000000003',
        decode(repeat('31', 32), 'hex'), decode(repeat('32', 32), 'hex'),
        decode(repeat('33', 32), 'hex'), decode(repeat('34', 32), 'hex'));

-- No `request.jwt.claims` at all, which is the honest shape of an anonymous
-- request: `auth.uid()` is null and there is no session to be live.
set local role anon;

-- THE REFUSAL IS 42501, NOT AN EMPTY RESULT, and the difference is the finding.
-- These assertions were first written as `is_empty` — „anon sees no rows" —
-- which is what a policy-shaped refusal looks like. Running them showed
-- `permission denied for table sync_objects` instead: migration 002 opens with
-- `revoke all … from anon` on every table, so the request never reaches a policy
-- at all. Asserting the stronger shape is the point. `is_empty` would still pass
-- on the day somebody re-granted `select` to anon and left the wall to the
-- policies — one layer thinner, silently.
select throws_ok($$ select object_id from public.sync_objects $$,
  '42501'::char(5), NULL::text, 'anon is refused sync_objects before any policy runs');
select throws_ok($$ select id from public.devices $$,
  '42501'::char(5), NULL::text, 'anon is refused devices before any policy runs');
select throws_ok($$ select id from public.key_wraps $$,
  '42501'::char(5), NULL::text, 'anon is refused key_wraps before any policy runs');
select throws_ok($$ select device_id from public.sync_state $$,
  '42501'::char(5), NULL::text, 'anon is refused sync_state before any policy runs');
select throws_ok($$ select id from public.pairing $$,
  '42501'::char(5), NULL::text, 'anon is refused pairing before any policy runs');

-- `storage.objects` is the exception, and it is an honest one: Supabase grants
-- `anon` the full set on its own tables and this repository cannot revoke them
-- — `revoke` from a non-grantor is a no-op that reports `REVOKE` and changes
-- nothing, which was verified rather than assumed. So here the wall really is
-- the policy, and `is_empty` is the assertion that matches.
select is_empty($$ select id from storage.objects $$,
  'anon reads nothing from storage.objects — the policy is the wall here');

-- Writing, not just reading. A refusal to read that is not a refusal to write
-- leaves an anonymous caller able to fill the account with rows that every
-- honest device will then try to decrypt.
select throws_ok(
  $$ insert into public.sync_objects
       (user_id, profile_id, collection, object_id, version, nonce, ciphertext)
     values ('cccccccc-0000-4000-8000-000000000003',
             '33333333-3333-4333-8333-333333333333', 'tasks',
             'c0000000-0000-4000-8000-0000000000ff', 1,
             decode(repeat('99', 24), 'hex'), decode(repeat('99', 32), 'hex')) $$,
  '42501'::char(5), NULL::text,
  'anon cannot insert into sync_objects'
);

reset role;

select * from finish();
rollback;
