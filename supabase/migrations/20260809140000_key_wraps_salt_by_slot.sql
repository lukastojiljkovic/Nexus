-- Nexus sync — migration 009: only ONE of the two password-derived slots may
-- carry a salt, and the other must not.
--
-- WHAT WAS WRONG. `key_wraps_kdf_presence` demanded a 16-byte `kdf_salt` for
-- both `mk_under_kwrap` and `mk_under_src`, and the column comment described it
-- as „16 random bytes". That is true of exactly one of them.
--
--   mk_under_src   KEK = Argon2id(sync recovery code, RANDOM salt). The salt is
--                  not derivable from anything the client knows, so it MUST be
--                  stored or the wrap is a brick. Correct as it stood.
--
--   mk_under_kwrap KEK = K_wrap, whose salt is SHA-256("nexus/web-kdf/v1" ‖
--                  lowercase(email)) — THIRTY-TWO bytes, derived, identical on
--                  every device, and deliberately never fetched. `kdf.ts` is
--                  explicit about why: „A per-user random salt would have to be
--                  FETCHED before the user could sign in, which hands an
--                  unauthenticated caller an account-existence oracle and gives
--                  a hostile server a per-attempt lever to weaken the
--                  derivation."
--
-- So the constraint required a value that cannot honestly exist. Whatever the
-- first writer put there would be 16 bytes of noise sitting under a comment
-- calling it the salt — and the failure is not that the noise is useless, it is
-- that the NEXT client reads it and uses it. At that moment the email-derived
-- salt has been replaced by a server-supplied one, on the one derivation whose
-- whole design is that the server has no say in it. The check was not merely
-- redundant; it was an instruction to build the thing the KDF refuses.
--
-- WHY THE ASYMMETRY IS SAFE, stated so it is not „fixed" back later. A hostile
-- server lying about `mk_under_src`'s salt gains nothing: the code behind it is
-- 160 bits, there is no dictionary to aim a chosen salt at, and a wrong salt
-- fails at the commitment tag rather than yielding a plausible key. Lying about
-- a stored salt for the WEB PASSWORD would be an attack, because that secret is
-- a human-chosen password and a per-attempt salt is a per-attempt weakening.
-- Same column, opposite conclusions, because the secrets differ.
--
-- SCOPE. `kdf_params` is unchanged and stays required for both slots: unlike the
-- salt it is genuinely read from the server, precisely so costs can be raised
-- later without locking anyone out, which is why `assertAcceptableParams` in
-- `kdf.ts` treats it as hostile input and bounds it from both sides.

-- No `begin;`/`commit;` — the CLI wraps each migration file in a transaction of
-- its own; migration 001's header has the full reasoning.

alter table public.key_wraps drop constraint key_wraps_kdf_presence;

-- Split in two, so a failure names which half is wrong rather than reporting
-- „the kdf columns are inconsistent" for four different mistakes.
alter table public.key_wraps add constraint key_wraps_kdf_params_presence check (
  (kind in ('mk_under_kwrap', 'mk_under_src') and kdf_params is not null)
  or (kind = 'ck_under_mk' and kdf_params is null)
);

-- The whole point of this migration. `mk_under_kwrap` is listed with
-- `ck_under_mk` rather than with the other `mk_*` slot, which is the shape of
-- the actual rule: a salt belongs to a wrap whose KEK came from a secret with no
-- other source of salt, and that is `mk_under_src` alone.
alter table public.key_wraps add constraint key_wraps_kdf_salt_presence check (
  (kind = 'mk_under_src' and kdf_salt is not null and octet_length(kdf_salt) = 16)
  or (kind in ('mk_under_kwrap', 'ck_under_mk') and kdf_salt is null)
);

comment on column public.key_wraps.kdf_salt is
  'LEAKS: nothing (16 random bytes). ONLY for mk_under_src, whose KEK is '
  'Argon2id over the printed recovery code and has no other source of salt. '
  'NULL for mk_under_kwrap by constraint: that KEK is K_wrap, whose salt is '
  'SHA-256("nexus/web-kdf/v1" || lowercase(email)) — derived, 32 bytes, and '
  'never fetched, because a fetched salt is a per-attempt lever a hostile '
  'server would hold over a human-chosen password. See migration 009.';
