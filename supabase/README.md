# Nexus sync server

The server half of Nexus sync: a schema, a row-level-security wall, one Edge
Function, and the checks that prove the wall stands.

Nothing in this directory connects to a real project. It is SQL, TOML,
TypeScript and tests. Creating a project, holding its keys and deploying any of
this are steps **a human performs with their own credentials** — they are listed
at the bottom, and none of them is automated here on purpose.

---

## 1. What the server can and cannot see

The server is assumed **hostile**. Not „untrusted in the abstract" — hostile:
the design assumes whoever operates the box reads the database, keeps every
backup, and is willing to modify rows. Everything below follows from that.

### It cannot see

| | Why not |
| --- | --- |
| The content of any object — a task's title, a note's body, a transaction's amount | Each row is AEAD ciphertext under a per-profile content key (`CK_p`) that is never sent to the server in usable form. |
| Any profile name, tag, list, category or file name | They are content, and content is inside the ciphertext. |
| A device's name | `devices.name_ciphertext`, not `devices.name`. „Luka's ThinkPad" is a person and a machine; the server has no use for either. |
| The master sync key `MK`, any content key `CK_p`, or the local data key `DK` | `MK` is wrapped under a key derived from the web password with Argon2id, and separately under the sync recovery code. The server holds wraps, never the secrets that open them. `DK` never leaves the device at all — nothing in this directory touches it. |
| The pairing code, or the shared secret a pairing derives | The server sees only `code_id`, a blinded Argon2id-derived handle, and public ephemeral keys. |
| The bytes of any attachment | Encrypted client-side before upload into a private bucket. |

### It can see — the conceded risk

This list is the honest part of the document. **Every one of these is also
written as a `comment on column` in the schema itself**, so `\d+ public.sync_objects`
answers the question without anyone finding this file, and
`scripts/check-rls-wall.mjs` fails the build if a column is ever added without
one.

- **Which account** every row belongs to (`user_id`) — it is the tenancy key
  every policy is written against.
- **How many profiles** an account has and **how busy each is** — never their
  names.
- **Which modules** are in use and how heavily (`collection`: `tasks`, `notes`,
  `fin_tx`, …). It is the routing key for a pull and part of the AEAD associated
  data, so it cannot be encrypted.
- **Which profiles are web-enabled** — from the presence of a `ck_under_mk` row
  in `key_wraps`.
- **How many times an object has been edited** (`version`) and **when**
  (`created_at`, `updated_at`, `seq`).
- **That an object was deleted**, and when.
- **The approximate size** of each object's plaintext. Padding is a client
  decision; the server cannot add it without being able to remove it.
- **The shape of the object graph** — which rows hang off which (`parent_id`) —
  without any of their content.
- **An activity trace**: which device synced what, and when.
- **That an account is pairing a device right now**, and whether it succeeded.

In short: the server learns **how much you work, when, and in which parts of the
app**. It does not learn *what*.

### What the server cannot enforce, and this must not be misread

1. **„`MK` must never enter a browser." — now enforced by the server for the
   wrap that matters, and the shape of what is left is worth being exact about.**

   The threat is short: the browser derives `K_wrap` from the password on its way
   to computing `K_auth`, so it holds the opener of `mk_under_kwrap` by
   construction, and that row is one HTTP request away from any session on the
   account. One fetch and one AEAD open separate a web session from `MK` — and
   the only thing between them used to be the web client's own source, which is
   served by the party this document calls hostile.

   `devices.platform` is what makes a rule possible: it is **server-attested** —
   absent from the client's INSERT grant, defaulting to `web`, immutable
   afterwards — so the single writer that can say `desktop` is `pair-complete`
   under the service-role key after a completed handshake. „Desktop" therefore
   means, precisely, *vouched for by a device that already had the keys*, which
   is the strongest sentence anything here can say: nothing in HTTP attests what
   program sent a request.

   `key_wraps_desktop_only` applies it, and its two halves differ:

   - **READ confines `mk_under_kwrap` only.** `ck_under_mk` is what a browser is
     *supposed* to hold — it gets those through pairing. `mk_under_src` stays
     readable because confining it would break the one flow it exists for: a
     brand-new desktop recovering an account has no device row yet, since
     obtaining one is what it is trying to do. That costs nothing here, because
     its opener is the Recovery Kit code and the web password does not yield it.
     A stolen password gets those bytes and no way into them.
   - **WRITE confines every kind**, which is not symmetry. A session never needs
     to read what it destroys: overwriting `mk_under_kwrap` locks every real
     device out of `MK`, overwriting `mk_under_src` removes the way back, and
     overwriting a `ck_under_mk` detaches a whole profile's rows from any key
     that opens them. All three are unrecoverable and none of them leaks
     anything, which is exactly the shape of an attack nobody thinks to test for.
     Authoring a wrap is a desktop operation in every case: a browser receives
     content keys through pairing and never writes the row.

   What the server still cannot do is stop a browser that has been *given* the
   recovery code by its user from recovering `MK` in a tab. That is a deliberate
   act by the person who owns the account, not an escalation from a stolen
   credential, and no policy can tell the two apart. The client-side rule — the
   web bundle imports `@nexus/sync-crypto/web`, which exports neither
   `deriveWebPasswordKeys` nor `unwrapKey` — is what covers that, and it is
   enforced in four places listed in `packages/sync-crypto/src/kdf.ts`.

2. **„A local-only profile stays on this computer."** This one *is* structural,
   and by absence rather than by rule: a local-only profile simply has no
   `ck_under_mk` row. Whoever holds this database can flip any boolean in it;
   they cannot conjure a wrap of a key they have never seen. That is why it is
   modelled as a missing row and not as a `is_local_only` flag.

   Note what the absence has to be protected *from*, which is not only INSERT: a
   `ck_under_mk` row can be brought into existence for a local-only profile by
   **re-pointing an existing one**, and that is an UPDATE of a single column. So
   `kind` and `profile_id` carry no UPDATE grant and the `key_wraps` guard
   trigger refuses the move (`NX102`). Against the database's own operator only
   the AEAD reaches that far, which is why the required associated data —
   `"nexus/sync/key-wrap/v2" ‖ user_id ‖ kind ‖ profile_id ‖ epoch` — is stated as a
   `comment on table` in migration 001 rather than left to a client.

---

## 2. What is here

```text
supabase/
  config.toml                     project config; every security-relevant key is commented
  migrations/
    …090000_sync_core_tables.sql  five tables + one private schema; every column says what it leaks
    …090100_sync_rls.sql          the wall: ENABLE + FORCE, column grants, owner policies, gates
    …090200_sync_objects_guard…   the BEFORE INSERT OR UPDATE trigger RLS cannot replace
    …090250_key_wraps_guard…      a re-wrap needs a fresh nonce; a wrap cannot change slot
    …090260_devices_guard…        revoked_at is terminal; identity and platform are immutable
    …090300_storage_realtime_rls  the same wall over storage.objects and realtime.messages
    …090400_pair_complete_rpcs    three service-role-only routines the Edge Function calls
    …120000_sync_state_touch      updated_at on sync_state becomes the server's clock, not a claim
    …140000_key_wraps_salt_by_slot  a salt belongs to mk_under_src alone; the web slot derives its own
    …160000_key_wraps_writes…     authoring a wrap is a desktop operation, and a re-wrap cannot date itself
    …180000_mk_mint               the master key, minted exactly once per account
    …200000_kdf_params_ceiling    the KDF parameters bounded from ABOVE too, not only below
    …220000_device_register       how a desktop gets its device row back when its session dies
    …090000_housekeeping_schedule (2026-10-02) the housekeeping job schedules itself; warns if pg_cron cannot exist
  functions/                      three Edge Functions, and all three read a service-role key
    pair-complete/                the pairing handshake's three routines
    device-register/              hands out a desktop device row, priced at the master key (013)
    sync-enable/                  the only way an account's master key comes into existence (011)
  scripts/check-rls-wall.mjs      static drift guard — no database required
  tests/static/                   node:test suite; proves the guard can fail
  tests/database/                 pgTAP; proves the wall against a live Postgres
```

### The numbering is logical steps, not a file count

The fourteen files carry twelve numbers: `003` is spread over three files
(`003`, `003b`, `003c`), and `006` and `007` were never written. The number is the
logical STEP and it is what prose cites; the filename's timestamp is the order
the server applies them in. `pnpm check:migrations` holds the two against each
other — it fails if a file declares no number, if two declare the same one, if
the numbers do not increase with the filenames, if anything under `supabase/`
cites a number no file carries, or if a file is missing from the tree above,
which is how this listing came to be missing four of them.

**A bare number is ambiguous in this repository**, which is the trap that rule
exists for: the local SQLite schema in `packages/db/src/migrations/` numbers from
001 as well and has reached 068. The local series' **006** is the flashcards
table; this series has no 006 at all, so a reader who resolves that number lands
on Anki decks a schema away from anything to do with sync. One citation was
written that way — in `packages/sync-transport/src/signal.ts`, for the realtime
policies that live in this series' 004 — and it is the reason `check:migrations`
exists. Where both trees could be meant, **cite the file by name**.

### The wall, in one paragraph

There is no application server in front of this database. PostgREST turns every
table into an HTTP endpoint that any holder of an access token may query with an
arbitrary filter, so „the client only asks for its own rows" describes a client,
not a system. Every table has row level security **enabled and forced** (ENABLE
alone exempts the table owner, which is the role that runs every migration and
every console session), is **revoked from `anon`** (Supabase's default
privileges hand every new table to it at creation), carries **permissive owner
policies** on `user_id = auth.uid()`, carries **no DELETE policy and no DELETE
privilege** (rows are tombstoned), grants INSERT and UPDATE **by column and never
by table**, and carries **one `AS RESTRICTIVE` gate** demanding either `aal2` or
a session vouched for by a live, unrevoked device.

`key_wraps` carries a **second** restrictive gate on top of that one, because the
session gate is about *whether you are signed in properly* and this one is about
*what kind of client you are*: `key_wraps_desktop_only` confines `mk_under_kwrap`
on read, and a wrap of any kind on write, to a session a live `devices` row calls
a `desktop`. §1 has the reasoning and the asymmetry.

The `OR` in that gate is load-bearing: a desktop's pair-minted session is `aal1`
for its whole life, so a blanket `aal2` rule would lock out the only clients that
hold keys. What stops the `OR` being a self-service entrance is that **both ways
of obtaining a voucher are `aal2`-only** — the `pairing` INSERT *and* the
`devices` INSERT.

Both, because the gate never asks whether a pairing happened; it asks whether a
live `devices` row names this session. Restricting `pairing` alone closes the
long way in — start a handshake, play both sides, collect a device row — and
leaves the short one: a stolen web password gives an `aal1` session, and one
INSERT naming its own `session_id` produces the row that vouches for it. From
there the whole ciphertext corpus and every key wrap open, and since the password
is what `K_wrap` is derived from, `mk_under_kwrap` yields `MK`, `MK` yields every
`CK_p`, and `CK_p` yields the plaintext. That is the entire second factor, gone,
with every other assertion about the wall still passing.

The **column grants** are the same idea one layer down. A table-level
`grant insert, update` quietly converts every value some other rule treats as a
fact — the server's clock, the server's cursor, a row's identity, a single-use
latch, `platform` — into a value the client chooses, without touching a policy or
a constraint. Each grant therefore names its columns, and
`00_rls_enabled.test.sql` asserts the forbidden ones against
`information_schema.column_privileges`, which expands a table grant per column so
that „widened to the whole table" and „one column added to the list" fail
identically.

Migration `…120000` is that idea applied to the one column that had escaped it.
`sync_state.updated_at` is commented „when the device last synced" and was
granted to `authenticated` — so the value a human would read as evidence that a
device is alive was the device's own claim about its own clock. And nothing
wrote it: `default now()` fires on INSERT only, so it would have sat at „when
this cursor row was created" while reading as „last synced". The revoke stops it
being stated; a `BEFORE INSERT OR UPDATE` trigger makes it true. Both halves are
needed, and both are asserted — the grant in `00_rls_enabled.test.sql`, the
stamping in `02_guard_trigger.test.sql`.

Migration `…140000` is the same question asked of `key_wraps.kdf_salt`, and the
answer turned out to differ per slot. `mk_under_src`'s KEK is Argon2id over a
printed recovery code, so its salt exists nowhere else and MUST be stored.
`mk_under_kwrap`'s KEK is `K_wrap`, whose salt is
`SHA-256("nexus/web-kdf/v1" ‖ lowercase(email))` — derived, 32 bytes, identical
on every device, and deliberately never fetched, because a fetched salt is an
account-existence oracle and a per-attempt lever a hostile server would hold
over a human-chosen password. The old constraint required 16 bytes for **both**,
so the web slot had to be given noise under a column comment calling it the
salt — and the hazard was never the noise, it was the next client reading it and
using it. A salt is now required for the recovery slot and forbidden for the
other, with both directions asserted in `04_object_identity.test.sql`.

---

## 3. Running the checks

### Without a database — runs anywhere, needs nothing

```sh
node supabase/scripts/check-rls-wall.mjs      # the drift guard
node --test "supabase/tests/static/*.test.mjs" # and the tests that prove it can fail
```

or, equivalently, from inside this directory: `pnpm -C supabase check` and
`pnpm -C supabase test`.

The static guard reads the migration SQL as text and asserts: ENABLE **and**
FORCE on every table; `REVOKE ALL … FROM anon`; a `comment on column` for every
column; no DELETE policy and no DELETE grant; no permissive `FOR ALL` policy
(which grants DELETE without containing the word); no policy missing its `TO`
clause (a policy with none is addressed to PUBLIC, which includes `anon`); a
restrictive gate on every table, calling the shared predicate; the row-local
predicate on `devices`, which is the one table exempt from the shared one and
therefore the one whose gate nothing else checks; the desktop-only gate on
`key_wraps`, with its USING and WITH CHECK halves checked separately because they
confine different sets of kinds and a single scan over the statement would report
the read half as covering both; the `aal2`-only INSERT on
**both** `pairing` and `devices`; every write grant to `authenticated` being
column-scoped and naming no forbidden column; the three guard triggers, with the
`sync_objects` one covering INSERT as well as UPDATE; `set search_path` on every
function; no `delete from` against replicated user state anywhere in the
migrations; a plan count matching the assertion count in every pgTAP file; every
pgTAP file ending in `rollback`; and no credential-shaped string anywhere under
`supabase/`.

Migrations carry **no explicit `begin;`/`commit;`** — the Supabase CLI already
applies each file in a transaction of its own and records it in
`supabase_migrations.schema_migrations` inside that same transaction. A nested
`begin;` warns and is a no-op, and the matching `commit;` would end the
*runner's* transaction, so a later statement failing would leave a half-applied
migration marked as done. The pgTAP files under `tests/database/` do carry
explicit `begin;`/`rollback;`, because those are run as standalone scripts and
every one of them seeds `auth.users`.

**The tests in `tests/static/` mostly test the guard, not the migrations.** Each
one copies the real migrations, breaks exactly one thing, and demands the
specific problem be reported. A security gate that has never been observed to
fail is indistinguishable from one that cannot fail — and that is not
hypothetical here: the mutation test for the `aal2` rule is what caught the
guard reading the *policy's name* (`pairing_insert_requires_aal2`) instead of
its predicate, which meant the single rule keeping a password-only session from
minting its own device would have passed while being gone.

### With a local database — proves the wall rather than the text

```sh
supabase start
supabase db reset          # applies migrations/ from scratch
supabase test db           # runs tests/database/*.test.sql through pgTAP
```

Six files, all wrapped in a transaction that rolls back:

- **`00_rls_enabled.test.sql`** — the migration-drift guard against the live
  catalog. Every table in the exposed schema has `relrowsecurity` **and**
  `relforcerowsecurity`; so do `storage.objects` and `realtime.messages`; no
  DELETE policy exists anywhere; `anon` holds no privilege; every column carries
  a comment. This catches what the static guard cannot: a policy dropped in the
  dashboard's SQL editor during an incident and never restored, a table left
  behind by a migration that was reverted in git after being applied.
- **`01_two_users.test.sql`** — user B sees zero of user A's rows in all five
  tables and cannot write into A's space, **paired with positive controls**: B
  does see its own rows, and a paired desktop at `aal1` does reach its own. A
  wall that denies everyone passes every isolation assertion in the file while
  the product does not work. It also asserts the gate's two entrances directly:
  a session seated at `aal1` can neither start a pairing **nor mint the
  `devices` row that would vouch for it**, no client may state its own
  `platform` at any assurance level, and a revoked device cannot be un-revoked
  even at `aal2`. („Seated at" and not „a password-only session": what a real
  password-only session can reach is a GoTrue question, measured just below.)
  The desktop-only rule is exercised in all four of its directions: a `web`
  session at `aal2` cannot read `mk_under_kwrap`, *can* read `mk_under_src`,
  cannot mint or overwrite either, and a paired desktop at `aal1` — the weaker
  session, by the only measure the identity provider has — reads the wrap the
  browser was refused.
- **`02_guard_trigger.test.sql`** — the four illegal updates to `sync_objects`,
  each by its own SQLSTATE, plus the boundary cases and the server-stamped
  columns; and the `key_wraps` guard (NX101, NX102 column by column, `created_at`
  and `rotated_at`), which migration 003b shipped without.
- **`03_catalog_surface.test.sql`** — what `01` structurally cannot see, because
  it signs in as two real users. `anon` is the role behind the publishable key,
  and it is refused every table at the privilege layer before any policy runs,
  holds EXECUTE on no routine and no USAGE on `private`. Alongside it: no
  `SECURITY DEFINER` routine exists at all in the schemas this repository owns,
  every routine pins its `search_path`, no view or foreign table hides a table
  behind an unwalled name, and no storage bucket is public.
- **`04_object_identity.test.sql`** — the composite and singleton object ids, run
  as the shapes the real client produces on its first push. Table constraints and
  a trigger rather than policies, so the migration role proves them as well as any
  client role would.
- **`05_mk_mint.test.sql`** — `nexus_mk_mint` against seeded `auth.sessions`,
  `auth.mfa_amr_claims` and `auth.mfa_factors` rows: each of its seven guards,
  the two outcomes, the device row it writes, idempotency on a retry, 23505 on a
  lost race, and 42501 for `authenticated` and for `anon`. Every guard was proved
  by *removing* it from the function and confirming exactly one named assertion
  goes red — which is how the `aal2` guard was caught being covered for by the
  AMR guard, passing while asserting nothing.

These require the local stack, where the migration role can bypass RLS; each
file asserts that first, so a wrong seat produces one clear failure rather than
seventeen confusing ones.

```sh
# The edge functions, against the same running stack. Skips loudly, by name,
# when the three variables are absent — CI's database job supplies them from
# `supabase status`.
eval "$(supabase status -o env | grep -E '^[A-Z0-9_]+=' | sed 's/^/export /')"
NEXUS_LIVE_SUPABASE_URL="$API_URL" NEXUS_LIVE_ANON_KEY="$ANON_KEY" \
NEXUS_LIVE_SERVICE_KEY="$SERVICE_ROLE_KEY" pnpm test:live
```

`tests/live/sync-enable.test.mjs` is the only place the mint is exercised the way
a client will use it: real password sign-ins, a real TOTP factor enrolled and
verified, a real step-up to `aal2`. Nothing about `auth.sessions` can be faked
for it, which is the point — the function derives the account from a session row
precisely so a claim cannot stand in for one.

### What `aal2` actually proves — measured against GoTrue, not assumed

Every assertion above seats a session at a chosen `aal` by writing the claim into
`request.jwt.claims`. That proves the *policy*. It cannot prove the *claim* the
policy is usually summarised with — „a password-only session cannot get there" —
because whether a session holding nothing but the password can reach `aal2` is a
question about the identity provider, not about this schema. It was measured
against the running stack, twice, on two populations:

| the account | a password-only `aal1` session enrols its own TOTP factor |
| --- | --- |
| brand-new, no verified factor | **succeeds** → verify returns `aal2`, `amr = [password, totp]` |
| one factor already verified | **refused**, `403 insufficient_aal` |

So `aal2` is a genuine second factor for the whole life of an account **except**
in the window between sign-up and the first verified factor, where it is the
password with thirty seconds of extra typing. That is not a defect in GoTrue —
the first factor has to be armed by a session that does not yet have one — and it
is why the sign-up ordering in §7 is a security control rather than a
convenience: it closes the window immediately, and nothing else can.

Two consequences worth stating plainly, because both are easy to assume away:

- Any design whose gate is `aal2` **on a fresh account** is gated on the
  password. `pairing_insert_requires_aal2` and `devices_insert_requires_aal2` are
  in that position for exactly as long as the user has no factor.
- The window is where the master key is minted, since an account without MK is an
  account that has never synced. What protects the owner there is not the gate;
  it is that minting is **not adoptable** — see §6.6.

A third measurement, from the same stack and pinned by `tests/live`: **verifying
a factor revokes every other session the account holds.** The stepped-up session
survives, sessions signed in afterwards survive, everything from before is
answered `403` by `/auth/v1/user`. Nothing in this repository's code reads as if
it depends on that, which is exactly why it is written down — it forces the order
in which the desktop signs in (§6.6), and it means one machine enabling sync ends
another machine's session.

---

## 4. The trigger, and why it is not more RLS

A policy's `WITH CHECK` is handed the NEW row and only the NEW row. „Higher than
it was", „was not already a tombstone", „still the same object" are all
statements about the *transition*, and a predicate that cannot see OLD cannot
express any of them.

Without it, one session that satisfies every policy — the honest owner, or an
attacker holding a stolen password at `aal2` — issues one statement:

```sql
update sync_objects set version = 9007199254740991, ciphertext = '\x00…' where …;
```

Every honest client then pulls that row, sees a version far above its own and —
correctly, because a monotone counter is what anti-rollback protection is built
on — latches it as that object's high-water mark. From then on no real edit can
ever win, and restoring the *server* does not help, because the poison is now
inside every device. The AEAD cannot prevent this: it binds the version to the
ciphertext, so the forged row will not open, but the client will still have seen
the number. Authentication answers „is this content genuine"; it has nothing to
say about „is this number reachable".

The triggers' contract with the sync client is their SQLSTATEs:

| Code | Table | Rule | What the client should do |
| --- | --- | --- | --- |
| `NX001` | `sync_objects` | an update writes exactly `stored + 1` | **Retryable.** Re-read, merge, write `observed + 1`. This is the optimistic-concurrency conflict — and, after a lost response, a duplicate: if the server's row is byte-identical to what you sent, that push succeeded. |
| `NX002` | `sync_objects` | a creation starts at version 1 | Bug or attack. The server has no row for this object; push it as a creation, or pull first. |
| `NX003` | `sync_objects` | every version carries a new ciphertext | Bug or tampering. The version is in the AAD, so an unchanged ciphertext at a new version opens for nobody. |
| `NX004` | `sync_objects` | identity columns are immutable | Bug. Those four columns are the AEAD associated data. |
| `NX005` | `sync_objects` | every version needs a freshly drawn nonce | Bug, and a severe one — see below. Stop and fix the encryptor. |
| `NX006` | `sync_objects` | `ck_epoch` never falls | Bug. A rotation only moves forward. |
| `NX007` | `sync_objects` | `ck_epoch` names a stored `ck_under_mk` wrap | Bug. Store the wrapped content key for the epoch before sealing rows under it. |
| `NX101` | `key_wraps` | a changed wrap needs a fresh nonce | Same class as `NX005`, on the rotation path. |
| `NX102` | `key_wraps` | a wrap cannot change slot (`kind`/`profile_id`/`epoch`) | Bug. Retire with `disabled_at` and insert the new row. |
| `NX201` | `devices` | `revoked_at` is terminal | Bug. Pair again for a new session and a new row. |
| `NX202` | `devices` | id/user/session/platform are immutable | Bug. Re-pointing a row vouches for a session nobody paired. |
| `NX301` | pairing RPC | rate-limit parameters must be positive | Bug in the Edge Function's own call. |
| `NX302` | pairing RPC | a completion token digest is exactly 32 bytes | Bug in the Edge Function's own call. |

**The codes are banded by table** — `NX0xx` for `sync_objects`, `NX1xx` for
`key_wraps`, `NX2xx` for `devices`, `NX3xx` for the pairing RPCs. That is not
filing. These codes reach the client verbatim (PostgREST v14.16 maps an unknown
SQLSTATE to HTTP 400 and passes `code`, `details` and `hint` straight through, so
a guard violation is a non-retryable 4xx carrying a machine-readable rule id),
which makes them the sync engine's error map. Before the banding, `NX007` meant
both „a wrap cannot change slot" and „the epoch may not fall" — ambiguous exactly
where the map decides between *re-read and merge* and *stop and tell the user*.

**Two rules that used to be here are gone, and both removals are load-bearing.**
The old `NX002` bounded a version step at 65 536; with `NX001` now an equality
there is no step to bound, and — more importantly — the old rule permitted a
silent lost update, because a client that observed version 5 and wrote 9 erased
versions 6 to 8 with no error anywhere. The old `NX003` made a tombstone
terminal. It contradicted restore-from-trash, which ships in the 1.0.0 desktop
app; its stated defence was already provided by `deleted` and `version` being in
the AAD; and it was a one-way ratchet pointed at the owner, since a stolen
session could tombstone every row and the honest repair is precisely a write
setting `deleted = false`. Migration 003's header carries the full argument.

`NX005`/`NX101` are worth a sentence of their own, because they are the one rule
here that is not about ordering or ownership. Reuse of a `(key, nonce)` pair under
XChaCha20-Poly1305 is not a weakening, it is a break, twice over: the keystream
depends on the key and the nonce alone, so two versions written at one nonce XOR
to the XOR of their plaintexts; and the Poly1305 one-time key repeats with it, so
two messages under it are enough to solve for `r` and `s` and forge anything at
all under that pair. **The associated data does not help** — `NX001` guarantees
the AAD differs on every version, and associated data never reaches the
keystream. `NX101` is the sharper case: a content key rotated under an unchanged
`MK` at an unchanged nonce publishes `CK_old XOR CK_new`, handing the new key to
exactly the party the rotation was performed to lock out.

`NX005` is also only half the nonce policy. It compares against the nonce the row
is replacing, which is one row deep; the `sync_objects_nonce_unique` index covers
the complementary case — a nonce repeated across different rows of one
`(profile, epoch)` — which is the shape a broken generator produces and the shape
the trigger structurally cannot see.

> PostgREST reports an unrecognised SQLSTATE class as HTTP 500 while still
> returning the code in the response body's `code` field. **The sync client must
> key off `code`, not the HTTP status** — otherwise the one retryable error in
> the list looks like a server outage.

---

## 5. Steps a human must perform with their own credentials

None of this is automated, and none of it should be.

1. **Create the project.** <https://supabase.com/dashboard> → new project. Choose
   the region deliberately; it is where the ciphertext and all the metadata in
   §1 will live.
2. **Link this directory to it.**

   ```sh
   supabase login
   supabase link --project-ref <your-project-ref>
   ```
   This writes into `supabase/.temp/`, which is gitignored.
3. **Apply the schema.**

   ```sh
   supabase db push
   ```
4. **Check the two warnings.** Migration `…090300` may print
   `Nexus: could not force RLS on storage.objects` (or `realtime.messages`) if
   the migration role is not a member of the owning role. It warns rather than
   aborting, because failing there would take the whole deploy down over a table
   this repository did not create. **If you see that warning, run the statements
   it names as the owning role before going further** — and either way, run
   `supabase test db`, which asserts the end state and fails loudly if the wall
   did not land.
5. **Set the one secret the Edge Function needs.**

   ```sh
   openssl rand -base64 32                       # keep this out of your shell history
   supabase secrets set NEXUS_PAIR_RATE_SALT=<value>
   ```
   `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are
   injected by the platform; you do not set them.
6. **Deploy the function, then confirm which header carries the caller's
   address.**

   ```sh
   supabase functions deploy pair-complete
   ```
   It deploys with `verify_jwt = false` from `config.toml`, which is required —
   at the moment of the first pairing the desktop has no session, which is the
   problem it exists to solve.

   `callerAddress()` prefers `cf-connecting-ip` and otherwise takes the
   **rightmost** `x-forwarded-for` hop, because the leftmost one is whatever the
   caller typed and reading it means the per-address rate limit can be bypassed
   with a random header on every request — silently, since the limiter still runs
   and still returns true. **Verify on the deployed function** that the header it
   ends up reading is the real client address: if more than one proxy appends,
   the rightmost hop is an internal address shared by everybody and the limiter
   collapses into one global bucket. That fails safe (everyone limited together
   rather than nobody limited) but it is an outage, not a control.
7. **The housekeeping schedule is a migration** (`…090000_housekeeping_schedule`),
   so there is nothing to paste: `supabase db push` creates `pg_cron` if the
   project can and then schedules `public.nexus_sync_housekeeping()` hourly,
   idempotently (it unschedules by name first). It reaps spent pairings and
   stale rate-limit buckets; it cannot touch user state, and the drift guard
   asserts that.

   **If the extension cannot be created** it is not an error: `pg_cron` has to
   be installed into the `postgres` database with a `shared_preload_libraries`
   entry, which a hosted project does when the extension is toggled on. The
   migration warns and schedules nothing rather than aborting the deploy;
   enable it from Database → Extensions and run `supabase db push` again. A
   project left without it has a working wall and a `private.pair_rate_limit`
   that grows one row per caller address forever.
8. **Turn on MFA enrolment** in Auth settings if it is not already on. This is
   not optional furniture: the restrictive gate's first branch is `aal2` and the
   `pairing` and `devices` INSERTs accept nothing else, so without an enrollable
   second factor **no account can ever pair a device and the product does not
   work**. That is deliberate — the control cannot be quietly disabled, because
   disabling it breaks the feature it protects.

   This fixes an ordering the web client must follow at sign-up, and it is worth
   knowing before writing that client: a fresh `aal1` session can read and write
   **nothing**, so the sequence is sign up → confirm email → **enrol and verify
   TOTP** → only then create the `key_wraps` rows and register the device. A
   client that tries to build the key hierarchy before stepping up to `aal2` gets
   an empty result and a rejected insert, and neither says „enrol a factor".
9. **Never put the service-role key anywhere but the function's environment.**
   It bypasses row level security completely; every wall in `migrations/` is
   transparent to it. Not in the desktop app, not in the web build, not in a CI
   variable a build log can print.

---

## 6. Known gaps

Nothing in this list is a rule that half-works. Each is something this directory
deliberately does not do, written down so that „not built" is never mistaken for
„not needed".

### 6.1 The pairing rendezvous — the protocol is not closed

`pair-complete` is deliberately the last step of the handshake: it exchanges a
completion token for a desktop session, and it accepts the desktop's ephemeral
public key and confirmation MAC in the same call so the browser can verify the
short authentication string afterwards.

It is not the only function here. Three sit in `supabase/functions/`:
`device-register`, which hands out a `platform = 'desktop'` row to whoever
already holds the account's master key; `sync-enable` (§6.6); and this one.

What is **not** built here is how the desktop obtains the *initiator's* half —
`pairing.initiator_pub` and `sealed_payload` — before it can complete the ECDH.
The browser inserts the `pairing` row (it must: at first pairing the desktop has
no session at all), so that half sits behind RLS the desktop cannot yet satisfy.
Closing it needs one more unauthenticated read endpoint, keyed by `code_id`,
with its own rate limit and its own burn-on-failure. It is a protocol decision
rather than a schema one, so this directory ships the columns and the honest
statement that the step is missing rather than an invented answer.

**Until it exists, `pair-complete` is unreachable on the honest path**, and
therefore so is every desktop session. The schema is ahead of the protocol.

### 6.2 Revocation does not end the auth session

`devices.revoked_at` stops a session reading anything, because four restrictive
policies consult it on every statement. It does **not** invalidate the GoTrue
session: the refresh token in that client's hands keeps working and keeps minting
access tokens, which are simply refused by the wall. The trigger makes the column
terminal (`NX201`) so the refusal cannot be undone, but the correct end state is
that revoking a device also calls the admin sign-out API for that `session_id`.
That needs an authenticated Edge Function and is not built.

### 6.3 `mk_*` wraps are readable by any session that passes the gate — CLOSED, with a stated limit

**Closed.** `key_wraps_desktop_only` (migration 010; it was
`key_wraps_master_key_is_desktop_only` until the write half stopped being only
about the master key) confines reading `mk_under_kwrap`, and writing **any**
wrap, to a session a live `devices` row calls a `desktop`. The recovery path that
this would have broken is what shapes the asymmetry: `mk_under_src` stays
readable, because a brand-new desktop recovering an account has no device row and
obtaining one is what it is trying to do. §1 has the full argument.

The write half was narrower than it looked until migration 010. It began
`kind = 'ck_under_mk' or …`, carrying the read-side argument — a browser is
supposed to hold content keys — into a place where it does not hold, and that
branch let any session past the live-session gate overwrite `nonce`/`wrapped`/
`commit_tag` on every content-key wrap on the account. With no DELETE, an
immutable `epoch` and `sync_objects.ck_epoch` admitted only while a wrap exists
at that epoch, one statement per profile detached every row from any key that
could open it, permanently. A browser never authors that row — it receives
content keys through pairing — so the exemption bought nothing and cost the
corpus.

**The limit that remains, and it is not a defect of the policy.** This confines
a *browser*; it does not confine an attacker who has the web password and is not
using our bundle. Password ⟹ `K_wrap` ⟹ MK is the design, so anyone holding the
password holds the account's contents once they also hold the wrap. What the
policy buys is that the wrap is not served to a session that cannot show a
desktop — which is the entire distance between „a phished password" and „a
phished password plus a device the server attested". Write that down rather than
letting the closed item read as more than it is.

### 6.4 One thing nobody has executed

- **`nexus_pair_claim`, `nexus_pair_rate_limit_hit` and `nexus_sync_housekeeping`
  have no pgTAP coverage at all.** The single-use latch, the attempt ceiling and
  the fixed window are argued in comments and asserted nowhere. They are the
  three routines where a concurrency bug is a security bug, so this is the first
  gap to close once a database exists.

- **The one place a service-role key lives resolves its dependency from a
  range.** `functions/pair-complete/deno.json` imports
  `jsr:@supabase/supabase-js@^2`, which is resolved at deploy time, and there is
  no `deno.lock` beside it. Pin an exact version and commit a lockfile before
  this function holds a real key — a floating range in the one process that
  bypasses every wall in `migrations/` is a supply chain with no floor.

  `pair-complete/index.ts` **does** now type-check clean under the repo's
  `strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` settings;
  it has still never been executed, and the supabase-js response shapes it reads
  (`generateLink().data.properties.hashed_token`, `verifyOtp().data.session`)
  come from the documented v2 API rather than from a run.

### 6.5 `FORCE` on `storage.objects` and `realtime.messages` — attempted, not applied

Migration `…090300` states the wall over two tables this repository does not own.
`FORCE` would remove the **owner's** exemption from those policies, so the
migration attempts it — but **on Supabase it always fails and is not applied**.
That is measured, not inferred: against a live Supabase Postgres 17,
`alter table … force row level security` answers `must be owner of table
objects`. `storage.objects` is owned by `supabase_storage_admin` and
`realtime.messages` by `supabase_realtime_admin`, the migration role is a member
of neither, and no hosted project issues those two passwords. The file's header
used to guess that the migration role was a member of both; running it is what
corrected that.

What **is** applied is everything that carries the wall. `create policy`
succeeds for a sufficiently privileged non-owner, so the owner policies and the
restrictive live-session gate on both tables are real, and RLS is already enabled
on them by the platform. The two `alter table … force` statements are wrapped one
per block — a single block would roll `enable` back when `force` threw — and each
raises a warning naming the owner instead of aborting the deploy.

`00_rls_enabled.test.sql` therefore asserts the honest invariant: **FORCED, or
owned by a role no Nexus identity is a member of.** The day a platform change
reassigns either table to `postgres`, the gate goes red and `force` becomes both
possible and mandatory.

### 6.6 The master-key mint — built; what still is not

`public.nexus_mk_mint` (migration 011) and the `sync-enable` Edge Function are
the server end of it, covered by `05_mk_mint.test.sql` (19 pgTAP assertions,
each of its seven guards proved by removing that guard and watching one named
assertion go red) and by `tests/live/sync-enable.test.mjs`, which runs the real
thing against real GoTrue sessions.

**The desktop client half exists as well**, which this paragraph denied for
months: `apps/desktop/src/main/sync/enable.ts` derives `K_auth` and `K_wrap` in
two separate Argon2id runs, walks the five-step order `sync-enable`'s own header
derives, and stores nothing, because storage is a database concern and that file
has no database in it. What stands between this and a syncing account is the
switch rather than a missing half: cloud is off by default on the desktop, and
the web surface that issues a pairing code is on hold.

The three decisions below are recorded because they are the kind that get quietly
reversed by someone making the honest path smoother.

**It cannot be adopted.** A device that races to mint and loses does **not**
fetch the existing `mk_under_kwrap` and open it. Opening under `K_wrap` proves
knowledge of the password and says nothing about who *chose* the key — and in a
design whose whole premise is that the password is phishable, that cannot be the
provenance test for the root of the hierarchy. The concrete attack it stops:
someone holding the password mints first, the owner's real desktop adopts, and
from that instant the owner seals everything under a key the attacker generated,
with nothing anywhere reporting an anomaly. So „already minted" is terminal for a
device that did not win, and the two ways to an existing MK are pairing with a
device that holds it and the Recovery Kit code — both proofs a password thief
does not have. It costs the honest user nothing: the honest loser is their own
second machine, which was going to pair anyway.

**`commit_tag` is not an MK fingerprint and must never be used as one.**
`wrap.ts` derives it as `HKDF(KEK, COMMIT_LABEL ‖ AAD)` — the KEK and the AAD,
not the wrapped key. Two *different* master keys, wrapped under the same `K_wrap`
for the same user, produce byte-identical tags. The obvious idempotency check —
„is the stored tag the one my MK would produce?" — therefore returns *yes* for
the attacker's key, silently, in the attacker's favour. Win and loss are read
from the `devices` row instead: the winner's transaction wrote one, the loser's
rolled back, and `key_wraps_desktop_only` then makes the wrap readable to exactly
one of them.

**The mint session is not the sync session.** The mint requires `aal2`, which is
worth having for an account that already armed a factor (see §3) and buys nothing
for one that has not. But `aal` survives refresh, so a desktop that stepped up
once would be `aal2` for the life of that session — and `devices_live_session`
hands an `aal2` session read and write over *every* device row on the account,
while `pairing_insert_requires_aal2` lets it act as a pairing initiator. Both are
browser powers. So the desktop signs in twice: an ephemeral `aal2` session
authorises the mint and is then signed out, and a separate `aal1` session is the
one written into `devices.session_id` and used forever after. That keeps „a
desktop's working session is `aal1`" true, which two other files rest on.

**And the sign-in order is forced by the platform, not chosen.** Measured against
this GoTrue and pinned by the live suite: verifying an MFA factor **revokes every
other session the account holds**. The stepped-up session survives, and so does
anything signed in afterwards. So the only order that works is step up first,
sign in for the device session second, call the endpoint, sign the authorising
session out. Backwards, the desktop destroys its own device session at the
step-up and the endpoint answers `401` — a message that says nothing about why.

Also as built: the RPC takes **session ids, never a `user_id`** — under
`service_role` there is no `auth.uid()` to disagree with a parameter, so a
caller naming somebody else's uuid would be minting on their account; it is
`security invoker` (`03_catalog_surface` asserts no `SECURITY DEFINER` routine
exists, and `service_role` already carries BYPASSRLS and the grants); the wraps
are written **before** the device row, for the reason `pair-complete` gives at
its own device insert; 23505 propagates rather than being caught, so a partial
mint cannot commit; and the Edge Function **refuses any request carrying an
`Origin` header**, because the only honest caller is the Electron main process
and it sends none — which shuts out the whole class of „a page the user happened
to visit" without depending on preflight semantics.

Two things this does **not** answer, both recorded in `docs/STATUS.md`:

- **A mint notification the owner can act on.** On a brand-new account nothing
  distinguishes the owner from someone holding the password, so the only
  remaining asymmetry is the mailbox, and using it needs SMTP that does not
  exist yet.
- **What a desktop does when its session is revoked under it.** The step-up
  revocation above is not confined to one machine: enabling sync from a *second*
  desktop revokes the first one's session, and a `devices` row is bound to a
  `session_id`. The row survives, the session does not, and the desktop's next
  sign-in produces a different `session_id` that no longer matches its row — so
  it fails `nexus_session_is_live` and reads nothing. Re-binding a device row to
  a fresh session is device lifecycle and is unbuilt; nothing here is wrong, but
  a desktop cannot currently recover from this on its own.

### 6.7 Considered and deliberately left alone

- **`pairing.burned_at` can be cleared by an account session.** Burning on the
  first AEAD failure is what keeps a ~65-bit code out of reach of online
  guessing, and un-burning would defeat it — but the guesser in that threat model
  is unauthenticated and holds no session on the account, and the only party that
  *can* clear it (the database's operator) can rewrite the row directly and needs
  no help. A fourth guard trigger here would buy symmetry, not security.
- **`sync_objects.parent_id` is outside the AEAD associated data** and is
  rewritable by the server at will. It is a batching hint; the client re-derives
  the tree from plaintext only it can read, and must never trust this column.
- **A hostile server can suppress rows** — withhold them from a pull, or lower a
  `seq` below a device's watermark. Nothing short of a signed, append-only log
  detects that, and it is not in this design. `sync_state.last_seq` is therefore
  a floor the client raises, never a value it trusts.
