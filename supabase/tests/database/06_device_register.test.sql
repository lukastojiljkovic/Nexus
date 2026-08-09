-- GETTING A DEVICE ROW BACK, RUN. Requires a live database:
--   supabase start && supabase db reset && supabase test db
--
-- `nexus_device_register` is the only path from „this desktop holds the master
-- key and has lost its session" back to „it can read its own data". Migration
-- 013's header carries the argument for why it costs MK and not a second factor;
-- what this suite asserts is that it actually does cost MK, that it cannot be
-- reached by the roles a client holds, and that the row it writes is a desktop
-- bound to a session that is alive.
--
-- WHAT IS NOT ASSERTED HERE, so the absence is not mistaken for coverage. The
-- blinded comparison defends against a timing oracle, and a timing property
-- cannot be asserted by pgTAP — a test that measured it would be a flaky test
-- measuring the machine. It is a two-line construction reviewed in place.
--
-- The function is `security invoker` and this suite runs as the migration role,
-- which is neither `anon` nor `authenticated` nor `service_role` — so „who may
-- execute it" is asserted by switching role, at the end.

begin;

set local search_path = public, extensions;

select plan(15);

select ok(
  (select rolsuper or rolbypassrls from pg_roles where rolname = current_user),
  'the test role can bypass RLS — this suite is for the local stack'
);

-- ---------------------------------------------------------------------------
-- Seed. Nothing here asserts anything.
-- ---------------------------------------------------------------------------
-- Account A has minted; account B has not, which is the whole of NX402.
insert into auth.users
  (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', 'aaaaaaaa-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'a@nexus.test', timestamptz '2025-01-01 00:00:00+00',
   now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'bbbbbbbb-0000-4000-8000-000000000002',
   'authenticated', 'authenticated', 'b@nexus.test', timestamptz '2025-01-01 00:00:00+00',
   now(), now());

insert into auth.sessions (id, user_id, created_at, updated_at, aal, not_after)
values
  -- A's DEAD session is not inserted at all: GoTrue deletes the session row on
  -- sign-out and on revocation, so „stranded" IS „the devices row names a
  -- session id with no row behind it". That is the fixture, and it is why the
  -- device row below points at `a0000000-…-00000000dead`.
  ('a0000000-0000-4000-8000-00000000000d', 'aaaaaaaa-0000-4000-8000-000000000001',
   timestamptz '2026-02-01 00:00:00+00', now(), 'aal1', null),
  -- A second live aal1 session for the same account, for the „a sibling that is
  -- merely offline keeps its row" assertion.
  ('a0000000-0000-4000-8000-00000000000e', 'aaaaaaaa-0000-4000-8000-000000000001',
   timestamptz '2026-02-02 00:00:00+00', now(), 'aal1', null),
  -- A stepped-up session, for NX405. `aal` survives every refresh, so a desktop
  -- that ever holds one holds browser powers for the life of the machine.
  ('a0000000-0000-4000-8000-00000000000c', 'aaaaaaaa-0000-4000-8000-000000000001',
   timestamptz '2026-02-03 00:00:00+00', now(), 'aal2', null),
  -- An expired one, for NX401's other half.
  ('a0000000-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001',
   timestamptz '2026-01-01 00:00:00+00', now(), 'aal1', timestamptz '2026-02-01 00:00:00+00'),
  ('b0000000-0000-4000-8000-00000000000d', 'bbbbbbbb-0000-4000-8000-000000000002',
   timestamptz '2026-02-01 00:00:00+00', now(), 'aal1', null);

-- A has a master key, so it has a verifier. This is what the mint writes.
insert into private.mk_verifiers (user_id, verifier)
values ('aaaaaaaa-0000-4000-8000-000000000001', decode(repeat('c1', 32), 'hex'));

-- A's stranded desktop: a live row naming a session that no longer exists, and
-- an offline sibling whose session is still there.
insert into public.devices (id, user_id, session_id, platform, name_nonce, name_ciphertext)
values
  ('d0000000-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001',
   'a0000000-0000-4000-8000-00000000dead', 'desktop',
   decode(repeat('11', 24), 'hex'), decode(repeat('22', 32), 'hex')),
  ('d0000000-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000001',
   'a0000000-0000-4000-8000-00000000000e', 'desktop',
   decode(repeat('11', 24), 'hex'), decode(repeat('22', 32), 'hex'));

-- The name material, spelled once. Every call below is the same four arguments
-- with one thing changed, so a refusal cannot be an accident of a bad payload.
create function pg_temp.reg(uuid, bytea) returns uuid language sql as $$
  select public.nexus_device_register(
    $1, $2, decode(repeat('33', 24), 'hex'), decode(repeat('44', 32), 'hex'));
$$;

-- ---------------------------------------------------------------------------
-- The refusals.
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ select pg_temp.reg('a0000000-0000-4000-8000-00000000ffff',
                        decode(repeat('c1', 32), 'hex')) $$,
  'NX401'::char(5), NULL::text,
  'a session that does not exist cannot register a device'
);

select throws_ok(
  $$ select pg_temp.reg('a0000000-0000-4000-8000-000000000001',
                        decode(repeat('c1', 32), 'hex')) $$,
  'NX401'::char(5), NULL::text,
  'and neither can one whose not_after has passed'
);

-- The invariant migration 011 keeps at the mint by demanding two distinct
-- sessions. There is only one session here, so it is stated directly.
select throws_ok(
  $$ select pg_temp.reg('a0000000-0000-4000-8000-00000000000c',
                        decode(repeat('c1', 32), 'hex')) $$,
  'NX405'::char(5), NULL::text,
  'a desktop''s working session may not be aal2 — that is a browser''s power'
);

select throws_ok(
  $$ select pg_temp.reg('b0000000-0000-4000-8000-00000000000d',
                        decode(repeat('c1', 32), 'hex')) $$,
  'NX402'::char(5), NULL::text,
  'an account with no master key has nothing to prove possession of'
);

-- THE ONE THAT MATTERS. A caller holding a valid session for this account —
-- which is to say, the password — and not the master key is exactly the attacker
-- `key_wraps_master_key_is_desktop_only` exists to keep away from
-- `mk_under_kwrap`. A desktop row handed out on a session alone would be that
-- policy repealed.
select throws_ok(
  $$ select pg_temp.reg('a0000000-0000-4000-8000-00000000000d',
                        decode(repeat('ff', 32), 'hex')) $$,
  'NX403'::char(5), NULL::text,
  'a valid session without the master key proof is refused'
);

select throws_ok(
  $$ select pg_temp.reg('a0000000-0000-4000-8000-00000000000d',
                        decode(repeat('c1', 31), 'hex')) $$,
  'NX403'::char(5), NULL::text,
  'and so is a truncated proof, which a length-blind compare would accept'
);

select is(
  (select count(*) from public.devices
    where user_id = 'aaaaaaaa-0000-4000-8000-000000000001' and revoked_at is null),
  2::bigint,
  'a refused call retired nothing and registered nothing'
);

-- ---------------------------------------------------------------------------
-- The registration itself.
-- ---------------------------------------------------------------------------
select ok(
  (select pg_temp.reg('a0000000-0000-4000-8000-00000000000d',
                      decode(repeat('c1', 32), 'hex'))) is not null,
  'the right proof buys a device row'
);

select is(
  (select d.platform::text from public.devices d
    where d.session_id = 'a0000000-0000-4000-8000-00000000000d'),
  'desktop',
  'and the row is a desktop — the caller never says so, this function does'
);

-- The stranded row is retired in the same call, so no client has to remember its
-- previous device id across a reinstall.
select is(
  (select d.revoked_at is not null from public.devices d
    where d.id = 'd0000000-0000-4000-8000-000000000001'),
  true,
  'the row whose session no longer exists is retired'
);

-- And the sibling that is merely offline is NOT. An offline desktop still has
-- its session row; only a revoked or signed-out one loses it.
select is(
  (select d.revoked_at from public.devices d
    where d.id = 'd0000000-0000-4000-8000-000000000002'),
  NULL::timestamptz,
  'a sibling whose session is still alive keeps its row'
);

-- The retry after a lost response, which is otherwise indistinguishable from a
-- refusal. The second call comes FIRST and the row count after it: asserting the
-- count before calling again would pass on one registration and prove nothing.
select is(
  (select pg_temp.reg('a0000000-0000-4000-8000-00000000000d',
                      decode(repeat('c1', 32), 'hex'))),
  (select d.id from public.devices d
    where d.session_id = 'a0000000-0000-4000-8000-00000000000d' and d.revoked_at is null),
  'the same call repeated answers with the row it already wrote'
);

select is(
  (select count(*) from public.devices
    where user_id = 'aaaaaaaa-0000-4000-8000-000000000001'
      and session_id = 'a0000000-0000-4000-8000-00000000000d'),
  1::bigint,
  'and wrote no second row'
);

-- ---------------------------------------------------------------------------
-- Who may call it.
-- ---------------------------------------------------------------------------
-- Postgres grants EXECUTE to PUBLIC by default and this function lives in the
-- exposed schema. If `authenticated` could reach it, every argument above would
-- be a value the attacker supplies — including the account, by way of a session
-- it holds.
set local role authenticated;
select throws_ok(
  $$ select public.nexus_device_register(
       'a0000000-0000-4000-8000-00000000000d', decode(repeat('c1', 32), 'hex'),
       decode(repeat('33', 24), 'hex'), decode(repeat('44', 32), 'hex')) $$,
  '42501'::char(5), NULL::text,
  'authenticated may not execute the registration'
);
reset role;

select * from finish();

rollback;
