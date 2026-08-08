-- Nexus sync — migration 002: row level security, which is the entire wall.
--
-- There is no application server in front of this database. PostgREST turns
-- every table into an HTTP endpoint that any holder of an access token may
-- query with an arbitrary filter, so the sentence „the client only asks for its
-- own rows" describes a client, not a system. What is written below is the
-- system. If a policy here is wrong, there is nothing behind it.
--
-- THE THREE MISTAKES THIS FILE IS ARRANGED TO PREVENT, in the order they are
-- usually made:
--
--   1. ENABLE without FORCE. `enable row level security` exempts the table
--      OWNER. Every table here is owned by `postgres`, which is the role that
--      runs migrations, seeds, `supabase db reset`, most SQL editor sessions and
--      a good number of one-off scripts. Under ENABLE alone, all of those see
--      every row of every user and — worse — a policy bug is invisible from the
--      only console anybody ever tests from. FORCE removes the exemption, and
--      only roles carrying BYPASSRLS (in Supabase: `service_role`) get through.
--      The drift guard fails the build if a table ever has one without the other.
--
--   2. FORGETTING THAT SUPABASE ALREADY GRANTED THE TABLE AWAY. A stock Supabase
--      project ships `alter default privileges in schema public grant all on
--      tables to anon, authenticated, service_role`. Every table created above
--      was therefore handed to `anon` — the role behind the publishable API key,
--      i.e. anybody on the internet — the instant `create table` ran, before a
--      single policy existed. RLS then hides the rows, so nothing looks wrong.
--      But privileges and policies fail in different directions: a missing
--      privilege is a 403 the client cannot talk past, a missing policy is a
--      quiet empty result that a later „fix" turns into a leak. Both walls, in
--      that order. Every table below starts with `revoke all ... from anon`.
--
--   3. WRITING A SECOND PERMISSIVE POLICY AND CALLING IT A RESTRICTION.
--      PERMISSIVE policies OR together. Adding „...and the session must be
--      strong" as another permissive policy WIDENS access instead of narrowing
--      it, and the resulting table is readable by exactly the sessions the new
--      policy was written to exclude. Narrowing needs `as restrictive`, which
--      ANDs. Every table below has exactly one owner-scoping permissive family
--      and at least one restrictive gate.
--
--   4. GATING THE READ AND LEAVING THE VOUCHER WRITABLE. This one is not a
--      general Postgres trap; it is this schema's own, and it is the reason the
--      grants below are column-scoped rather than table-scoped. A gate that
--      admits „any session a live `devices` row names" is only as strong as the
--      rule about who may write a `devices` row — and the same question applies,
--      one table at a time, to every column that some other rule treats as a
--      fact: `platform`, `revoked_at`, `pairing.consumed_at`,
--      `key_wraps.profile_id`. A table-level `grant update` hands all of them to
--      the client at once, and each one silently turns a property the design
--      states into a value the client chooses. Each grant below therefore names
--      its columns, and each exclusion is justified where it is written.
--
-- WHY THE RESTRICTIVE GATE EXISTS AT ALL. `user_id = auth.uid()` is correct and
-- insufficient. It says „your rows", not „your rows, to a session that ought to
-- have them". An account with a leaked web password yields an aal1 session that
-- satisfies `auth.uid()` perfectly and can then pull the entire encrypted
-- corpus, every key wrap, and mint devices. The corpus stays encrypted — that is
-- the design working — but exfiltration of the whole ciphertext archive plus the
-- wraps is precisely the position from which an offline attack on the password
-- becomes worth running. The gate demands a second factor OR a session that a
-- device pairing already vouched for.
--
-- AND THE GATE HAS EXACTLY TWO ENTRANCES, BOTH aal2-ONLY. `pairing` INSERT and
-- `devices` INSERT. Both are written below as restrictive policies, next to each
-- other in spirit if not in line order, because they are one rule: nothing that
-- holds only a password may create the thing that vouches for it. Closing one
-- and leaving the other open closes nothing — the open one is simply shorter.

-- No `begin;`/`commit;` — the CLI wraps each migration file in a transaction of
-- its own; migration 001's header has the full reasoning.

-- ---------------------------------------------------------------------------
-- The gate predicate.
-- ---------------------------------------------------------------------------
-- WHY THE `OR` IS LOAD-BEARING, AND WHY IT IS NOT A HOLE. A desktop never sees
-- the web password; its session is minted by `pair-complete` out of a completed
-- handshake and is therefore aal1 and will be aal1 for as long as it lives. A
-- blanket `aal = 'aal2'` gate would lock out every desktop in the fleet — that
-- is, the only clients that actually hold keys — while leaving the browser in.
-- So the second branch admits a session that a live, unrevoked device row
-- vouches for. That branch is only as strong as the rule about who may create a
-- device row, which is why the `pairing` INSERT below is aal2-only: if a
-- password-only session could write its own `pairing` row it would complete its
-- own handshake, receive its own device row, and walk through this gate holding
-- the door open for itself. The aal2 requirement on that one INSERT is what
-- stops the second branch from being a self-service entrance.
--
-- WHY IT IS A FUNCTION AND NOT INLINE TEXT. It is repeated on four tables. Four
-- copies of a security predicate is four chances for one of them to drift, and
-- the drift is undetectable by reading any single file — the exact defect class
-- this repo calls „a rule applied on one path is only present, not applied".
-- One definition, four call sites, and the drift guard asserts all four call it.
--
-- WHY IT IS SECURITY INVOKER. A `security definer` here would run as the table
-- owner, and the owner is subject to RLS because migration-002 forces it, so it
-- would gain nothing and would additionally hide which rows the caller can
-- actually see. As invoker, the `exists` below is itself filtered by `devices`'
-- own policies, which is correct: a session may only be vouched for by a device
-- row it is allowed to see.
create or replace function private.nexus_session_is_live()
returns boolean
language sql
stable
security invoker
-- Empty search_path, every name schema-qualified. A function with a mutable
-- search_path that is called from a policy is a privilege-escalation primitive:
-- anyone who can create a schema earlier in the path can shadow `devices` with
-- their own table and make this predicate return true.
set search_path = ''
as $$
  select
    coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
    or exists (
      select 1
      from public.devices d
      -- `user_id` is restated here even though `devices`' own policies already
      -- scope this read to the caller. Relying on them would make the tenancy of
      -- a SECURITY PREDICATE depend on the policies of a different table, which
      -- holds today and is one `security definer` away from not holding — and
      -- the failure would be silent, because a stale row with a matching
      -- `session_id` reads exactly like a valid one.
      where d.user_id = auth.uid()
        and d.session_id = nullif(auth.jwt() ->> 'session_id', '')::uuid
        and d.revoked_at is null
    );
$$;

comment on function private.nexus_session_is_live() is
  'The restrictive RLS gate: aal2, or a session vouched for by a live device.';

revoke all on function private.nexus_session_is_live() from public;
revoke all on function private.nexus_session_is_live() from anon;
-- `authenticated` must be able to EXECUTE this or every policy that calls it
-- fails closed with „permission denied for function", which locks the product
-- out of itself. It lives in `private`, which `config.toml` does not expose, so
-- it is not reachable as an RPC.
grant execute on function private.nexus_session_is_live() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- sync_objects
-- ---------------------------------------------------------------------------
alter table public.sync_objects enable row level security;
alter table public.sync_objects force row level security;

revoke all on public.sync_objects from anon;
revoke all on public.sync_objects from authenticated;

-- COLUMN-LEVEL GRANTS, not table-level, and this is a wall in its own right.
-- `seq`, `created_at` and `updated_at` are facts the SERVER states about a row;
-- if a client could write them it could forge its position in the log or its
-- own history. `user_id`, `profile_id`, `collection` and `object_id` are the
-- row's identity and are bound into the AEAD associated data, so moving a row
-- between them must be impossible, not merely detected. Withholding the UPDATE
-- privilege on those four columns makes the statement fail at the parser with
-- 42501 before a single row is examined; the trigger in migration 003 catches
-- anything that reaches the row anyway, e.g. through a future `security
-- definer` helper that runs with different privileges. Two mechanisms, because
-- privileges cannot see OLD and triggers cannot see the statement.
grant select on public.sync_objects to authenticated;
grant insert (user_id, profile_id, collection, object_id, parent_id, version,
              deleted, nonce, ciphertext)
  on public.sync_objects to authenticated;
grant update (parent_id, version, deleted, nonce, ciphertext)
  on public.sync_objects to authenticated;

-- USAGE ON THE IDENTITY SEQUENCE, WITHOUT WHICH NO CLIENT CAN UPDATE ANYTHING.
-- The guard trigger in migration 003 re-stamps `seq` on every update (it is the
-- pull cursor; a row whose cursor never moves is a row that never reaches a
-- device that has already synced past it). It does that with `nextval`, and
-- `nextval` is a privileged operation on the sequence — so without this grant
-- every UPDATE from a client role dies with 42501 on a sequence nobody named,
-- and the failure reads like an RLS problem for as long as it takes somebody to
-- notice the object in the message is not a table.
--
-- On a stock Supabase project this happens to work anyway, because the platform
-- ships `alter default privileges in schema public grant all on sequences to
-- anon, authenticated, service_role`. That is precisely why it is stated here:
-- „works because of a platform default" is a dependency nobody wrote down, and
-- the revokes below remove the part of that default that hands the sequence to
-- `anon` as well.
--
-- WHY NOT MAKE THE TRIGGER `security definer` INSTEAD, which would need no grant
-- at all: because a definer trigger function is a standing escalation primitive
-- that every future edit silently inherits. Somebody adding one `insert into
-- some_audit_table` line later would be writing with the owner's rights, and
-- nothing in that diff would say so. `usage` on one sequence is a capability
-- that does exactly one thing — burn a bigint — and cannot grow into anything.
do $$
declare
  seq_name text := pg_get_serial_sequence('public.sync_objects', 'seq');
begin
  execute format('revoke all on sequence %s from anon', seq_name);
  execute format('revoke all on sequence %s from authenticated', seq_name);
  execute format('grant usage on sequence %s to authenticated', seq_name);
end;
$$;
-- DELETE is granted to nobody, anywhere in this file. Rows are tombstoned:
-- `deleted = true` replicates to every other device and survives, whereas a
-- deleted row is indistinguishable from a row that never arrived, so the peer
-- that has not synced yet would happily re-upload it and „resurrect" it forever.
-- Withholding the privilege AND writing no DELETE policy are both needed and do
-- different things: with the privilege but no policy, `DELETE` succeeds and
-- affects zero rows, which every HTTP client reports as 204 success — a delete
-- that silently does nothing is worse than one that fails.

create policy sync_objects_owner_select on public.sync_objects
  for select to authenticated
  -- `(select auth.uid())` rather than `auth.uid()`: the wrapped form is an
  -- InitPlan evaluated once per statement, the bare form is re-evaluated per
  -- row. On a full-corpus pull that is the difference between a scan and a
  -- scan with a function call attached to every row of it.
  using (user_id = (select auth.uid()));

create policy sync_objects_owner_insert on public.sync_objects
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy sync_objects_owner_update on public.sync_objects
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy sync_objects_live_session on public.sync_objects
  as restrictive for all to authenticated
  using ((select private.nexus_session_is_live()))
  with check ((select private.nexus_session_is_live()));

-- ---------------------------------------------------------------------------
-- key_wraps
-- ---------------------------------------------------------------------------
alter table public.key_wraps enable row level security;
alter table public.key_wraps force row level security;

revoke all on public.key_wraps from anon;
revoke all on public.key_wraps from authenticated;

-- `kind` AND `profile_id` ARE NOT UPDATABLE, AND THAT IS THE LOCAL-ONLY
-- GUARANTEE. Migration 001 states it as „a profile is web-enabled if and only if
-- a `ck_under_mk` row exists for it", and calls the guarantee an absence rather
-- than a flag because whoever holds a database can flip a flag. An absence is
-- only as strong as the ways a row can come into being — and with a table-level
-- UPDATE grant there is a second way that is not an INSERT at all: take the
-- existing wrap for a synced profile and re-point it at the local-only one. The
-- row now exists for a profile the user was promised would never leave the
-- machine. Nothing was forged; a column was edited.
--
-- The wrap itself would still open to the WRONG content key, which the AAD stated
-- on the table in migration 001 is what turns into a hard failure rather than a
-- silent confusion — but the AAD is a rule for the client, and this is a rule for
-- the database. Both, in that order.
--
-- `rotated_at` and `disabled_at` stay writable: retiring and rotating are the
-- only two lifecycle operations this table has, and no DELETE exists to express
-- either.
grant select on public.key_wraps to authenticated;
grant insert (user_id, kind, profile_id, nonce, wrapped, kdf_salt, kdf_params)
  on public.key_wraps to authenticated;
grant update (nonce, wrapped, kdf_salt, kdf_params, rotated_at, disabled_at)
  on public.key_wraps to authenticated;

create policy key_wraps_owner_select on public.key_wraps
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy key_wraps_owner_insert on public.key_wraps
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy key_wraps_owner_update on public.key_wraps
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy key_wraps_live_session on public.key_wraps
  as restrictive for all to authenticated
  using ((select private.nexus_session_is_live()))
  with check ((select private.nexus_session_is_live()));

-- ---------------------------------------------------------------------------
-- devices
-- ---------------------------------------------------------------------------
alter table public.devices enable row level security;
alter table public.devices force row level security;

revoke all on public.devices from anon;
revoke all on public.devices from authenticated;

-- COLUMN-SCOPED, AND EVERY EXCLUSION IS LOAD-BEARING.
--
-- `platform` is absent from both lists, which is what makes the column mean
-- anything at all. It is the only place in the schema where „this client is a
-- browser" could ever be written down, and a value the client supplies is not
-- evidence about the client — it is a sentence the client chose. With no grant,
-- a client-inserted row takes the column default (`web`) and the single writer
-- that can state `desktop` is `pair-complete`, which holds the service-role key
-- and only writes after a completed handshake.
--
-- `session_id` is insertable and NOT updatable. It is the binding this whole gate
-- turns on; if it could be moved, an aal2 session could re-point any device row
-- at any session id and vouch for a session that was never paired.
--
-- `id`, `user_id` and `created_at` are identity and history. `revoked_at` is
-- updatable — a session must be able to retire itself, and the device manager
-- must be able to retire others — and the guard trigger in migration 003c makes
-- it ONE-WAY, for the same reason a tombstone is one-way: a fact that can be
-- withdrawn is not a fact. That trigger is where the rule lives, because setting
-- the column is legal and clearing it is not, and a privilege cannot tell those
-- two writes apart.
grant select on public.devices to authenticated;
grant insert (user_id, session_id, name_nonce, name_ciphertext, public_key)
  on public.devices to authenticated;
grant update (name_nonce, name_ciphertext, public_key, last_seen_at, revoked_at)
  on public.devices to authenticated;

create policy devices_owner_select on public.devices
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy devices_owner_insert on public.devices
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy devices_owner_update on public.devices
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- THIS TABLE CANNOT USE `private.nexus_session_is_live()`, AND THE REASON IS NOT
-- STYLE. That function reads `public.devices`; a policy on `public.devices` that
-- calls it makes Postgres evaluate the devices policies in order to evaluate the
-- devices policies, and the statement dies with 42P17 „infinite recursion
-- detected in policy for relation devices". The usual escape — wrap the read in
-- a `security definer` function — does not work here either, because this table
-- has FORCE row level security, so the owner is subject to the same policies and
-- recurses identically. The escape that DOES work is to stop asking a question
-- that needs a subquery: the row being examined already carries `session_id`, so
-- the predicate is row-local and cannot recurse by construction.
--
-- The result is not a weaker rule but a stronger one. Under the subquery form an
-- aal1 desktop session could enumerate and modify EVERY device row on the
-- account, because the account had at least one live device — itself. Under the
-- row-local form it can see and touch exactly one row, its own. A desktop has no
-- business listing the user's other machines; the device manager is a web
-- surface and the web surface is aal2.
--
-- USING and WITH CHECK differ deliberately. USING requires `revoked_at is null`,
-- so a dead session cannot use its own row to keep itself alive. WITH CHECK
-- drops that clause, because otherwise a session could never write
-- `revoked_at = now()` on itself — the new row would fail the check — and
-- „odjavi ovaj uređaj" would be impossible from the device doing the leaving.
-- WITH CHECK keeps the `session_id` equality, so a session can retire itself and
-- nothing else, and can never point a row at somebody else's session.
create policy devices_live_session on public.devices
  as restrictive for all to authenticated
  using (
    coalesce((select auth.jwt()) ->> 'aal', '') = 'aal2'
    or (session_id = nullif((select auth.jwt()) ->> 'session_id', '')::uuid
        and revoked_at is null)
  )
  with check (
    coalesce((select auth.jwt()) ->> 'aal', '') = 'aal2'
    or session_id = nullif((select auth.jwt()) ->> 'session_id', '')::uuid
  );

-- THE SECOND HALF OF THE RULE ABOVE, AND WITHOUT IT THE GATE IS A DOOR WITH A
-- HANDLE ON BOTH SIDES.
--
-- `pairing`'s INSERT is aal2-only because an aal1 session that could start a
-- handshake would complete it against itself and be vouched for forever. That
-- reasoning is correct and it stops one path. It is not the shortest path. The
-- gate does not ask „did a pairing happen"; it asks „is there a live device row
-- naming my session_id" — so the direct route is to write that row, and the
-- policy above happily permits it: `session_id = my own session_id` is the very
-- branch that lets a paired desktop see its own row.
--
-- Concretely, without this policy: an attacker holding nothing but the web
-- password signs in at aal1, issues one INSERT naming their own `session_id`,
-- and is now vouched for by a device row they minted for themselves. From that
-- statement onward `private.nexus_session_is_live()` is true for them and every
-- table in this file opens — the whole ciphertext corpus, every key wrap, and
-- write access to all of it. Since they hold the password they also hold
-- `K_wrap`, so the `mk_under_kwrap` row they just gained the right to read
-- yields `MK`, which yields every `CK_p`, which yields the plaintext. The second
-- factor would have been mandatory on the long path and absent on the short one,
-- and every assertion about the gate would still have passed.
--
-- The cost of closing it is nothing. A browser is at aal2 whenever it can do
-- anything useful; a desktop never inserts here at all, because its row is
-- written by `pair-complete` under the service-role key, which is not subject to
-- policies. So this refuses exactly one caller: the one that has a password and
-- nothing else.
create policy devices_insert_requires_aal2 on public.devices
  as restrictive for insert to authenticated
  with check (coalesce((select auth.jwt()) ->> 'aal', '') = 'aal2');

-- ---------------------------------------------------------------------------
-- pairing
-- ---------------------------------------------------------------------------
alter table public.pairing enable row level security;
alter table public.pairing force row level security;

revoke all on public.pairing from anon;
revoke all on public.pairing from authenticated;

-- A LATCH THE HOLDER CAN RE-OPEN IS NOT A LATCH. Every single-use, burn-once and
-- expiry property this table claims lives in a column, and with a table-level
-- UPDATE grant every one of them is one statement from being undone by any
-- session on the account: `consumed_at = null` un-spends a completed pairing,
-- `burned_at = null` un-burns a code that failed authentication, `attempts = 0`
-- resets the counter `nexus_pair_claim` latches on, and `code_id`,
-- `initiator_pub`, `sealed_payload` and `completion_token_hash` together are the
-- whole handshake — rewritable in flight, so one session can substitute its own
-- half for the browser's.
--
-- So the client gets exactly the two columns it has a reason to write after the
-- row exists, and not one more. `initiator_confirm` is the browser's key
-- confirmation, which it can only compute once the desktop has answered.
-- `burned_at` is the browser burning the code on the first AEAD failure — the
-- rule that keeps a ~65-bit code out of reach of online guessing, and therefore
-- a rule the browser must be able to apply itself, immediately, without a round
-- trip through a function.
--
-- `expires_at` is not in the INSERT list either, though migration 001 CHECK-
-- bounds it. Letting a client state a TTL and then bounding the value it may
-- state is weaker and longer than not letting it state one: the default is
-- `now() + 10 minutes` from the database's own clock, which is also the clock
-- `nexus_pair_claim` compares against.
--
-- `attempts`, `consumed_at`, `responder_pub` and `responder_confirm` are the
-- server's side of the protocol and are written only by `nexus_pair_claim` under
-- the service-role key.
grant select on public.pairing to authenticated;
grant insert (user_id, code_id, initiator_pub, sealed_payload, completion_token_hash)
  on public.pairing to authenticated;
grant update (initiator_confirm, burned_at) on public.pairing to authenticated;

create policy pairing_owner_select on public.pairing
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy pairing_owner_insert on public.pairing
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy pairing_owner_update on public.pairing
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy pairing_live_session on public.pairing
  as restrictive for all to authenticated
  using ((select private.nexus_session_is_live()))
  with check ((select private.nexus_session_is_live()));

-- THE ONE POLICY THAT KEEPS THE GATE'S SECOND BRANCH HONEST. Restrictive
-- policies AND together, so this composes with `pairing_live_session` above and
-- the effect is: starting a pairing requires aal2, full stop — the OR in the
-- gate does not apply to this one statement.
--
-- Without it the wall is circular and therefore not a wall. A stolen web
-- password gives an aal1 session; that session inserts a `pairing` row, plays
-- both sides of the handshake against itself, receives a device row and a
-- pair-minted session, and from then on satisfies
-- `private.nexus_session_is_live()` through the device branch — permanently,
-- and after a password change, because the device session is independent of the
-- password. The account would be captured by an attacker who never had a second
-- factor, and the gate would report itself as holding.
--
-- Pairing is also the only statement in the schema where an aal2 demand costs
-- nothing: it is a deliberate, interactive, once-per-device act performed by a
-- human sitting in front of both screens. Everything else here happens in a
-- background sync loop where a re-authentication prompt would be unusable.
create policy pairing_insert_requires_aal2 on public.pairing
  as restrictive for insert to authenticated
  with check (coalesce((select auth.jwt()) ->> 'aal', '') = 'aal2');

-- ---------------------------------------------------------------------------
-- sync_state
-- ---------------------------------------------------------------------------
alter table public.sync_state enable row level security;
alter table public.sync_state force row level security;

revoke all on public.sync_state from anon;
revoke all on public.sync_state from authenticated;

-- The four identity columns are the primary key, so „updating" one is really
-- „move this cursor to a different device or a different collection", which is
-- never a thing a client means; it means INSERT. Withholding the grant makes the
-- distinction structural rather than conventional, at a cost of one line.
grant select on public.sync_state to authenticated;
grant insert (user_id, device_id, profile_id, collection, last_seq)
  on public.sync_state to authenticated;
grant update (last_seq, updated_at) on public.sync_state to authenticated;

create policy sync_state_owner_select on public.sync_state
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy sync_state_owner_insert on public.sync_state
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy sync_state_owner_update on public.sync_state
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy sync_state_live_session on public.sync_state
  as restrictive for all to authenticated
  using ((select private.nexus_session_is_live()))
  with check ((select private.nexus_session_is_live()));

-- ---------------------------------------------------------------------------
-- service_role, stated rather than inherited.
-- ---------------------------------------------------------------------------
-- Supabase's default privileges already grant everything here to `service_role`,
-- so none of this changes behaviour today. It is written down because the shape
-- of what the Edge Function may do is a security decision and „whatever the
-- platform's defaults happen to be" is not one — and because the interesting
-- part is the DELETE column of this list.
--
-- `pairing` is the ONLY table service_role may delete from, and that is the
-- whole of `nexus_sync_housekeeping`'s reach into user-facing data. A spent
-- pairing is protocol scratch space with a ten-minute life that replicates
-- nowhere; a `sync_objects` row is replicated user state, where deletion is a
-- tombstone precisely because a deleted row is indistinguishable from one that
-- never arrived, so the peer that has not synced yet re-uploads it and the
-- deletion undoes itself. Withholding the privilege is what makes „the reaper
-- cannot touch user state" a fact about the database rather than a claim about
-- the function body. Account deletion still erases everything, through the
-- `on delete cascade` from `auth.users` — which needs no privilege at all.
grant select, insert, update on public.sync_objects to service_role;
grant select, insert, update on public.key_wraps to service_role;
grant select, insert, update on public.devices to service_role;
grant select, insert, update on public.sync_state to service_role;
grant select, insert, update, delete on public.pairing to service_role;

-- ---------------------------------------------------------------------------
-- private.pair_rate_limit — enabled, forced, and deliberately policy-free.
-- ---------------------------------------------------------------------------
-- RLS with zero policies denies every role that does not carry BYPASSRLS, which
-- is the strongest statement this database can make about a table. It is not
-- redundant with the missing grants and the unexposed schema: those are three
-- independent mechanisms, and the point of writing all three is that removing
-- any one of them by accident — exposing `private` in `config.toml`, a stray
-- `grant usage`, a default-privileges change — leaves the other two standing.
alter table private.pair_rate_limit enable row level security;
alter table private.pair_rate_limit force row level security;

revoke all on private.pair_rate_limit from public;
revoke all on private.pair_rate_limit from anon;
revoke all on private.pair_rate_limit from authenticated;

