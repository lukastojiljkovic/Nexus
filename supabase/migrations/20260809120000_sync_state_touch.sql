-- Nexus sync — migration 008: `sync_state.updated_at` becomes a fact about the
-- server, like every other `updated_at` in this schema.
--
-- WHAT WAS WRONG. Migration 001 comments the column as „LEAKS: when the device
-- last synced", and migration 002 granted `authenticated` UPDATE on it. Those
-- two sentences do not describe the same column. A client-written timestamp is
-- the client's claim about its own clock — it can be any value at all, including
-- one that makes a device look active long after it was lost — and this is the
-- one column of this table a human might read as evidence that a device is
-- alive. Worse, nothing wrote it: `default now()` fires on INSERT only, so the
-- column would have sat at „when this cursor row was first created" forever
-- while reading as „last synced", which is the failure shape that is hardest to
-- notice because it is populated, plausible, and monotonically wrong.
--
-- Migration 003 already made exactly this call for `sync_objects`: „The client
-- has no grant on `updated_at`, so it cannot state a time here; the column
-- exists to record when the SERVER accepted the write." The same rule now holds
-- on both tables that carry the column, which is the point — one rule applied
-- twice, rather than one rule and one exception nobody wrote down.
--
-- WHY A TRIGGER RATHER THAN JUST REVOKING THE GRANT. Revoking alone leaves the
-- column frozen at its insert-time default, which is the „populated, plausible,
-- wrong" state above. The trigger is what makes the comment true; the revoke is
-- what stops it being contradicted.
--
-- SCOPE. This changes no policy and no other table. `last_seq` stays exactly as
-- it was: writable, advisory, and — per migration 001's header — a floor the
-- client raises rather than a number it trusts.

-- No `begin;`/`commit;` — the CLI wraps each migration file in a transaction of
-- its own; migration 001's header has the full reasoning.

create or replace function public.sync_state_touch()
returns trigger
language plpgsql
-- SECURITY INVOKER, stated rather than left to the default: this function needs
-- no privilege the caller lacks, and a definer trigger on a table clients write
-- to is a standing escalation primitive that every later edit inherits silently.
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function public.sync_state_touch() is
  'BEFORE INSERT OR UPDATE on sync_state: updated_at is the server''s clock, '
  'never the client''s. See the migration header.';

revoke all on function public.sync_state_touch() from public;
revoke all on function public.sync_state_touch() from anon;
revoke all on function public.sync_state_touch() from authenticated;

create trigger sync_state_touch_before_write
  before insert or update on public.sync_state
  for each row
  execute function public.sync_state_touch();

-- The grant that made the column a client claim. Removing it means a statement
-- naming `updated_at` now dies at the parser with 42501 before a row is
-- examined — the same two-mechanism arrangement migration 002 describes for
-- `sync_objects`' identity columns, because privileges cannot see OLD and
-- triggers cannot see the statement.
--
-- Written as an explicit column revoke rather than a full `revoke update` plus a
-- narrower re-grant, so that a reader of this file can see that `last_seq`
-- keeps exactly the privilege it had.
revoke update (updated_at) on public.sync_state from authenticated;
