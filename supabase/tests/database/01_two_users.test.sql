-- TWO USERS, ONE DATABASE. Requires a live database:
--   supabase start && supabase db reset && supabase test db
--
-- This is the test the whole design exists to pass, and it is the one that
-- cannot be replaced by reading code: „user B cannot see user A's rows" is a
-- statement about the interaction of five policies, two privilege sets, one
-- function and the planner, and the only honest way to establish it is to be
-- user B and try.
--
-- THE POSITIVE CONTROLS ARE NOT PADDING. A wall that denies EVERYONE passes
-- every isolation assertion in this file — perfectly, forever, while the product
-- does not work. So each „B sees nothing of A's" is paired with „B sees its own",
-- and the session-gate section asserts both that a bare password session is
-- locked out AND that a paired desktop is not. A test suite that can only fail
-- in one direction is measuring one thing and reporting two.

begin;

-- `extensions` for pgTAP itself; `public` for the tables. Set before the role
-- switches below, because `set local` survives `set role` and re-stating it
-- after each switch is four chances to forget one.
set local search_path = public, extensions;

select plan(29);

-- ASSERTED FIRST, so a misconfigured runner produces one clear failure instead
-- of fifteen confusing ones. The seeding below and the „as postgres" checks in
-- the middle both require a role that RLS does not apply to; every table here
-- has FORCE row level security, which removes even the owner's exemption.
select ok(
  (select rolsuper or rolbypassrls from pg_roles where rolname = current_user),
  'the test role can bypass RLS — this suite is for the local stack'
);

-- ---------------------------------------------------------------------------
-- Seed, as the migration role. Nothing here asserts anything.
-- ---------------------------------------------------------------------------
insert into auth.users (instance_id, id, aud, role, email, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', 'aaaaaaaa-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'a@nexus.test', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'bbbbbbbb-0000-4000-8000-000000000002',
   'authenticated', 'authenticated', 'b@nexus.test', now(), now());

insert into public.devices
  (id, user_id, session_id, platform, name_nonce, name_ciphertext)
values
  ('d0000000-0000-4000-8000-00000000000a', 'aaaaaaaa-0000-4000-8000-000000000001',
   'a5000000-0000-4000-8000-000000000001', 'desktop',
   decode(repeat('11', 24), 'hex'), decode(repeat('aa', 32), 'hex')),
  ('d0000000-0000-4000-8000-00000000000b', 'bbbbbbbb-0000-4000-8000-000000000002',
   'b5000000-0000-4000-8000-000000000002', 'web',
   decode(repeat('22', 24), 'hex'), decode(repeat('bb', 32), 'hex'));

insert into public.key_wraps (user_id, kind, profile_id, epoch, nonce, wrapped, commit_tag)
values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'ck_under_mk',
   '11111111-1111-4111-8111-111111111111', 1,
   decode(repeat('11', 24), 'hex'), decode(repeat('aa', 48), 'hex'),
   decode(repeat('a1', 32), 'hex')),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'ck_under_mk',
   '22222222-2222-4222-8222-222222222222', 1,
   decode(repeat('22', 24), 'hex'), decode(repeat('bb', 48), 'hex'),
   decode(repeat('b1', 32), 'hex'));

-- THE MASTER-KEY WRAPS, which are what the desktop-only policy is about. The
-- `mk_*` kinds take no profile and no epoch (the master key is not rotated by
-- that mechanism) and MUST carry the Argon2id salt and parameters, because they
-- are the two slots derived from a password — `key_wraps_kdf_presence` and
-- `key_wraps_kdf_params_floor` in migration 001 enforce both.
--
-- B gets BOTH slots, because the policy treats them differently on the read side
-- and identically on the write side, and a fixture holding only one can test
-- just half of that. A gets only `mk_under_kwrap`: its role here is the positive
-- control that a paired desktop still reaches the wrap a browser is refused.
--
-- `wrapped` differs from each account's content-key wrap byte for byte, so the
-- „changed nothing" assertion further down cannot pass by comparing a row
-- against itself.
insert into public.key_wraps
  (user_id, kind, nonce, wrapped, commit_tag, kdf_salt, kdf_params)
values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'mk_under_kwrap',
   decode(repeat('a2', 24), 'hex'), decode(repeat('a3', 48), 'hex'),
   decode(repeat('a4', 32), 'hex'), decode(repeat('a5', 16), 'hex'),
   '{"memoryKiB": 65536, "iterations": 3, "parallelism": 1}'::jsonb),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'mk_under_kwrap',
   decode(repeat('b2', 24), 'hex'), decode(repeat('b3', 48), 'hex'),
   decode(repeat('b4', 32), 'hex'), decode(repeat('b5', 16), 'hex'),
   '{"memoryKiB": 65536, "iterations": 3, "parallelism": 1}'::jsonb),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'mk_under_src',
   decode(repeat('b6', 24), 'hex'), decode(repeat('b7', 48), 'hex'),
   decode(repeat('b8', 32), 'hex'), decode(repeat('b9', 16), 'hex'),
   '{"memoryKiB": 65536, "iterations": 3, "parallelism": 1}'::jsonb);

insert into public.sync_objects
  (user_id, profile_id, collection, object_id, version, nonce, ciphertext)
values
  ('aaaaaaaa-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
   'tasks', 'a0000000-0000-4000-8000-000000000001', 1,
   decode(repeat('11', 24), 'hex'), decode(repeat('aa', 32), 'hex')),
  ('bbbbbbbb-0000-4000-8000-000000000002', '22222222-2222-4222-8222-222222222222',
   'tasks', 'b0000000-0000-4000-8000-000000000002', 1,
   decode(repeat('22', 24), 'hex'), decode(repeat('bb', 32), 'hex'));

insert into public.sync_state (user_id, device_id, profile_id, collection, last_seq)
values ('aaaaaaaa-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-00000000000a',
        '11111111-1111-4111-8111-111111111111', 'tasks', 1);

insert into public.pairing
  (user_id, code_id, initiator_pub, sealed_payload, completion_token_hash)
values ('aaaaaaaa-0000-4000-8000-000000000001',
        decode(repeat('11', 32), 'hex'), decode(repeat('12', 32), 'hex'),
        decode(repeat('13', 32), 'hex'), decode(repeat('14', 32), 'hex'));

-- ---------------------------------------------------------------------------
-- User B, at aal2, holding its own live session.
-- ---------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub":"bbbbbbbb-0000-4000-8000-000000000002",'
  '"role":"authenticated","aal":"aal2",'
  '"session_id":"b5000000-0000-4000-8000-000000000002"}';
set local role authenticated;

select is_empty(
  $$ select object_id from public.sync_objects
      where user_id = 'aaaaaaaa-0000-4000-8000-000000000001' $$,
  'B sees none of A''s sync_objects'
);

-- THE POSITIVE CONTROL. Without it, every assertion in this section would still
-- pass if the gate denied all reads to everybody.
select isnt_empty(
  $$ select object_id from public.sync_objects $$,
  'B does see its own sync_objects — the wall is a wall, not a brick'
);

select is_empty(
  $$ select id from public.key_wraps
      where user_id = 'aaaaaaaa-0000-4000-8000-000000000001' $$,
  'B sees none of A''s key wraps'
);

-- The positive control, for the same reason the one above `sync_objects` exists:
-- B holds a content-key wrap of its own now — every profile that holds rows must
-- — so an unscoped `is_empty` would have passed just as well if the gate denied
-- every read to everybody.
select isnt_empty(
  $$ select id from public.key_wraps $$,
  'B does see its own key wrap — the wall is a wall, not a brick'
);

-- THE WRAP WHOSE OPENER THIS SESSION ALREADY HOLDS. B is at aal2 with a live
-- device row, so it passes the session gate completely; it is refused here for
-- the one reason that matters, which is that its device row says `web`. Its own
-- account, its own row, and still no.
--
-- The reason this is a policy at all and not just a fact about which functions
-- the web bundle imports: K_wrap is derived from the web password on the way to
-- K_auth, so this session has the opener by construction. Hand it the wrap and
-- MK follows, and after MK every content key and every row of plaintext.
select is_empty(
  $$ select id from public.key_wraps where kind = 'mk_under_kwrap' $$,
  'a browser at aal2 cannot read MK-under-the-web-password, not even its own'
);

-- AND THE ONE THAT IS DELIBERATELY LEFT READABLE, asserted so that the asymmetry
-- is a decision on the record rather than a gap. `mk_under_src` opens under the
-- Recovery Kit code, which the web password does not yield — so serving it costs
-- nothing against a stolen password, and refusing it would break the only flow
-- it exists for: a brand-new desktop recovering an account, which has no device
-- row yet because obtaining one is what it is trying to do.
select isnt_empty(
  $$ select id from public.key_wraps where kind = 'mk_under_src' $$,
  'MK-under-the-recovery-code stays readable — recovery happens before any device exists'
);

-- The positive control, and it is the whole design in one assertion: a browser
-- is supposed to hold content keys — it receives them through pairing — and is
-- never supposed to hold the key they hang off.
select isnt_empty(
  $$ select id from public.key_wraps where kind = 'ck_under_mk' $$,
  'the same browser still reads its content-key wraps — that is what it pairs for'
);

-- THE WRITE HALF, WHICH IS BROADER THAN THE READ HALF AND IS NOT SYMMETRY. This
-- session cannot open either master-key wrap; it can still be handed `nonce`,
-- `wrapped` and `commit_tag` by the column grant, so without WITH CHECK it could
-- replace one with a wrap of a key it chose. Nothing would be leaked and the
-- account would be destroyed: over `mk_under_kwrap` every real device loses MK,
-- and over `mk_under_src` the way back is gone with it.
select throws_ok(
  $$ insert into public.key_wraps
       (user_id, kind, nonce, wrapped, commit_tag, kdf_salt, kdf_params)
     values ('bbbbbbbb-0000-4000-8000-000000000002', 'mk_under_src',
             decode(repeat('c2', 24), 'hex'), decode(repeat('c3', 48), 'hex'),
             decode(repeat('c4', 32), 'hex'), decode(repeat('c5', 16), 'hex'),
             '{"memoryKiB": 65536, "iterations": 3, "parallelism": 1}'::jsonb) $$,
  '42501'::char(5), NULL::text,
  'a browser at aal2 cannot mint a master-key wrap of its own'
);

-- THE UPDATE OF THE ROW IT CAN READ, which is the sharp one and the only place
-- the read/write asymmetry is observable from a client: `mk_under_src` passes
-- USING, so the statement reaches WITH CHECK and is refused loudly rather than
-- silently matching nothing.
select throws_ok(
  $$ update public.key_wraps
        set wrapped = decode(repeat('ee', 48), 'hex'),
            nonce = decode(repeat('ee', 24), 'hex')
      where kind = 'mk_under_src' $$,
  '42501'::char(5), NULL::text,
  'a browser cannot overwrite the recovery wrap it is allowed to read'
);

-- And the UPDATE of the row it cannot read, which cannot be asserted on the
-- statement: a row filtered out by a policy's USING clause is not an error, it
-- is zero rows and a reported success. So that assertion is made afterwards,
-- against the row.
update public.key_wraps
   set wrapped = decode(repeat('ee', 48), 'hex'), nonce = decode(repeat('ee', 24), 'hex')
 where kind = 'mk_under_kwrap';

select is_empty(
  $$ select id from public.devices
      where user_id = 'aaaaaaaa-0000-4000-8000-000000000001' $$,
  'B sees none of A''s devices'
);

select is_empty(
  $$ select id from public.pairing $$,
  'B sees none of A''s in-flight pairings'
);

select is_empty(
  $$ select collection from public.sync_state $$,
  'B sees none of A''s sync cursors'
);

-- Writing into A's space. The RLS `WITH CHECK` rejects the row outright rather
-- than silently filing it under B, which matters: a silent re-owning would make
-- the attack look like a success to the attacker and like corruption to A.
select throws_ok(
  $$ insert into public.sync_objects
       (user_id, profile_id, collection, object_id, version, nonce, ciphertext)
     values ('aaaaaaaa-0000-4000-8000-000000000001',
             '11111111-1111-4111-8111-111111111111', 'tasks',
             'c0000000-0000-4000-8000-000000000003', 1,
             decode(repeat('33', 24), 'hex'), decode(repeat('cc', 32), 'hex')) $$,
  '42501'::char(5), NULL::text,
  'B cannot insert a row into A''s space'
);

-- The privilege wall, which is a different wall from the policy wall and fails
-- in a different direction. There is no DELETE policy, so a DELETE would affect
-- zero rows and report 204 success; withholding the privilege makes it 42501.
select throws_ok(
  $$ delete from public.sync_objects $$,
  '42501'::char(5), NULL::text,
  'B cannot DELETE at all — the privilege is withheld, not just the policy'
);

-- Moving a row B legitimately owns into A's space. Blocked by the column-level
-- grant before any row is examined; the guard trigger would catch it too.
select throws_ok(
  $$ update public.sync_objects
        set user_id = 'aaaaaaaa-0000-4000-8000-000000000001'
      where object_id = 'b0000000-0000-4000-8000-000000000002' $$,
  '42501'::char(5), NULL::text,
  'B cannot move its own row into A''s space'
);

-- An UPDATE filtered out by a policy's USING clause is not an error: it matches
-- nothing and reports success with zero rows. So the assertion cannot live on
-- this statement — it has to be made afterwards, against A's row.
update public.sync_objects
   set version = 999, ciphertext = decode(repeat('ff', 32), 'hex')
 where user_id = 'aaaaaaaa-0000-4000-8000-000000000001';

reset role;

select is(
  (select version from public.sync_objects
    where object_id = 'a0000000-0000-4000-8000-000000000001'),
  1::bigint,
  'B''s update of A''s row changed nothing'
);

select is(
  (select wrapped from public.key_wraps
    where user_id = 'bbbbbbbb-0000-4000-8000-000000000002' and kind = 'mk_under_kwrap'),
  decode(repeat('b3', 48), 'hex'),
  'B''s overwrite of its OWN master-key wrap changed nothing'
);

-- ---------------------------------------------------------------------------
-- The restrictive session gate, in all three of its states.
-- ---------------------------------------------------------------------------
-- A password-only session with no paired device. This is the position an
-- attacker holding a stolen web password occupies, and it is A's OWN account —
-- `auth.uid()` matches perfectly and every permissive policy is satisfied. The
-- gate is the only thing between that session and the whole encrypted corpus.
set local "request.jwt.claims" = '{"sub":"aaaaaaaa-0000-4000-8000-000000000001",'
  '"role":"authenticated","aal":"aal1",'
  '"session_id":"f0000000-0000-4000-8000-00000000000f"}';
set local role authenticated;

select is_empty(
  $$ select object_id from public.sync_objects $$,
  'a password-only session with no paired device sees nothing, even its own'
);

-- THE SHORTEST WAY THROUGH THE GATE, AND THE ONE THE GATE'S OWN REASONING WALKS
-- PAST. The `pairing` assertion further down asserts the LONG way is closed: an
-- aal1 session cannot start a handshake, so it cannot be handed a device row at
-- the end of one. But the gate never asks whether a pairing happened. It asks
-- whether a live `devices` row names this session — so the direct move is to
-- write that row, naming the session id out of one's own token, and the
-- row-local branch of `devices_live_session` says yes to exactly that.
--
-- If this assertion fails, one INSERT converts a stolen web password into a
-- session that reads the entire encrypted corpus and every key wrap; and since
-- the password is also what `K_wrap` is derived from, that is the whole plaintext.
-- Every other assertion in this file still passes while it does.
select throws_ok(
  $$ insert into public.devices (user_id, session_id, name_nonce, name_ciphertext)
     values ('aaaaaaaa-0000-4000-8000-000000000001',
             'f0000000-0000-4000-8000-00000000000f',
             decode(repeat('44', 24), 'hex'), decode(repeat('dd', 32), 'hex')) $$,
  '42501'::char(5), NULL::text,
  'a password-only session cannot mint the device row that would vouch for it'
);

reset role;

-- The desktop: also aal1, and aal1 for the whole life of the session, because it
-- never sees the web password and cannot step up. If this assertion fails the
-- gate has locked out the only clients that hold keys.
set local "request.jwt.claims" = '{"sub":"aaaaaaaa-0000-4000-8000-000000000001",'
  '"role":"authenticated","aal":"aal1",'
  '"session_id":"a5000000-0000-4000-8000-000000000001"}';
set local role authenticated;

select isnt_empty(
  $$ select object_id from public.sync_objects $$,
  'a paired desktop at aal1 reaches its own rows — the OR branch works'
);

-- THE OTHER DIRECTION OF THE DESKTOP-ONLY RULE, and the assertion without which
-- „the master-key wrap is unreadable" would be satisfied by it being unreadable
-- by everybody. This session is aal1 — weaker, by the only measure the identity
-- provider has, than the browser refused above — and it reads the wrap, because
-- the question the policy asks is not „how strong is this session" but „did a
-- completed pairing write a row calling it a desktop".
select isnt_empty(
  $$ select id from public.key_wraps where kind = 'mk_under_kwrap' $$,
  'a paired desktop reads the master-key wrap — the desktop-only rule is not a lock-out'
);

-- Pairing is the one statement the OR does not cover. If it did, a stolen
-- password would mint its own device and hold the door open for itself
-- permanently — including across a password change, since the device session is
-- independent of the password.
select throws_ok(
  $$ insert into public.pairing
       (user_id, code_id, initiator_pub, sealed_payload, completion_token_hash)
     values ('aaaaaaaa-0000-4000-8000-000000000001',
             decode(repeat('21', 32), 'hex'), decode(repeat('22', 32), 'hex'),
             decode(repeat('23', 32), 'hex'), decode(repeat('24', 32), 'hex')) $$,
  '42501'::char(5), NULL::text,
  'a paired desktop at aal1 still cannot start a pairing'
);

reset role;

-- Revocation takes effect on the next statement rather than when the access
-- token expires. That is the entire reason `devices.session_id` exists.
update public.devices set revoked_at = now()
 where id = 'd0000000-0000-4000-8000-00000000000a';

set local role authenticated;

select is_empty(
  $$ select object_id from public.sync_objects $$,
  'revoking the device closes the session immediately, not at token expiry'
);

reset role;

-- And at aal2 the same account may pair, which is the last positive control:
-- without it, „pairing is refused" could be true because pairing is broken.
set local "request.jwt.claims" = '{"sub":"aaaaaaaa-0000-4000-8000-000000000001",'
  '"role":"authenticated","aal":"aal2",'
  '"session_id":"a9000000-0000-4000-8000-000000000009"}';
set local role authenticated;

select lives_ok(
  $$ insert into public.pairing
       (user_id, code_id, initiator_pub, sealed_payload, completion_token_hash)
     values ('aaaaaaaa-0000-4000-8000-000000000001',
             decode(repeat('31', 32), 'hex'), decode(repeat('32', 32), 'hex'),
             decode(repeat('33', 32), 'hex'), decode(repeat('34', 32), 'hex')) $$,
  'at aal2 the account can start a pairing'
);

-- `platform` IS THE ONE COLUMN A CLIENT MAY NOT WRITE, at any assurance level.
-- It is the only place in the schema where „browser" and „desktop" are ever
-- distinguishable, and a value the client supplies is not a fact about the client
-- — it is a sentence the client chose. The grant is withheld, so naming the column
-- fails at the parser rather than being quietly overridden, which matters: a
-- silently ignored write teaches a client author that the value took.
select throws_ok(
  $$ insert into public.devices
       (user_id, session_id, platform, name_nonce, name_ciphertext)
     values ('aaaaaaaa-0000-4000-8000-000000000001',
             'a9000000-0000-4000-8000-000000000009', 'desktop',
             decode(repeat('66', 24), 'hex'), decode(repeat('ff', 32), 'hex')) $$,
  '42501'::char(5), NULL::text,
  'no client may state its own platform, even at aal2'
);

-- The positive control for the assertion in the password-only section above.
-- Without it, „a session cannot register a device" would be satisfied by device
-- registration being broken for everybody, and the web client would never work.
select lives_ok(
  $$ insert into public.devices (user_id, session_id, name_nonce, name_ciphertext)
     values ('aaaaaaaa-0000-4000-8000-000000000001',
             'a9000000-0000-4000-8000-000000000009',
             decode(repeat('66', 24), 'hex'), decode(repeat('ff', 32), 'hex')) $$,
  'at aal2 the account can register a device'
);

-- REVOCATION IS ONE TIMESTAMP, AND IT DOES NOT END THE GoTrue SESSION. The
-- revoked desktop still holds a working refresh token; the only thing keeping it
-- out is `revoked_at` being non-null when the gate reads it. So clearing this
-- column hands the machine back — and the session able to clear it is aal2, which
-- is exactly the surface a user reaches for when revoking a device to recover
-- from a compromise.
select throws_ok(
  $$ update public.devices set revoked_at = null
      where id = 'd0000000-0000-4000-8000-00000000000a' $$,
  'NX201'::char(5), NULL::text,
  'even at aal2, a revoked device cannot be un-revoked'
);

reset role;

select is(
  (select platform from public.devices
    where session_id = 'a9000000-0000-4000-8000-000000000009'),
  'web',
  'a self-registered device is web — only pair-complete may write desktop'
);

select * from finish();

rollback;
