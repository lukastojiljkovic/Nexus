import type { BrowserWindow } from "electron";
import { powerSaveBlocker } from "electron";
import { sniffMime } from "@nexus/core";
import type { BlobKeys } from "@nexus/core/auth";
import { MAX_RECIPE_PHOTO_BYTES } from "@nexus/db";
import {
  deleteBlobIfOrphaned,
  pickAttachmentFiles,
  saveBlob,
  type BlobStorePaths,
} from "../../../main/attachments.js";
import type { CookbookHost } from "./register.js";

/**
 * The Electron half of the COOKBOOK module: the native „choose a photo" dialog,
 * a write into the app's ONE encrypted blob store, and the display-awake
 * blocker the cooking view asks for.
 *
 * **Why this file exists and why it is separate from `register.ts`.** A kit
 * module's `register` is tested under Vitest, where Electron does not exist (the
 * app's vitest config says so out loud), and it deliberately has no
 * `BrowserWindow`, no `app` and no `ipcMain`. So the module keeps three facts it
 * cannot own — the dialog, the blob store's paths and keys, and the blocker — in
 * this file, which `main/index.ts` is the only thing that imports, and hands
 * them to `register.ts` through `configureCookbook`. That is `main/attachments.ts`'
 * own arrangement: the logic takes its effects injected, and one file resolves
 * the real paths.
 *
 * **The size gate is `pickAttachmentFiles`' own**, which stats before it reads
 * and refuses a file past `MAX_RECIPE_PHOTO_BYTES` the same way every other
 * attachment surface does. A pick that was refused for size is not a cancel, and
 * the two are told apart here: „too large" is a sentence the user needs.
 *
 * **The mime is sniffed from the BYTES** (SEC-FILE-02), never taken from the
 * file name, and a file that is not an image is refused before a blob is
 * written — a recipe's photo is drawn by `nx-blob:`, which serves images.
 */

export interface CookbookHostDeps {
  /** The window the dialog belongs to, or null when none is open. */
  window(): BrowserWindow | null;
  blobPaths(): BlobStorePaths;
  blobKeys(): BlobKeys;
  /**
   * Main's own union count over every table that names a blob hash — the ONE
   * place that union lives (`blobRefCount` in `main/index.ts`). A module cannot
   * compute it: the other tables are not its business, and a count that saw only
   * the cookbook's rows would delete a file a note still points at.
   */
  refCount(profileId: string, sha256: string): number;
}

export function createCookbookHost(deps: CookbookHostDeps): CookbookHost {
  /** The one blocker this module may hold, so a second request cannot leave a second one running. */
  let blockerId: number | null = null;

  return {
    async pickPhoto() {
      const picked = await pickAttachmentFiles(deps.window(), MAX_RECIPE_PHOTO_BYTES);
      const file = picked.files[0];
      if (picked.canceled) return null;
      if (file === undefined) {
        // The dialog's own refusal, said out loud rather than reported as a
        // cancel: a 60 MB photograph and a closed dialog are not the same event.
        if (picked.skippedTooLarge > 0) {
          throw new Error(
            `The photo is larger than ${String(Math.round(MAX_RECIPE_PHOTO_BYTES / (1024 * 1024)))} MB.`,
          );
        }
        return null;
      }

      const mime = sniffMime(file.bytes);
      if (!mime.startsWith("image/")) {
        throw new Error("That file is not an image.");
      }
      const { sha256 } = await saveBlob(deps.blobPaths(), deps.blobKeys(), file.bytes);
      return { fileName: file.fileName, mime, sizeBytes: file.bytes.byteLength, sha256 };
    },

    releasePhoto(profileId, sha256) {
      // Best effort, and never throwing: the recipe was already saved, and a
      // blob that outlives its row is a file to sweep rather than a lost write.
      void deleteBlobIfOrphaned(
        deps.blobPaths(),
        deps.blobKeys(),
        sha256,
        deps.refCount(profileId, sha256),
      ).catch((error: unknown) => {
        console.error(
          `Nexus: a replaced recipe photo could not be released — ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
    },

    setAwake(on) {
      if (on) {
        if (blockerId === null) {
          blockerId = powerSaveBlocker.start("prevent-display-sleep");
        }
        return;
      }
      if (blockerId !== null) {
        powerSaveBlocker.stop(blockerId);
        blockerId = null;
      }
    },
  };
}
