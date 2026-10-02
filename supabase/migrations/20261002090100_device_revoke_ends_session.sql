-- Neagle sync — migration 015: revoking a device ends its GoTrue session.
--
-- THE RESIDUAL THIS CLOSES. `devices.revoked_at` is checked by the restrictive
-- policies on every statement, so a revoked device reads nothing with an access
-- token it already holds. But the SESSION behind that token lives in
-- `auth.sessions`, and GoTrue keeps minting fresh access tokens from the refresh
-- token in that client's hands. The wall refuses each one and the session never
-- dies — which is a revocation that has to be re-applied to every request
-- forever instead of one that ends the thing it names. The README recorded that
-- honestly as §6.2 and called the admin sign-out API the correct end state. This
-- migration reaches the same end state from inside the transaction that records
-- the revocation, because the session is already in this database.
--
-- WHY A TRIGGER, AND NOT A SECOND CALL THE REVOKER HAS TO REMEMBER. The desktop
-- revokes over PostgREST by PATCHing `revoked_at`
-- (`packages/sync-transport/src/devices.ts`). A revocation whose completeness
-- depends on the revoked party making one more request is not a revocation: the
-- revoked client, or the machine that has just been labelled hostile, is exactly
-- the party that must not hold the second half. Migration 003c already treats the
-- WRITE of `revoked_at` as the fact that ends the session; this is the other half
-- of that same transition, which is why it is an AFTER trigger on it.
--
-- IT CANNOT BE UNDONE. The BEFORE guard in migration 003c makes `revoked_at`
-- terminal (`NX201`), so there is no path that puts the timestamp back and no
-- path that re-creates the deleted session from here. A machine that has been
-- revoked comes back by pairing again, with a new session and a new row.
--
-- DELETING THE SESSION TAKES THE REFRESH TOKEN WITH IT. GoTrue's
-- `auth.refresh_tokens.session_id` is `on delete cascade`, so the refresh token
-- for the session is removed by the same statement. A `devices` row naming a
-- session that no longer exists is the state `nexus_device_register` already
-- treats as "stranded" (migration 013 and
-- `tests/database/06_device_register.test.sql`); the DELETE here is a no-op on
-- that path rather than a second failure mode.
--
-- SECURITY DEFINER, because `auth` is not writable by the roles a client holds
-- and this function must be. It lives in `private`, which PostgREST does not
-- route to, and EXECUTE is revoked from PUBLIC, anon and authenticated anyway —
-- two mechanisms, because a schema list is one careless edit away from including
-- `private` and a REVOKE is not.

-- No `begin;`/`commit;` — the CLI wraps each migration file in a transaction of
-- its own; migration 001's header has the full reasoning.

create or replace function private.nexus_end_device_session()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- One statement, so the session and its cascade go together. `old.session_id`
  -- is the binding the BEFORE guard refuses to let anyone re-point (NX202).
  delete from auth.sessions where id = old.session_id;
  return null;
end;
$$;

comment on function private.nexus_end_device_session() is
  'AFTER UPDATE OF revoked_at on public.devices: deletes the GoTrue session the '
  'device row is bound to, so the refresh token dies with the revocation. '
  'No-op when the session row is already gone. See the migration header.';

revoke all on function private.nexus_end_device_session() from public;
revoke all on function private.nexus_end_device_session() from anon;
revoke all on function private.nexus_end_device_session() from authenticated;

-- `WHEN (old.revoked_at is null and new.revoked_at is not null)` states the
-- transition, not the column. `UPDATE OF revoked_at` alone fires on any SET that
-- names the column, including a no-op rewrite, and the guard trigger allows a
-- rewrite that leaves the value alone; the WHEN clause is what keeps this to the
-- one transition that IS the revocation.
create trigger devices_end_session_after_revoke
  after update of revoked_at on public.devices
  for each row
  when (old.revoked_at is null and new.revoked_at is not null)
  execute function private.nexus_end_device_session();
