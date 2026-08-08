-- THE FOUR ILLEGAL UPDATES. Requires a live database:
--   supabase start && supabase db reset && supabase test db
--
-- WHY THIS FILE DOES NOT SWITCH TO `authenticated`. Migration 002 withholds the
-- UPDATE privilege on `user_id`, `profile_id`, `collection` and `object_id`, so
-- an identity-mutation attempt from a client role dies at the parser with 42501
-- and never reaches the trigger. A test written that way passes — and keeps
-- passing after somebody drops the trigger entirely, because the error it was
-- asserting came from somewhere else. So these run as the migration role, where
-- privileges are not the thing failing, and every assertion names the trigger's
-- own SQLSTATE. `01_two_users.test.sql` covers the privilege wall separately;
-- both walls exist, and each is proved from the position where only it applies.
--
-- The SQLSTATEs are the trigger's contract with the sync client, not decoration:
-- NX001 is the optimistic-concurrency conflict, whose correct handling is
-- re-read and merge, and NX002/3/4 are „this write was never legal", whose
-- correct handling is to stop and report a bug. Asserting them by code is what
-- keeps the two from being collapsed into one retry loop.

begin;

set local search_path = public, extensions;

select plan(19);

-- ASSERTED FIRST, so a misconfigured runner produces one clear failure instead
-- of sixteen confusing ones. Every table here has FORCE row level security,
-- which removes the OWNER's exemption too, and every policy is addressed `TO
-- authenticated` — so a migration role that is neither superuser nor BYPASSRLS
-- matches no policy at all and is denied everything. That is the wall working
-- correctly and this suite being run from the wrong seat.
select ok(
  (select rolsuper or rolbypassrls from pg_roles where rolname = current_user),
  'the test role can bypass RLS — this suite is for the local stack'
);

insert into auth.users (instance_id, id, aud, role, email, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', 'aaaaaaaa-0000-4000-8000-000000000001',
        'authenticated', 'authenticated', 'a@nexus.test', now(), now());

insert into public.sync_objects
  (user_id, profile_id, collection, object_id, version, nonce, ciphertext)
values ('aaaaaaaa-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
        'tasks', 'a0000000-0000-4000-8000-000000000001', 10,
        decode(repeat('11', 24), 'hex'), decode(repeat('aa', 32), 'hex'));

-- ---------------------------------------------------------------------------
-- RULE 1 — the version strictly increases.
-- ---------------------------------------------------------------------------
-- Equality is rejected along with regress. The version is bound into the AEAD
-- associated data, so a same-version write carrying different ciphertext is
-- either a forgery attempt or a client that has lost its counter, and there is
-- no reading under which the server should keep the newer bytes.
select throws_ok(
  $$ update public.sync_objects set version = 10
      where object_id = 'a0000000-0000-4000-8000-000000000001' $$,
  'NX001'::char(5), NULL::text,
  'a write at the same version is refused'
);

select throws_ok(
  $$ update public.sync_objects set version = 9
      where object_id = 'a0000000-0000-4000-8000-000000000001' $$,
  'NX001'::char(5), NULL::text,
  'a write at a lower version is refused'
);

-- ---------------------------------------------------------------------------
-- RULE 2 — the step is bounded.
-- ---------------------------------------------------------------------------
-- This is the lock-out defence. One statement writing `version = 2^53-1` with
-- garbage ciphertext would be latched by every honest client as that object's
-- anti-rollback high-water mark, and no real edit could ever win again — not
-- even after restoring the server, because the poison would already be inside
-- every device.
select throws_ok(
  $$ update public.sync_objects set version = 9007199254740991
      where object_id = 'a0000000-0000-4000-8000-000000000001' $$,
  'NX002'::char(5), NULL::text,
  'a jump to the top of the version space is refused'
);

select throws_ok(
  $$ update public.sync_objects set version = 10 + 65537
      where object_id = 'a0000000-0000-4000-8000-000000000001' $$,
  'NX002'::char(5), NULL::text,
  'a step one past the bound is refused'
);

-- Every successful update below carries a NEW nonce, because RULE 5 refuses one
-- that does not. That is not test scaffolding to be worked around: a version's
-- ciphertext is a fresh encryption, and a fresh encryption under XChaCha20-
-- Poly1305 needs a fresh nonce or it publishes the XOR of the two plaintexts and
-- the key that forges either of them.
select lives_ok(
  $$ update public.sync_objects
        set version = 10 + 65536, nonce = decode(repeat('21', 24), 'hex')
      where object_id = 'a0000000-0000-4000-8000-000000000001' $$,
  'a step exactly at the bound is allowed — the boundary is not off by one'
);

-- ---------------------------------------------------------------------------
-- RULE 3 — a tombstone is terminal.
-- ---------------------------------------------------------------------------
select lives_ok(
  $$ update public.sync_objects
        set deleted = true, version = version + 1,
            nonce = decode(repeat('31', 24), 'hex')
      where object_id = 'a0000000-0000-4000-8000-000000000001' $$,
  'an object can be tombstoned'
);

-- Still editable after deletion: a compaction may rewrite the payload, and the
-- version must keep climbing. Only the bit is one-way.
select lives_ok(
  $$ update public.sync_objects
        set ciphertext = decode(repeat('cc', 32), 'hex'), version = version + 1,
            nonce = decode(repeat('41', 24), 'hex')
      where object_id = 'a0000000-0000-4000-8000-000000000001' $$,
  'a tombstone can still be compacted'
);

select throws_ok(
  $$ update public.sync_objects set deleted = false, version = version + 1
      where object_id = 'a0000000-0000-4000-8000-000000000001' $$,
  'NX003'::char(5), NULL::text,
  'a tombstone cannot be resurrected'
);

-- ---------------------------------------------------------------------------
-- RULE 4 — identity is immutable, in all four columns.
-- ---------------------------------------------------------------------------
-- Each is asserted separately. A single test that changes all four at once
-- passes as long as ANY one of them is checked, so it would keep passing after
-- three of the four comparisons were deleted.
insert into auth.users (instance_id, id, aud, role, email, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', 'bbbbbbbb-0000-4000-8000-000000000002',
        'authenticated', 'authenticated', 'b@nexus.test', now(), now());

select throws_ok(
  $$ update public.sync_objects
        set user_id = 'bbbbbbbb-0000-4000-8000-000000000002', version = version + 1
      where object_id = 'a0000000-0000-4000-8000-000000000001' $$,
  'NX004'::char(5), NULL::text,
  'user_id is immutable'
);

select throws_ok(
  $$ update public.sync_objects
        set profile_id = '99999999-9999-4999-8999-999999999999', version = version + 1
      where object_id = 'a0000000-0000-4000-8000-000000000001' $$,
  'NX004'::char(5), NULL::text,
  'profile_id is immutable — a local-only profile cannot be moved into a synced one'
);

select throws_ok(
  $$ update public.sync_objects set collection = 'notes', version = version + 1
      where object_id = 'a0000000-0000-4000-8000-000000000001' $$,
  'NX004'::char(5), NULL::text,
  'collection is immutable'
);

select throws_ok(
  $$ update public.sync_objects
        set object_id = 'c0000000-0000-4000-8000-000000000003', version = version + 1
      where object_id = 'a0000000-0000-4000-8000-000000000001' $$,
  'NX004'::char(5), NULL::text,
  'object_id is immutable'
);

-- ---------------------------------------------------------------------------
-- RULE 5 — the nonce is fresh on every write.
-- ---------------------------------------------------------------------------
-- This assertion is placed AFTER the identity block deliberately, because the
-- trigger checks the rules in that order and an update that breaks two rules must
-- report the more specific one. Here nothing else is wrong: the version climbs by
-- one, the tombstone stays true, the identity is untouched, and the only defect is
-- that the ciphertext for this version would be encrypted at the nonce the
-- previous version used. Under XChaCha20-Poly1305 that is not a weakening — the
-- keystream is a function of (key, nonce) alone, so the two versions XOR to the
-- XOR of their plaintexts, and the Poly1305 one-time key repeats, which is enough
-- to forge anything at all under that pair. The AAD does not help: RULE 1 makes
-- the associated data differ on every version, and associated data never reaches
-- the keystream.
select throws_ok(
  $$ update public.sync_objects set version = version + 1
      where object_id = 'a0000000-0000-4000-8000-000000000001' $$,
  'NX005'::char(5), NULL::text,
  'a new version at the previous nonce is refused'
);

-- ---------------------------------------------------------------------------
-- The server's own facts.
-- ---------------------------------------------------------------------------
-- `seq` MUST move on every update, and this assertion is the one protecting the
-- least obvious failure in the whole subsystem. `seq` is the pull cursor: if it
-- kept the value assigned at INSERT, a row edited today would still sit at its
-- original position in the log, behind the watermark of every device that has
-- already synced past it. Sync would deliver creations and silently drop
-- modifications, on a schedule set by how old each object is.
create temporary table seq_probe as
  select seq as before_seq, created_at as before_created
    from public.sync_objects
   where object_id = 'a0000000-0000-4000-8000-000000000001';

update public.sync_objects
   set version = version + 1,
       nonce = decode(repeat('51', 24), 'hex'),
       updated_at = timestamptz '2000-01-01 00:00:00+00',
       created_at = timestamptz '2000-01-01 00:00:00+00'
 where object_id = 'a0000000-0000-4000-8000-000000000001';

select ok(
  (select o.seq > p.before_seq
     from public.sync_objects o, seq_probe p
    where o.object_id = 'a0000000-0000-4000-8000-000000000001'),
  'seq advances on update, so an edit reaches devices that already synced past it'
);

select ok(
  (select o.updated_at > timestamptz '2020-01-01 00:00:00+00'
     from public.sync_objects o
    where o.object_id = 'a0000000-0000-4000-8000-000000000001'),
  'updated_at is stamped by the server, not accepted from the writer'
);

select ok(
  (select o.created_at = p.before_created
     from public.sync_objects o, seq_probe p
    where o.object_id = 'a0000000-0000-4000-8000-000000000001'),
  'created_at survives an attempt to rewrite history'
);

-- ---------------------------------------------------------------------------
-- The step bound applies to a CREATION too.
-- ---------------------------------------------------------------------------
-- The lock-out defence used to fire on UPDATE only, on the reasoning that a first
-- version was „bounded by the range CHECK" — which bounds it at 2^53-1, the exact
-- number the defence exists to refuse. So an object could be born frozen: one
-- INSERT at the top of the version space, and every honest client latches that as
-- the object's anti-rollback high-water mark forever. A creation is a step from an
-- implicit version 0 and is bounded by the same constant as any other step.
select throws_ok(
  $$ insert into public.sync_objects
       (user_id, profile_id, collection, object_id, version, nonce, ciphertext)
     values ('aaaaaaaa-0000-4000-8000-000000000001',
             '11111111-1111-4111-8111-111111111111', 'tasks',
             'f0000000-0000-4000-8000-00000000000f', 65537,
             decode(repeat('11', 24), 'hex'), decode(repeat('aa', 32), 'hex')) $$,
  'NX002'::char(5), NULL::text,
  'an object cannot be CREATED above the step bound, only stepped up to it'
);

-- ---------------------------------------------------------------------------
-- The ceiling, which is a CHECK rather than a trigger rule.
-- ---------------------------------------------------------------------------
-- 2^53-1, because every client here is JavaScript and `JSON.parse` turns a bigint
-- above that into a `number` that is silently not the value that was sent. An
-- object that reached it would start comparing wrong in the merge rather than
-- failing.
--
-- THE TRIGGER IS DISABLED FOR THIS ONE STATEMENT, AND THAT IS THE POINT OF THE
-- ASSERTION. With the trigger on, the step bound refuses this insert long before
-- the ceiling is consulted, so a test run against the live trigger would prove the
-- trigger twice and the CHECK never — and would keep passing after the constraint
-- was dropped. The ceiling exists precisely for the paths where the trigger does
-- not run: `session_replication_role = 'replica'` during a logical restore
-- disables user triggers and leaves CHECK constraints standing, and that is the
-- path along which a poisoned row would arrive unexamined. Two mechanisms, each
-- proved from the position where only it applies.
alter table public.sync_objects disable trigger sync_objects_guard_before_write;

select throws_ok(
  $$ insert into public.sync_objects
       (user_id, profile_id, collection, object_id, version, nonce, ciphertext)
     values ('aaaaaaaa-0000-4000-8000-000000000001',
             '11111111-1111-4111-8111-111111111111', 'tasks',
             'e0000000-0000-4000-8000-00000000000e', 9007199254740992,
             decode(repeat('11', 24), 'hex'), decode(repeat('aa', 32), 'hex')) $$,
  '23514'::char(5), NULL::text,
  'a version above 2^53-1 is refused by the range CHECK even with no trigger'
);

alter table public.sync_objects enable trigger sync_objects_guard_before_write;

select * from finish();

rollback;
