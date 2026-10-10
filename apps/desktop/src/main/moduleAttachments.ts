import type { BrowserWindow } from "electron";
import { sniffMime } from "@nexus/core";
import type { BlobKeys } from "@nexus/core/auth";
import {
  deleteBlobIfOrphaned,
  pickAttachmentFiles,
  saveBlob,
  type BlobStorePaths,
} from "./attachments.js";
import type { ModuleAttachmentFile, ModuleAttachmentsResult } from "./moduleIpc.js";

/**
 * The kit's attach path, implemented once (ADR-090's `ModuleContext.attachFiles`).
 *
 * **Why this is a file of its own.** `moduleIpc.ts` has no `electron` import on
 * purpose — that is what lets the kit's rules be tested — so it takes this
 * capability as a `ModulePlatform` member and `index.ts` supplies it in a few
 * lines. The logic itself is the COMPILED-IN attachment handlers' own, written
 * once for every module that will ever store a blob: pick through main's one
 * dialog, sniff the real MIME from the bytes (SEC-FILE-02), write the blob, hand
 * the module its index-row facts, and finally either keep the blob because the
 * row landed or delete it again because the row did not.
 *
 * **Why the row write is a callback and not a returned list.** The blob exists
 * before the row does (`saveBlob` is write-if-absent and content-addressed), so
 * an insert that throws would leave a file nothing names. The compiled-in
 * handlers pay for that with a `catch` around each insert — a compensation every
 * module would have to remember. Doing it here means "a module cannot leave an
 * orphan blob" is a property of the kit rather than of each module's care, and
 * the count the deletion consults (`refCount`) is still `main/index.ts`'s, so a
 * blob some other table also holds survives.
 *
 * `now` is NOT a parameter: every caller of this path stamps from main's own
 * clock exactly as the compiled-in handlers do, because the row's `createdAt` is
 * main's fact and never a module's.
 */

/** What this call needs from main that only `index.ts` holds. */
export interface ModuleAttachmentHost {
  /** The window the dialog belongs to, exactly as `pickAttachmentFiles` wants it. */
  readonly window: BrowserWindow | null;
  readonly paths: BlobStorePaths;
  readonly keys: BlobKeys;
  /**
   * How many rows still name a hash, summed over every blob-naming table
   * (`main/index.ts`'s `blobRefCount`).
   *
   * The profile that count is taken for is MAIN's own resolved active profile
   * and never a value from the wire, and that is a security decision rather than
   * tidiness: this function deletes files, so a caller able to choose the
   * profile could drive the count to zero while another profile still holds the
   * bytes.
   */
  refCount(sha256: string): number;
}

/**
 * Runs one pick for a module and reports what happened.
 */
export async function attachFilesForModule(
  host: ModuleAttachmentHost,
  maxBytes: number,
  record: (file: ModuleAttachmentFile) => void,
): Promise<ModuleAttachmentsResult> {
  const picked = await pickAttachmentFiles(host.window, maxBytes);
  if (picked.canceled) return { canceled: true };

  let added = 0;
  for (const file of picked.files) {
    const mime = sniffMime(file.bytes);
    const { sha256 } = await saveBlob(host.paths, host.keys, file.bytes);
    try {
      record({
        fileName: file.fileName,
        mime,
        sizeBytes: file.bytes.byteLength,
        sha256,
      });
      added += 1;
    } catch (error) {
      // The row did not land, so this file is nobody's: give it back unless some
      // other row anywhere already holds the same bytes. The original error is
      // what the module (and the user) needs to hear, so it is re-thrown rather
      // than swallowed by the cleanup.
      await deleteBlobIfOrphaned(host.paths, host.keys, sha256, host.refCount(sha256));
      throw error;
    }
  }
  return { canceled: false, added, skippedTooLarge: picked.skippedTooLarge };
}

/** Gives one hash back after its owning row is gone — the count is main's, so another holder keeps the file. */
export async function releaseBlobForModule(
  host: ModuleAttachmentHost,
  sha256: string,
): Promise<void> {
  await deleteBlobIfOrphaned(host.paths, host.keys, sha256, host.refCount(sha256));
}
