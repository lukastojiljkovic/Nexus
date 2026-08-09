-- Nexus sync — migration 003: the BEFORE UPDATE guard on `sync_objects`.
--
-- WHY A TRIGGER AND NOT MORE RLS. A policy's `WITH CHECK` is handed the NEW row
-- and only the NEW row. Every rule below is a statement about the TRANSITION —
-- „higher than what it was", „was not already a tombstone", „still the same
-- object" — and a predicate that cannot see OLD cannot express any of them. This
-- is not a preference; it is the reason this file exists at all. RLS answers
-- „may this session touch this row"; nothing in RLS can answer „is this a legal
-- next state of this row".
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
-- WHY IT FIRES ON INSERT TOO, WHICH IT ORIGINALLY DID NOT. The first version was
-- said to be „bounded by the `sync_objects_version_range` CHECK", and it is —
-- bounded at 2^53-1, which is the exact number RULE 2 exists to refuse. So the
-- lock-out defence held for every row that already existed and was absent for
-- every row being created: `insert … version = 9007199254740991` was legal, and
-- an object created that way is frozen at its first write. The INSERT branch
-- applies the same constant as the UPDATE branch, treating a creation as a step
-- from an implicit version 0, which is what it is. Sharing the constant is also
-- the answer to the original objection — there is one bound, stated once, and
-- the two paths cannot disagree because they read the same declaration.

-- No `begin;`/`commit;` — the CLI wraps each migration file in a transaction of
-- its own; migration 001's header has the full reasoning.

create or replace function public.sync_objects_guard()
returns trigger
language plpgsql
-- SECURITY INVOKER (the default, stated for the reader): a trigger that ran as
-- definer would be a way to reach this table with privileges the caller does not
-- have, and this function has no need of any.
security invoker
set search_path = ''
as $$
declare
  -- 65 536. The bound is not an opinion about how fast clients count; it exists
  -- so that a SINGLE statement cannot consume the version space. The arithmetic:
  -- the ceiling is 2^53-1, so from version 1 it now takes at least 2^53/2^16 =
  -- 2^37 ≈ 137 billion successful UPDATEs to exhaust an object — which no
  -- attacker reaches through a rate-limited HTTPS API, and no user reaches in a
  -- lifetime. Meanwhile the honest path pushes `observed_version + 1` and never
  -- comes near the bound; even a client that mints a version per local edit
  -- would need 65 536 offline edits to one object between two syncs.
  --
  -- The bound deliberately does NOT try to be tight. A tight bound turns a
  -- legitimate long offline session into a permanent sync stall that the user
  -- cannot diagnose or clear, which is a worse failure than the one it prevents:
  -- the lock-out this guards against needs a jump of ~2^53, and anything in the
  -- same order of magnitude as honest traffic is not that.
  max_version_step constant bigint := 65536;
  next_seq bigint;
begin
  -- THE INSERT PATH. One rule and one stamping; there is no OLD, so nothing else
  -- below has anything to compare against.
  if tg_op = 'INSERT' then
    if new.version > max_version_step then
      raise exception using
        errcode = 'NX002',
        message = 'sync_objects.version step exceeds the permitted bound',
        detail  = format('object %s: first version %s exceeds %s',
                         new.object_id, new.version, max_version_step),
        hint    = 'A new object starts near 1. A first version this high can '
                  'only be a lock-out attempt or a client minting versions '
                  'from a clock.';
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

  -- RULE 1 — VERSION STRICTLY INCREASES.
  -- Equality is rejected along with regress, and that is intentional: the
  -- version is bound into the AEAD associated data, so a same-version write with
  -- different ciphertext is either a forgery attempt or a client that has lost
  -- track of its own counter, and there is no reading of it under which the
  -- server should keep the newer bytes. It is also the optimistic-concurrency
  -- check: two devices racing on one object produce exactly this error for the
  -- loser, whose correct response is to re-read and merge, not to retry.
  if new.version <= old.version then
    raise exception using
      errcode = 'NX001',
      message = 'sync_objects.version must strictly increase',
      detail  = format('object %s: %s -> %s', old.object_id, old.version, new.version),
      hint    = 'Re-read the row, merge, and write observed_version + 1.';
  end if;

  -- RULE 2 — THE STEP IS BOUNDED.
  if new.version - old.version > max_version_step then
    raise exception using
      errcode = 'NX002',
      message = 'sync_objects.version step exceeds the permitted bound',
      detail  = format('object %s: step %s exceeds %s',
                       old.object_id, new.version - old.version, max_version_step),
      hint    = 'A version jump this large can only be a lock-out attempt or a '
                'client that mints versions from a clock.';
  end if;

  -- RULE 3 — A TOMBSTONE IS TERMINAL.
  -- Deletion replicates as a fact, and a fact that can be withdrawn is not one.
  -- If `deleted` could go back to false, a peer holding the pre-delete
  -- ciphertext could un-delete anything at any time; worse, so could whoever
  -- holds this database, which is the one party the entire design assumes is
  -- hostile. Editing a tombstone is still allowed — a compaction may rewrite the
  -- payload, and the version must keep climbing — but the bit only travels one
  -- way. Genuine „undo the delete" is a NEW object with a new id, which is
  -- correct: what comes back is a copy, and the tombstone stays true.
  if old.deleted and not new.deleted then
    raise exception using
      errcode = 'NX003',
      message = 'a tombstoned sync_objects row cannot be resurrected',
      detail  = format('object %s is deleted', old.object_id),
      hint    = 'Insert a new object instead; the tombstone must remain true.';
  end if;

  -- RULE 4 — IDENTITY IS IMMUTABLE.
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

  -- RULE 4b — THE CONTENT-KEY EPOCH ONLY GOES UP.
  -- `ck_epoch` is the one identity-ish column a client MAY change, because
  -- raising it is what re-encrypting a profile under a new content key looks
  -- like. Lowering it is the reverse of a rotation, and a rotation exists
  -- precisely to lock out a party that already holds the old key: rolling a row
  -- back to the old epoch, together with the old ciphertext some peer still has,
  -- hands that party the row again. It is bound into the AAD, so the rolled-back
  -- row would not open under the NEW key — but it would open perfectly under the
  -- old one, in the hands of the only person who still has it.
  if new.ck_epoch < old.ck_epoch then
    raise exception using
      errcode = 'NX007',
      message = 'sync_objects.ck_epoch may not go backwards',
      detail  = format('object %s: epoch %s -> %s', old.object_id, old.ck_epoch, new.ck_epoch),
      hint    = 'A content-key rotation only ever moves forward.';
  end if;

  -- RULE 5 — THE NONCE IS FRESH ON EVERY WRITE.
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
  -- because RULE 1 makes the AAD change on every single update. Associated data
  -- feeds the tag; it never touches the keystream. „Every version has a different
  -- AAD" is true here and buys nothing at all against nonce reuse.
  --
  -- Rejecting equality with the IMMEDIATELY PRECEDING nonce is not a proof of
  -- global uniqueness — the database cannot hold every nonce an object has ever
  -- used, and it does not need to: 24 random bytes have no birthday bound worth
  -- writing down, so the only realistic source of a repeat is a client that
  -- forgot to draw a new one. That is precisely the case this catches, and it
  -- catches it at the moment it would otherwise have shipped.
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
  new.updated_at := now();

  -- `created_at` is likewise pinned to OLD: it is the one timestamp that must
  -- survive every edit, and a stray `set created_at = ...` from a maintenance
  -- script would otherwise rewrite history without anyone noticing.
  new.created_at := old.created_at;

  return new;
end;
$$;

comment on function public.sync_objects_guard() is
  'BEFORE INSERT OR UPDATE guard: bounded first version; then monotone bounded '
  'version, terminal tombstone, immutable identity, fresh nonce, server-stamped '
  'seq/created_at/updated_at. See the migration header for why none of this can '
  'be expressed as RLS.';

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

