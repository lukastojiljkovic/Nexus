-- Nexus sync — migration 003: the BEFORE INSERT OR UPDATE guard on `sync_objects`.
--
-- WHY A TRIGGER AND NOT MORE RLS. A policy's `WITH CHECK` is handed the NEW row
-- and only the NEW row. Every rule below is a statement about the TRANSITION —
-- „exactly one more than what it was", „still the same object", „not the bytes
-- it already had" — and a predicate that cannot see OLD cannot express any of
-- them. This is not a preference; it is the reason this file exists at all. RLS
-- answers „may this session touch this row"; nothing in RLS can answer „is this
-- a legal next state of this row".
--
-- WHAT IT IS DEFENDING AGAINST, CONCRETELY. Take a session that satisfies every
-- policy in migration 002 — the honest owner, or an attacker holding a stolen
-- web password at aal2. It issues one statement:
--
--     update sync_objects set version = 9007199254740991, ciphertext = '\x00…'
--     where object_id = …;
--
-- Every legitimate client on the account then pulls that row, sees a version far
-- above its own, and — correctly, because a monotone version counter is exactly
-- what anti-rollback protection is built on — latches it as the high-water mark
-- for that object. From that moment no honest edit can ever win: every real
-- change carries a lower version and is discarded as stale by the client's own
-- merge rule. The object is permanently frozen at garbage, and the damage is not
-- even undoable by restoring a backup of the SERVER, because the poison is now
-- the high-water mark inside every device.
--
-- The AEAD cannot prevent this. Associated data binds the version to the
-- ciphertext, so the attacker cannot forge a ciphertext that OPENS at that
-- version — the row will fail to decrypt and the client will reject its
-- contents. It will still have seen the number. Authentication answers „is this
-- content genuine"; it has nothing to say about „is this number reachable". That
-- gap is precisely the width of this trigger.
--
-- ─── THE RULE THIS FILE USED TO HAVE, AND WHY IT IS GONE ────────────────────
--
-- Until 2026-08-09 there was a RULE 3: „a tombstone is terminal", refusing any
-- update that moved `deleted` from true back to false. It was wrong in three
-- separate ways and it is worth recording all three, because each is a shape
-- that will be proposed again.
--
--  1. IT CONTRADICTED A SHIPPED FEATURE. Restore-from-trash exists in the 1.0.0
--     desktop app — `canvasStore.restore`, `documentStore.restore`,
--     `eventStore.restore`, and others, all of them `SET deleted_at = NULL` —
--     and `sweepRow`/`markRestored` in `@nexus/sync` model it as a first-class
--     transition. A restored object's first push would have been refused here,
--     and so would every later edit to it, forever. The server contract simply
--     did not match the product.
--
--  2. ITS SECURITY ARGUMENT DID NOT HOLD. The stated fear was a peer replaying a
--     pre-delete ciphertext to un-delete something. It cannot: both `version` and
--     `deleted` are in the AEAD associated data, so an old ciphertext does not
--     authenticate at a new version, and NX001 forbids reusing the old one. The
--     only party that can produce a valid un-delete is a party holding CK_p —
--     which can seal ANY content and needs no help from this bit. Which of two
--     genuine writes wins is decided by the HLC merge inside the plaintext, and
--     that is the only layer that still works against an operator who can
--     disable this trigger outright.
--
--  3. IT WAS A WEAPON POINTED THE WRONG WAY. Consider the attacker this schema
--     actually fears reaching: a stolen session, no content key. It cannot
--     resurrect anything — but with RULE 3 in force it could `set deleted = true`
--     on every row, and no key-holder could ever undo it, because the honest
--     repair is precisely a write with `deleted = false`. RULE 3 did not prevent
--     an attack; it converted a repairable one into a permanent one, and handed
--     that upgrade to the exact party it was written against. A monotone-forward
--     column writable by an untrusted session is a one-way ratchet, and the
--     attacker's move is always to slam it to the far end. Monotonicity is safe
--     only where the far end is not a loss: `devices.revoked_at` qualifies (the
--     far end is „signed out", and re-pairing recovers it); user data does not.
--
-- Reclamation — hard-deleting old tombstones — was the one thing RULE 3 was
-- genuinely reaching for, and it never bought it: a device that never saw the
-- tombstone re-uploads the object as an INSERT, which an UPDATE rule never sees.
-- No role holds DELETE on this table today, so that is a future design and it is
-- recorded in `docs/STATUS.md` rather than paid for here with a broken feature.
--
-- ─── WHY THE INSERT BRANCH ASKS WHETHER THE ROW ALREADY EXISTS ──────────────
--
-- Verified against PostgreSQL 17, not inferred: in `insert … on conflict do
-- update`, every per-row BEFORE INSERT trigger fires BEFORE the conflict is
-- detected. So on the upsert path this branch is handed the version of an
-- UPDATE. A flat „a creation is version 1" here would therefore refuse every
-- upsert of an existing object at version 2 or above, and the failure would look
-- like a version bug rather than a trigger bug.
--
-- WHOSE PATH THAT IS, corrected 2026-08-09. This paragraph used to say „which is
-- how a client pushes", and that is false — measured, not re-read. PostgREST
-- compiles `Prefer: resolution=merge-duplicates` into `on conflict do update set
-- <every column in the payload>`, which needs the UPDATE privilege on all of
-- them, including the four identity columns migration 002 deliberately withholds
-- because they are the AEAD associated data. Every upsert by `authenticated`
-- therefore dies at `403 42501 permission denied for table sync_objects`, for a
-- creation exactly as for an update. The column grants that make a row's
-- identity immutable are what close the upsert path to clients, which is a good
-- outcome arrived at sideways.
--
-- A client pushes with two verbs instead — `POST` for a creation, `PATCH`
-- filtered by the four identity columns for an update — and knows which it is
-- from its own `RowState.version`. See `packages/sync-transport/src/push.ts`.
-- This branch still matters, because `service_role` CAN upsert: `pair-complete`
-- holds that key, and so will first-desktop registration.
--
-- The probe is one primary-key lookup and it makes the rule exact: a statement
-- that will really create a row is judged here, and a statement that will really
-- land on the UPDATE branch is judged there, by NX001. Note the probe runs as
-- the caller (SECURITY INVOKER), so RLS applies to it — a session that cannot
-- see the row cannot write it either, so the worst case is that an already-
-- refused write is refused with this code instead of a policy violation.

-- No `begin;`/`commit;` — the CLI wraps each migration file in a transaction of
-- its own; migration 001's header has the full reasoning.

create or replace function public.sync_objects_guard()
returns trigger
language plpgsql
-- SECURITY INVOKER (the default, stated for the reader): a trigger that ran as
-- definer would be a way to reach this table with privileges the caller does not
-- have, and this function has no need of any. It also keeps the primary-key
-- probe below inside the caller's own RLS, which is where it belongs.
security invoker
set search_path = ''
as $$
declare
  next_seq bigint;
begin
  -- THE INSERT PATH.
  if tg_op = 'INSERT' then
    -- A GENUINE CREATION STARTS AT 1. See the header for why this is conditional
    -- on the row not already existing, and why that is not defensive coding.
    --
    -- The rule is exact rather than a bound because NX001 makes it affordable:
    -- with every update pinned to `old.version + 1`, the version space cannot be
    -- jumped at all, so there is nothing left for a „large step" bound to
    -- refuse. This is what retired the old NX002 (step ≤ 65536) — it was a
    -- bound on an attack that is now unrepresentable, and a bound is only ever
    -- an argument about how much of the attack to permit.
    if new.version <> 1
       and not exists (
         select 1
           from public.sync_objects o
          where o.user_id = new.user_id
            and o.profile_id = new.profile_id
            and o.collection = new.collection
            and o.object_id = new.object_id
       ) then
      raise exception using
        errcode = 'NX002',
        message = 'a new sync_objects row must be created at version 1',
        detail  = format('object %s: first version %s', new.object_id, new.version),
        hint    = 'The server has no row for this object. Push it as a creation '
                  'at version 1, or pull first if you believe it exists.';
    end if;

    -- Stamped rather than defaulted, so the two columns are facts about the
    -- SERVER on every path — including the service-role one, where a column
    -- default is merely what happens when nobody says otherwise. The column
    -- comments in migration 001 promise a server clock; this is what makes that
    -- true rather than customary.
    new.created_at := now();
    new.updated_at := now();
    return new;
  end if;

  -- NX001 — THE VERSION IS EXACTLY ONE MORE THAN THE ONE BEING REPLACED.
  --
  -- This is a compare-and-swap, and it is stricter than the „strictly increases"
  -- rule it replaces for a reason that is not tidiness. Under `>`, a client that
  -- observed version 5 and wrote 9 — a drifted counter, a `max(local, remote)`
  -- that read the wrong side, any ordinary bug — silently overwrote versions 6,
  -- 7 and 8 that it had never seen. That is a LOST UPDATE accepted by the
  -- server with no error anywhere, which is the failure this whole subsystem
  -- exists to make impossible, and the old bounded-step rule did not help: it
  -- only capped how many edits one statement could erase.
  --
  -- Under `= old + 1` a write that did not see the current row cannot be
  -- expressed. The loser of a genuine race gets this error, and its correct
  -- response is to re-read and merge, never to retry the same bytes.
  --
  -- The server does not increment the counter itself, and cannot: the version is
  -- inside the AEAD associated data, so a number the server chose would not be a
  -- number the ciphertext authenticates. Advancing it is the client's job; this
  -- rule is what stops the client from advancing it by more than it may.
  --
  -- ONE CONSEQUENCE FOR THE ENGINE, since it is invisible from here. A push that
  -- the server accepted but whose RESPONSE was lost will be retried at a version
  -- that is now `old.version`, and will arrive here as NX001. That is not a
  -- conflict; it is a duplicate. The engine must re-read and treat „the server's
  -- row is byte-identical to what I sent" as success rather than as a race.
  if new.version <> old.version + 1 then
    raise exception using
      errcode = 'NX001',
      message = 'sync_objects.version must be exactly one more than the stored version',
      detail  = format('object %s: %s -> %s', old.object_id, old.version, new.version),
      hint    = 'Re-read the row, merge, and write observed_version + 1.';
  end if;

  -- NX004 — IDENTITY IS IMMUTABLE.
  -- These four columns are the AEAD associated data. Moving a row between users,
  -- profiles, collections or object ids is exactly the attack the AAD exists to
  -- defeat, and the AAD does defeat it — the moved row simply fails to open. But
  -- „fails to open" is indistinguishable from corruption, and a client meeting
  -- it has to decide between „someone is attacking me" and „my disk is bad". Far
  -- better that the move never lands. Note that migration 002 already withholds
  -- the UPDATE privilege on all four, so an ordinary PostgREST request dies at
  -- the parser with 42501 and never reaches here; this catches the paths that
  -- have privileges — a future `security definer` helper, a maintenance script,
  -- a role granted more than it needed — which are the paths nobody reviews.
  if new.user_id is distinct from old.user_id
     or new.profile_id is distinct from old.profile_id
     or new.collection is distinct from old.collection
     or new.object_id is distinct from old.object_id then
    raise exception using
      errcode = 'NX004',
      message = 'sync_objects identity columns are immutable',
      detail  = format('object %s: user/profile/collection/object_id may not change',
                       old.object_id),
      hint    = 'These four columns are the AEAD associated data.';
  end if;

  -- NX006 — THE CONTENT-KEY EPOCH ONLY GOES UP.
  -- `ck_epoch` is the one identity-ish column a client MAY change, because
  -- raising it is what re-encrypting a profile under a new content key looks
  -- like. Lowering it is the reverse of a rotation, and a rotation exists
  -- precisely to lock out a party that already holds the old key: rolling a row
  -- back to the old epoch, together with the old ciphertext some peer still has,
  -- hands that party the row again. It is bound into the AAD, so the rolled-back
  -- row would not open under the NEW key — but it would open perfectly under the
  -- old one, in the hands of the only person who still has it.
  --
  -- The upper end is not bounded here but by NX007, the separate AFTER trigger
  -- at the foot of this file, which is the stronger statement: an epoch may rise
  -- to any generation whose key actually exists, and to nothing else.
  if new.ck_epoch < old.ck_epoch then
    raise exception using
      errcode = 'NX006',
      message = 'sync_objects.ck_epoch may not go backwards',
      detail  = format('object %s: epoch %s -> %s', old.object_id, old.ck_epoch, new.ck_epoch),
      hint    = 'A content-key rotation only ever moves forward.';
  end if;

  -- NX003 — THE CIPHERTEXT CHANGES WITH THE VERSION.
  --
  -- Zero false positives, and that is provable rather than hoped for: NX001
  -- forces the version to change on every update, the version is in the
  -- associated data, and NX005 forbids reusing the nonce — so an honest
  -- re-seal cannot produce the bytes it produced last time. An unchanged
  -- ciphertext at a new version is therefore ALWAYS a row that no key-holder
  -- wrote and no client can open.
  --
  -- What it buys is a whole family of key-free tampering made unrepresentable
  -- rather than merely detectable. Flip `deleted`, re-point `parent_id`, raise
  -- `ck_epoch` — every one of those is a cheap one-column UPDATE that silently
  -- bricks the row for every device, because all three are in the associated
  -- data. This refuses all of them at the door.
  --
  -- It is not a claim that a session-holder cannot brick a row: they hold UPDATE
  -- on `ciphertext` and can write 17 random bytes into it. Nothing at this layer
  -- can prevent that, because clients must be able to write ciphertext, and the
  -- honest repair for it is the next push at `version + 1`. What this rule
  -- removes is the ability to do damage WITHOUT touching the ciphertext, which
  -- is the cheap, quiet version of the same attack.
  if new.ciphertext = old.ciphertext then
    raise exception using
      errcode = 'NX003',
      message = 'sync_objects.ciphertext must be re-sealed for every version',
      detail  = format('object %s: version %s carries the ciphertext of version %s',
                       old.object_id, new.version, old.version),
      hint    = 'The version is in the AEAD associated data, so an unchanged '
                'ciphertext at a new version is a row no client can open.';
  end if;

  -- NX005 — THE NONCE IS FRESH ON EVERY WRITE.
  -- Migration 001 pins the nonce to 24 bytes and stops there, which fixes the
  -- CIPHER (XChaCha20-Poly1305) and says nothing about the one way that cipher
  -- can be destroyed by its caller. Reuse of a (key, nonce) pair under
  -- ChaCha20-Poly1305 is not a weakening, it is a break, and it is a break twice
  -- over: the keystream is a function of the key and the nonce alone, so two
  -- versions of a row written at one nonce publish the XOR of their plaintexts;
  -- and the Poly1305 one-time key is derived the same way, so two messages
  -- authenticated under it are enough to solve for `r` and `s` and forge any
  -- message at all under that pair.
  --
  -- THE ASSOCIATED DATA DOES NOT SAVE THIS, and it is worth being explicit
  -- because NX001 makes the AAD change on every single update. Associated data
  -- feeds the tag; it never touches the keystream. „Every version has a different
  -- AAD" is true here and buys nothing at all against nonce reuse.
  --
  -- THIS IS HALF THE NONCE POLICY, NOT ALL OF IT, and the halves are disjoint.
  -- This rule compares against the nonce THIS ROW is replacing, which is the one
  -- value the `sync_objects_nonce_unique` index in migration 001 structurally
  -- cannot see — the old value is gone in the same statement. The index covers
  -- the complementary case, a nonce repeated across DIFFERENT rows of one
  -- (profile, epoch), which is the shape a broken RNG produces and this rule
  -- would never notice. Neither proves global uniqueness; together they catch
  -- every repeat a real client can emit while it is still one row old.
  if new.nonce = old.nonce then
    raise exception using
      errcode = 'NX005',
      message = 'sync_objects.nonce must be freshly drawn for every version',
      detail  = format('object %s: version %s reuses the nonce of version %s',
                       old.object_id, new.version, old.version),
      hint    = 'Draw 24 fresh random bytes per encryption. Reuse under one key '
                'discloses the plaintext XOR and the Poly1305 forging key.';
  end if;

  -- THE SERVER'S OWN FACTS, RESTATED ON EVERY UPDATE.
  --
  -- `seq` is re-stamped, and this is a correctness requirement rather than
  -- hygiene. `seq` is the pull cursor. If it stayed fixed at the value the row
  -- received when it was first inserted, then a row edited today would still sit
  -- at its original position in the log — behind the watermark of every device
  -- that has already synced past it — and those devices would never see the edit.
  -- Sync would silently deliver creations and drop modifications, on a schedule
  -- set by how long ago each object was made, which is about the hardest bug
  -- shape there is to notice from the outside. A fresh sequence value moves the
  -- row to the head of the log, which is what „something changed here" means.
  --
  -- `pg_get_serial_sequence` rather than the literal `sync_objects_seq_seq`,
  -- because the literal is a guess about Postgres' naming that survives until
  -- somebody renames the table, at which point this line silently stamps from a
  -- sequence belonging to something else.
  next_seq := nextval(pg_get_serial_sequence('public.sync_objects', 'seq'));
  new.seq := next_seq;

  -- The client has no grant on `updated_at`, so it cannot state a time here; the
  -- column exists to record when the SERVER accepted the write. Stamping it in
  -- the trigger rather than leaning on the default is what keeps that true on
  -- UPDATE, where a column default does not apply at all.
  --
  -- IT IS NOT AN ATTESTED TIME FOR THE ROW'S CONTENT, and no client may use it
  -- as one. It moves on every version, so two devices that pull the same field
  -- at two different versions would read two different values for it — see
  -- `hlc.ts`, which used to propose exactly that and no longer does.
  new.updated_at := now();

  -- `created_at` is likewise pinned to OLD: it is the one timestamp that must
  -- survive every edit, and a stray `set created_at = ...` from a maintenance
  -- script would otherwise rewrite history without anyone noticing.
  new.created_at := old.created_at;

  return new;
end;
$$;

comment on function public.sync_objects_guard() is
  'BEFORE INSERT OR UPDATE guard: a creation starts at version 1; an update is '
  'observed_version + 1, '
  're-seals the ciphertext, keeps its identity, never lowers the epoch and '
  'draws a fresh nonce; seq/created_at/updated_at are the server''s. See the '
  'migration header for why none of this can be expressed as RLS, and for why '
  'the tombstone-is-terminal rule was removed.';

-- Default EXECUTE on a new function is granted to PUBLIC. For a trigger function
-- that is only an untidiness rather than a hole — calling it outside a trigger
-- raises `trigger functions can only be called as triggers` — but it is exactly
-- the reflex that becomes a hole the day a function in this schema does
-- something on the caller's behalf, so it is revoked here as a habit worth
-- having.
revoke all on function public.sync_objects_guard() from public;
revoke all on function public.sync_objects_guard() from anon;
revoke all on function public.sync_objects_guard() from authenticated;

-- Named for what it does rather than for when it fires on one of the two paths.
-- It was `…_before_update` while it only guarded updates; leaving that name after
-- adding the INSERT branch would have made the catalog say one thing and the
-- function do another, and a trigger's name is the only description of it most
-- readers ever see.
create trigger sync_objects_guard_before_write
  before insert or update on public.sync_objects
  for each row
  execute function public.sync_objects_guard();

-- ---------------------------------------------------------------------------
-- NX007 — the content-key epoch names a wrap that exists.
-- ---------------------------------------------------------------------------
-- WHY THIS IS A SECOND TRIGGER, AND WHY IT FIRES AFTER. It was one rule at the
-- top of the function above, and running the suite showed that to be wrong in a
-- way reading could not: a BEFORE trigger fires before RLS evaluates `WITH
-- CHECK`, so a cross-tenant INSERT — user B writing into user A's space —
-- reached this rule first. The probe runs as the caller, B cannot see A's wraps,
-- so B was told „this epoch has no content-key wrap" where it should have been
-- told 42501. The write was still refused, but the refusal came from the wrong
-- wall and named a fact about data the caller is not allowed to know exists.
--
-- The general rule that produced the mistake, worth keeping: TENANCY DECIDES
-- FIRST. A data-integrity rule evaluated under the caller's own visibility can
-- only be meaningful once it is established that the caller is entitled to the
-- row, and in PostgreSQL the only place after `WITH CHECK` is an AFTER trigger.
-- Moving it here also restores the BEFORE trigger's error precedence: an attempt
-- to move a row to another user now reports NX004 rather than being masked by an
-- epoch lookup performed against the destination it was never allowed to name.
--
-- WHAT THE RULE IS FOR. `ck_epoch` is writable by any session on the account, it
-- may only ever rise (NX006), and `smallint` tops out at 32 767 — so without
-- this a stolen session sets one row to the ceiling and NO future rotation can
-- bring a key up to meet it. The row is unopenable forever, by everyone,
-- including the owner. Bounding the STEP was the obvious alternative and it is
-- strictly weaker: it makes the same attack take a few thousand statements
-- instead of one. Naming the epoch against the set of keys that actually exist
-- makes it unrepresentable, and costs one index probe. It also states the
-- ordering a client already had to follow — store `ck_under_mk` for the epoch
-- BEFORE sealing anything under it — as a rule the database enforces rather
-- than a convention a client is trusted to remember.
create or replace function public.sync_objects_epoch_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (
    select 1
      from public.key_wraps w
     where w.user_id = new.user_id
       and w.kind = 'ck_under_mk'
       and w.profile_id = new.profile_id
       and w.epoch = new.ck_epoch
  ) then
    raise exception using
      errcode = 'NX007',
      message = 'sync_objects.ck_epoch names no content-key wrap',
      detail  = format('object %s: profile %s has no ck_under_mk wrap at epoch %s',
                       new.object_id, new.profile_id, new.ck_epoch),
      hint    = 'Store the wrapped content key for this epoch before sealing '
                'rows under it. An epoch with no wrap is a row nobody can open.';
  end if;
  -- The return value of an AFTER ROW trigger is ignored; the raise above is the
  -- entire effect, and it aborts the statement exactly as a BEFORE raise would.
  return null;
end;
$$;

comment on function public.sync_objects_epoch_guard() is
  'AFTER INSERT OR UPDATE: a row may only name a content-key generation whose '
  'ck_under_mk wrap exists (NX007). AFTER rather than BEFORE so RLS decides '
  'tenancy first — see the block comment above the function.';

revoke all on function public.sync_objects_epoch_guard() from public;
revoke all on function public.sync_objects_epoch_guard() from anon;
revoke all on function public.sync_objects_epoch_guard() from authenticated;

create trigger sync_objects_epoch_guard_after_write
  after insert or update on public.sync_objects
  for each row
  execute function public.sync_objects_epoch_guard();
