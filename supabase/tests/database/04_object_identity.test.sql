-- WHAT AN OBJECT ID ACTUALLY IS, AND WHAT A WRAP MUST CARRY. Requires a live
-- database:
--   supabase start && supabase db reset && supabase test db
--
-- Migration 001 originally declared `object_id uuid` with `primary key
-- (user_id, object_id)`, and both were wrong against the identity model the
-- desktop derives from its own primary keys (ADR-082;
-- `packages/db/src/sync/collectionGuard.test.ts` checks it against the real
-- schema). Five collections identify an object by a NATURAL key and six by
-- nothing at all — their object id is the empty string, because the profile was
-- the whole of the key. Neither error would have announced itself: a uuid column
-- refuses the natural keys outright, and a two-column primary key silently
-- MERGES two profiles' singletons into one row, which looks from the outside
-- like an ordinary edit arriving from another device.
--
-- Everything below is a shape the real client will produce on its first push. It
-- runs as the migration role: these are table constraints and a trigger, not
-- policies, so there is nothing here that a client role would prove differently.

begin;

set local search_path = public, extensions;

select plan(16);

insert into auth.users (instance_id, id, aud, role, email, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', 'dddddddd-0000-4000-8000-000000000004',
        'authenticated', 'authenticated', 'd@nexus.test', now(), now());

-- A ROW MAY ONLY BE SEALED UNDER A GENERATION WHOSE KEY IS STORED (NX007), so
-- both profiles used below need their `ck_under_mk` wrap before they can hold
-- anything at all. Epoch 2 for the first profile is seeded here too — the
-- rotation assertions further down raise a row into it.
insert into public.key_wraps (user_id, kind, profile_id, epoch, nonce, wrapped, commit_tag)
values
  ('dddddddd-0000-4000-8000-000000000004', 'ck_under_mk',
   '11111111-1111-4111-8111-111111111111', 1,
   decode(repeat('f1', 24), 'hex'), decode(repeat('e1', 48), 'hex'),
   decode(repeat('d1', 32), 'hex')),
  ('dddddddd-0000-4000-8000-000000000004', 'ck_under_mk',
   '11111111-1111-4111-8111-111111111111', 2,
   decode(repeat('f2', 24), 'hex'), decode(repeat('e2', 48), 'hex'),
   decode(repeat('d2', 32), 'hex')),
  ('dddddddd-0000-4000-8000-000000000004', 'ck_under_mk',
   '22222222-2222-4222-8222-222222222222', 1,
   decode(repeat('f3', 24), 'hex'), decode(repeat('e3', 48), 'hex'),
   decode(repeat('d3', 32), 'hex'));

-- ---------------------------------------------------------------------------
-- The six per-profile singletons.
-- ---------------------------------------------------------------------------
select lives_ok(
  $$ insert into public.sync_objects
       (user_id, profile_id, collection, object_id, version, nonce, ciphertext)
     values ('dddddddd-0000-4000-8000-000000000004',
             '11111111-1111-4111-8111-111111111111',
             'calendar_settings', '', 1,
             decode(repeat('01', 24), 'hex'), decode(repeat('aa', 32), 'hex')) $$,
  'a per-profile singleton stores under the empty object id'
);

-- THE COLLISION THE OLD PRIMARY KEY WOULD HAVE ALLOWED. Same user, same empty
-- object id, different profile: under `(user_id, object_id)` the second insert
-- is a duplicate-key error, and a client that used an upsert would have written
-- one profile's calendar settings over another's without a word.
select lives_ok(
  $$ insert into public.sync_objects
       (user_id, profile_id, collection, object_id, version, nonce, ciphertext)
     values ('dddddddd-0000-4000-8000-000000000004',
             '22222222-2222-4222-8222-222222222222',
             'calendar_settings', '', 1,
             decode(repeat('02', 24), 'hex'), decode(repeat('bb', 32), 'hex')) $$,
  'two profiles each hold their own singleton without colliding'
);

-- And the same empty id in a different COLLECTION of the same profile, which the
-- old key would also have rejected.
select lives_ok(
  $$ insert into public.sync_objects
       (user_id, profile_id, collection, object_id, version, nonce, ciphertext)
     values ('dddddddd-0000-4000-8000-000000000004',
             '11111111-1111-4111-8111-111111111111',
             'study_settings', '', 1,
             decode(repeat('03', 24), 'hex'), decode(repeat('cc', 32), 'hex')) $$,
  'two collections of one profile each hold their own singleton'
);

select throws_ok(
  $$ insert into public.sync_objects
       (user_id, profile_id, collection, object_id, version, nonce, ciphertext)
     values ('dddddddd-0000-4000-8000-000000000004',
             '11111111-1111-4111-8111-111111111111',
             'calendar_settings', '', 2,
             decode(repeat('04', 24), 'hex'), decode(repeat('dd', 32), 'hex')) $$,
  '23505',
  null,
  'the same object of the same profile and collection is still one row'
);

-- ---------------------------------------------------------------------------
-- Natural and composite object ids.
-- ---------------------------------------------------------------------------
-- `fit_measurements` is keyed by the DAY, `feature_flags` by the module name,
-- and `note_updates` by the note's id joined to a sequence number with U+001F —
-- the ASCII unit separator, chosen because no id, module name or date can
-- contain it, so the join needs no escaping.
select lives_ok(
  $$ insert into public.sync_objects
       (user_id, profile_id, collection, object_id, version, nonce, ciphertext)
     values ('dddddddd-0000-4000-8000-000000000004',
             '11111111-1111-4111-8111-111111111111',
             'fit_measurements', '2026-08-09', 1,
             decode(repeat('05', 24), 'hex'), decode(repeat('ee', 32), 'hex')) $$,
  'a natural key stores as the object id it really is'
);

select lives_ok(
  $$ insert into public.sync_objects
       (user_id, profile_id, collection, object_id, version, nonce, ciphertext)
     values ('dddddddd-0000-4000-8000-000000000004',
             '11111111-1111-4111-8111-111111111111',
             'note_updates',
             'a0000000-0000-4000-8000-00000000000f' || chr(31) || '7', 1,
             decode(repeat('06', 24), 'hex'), decode(repeat('ff', 32), 'hex')) $$,
  'a composite key joined by the unit separator stores whole'
);

select throws_ok(
  format(
    $$ insert into public.sync_objects
         (user_id, profile_id, collection, object_id, version, nonce, ciphertext)
       values ('dddddddd-0000-4000-8000-000000000004',
               '11111111-1111-4111-8111-111111111111',
               'tasks', %L, 1,
               decode(repeat('07', 24), 'hex'), decode(repeat('11', 32), 'hex')) $$,
    repeat('x', 256)),
  '23514',
  null,
  'an object id past 255 bytes is refused — an identifier, not a payload'
);

-- ---------------------------------------------------------------------------
-- ck_epoch — the content-key generation, and the one direction it moves.
-- ---------------------------------------------------------------------------
select is(
  (select ck_epoch from public.sync_objects
    where profile_id = '11111111-1111-4111-8111-111111111111'
      and collection = 'fit_measurements'),
  1::smallint,
  'a row that says nothing about its key is on epoch 1'
);

select lives_ok(
  $$ update public.sync_objects
        set ck_epoch = 2, version = version + 1,
            nonce = decode(repeat('08', 24), 'hex'),
            ciphertext = decode(repeat('81', 32), 'hex')
      where collection = 'fit_measurements' $$,
  're-encrypting under a new content key raises the epoch'
);

select throws_ok(
  $$ update public.sync_objects
        set ck_epoch = 1, version = version + 1,
            nonce = decode(repeat('09', 24), 'hex'),
            ciphertext = decode(repeat('91', 32), 'hex')
      where collection = 'fit_measurements' $$,
  'NX006',
  null,
  'the epoch may not go backwards — a rollback hands the row to whoever holds '
  'the old key'
);

-- ---------------------------------------------------------------------------
-- key_wraps — the commitment tag has a column, and it is not optional.
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ insert into public.key_wraps (user_id, kind, profile_id, epoch, nonce, wrapped)
     values ('dddddddd-0000-4000-8000-000000000004', 'ck_under_mk',
             '11111111-1111-4111-8111-111111111111', 3,
             decode(repeat('11', 24), 'hex'), decode(repeat('aa', 48), 'hex')) $$,
  '23502',
  null,
  'a wrap with no commitment tag cannot be stored — key-committing wrapping '
  'cannot be dropped by a transport that forgot the field'
);

-- ---------------------------------------------------------------------------
-- key_wraps — the Argon2id parameters have a floor and a spelling.
-- ---------------------------------------------------------------------------
-- The floor is RFC 9106's second recommended configuration (64 MiB, t=3, p=4),
-- the one written for memory-constrained environments. A client that wrote 8 KiB
-- and one pass would produce a wrap that works perfectly and falls to a
-- dictionary attack, and the user would have no way to find out.
select throws_ok(
  $$ insert into public.key_wraps
       (user_id, kind, nonce, wrapped, commit_tag, kdf_salt, kdf_params)
     values ('dddddddd-0000-4000-8000-000000000004', 'mk_under_kwrap',
             decode(repeat('12', 24), 'hex'), decode(repeat('ab', 48), 'hex'),
             decode(repeat('d1', 32), 'hex'), null,
             '{"memoryKiB":8,"iterations":1,"parallelism":1}'::jsonb) $$,
  '23514',
  null,
  'Argon2id costs below the floor are refused'
);

-- THE SHAPE, NOT ONLY THE VALUES. `kdf_params` is jsonb, and a missing key
-- compares as NULL — neither true nor false — so a `>=` test alone passes an
-- object with no `iterations` in it by being UNKNOWN rather than by being large
-- enough. The existence tests are what make the floor a floor.
select throws_ok(
  $$ insert into public.key_wraps
       (user_id, kind, nonce, wrapped, commit_tag, kdf_salt, kdf_params)
     values ('dddddddd-0000-4000-8000-000000000004', 'mk_under_kwrap',
             decode(repeat('14', 24), 'hex'), decode(repeat('ac', 48), 'hex'),
             decode(repeat('d2', 32), 'hex'), null,
             '{"m":262144,"t":4,"p":1}'::jsonb) $$,
  '23514',
  null,
  'libsodium''s m/t/p spelling is refused — the names are Argon2idParams'
);

select lives_ok(
  $$ insert into public.key_wraps
       (user_id, kind, nonce, wrapped, commit_tag, kdf_salt, kdf_params)
     values ('dddddddd-0000-4000-8000-000000000004', 'mk_under_kwrap',
             decode(repeat('16', 24), 'hex'), decode(repeat('ad', 48), 'hex'),
             decode(repeat('d3', 32), 'hex'), null,
             '{"memoryKiB":262144,"iterations":4,"parallelism":1}'::jsonb) $$,
  'the parameters the product actually uses are accepted'
);

-- ---------------------------------------------------------------------------
-- key_wraps — a salt belongs to exactly one of the two password-derived slots.
-- ---------------------------------------------------------------------------
-- Migration 009. `mk_under_src`'s KEK is Argon2id over a printed recovery code
-- and has no other source of salt, so the salt must be stored. `mk_under_kwrap`'s
-- KEK is K_wrap, whose salt is SHA-256("nexus/web-kdf/v1" || email) — derived,
-- 32 bytes, identical on every device, and deliberately never fetched. A stored
-- salt there is not redundant, it is a per-attempt lever a hostile server would
-- hold over a human-chosen password, and the next client to read the column
-- would use it. Both directions are asserted, because a constraint that only
-- ever refuses is indistinguishable from one that refuses everything.
--
-- The three inserts above are the positive control for the NULL half: they are
-- `mk_under_kwrap` rows with no salt, and the last one lives.
select throws_ok(
  $$ insert into public.key_wraps
       (user_id, kind, nonce, wrapped, commit_tag, kdf_salt, kdf_params)
     values ('dddddddd-0000-4000-8000-000000000004', 'mk_under_kwrap',
             decode(repeat('18', 24), 'hex'), decode(repeat('ae', 48), 'hex'),
             decode(repeat('d4', 32), 'hex'), decode(repeat('19', 16), 'hex'),
             '{"memoryKiB":262144,"iterations":4,"parallelism":1}'::jsonb) $$,
  '23514',
  null,
  'a salt on the web-password slot is refused — that salt comes from the email'
);

select throws_ok(
  $$ insert into public.key_wraps
       (user_id, kind, nonce, wrapped, commit_tag, kdf_salt, kdf_params)
     values ('dddddddd-0000-4000-8000-000000000004', 'mk_under_src',
             decode(repeat('1a', 24), 'hex'), decode(repeat('af', 48), 'hex'),
             decode(repeat('d5', 32), 'hex'), null,
             '{"memoryKiB":262144,"iterations":4,"parallelism":1}'::jsonb) $$,
  '23514',
  null,
  'and the recovery slot without one is refused too — that wrap would be a brick'
);

select * from finish();

rollback;
