-- Nexus sync — migration 010: authoring a key wrap is a DESKTOP operation, and a
-- wrap that changes dates itself.
--
-- Two defects, both found by attacking migration 002's `key_wraps` rules rather
-- than by reading them, and both of the same shape: a justification that is
-- correct about READS was carried into WRITES, where it does not hold.
--
-- ─── 1. THE `ck_under_mk` EXEMPTION IN `WITH CHECK` ─────────────────────────
--
-- `key_wraps_master_key_is_desktop_only` shipped with
--
--     with check ( kind = 'ck_under_mk' or exists (… a live desktop device …) )
--
-- and the first branch carries no device predicate at all. The policy's own
-- comment argues the exemption on the READ side — „per-profile content keys are
-- exactly what a browser session is supposed to hold" — which is true, and then
-- the same branch appears in the write half, where it is not.
--
-- WHAT IT ALLOWED. Any session that clears the live-session gate — including a
-- browser, whose device row says `web`, and including one that reached `aal2`
-- with nothing but the account password — could UPDATE `nonce`, `wrapped` and
-- `commit_tag` on EVERY content-key wrap on the account. Those three columns are
-- in the `authenticated` update grant, so nothing else stood in the way.
--
-- The result is not a leak; it is destruction, and it is permanent. There is no
-- DELETE on this table. `epoch` is immutable (NX102). Migration 003 admits a
-- `sync_objects.ck_epoch` only while a wrap exists at that epoch. So ONE UPDATE
-- per profile detaches every row of that profile from any key that can open it,
-- and the way back is minting epoch 2 and re-encrypting the whole profile from a
-- desktop that still holds `CK_p` locally. If no desktop does, the data is gone —
-- from the account of a user whose only mistake was reusing a password.
--
-- WHY THE NARROW FIX IS ALSO THE COMPLETE ONE. A browser never authors a
-- `ck_under_mk` row. It RECEIVES content keys through pairing, already open and
-- sealed to it; the row itself is account-scoped, one per (profile, epoch), and
-- minting or rotating it is an operation that re-encrypts rows — which is a
-- desktop's job, because the desktop is what holds the plaintext. So the write
-- side needs no exemption at all, and the policy becomes: a desktop device row
-- is required to write ANY wrap, and additionally required to read the one wrap
-- whose opener a browser derives from the password.
--
-- RENAMED, because the old name would now be a lie about half of what the policy
-- does, and a control whose name disagrees with its body is one somebody
-- „corrects" back. `key_wraps_desktop_only` says both halves.
--
-- The service-role mint is unaffected: it holds BYPASSRLS, which is where „mint
-- MK exactly once per account" has to live anyway.
--
-- ─── 2. `rotated_at` WAS THE CLIENT'S TO STATE ──────────────────────────────
--
-- `mk_under_src` is the Recovery Kit slot. A session with a desktop device row
-- may UPDATE it — legitimately, that is how a user re-arms a lost kit — and the
-- wrap AAD binds only the purpose and the user id, not the salt, so a wrap of a
-- DIFFERENT master key under a DIFFERENT code is a perfectly valid row. The
-- printed sheet in the drawer stops working, silently, and the account discovers
-- it at the exact moment recovery is needed.
--
-- The one thing that could tell the user is a timestamp, and this table has two.
-- `created_at` is pinned to OLD by the guard trigger and answers „since when
-- could this password open my account" — after a substitution it dates the
-- arming of a secret that no longer opens the row, which is worse than nothing.
-- `rotated_at` answers the right question and was left to the client to write:
-- the honest client sets it and nobody who wanted the change to be invisible
-- would.
--
-- „The wrap changed" and „the wrap was rotated at" are the same fact, and the
-- trigger is already standing on the branch where the first one is known — it is
-- the branch that demands a fresh nonce (NX101). Stamping there costs a line and
-- makes „your Recovery Kit was replaced on <date>" a sentence the product can
-- actually say. Assigned rather than merely defaulted, so a writer that states
-- its own value does not get to keep it.
--
-- STAMPING ALONE WOULD HAVE BEEN A FIX THAT DOES NOT HOLD, and it is worth
-- writing down why, because it looked complete. `rotated_at` was in the
-- `authenticated` UPDATE grant. So the substitution stamps the row — and a
-- SECOND statement, changing nothing but that column, moves it back to whatever
-- date the attacker likes. The signal is erased by the same client that tripped
-- it. A server-stated value that a client may also state is not server-stated;
-- it is a default.
--
-- So the column leaves the grant (a statement naming it now fails at the parser)
-- AND the trigger pins it to OLD whenever the wrap did not change — the same
-- belt-and-braces `created_at` already has, and for the reason migration 003b
-- gives: the grant stops an ordinary PostgREST request, the trigger stops the
-- paths that have privileges anyway.
--
-- What is lost: nothing. Migration 002 granted the column on the grounds that
-- „retiring and rotating are the only two lifecycle operations this table has",
-- but rotating is EXPRESSED by writing a new wrap, which the trigger sees. A
-- client-written `rotated_at` was never the operation — only a claim about it.
-- `disabled_at` stays writable, because retiring genuinely is a column edit and
-- has no other expression.

-- No `begin;`/`commit;` — the CLI wraps each migration file in a transaction of
-- its own; migration 001's header has the full reasoning.

-- ---------------------------------------------------------------------------
-- 1. The policy
-- ---------------------------------------------------------------------------
drop policy key_wraps_master_key_is_desktop_only on public.key_wraps;

create policy key_wraps_desktop_only on public.key_wraps
  as restrictive for all to authenticated
  using (
    kind <> 'mk_under_kwrap'
    or exists (
      select 1
      from public.devices d
      -- `user_id` restated rather than left to `devices`' own policies, for the
      -- reason `private.nexus_session_is_live()` restates it: the tenancy of a
      -- security predicate must not depend on another table's policies.
      where d.user_id = key_wraps.user_id
        and d.session_id = nullif((select auth.jwt()) ->> 'session_id', '')::uuid
        and d.revoked_at is null
        and d.platform = 'desktop'
    )
  )
  with check (
    exists (
      select 1
      from public.devices d
      where d.user_id = key_wraps.user_id
        and d.session_id = nullif((select auth.jwt()) ->> 'session_id', '')::uuid
        and d.revoked_at is null
        and d.platform = 'desktop'
    )
  );

-- ---------------------------------------------------------------------------
-- 2. `rotated_at` leaves the client's hands
-- ---------------------------------------------------------------------------
revoke update (rotated_at) on public.key_wraps from authenticated;

comment on column public.key_wraps.rotated_at is
  'When the wrap last changed. STATED BY THE SERVER — `key_wraps_guard()` sets '
  'it on the branch that sees new ciphertext and pins it otherwise, and the '
  'column is not in any client grant. It is the only signal the owner of a '
  'substituted Recovery Kit wrap will ever get, so a client that could write it '
  'could erase it.';

-- ---------------------------------------------------------------------------
-- 3. The guard trigger
-- ---------------------------------------------------------------------------
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
  -- common update is `disabled_at := now()`, which re-encrypts nothing and has
  -- no business drawing a nonce. Demanding one would be a rule that fires on the
  -- honest path and teaches the client to work around it, which is how a control
  -- stops being applied.
  if new.wrapped is distinct from old.wrapped then
    if new.nonce is not distinct from old.nonce then
      raise exception using
        errcode = 'NX101',
        message = 'key_wraps.nonce must be freshly drawn whenever the wrap changes',
        detail  = format('wrap %s (%s): new ciphertext at the previous nonce',
                         old.id, old.kind),
        hint    = 'A re-wrap under the same key at the same nonce discloses the '
                  'XOR of the old and new keys to whoever holds the old one.';
    end if;

    -- THE SAME BRANCH, so the stamp cannot disagree with the fact. See the
    -- header: a substituted `mk_under_src` is how a recoverable account becomes
    -- unrecoverable, and this timestamp is the only signal its owner will get.
    new.rotated_at := now();
  else
    -- And pinned when it did not, so the stamp cannot be walked back by a second
    -- statement that changes nothing else.
    new.rotated_at := old.rotated_at;
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
  'BEFORE UPDATE guard: a changed wrap needs a fresh nonce (NX101) and stamps '
  'rotated_at, slot identity — id/user/kind/profile/epoch — is immutable '
  '(NX102), created_at survives. See the migration headers (003b, 010).';
