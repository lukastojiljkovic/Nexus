# ADR-018 — The local account: passcode, key chain, encryption at rest

**Status:** accepted · 2026-07-26.
**Drives:** AUTH-002/003/004/005 (PRD 06), SEC-DAR-01 (local database encrypted
at rest), SEC-LOC-01/02/04, and the desktop half of **[ADR-004](004-auth.md)**,
whose local-account section this ADR turns into a concrete mechanism. Supersedes
nothing; ADR-004's cloud half stays future work.

**Two founder decisions (2026-07-26) shape everything below:**

1. **Forgotten passcode is recovered with a one-time Recovery Kit code**, not
   with an OS-credential bypass. This *deviates from SEC-LOC-03* and is recorded
   in [deviations.md](../../deviations.md).
2. **The unlock secret is a minimum 8-character alphanumeric passcode**, not
   AUTH-004's "minimum 4 digits". PRD 06's AUTH-004 is amended accordingly.

## Context

Today `nexus.db` is opened with no key at all — the honest state recorded in
`main/index.ts`. `openDatabase` already accepts an optional raw 256-bit key and
maps a bad one to a typed `DatabaseLockedError` (ADR-001), so the storage layer
is ready; nothing above it is.

The threat model for a local, offline account is narrow and worth stating
plainly, because it decides how much machinery is justified:

- **Someone who copies the files** (a stolen laptop, a backup drive, a synced
  folder) must get nothing.
- **Someone at the user's unlocked Windows session** must not read Nexus data
  without the passcode.
- **The user themselves**, having forgotten the passcode, must have exactly one
  documented way back — and it must not be a mechanism the first two attackers
  can also use.

Those three sentences are the whole design.

## Decision

### The key chain

```
passcode ──argon2id(salt, 64 MiB, t=3)──┐
                                        ├─HKDF-SHA256──► KEK_passcode ──AES-256-GCM──► wrapped dataKey
deviceSecret ──(safeStorage/DPAPI)──────┘                                                    │
                                                                                             ▼
recoveryCode (160 random bits) ──argon2id(salt2)──────► KEK_recovery ──AES-256-GCM──► wrapped dataKey
                                                                                             │
                                                                          dataKey (256 bits) ┘
                                                                                             │
                                                                                             ▼
                                                                        SQLCipher raw key for nexus.db
```

- **`dataKey`** — 32 random bytes, generated once, never derived from anything
  and never leaving the main process. Hex-encoded it is exactly the raw key
  `openDatabase` already takes.
- **`deviceSecret`** — 32 random bytes, held in the OS keystore via Electron's
  `safeStorage` (DPAPI on Windows). It is **mixed into the passcode KEK**, not
  offered as an alternative route to the data key. That single choice is what
  makes the file-theft case unbreakable: without the user's Windows account the
  attacker cannot even begin to guess the passcode, because the KEK's HKDF salt
  is unavailable.
- **`KEK_passcode` = HKDF-SHA256(ikm = argon2id(passcode, salt), salt =
  deviceSecret, info = "nexus/passcode-wrap/v1")**.
- **`KEK_recovery` = argon2id(recoveryCode, recoverySalt)** — deliberately
  **not** device-bound. The recovery code is 160 bits of randomness, so an
  offline attack on it is meaningless, and keeping it device-independent is
  what lets the Recovery Kit also serve as the **device-migration path**: copy
  `nexus.db` + `keychain.json` to a new machine, enter the code, set a new
  passcode. ADR-004 assumed IMEX was the only way across devices; this is
  better, and it costs nothing extra.

**Rejected — wrap the data key with the keystore key as a second, independent
route** (ADR-004's literal wording, and what SEC-LOC-03's OS-credential
recovery would require). Electron exposes no way to *prompt* for the Windows
credential, so such a wrap is unwrapped by any code running as that user — the
passcode would then protect only against file theft, and anyone sitting at the
unlocked machine could click past it. That is security theatre with a login
screen on top, and the founder rejected it explicitly.

**Rejected — passcode-only wrapping (no device secret).** An 8-character
passcode is respectable but not 160 bits; binding the KEK to a DPAPI secret
removes offline guessing from the stolen-files case entirely, for one extra
32-byte blob.

### Argon2id via `hash-wasm`, not a native module

Argon2id is mandated by the baseline (SEC-CR). The implementation choice is
constrained by something this repo already suffers from: `better-sqlite3-multiple-ciphers`
is a single-ABI native binary that must be flipped between Node and Electron
builds by a dedicated script. **A second native module would double that
ceremony for every test run, every smoke run, and every release.**

`hash-wasm` ships Argon2id as WebAssembly embedded as base64 inside its own JS —
no `.node` binary, no ABI, no rebuild step, no asset-path problem under
electron-vite, and byte-identical behaviour in Vitest (Node) and in the packaged
app. Parameters: **64 MiB, t=3, p=1, 32-byte output**, the OWASP baseline
configuration, recorded in `keychain.json` so they can be raised later without
locking anyone out.

**Rejected — `argon2` / `@node-rs/argon2`:** faster, but reintroduce the native
build story for a derivation that runs at most a few times per session.
**Rejected — Node's built-in `crypto.scrypt`:** zero dependencies and genuinely
adequate, but the baseline names Argon2id, and a dependency-free KDF is not
worth a signed deviation when a WASM one costs nothing.

### `keychain.json` — everything the app needs *before* it can read anything

Lives beside the database in `userData`, deliberately outside it (the database
cannot hold the key that opens it):

```jsonc
{
  "version": 1,
  "kdf": { "algorithm": "argon2id", "memoryKiB": 65536, "iterations": 3, "parallelism": 1 },
  "passcodeSalt": "<b64 16B>",
  "passcodeWrap": { "nonce": "<b64 12B>", "ciphertext": "<b64 48B>" },
  "recoverySalt": "<b64 16B>",
  "recoveryWrap": { "nonce": "<b64 12B>", "ciphertext": "<b64 48B>" },
  "guard": "<b64: safeStorage.encryptString of {deviceSecret, failedAttempts, lockedUntil})>"
}
```

Only `guard` is secret, and it is OS-encrypted. **The attempt counter lives
inside `guard`, not beside it** (SEC-LOC-02): a counter in plain JSON is reset
with a text editor. Inside the DPAPI blob it is not tamper-proof against the
logged-in user — nothing on the machine is — but it cannot be trivially edited,
which is exactly what the rule asks for.

Throttling: the first 4 failures are free, then escalating waits (5 s, 15 s,
60 s, 5 min, 15 min, capped) recorded as `lockedUntil`. A successful unlock
clears both fields. The wait is enforced in main; the renderer only renders the
remaining time.

### The main process starts **locked**

`db` becomes `NexusDatabase | null`, and `requireDb()` — which already exists —
becomes the single choke point every store factory goes through. A renderer that
calls any data channel before unlocking gets a typed error, not an empty result;
there is no code path where a store is constructed against a database that is
not open. Six new channels, and no others may run while locked:

| Channel | Purpose |
|---|---|
| `auth:status` | `uninitialized` / `locked` / `unlocked`, plus `lockedUntil` and whether the keystore is available |
| `auth:create` | first run: generate the chain, encrypt the database, return the Recovery Kit code **once** |
| `auth:unlock` | passcode → open the database, or a throttled rejection |
| `auth:recover` | recovery code + a **new** passcode (recovering without setting one would lock the user out again next launch) |
| `auth:change-passcode` | current + next; rewraps the data key, never re-encrypts the database |
| `auth:lock` | closes the database and drops the key from memory |

`auth:regenerate-recovery` (unlocked only) completes the set: a Recovery Kit is
useless once the user has lost the paper, and re-wrapping is the same three
lines as creating one.

### Encrypting the database that already exists

Existing installs — the founder's included — hold a plaintext `nexus.db` full of
real data. It is converted **in place** on first passcode creation. Verified by
probe before this ADR was written (SQLite3MultipleCiphers 12.11.1, Node 24):

```
PRAGMA cipher = 'sqlcipher'; PRAGMA rekey = "x'<64 hex>'";
→ rows readable immediately after rekey
→ subsequent plaintext open fails with SQLITE_NOTADB
→ keyed open reads the pre-encryption rows, stays WAL, stays writable
→ wrong key fails with SQLITE_NOTADB
```

The conversion copies `nexus.db` to `nexus.db.pre-encryption` first and deletes
that copy only after the encrypted file has been closed and successfully
reopened with the key. The copy adds no exposure — the file it copies was
already plaintext — and it is the difference between an interrupted rekey being
an inconvenience and being total data loss.

### The smoke run gets its own `userData`

`pnpm --filter @nexus/desktop smoke` currently opens the **developer's real
database**. Once a passcode gates startup that stops being merely untidy: the
smoke run would either have to encrypt a real install with a throwaway passcode
or skip the auth path entirely. So the smoke run switches `userData` to a
dedicated subdirectory, creates its own passcode, and exercises
create → lock → unlock → data channels for real. A deterministic fresh database
each run is a better test than an accumulating personal one anyway.

## Slices

- **018-a — crypto core + keychain (`@nexus/core`, `@nexus/db`, main).**
  Passcode policy, Argon2id/HKDF/AES-GCM wrap-unwrap, the Recovery Kit code
  alphabet and formatting, `openDatabase` rekey support, the keychain file
  reader/writer over `safeStorage`, and the throttle state machine. All TDD.
- **018-b — the locked main process.** `db: … | null`, the `requireDb()` gate,
  the seven channels, first-run creation with in-place encryption, and the smoke
  harness's own `userData`.
- **018-c — the lock screen.** Create-passcode → Recovery-Kit screen → the
  existing onboarding; the unlock screen with throttle copy; recovery entry;
  a "Sigurnost" section in Settings (change passcode, new Recovery Kit) and a
  manual **Zaključaj** action with an idle auto-lock.

## Explicitly not in v1

- **Multiple local accounts on one device** (AUTH-006, S-tier). One data key
  encrypts one database file; a second account means a second file and an
  account picker before the lock screen. The personal/business split stays what
  it already is — profiles *inside* the one account.
- **Per-profile re-authentication on profile switch** (AUTH-024). There is no
  business-profile creation UI yet, so there is nothing to guard; it lands with
  that work.
- **Windows Hello / biometric unlock.** Needs a native module Electron does not
  provide; recorded in PRD 06 §10 as a future extension already.
- **Encrypting the attachment blob store.** `<userData>/attachments` holds
  content-addressed files that are *not* covered by the database's encryption.
  This is a real, honest gap in SEC-DAR-01 and it is deliberately its own piece
  of work (the blob store predates this ADR and has its own streaming/preview
  path); recorded in STATUS §4.

## Consequences

- Startup gains a blocking screen: no data, no windows into data, until the
  passcode is entered. That is the point, but it makes `auth:status` the first
  thing the renderer asks about — before profiles, before flags.
- Forgetting the passcode **and** losing the Recovery Kit means the data is
  gone. There is no back door, by decision. The create flow therefore has to
  treat the Recovery Kit screen as a step to be completed, not a toast to be
  dismissed.
- Moving to a new machine now has a documented, supported path (files +
  recovery code), independent of IMEX export.
- Argon2id at 64 MiB costs a fraction of a second per unlock, once per session —
  and deliberately so; it is the only thing standing between a stolen laptop and
  an 8-character passcode.
- The database is encrypted; the attachment blobs are not, until that follow-up
  lands. Stating it here so it cannot be mistaken for an oversight.
