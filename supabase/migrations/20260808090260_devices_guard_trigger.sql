-- Nexus sync — migration 003c: the BEFORE UPDATE guard on `devices`.
--
-- WHY REVOCATION NEEDS A TRIGGER AND NOT JUST A GRANT. `revoked_at` has to be
-- writable — a device must be able to sign itself out, and the device manager
-- must be able to sign out the others — so the column grant cannot protect it.
-- What must not be writable is the SECOND write: the one that sets it back to
-- null. That is a statement about the transition, and a privilege cannot see the
-- transition. This file is the same argument the `sync_objects` guard makes about
-- tombstones, applied to the other place in this schema where a fact is recorded
-- by writing a timestamp: a fact that can be withdrawn is not a fact.
--
-- AND REVOCATION IS THE FACT THAT MATTERS MOST, because of what it is standing in
-- for. Marking `revoked_at` does NOT end the GoTrue session — the refresh token
-- in that client's hands still works and still mints access tokens. The only
-- thing that stops the revoked device reading anything is
-- `private.nexus_session_is_live()` returning false, and it returns false solely
-- because of this column. So „odjavi ovaj uređaj" is, end to end, one timestamp.
-- Un-setting it is not an edit to a log; it is handing the machine back.
--
-- WHO COULD UN-SET IT, before this file: any aal2 session on the account. That is
-- the user's own browser, which is also the surface an attacker reaches with a
-- stolen password plus a stolen second factor — precisely the case the user was
-- revoking a device to recover from. The revocation would appear in the device
-- list, be quietly reversed, and appear again on the next refresh with no record
-- that anything happened.
--
-- SEE ALSO the residual this does not close, recorded honestly in the README:
-- revocation still ought to invalidate the GoTrue session itself, so that the
-- refresh token dies with the row rather than merely being ignored by four
-- policies. That needs an authenticated Edge Function calling the admin API, and
-- it is not built.

-- No `begin;`/`commit;` — the CLI wraps each migration file in a transaction of
-- its own; migration 001's header has the full reasoning.

create or replace function public.devices_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- Terminal, not immutable. Going from null to a timestamp is the revocation
  -- itself and must be allowed; every other transition of this column — clearing
  -- it, or moving it to a different time — is a rewrite of the only record that
  -- the session was ended.
  if old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at then
    raise exception using
      errcode = 'NX008',
      message = 'devices.revoked_at is terminal — a revoked device stays revoked',
      detail  = format('device %s was revoked at %s', old.id, old.revoked_at),
      hint    = 'Pair the machine again to give it a new session and a new row; '
                'the revoked row is the proof that the old session is dead.';
  end if;

  -- The four columns that identify the row and the one that attests to what it
  -- is. Migration 002 already withholds the UPDATE grant on all five, so a
  -- PostgREST request dies at the parser and never arrives here — this catches the
  -- paths that have privileges anyway, which are the paths nobody reviews. Two
  -- mechanisms, because a privilege cannot see OLD and a trigger cannot see the
  -- statement.
  --
  -- `platform` is on this list for a reason that is not symmetry: it is the only
  -- column in the schema that could ever separate a browser from a desktop, and a
  -- value that can be edited after the fact attests to nothing. `pair-complete`
  -- writes it once, at INSERT, under the service-role key.
  if new.id is distinct from old.id
     or new.user_id is distinct from old.user_id
     or new.session_id is distinct from old.session_id
     or new.platform is distinct from old.platform then
    raise exception using
      errcode = 'NX009',
      message = 'devices identity is immutable',
      detail  = format('device %s: id/user/session/platform may not change', old.id),
      hint    = 'A device row is the binding between one client and one auth '
                'session. Re-pointing it vouches for a session nobody paired.';
  end if;

  new.created_at := old.created_at;
  return new;
end;
$$;

comment on function public.devices_guard() is
  'BEFORE UPDATE guard: revoked_at is terminal (NX008), id/user/session/platform '
  'are immutable (NX009), created_at survives. See the migration header.';

revoke all on function public.devices_guard() from public;
revoke all on function public.devices_guard() from anon;
revoke all on function public.devices_guard() from authenticated;

create trigger devices_guard_before_update
  before update on public.devices
  for each row
  execute function public.devices_guard();
