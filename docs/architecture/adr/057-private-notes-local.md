# ADR-057 — Private notes, local-first (PRIV v1; supersedes ADR-005's primitives; migration 045, interchange 1.23.0)

> Version note (2026-07-31): interchange renumbered 1.22.0 → **1.23.0** at
> dispatch — ADR-058's manifest `kind` (a one-field bump) ships first as part
> of the business-profile slice a, taking 1.22.0; PRIV's interchange slice (d)
> is the last of its four slices. §6's numbers below are updated.

**Status:** accepted (2026-07-31) · **Owner:** supervisor · **Implements:**
PRIV PRD (10) for the current no-cloud reality, per the founder's batch
answer 5: build it now, and build it so the SAME design works offline today
and on the web app later. **Supersedes ADR-005's library/AEAD choice; keeps
its key model.** Grounded in the 2026-07-31 terrain recon (48-item hazard
inventory — the checklist for every slice below).

## 1. What supersedes what

ADR-005 chose libsodium + XChaCha20-Poly1305 before any crypto existed in the
repo. Since then ADR-018/019/022 shipped a PROVEN in-house layer — WebCrypto
AES-256-GCM + `hash-wasm` Argon2id + HKDF with versioned `info` strings and
AAD-bound containers (`keyChain.ts`, `blobCrypto.ts`, `archiveContainer.ts`)
— deliberately `globalThis.crypto`-only: no `node:*`, no Buffer, runs
unchanged in a browser. That IS the web-portability the founder asked for,
already paid for. Adding libsodium now would be a new WASM dependency (against
house posture) duplicating a tested layer. **PRIV uses the shipped
primitives.** ADR-005's key MODEL survives intact: a random DEK, wrapped
twice (passphrase KEK + Recovery Kit KEK), everything at rest ciphertext,
unlocked keys in memory only. Its sync sections stay future work with the
rest of the cloud.

## 2. The structural decision: sealed rows, not a flag

The recon's central finding: the search index is TRIGGER-maintained precisely
so application code cannot forget it — which inverts for privacy: a
`notes.is_private` flag would be silently bypassed by the very machinery that
makes normal notes reliable (hazards 13–17), and would still leave plaintext
in eight other tables (hazards 1–12).

So private notes NEVER enter `notes`/`note_updates`/`note_snapshots`/
`note_versions`/FTS at all. **Migration 045** creates:

```sql
CREATE TABLE private_notes (
  id         TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  sealed     BLOB NOT NULL,          -- NXP1 container (see §4)
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE private_note_versions (
  note_id    TEXT NOT NULL REFERENCES private_notes(id) ON DELETE CASCADE,
  seq        INTEGER NOT NULL,
  sealed     BLOB NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (note_id, seq)
);
CREATE TABLE private_settings (      -- singleton per profile
  profile_id     TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  kdf            TEXT NOT NULL,      -- JSON KDF params (versioned)
  pass_salt      TEXT NOT NULL,
  pass_wrap      TEXT NOT NULL,      -- DEK wrapped under KEK_pass
  kit_salt       TEXT NULL,
  kit_wrap       TEXT NULL,          -- DEK wrapped under KEK_kit (null = informed opt-out)
  uses_account_passcode INTEGER NOT NULL, -- which credential KEK_pass derives from
  auto_lock_minutes INTEGER NOT NULL DEFAULT 5,
  lock_on_minimize  INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

Cleartext metadata is ids and timestamps only — needed for ordering, GC and
the future sync's version vectors. Titles never. No soft delete: deleting a
private note is a hard delete after the house typed-confirm (an undo bar
holding sealed bytes whose key may re-lock mid-undo is a promise we cannot
keep; stated in copy). This one move disposes of hazards 1–8, 13–17, 33–35
and 39 for private content.

## 3. Keys

- **PRIV DEK**: random 32 bytes per profile, minted at section setup.
- **KEK_pass**: PRD §3's default — the ACCOUNT passcode (one secret to
  remember; the section still re-asks it at entry, which is the actual gate
  against the person holding the unlocked app) — or a SEPARATE passphrase
  (PRIV-011) chosen at setup; `uses_account_passcode` records which. Own
  salt, own HKDF info (`nexus/priv-wrap/v1`), device-secret mixed exactly as
  SEC-LOC-01 does for the data key. A second device (web, later) gets its own
  wrap at enrollment — the PRD §7 re-wrap protocol, noted not built.
- **KEK_kit**: the EXISTING account Recovery Kit code, not a second code —
  two codes to lose is worse UX for zero gain; the kit's Argon2id runs over
  its own `kit_salt` + info (`nexus/priv-kit/v1`) so the wraps stay
  independent. Setup offers verified-save/regenerate of the kit (PRIV-002) or
  the informed opt-out (kit_wrap NULL) with the honest dead-end copy.
  Regenerating the kit re-wraps BOTH the data key and the PRIV DEK in one
  act (`regenerateRecoveryCode` grows a second wrap — one code, one truth).
- **Runtime**: the unwrapped DEK lives in main module scope beside
  `unlockedDataKeyHex`, nulled by `privLock()` — which fires on its own
  5-minute idle timer (per-section, PRD default), on lock-on-minimize, on the
  panic shortcut, on manual lock, and unconditionally inside `performLock()`
  (app lock ⇒ PRIV lock). Wrong-attempt throttling reuses the
  `unlockThrottle` escalating-delay shape in memory — no permanent lockout
  (PRD §7).

## 4. The sealed envelope (NXP1)

One note = one `NXP1` container (the `NXB1` template: magic + nonce +
AES-256-GCM), key = HKDF(DEK, `nexus/priv-note/v1`), **AAD = note id +
version seq** (ADR-005's anti-splice requirement, SEC-CR-04 — a sealed blob
cannot be swapped between rows or rolled back undetected). Plaintext inside:
one CBOR-ish JSON envelope `{ title, yjsState (base64), plaintext }` — the
same three artifacts the public pipeline keeps, sealed together so they
cannot drift.

**Writes are whole-envelope on the editor's existing debounce** — no
append-only update log for private notes. The log exists publicly to make
concurrent merge and healing cheap; privately it would be a plaintext trail
(hazard 2) requiring per-update sealing for no v1 benefit (single device, no
sync). Yjs still runs INSIDE the editor session (undo, blocks all work);
`healNotes` never touches these tables by construction. Versions: every Nth
save / on close, a sealed checkpoint row, capped at 20 (below the public 50 —
each is a full envelope; recorded).

**Attachments (v1: images and files up to the decided 100 MB)** go to a
SEPARATE `private-blobs/` directory: content key HKDF(DEK,
`nexus/priv-blob/v1`), file name = random id — deliberately NOT
content-addressed and NOT deduped, because dedup is an existence oracle
across trust boundaries (hazards 27–28). The attachment list lives inside the
note's envelope, not in a table. `nx-blob:` never serves them; a dedicated
`priv-blob:` handler streams decrypts only while unlocked. OS-indexer
exclusion (hazard 32): the directory gets the same treatment as
`attachments/` — ciphertext on disk is already unindexable content; no
plaintext temp copies are ever written for private attachments
(open-externally is NOT offered inside PRIV v1; recorded, PRD §7 sandbox
line).

## 5. The section, in the app

- **Nav**: „Privatno" enters the module registry behind the standard module
  flag, OFF by default; first open runs setup (PRIV-002). Locked state
  renders the lock screen and NOTHING else (PRIV-004): no titles anywhere,
  no widget, no palette hits, no notification content (notifications carry
  none today — hazard 45's "keep clean" contract, now pinned by a test).
- **Editor reuse**: the NOTE editor component with a private storage adapter
  (PRD §6 said exactly this); wiki-link menu inside PRIV lists private notes
  only; public notes cannot link IN (private notes are not in their menu),
  private notes may link OUT (a title of a public note is not a secret).
- **In-section search** (PRIV-006): an in-memory index over decrypted
  envelopes built at unlock, using the SAME core folding functions the FTS
  uses (one grammar, SEC-ZK-05), discarded at lock.
- **Move in / move out** (PRIV-009): explicit typed-confirm both ways, copy
  stating consequences. IN: seal a copy → hard-delete the public note through
  a path that also detaches note-derived cards (the AK-dialog rule), removes
  versions/updates/FTS rows, moves attachment bytes and decrements shared-blob
  refcounts — then `rebuildSearchIndex()` runs once to scrub FTS token residue
  (hazard 8; the action is rare, the rebuild is honest). Checklist-forked
  tasks REMAIN and the dialog says so (they were copies by design). OUT:
  decrypt → create a normal note via the normal create path (triggers index
  it) → destroy sealed rows.
- **Clipboard guard** (PRIV-012): copying inside PRIV offers the 30 s
  auto-clear; renderer-side, best-effort, honestly labeled.

## 6. IMEX

- **Archive export**: private notes ride ONLY while the section is unlocked
  AND the export is encrypted (NXA1): new era-gated record types
  `private-note` / `private-note-version` carrying the DECRYPTED envelope —
  the archive's own
  passphrase is the protection, same trust as everything else in it, and a
  sealed-forever export would be unreadable after a kit regeneration.
  (record types land at interchange **1.23.0**; too-new fixtures → 1.24.0.)
  Locked section or PLAINTEXT export ⇒ private notes are EXCLUDED with a
  named skip line („Privatne beleške se ne izvoze…" — reason stated). Their
  markdown mirrors live under `notes-private/<id>.md` — the ID, never the
  title, as the path segment (hazard 20 dies even inside the container).
- **Restore**: restoring an archive that carries private notes requires the
  target's PRIV set up and unlocked (re-seal under the CURRENT DEK) — else
  the named skip. **Foreign import: never** (posture line, named skip).
  `gatherProfileData`/undo snapshot carry the SEALED rows verbatim (undo of
  an import must not need the DEK).

## 7. Slices

- **a (core)**: `packages/core/src/priv/` — DEK/wrap chain (reusing
  `keyChain` exports), NXP1 seal/unseal with AAD, envelope codec, in-memory
  index build. Pure, WebCrypto-only, TDD. Kit second-wrap extension in
  `recoveryCode`/`keyChain` seams.
- **b (db+main)**: migration 045, `PrivateNoteStore` (+settings), channels
  (`priv:*` — setup/unlock/lock/status/list/read/write/delete/move-in/
  move-out), lock lifecycle wiring into `performLock`, panic shortcut.
- **c (renderer)**: setup + lock screens, section page with editor adapter,
  in-section search, move dialogs, settings block (timeout, minimize,
  clipboard, kit status), Serbian copy.
- **d (imex)**: interchange 1.23.0 records, export/restore/foreign-import
  postures, named skips, era flag.

## 8. Recorded limits (v1)

No sync (with the cloud), no sharing, no STUDY export (PRIV-005's own
exception), no canvas, no decoy mode (PRIV-014's recorded non-decision), no
open-externally inside PRIV, versions capped at 20, one PRIV space per
profile. Web parity ships when the web app does — the crypto already runs
there; what the web build adds is the served-code trust caveat, documented
then (decision #11).
