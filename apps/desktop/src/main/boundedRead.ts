import { open } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";

/**
 * One chosen file, read through a single handle, or why it was not.
 *
 * The desktop reads a path the user picked in a native dialog in six places,
 * and every one of them needs the same three answers: the bytes (with the size
 * the cap was measured against), a refusal for a path that is not a readable
 * regular file, and a refusal for one over the cap.
 */
export type BoundedRead =
  | { readonly status: "ok"; readonly bytes: Buffer; readonly size: number }
  | { readonly status: "unreadable" }
  | { readonly status: "not-a-file" }
  | { readonly status: "too-large" };

/**
 * Reads `path` whole, refusing anything over `maxBytes` BEFORE the bytes are
 * loaded.
 *
 * One `open` and then the handle's own `stat` and `readFile`, rather than
 * `stat(path)` followed by `readFile(path)`: two lookups of one path can be two
 * different files, and the size the cap was checked against is then not the size
 * of what lands in memory (js/file-system-race, #25-#30). The handle pins both
 * to one file, so the cap cannot be stepped over by a swap between them.
 *
 * The refusals are the ones the six call sites already answer with, kept apart
 * rather than collapsed so each of them can still word its own answer: a
 * directory that a file was expected from and a missing file are both
 * "unreadable" to a picker, but only this reader knows which one it met.
 */
export async function readFileBounded(path: string, maxBytes: number): Promise<BoundedRead> {
  let handle: FileHandle;
  try {
    handle = await open(path, "r");
  } catch {
    return { status: "unreadable" };
  }
  try {
    const info = await handle.stat();
    if (!info.isFile()) return { status: "not-a-file" };
    if (info.size > maxBytes) return { status: "too-large" };
    const bytes = await handle.readFile();
    // Belt and braces: the handle's own size is the size that was measured, but
    // a read that answers more than the cap is refused rather than trusted.
    if (bytes.byteLength > maxBytes) return { status: "too-large" };
    return { status: "ok", bytes, size: bytes.byteLength };
  } catch {
    // EISDIR, EACCES, a device that will not read: for the caller this is the
    // same answer as a path that is not there.
    return { status: "unreadable" };
  } finally {
    // A close that fails is not an answer the caller can act on, and throwing
    // here would replace a result with an exception at a call site that has
    // only ever handled results.
    await handle.close().catch(() => undefined);
  }
}
