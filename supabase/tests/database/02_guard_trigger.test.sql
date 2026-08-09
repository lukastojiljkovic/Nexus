-- THE GUARD TRIGGER ON `sync_objects`. Requires a live database:
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
-- THE SQLSTATEs ARE THE TRIGGER'S CONTRACT WITH THE SYNC CLIENT, not decoration.
-- They reach the client verbatim: PostgREST v14.16 maps an unknown SQLSTATE to
-- HTTP 400 and passes `code`, `details` and `hint` straight through, so this
-- suite is asserting the values a sync engine will branch on. NX001 is the
-- optimistic-concurrency conflict, whose correct handling is re-read and merge;
-- every other code is „this write was never legal", whose correct handling is to
-- stop and report. Asserting them by code is what keeps the two from being
-- collapsed into one retry loop.
--
-- EVERY SUCCESSFUL UPDATE BELOW CARRIES A NEW NONCE AND NEW CIPHERTEXT. That is
-- not scaffolding to be worked around — it is the contract. A version's
-- ciphertext is a fresh encryption; a fresh encryption under XChaCha20-Poly1305
-- needs a fresh nonce or it publishes the XOR of the two plaintexts and the key
-- that forges either of them.

begin;

set local search_path = public, extensions;

select plan(47);

-- ASSERTED FIRST, so a misconfigured runner produces one clear failure instead
-- of twenty-seven confusing ones. Every table here has FORCE row level security,
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

-- THE CONTENT-KEY WRAP COMES FIRST, and a suite that seeds rows without it fails
-- at the first insert. That ordering is the point of NX007: a row sealed under a
-- generation whose key was never stored is a row nobody can ever open, so the
-- database refuses to hold one.
insert into public.key_wraps (user_id, kind, profile_id, epoch, nonce, wrapped, commit_tag)
values ('aaaaaaaa-0000-4000-8000-000000000001', 'ck_under_mk',
        '11111111-1111-4111-8111-111111111111', 1,
        decode(repeat('f1', 24), 'hex'), decode(repeat('e1', 48), 'hex'),
        decode(repeat('d1', 32), 'hex'));

insert into public.sync_objects
  (user_id, profile_id, collection, object_id, version, nonce, ciphertext)
values ('aaaaaaaa-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
        'tasks', 'a0000000-0000-4000-8000-000000000001', 1,
        decode(repeat('01', 24), 'hex'), decode(repeat('a1', 32), 'hex'));

-- ---------------------------------------------------------------------------
-- NX001 — the version is exactly one more than the stored one.
-- ---------------------------------------------------------------------------
-- A compare-and-swap, not a monotonicity check. Equality is refused because the
-- version is in the AEAD associated data, so a same-version write carrying
-- different ciphertext is either a forgery attempt or a client that has lost its
-- counter.
select throws_ok(
  $$ update public.sync_objects set version = 1
      where object_id = 'a0000000-0000-4000-8000-000000000001' $$,
  'NX001'::char(5), NULL::text,
  'a write at the same version is refused'
);

-- THE ASSERTION THAT THE OLD `>` RULE COULD NOT MAKE. A client that observed
-- version 1 and writes 3 has skipped a version it never saw — under the previous
-- rule the server accepted it and version 2's edit was erased with no error
-- anywhere. That is a lost update, and it is the reason this rule is an equality.
select throws_ok(
  $$ update public.sync_objects set version = 3
      where object_id = 'a0000000-0000-4000-8000-000000000001' $$,
  'NX001'::char(5), NULL::text,
  'a write that SKIPS a version is refused — the silent lost update'
);

select lives_ok(
  $$ update public.sync_objects
        set version = 2, nonce = decode(repeat('02', 24), 'hex'),
            ciphertext = decode(repeat('a2', 32), 'hex')
      where object_id = 'a0000000-0000-4000-8000-000000000001' $$,
  'the honest path — observed_version + 1, re-sealed — is accepted'
);

select throws_ok(
  $$ update public.sync_objects set version = 1
      where object_id = 'a0000000-0000-4000-8000-000000000001' $$,
  'NX001'::char(5), NULL::text,
  'a write at a lower version is refused'
);

-- ---------------------------------------------------------------------------
-- THE UPSERT PATH, which is how a client actually pushes.
-- ---------------------------------------------------------------------------
-- A REGRESSION TEST FOR A TRAP THAT WAS ALMOST SHIPPED. In `insert … on conflict
-- do update`, PostgreSQL fires every BEFORE INSERT trigger BEFORE it detects the
-- conflict — verified, not inferred. So the INSERT branch is handed the version
-- of an UPDATE, and a flat „a creation is version 1" there would refuse every
-- push of an existing object at version 2 or above. The trigger's first-version
-- rule is therefore conditional on the row not already existing, and this is the
-- assertion that keeps it that way.
select lives_ok(
  $$ insert into public.sync_objects
       (user_id, profile_id, collection, object_id, version, nonce, ciphertext)
     values ('aaaaaaaa-0000-4000-8000-000000000001',
             '11111111-1111-4111-8111-111111111111', 'tasks',
             'a0000000-0000-4000-8000-000000000001', 3,
             decode(repeat('03', 24), 'hex'), decode(repeat('a3', 32), 'hex'))
     on conflict (user_id, profile_id, collection, object_id) do update
       set version = excluded.version, nonce = excluded.nonce,
           ciphertext = excluded.ciphertext $$,
  'an upsert of an EXISTING object is judged by the update rule, not the creation rule'
);

-- And the mirror: an upsert that claims version 1 for an object the server holds
-- at version 3 must not be waved through by the INSERT branch just because 1 is
-- what a creation looks like. It has to land on NX001.
select throws_ok(
  $$ insert into public.sync_objects
       (user_id, profile_id, collection, object_id, version, nonce, ciphertext)
     values ('aaaaaaaa-0000-4000-8000-000000000001',
             '11111111-1111-4111-8111-111111111111', 'tasks',
             'a0000000-0000-4000-8000-000000000001', 1,
             decode(repeat('04', 24), 'hex'), decode(repeat('a4', 32), 'hex'))
     on conflict (user_id, profile_id, collection, object_id) do update
       set version = excluded.version, nonce = excluded.nonce,
           ciphertext = excluded.ciphertext $$,
  'NX001'::char(5), NULL::text,
  'an upsert at version 1 over an existing object is a conflict, not a creation'
);

-- ---------------------------------------------------------------------------
-- NX004 — identity is immutable, in all four columns.
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
-- NX007 / NX006 — the content-key epoch names a real key, and only rises.
-- ---------------------------------------------------------------------------
-- THE RATCHET THIS CLOSES. `ck_epoch` is writable by any session on the account
-- and may only rise, and `smallint` tops out at 32 767 — so without the
-- wrap-existence rule one statement from a stolen session sets a row to the
-- ceiling and no future rotation can ever bring a key up to meet it. The row is
-- unopenable forever, by everyone, including the owner. Bounding the step would
-- only have made that take a few thousand statements.
select throws_ok(
  $$ update public.sync_objects
        set ck_epoch = 2, version = version + 1,
            nonce = decode(repeat('05', 24), 'hex'),
            ciphertext = decode(repeat('a5', 32), 'hex')
      where object_id = 'a0000000-0000-4000-8000-000000000001' $$,
  'NX007'::char(5), NULL::text,
  'an epoch with no content-key wrap is refused — the ratchet has nowhere to go'
);

insert into public.key_wraps (user_id, kind, profile_id, epoch, nonce, wrapped, commit_tag)
values ('aaaaaaaa-0000-4000-8000-000000000001', 'ck_under_mk',
        '11111111-1111-4111-8111-111111111111', 2,
        decode(repeat('f2', 24), 'hex'), decode(repeat('e2', 48), 'hex'),
        decode(repeat('d2', 32), 'hex'));

select lives_ok(
  $$ update public.sync_objects
        set ck_epoch = 2, version = version + 1,
            nonce = decode(repeat('05', 24), 'hex'),
            ciphertext = decode(repeat('a5', 32), 'hex')
      where object_id = 'a0000000-0000-4000-8000-000000000001' $$,
  're-encrypting under a stored new content key raises the epoch'
);

select throws_ok(
  $$ update public.sync_objects
        set ck_epoch = 1, version = version + 1,
            nonce = decode(repeat('06', 24), 'hex'),
            ciphertext = decode(repeat('a6', 32), 'hex')
      where object_id = 'a0000000-0000-4000-8000-000000000001' $$,
  'NX006'::char(5), NULL::text,
  'the epoch may not go backwards even though that wrap still exists — a '
  'rollback hands the row to whoever holds the old key'
);

-- ---------------------------------------------------------------------------
-- NX003 — the ciphertext is re-sealed for every version.
-- ---------------------------------------------------------------------------
-- This is what makes a whole family of key-free tampering unrepresentable rather
-- than merely detectable: flipping `deleted`, re-pointing `parent_id` or raising
-- `ck_epoch` are all one-column UPDATEs that silently brick a row, because all
-- three are in the associated data. None of them can be done without producing a
-- ciphertext the attacker cannot compute.
select throws_ok(
  $$ update public.sync_objects
        set version = version + 1, nonce = decode(repeat('07', 24), 'hex')
      where object_id = 'a0000000-0000-4000-8000-000000000001' $$,
  'NX003'::char(5), NULL::text,
  'a new version carrying the previous ciphertext is refused'
);

-- ---------------------------------------------------------------------------
-- NX005 — the nonce is fresh on every write.
-- ---------------------------------------------------------------------------
-- Placed after NX003 deliberately: the trigger checks in that order, and an
-- update that breaks two rules must report the more specific one. Here nothing
-- else is wrong — the version climbs by one, the identity is untouched, the
-- ciphertext is new — and the only defect is that this version would be
-- encrypted at the nonce the previous version used. Under XChaCha20-Poly1305
-- that is not a weakening: the keystream is a function of (key, nonce) alone, so
-- the two versions XOR to the XOR of their plaintexts, and the Poly1305 one-time
-- key repeats, which is enough to forge anything at all under that pair. The AAD
-- does not help — associated data feeds the tag and never reaches the keystream.
select throws_ok(
  $$ update public.sync_objects
        set version = version + 1, ciphertext = decode(repeat('a7', 32), 'hex')
      where object_id = 'a0000000-0000-4000-8000-000000000001' $$,
  'NX005'::char(5), NULL::text,
  'a new version at the previous nonce is refused'
);

-- The complementary half, which the trigger structurally cannot see: a nonce
-- repeated across two DIFFERENT rows of one (profile, epoch). That is the shape
-- a broken generator produces, and two objects sealed under one key at one nonce
-- is the identical break as one object sealed twice.
select throws_ok(
  $$ insert into public.sync_objects
       (user_id, profile_id, collection, object_id, version, ck_epoch, nonce, ciphertext)
     values ('aaaaaaaa-0000-4000-8000-000000000001',
             '11111111-1111-4111-8111-111111111111', 'tasks',
             'b0000000-0000-4000-8000-00000000000b', 1, 2,
             decode(repeat('05', 24), 'hex'), decode(repeat('b1', 32), 'hex')) $$,
  '23505'::char(5), NULL::text,
  'two rows of one profile and epoch cannot share a nonce'
);

-- And the case that must stay legal: the same nonce under a DIFFERENT key. The
-- index is scoped by `ck_epoch` precisely so a rotation does not have to avoid
-- every nonce the previous generation ever used.
select lives_ok(
  $$ insert into public.sync_objects
       (user_id, profile_id, collection, object_id, version, ck_epoch, nonce, ciphertext)
     values ('aaaaaaaa-0000-4000-8000-000000000001',
             '11111111-1111-4111-8111-111111111111', 'tasks',
             'c0000000-0000-4000-8000-00000000000c', 1, 1,
             decode(repeat('05', 24), 'hex'), decode(repeat('c1', 32), 'hex')) $$,
  'a nonce may repeat across epochs — it is a different key'
);

-- ---------------------------------------------------------------------------
-- DELETION IS A TWO-WAY BIT, and this is the feature the old rule broke.
-- ---------------------------------------------------------------------------
-- There used to be a „a tombstone is terminal" rule here. It contradicted
-- restore-from-trash, which ships in the 1.0.0 desktop app across canvas boards,
-- documents, events, accounts and recurring rules; and its security argument did
-- not hold, because `deleted` and `version` are both in the associated data, so
-- an old ciphertext cannot be replayed to resurrect anything and only a party
-- holding the content key can produce a valid un-delete — which needs no help
-- from this bit. Worse, it was a one-way ratchet pointed at the owner: a stolen
-- session could tombstone every row, and the honest repair is exactly a write
-- with `deleted = false`. See the migration header.
select lives_ok(
  $$ update public.sync_objects
        set deleted = true, version = version + 1,
            nonce = decode(repeat('08', 24), 'hex'),
            ciphertext = decode(repeat('a8', 32), 'hex')
      where object_id = 'a0000000-0000-4000-8000-000000000001' $$,
  'an object can be tombstoned'
);

select lives_ok(
  $$ update public.sync_objects
        set version = version + 1,
            nonce = decode(repeat('09', 24), 'hex'),
            ciphertext = decode(repeat('a9', 32), 'hex')
      where object_id = 'a0000000-0000-4000-8000-000000000001' $$,
  'a tombstone can still be compacted'
);

select lives_ok(
  $$ update public.sync_objects
        set deleted = false, version = version + 1,
            nonce = decode(repeat('0a', 24), 'hex'),
            ciphertext = decode(repeat('aa', 32), 'hex')
      where object_id = 'a0000000-0000-4000-8000-000000000001' $$,
  'and it can be RESTORED — the merge decides which write wins, not the server'
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
       nonce = decode(repeat('0b', 24), 'hex'),
       ciphertext = decode(repeat('ab', 32), 'hex'),
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
-- NX002 — a creation starts at version 1.
-- ---------------------------------------------------------------------------
-- The lock-out defence, and it is now an equality rather than a bound. One
-- INSERT at the top of the version space used to be legal, and an object created
-- that way is frozen forever: every honest client latches that number as the
-- object's anti-rollback high-water mark, and with the update rule pinned to
-- `old + 1` the next legal version would be past the column's ceiling. There is
-- nothing left for a „large step" bound to refuse, because the version space
-- cannot be jumped at all.
select throws_ok(
  $$ insert into public.sync_objects
       (user_id, profile_id, collection, object_id, version, nonce, ciphertext)
     values ('aaaaaaaa-0000-4000-8000-000000000001',
             '11111111-1111-4111-8111-111111111111', 'tasks',
             'f0000000-0000-4000-8000-00000000000f', 5,
             decode(repeat('0c', 24), 'hex'), decode(repeat('ac', 32), 'hex')) $$,
  'NX002'::char(5), NULL::text,
  'an object the server has never seen cannot be created above version 1'
);

select lives_ok(
  $$ insert into public.sync_objects
       (user_id, profile_id, collection, object_id, version, nonce, ciphertext)
     values ('aaaaaaaa-0000-4000-8000-000000000001',
             '11111111-1111-4111-8111-111111111111', 'tasks',
             'f0000000-0000-4000-8000-00000000000f', 1,
             decode(repeat('0c', 24), 'hex'), decode(repeat('ac', 32), 'hex')) $$,
  'and it is created at version 1'
);

-- The wrap-existence rule applies to creations too, or a row could simply be
-- BORN at an epoch no key exists for.
select throws_ok(
  $$ insert into public.sync_objects
       (user_id, profile_id, collection, object_id, version, nonce, ciphertext)
     values ('aaaaaaaa-0000-4000-8000-000000000001',
             '22222222-2222-4222-8222-222222222222', 'tasks',
             'd0000000-0000-4000-8000-00000000000d', 1,
             decode(repeat('0d', 24), 'hex'), decode(repeat('ad', 32), 'hex')) $$,
  'NX007'::char(5), NULL::text,
  'a profile with no content-key wrap cannot hold rows at all'
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
-- ASSERTION. With the trigger on, NX002 refuses this insert long before the
-- ceiling is consulted, so a test run against the live trigger would prove the
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
             decode(repeat('0e', 24), 'hex'), decode(repeat('ae', 32), 'hex')) $$,
  '23514'::char(5), NULL::text,
  'a version above 2^53-1 is refused by the range CHECK even with no trigger'
);

alter table public.sync_objects enable trigger sync_objects_guard_before_write;

-- ---------------------------------------------------------------------------
-- NX101 / NX102 — the guard on `key_wraps`, which had never been run.
-- ---------------------------------------------------------------------------
-- Migration 003b shipped with no assertion of any kind behind it. Everything
-- below was true of the deployed function before this section existed; none of
-- it was established, and a rule nobody has ever executed is indistinguishable
-- from a rule that does not fire. It is the table that holds the keys.
--
-- `mk_under_src` is seeded here because the rotation rules matter most on the
-- Recovery Kit slot: it is the one wrap whose replacement is invisible to its
-- owner, and re-arming a lost kit is a legitimate operation, so „this wrap
-- changed" cannot be forbidden — only dated.
insert into public.key_wraps
  (user_id, kind, nonce, wrapped, commit_tag, kdf_salt, kdf_params)
values ('aaaaaaaa-0000-4000-8000-000000000001', 'mk_under_src',
        decode(repeat('c1', 24), 'hex'), decode(repeat('c2', 48), 'hex'),
        decode(repeat('c3', 32), 'hex'), decode(repeat('c4', 16), 'hex'),
        '{"memoryKiB": 65536, "iterations": 3, "parallelism": 1}'::jsonb);

-- The rotation performed at the old nonce, which is the break this rule exists
-- for: MK does not change when the code does, so the old and new ciphertexts are
-- two messages under one (key, nonce) pair and XOR to the XOR of the two wrapped
-- keys. The party the re-arming was meant to lock out is exactly the party
-- holding the old one.
select throws_ok(
  $$ update public.key_wraps set wrapped = decode(repeat('c5', 48), 'hex')
      where kind = 'mk_under_src' $$,
  'NX101'::char(5), NULL::text,
  'a changed wrap at the previous nonce is refused'
);

select lives_ok(
  $$ update public.key_wraps
        set wrapped = decode(repeat('c5', 48), 'hex'),
            nonce = decode(repeat('c6', 24), 'hex'),
            rotated_at = timestamptz '2000-01-01 00:00:00+00'
      where kind = 'mk_under_src' $$,
  'and is allowed at a fresh one — re-arming a lost Recovery Kit is legitimate'
);

-- The statement above STATED a rotation date in 2000 and holds the privilege to
-- write the column; the server's answer is the only one that survives. Asserted
-- as „not the value the writer named" rather than „it moved", because `now()` is
-- the transaction timestamp and every statement in this file shares one.
select ok(
  (select k.rotated_at > timestamptz '2020-01-01 00:00:00+00'
     from public.key_wraps k where k.kind = 'mk_under_src'),
  'rotated_at is stamped by the server, not by whoever replaced the wrap'
);

-- AND CANNOT BE WALKED BACK. Stamping alone would have been defeated by a second
-- statement changing nothing else: the attacker substitutes the wrap, the row is
-- dated, and one more UPDATE re-dates it to whenever they like. This is the half
-- that makes the timestamp evidence rather than a default.
select lives_ok(
  $$ update public.key_wraps
        set disabled_at = now(), rotated_at = timestamptz '2000-01-01 00:00:00+00'
      where kind = 'mk_under_src' $$,
  'retiring a wrap is still one column edit — disabled_at has no other expression'
);

select ok(
  (select k.rotated_at > timestamptz '2020-01-01 00:00:00+00'
     from public.key_wraps k where k.kind = 'mk_under_src'),
  'and an update that does not touch the wrap cannot move rotated_at at all'
);

-- NX102, one column per assertion. A single statement moving all four passes as
-- long as ANY one of them is compared, so it would keep passing after three of
-- the four comparisons were deleted — the same reason NX004 is split above.
select throws_ok(
  $$ update public.key_wraps set kind = 'mk_under_kwrap'
      where kind = 'mk_under_src' $$,
  'NX102'::char(5), NULL::text,
  'kind is immutable — a recovery wrap cannot become the password wrap'
);

select throws_ok(
  $$ update public.key_wraps set profile_id = '99999999-9999-4999-8999-999999999999'
      where kind = 'ck_under_mk' and epoch = 1 $$,
  'NX102'::char(5), NULL::text,
  'profile_id is immutable — a profile is web-enabled by the existence of its row'
);

select throws_ok(
  $$ update public.key_wraps set epoch = 3
      where kind = 'ck_under_mk' and epoch = 1 $$,
  'NX102'::char(5), NULL::text,
  'epoch is immutable — moving it strands every row sealed at the old one'
);

select throws_ok(
  $$ update public.key_wraps set user_id = 'bbbbbbbb-0000-4000-8000-000000000002'
      where kind = 'mk_under_src' $$,
  'NX102'::char(5), NULL::text,
  'user_id is immutable — a wrap cannot be moved between accounts'
);

-- `created_at` answers „since when could this password open my account", so it is
-- the one value here that must survive every rotation. Pinned in the trigger and
-- not merely withheld by a grant, which is what this assertion is about: the
-- statement below holds the privilege and the value still does not take.
select lives_ok(
  $$ update public.key_wraps
        set disabled_at = null, created_at = timestamptz '2000-01-01 00:00:00+00'
      where kind = 'mk_under_src' $$,
  'a privileged writer may name created_at'
);

select ok(
  (select k.created_at > timestamptz '2020-01-01 00:00:00+00'
     from public.key_wraps k where k.kind = 'mk_under_src'),
  'and it does not take — created_at survives every write'
);

-- ---------------------------------------------------------------------------
-- `key_wraps_kdf_params_ceiling` — the bound migration 012 added.
-- ---------------------------------------------------------------------------
-- The floor was always there; the ceiling was not, and its absence was not a
-- cosmetic gap. `kdf.ts` refuses to DERIVE outside the range because the
-- parameters arrive from a server this design treats as hostile — so a wrap
-- stored above the ceiling is one no client will ever open, and for the two
-- `mk_*` slots that is a master key with no route back. Parallelism is the
-- sharp case: raising `p` at fixed `m` leaves the honest cost alone and hands a
-- many-core attacker a proportional speedup, so a large value WEAKENS the wrap
-- while looking, in the row, like a stronger one.
--
-- Each refusal asserts the CONSTRAINT NAME and not merely 23514. Every one of
-- these payloads violates something, so a bare sqlstate would pass just as
-- happily if the ceiling had never been added and the floor were answering for
-- it — which is precisely the state this section exists to distinguish.
select throws_ok(
  $$ insert into public.key_wraps
       (user_id, kind, nonce, wrapped, commit_tag, kdf_salt, kdf_params)
     values ('aaaaaaaa-0000-4000-8000-000000000001', 'mk_under_kwrap',
             decode(repeat('d1', 24), 'hex'), decode(repeat('d2', 48), 'hex'),
             decode(repeat('d3', 32), 'hex'), null,
             '{"memoryKiB": 65536, "iterations": 3, "parallelism": 64}'::jsonb) $$,
  '23514'::char(5),
  'new row for relation "key_wraps" violates check constraint "key_wraps_kdf_params_ceiling"',
  'parallelism above 4 lanes is refused — more lanes is a weaker wrap, not a stronger one'
);

select throws_ok(
  $$ insert into public.key_wraps
       (user_id, kind, nonce, wrapped, commit_tag, kdf_salt, kdf_params)
     values ('aaaaaaaa-0000-4000-8000-000000000001', 'mk_under_kwrap',
             decode(repeat('d1', 24), 'hex'), decode(repeat('d2', 48), 'hex'),
             decode(repeat('d3', 32), 'hex'), null,
             '{"memoryKiB": 1048577, "iterations": 3, "parallelism": 1}'::jsonb) $$,
  '23514'::char(5),
  'new row for relation "key_wraps" violates check constraint "key_wraps_kdf_params_ceiling"',
  'memory above 1 GiB is refused'
);

select throws_ok(
  $$ insert into public.key_wraps
       (user_id, kind, nonce, wrapped, commit_tag, kdf_salt, kdf_params)
     values ('aaaaaaaa-0000-4000-8000-000000000001', 'mk_under_kwrap',
             decode(repeat('d1', 24), 'hex'), decode(repeat('d2', 48), 'hex'),
             decode(repeat('d3', 32), 'hex'), null,
             '{"memoryKiB": 65536, "iterations": 17, "parallelism": 1}'::jsonb) $$,
  '23514'::char(5),
  'new row for relation "key_wraps" violates check constraint "key_wraps_kdf_params_ceiling"',
  'more than 16 passes is refused'
);

-- The floor still answers for its own half. Two constraints, two names, two
-- opposite mistakes — which is why they were not folded into one.
select throws_ok(
  $$ insert into public.key_wraps
       (user_id, kind, nonce, wrapped, commit_tag, kdf_salt, kdf_params)
     values ('aaaaaaaa-0000-4000-8000-000000000001', 'mk_under_kwrap',
             decode(repeat('d1', 24), 'hex'), decode(repeat('d2', 48), 'hex'),
             decode(repeat('d3', 32), 'hex'), null,
             '{"memoryKiB": 32768, "iterations": 3, "parallelism": 1}'::jsonb) $$,
  '23514'::char(5),
  'new row for relation "key_wraps" violates check constraint "key_wraps_kdf_params_floor"',
  'below the floor is still the floor''s answer, not the ceiling''s'
);

-- The ceiling holds no opinion about input that is not three numbers, so this
-- must come back from the FLOOR — and it must be a constraint violation rather
-- than 22P02 from a cast, which is what the `CASE` in migration 012 buys.
select throws_ok(
  $$ insert into public.key_wraps
       (user_id, kind, nonce, wrapped, commit_tag, kdf_salt, kdf_params)
     values ('aaaaaaaa-0000-4000-8000-000000000001', 'mk_under_kwrap',
             decode(repeat('d1', 24), 'hex'), decode(repeat('d2', 48), 'hex'),
             decode(repeat('d3', 32), 'hex'), null,
             '{"memoryKiB": "abc", "iterations": 3, "parallelism": 1}'::jsonb) $$,
  '23514'::char(5),
  'new row for relation "key_wraps" violates check constraint "key_wraps_kdf_params_floor"',
  'a non-numeric cost is a floor violation, not a cast error'
);

-- Both bounds are inclusive, and the honest maximum has to be storable or the
-- ceiling is off by one in the direction that locks somebody out.
select lives_ok(
  $$ insert into public.key_wraps
       (user_id, kind, nonce, wrapped, commit_tag, kdf_salt, kdf_params)
     values ('aaaaaaaa-0000-4000-8000-000000000001', 'mk_under_kwrap',
             decode(repeat('d1', 24), 'hex'), decode(repeat('d2', 48), 'hex'),
             decode(repeat('d3', 32), 'hex'), null,
             '{"memoryKiB": 1048576, "iterations": 16, "parallelism": 4}'::jsonb) $$,
  'a wrap exactly at the ceiling is accepted'
);

-- ---------------------------------------------------------------------------
-- `sync_state.updated_at` — the same rule, on the other table that carries it.
-- ---------------------------------------------------------------------------
-- Migration 008's whole reason for existing. The column is commented „when the
-- device last synced" and is the one value here a human might read as evidence
-- that a device is alive; before that migration nothing wrote it after the
-- INSERT, so it would have sat at „when this cursor row was first created" while
-- reading as „last synced" — populated, plausible and monotonically wrong.
--
-- WHY THE TIME BEING ASSERTED IS 2020 AND NOT „IT CHANGED". `now()` is the
-- TRANSACTION timestamp, so an insert and an update inside this test carry the
-- identical stamp and „the value moved" is unassertable here without a clock
-- this suite has no business owning. What is assertable — and is the actual
-- rule — is that a value the writer stated does not survive: both statements
-- below name a time in 2000, and both rows come back stamped now. That is the
-- same shape the `sync_objects` assertion above uses, for the same reason.
insert into public.devices (id, user_id, session_id, platform, name_nonce, name_ciphertext)
values ('d0000000-0000-4000-8000-00000000000a', 'aaaaaaaa-0000-4000-8000-000000000001',
        'a5000000-0000-4000-8000-000000000001', 'desktop',
        decode(repeat('a5', 24), 'hex'), decode(repeat('a6', 32), 'hex'));

insert into public.sync_state (user_id, device_id, profile_id, collection, last_seq, updated_at)
values ('aaaaaaaa-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-00000000000a',
        '11111111-1111-4111-8111-111111111111', 'tasks', 7,
        timestamptz '2000-01-01 00:00:00+00');

select ok(
  (select s.updated_at > timestamptz '2020-01-01 00:00:00+00'
     from public.sync_state s
    where s.device_id = 'd0000000-0000-4000-8000-00000000000a'),
  'sync_state.updated_at is stamped by the server on INSERT'
);

update public.sync_state
   set last_seq = 9, updated_at = timestamptz '2000-01-01 00:00:00+00'
 where device_id = 'd0000000-0000-4000-8000-00000000000a';

select ok(
  (select s.updated_at > timestamptz '2020-01-01 00:00:00+00'
     from public.sync_state s
    where s.device_id = 'd0000000-0000-4000-8000-00000000000a'),
  'and on UPDATE — the path `default now()` alone never reaches'
);

select * from finish();

rollback;
