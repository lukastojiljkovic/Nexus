-- THE MASTER-KEY MINT, RUN. Requires a live database:
--   supabase start && supabase db reset && supabase test db
--
-- `nexus_mk_mint` decides who owns the root of an account's key hierarchy, and
-- every one of its refusals is a security control. README §6.4 already records
-- three routines whose concurrency and latch arguments live only in comments;
-- this function is not joining that list.
--
-- WHAT CANNOT BE ASSERTED HERE, STATED SO THE ABSENCE IS NOT MISTAKEN FOR
-- COVERAGE. The real race — two desktops minting in the same millisecond — needs
-- two sessions committing concurrently, and pgTAP runs one transaction that
-- rolls back. So the serializer is asserted as what it IS, a unique index that
-- refuses the second row (`key_wraps_one_per_slot`), rather than as a race that
-- was staged. The fast path returning 'already_minted' is asserted separately,
-- and is only an optimisation: it is the index that makes the rule true.
--
-- The function is `security invoker` and this suite runs as the migration role,
-- which is neither `anon` nor `authenticated` nor `service_role` — so „who may
-- execute it" is asserted by switching role, at the end.

begin;

set local search_path = public, extensions;

select plan(20);

select ok(
  (select rolsuper or rolbypassrls from pg_roles where rolname = current_user),
  'the test role can bypass RLS — this suite is for the local stack'
);

-- ---------------------------------------------------------------------------
-- Seed. Nothing here asserts anything.
-- ---------------------------------------------------------------------------
-- Three accounts, each isolating one refusal: A is well-formed, B armed its
-- factor AFTER the session that is trying to mint, C never confirmed its email.
insert into auth.users
  (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', 'aaaaaaaa-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'a@nexus.test', timestamptz '2025-01-01 00:00:00+00',
   now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'bbbbbbbb-0000-4000-8000-000000000002',
   'authenticated', 'authenticated', 'b@nexus.test', timestamptz '2025-01-01 00:00:00+00',
   now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'cccccccc-0000-4000-8000-000000000003',
   'authenticated', 'authenticated', 'c@nexus.test', null, now(), now());

-- The factors. A's and C's predate every session below; B's does not, which is
-- the single difference that produces NX303.
insert into auth.mfa_factors
  (id, user_id, friendly_name, factor_type, status, created_at, updated_at)
values
  ('f1000000-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001',
   'phone', 'totp', 'verified', timestamptz '2025-06-01 00:00:00+00', now()),
  ('f1000000-0000-4000-8000-000000000002', 'bbbbbbbb-0000-4000-8000-000000000002',
   'phone', 'totp', 'verified', timestamptz '2026-06-01 00:00:00+00', now()),
  ('f1000000-0000-4000-8000-000000000003', 'cccccccc-0000-4000-8000-000000000003',
   'phone', 'totp', 'verified', timestamptz '2025-06-01 00:00:00+00', now());

-- `not_after` is null throughout: an expiry in the past is a different refusal
-- (NX301) and is asserted with a session id that does not exist at all, which
-- is the same code by the same branch.
insert into auth.sessions (id, user_id, created_at, updated_at, aal, not_after)
values
  -- A: the authorising session, the device session, and a second pair for the
  -- „another device arrives later" assertion.
  ('a0000000-0000-4000-8000-00000000000a', 'aaaaaaaa-0000-4000-8000-000000000001',
   timestamptz '2026-01-01 00:00:00+00', now(), 'aal2', null),
  ('a0000000-0000-4000-8000-00000000000d', 'aaaaaaaa-0000-4000-8000-000000000001',
   timestamptz '2026-01-02 00:00:00+00', now(), 'aal1', null),
  ('a0000000-0000-4000-8000-00000000000e', 'aaaaaaaa-0000-4000-8000-000000000001',
   timestamptz '2026-01-03 00:00:00+00', now(), 'aal2', null),
  ('a0000000-0000-4000-8000-00000000000f', 'aaaaaaaa-0000-4000-8000-000000000001',
   timestamptz '2026-01-04 00:00:00+00', now(), 'aal1', null),
  -- A at aal1, and A at aal2 whose only recorded method is the password.
  ('a1000000-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001',
   timestamptz '2026-01-01 00:00:00+00', now(), 'aal1', null),
  ('a2000000-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000001',
   timestamptz '2026-01-01 00:00:00+00', now(), 'aal2', null),
  -- B and C, each with a well-formed aal2 session, so the only thing that can
  -- fail is the one thing their account is here to test.
  ('b0000000-0000-4000-8000-00000000000a', 'bbbbbbbb-0000-4000-8000-000000000002',
   timestamptz '2026-01-01 00:00:00+00', now(), 'aal2', null),
  ('b0000000-0000-4000-8000-00000000000d', 'bbbbbbbb-0000-4000-8000-000000000002',
   timestamptz '2026-01-02 00:00:00+00', now(), 'aal1', null),
  ('c0000000-0000-4000-8000-00000000000a', 'cccccccc-0000-4000-8000-000000000003',
   timestamptz '2026-01-01 00:00:00+00', now(), 'aal2', null),
  ('c0000000-0000-4000-8000-00000000000d', 'cccccccc-0000-4000-8000-000000000003',
   timestamptz '2026-01-02 00:00:00+00', now(), 'aal1', null);

insert into auth.mfa_amr_claims (id, session_id, created_at, updated_at, authentication_method)
values
  ('c1000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-00000000000a',
   now(), now(), 'totp'),
  ('c1000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-00000000000e',
   now(), now(), 'totp'),
  -- The one that carries the password and nothing else. A session may be
  -- stamped `aal2` while its recorded methods say otherwise, and this is what
  -- makes the AMR clause in the function load-bearing rather than decorative.
  ('c1000000-0000-4000-8000-000000000003', 'a2000000-0000-4000-8000-000000000002',
   now(), now(), 'password'),
  -- THE aal1 SESSION GETS A `totp` CLAIM, WHICH LOOKS BACKWARDS AND IS THE POINT.
  -- Without it that fixture fails two checks at once — no second factor recorded
  -- AND aal1 — and the assertion below passes on whichever runs first. Removing
  -- the assurance check from the function was measured to break nothing, because
  -- the AMR check was quietly covering for it. Giving the session a claim leaves
  -- the `aal` column as the only thing wrong with it, so the assertion tests the
  -- rule it is named after.
  ('c1000000-0000-4000-8000-000000000006', 'a1000000-0000-4000-8000-000000000001',
   now(), now(), 'totp'),
  ('c1000000-0000-4000-8000-000000000004', 'b0000000-0000-4000-8000-00000000000a',
   now(), now(), 'totp'),
  ('c1000000-0000-4000-8000-000000000005', 'c0000000-0000-4000-8000-00000000000a',
   now(), now(), 'totp');

-- The wrap material, spelled once. Every call below is the same fourteen
-- arguments with one thing changed, so a refusal cannot be an accident of a
-- malformed payload.
create function pg_temp.mint(uuid, uuid) returns text language sql as $$
  select public.nexus_mk_mint(
    $1, $2,
    decode(repeat('11', 24), 'hex'), decode(repeat('22', 32), 'hex'),
    decode(repeat('a1', 24), 'hex'), decode(repeat('a2', 48), 'hex'),
    decode(repeat('a3', 32), 'hex'),
    '{"memoryKiB": 65536, "iterations": 3, "parallelism": 1}'::jsonb,
    decode(repeat('b1', 24), 'hex'), decode(repeat('b2', 48), 'hex'),
    decode(repeat('b3', 32), 'hex'), decode(repeat('b4', 16), 'hex'),
    '{"memoryKiB": 65536, "iterations": 3, "parallelism": 1}'::jsonb,
    -- The device-registration proof (migration 013). Written by the same
    -- transaction as the wraps, because nothing can add it afterwards.
    decode(repeat('c1', 32), 'hex'));
$$;

-- ---------------------------------------------------------------------------
-- The refusals, before anything is minted.
-- ---------------------------------------------------------------------------
-- NX306 is the structural half of „the mint session is not the sync session".
-- Written as a refusal rather than as documentation because the alternative is a
-- desktop whose working session is aal2 for life — which `devices_live_session`
-- hands read and write over every device row on the account, and which
-- `pairing_insert_requires_aal2` lets act as a pairing initiator.
select throws_ok(
  $$ select pg_temp.mint('a0000000-0000-4000-8000-00000000000a',
                 'a0000000-0000-4000-8000-00000000000a') $$,
  'NX306'::char(5), NULL::text,
  'the authorising session may not also be the device session'
);

select throws_ok(
  $$ select pg_temp.mint('99999999-9999-4999-8999-999999999999',
                 'a0000000-0000-4000-8000-00000000000d') $$,
  'NX301'::char(5), NULL::text,
  'an authorising session that does not exist is refused'
);

select throws_ok(
  $$ select pg_temp.mint('a0000000-0000-4000-8000-00000000000a',
                 '99999999-9999-4999-8999-999999999999') $$,
  'NX301'::char(5), NULL::text,
  'a device session that does not exist is refused'
);

-- THE ONE THAT MAKES `p_user_id` UNNECESSARY. The account is derived from the
-- session rather than named by the caller, so „mint on somebody else's account"
-- has to be expressed as two sessions that disagree — and is refused.
select throws_ok(
  $$ select pg_temp.mint('a0000000-0000-4000-8000-00000000000a',
                 'b0000000-0000-4000-8000-00000000000d') $$,
  'NX305'::char(5), NULL::text,
  'two sessions on different accounts cannot be combined into one mint'
);

select throws_ok(
  $$ select pg_temp.mint('a1000000-0000-4000-8000-000000000001',
                 'a0000000-0000-4000-8000-00000000000d') $$,
  'NX302'::char(5), NULL::text,
  'an aal1 session cannot mint'
);

-- Re-read from the database, not from the token: the assurance level and the
-- methods that produced it are two different facts and only one of them is a
-- claim anybody could have written.
select throws_ok(
  $$ select pg_temp.mint('a2000000-0000-4000-8000-000000000002',
                 'a0000000-0000-4000-8000-00000000000d') $$,
  'NX302'::char(5), NULL::text,
  'an aal2 session whose only recorded method is the password cannot mint'
);

-- B's factor was armed after this session began — which is what a phisher's
-- self-enrolment looks like, and is measurably reachable on an account that has
-- no factor yet (README §3).
select throws_ok(
  $$ select pg_temp.mint('b0000000-0000-4000-8000-00000000000a',
                 'b0000000-0000-4000-8000-00000000000d') $$,
  'NX303'::char(5), NULL::text,
  'a factor armed after the session began does not authorise a mint'
);

select throws_ok(
  $$ select pg_temp.mint('c0000000-0000-4000-8000-00000000000a',
                 'c0000000-0000-4000-8000-00000000000d') $$,
  'NX304'::char(5), NULL::text,
  'an unconfirmed email address cannot mint'
);

-- ---------------------------------------------------------------------------
-- The mint itself.
-- ---------------------------------------------------------------------------
select is(
  (select pg_temp.mint('a0000000-0000-4000-8000-00000000000a',
               'a0000000-0000-4000-8000-00000000000d')),
  'minted',
  'a well-formed call mints'
);

select set_eq(
  $$ select kind::text from public.key_wraps
      where user_id = 'aaaaaaaa-0000-4000-8000-000000000001' $$,
  $$ values ('mk_under_kwrap'), ('mk_under_src') $$,
  'both master-key wraps exist — an account minted without mk_under_src would '
  'have no recovery path and no way to acquire one'
);

-- AND THE DEVICE-REGISTRATION PROOF, for exactly the reason above. Nothing can
-- write `private.mk_verifiers` except this function and the one that reads it,
-- so an account minted without a verifier could never register a second desktop
-- — and a desktop whose session dies would be stranded with the key on its own
-- disk and no way to present it. The mint is a one-shot; everything a later
-- recovery needs is written here or is never written.
select is(
  (select encode(m.verifier, 'hex') from private.mk_verifiers m
    where m.user_id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  repeat('c1', 32),
  'the master-key proof was stored by the same transaction as the wraps'
);

-- `platform` is the only place in the schema where „this client is a browser"
-- is written down, and no client may state it. This is one of exactly two
-- writers that may say `desktop`.
select is(
  (select d.platform::text from public.devices d
    where d.session_id = 'a0000000-0000-4000-8000-00000000000d'),
  'desktop',
  'the device session that minted is registered as a desktop'
);

-- The retry after a lost response, which is otherwise indistinguishable from
-- losing the race: same call, same answer, no second device row.
select is(
  (select pg_temp.mint('a0000000-0000-4000-8000-00000000000a',
               'a0000000-0000-4000-8000-00000000000d')),
  'minted',
  'the same call repeated is idempotent rather than a conflict'
);

select is(
  (select count(*) from public.devices
    where user_id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  1::bigint,
  'and it registered no second device'
);

-- A DIFFERENT device on the same account. It does NOT adopt: 'already_minted'
-- is terminal, and the routes to the existing MK are pairing and the Recovery
-- Kit. Adoption would authenticate the wrap rather than the minter — and
-- opening under K_wrap proves only knowledge of the password.
select is(
  (select pg_temp.mint('a0000000-0000-4000-8000-00000000000e',
               'a0000000-0000-4000-8000-00000000000f')),
  'already_minted',
  'a second device is told the account is minted, and is given nothing'
);

select is(
  (select count(*) from public.devices
    where user_id = 'aaaaaaaa-0000-4000-8000-000000000001'),
  1::bigint,
  'and it is not registered as a desktop on the strength of having asked'
);

-- THE SERIALIZER, asserted as what it is. Two transactions cannot be staged
-- here; the index that decides between them can.
select throws_ok(
  $$ insert into public.key_wraps
       (user_id, kind, nonce, wrapped, commit_tag, kdf_params)
     values ('aaaaaaaa-0000-4000-8000-000000000001', 'mk_under_kwrap',
             decode(repeat('c1', 24), 'hex'), decode(repeat('c2', 48), 'hex'),
             decode(repeat('c3', 32), 'hex'),
             '{"memoryKiB": 65536, "iterations": 3, "parallelism": 1}'::jsonb) $$,
  '23505'::char(5), NULL::text,
  'a second mk_under_kwrap is refused by the unique index, whoever writes it'
);

-- ---------------------------------------------------------------------------
-- Who may call it.
-- ---------------------------------------------------------------------------
-- Postgres grants EXECUTE to PUBLIC by default and this function lives in the
-- exposed schema, so „it is service-role only" is a revoke that has to have
-- happened. Both client roles are reachable over HTTP with a key printed in the
-- client bundle.
set local role authenticated;
select throws_ok(
  $$ select public.nexus_mk_mint(
       'a0000000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-00000000000f',
       decode(repeat('11', 24), 'hex'), decode(repeat('22', 32), 'hex'),
       decode(repeat('a1', 24), 'hex'), decode(repeat('a2', 48), 'hex'),
       decode(repeat('a3', 32), 'hex'), '{}'::jsonb,
       decode(repeat('b1', 24), 'hex'), decode(repeat('b2', 48), 'hex'),
       decode(repeat('b3', 32), 'hex'), decode(repeat('b4', 16), 'hex'), '{}'::jsonb,
       decode(repeat('c1', 32), 'hex')) $$,
  '42501'::char(5), NULL::text,
  'authenticated may not execute the mint'
);
reset role;

set local role anon;
select throws_ok(
  $$ select public.nexus_mk_mint(
       'a0000000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-00000000000f',
       decode(repeat('11', 24), 'hex'), decode(repeat('22', 32), 'hex'),
       decode(repeat('a1', 24), 'hex'), decode(repeat('a2', 48), 'hex'),
       decode(repeat('a3', 32), 'hex'), '{}'::jsonb,
       decode(repeat('b1', 24), 'hex'), decode(repeat('b2', 48), 'hex'),
       decode(repeat('b3', 32), 'hex'), decode(repeat('b4', 16), 'hex'), '{}'::jsonb,
       decode(repeat('c1', 32), 'hex')) $$,
  '42501'::char(5), NULL::text,
  'anon may not execute the mint'
);
reset role;

select * from finish();

rollback;
