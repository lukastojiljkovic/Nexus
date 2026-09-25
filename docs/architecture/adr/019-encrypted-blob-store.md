# ADR-019 — The encrypted attachment blob store

**Status:** accepted · 2026-07-26.
**Drives:** SEC-DAR-01 (data at rest is encrypted) for the one place it is
currently *not* honoured. Extends **[ADR-014](014-note-attachments.md)** (the
content-addressed blob store) and **[ADR-018](018-local-account-passcode.md)**
(the data key). No PRD requirement is new here — this closes a gap ADR-018
itself recorded.

## Context

ADR-018 encrypted `nexus.db`. It did not encrypt the attachment blob store:
ADR-014 deliberately keeps attachment bytes **out of SQLite**, on disk at
`<userData>/attachments/<sha256[0:2]>/<sha256>`, so the passcode does not reach
them. The result is an app that tells the user their data is locked while a
stolen laptop still yields every image and PDF they ever attached to a note —
the notes themselves stay encrypted, the pictures inside them do not.

Two properties of the current store must survive any fix, because features
depend on them:

- **Content addressing / dedup.** Attaching the same file to five notes writes
  one blob; `refCount(sha256)` drives garbage collection. The database's
  `note_attachments` rows are keyed by that plaintext hash.
- **`nx-blob://<sha256>` reads from the renderer.** Inline images in the editor
  are plain `<img src>` — the protocol handler serves the bytes with a sniffed
  `Content-Type`. The renderer knows only the plaintext hash and must keep
  knowing only that (SEC-EL-02: it names content, never a path).

There is also a subtler leak worth naming, because fixing it is nearly free.
A file *named* by the SHA-256 of its plaintext is an offline **confirmation
oracle**: anyone holding the disk can hash a candidate document and learn
whether this machine stores it, without decrypting anything. Encrypting the
bytes and leaving the names alone would keep that oracle intact.

## Decision

### Keys

The data key is not used directly for file crypto. Two subkeys are derived from
it with HKDF-SHA256, each with its own versioned `info` string:

```
dataKey (ADR-018, 256 bits)
   ├─ HKDF(info="nexus/blob-content/v1") ──► contentKey  (AES-256-GCM)
   └─ HKDF(info="nexus/blob-name/v1")    ──► nameKey     (HMAC-SHA256)
```

HKDF's `salt` is empty: the input keying material is already a uniformly random
256-bit key, which is exactly the case RFC 5869 allows a salt-free extract for.
The `info` strings carry the versioning, so a future container format can
coexist with this one instead of silently reinterpreting old files.

**A passcode change does not re-encrypt anything.** ADR-018 changes only the
*wrap* around the data key; the data key itself never changes for the life of
the account. The same is true of Recovery-Kit regeneration. This falls out of
the existing design and is stated here so nobody later builds a rotation pass
that has nothing to rotate.

### On-disk shape

- Encrypted blobs live under a **new root**, `<userData>/blobs`, keeping the
  same two-character fanout: `<userData>/blobs/<name[0:2]>/<name>`.
- **`name = HMAC-SHA256(nameKey, sha256hex)`**, hex. Deterministic, so dedup
  works exactly as before; unguessable without the key, so the confirmation
  oracle is gone. The name is a main-process detail — it never crosses IPC and
  is never stored in the database.
- Each file is a **`NXB1` container**: 4-byte magic `NXB1`, 12-byte random
  nonce, then AES-256-GCM ciphertext with its 16-byte tag appended. The
  **plaintext hash (hex) is the GCM additional-authenticated-data**, which binds
  a blob to its identity: a file moved or swapped between names fails the tag
  check instead of quietly serving the wrong bytes. An unknown magic is a hard
  error, never a "maybe it's plaintext" guess.
- Writes stay atomic exactly as ADR-014 made them: temp file next to the target,
  then rename. Write-if-absent still applies (by storage name).

Whole-file, single-shot encryption is deliberate: `NOTE_ATTACHMENT_MAX_BYTES`
already caps an attachment at 50 MiB on the IPC channel, and the current code
already reads and writes whole files. Chunked/streaming framing would add
chunk-ordering and truncation questions to buy nothing at this size.

### Migration of existing plaintext blobs

The **existence of `<userData>/attachments`** is the migration-pending signal;
a fresh install never has one, and nothing new is ever written there.

After a successful unlock the main process starts a **background** migration
pass: for each legacy file, read → encrypt → write into `blobs/` under its HMAC
name → `unlink` the plaintext original; when the tree is drained, remove it. It
is idempotent and resumable — a crash mid-pass leaves at most one duplicated
blob, which the next unlock finishes.

It runs in the background rather than blocking the unlock, because the store's
size is unbounded (50 MiB × however many attachments) and an unlock that hangs
for minutes on a large store is a worse failure than a short window of mixed
state. That window is covered by a **dual read**: a blob is looked up in
`blobs/` first, then in the legacy location. Garbage collection deletes from
both. Both fallbacks disappear on their own once the legacy directory is gone,
and they are the *only* places that may still touch a plaintext blob.

### The read path

`registerBlobProtocol` gains a data-key accessor. While locked there is no key
and the handler 404s — which it already does, because its mime lookup goes
through `requireDb()`. Unlocked, it reads the container, decrypts, and serves
the bytes under the same sniffed `Content-Type` + `nosniff` headers as before.
Nothing about the renderer changes: the URL is still `nx-blob://<sha256>`.

### The plaintext escape hatches

Two paths legitimately produce plaintext, because their entire purpose is to
hand a real file to something outside Nexus:

- **`saveAttachmentAs`** writes the decrypted bytes to a path the user picked in
  the native dialog. That is the user exporting their own file; nothing to fix.
- **`openExternally`** copies the decrypted bytes to `<userData>/tmp-open` and
  asks Windows to open them. A plaintext copy must exist on disk for Word or a
  PDF viewer to read it — that is not solvable inside Electron. What *is*
  solvable is its lifetime: `tmp-open` is wiped at startup and on every lock, so
  the copies do not outlive the session that made them. **Residual risk,
  recorded rather than hidden:** a file opened externally is plaintext on disk
  for as long as the session lasts, and a machine that loses power mid-session
  leaves those copies behind until the next launch wipes them.

### What this ADR does not change

No database migration (nothing in SQL moves), no IPC surface change, no
renderer change, no new dependency. The whole change is one new
platform-free core module plus the internals of `main/attachments.ts`.

## Alternatives rejected

- **Move blobs into SQLite** so SQLCipher covers them for free. This is ADR-014
  reversed: 50 MiB BLOB rows bloat the WAL and every backup copy of it, the
  protocol read path becomes a synchronous database read on the main thread for
  every inline image, and dedup/GC turn into row bookkeeping. The reasons
  ADR-014 kept bytes out of the database did not stop being true.
- **Name blobs by the ciphertext hash.** With a fresh random nonce per write,
  the same plaintext encrypts to a different ciphertext every time — dedup dies.
  Deriving the nonce from the content instead (convergent encryption) would
  restore dedup and reintroduce the confirmation oracle it is meant to remove.
- **Encrypt the bytes, keep the plaintext-hash names.** Simpler by one HMAC, and
  it leaves the oracle: an attacker with the disk still learns *which* known
  files the user attached. One HMAC is not a price worth negotiating over.
- **Encrypt lazily, on first read of each blob.** Spreads the cost invisibly and
  leaves plaintext on disk indefinitely for anything the user never opens again
  — the exact files a long-lived store accumulates most of.
- **A separate key for the blob store, wrapped alongside the data key.** More
  keychain surface, another thing to lose, and no threat it defends against that
  the derived `contentKey` does not: anything that reaches the data key reaches
  both.

## Slices

- **019-a — `@nexus/core/auth` blob crypto.** `deriveBlobKeys`,
  `blobStorageName`, `encryptBlob`, `decryptBlob`; WebCrypto only, platform-free
  like the rest of the subpath; unit tests for round-trip, tamper, wrong key,
  wrong AAD, unknown magic, and name determinism.
- **019-b — main-process wiring.** `main/attachments.ts` rewritten onto the
  encrypted store (write, read, GC, external open, save-as), the decrypting
  `nx-blob:` handler, the background migration pass, the `tmp-open` wipe, and a
  smoke rehearsal that proves the legacy→encrypted migration against a real
  run rather than by argument.

## Deliberately not in v1

- **Encrypting file *names* and sizes in the database.** They are already inside
  the encrypted database; only the blob bytes were exposed.
- **Padding blobs to hide their size.** The store leaks the size of each
  attachment (±16 bytes) and how many there are. Size-hiding costs real disk and
  is a step beyond what a local-theft threat model justifies.
- **Carrying blobs in the IMEX archive.** The export is row-shaped today and
  contains no attachment bytes at all; when it grows them, it decrypts through
  the same helpers and inherits DEV-002's open question about the archive's own
  passphrase.
