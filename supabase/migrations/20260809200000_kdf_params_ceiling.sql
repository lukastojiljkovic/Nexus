-- Nexus sync — migration 012: the KDF cost parameters get a ceiling too.
--
-- WHAT WAS WRONG. `key_wraps_kdf_params_floor` (migration 001) bounds
-- `kdf_params` from BELOW only: memory ≥ 64 MiB, iterations ≥ 3, parallelism ≥ 1
-- and nothing above. So the schema accepts `{"memoryKiB": 1073741824,
-- "iterations": 9999, "parallelism": 64}` — and `kdf.ts` refuses to derive under
-- it, because a hostile server that could dictate the cost would otherwise hang
-- or crash every client that signs in. The result is a row the schema calls
-- valid and every client in the product calls poison.
--
-- For `mk_under_kwrap` and `mk_under_src` that is not a display bug. Those two
-- rows are the ONLY routes to the master key. A device that writes one of them
-- with parameters above the client ceiling has bricked the account: no device,
-- including the one that wrote it, will ever derive the KEK again, the wraps
-- cannot be rewritten (`key_wraps_desktop_only` needs a device row, and the
-- device row is on the far side of the mint), and there is no third copy.
--
-- WHY A CEILING IS A SECURITY BOUND AND NOT ONLY A SANITY BOUND. Parallelism is
-- the parameter where „higher" is not „stronger": Argon2 divides the same total
-- memory among `p` independently computable lanes, so raising `p` at a fixed `m`
-- leaves the honest cost roughly unchanged while handing an attacker with many
-- cores a proportional speedup. `p = 64` is a weakened K_wrap that looks, to
-- anyone reading the row, like a stronger one. `kdf.ts` says all of this and
-- enforces it on READ; this migration is the same rule stated where a row is
-- WRITTEN, which is the difference between a client that declines to open a bad
-- wrap and a bad wrap that cannot be stored.
--
-- THE NUMBERS ARE COPIED FROM `packages/sync-crypto/src/kdf.ts` ON PURPOSE, and
-- copied numbers drift. `supabase/tests/static/kdf-bounds.test.mjs` reads both
-- files and fails if they stop agreeing — the duplication is deliberate (SQL
-- cannot import TypeScript) and the gate is what makes it safe.
--
--   MAX_WEB_KDF_MEMORY_KIB  = 1024 * 1024  (1 GiB)
--   MAX_WEB_KDF_ITERATIONS  = 16
--   MAX_WEB_KDF_PARALLELISM = 4
--
-- A separate constraint rather than more clauses inside the floor, for the
-- reason `key_wraps_epoch_presence` gives: a violation should name which half is
-- wrong. „Below the floor" and „above the ceiling" are opposite mistakes with
-- opposite fixes, and one constraint name for both makes the error message say
-- neither.

-- `CASE` RATHER THAN A CHAIN OF `and`/`or`, AND THIS IS NOT STYLE. SQL does not
-- promise left-to-right evaluation of boolean operators, and Postgres will
-- reorder them by estimated cost — so „check the type, THEN cast" written as
-- `jsonb_typeof(x) = 'number' and x::numeric <= …` can legally run the cast
-- first and raise 22P02 on input the type test was there to divert. `CASE` is
-- the one construct the manual guarantees evaluates its branches in order and
-- only the selected result.
--
-- The middle branch says „this constraint has no opinion about input that is not
-- three numbers", because `key_wraps_kdf_params_floor` already refuses that and
-- one rejection with one constraint name is the useful outcome.
alter table public.key_wraps add constraint key_wraps_kdf_params_ceiling check (
  case
    when kdf_params is null then true
    when jsonb_typeof(kdf_params -> 'memoryKiB')    is distinct from 'number'
      or jsonb_typeof(kdf_params -> 'iterations')   is distinct from 'number'
      or jsonb_typeof(kdf_params -> 'parallelism')  is distinct from 'number' then true
    else (kdf_params ->> 'memoryKiB')::numeric   <= 1048576
     and (kdf_params ->> 'iterations')::numeric  <= 16
     and (kdf_params ->> 'parallelism')::numeric <= 4
  end
);

comment on constraint key_wraps_kdf_params_ceiling on public.key_wraps is
  'Upper bound on Argon2id cost, mirroring the ceiling kdf.ts enforces on read. '
  'Without it the schema accepts parameters no client will derive under, which '
  'for the two mk_* slots is a permanently unopenable master key; and parallelism '
  'in particular WEAKENS the wrap as it rises, so its bound is a security bound.';

-- THE FLOOR CONSTRAINT HAS THE SAME LATENT ORDERING HAZARD and is deliberately
-- left alone. `key_wraps_kdf_params_floor` writes its type tests and its casts
-- in one `and` chain, so nothing in the manual stops the cast running first and
-- raising 22P02 on `{"memoryKiB": "abc"}`.
--
-- MEASURED on Postgres 17, this local project, 2026-08-09: it does not. Both
-- `{"memoryKiB": "abc", …}` and a params object with `memoryKiB` absent are
-- refused as 23514 naming `key_wraps_kdf_params_floor`, so today's planner does
-- evaluate the guards first. That is an observation about one planner, not a
-- guarantee — which is why the NEW constraint is written with `CASE` and the old
-- one is not being rewritten to chase a message that is currently correct.
