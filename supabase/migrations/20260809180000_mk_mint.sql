-- Nexus sync — migration 011: minting the master key, exactly once per account.
--
-- `MK` is the root of the sync key hierarchy: every per-profile content key
-- hangs off it, and every row of ciphertext hangs off one of those. Nothing in
-- the product mints it today, which is why no account can sync. This is that
-- statement, and it is written in SQL under `service_role` for a reason
-- migration 002 already stated: an ordinary session that has just signed in has
-- no device row, so `key_wraps_desktop_only` refuses it both wraps — and „mint
-- exactly once" has to live somewhere that two devices enabling sync in the same
-- minute cannot both win.
--
-- ─── THE SERIALIZER IS AN INDEX, NOT A CHECK ────────────────────────────────
--
-- `key_wraps_one_per_slot` — `unique (user_id, kind, profile_id, epoch) nulls
-- not distinct` — makes `(account, 'mk_under_kwrap', null, null)` a slot that
-- exactly one INSERT can occupy. No advisory lock, no `select … for update`, no
-- application-level check-then-act: the second writer gets 23505 and its whole
-- transaction rolls back, which is the same argument `nexus_pair_claim` makes
-- about its own latch. The fast path below still asks „is it already minted",
-- because answering that with an exception is rude to the common case, but the
-- fast path is an optimisation and the index is the rule.
--
-- ─── LOSING IS TERMINAL. THERE IS NO ADOPTION ───────────────────────────────
--
-- The obvious next line — the loser fetches the existing `mk_under_kwrap` and
-- opens it with the K_wrap it already derived — is the one thing this design
-- must not do, and it would work perfectly, which is what makes it dangerous.
--
-- Opening a wrap under K_wrap proves knowledge of the web password. It proves
-- NOTHING about who chose the key inside. So: someone holding a phished password
-- mints first; the owner's real desktop starts up, loses the race, adopts, and
-- from that instant seals every row under a master key the attacker generated
-- and holds. No forgery, no anomaly, nothing to detect. End-to-end encryption is
-- over and the product still says „synced".
--
-- In a design whose entire premise is that the password is phishable — that is
-- why K_auth and K_wrap are split at all — „it opened under my password key"
-- cannot be the provenance test for the root of the hierarchy. So a device that
-- did not win does not join. The two ways to an existing MK are pairing with a
-- device that holds it and the Recovery Kit code, and both are proofs a password
-- thief does not have. The honest cost is nil: the honest loser is the user's
-- own second machine, which was going to pair anyway.
--
-- ─── WHY THE COMMITMENT TAG CANNOT BE USED TO CHECK ANY OF THIS ─────────────
--
-- `wrap.ts` derives it as `HKDF(KEK, COMMIT_LABEL ‖ AAD)`. The KEK and the AAD —
-- not the wrapped key. Two DIFFERENT master keys, wrapped under the same K_wrap
-- for the same user, therefore produce byte-identical `commit_tag`s. „Is the
-- stored tag the one my MK would produce?" answers YES for the attacker's key,
-- silently, in the attacker's favour. Win and loss are read from the `devices`
-- row instead: the winner's transaction wrote one and the loser's rolled back.
--
-- ─── WHY IT TAKES TWO SESSION IDS AND NO `user_id` ──────────────────────────
--
-- Under `service_role` there is no `auth.uid()`, so a `p_user_id` parameter has
-- nothing to disagree with: anyone who can reach this function with a session of
-- their own would mint on any account whose uuid they can name. The account is
-- therefore DERIVED from a session row, and the caller's only input is which
-- session — a value it cannot invent, because `auth.sessions` is written by
-- GoTrue.
--
-- The two sessions are different sessions on purpose, and the function refuses
-- them being equal (NX306):
--
--  * `p_auth_session_id` is an EPHEMERAL `aal2` session that authorises this one
--    call and is signed out immediately afterwards.
--  * `p_device_session_id` is the long-lived `aal1` session the desktop actually
--    syncs with, and the one written into `devices.session_id`.
--
-- Without the split, the desktop's working session would be `aal2` for its whole
-- life, because `aal` survives refresh. `devices_live_session` hands an `aal2`
-- session read and write over EVERY device row on the account — its own comment
-- says a desktop has no business listing the user's other machines — and
-- `pairing_insert_requires_aal2` would let it act as a pairing initiator. Both
-- are browser powers, granted to a token that sits on disk in an Electron app.
-- Keeping „a desktop's working session is aal1" true costs one extra sign-in.
--
-- ─── WHAT `aal2` IS WORTH HERE, MEASURED ────────────────────────────────────
--
-- Measured against this stack rather than assumed (README §3): a password-only
-- `aal1` session on an account with NO verified factor can enrol its own TOTP
-- and step itself up — the first factor has to be armed by a session that does
-- not have one yet, so this is not a GoTrue defect and no configuration removes
-- it. On an account that already has one, the same request is `403
-- insufficient_aal`.
--
-- So the `aal2` gate is real for every account that followed the sign-up
-- ordering, and worth nothing for one that has not. NX303 raises its price
-- further by requiring a verified factor that PREDATES this session — which the
-- honest desktop satisfies without trying, since it signs in long after the user
-- armed their factor on the web. Stated honestly: that is a speed bump, not a
-- wall. An attacker who enrols, signs out and signs back in satisfies it. It is
-- here because it costs four lines and turns a one-shot into a sequence that
-- leaves more behind, and because the thing actually protecting the owner is
-- that losing is terminal, not that the gate is hard.

-- No `begin;`/`commit;` — the CLI wraps each migration file in a transaction of
-- its own; migration 001's header has the full reasoning.

-- ---------------------------------------------------------------------------
-- The reads this function needs, column by column
-- ---------------------------------------------------------------------------
-- `service_role` holds BYPASSRLS and every grant on `public`, and NO grant of
-- any kind inside `auth` — measured, not assumed. A `security invoker` function
-- running as `service_role` therefore cannot read `auth.sessions` at all.
--
-- The alternative was `security definer`, and it is refused: `03_catalog_surface`
-- asserts that no such routine exists in the schemas this repository owns, and
-- the master-key mint is the last place to make the first exception. A grant is
-- also the narrower instrument. PostgREST exposes `public` only, so nothing
-- reachable over HTTP can select from `auth` however many grants exist here;
-- what this widens is what a function in THIS repository, running as
-- `service_role`, may read — which is the thing being written.
--
-- Column-scoped, so „read the session's assurance" never becomes „read
-- `encrypted_password`".
grant select (id, user_id, aal, not_after, created_at) on auth.sessions to service_role;
grant select (id, email_confirmed_at) on auth.users to service_role;
grant select (session_id, authentication_method) on auth.mfa_amr_claims to service_role;
grant select (id, user_id, status, created_at) on auth.mfa_factors to service_role;

-- ---------------------------------------------------------------------------
-- The mint
-- ---------------------------------------------------------------------------
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
  p_src_kdf_params         jsonb
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
  -- The two sessions must be two sessions. See the header: this is the whole
  -- reason the desktop's working session stays aal1.
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

  -- The factor predates the session. A speed bump, and the header says so.
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

  -- The fast path for „somebody else already did this". The unique index below
  -- is what actually decides the race; this only spares the common case an
  -- exception it would learn nothing from.
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

  insert into public.devices
    (user_id, session_id, platform, name_nonce, name_ciphertext)
  values
    (v_user, p_device_session_id, 'desktop', p_device_name_nonce, p_device_name_ciphertext);

  return 'minted';
end;
$$;

comment on function public.nexus_mk_mint(
  uuid, uuid, bytea, bytea, bytea, bytea, bytea, jsonb, bytea, bytea, bytea, bytea, jsonb) is
  'Mint MK for an account that has none, and register the desktop that did it. '
  'Service-role only. Derives the account from auth.sessions rather than taking '
  'a user_id; requires an aal2 authorising session distinct from the device '
  'session, a verified factor older than it, and a confirmed email. Returns '
  '''minted'' or ''already_minted''; a lost race surfaces as 23505 on '
  'key_wraps_one_per_slot. There is NO adoption path — see the migration header.';

-- Postgres grants EXECUTE on a new function to PUBLIC, and this one lives in the
-- exposed schema. Every other routine here does the same dance; `anon` and
-- `authenticated` are both reachable over HTTP with a key printed in the client.
revoke all on function public.nexus_mk_mint(
  uuid, uuid, bytea, bytea, bytea, bytea, bytea, jsonb, bytea, bytea, bytea, bytea, jsonb)
  from public;
revoke all on function public.nexus_mk_mint(
  uuid, uuid, bytea, bytea, bytea, bytea, bytea, jsonb, bytea, bytea, bytea, bytea, jsonb)
  from anon;
revoke all on function public.nexus_mk_mint(
  uuid, uuid, bytea, bytea, bytea, bytea, bytea, jsonb, bytea, bytea, bytea, bytea, jsonb)
  from authenticated;
grant execute on function public.nexus_mk_mint(
  uuid, uuid, bytea, bytea, bytea, bytea, bytea, jsonb, bytea, bytea, bytea, bytea, jsonb)
  to service_role;
