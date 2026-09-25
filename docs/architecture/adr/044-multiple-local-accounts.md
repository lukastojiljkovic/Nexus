# ADR-044 — Multiple local accounts on one device (AUTH-006)

**Status:** accepted · 2026-07-30 · **no db migration** (the change is filesystem
layout + auth flow; every SQLite file keeps its own schema/version)
**Drives:** AUTH-006 (PRD 06, ADR-018's recorded "explicitly not in v1"): one
data key encrypts one database file, so a second account is a second file plus
an account picker in front of the lock screen. Profiles stay what they are —
rows INSIDE one account.

## Decision

### 1. Layout: one directory per account

`<userData>/accounts/<accountId>/` holds everything that is one account's:
`keychain.json`, `nexus.db` (+`-wal`/`-shm`, +`.pre-encryption` during the
ladder), `blobs/`, `attachments/`, `tmp-open/`. This is the small change by
construction: `auth.ts` and `attachments.ts` already take the directory as an
argument and never resolve `userData` themselves — only `main/index.ts`'s
handful of path builders learn `activeAccountDir()`. The one startup-time
consumer, `registerBlobProtocol`, becomes **path-lazy** exactly the way it is
already key-lazy: it closes over a live `() => blobStorePathsFor()` instead of
a baked path, so registration stays a boot-time, pre-selection act.

### 2. A plaintext registry, and the label privacy decision

`<userData>/accounts.json`: `{ version: 1, accounts: [{ id, label,
createdAt }], lastActiveId }`, written with the keychain's own
atomic-temp-then-rename discipline. The picker must show something while
everything is encrypted, and today no readable name exists outside the locked
database — so the **label is a new, user-chosen field at account creation**
("Ime naloga", before the passcode step), stored in plaintext BY DESIGN and
said so in the UI copy: it is the one string the lock screen shows, the user
picks it knowing that, and the profile name inside stays as private as it is
today. Labels are renameable from the picker (no unlock needed — it is
presentation, not authorization). `id` is a uuid and names the directory.

### 3. Migration: move the flat layout in, idempotently

First launch that finds a legacy flat layout (`keychain.json` directly in
`userData`) moves it into a fresh `accounts/<id>/` and registers it with the
label "Moj nalog". Order, chosen so every crash point resumes: create the
directory → move `blobs/` → `attachments/` → `keychain.json` →
the db triplet and any `.pre-encryption` sibling last; the registry entry is
written only after the keychain has moved. Resume rule: a registry entry whose
directory holds a keychain is authoritative; flat leftovers alongside an
existing registry are unfinished-move residue and are moved again (every step
is a same-volume rename — repeatable, never a copy). The rejected alternative
— "the legacy flat layout stays as account zero" — would mean two path schemes
forever, which is the same bug one layout later. `migrateLegacyBlobs`' drain
and the `.pre-encryption` ladder run unchanged afterwards, inside the account
directory they now live in.

### 4. Selection, status, and the seven channels

Main gains one piece of module state, `activeAccountId` (defaulting to
`lastActiveId`, or the sole account), set by a new `auth:select-account`
channel; the seven existing `auth:*` channels keep their payloads and operate
on the selected account — the alternative (an accountId on every payload) puts
a choice the renderer already made onto every call forever. `AuthStatus` gains
`accounts: AccountSummary[]` (id, label, createdAt) and `selectedAccountId`,
and its per-account flags (`state`, `requiresRecovery`, `lockedForMs`,
`keystoreAvailable`) describe the SELECTED account — each account keeps its
own `deviceSecret` in its own guard, so "this account needs recovery on this
device" is naturally per-account. A second new channel,
`auth:create-additional`, is `auth:create` plus the label, callable while
another account exists (today's create refuses that state on purpose).

### 5. The picker, and switching

`AuthGate` gains a **picker screen** ahead of the lock screen whenever more
than one account exists (or via "Drugi nalog" from the unlock form): the
labels, each with its own state line (locked / needs recovery / keystore
unavailable), plus "Dodaj nalog" → the create flow with the label field.
**Switching while unlocked is exactly `performLock()` + select + unlock** —
no concurrent unlocked accounts in v1; every module-level singleton the
recon table names (db handle, data key, blob keys, scheduler, restore/import
slots, focus sessions, compaction timers) stays a singleton, and the lock
teardown already clears each one. Recorded consequences of that choice: a
locked account fires **no** reminders (structurally true today — a locked
session has no stores), and the undo slot does not survive a switch (it
never survived a lock).

### 6. What stays device-global

Theme, accent, auto-lock, shortcuts, week start, note prefs — renderer
`localStorage`, unscoped, deliberately: they are muscle memory of the device
(the ADR-040 reasoning). The two calendar keys already `profileId`-prefixed
stay as they are; profile ids are minted uuids, so cross-account collision is
not a real risk and no re-keying is done. The auto-updater and the `nx-blob:`
scheme registration remain process-global.

## Consequences

- AUTH-024 (passcode on profile switch) remains untouched and later.
- The smoke harness keeps its own `userData` redirect and now exercises the
  migration path for free (its first run is always "no registry, no flat
  layout" → plain create).
- `AppInfo`'s `databasePath` now names the active account's file — the
  Settings "O aplikaciji" panel stays honest with zero extra work.
- Slices: **044-a** — main: registry module (pure, TDD: read/write/validate,
  migration planner with resume), path plumbing, `activeAccountId`, the two
  new channels, per-account status; **044-b** — renderer: picker screen,
  create-with-label, switch action in the sidebar (next to Zaključaj),
  Serbian copy incl. the plaintext-label notice. One lane may take both if
  the report stays reviewable; the seam between them is the wire shape.
