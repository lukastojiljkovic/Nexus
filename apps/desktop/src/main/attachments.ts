import { createHash, randomBytes } from "node:crypto";
import { copyFile, mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import type { BrowserWindow } from "electron";
import { dialog, protocol, shell } from "electron";
import type { SaveAttachmentResult } from "../shared/ipc.js";

/**
 * The NOTE module's content-addressed attachment blob store and its
 * `nx-blob:` read protocol (ADR-014 / NOTE-003, slice 003-a). Mirrors
 * `main/imex.ts`'s deps-injection style: every function takes the directories
 * and window it needs as explicit parameters — nothing here reads `app`
 * itself — so `index.ts` is the only place that resolves real paths
 * (`app.getPath("userData")`) and wires them in.
 *
 * Bytes live on disk, never in SQLite: `<dir>/<sha256[0:2]>/<sha256>`, written
 * once (write-if-absent — two attachments with identical content share one
 * blob) via a temp-file-then-rename so a crash mid-write never leaves a
 * corrupt file at the final path. `NoteAttachmentStore` owns the index rows;
 * this module owns only the bytes and never touches SQL.
 */

/** `<userData>/attachments` — the blob store's root; `<sha256[0:2]>` fanout directories live directly under it. */
export function attachmentsDir(userDataPath: string): string {
  return join(userDataPath, "attachments");
}

/** The on-disk path for a given hash's blob, fanned out by its first two hex characters. */
export function blobPath(dir: string, sha256: string): string {
  return join(dir, sha256.slice(0, 2), sha256);
}

/**
 * Hashes `bytes` and writes them to their content-addressed path if not
 * already present (write-if-absent — a re-attach of identical content is a
 * cheap no-op write). The write itself is atomic: a random-suffixed temp file
 * next to the final path, then an OS-level rename, so a crash mid-write can
 * never leave a half-written blob at the real path.
 */
export async function saveBlob(dir: string, bytes: Uint8Array): Promise<{ sha256: string }> {
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const path = blobPath(dir, sha256);

  const alreadyPresent = await stat(path).then(
    () => true,
    () => false,
  );
  if (alreadyPresent) return { sha256 };

  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.tmp-${randomBytes(8).toString("hex")}`;
  await writeFile(tempPath, bytes);
  await rename(tempPath, path);
  return { sha256 };
}

/** Deletes a hash's blob once nothing references it anymore (`refCount === 0`); a missing file is not an error — GC is idempotent. */
export async function deleteBlobIfOrphaned(
  dir: string,
  sha256: string,
  refCount: number,
): Promise<void> {
  if (refCount !== 0) return;
  try {
    await unlink(blobPath(dir, sha256));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
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
 * Copies an attachment's blob to a main-owned temp file (never the renderer's
 * own path) and opens it with the OS's default handler for its type. `tempDir`
 * is `<userData>/tmp-open`, passed by the caller so this module never resolves
 * `app.getPath` itself.
 */
export async function openExternally(
  dir: string,
  tempDir: string,
  attachment: { fileName: string; sha256: string },
): Promise<void> {
  await mkdir(tempDir, { recursive: true });
  const destPath = join(tempDir, sanitizeFileName(attachment.fileName));
  await copyFile(blobPath(dir, attachment.sha256), destPath);

  const failure = await shell.openPath(destPath);
  if (failure) {
    throw new Error(`Failed to open attachment: ${failure}`);
  }
}

/**
 * Copies an attachment's blob to a path the user picks via the native save
 * dialog — the only source of the destination path (SEC-EL: the renderer
 * never supplies a filesystem path). Mirrors `handleExport`'s dialog call in
 * `main/imex.ts`.
 */
export async function saveAttachmentAs(
  win: BrowserWindow | null,
  dir: string,
  attachment: { fileName: string; sha256: string },
): Promise<SaveAttachmentResult> {
  const dialogOptions = { defaultPath: sanitizeFileName(attachment.fileName) };
  const { canceled, filePath } = win
    ? await dialog.showSaveDialog(win, dialogOptions)
    : await dialog.showSaveDialog(dialogOptions);
  if (canceled || !filePath) return { canceled: true };

  await copyFile(blobPath(dir, attachment.sha256), filePath);
  return { canceled: false, path: filePath };
}

const SHA256_HOST_PATTERN = /^[0-9a-f]{64}$/;

/**
 * Registers the `nx-blob:` read protocol (ADR-014, for slice 003-b's future
 * inline previews): the scheme is registered `standard` in `index.ts` before
 * app-ready, so a request's hash arrives lowercased as the URL's host, e.g.
 * `nx-blob://<sha256>`. `lookupMime` is the caller's
 * `NoteAttachmentStore.mimeForHash` — a hash that resolves to no registered
 * attachment row (never attached, or already GC'd) 404s before the filesystem
 * is even touched, and a malformed host never reaches `lookupMime` at all.
 *
 * The response always carries the main-process-sniffed `Content-Type` (never
 * the renderer's claim, SEC-FILE-02) plus `X-Content-Type-Options: nosniff`.
 * `sniffMime` (`@nexus/core`) never returns `text/html` or any other markup
 * type, so nothing this protocol serves can be interpreted as an executable
 * document by Chromium — the worst case is an image/pdf/zip/octet-stream
 * download, never script execution.
 */
export function registerBlobProtocol(lookupMime: (sha256: string) => string | null, dir: string): void {
  protocol.handle("nx-blob", async (request) => {
    const host = new URL(request.url).hostname;
    if (!SHA256_HOST_PATTERN.test(host)) {
      return new Response(null, { status: 404 });
    }

    const mime = lookupMime(host);
    if (mime === null) {
      return new Response(null, { status: 404 });
    }

    try {
      const bytes = await readFile(blobPath(dir, host));
      return new Response(bytes, {
        status: 200,
        headers: {
          "Content-Type": mime,
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return new Response(null, { status: 404 });
      }
      throw error;
    }
  });
}
