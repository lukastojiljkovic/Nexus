-- Nexus sync — migration 005: the three routines `pair-complete` calls, and the
-- grants that make them unreachable from anywhere else.
--
-- WHY THESE ARE IN SQL AND NOT IN THE EDGE FUNCTION. Two of them are latches —
-- „has this token been used" and „has this caller had too many goes" — and a
-- latch implemented as read-then-write in application code is not a latch. Two
-- concurrent requests both read „unused", both proceed, and the single-use
-- pairing token has just been used twice; the rate limiter with the same shape
-- lets an attacker run as many attempts as they can start in parallel, which is
-- the only number that matters. Written as one statement each, the database's
-- row lock does the work and concurrency stops being a variable.
--
-- The third reason is the clock. `expires_at > now()` evaluated in Deno is a
-- claim about the function host's clock; evaluated here it is a claim about the
-- same clock that wrote `expires_at`. A ten-minute TTL compared against a
-- different clock is a TTL of ten minutes plus whatever the drift is.
--
-- THE GRANT PATTERN, WHICH IS THE WHOLE SECURITY STORY OF THIS FILE. Postgres
-- grants EXECUTE on every new function to PUBLIC. These three live in `public`,
-- which PostgREST exposes, so on default privileges each one would be an RPC any
-- holder of the publishable key could call — including
-- `nexus_pair_claim`, which would let an unauthenticated caller consume a
-- pairing and learn the account uuid behind it. Every function below is
-- therefore revoked from PUBLIC, anon and authenticated, and granted to
-- `service_role` alone. They are in `public` rather than `private` for exactly
-- one reason: PostgREST can only route to an exposed schema, and the Edge
-- Function reaches them over PostgREST.

-- No `begin;`/`commit;` — the CLI wraps each migration file in a transaction of
-- its own; migration 001's header has the full reasoning.

-- DELETE included, unlike every table in `public` except `pairing`. These rows
-- are counters, not user state: nothing replicates them, nothing re-creates
-- them, and `nexus_sync_housekeeping` has to be able to reap stale windows or
-- the table grows one row per caller address forever.
grant select, insert, update, delete on private.pair_rate_limit to service_role;

-- ---------------------------------------------------------------------------
-- Rate limiting.
-- ---------------------------------------------------------------------------
-- A FIXED WINDOW, NOT A SLIDING ONE, and the choice is deliberate. A fixed
-- window lets a caller spend its whole budget at the end of one window and again
-- at the start of the next — twice the nominal rate for one instant. For a
-- pairing endpoint that is irrelevant: the thing being protected is a ~65-bit
-- code that burns on its first authentication failure, so the attacker's budget
-- is one wrong guess, not `p_limit` of them. What the limiter is actually for is
-- keeping an unauthenticated endpoint from being a free amplifier — Argon2id
-- verification, a session mint, an insert — and a fixed window in one row does
-- that at a cost that does not itself become the amplifier.
--
-- `bucket_key` MUST ARRIVE SALTED AND HASHED. The caller passes a digest, never
-- an IP. This table would otherwise be an access log with a different name,
-- sitting inside the one database whose operator the design assumes is hostile,
-- and „we do not log IPs" would be false in a way nobody would notice.
create or replace function public.nexus_pair_rate_limit_hit(
  p_bucket_key text,
  p_limit      integer,
  p_window     interval
) returns boolean
language plpgsql
-- INVOKER, not DEFINER. `private.pair_rate_limit` has RLS enabled and FORCED
-- with no policies at all, so a definer running as the table's owner would be
-- denied exactly like everyone else — FORCE is what removes the owner
-- exemption. The only role that reaches it is one carrying BYPASSRLS, which in
-- Supabase means `service_role`, which is the only role granted EXECUTE below.
-- The privilege chain is therefore one link long and visible in one file.
security invoker
set search_path = ''
as $$
declare
  v_hits integer;
begin
  if p_limit < 1 or p_window <= interval '0' then
    raise exception using
      errcode = 'NX301',
      message = 'rate limit parameters must be positive';
  end if;

  insert into private.pair_rate_limit as t (bucket_key, window_start, hits)
  values (p_bucket_key, now(), 1)
  on conflict (bucket_key) do update
     set window_start = case
           when t.window_start < now() - p_window then now()
           else t.window_start
         end,
         -- `least(..., 1000000)` rather than a bare increment: under a sustained
         -- attack this counter is the only thing growing, and an unbounded
         -- `integer` reaches 2^31 and raises — turning the rate limiter itself
         -- into the outage. Saturating is the correct behaviour for a value
         -- whose only use is a comparison against a small limit.
         hits = case
           when t.window_start < now() - p_window then 1
           else least(t.hits + 1, 1000000)
         end
  returning t.hits into v_hits;

  return v_hits <= p_limit;
end;
$$;

comment on function public.nexus_pair_rate_limit_hit(text, integer, interval) is
  'Atomic fixed-window rate limit for pair-complete. service_role only. '
  'bucket_key must be a salted digest, never a raw IP.';

revoke all on function public.nexus_pair_rate_limit_hit(text, integer, interval) from public;
revoke all on function public.nexus_pair_rate_limit_hit(text, integer, interval) from anon;
revoke all on function public.nexus_pair_rate_limit_hit(text, integer, interval) from authenticated;
grant execute on function public.nexus_pair_rate_limit_hit(text, integer, interval)
  to service_role;

-- ---------------------------------------------------------------------------
-- The single-use claim.
-- ---------------------------------------------------------------------------
-- ONE STATEMENT IS THE ENTIRE POINT. The `where` clause carries every condition
-- — right token, not yet consumed, not burned, not expired — and the `set`
-- consumes it in the same statement, so two racing requests serialise on the row
-- lock and exactly one of them sees a row returned. Split across a select and an
-- update this becomes a check-then-act with a window in it, and a single-use
-- token that can be used twice is a pairing that can be completed twice: two
-- desktops, one handshake, and the second one is whoever was watching.
--
-- The lookup is by `completion_token_hash` — the hash of 256 random bits the
-- browser generated and sealed under the handshake key — and NEVER by anything
-- derived from the pairing code. The code is 65 bits and is a channel binding;
-- if it could be exchanged for a session then finding it (which a server
-- operator can afford to try) would be finding a session.
create or replace function public.nexus_pair_claim(
  p_token_hash        bytea,
  p_responder_pub     bytea,
  p_responder_confirm bytea
) returns table (pairing_id uuid, account_id uuid)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  -- The same 10 that `pairing_attempts_range` bounds the column at in migration
  -- 001, named once here because this function is the only writer and therefore
  -- the only place the number can be acted on. If the two ever disagree the CHECK
  -- wins by raising 23514 from inside the claim, which is loud — the failure mode
  -- is a visible error, not a silently unenforced limit.
  max_attempts constant smallint := 10;
begin
  -- Length-checked here rather than trusted from the caller: a NULL or a short
  -- digest would otherwise turn the `where` below into a predicate that matches
  -- nothing in a way indistinguishable from „already consumed", and the Edge
  -- Function would report a wrong-but-plausible reason for the failure.
  if p_token_hash is null or octet_length(p_token_hash) <> 32 then
    raise exception using
      errcode = 'NX302',
      message = 'completion token digest must be exactly 32 bytes';
  end if;

  -- Wrapped in a CTE rather than written as `return query update … returning`,
  -- because the latter's acceptance has varied across PL/pgSQL versions and a
  -- security latch is the last place to depend on a grammar detail. `FOUND` is
  -- set by RETURN QUERY either way, which is what the branch below reads.
  return query
  with claimed as (
    update public.pairing p
       set consumed_at        = now(),
           responder_pub      = coalesce(p_responder_pub, p.responder_pub),
           responder_confirm  = coalesce(p_responder_confirm, p.responder_confirm),
           attempts           = least(p.attempts + 1, max_attempts)
     where p.completion_token_hash = p_token_hash
       and p.consumed_at is null
       and p.burned_at is null
       and p.expires_at > now()
       -- THE COUNTER HAS TO BE READ SOMEWHERE OR IT IS NOT A CONTROL. `attempts`
       -- was incremented on every presentation and consulted on none, so the
       -- column comment describing it as a bound described a number that went up.
       -- Reading it here is what closes a row permanently after enough tries:
       -- the Edge Function's per-token limiter is a 10-minute window, so without
       -- this a caller simply waits out each window and comes back, forever, on a
       -- row that is still live. This is the per-row lifetime budget the window
       -- limiter cannot express.
       and p.attempts < max_attempts
    returning p.id, p.user_id
  )
  select claimed.id, claimed.user_id from claimed;

  if not found then
    -- A miss still costs the row an attempt, so a replay against an already
    -- consumed pairing is visible in the data rather than only in a log the
    -- server operator controls. Deliberately unconditional on state: the
    -- interesting case is precisely the one where the row is already spent.
    update public.pairing
       set attempts = least(attempts + 1, max_attempts)
     where completion_token_hash = p_token_hash;
  end if;
end;
$$;

comment on function public.nexus_pair_claim(bytea, bytea, bytea) is
  'Atomically consumes a pairing by completion-token digest. Returns zero rows '
  'if it was already used, burned or expired. service_role only.';

revoke all on function public.nexus_pair_claim(bytea, bytea, bytea) from public;
revoke all on function public.nexus_pair_claim(bytea, bytea, bytea) from anon;
revoke all on function public.nexus_pair_claim(bytea, bytea, bytea) from authenticated;
grant execute on function public.nexus_pair_claim(bytea, bytea, bytea) to service_role;

-- ---------------------------------------------------------------------------
-- Housekeeping.
-- ---------------------------------------------------------------------------
-- THIS FUNCTION DELETES, AND THE NO-DELETE RULE STILL HOLDS. That rule is about
-- replicated user state: a deleted `sync_objects` row is indistinguishable from
-- one that never arrived, so the peer that has not synced yet re-uploads it and
-- the deletion undoes itself — which is why deletion there is a tombstone. A
-- spent `pairing` row is not user state. It is protocol scratch space with a
-- ten-minute life, it replicates nowhere, and nothing re-creates it. Leaving it
-- would grow a table forever to preserve the fact that somebody once pressed a
-- button. Nothing here can reach `sync_objects`, `key_wraps` or `devices`, and
-- the drift guard asserts that.
create or replace function public.nexus_sync_housekeeping()
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- A day of grace past expiry, not zero. A row reaped the instant it expires
  -- takes the evidence with it: „already consumed" and „never existed" become
  -- the same answer, and a support question about a pairing that failed five
  -- minutes ago has nothing left to look at. `attempts` on a spent row is the
  -- only trace a replay leaves anywhere.
  delete from public.pairing where expires_at < now() - interval '1 day';
  delete from private.pair_rate_limit where window_start < now() - interval '1 day';
end;
$$;

comment on function public.nexus_sync_housekeeping() is
  'Reaps spent pairings and stale rate-limit buckets. service_role only; '
  'schedule with pg_cron. Cannot touch user state.';

revoke all on function public.nexus_sync_housekeeping() from public;
revoke all on function public.nexus_sync_housekeeping() from anon;
revoke all on function public.nexus_sync_housekeeping() from authenticated;
grant execute on function public.nexus_sync_housekeeping() to service_role;

