-- REVOCATION ENDS THE SESSION, RUN. Requires a live database:
--   supabase start && supabase db reset && supabase test db
--
-- Migration 015 adds an AFTER trigger on `public.devices`: the transition from
-- `revoked_at is null` to a timestamp deletes the GoTrue session the row is
-- bound to, so the refresh token in the revoked machine's hands dies with the
-- wall's refusal of its access tokens. Before it, §6.2 of the README recorded
-- that revocation was one timestamp and the session lived on.
--
-- WHAT IS ASSERTED, AND WHY EACH ONE IS HERE.
--   1. the test seat (the other database suites' precondition);
--   2. the fixture is live before anything happens;
--   3. the revocation itself succeeds;
--   4. the matching `auth.sessions` row is gone;
--   5. the sibling desktop on the SAME account keeps its session;
--   6. the device row survives — a revoked row is history, not something to
--      delete;
--   7. another account's session is untouched;
--   8. a row naming a session that no longer exists is a no-op, not an error
--      (the `nexus_device_register` "stranded" path);
--   9. the revocation cannot be walked back — the BEFORE guard still owns that;
--  10. an update that does not revoke still works;
--  11. and does not disturb the session;
--  12. `authenticated` cannot call the helper directly.
--
-- The session-delete is asserted directly; the refresh-token cascade is GoTrue's
-- own FK (`auth.refresh_tokens.session_id on delete cascade`) and is not
-- re-asserted here, because a fixture for it would be asserting GoTrue's schema
-- rather than this migration's effect.

begin;

set local search_path = public, extensions;

select plan(12);

select ok(
  (select rolsuper or rolbypassrls from pg_roles where rolname = current_user),
  'the test role can bypass RLS — this suite is for the local stack'
);

-- ---------------------------------------------------------------------------
-- Seed. Nothing here asserts anything.
-- ---------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', 'aaaaaaaa-0000-4000-8000-0000000000a1',
   'authenticated', 'authenticated', 'revoke-a@neagle.test', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'bbbbbbbb-0000-4000-8000-0000000000b1',
   'authenticated', 'authenticated', 'revoke-b@neagle.test', now(), now(), now());

insert into auth.sessions (id, user_id, created_at, updated_at, aal, not_after)
values
  -- A's two desktops.
  ('a0000000-0000-4000-8000-0000000000d1', 'aaaaaaaa-0000-4000-8000-0000000000a1',
   now(), now(), 'aal1', null),
  ('a0000000-0000-4000-8000-0000000000d2', 'aaaaaaaa-0000-4000-8000-0000000000a1',
   now(), now(), 'aal1', null),
  -- B's, to prove the trigger is scoped by the row it fires on.
  ('b0000000-0000-4000-8000-0000000000d1', 'bbbbbbbb-0000-4000-8000-0000000000b1',
   now(), now(), 'aal1', null);

insert into public.devices (id, user_id, session_id, platform, name_nonce, name_ciphertext)
values
  ('d0000000-0000-4000-8000-0000000000d1', 'aaaaaaaa-0000-4000-8000-0000000000a1',
   'a0000000-0000-4000-8000-0000000000d1', 'desktop',
   decode(repeat('11', 24), 'hex'), decode(repeat('22', 32), 'hex')),
  ('d0000000-0000-4000-8000-0000000000d2', 'aaaaaaaa-0000-4000-8000-0000000000a1',
   'a0000000-0000-4000-8000-0000000000d2', 'desktop',
   decode(repeat('11', 24), 'hex'), decode(repeat('22', 32), 'hex')),
  -- A's stranded row: it names a session that was never inserted, which is the
  -- state `nexus_device_register` exists to repair.
  ('d0000000-0000-4000-8000-0000000000d3', 'aaaaaaaa-0000-4000-8000-0000000000a1',
   'a0000000-0000-4000-8000-00000000dead', 'desktop',
   decode(repeat('11', 24), 'hex'), decode(repeat('22', 32), 'hex'));

-- ---------------------------------------------------------------------------
-- The transition.
-- ---------------------------------------------------------------------------
select is(
  (select count(*) from auth.sessions
    where id in ('a0000000-0000-4000-8000-0000000000d1',
                 'a0000000-0000-4000-8000-0000000000d2')),
  2::bigint,
  'both of A''s desktop sessions are live before anything is revoked'
);

select lives_ok(
  $$ update public.devices set revoked_at = now()
      where id = 'd0000000-0000-4000-8000-0000000000d1' $$,
  'revoking a device succeeds'
);

select is(
  (select count(*) from auth.sessions
    where id = 'a0000000-0000-4000-8000-0000000000d1'),
  0::bigint,
  'and deletes the GoTrue session the device row was bound to'
);

select is(
  (select count(*) from auth.sessions
    where id = 'a0000000-0000-4000-8000-0000000000d2'),
  1::bigint,
  'the sibling desktop on the same account keeps its session'
);

-- The row is the record of the revocation. Deleting it would make „this machine
-- was revoked" indistinguishable from „this machine never paired".
select is(
  (select d.revoked_at is not null from public.devices d
    where d.id = 'd0000000-0000-4000-8000-0000000000d1'),
  true,
  'the revoked device row stays, and stays revoked'
);

select is(
  (select count(*) from auth.sessions
    where user_id = 'bbbbbbbb-0000-4000-8000-0000000000b1'),
  1::bigint,
  'another account''s session is untouched'
);

-- The stranded path. There is no session to delete, and that must be quiet: the
-- device-register function revokes rows whose session it already found missing.
select lives_ok(
  $$ update public.devices set revoked_at = now()
      where id = 'd0000000-0000-4000-8000-0000000000d3' $$,
  'revoking a row whose session is already gone is a no-op, not an error'
);

select throws_ok(
  $$ update public.devices set revoked_at = null
      where id = 'd0000000-0000-4000-8000-0000000000d1' $$,
  'NX201'::char(5), NULL::text,
  'and the revocation cannot be walked back — the BEFORE guard still owns that'
);

-- An ordinary update that is not a revocation must not reach the trigger's
-- transition, even though it names columns on the same row.
select lives_ok(
  $$ update public.devices set last_seen_at = now()
      where id = 'd0000000-0000-4000-8000-0000000000d2' $$,
  'a device that is not being revoked can still update its row'
);

select is(
  (select count(*) from auth.sessions
    where id = 'a0000000-0000-4000-8000-0000000000d2'),
  1::bigint,
  'and that update does not touch its session'
);

-- The helper is a trigger function in `private`; no client role may call it, and
-- a trigger function that could be called directly would be a session-deletion
-- lever for anyone who guessed a session id.
select ok(
  not has_function_privilege(
    'authenticated', 'private.nexus_end_device_session()', 'EXECUTE'),
  'authenticated may not call the session-ending function directly'
);

select * from finish();

rollback;
