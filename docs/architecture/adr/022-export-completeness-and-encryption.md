# ADR-022 — Export completeness, the archive's shape, and its passphrase

**Status:** accepted · 2026-07-27
**Drives:** IMEX slice b (export completeness), slice c (encrypted export,
closing DEV-002), slice d (import/restore). Extends ADR-009, which set the
container; supersedes nothing.
**Founder decision recorded here:** the archive's key (see §4).

## Context

The full export (IMEX slice a1, 2026-07-11) has not moved since it shipped,
while NOTE, AUTH, the calendar grids and SRCH all landed after it. The result
is not "a feature we have not written yet": `handleExport` writes an archive
containing **no notes at all** — no text, no folders, no tags, no attachments,
no templates, no version history — and reports a record count computed only
over what it did export, so the archive looks complete. Nexus's own vision
pillar is "your data is yours"; an export that silently drops the largest
module is a broken guarantee, and it is also why import (slice d) cannot be
written first: there would be nothing to round-trip.

Two further facts constrain the shape:

- Attachment blobs are **encrypted at rest** (ADR-019). An export must contain
  the plaintext bytes, or the archive is unreadable without Nexus — the exact
  lock-in ADR-009 exists to prevent.
- The archive can therefore become large (a 50 MB attachment cap, times
  however many). Whatever writes it must stream, and whatever encrypts it must
  encrypt a stream, not a buffer.

## Decision

### 1. What a full export contains

Everything the app stores for a profile that is **not derived**:

| Included | Excluded, and why |
| --- | --- |
| notes (meta + lossless Yjs state), folders, tags, tag links, templates, version history | `search_entries`/`search_fts` — rebuilt by migration 017's triggers and backfill |
| attachment index rows **and** their decrypted bytes | `note_links` — derived from note content on every save |
| tasks, events, tracked documents + renewals | `note_updates` — the pending op log; the merged state is exported instead |
| subjects, exams, decks, cards, review log, plans, blocks, focus sessions | key material of any kind (wraps, salts, the device secret, the Recovery Kit) |
| notifications ledger, settings, feature flags | soft-deleted rows — every gather uses the stores' `listActive` |

Version history is included rather than dropped as a "local convenience":
PRD 14 §8's acceptance criterion is that a round-trip *reproduces the account*,
and a retention-capped history is still the user's. If archive size ever
argues otherwise, the per-module subsets of IMEX-003 are the place to make
that a choice, not a silent omission here.

### 2. Container layout (extending ADR-009's)

```text
export.nexus.zip
├── manifest.json                  # + a "notes" module entry and a blob inventory
├── data/<module>.ndjson           # + data/notes.ndjson (type-discriminated, as the others)
├── data/notes/<noteId>.ydoc       # lossless merged Yjs state, one file per note
├── data/note-versions/<noteId>/<coveredSeq>.ydoc
├── notes/<folder path>/<title>.md # the human-readable mirror ADR-009 mandates
├── tables/<name>.csv              # unchanged
└── blobs/<sha256>                 # attachment bytes, DECRYPTED
```

`blobs/` is named by the plaintext SHA-256, which is both the deduplication
key and the checksum — the manifest carries no separate digest for them. The
NDJSON files keep the manifest checksums they already have.

### 3. The Markdown mirror

"Usable without us" is the point, so the mirror is real Markdown, not the
plaintext blob SRCH indexes: headings, both list kinds, task lists as
`- [ ]`/`- [x]`, blockquotes, fenced code, thematic breaks, and the four marks
(`**`, `*`, `` ` ``, `[text](href)`). A wiki-link renders as `[[label]]` — the
same syntax that authored it. An attachment image renders as
`![fileName](<prefix>blobs/<sha256>)`, where the prefix is `../` per directory
level of the file's own path, so the link resolves against the archive's blob
directory from however deep the note's folder nests.

The mirror carries **no title heading**: a note's title is not a separate
field the user maintains, it is derived (`NoteEditor.deriveTitle`) from the
first non-empty top-level block, so the body already opens with it. The file
name is where the title lives.

File names come from user text and are therefore hostile input: the writer
strips path separators, Windows-illegal characters and control characters,
refuses `.`/`..` and the reserved device names, caps length, and resolves
collisions **case-insensitively** (extraction targets are case-insensitive
filesystems) with a numeric suffix. Folder names are not unique among siblings
in the database, so directories need the same treatment as files, in one
shared namespace per directory. A note whose title is empty lands under the
same "Bez naslova" the UI shows.

### 4. The archive's passphrase (founder decision, 2026-07-27)

An export must open on a machine that has no Nexus account, so it cannot be
under the local data key, and it must not be under the Recovery Kit either
(that key exists to unwrap the data key; regenerating the Kit would silently
strand every old archive). The founder chose a **passphrase typed at export
time**: Argon2id over the passphrase with a fresh random salt, both the salt
and the KDF parameters written into the archive's own header, using the same
`@nexus/core/auth` machinery AUTH already ships. Plaintext export survives as
an explicit, confirmed choice (PRD 14 §3), never as the default.

Consequence to accept honestly: a lost passphrase is an unrecoverable archive.
That is the price of an archive that belongs to the user rather than to this
installation.

### 5. The encrypted container (`NXA1`)

An encrypted archive is **not a zip**. It is a Nexus container whose payload is
the same zip stream the plaintext export writes, sealed in frames:

```text
magic          4 bytes    ASCII "NXA1"
headerLength   4 bytes    uint32 big-endian
headerJson     N bytes    UTF-8 JSON, CLEARTEXT
frames         repeated, in order, at least one:
  framePrefix  4 bytes    uint32 BE — bit 31 = FINAL, bits 0..30 = body length
  frameBody    L bytes    AES-256-GCM ciphertext, 16-byte tag appended
```

`headerJson` carries `format`, `version`, `cipher`, the Argon2id `kdf`
parameters, the base64 `salt` (16 bytes) and `noncePrefix` (8 bytes), and
`chunkBytes`. It is cleartext because a reader must repeat the key derivation
before it can authenticate anything.

Each frame's nonce is `noncePrefix ‖ frameIndex` (8 + 4 bytes). The salt is
fresh per export, so the key is unique per archive; the random prefix on top of
a counter means a nonce cannot repeat even if a key were ever reused.

The AAD is where the format earns its keep — 37 bytes of
`sha256(headerJson) ‖ frameIndex ‖ finalFlag`. Framed AEAD is otherwise
**truncation-friendly**: lop off the trailing frames and every surviving frame
still authenticates perfectly. Binding the flag means a truncated archive has no
authenticating final frame and the reader refuses; binding the index kills
reordering; binding the header hash kills both splicing frames between archives
and editing the cleartext header (e.g. weakening the declared KDF parameters).
There is always exactly one final frame — an empty payload still writes one, so
the truncation check is unconditional and the header is bound even then.

The parser is a hostile-input boundary and bounds the declared KDF parameters
(memory 8 MiB–1 GiB, t ≤ 16, p ≤ 8) **before** deriving: a reader has to run the
KDF the *file* asks for, so an unbounded `memoryKiB` would be a
memory-exhaustion attack on whoever opens the archive.

Archive parameters are deliberately heavier than the local passcode's
(128 MiB, t=4 vs 64 MiB, t=3). The passcode's KEK is device-bound — HKDF salted
with an OS-keystore secret — so a stolen database cannot be attacked offline at
all. An archive carries its own salt and travels anywhere, so the work factor is
the *only* defence, and export is a deliberate one-off action where a second of
derivation is affordable.

### 6. Slice order, and why completeness comes before encryption

Completeness first, encryption immediately after. Encrypting a possibly
enormous archive means framed streaming (a single `crypto.subtle.encrypt` over
the whole thing would demand it all in memory), so the encryption layer has to
be designed against the writer that produces the stream. Building that writer
for text-only now and rebuilding it for binary later would mean designing the
same thing twice. DEV-002 stays open and documented for exactly that one
slice — which is what a deviation log is for.

## Consequences

- `buildExportArchive` stays pure and IO-free: it gains the note inputs and
  emits text files plus a **declared inventory** of the binary entries (their
  paths and sources). Main remains the only component that touches the disk,
  the blob store, or the zip stream. Two sources exist, and the distinction is
  the point: Yjs state is bounded and already in memory, so it travels *with*
  its row and is declared as bytes; an attachment blob is up to 50 MB of
  encrypted bytes on disk, so it is declared only as a `sha256` the writer
  resolves and decrypts one at a time. The manifest carries a deduplicated
  `blobs` inventory so an importer knows what to expect without reading NDJSON.
- The interchange gains note row shapes, which per ADR-009 are a public
  contract — changed deliberately, at the weight of a DB migration.
- Import (slice d) inherits an archive that can actually reproduce an account,
  and a manifest that says what is in it.
