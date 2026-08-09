-- Nexus sync — migration 003b: the BEFORE UPDATE guard on `key_wraps`.
--
-- WHY THIS TABLE NEEDS ITS OWN TRIGGER, WHEN THE GRANTS IN MIGRATION 002 ALREADY
-- WITHHOLD THE COLUMNS. Same answer as `sync_objects`, and it is worth restating
-- because this table holds the keys rather than the data. Privileges are checked
-- against the STATEMENT and cannot see OLD; a trigger sees the transition and
-- cannot see who is writing. Neither replaces the other, and the paths they cover
-- differ: a column grant stops an ordinary PostgREST request at the parser, and
-- this stops the paths that have privileges anyway — a maintenance script, a
-- future `security definer` helper, a role that was granted more than it needed.
-- Those are the paths nobody reviews, and this is the table where not reviewing
-- them costs the most.
--
-- THE ERROR CODES ARE BANDED BY TABLE — `sync_objects` owns NX0xx, this table
-- owns NX1xx, `devices` owns NX2xx. That is not filing: these codes reach the
-- client verbatim in PostgREST's response body (verified against PostgREST
-- v14.16, which maps an unknown SQLSTATE to HTTP 400 and passes `code`, `detail`
-- and `hint` straight through), so they are the sync engine's error map. Two
-- tables sharing a code — which is what happened, with NX007 meaning both „slot
-- identity is immutable" here and „the epoch may not fall" there — makes that
-- map ambiguous exactly where it is used to decide between „re-read and merge"
-- and „stop and tell the user". A band per table cannot collide by accident.
--
-- WHAT IT REFUSES, AND WHY EACH ONE MATTERS MORE HERE THAN ANYWHERE ELSE.
--
--   NX101 — a re-wrap that keeps the old nonce. This is the rotation path, and
--   rotation is the ONLY answer this design has to „a browser already received
--   that content key". Migration 001 says so plainly: `disabled_at` records
--   intent and stops the next hand-out, it does not reach into a machine that
--   already holds the key, so the key must be replaced and the rows re-encrypted.
--   Now consider that rotation performed at the old nonce. `ck_under_mk` is
--   wrapped under MK, and MK does not change when a content key does — so the old
--   wrap and the new wrap are two messages under one (key, nonce) pair, and their
--   ciphertexts XOR to CK_old XOR CK_new. Anyone holding CK_old — which is
--   exactly and only the party the rotation was performed to lock out — recovers
--   CK_new by subtraction. The rotation would not merely fail; it would hand the
--   new key to its intended victim, and every re-encrypted row with it.
--
--   NX102 — moving a wrap between slots. `kind`, `profile_id` and `epoch` are
--   what a wrap IS: „the master key under the password", or „profile P's content
--   key, third generation". Change `profile_id` and the same ciphertext now
--   claims to be a different profile's key — it still opens under MK, because
--   nothing in the AEAD ties it to the slot unless the client bound `profile_id`
--   into the associated data, and that is a client rule this database cannot
--   check. Two things break. A client would encrypt profile P2's rows under
--   CK_P1. And „this profile stays on my computer", which migration 001 models
--   as the ABSENCE of a `ck_under_mk` row precisely because an absence cannot be
--   flipped like a flag, would be one UPDATE away from being present — no
--   forgery, no new row, just a column edit.
--
--   `epoch` is on the same list and adds a third break of its own. Migration 003
--   admits a `sync_objects.ck_epoch` only while a wrap exists at that epoch, so
--   moving a wrap from epoch 2 to epoch 3 does not merely mislabel a key: it
--   strands every row still sealed at epoch 2 behind a generation that no longer
--   has one, and no client can open them again.

-- No `begin;`/`commit;` — the CLI wraps each migration file in a transaction of
-- its own; migration 001's header has the full reasoning.

create or replace function public.key_wraps_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- Conditional on `wrapped` changing, unlike the `sync_objects` rule which is
  -- unconditional. There, the version is in the associated data and NX001 makes
  -- it move on every update, so every update is a fresh encryption. Here the
  -- common update is `disabled_at := now()` or `rotated_at := now()`, which
  -- re-encrypts nothing and has no business drawing a nonce. Demanding one would
  -- be a rule that fires on the honest path and teaches the client to work around
  -- it, which is how a control stops being applied.
  if new.wrapped is distinct from old.wrapped
     and new.nonce is not distinct from old.nonce then
    raise exception using
      errcode = 'NX101',
      message = 'key_wraps.nonce must be freshly drawn whenever the wrap changes',
      detail  = format('wrap %s (%s): new ciphertext at the previous nonce',
                       old.id, old.kind),
      hint    = 'A re-wrap under the same key at the same nonce discloses the '
                'XOR of the old and new keys to whoever holds the old one.';
  end if;

  if new.id is distinct from old.id
     or new.user_id is distinct from old.user_id
     or new.kind is distinct from old.kind
     or new.profile_id is distinct from old.profile_id
     or new.epoch is distinct from old.epoch then
    raise exception using
      errcode = 'NX102',
      message = 'key_wraps slot identity is immutable',
      detail  = format('wrap %s (%s): id/user/kind/profile/epoch may not change',
                       old.id, old.kind),
      hint    = 'A wrap belongs to one slot. Retire it with disabled_at and '
                'insert the new one; a profile is web-enabled by the existence '
                'of its row, so moving a row moves that guarantee with it, and '
                'moving its epoch strands every row sealed at the old one.';
  end if;

  -- `created_at` is when this recovery path was armed, and it is the one value
  -- here that must survive every rotation — it is what a user reads to answer
  -- „since when could this password open my account". Pinned to OLD rather than
  -- merely ungranted, so a script with privileges cannot rewrite it either.
  new.created_at := old.created_at;
  return new;
end;
$$;

comment on function public.key_wraps_guard() is
  'BEFORE UPDATE guard: a changed wrap needs a fresh nonce (NX101), slot '
  'identity — id/user/kind/profile/epoch — is immutable (NX102), created_at '
  'survives. See the migration header.';

revoke all on function public.key_wraps_guard() from public;
revoke all on function public.key_wraps_guard() from anon;
revoke all on function public.key_wraps_guard() from authenticated;

create trigger key_wraps_guard_before_update
  before update on public.key_wraps
  for each row
  execute function public.key_wraps_guard();
