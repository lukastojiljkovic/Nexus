-- Nexus sync — migration 013: how a desktop gets its device row back.
--
-- ─── THE HOLE THIS CLOSES, WHICH IS NOT AN EDGE CASE ────────────────────────
--
-- A `devices` row binds one client to one auth session, and migration 003c makes
-- `session_id` immutable — by column grant and again by the guard trigger
-- (NX202), whose hint says what to do instead: „pair the machine again to give it
-- a new session and a new row".
--
-- A desktop's session dies without anybody doing anything wrong. Measured on this
-- GoTrue and pinned by `tests/live/sync-enable.test.mjs`: verifying an MFA factor
-- REVOKES every other session the account holds. So the moment a second machine
-- so much as attempts to enable sync, the first machine's session is gone. Add
-- refresh tokens expiring, a session timebox, and „sign out everywhere", and a
-- desktop losing its session is the normal lifecycle rather than a fault.
--
-- What that desktop is left with is precise and awful: it HOLDS the master key —
-- wrapped under its own data key, on its own disk, openable the moment the user
-- types their passcode — and `private.nexus_session_is_live()` finds no device row
-- for its new session, so every read and every write is refused. The product says
-- „sinhronizacija je uključena" and can open nothing. And pairing, which the
-- trigger's hint points at, cannot rescue it: the authorising side of a pairing
-- must hold MK to transport it, and the only other client the user has is a
-- browser, which by construction never holds MK.
--
-- ─── WHY THE PRICE IS MK AND NOT THE SECOND FACTOR ──────────────────────────
--
-- The obvious gate is an `aal2` session, as the mint requires. It is wrong twice,
-- and the second reason is the one that is easy to miss.
--
-- WRONG ON SECURITY. A `platform = 'desktop'` row is what
-- `key_wraps_master_key_is_desktop_only` accepts as authority to read
-- `mk_under_kwrap`, and K_wrap is derived from the web password. „Password plus
-- second factor ⇒ a desktop row" would therefore mean „password plus second
-- factor ⇒ MK", and that policy — the thing standing between a phished password
-- and the root of the key hierarchy — would be worth nothing. Its own header says
-- the routes to an existing MK are pairing and the Recovery Kit *because both are
-- proofs a password thief does not have*. This is a third such proof and the
-- strongest of them: MK itself, presented as a one-way function of it.
--
-- WRONG ON BEHAVIOUR. Verifying a factor revokes every other session. If
-- recovering a stranded desktop needed a step-up, then desktop A recovering would
-- strand desktop B, whose recovery would strand A — two machines taking turns
-- forever, each „fixing" itself by breaking the other. A proof that costs no
-- step-up is the only kind that terminates.
--
-- This is also the answer to `check-rls-wall.mjs`'s standing rule that both
-- INSERTs which can create a voucher — `public.pairing` and `public.devices` —
-- must demand `aal2`. That rule is about what a CLIENT may write, and it still
-- holds: nothing here relaxes a policy or a grant. This function writes the row
-- under `service_role`, and what it demands in place of `aal2` is strictly
-- dearer.
--
-- ─── WHY A STORED VERIFIER AND NOT A SIGNATURE ──────────────────────────────
--
-- A public key derived from MK, checked against a signature over the session id,
-- would be stronger in the abstract: a leaked verifier is replayable and a leaked
-- public key is not. It is not stronger against the attacker this exists for.
--
-- `private.mk_verifiers` has no grant of any kind to `anon` or `authenticated`,
-- lives outside the schema PostgREST exposes, and carries RLS with no policy at
-- all — the wall `private.pair_rate_limit` already stands behind. The attacker
-- the desktop-only policy defends against holds web credentials and ordinary
-- client access, and cannot learn this value exists. The two who could read it
-- are one holding the whole database — who already has `mk_under_kwrap` and,
-- with the password, MK, no device row required — and one holding the
-- service-role key, who bypasses every policy in this schema anyway. Against
-- neither does a signature buy anything, and it would cost an asymmetric
-- primitive in three runtimes and a second set of vectors.
--
-- ─── WHY THE MINT HAD TO CHANGE, RATHER THAN THIS BEING ADDITIVE ────────────
--
-- Nothing can write `private.mk_verifiers` except the two functions in this file.
-- So an account that mints without one can NEVER register another desktop, and
-- there is no repair short of abandoning the account. That is the same argument
-- migration 011 already makes about `mk_under_src` — „both wraps, or neither",
-- because no client can add the second afterwards — and it forces the same shape:
-- the verifier is written inside the mint's transaction, which means the mint
-- takes one more parameter, which means dropping and recreating it.
--
-- The general rule, worth stating once: THE MINT IS A ONE-SHOT, so everything a
-- future recovery path needs is written by it or is never written at all.

-- No `begin;`/`commit;` — the CLI wraps each migration file in a transaction of
-- its own; migration 001's header has the full reasoning.

-- ---------------------------------------------------------------------------
-- private.mk_verifiers — the proof, at rest
-- ---------------------------------------------------------------------------
create table private.mk_verifiers (
  user_id    uuid        not null primary key references auth.users (id) on delete cascade,
  verifier   bytea       not null,
  created_at timestamptz not null default now(),

  -- 32 bytes of HKDF-SHA256 over MK. The length is restated here rather than
  -- trusted to the client, for the reason every other length CHECK in this
  -- schema exists: a short value is a weak proof, and „the client would not do
  -- that" is not a property of a database.
  constraint mk_verifiers_len check (octet_length(verifier) = 32)
);

comment on table private.mk_verifiers is
  'Proof of master-key possession, one row per account, written by nexus_mk_mint '
  'and read by nexus_device_register. Unreachable except via service_role.';

comment on column private.mk_verifiers.user_id is
  'LEAKS: nothing to a client — unreachable. To an operator: that this account '
  'has a master key, which public.key_wraps already says out loud.';
comment on column private.mk_verifiers.verifier is
  'LEAKS: nothing to a client — unreachable. To an operator: a bearer proof that '
  'buys a desktop device row, and NOT the master key — it is one-way from it.';
comment on column private.mk_verifiers.created_at is
  'LEAKS: when the account minted. Operator-visible only.';

alter table private.mk_verifiers enable row level security;
alter table private.mk_verifiers force row level security;

revoke all on private.mk_verifiers from public;
revoke all on private.mk_verifiers from anon;
revoke all on private.mk_verifiers from authenticated;
grant select, insert on private.mk_verifiers to service_role;

-- ---------------------------------------------------------------------------
-- The mint, again, with the verifier in the same transaction
-- ---------------------------------------------------------------------------
-- DROP AND RECREATE, not `create or replace`: Postgres identifies a function by
-- its argument types, so a replace with a different signature creates a SECOND
-- function and leaves the old one callable. Two mints, one of which silently
-- skips the verifier, is precisely the failure this file exists to prevent.
--
-- The body below is migration 011's, unchanged except for the two lines that
-- store the verifier. Its reasoning is not repeated here; read that header for
-- why there is no adoption path, why the serializer is an index, why the
-- commitment tag cannot be used to check any of it, and why it takes two session
-- ids and no `user_id`.
drop function public.nexus_mk_mint(
  uuid, uuid, bytea, bytea, bytea, bytea, bytea, jsonb, bytea, bytea, bytea, bytea, jsonb);

create function public.nexus_mk_mint(
  p_auth_session_id        uuid,
  p_device_session_id      uuid,
  p_device_name_nonce      bytea,
  p_device_name_ciphertext bytea,
  p_kwrap_nonce            bytea,
  p_kwrap_wrapped          bytea,
  p_kwrap_commit_tag       bytea,
  p_kwrap_kdf_params       jsonb,
  p_src_nonce              bytea,
  p_src_wrapped            bytea,
  p_src_commit_tag         bytea,
  p_src_kdf_salt           bytea,
  p_src_kdf_params         jsonb,
  p_mk_verifier            bytea
)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user       uuid;
  v_aal        text;
  v_started    timestamptz;
  v_device_user uuid;
begin
  -- The two sessions must be two sessions. See migration 011's header: this is
  -- the whole reason the desktop's working session stays aal1.
  if p_auth_session_id = p_device_session_id then
    raise exception using
      errcode = 'NX306',
      message = 'the authorising session and the device session must differ',
      hint    = 'Sign in a second time for the session the device will keep; '
                'the aal2 session that authorises the mint is signed out after it.';
  end if;

  select s.user_id, s.aal::text, s.created_at into v_user, v_aal, v_started
    from auth.sessions s
   where s.id = p_auth_session_id
     and (s.not_after is null or s.not_after > now());
  if v_user is null then
    raise exception using
      errcode = 'NX301',
      message = 'the authorising session does not exist or has expired';
  end if;

  select s.user_id into v_device_user
    from auth.sessions s
   where s.id = p_device_session_id
     and (s.not_after is null or s.not_after > now());
  if v_device_user is null then
    raise exception using
      errcode = 'NX301',
      message = 'the device session does not exist or has expired';
  end if;
  if v_device_user <> v_user then
    raise exception using
      errcode = 'NX305',
      message = 'the two sessions belong to different accounts';
  end if;

  -- Assurance is re-read from the DATABASE and not taken from a token, because
  -- the token is the caller's input and this function is the layer that RLS was
  -- bypassed in. The AMR clause is what makes `aal2` mean „a second factor was
  -- presented" rather than „a claim says aal2".
  if v_aal is distinct from 'aal2' then
    raise exception using
      errcode = 'NX302',
      message = 'minting the master key requires an aal2 session';
  end if;
  if not exists (
    select 1 from auth.mfa_amr_claims c
     where c.session_id = p_auth_session_id
       and c.authentication_method <> 'password'
  ) then
    raise exception using
      errcode = 'NX302',
      message = 'the authorising session records no factor beyond the password';
  end if;

  -- The factor predates the session. A speed bump, and migration 011 says so.
  if not exists (
    select 1 from auth.mfa_factors f
     where f.user_id = v_user
       and f.status = 'verified'
       and f.created_at < v_started
  ) then
    raise exception using
      errcode = 'NX303',
      message = 'the account had no verified factor before this session began',
      hint    = 'Arm the second factor on the web, then sign in again here.';
  end if;

  if not exists (
    select 1 from auth.users u
     where u.id = v_user and u.email_confirmed_at is not null
  ) then
    raise exception using
      errcode = 'NX304',
      message = 'the account has not confirmed its email address';
  end if;

  -- Retry after a lost response, which is otherwise indistinguishable from
  -- losing the race: this exact device session already holds a live desktop row,
  -- so the previous call committed and the client simply never heard.
  if exists (
    select 1 from public.devices d
     where d.user_id = v_user
       and d.session_id = p_device_session_id
       and d.platform = 'desktop'
       and d.revoked_at is null
  ) then
    return 'minted';
  end if;

  -- The fast path for „somebody else already did this". The unique index is what
  -- actually decides the race; this only spares the common case an exception it
  -- would learn nothing from.
  if exists (
    select 1 from public.key_wraps k
     where k.user_id = v_user and k.kind = 'mk_under_kwrap'
  ) then
    return 'already_minted';
  end if;

  -- WRAPS BEFORE THE DEVICE ROW. All of this is one transaction, so a failure
  -- anywhere takes the whole thing with it and the order changes no outcome
  -- today. It is written this way against the refactor that splits it: a device
  -- row committed before the wraps is a permanent hole in the gate, vouching for
  -- a session on an account that has no master key.
  --
  -- Both wraps, or neither. `mk_under_src` cannot be added later by any client —
  -- `key_wraps_desktop_only` needs the device row, and the device row is written
  -- below — so an account minted without one would have no recovery path and no
  -- way to acquire one.
  insert into public.key_wraps
    (user_id, kind, nonce, wrapped, commit_tag, kdf_salt, kdf_params)
  values
    (v_user, 'mk_under_kwrap', p_kwrap_nonce, p_kwrap_wrapped, p_kwrap_commit_tag,
     null, p_kwrap_kdf_params),
    (v_user, 'mk_under_src', p_src_nonce, p_src_wrapped, p_src_commit_tag,
     p_src_kdf_salt, p_src_kdf_params);

  -- AND THE VERIFIER, HERE, for exactly the reason `mk_under_src` is written
  -- here: nothing can add it afterwards. `mk_verifiers_len` refuses a value of
  -- the wrong length and takes the whole mint with it, which is the correct
  -- outcome — an account is better unminted than minted unrecoverable.
  insert into private.mk_verifiers (user_id, verifier)
  values (v_user, p_mk_verifier);

  insert into public.devices
    (user_id, session_id, platform, name_nonce, name_ciphertext)
  values
    (v_user, p_device_session_id, 'desktop', p_device_name_nonce, p_device_name_ciphertext);

  return 'minted';
end;
$$;

comment on function public.nexus_mk_mint(
  uuid, uuid, bytea, bytea, bytea, bytea, bytea, jsonb, bytea, bytea, bytea, bytea, jsonb,
  bytea) is
  'Mint MK for an account that has none, register the desktop that did it, and '
  'store the proof a later desktop presents to nexus_device_register. '
  'Service-role only. Derives the account from auth.sessions rather than taking '
  'a user_id; requires an aal2 authorising session distinct from the device '
  'session, a verified factor older than it, and a confirmed email. Returns '
  '''minted'' or ''already_minted''; a lost race surfaces as 23505 on '
  'key_wraps_one_per_slot. There is NO adoption path — see migration 011.';

revoke all on function public.nexus_mk_mint(
  uuid, uuid, bytea, bytea, bytea, bytea, bytea, jsonb, bytea, bytea, bytea, bytea, jsonb,
  bytea) from public;
revoke all on function public.nexus_mk_mint(
  uuid, uuid, bytea, bytea, bytea, bytea, bytea, jsonb, bytea, bytea, bytea, bytea, jsonb,
  bytea) from anon;
revoke all on function public.nexus_mk_mint(
  uuid, uuid, bytea, bytea, bytea, bytea, bytea, jsonb, bytea, bytea, bytea, bytea, jsonb,
  bytea) from authenticated;
grant execute on function public.nexus_mk_mint(
  uuid, uuid, bytea, bytea, bytea, bytea, bytea, jsonb, bytea, bytea, bytea, bytea, jsonb,
  bytea) to service_role;

-- ---------------------------------------------------------------------------
-- The registration
-- ---------------------------------------------------------------------------
-- The reads this needs beyond what migration 011 already granted: none. It uses
-- `auth.sessions (id, user_id, aal, not_after)`, all of which are in that grant.
create function public.nexus_device_register(
  p_device_session_id      uuid,
  p_verifier               bytea,
  p_device_name_nonce      bytea,
  p_device_name_ciphertext bytea
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user     uuid;
  v_aal      text;
  v_stored   bytea;
  v_blind    bytea;
  v_live     integer;
  v_device   uuid;
begin
  select s.user_id, s.aal::text into v_user, v_aal
    from auth.sessions s
   where s.id = p_device_session_id
     and (s.not_after is null or s.not_after > now());
  if v_user is null then
    raise exception using
      errcode = 'NX401',
      message = 'the device session does not exist or has expired';
  end if;

  -- THE DESKTOP'S WORKING SESSION IS aal1, AND THIS IS WHERE THAT STAYS TRUE.
  -- Migration 011 keeps it true at the mint by demanding two distinct sessions;
  -- there is only one session here, so the invariant is stated directly. An aal2
  -- session in a `devices` row is a token on a laptop's disk holding
  -- `devices_live_session`'s read and write over EVERY device row on the account
  -- and `pairing_insert_requires_aal2`'s power to initiate a pairing. Both are
  -- browser powers. `aal` survives every refresh, so this would be permanent.
  if v_aal is distinct from 'aal1' then
    raise exception using
      errcode = 'NX405',
      message = 'a desktop device session must be aal1',
      hint    = 'Sign in again without stepping the session up; the second '
                'factor is not what authorises this call.';
  end if;

  select m.verifier into v_stored
    from private.mk_verifiers m
   where m.user_id = v_user;
  if v_stored is null then
    raise exception using
      errcode = 'NX402',
      message = 'this account has no master key to prove possession of',
      hint    = 'Turn sync on first — sync-enable mints the key and registers '
                'the desktop that did it in one transaction.';
  end if;

  -- BLINDED COMPARISON. `=` on bytea is a memcmp that returns as soon as two
  -- bytes differ, so its duration carries the length of the matching prefix, and
  -- a caller holding a valid session for this account may make as many attempts
  -- as it likes. Hashing both sides under a value the caller cannot predict
  -- makes the early exit happen at a position that has nothing to do with the
  -- secret. `sha256` and `gen_random_uuid` are both core Postgres — no extension
  -- is assumed, because an extension that is present on the hosted project and
  -- absent from a local one is a check that silently stops being made.
  v_blind := sha256(
    convert_to(gen_random_uuid()::text || gen_random_uuid()::text, 'UTF8'));
  if sha256(v_blind || v_stored) is distinct from sha256(v_blind || p_verifier) then
    raise exception using
      errcode = 'NX403',
      message = 'the master-key proof did not match',
      hint    = 'This machine does not hold this account''s master key. Pair it '
                'with a machine that does, or use the Recovery Kit.';
  end if;

  -- A DEVICE ROW WHOSE SESSION NO LONGER EXISTS IS GARBAGE, AND THIS IS THE ONE
  -- MOMENT SOMEBODY IS LOOKING AT IT. GoTrue deletes the session row on sign-out
  -- and on revocation, so „no matching live session" is exactly the stranded
  -- state that brought this caller here. Retiring them now means no client has to
  -- remember its previous device id across a reinstall, and it cannot touch a
  -- sibling that is merely offline — an offline desktop's session row is still
  -- there.
  --
  -- `revoked_at` is terminal (NX201) and this only ever moves it away from null,
  -- so the guard trigger permits it and the row keeps its meaning: proof that the
  -- old session is dead.
  update public.devices d
     set revoked_at = now()
   where d.user_id = v_user
     and d.platform = 'desktop'
     and d.revoked_at is null
     and not exists (
       select 1 from auth.sessions s
        where s.id = d.session_id
          and (s.not_after is null or s.not_after > now())
     );

  -- Retry after a lost response. Same shape as the mint's: this exact session
  -- already holds a live desktop row, so a previous call committed and the client
  -- never heard the answer.
  select d.id into v_device
    from public.devices d
   where d.user_id = v_user
     and d.session_id = p_device_session_id
     and d.platform = 'desktop'
     and d.revoked_at is null;
  if v_device is not null then
    return v_device;
  end if;

  -- A BACKSTOP AND NOT A PRODUCT RULE. Every call costs a sign-in, and dead rows
  -- have just been retired, so the number below is „live machines" and no real
  -- account approaches it. What it bounds is a client in a retry loop that signs
  -- in afresh each time: without it, one holding MK could grow this table without
  -- limit. The hint names the way out, which is a real screen and not a support
  -- ticket.
  select count(*) into v_live
    from public.devices d
   where d.user_id = v_user
     and d.platform = 'desktop'
     and d.revoked_at is null;
  if v_live >= 20 then
    raise exception using
      errcode = 'NX406',
      message = 'this account already has 20 live desktops',
      hint    = 'Sign one of them out from the device list on the web, then '
                'try again.';
  end if;

  insert into public.devices
    (user_id, session_id, platform, name_nonce, name_ciphertext)
  values
    (v_user, p_device_session_id, 'desktop', p_device_name_nonce, p_device_name_ciphertext)
  returning id into v_device;

  return v_device;
end;
$$;

comment on function public.nexus_device_register(uuid, bytea, bytea, bytea) is
  'Give a desktop that already holds MK a live device row for a fresh aal1 '
  'session, after the master-key proof matches. Service-role only. Retires this '
  'account''s desktop rows whose sessions no longer exist. Returns the device '
  'id. NX401 dead session, NX402 no master key, NX403 bad proof, NX405 not aal1, '
  'NX406 too many live desktops.';

revoke all on function public.nexus_device_register(uuid, bytea, bytea, bytea) from public;
revoke all on function public.nexus_device_register(uuid, bytea, bytea, bytea) from anon;
revoke all on function public.nexus_device_register(uuid, bytea, bytea, bytea) from authenticated;
grant execute on function public.nexus_device_register(uuid, bytea, bytea, bytea) to service_role;
