import { createHash, randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import type { BrowserWindow, OpenDialogOptions } from "electron";
import { dialog, protocol, shell } from "electron";
import { blobStorageName, decryptBlob, encryptBlob, type BlobKeys } from "@nexus/core/auth";
import type { SaveAttachmentResult } from "../shared/ipc.js";

/**
 * The content-addressed attachment blob store and its `nx-blob:` read protocol
 * (ADR-014 / NOTE-003, slice 003-a; encrypted at rest per ADR-019, slice
 * 019-b). ONE store, shared by every module that lets a user hang a file off a
 * record — notes (`note_attachments`) and tasks (`task_attachments`, migration
 * 024) alike — because a blob is nothing but its bytes: two records holding
 * byte-identical files are one file on disk whichever tables name them. Nothing
 * in this module knows which table a hash came from, which is exactly why
 * `index.ts` must SUM every such table's reference count before handing one to
 * `deleteBlobIfOrphaned`.
 *
 * Mirrors `main/imex.ts`'s deps-injection style: every function takes the
 * directories, keys, and window it needs as explicit parameters — nothing here
 * reads `app` itself — so `index.ts` is the only place that resolves real paths
 * (`app.getPath("userData")`) and derives `BlobKeys` from the unlocked data
 * key.
 *
 * Two stores coexist while a legacy install migrates: `<userData>/blobs`,
 * the only place anything is ever written, holds each blob as an `NXB1`
 * AES-256-GCM container named by an HMAC of its plaintext SHA-256 (so
 * dedup — one file attached five times is still one file on disk — survives
 * without a plaintext-hash file name being an offline confirmation oracle);
 * `<userData>/attachments` is the legacy plaintext store, read-only from
 * here on and drained in the background by `migrateLegacyBlobs`. The two are
 * told apart by directory, never by sniffing a file's bytes — a foreign
 * magic byte is corruption, not a signal. `NoteAttachmentStore` and
 * `TaskAttachmentStore` own the index rows and always speak plaintext SHA-256;
 * this module owns only the bytes and never touches SQL.
 */

/** The two roots the store spans while a legacy install is still being migrated. */
export interface BlobStorePaths {
  /** `<userData>/blobs` — the encrypted store; the only place anything is ever written. */
  readonly dir: string;
  /** `<userData>/attachments` — the legacy plaintext store, read-only and drained by `migrateLegacyBlobs`. */
  readonly legacyDir: string;
}

export function blobStorePaths(userDataPath: string): BlobStorePaths {
  return {
    dir: join(userDataPath, "blobs"),
    legacyDir: join(userDataPath, "attachments"),
  };
}

/** The on-disk path for a storage name (an HMAC, never the plaintext hash), fanned out by its first two hex characters. */
function encryptedBlobPath(dir: string, storageName: string): string {
  return join(dir, storageName.slice(0, 2), storageName);
}

/** The legacy store's on-disk path — still fanned out by the plaintext SHA-256 itself, exactly as the pre-ADR-019 store laid it out. */
function legacyBlobPath(legacyDir: string, sha256: string): string {
  return join(legacyDir, sha256.slice(0, 2), sha256);
}

/**
 * Hashes `bytes` and writes them to the encrypted store's content-addressed
 * path if not already present (write-if-absent — a re-attach of identical
 * content, or a re-run of `migrateLegacyBlobs` over the same file, is a cheap
 * no-op). The write itself is atomic: a random-suffixed temp file next to the
 * final path, then an OS-level rename, so a crash mid-write can never leave a
 * half-written blob at the real path. Never writes to `paths.legacyDir`.
 *
 * `created` is false on the write-if-absent early return and true only when
 * this call actually encrypted and wrote the blob — a restore (`main/restore.ts`,
 * ADR-023) needs to know precisely which blobs IT introduced, since undo may
 * only ever remove those, never one that merely already existed.
 */
export async function saveBlob(
  paths: BlobStorePaths,
  keys: BlobKeys,
  bytes: Uint8Array,
): Promise<{ sha256: string; created: boolean }> {
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const storageName = await blobStorageName(keys.nameKey, sha256);
  const path = encryptedBlobPath(paths.dir, storageName);

  const alreadyPresent = await stat(path).then(
    () => true,
    () => false,
  );
  if (alreadyPresent) return { sha256, created: false };

  const container = await encryptBlob(keys.contentKey, bytes, sha256);
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.tmp-${randomBytes(8).toString("hex")}`;
  await writeFile(tempPath, container);
  await rename(tempPath, path);
  return { sha256, created: true };
}

async function readLegacyBlob(legacyDir: string, sha256: string): Promise<Uint8Array | null> {
  try {
    return await readFile(legacyBlobPath(legacyDir, sha256));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/**
 * Returns the plaintext bytes for a hash, or `null` when nothing holds them
 * in either store. Tries the encrypted store first; only an `ENOENT` there
 * falls back to the legacy plaintext store (the dual-read window that keeps
 * old attachments viewable while `migrateLegacyBlobs` drains them in the
 * background).
 *
 * A `BlobDecryptError` out of `decryptBlob` is deliberately NOT treated as a
 * miss — it is left to propagate. Falling through to the legacy store (or to
 * `null`) on a failed authentication would quietly hide real tampering or a
 * key mismatch behind what looks like an ordinary cache miss.
 */
export async function readBlob(
  paths: BlobStorePaths,
  keys: BlobKeys,
  sha256: string,
): Promise<Uint8Array | null> {
  const storageName = await blobStorageName(keys.nameKey, sha256);
  const encryptedPath = encryptedBlobPath(paths.dir, storageName);

  let container: Uint8Array;
  try {
    container = await readFile(encryptedPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return readLegacyBlob(paths.legacyDir, sha256);
  }

  return decryptBlob(keys.contentKey, container, sha256);
}

async function unlinkIfPresent(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

/**
 * Deletes a hash's blob once nothing references it anymore (`refCount === 0`);
 * a missing file is not an error — GC is idempotent. Unlinks both the
 * encrypted path and the legacy path (each ENOENT-tolerant on its own), so a
 * blob deleted mid-migration cannot survive in whichever store the caller's
 * `refCount` check did not have in mind.
 */
export async function deleteBlobIfOrphaned(
  paths: BlobStorePaths,
  keys: BlobKeys,
  sha256: string,
  refCount: number,
): Promise<void> {
  if (refCount !== 0) return;
  const storageName = await blobStorageName(keys.nameKey, sha256);
  await unlinkIfPresent(encryptedBlobPath(paths.dir, storageName));
  await unlinkIfPresent(legacyBlobPath(paths.legacyDir, sha256));
}

const MAX_SANITIZED_NAME_LENGTH = 200;
const FALLBACK_FILE_NAME = "prilog";

/** True for a path separator or an ASCII control character (codes below 0x20, or DEL at 0x7f) — never allowed verbatim in a filesystem name we construct. */
function isUnsafeFileNameChar(ch: string): boolean {
  if (ch === "/" || ch === "\\") return true;
  const code = ch.charCodeAt(0);
  return code < 0x20 || code === 0x7f;
}

/**
 * Strips path separators and control characters from a display file name
 * (collapsing consecutive unsafe characters into a single `_`), caps the
 * total length at 200 characters while preserving the final extension, and
 * never returns an empty string — a name that sanitizes away to nothing falls
 * back to `"prilog"`. Used for both `openExternally`'s temp copy and
 * `saveAttachmentAs`'s dialog default path; the renderer's `fileName` is
 * display-only and untrusted (SEC-EL-02), so nothing derived from it ever
 * reaches the filesystem unsanitized.
 */
export function sanitizeFileName(name: string): string {
  let collapsed = "";
  let lastWasUnderscore = false;
  for (const ch of name) {
    if (isUnsafeFileNameChar(ch)) {
      if (!lastWasUnderscore) collapsed += "_";
      lastWasUnderscore = true;
    } else {
      collapsed += ch;
      lastWasUnderscore = false;
    }
  }

  const cleaned = collapsed.trim();
  if (cleaned.length === 0 || cleaned === "_") return FALLBACK_FILE_NAME;
  // "." / ".." survive the character filter but name a directory, not a file —
  // join(tempDir, "..") would resolve to the parent and the copy would fail.
  if (cleaned === "." || cleaned === "..") return FALLBACK_FILE_NAME;
  if (cleaned.length <= MAX_SANITIZED_NAME_LENGTH) return cleaned;

  const ext = extname(cleaned);
  const maxBaseLength = Math.max(MAX_SANITIZED_NAME_LENGTH - ext.length, 0);
  const base = cleaned.slice(0, cleaned.length - ext.length).slice(0, maxBaseLength);
  const truncated = `${base}${ext}`;
  return truncated.length === 0 ? FALLBACK_FILE_NAME : truncated;
}

/**
 * Decrypts an attachment's blob into a main-owned temp file (never the
 * renderer's own path) and opens it with the OS's default handler for its
 * type. `tempDir` is `<userData>/tmp-open`, passed by the caller so this
 * module never resolves `app.getPath` itself. The plaintext copy this leaves
 * behind is an unavoidable cost of handing a real file to the OS shell —
 * `index.ts` is responsible for wiping `tempDir` on lock and at startup so it
 * never outlives the session that made it.
 */
export async function openExternally(
  paths: BlobStorePaths,
  keys: BlobKeys,
  tempDir: string,
  attachment: { fileName: string; sha256: string },
): Promise<void> {
  const bytes = await readBlob(paths, keys, attachment.sha256);
  if (bytes === null) {
    throw new Error(`Attachment "${attachment.fileName}" was not found in the blob store.`);
  }

  await mkdir(tempDir, { recursive: true });
  const destPath = join(tempDir, sanitizeFileName(attachment.fileName));
  await writeFile(destPath, bytes);

  const failure = await shell.openPath(destPath);
  if (failure) {
    throw new Error(`Failed to open attachment: ${failure}`);
  }
}

/** One file the user picked, as main read it: the display name derived from the path here (never a name the renderer supplied) plus the bytes themselves. */
export interface PickedAttachmentFile {
  readonly fileName: string;
  readonly bytes: Uint8Array;
}

/** The outcome of `pickAttachmentFiles`: a canceled dialog, or the files that were read plus a count of the ones refused for size. */
export interface PickedAttachments {
  readonly canceled: boolean;
  readonly files: PickedAttachmentFile[];
  readonly skippedTooLarge: number;
}

/**
 * Opens the native "attach a file" dialog and reads whatever the user chose
 * (TASK attachments, migration 024). The dialog is the ONLY source of a path —
 * the renderer neither supplies one nor ever sees one (SEC-EL) — and the
 * display name is `basename`'d off that path here rather than accepted from
 * anywhere, so a name the store later validates is one main derived itself.
 *
 * The size gate is a `stat` BEFORE the read, deliberately: `maxBytes` is 50 MB
 * and a user can multi-select, so reading first and checking afterwards would
 * pull a file into memory precisely in the case where it must not be. It is
 * re-checked on the bytes actually read, because a file can grow between the
 * two — the store would refuse that row anyway, and this turns a thrown error
 * into the same "too large" the user was already going to be told.
 *
 * A file that fails its stat/read for any other reason, and an EMPTY one (which
 * migration 024's `size_bytes > 0` CHECK forbids, and which has no content to
 * attach), are skipped without a count: one unreadable file must not lose the
 * pick's other, perfectly good ones, and "too large" is the one skip reason the
 * UI has something meaningful to say about.
 *
 * Multi-select is on: attaching three files is one dialog, not three.
 */
export async function pickAttachmentFiles(
  win: BrowserWindow | null,
  maxBytes: number,
): Promise<PickedAttachments> {
  const options: OpenDialogOptions = { properties: ["openFile", "multiSelections"] };
  const { canceled, filePaths } = win
    ? await dialog.showOpenDialog(win, options)
    : await dialog.showOpenDialog(options);
  if (canceled) return { canceled: true, files: [], skippedTooLarge: 0 };

  const files: PickedAttachmentFile[] = [];
  let skippedTooLarge = 0;
  for (const path of filePaths) {
    try {
      const info = await stat(path);
      if (!info.isFile() || info.size === 0) continue;
      if (info.size > maxBytes) {
        skippedTooLarge += 1;
        continue;
      }
      const bytes = await readFile(path);
      if (bytes.byteLength === 0) continue;
      if (bytes.byteLength > maxBytes) {
        skippedTooLarge += 1;
        continue;
      }
      files.push({ fileName: basename(path), bytes });
    } catch {
      // Unreadable (permissions, a file that vanished between the dialog and
      // here): skipped, never fatal — the rest of the pick still lands.
    }
  }
  return { canceled: false, files, skippedTooLarge };
}

/**
 * Decrypts an attachment's blob to a path the user picks via the native save
 * dialog — the only source of the destination path (SEC-EL: the renderer
 * never supplies a filesystem path). Mirrors `handleExport`'s dialog call in
 * `main/imex.ts`.
 */
export async function saveAttachmentAs(
  win: BrowserWindow | null,
  paths: BlobStorePaths,
  keys: BlobKeys,
  attachment: { fileName: string; sha256: string },
): Promise<SaveAttachmentResult> {
  const dialogOptions = { defaultPath: sanitizeFileName(attachment.fileName) };
  const { canceled, filePath } = win
    ? await dialog.showSaveDialog(win, dialogOptions)
    : await dialog.showSaveDialog(dialogOptions);
  if (canceled || !filePath) return { canceled: true };

  const bytes = await readBlob(paths, keys, attachment.sha256);
  if (bytes === null) {
    throw new Error(`Attachment "${attachment.fileName}" was not found in the blob store.`);
  }
  await writeFile(filePath, bytes);
  return { canceled: false, path: filePath };
}

/** A bare plaintext-SHA256 file name — the legacy store's real, unmigrated content. */
const LEGACY_BLOB_NAME_PATTERN = /^[0-9a-f]{64}$/;
/** `saveBlob`'s own temp-write suffix (`randomBytes(8).toString("hex")` is 16 hex characters) — a leftover from a write that never reached its final rename, hence unreferenced garbage by definition. */
const LEGACY_TEMP_SUFFIX_PATTERN = /\.tmp-[0-9a-f]{16}$/;

export interface LegacyMigrationResult {
  /** Blobs moved into the encrypted store. */
  readonly migrated: number;
  /** Files left in place (unrecognized names, or a per-file failure) — non-zero means the legacy directory is deliberately kept for the next attempt. */
  readonly skipped: number;
}

/**
 * Drains `paths.legacyDir` into the encrypted store: walks its two-level
 * fanout, and for each real blob (a bare 64-hex-character name) reads it,
 * encrypts+writes it into the encrypted store under its HMAC name
 * (write-if-absent, via `saveBlob`), and only then unlinks the legacy file —
 * encrypt first, delete second, never the reverse, so a crash between the two
 * steps loses no bytes; it can only leave one blob present in both stores,
 * which the next pass resolves for free (`saveBlob`'s own write-if-absent
 * skips the re-encrypt, and the now-redundant legacy file is unlinked again).
 *
 * A leftover temp-write suffix is deleted outright (never counted). Anything
 * else — and any single file that fails for any reason along the way — is
 * left untouched and counted as `skipped`; a per-file failure must never
 * abort the pass or reject this promise, since this runs unawaited in the
 * background, where an unhandled rejection would crash the process.
 *
 * The legacy directory tree is removed only once a full pass leaves nothing
 * behind (`skipped === 0`) — that is what makes the migration-pending signal
 * (the directory's mere existence) go false. A fresh install with no legacy
 * directory at all costs a single failed `readdir` and returns immediately.
 *
 * `shouldContinue` is checked before every file: this runs unawaited across an
 * unlocked session, and a lock in the middle of it must actually stop the work
 * rather than leave a background task writing with key material the lock was
 * supposed to have dropped — and must not leave a first pass racing the second
 * one a later unlock starts. A cancelled pass never removes the tree, however
 * little it happened to skip; it simply resumes on the next unlock.
 */
export async function migrateLegacyBlobs(
  paths: BlobStorePaths,
  keys: BlobKeys,
  shouldContinue: () => boolean,
): Promise<LegacyMigrationResult> {
  let fanoutNames: string[];
  try {
    fanoutNames = await readdir(paths.legacyDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { migrated: 0, skipped: 0 };
    throw error;
  }

  let migrated = 0;
  let skipped = 0;
  let cancelled = false;

  for (const fanoutName of fanoutNames) {
    if (cancelled) break;
    const fanoutPath = join(paths.legacyDir, fanoutName);
    let entryNames: string[];
    try {
      entryNames = await readdir(fanoutPath);
    } catch {
      // Not the two-character fanout directory the legacy store always wrote
      // — leave it alone rather than guess, and keep the tree around.
      skipped++;
      continue;
    }

    for (const entryName of entryNames) {
      if (!shouldContinue()) {
        cancelled = true;
        break;
      }
      const entryPath = join(fanoutPath, entryName);
      try {
        if (LEGACY_BLOB_NAME_PATTERN.test(entryName)) {
          const bytes = await readFile(entryPath);
          const { sha256 } = await saveBlob(paths, keys, bytes);
          // A file whose content does not hash to its own name is corrupt, and
          // it was just stored under the hash of what it actually holds — a
          // name the database will never ask for. Unlinking it here would take
          // the only copy the index can still name, so it stays put instead and
          // keeps the tree alive as the visible sign that something is wrong.
          if (sha256 !== entryName) {
            skipped++;
            continue;
          }
          await unlink(entryPath);
          migrated++;
        } else if (LEGACY_TEMP_SUFFIX_PATTERN.test(entryName)) {
          await unlink(entryPath);
        } else {
          skipped++;
        }
      } catch {
        skipped++;
      }
    }
  }

  if (!cancelled && skipped === 0) {
    await rm(paths.legacyDir, { recursive: true, force: true });
  }
  return { migrated, skipped };
}

const SHA256_HOST_PATTERN = /^[0-9a-f]{64}$/;

/**
 * Registers the `nx-blob:` read protocol (ADR-014, for slice 003-b's inline
 * previews): the scheme is registered `standard` in `index.ts` before
 * app-ready, so a request's hash arrives lowercased as the URL's host, e.g.
 * `nx-blob://<sha256>` — always the plaintext SHA-256, exactly what the
 * renderer and the database both know; the encrypted store's HMAC storage
 * names never cross this boundary. `lookupMime` is the caller's mime resolver
 * across EVERY attachment table (`NoteAttachmentStore.mimeForHash` or
 * `TaskAttachmentStore`'s, whichever registered the hash) — a hash that
 * resolves to no attachment row anywhere (never attached, or already GC'd) 404s
 * before the filesystem is even touched, and a malformed host never reaches
 * `lookupMime` at all.
 * `getKeys` returning `null` (locked) also 404s, as does `readBlob` returning
 * `null` (nothing in either store) — decrypting through `readBlob` is what
 * lets an inline image still resolve out of the legacy store during the
 * migration window.
 *
 * `getPaths` is a getter for the same reason `getKeys` is: the protocol is
 * registered once at startup, but the blob roots move with the SELECTED account
 * (ADR-044), so a path captured at registration time would keep serving the
 * account that happened to be active then. It is read only after the `getKeys`
 * null-check, which is what guarantees an account is selected by the time it is
 * called at all.
 *
 * The response always carries the main-process-sniffed `Content-Type` (never
 * the renderer's claim, SEC-FILE-02) plus `X-Content-Type-Options: nosniff`.
 * `sniffMime` (`@nexus/core`) never returns `text/html` or any other markup
 * type, so nothing this protocol serves can be interpreted as an executable
 * document by Chromium — the worst case is an image/pdf/zip/octet-stream
 * download, never script execution.
 */
export function registerBlobProtocol(
  lookupMime: (sha256: string) => string | null,
  getPaths: () => BlobStorePaths,
  getKeys: () => BlobKeys | null,
): void {
  protocol.handle("nx-blob", async (request) => {
    const host = new URL(request.url).hostname;
    if (!SHA256_HOST_PATTERN.test(host)) {
      return new Response(null, { status: 404 });
    }

    const mime = lookupMime(host);
    if (mime === null) {
      return new Response(null, { status: 404 });
    }

    const keys = getKeys();
    if (keys === null) {
      return new Response(null, { status: 404 });
    }

    const bytes = await readBlob(getPaths(), keys, host);
    if (bytes === null) {
      return new Response(null, { status: 404 });
    }

    return new Response(bytes, {
      status: 200,
      headers: {
        "Content-Type": mime,
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
}
