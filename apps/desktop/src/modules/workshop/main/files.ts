import { writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { OpenDialogOptions } from "electron";
import { BrowserWindow, dialog } from "electron";
import { extensionForMime, sniffMime } from "@nexus/core";
import { sanitizeFileName } from "../../../main/attachments.js";
import { readFileBounded } from "../../../main/boundedRead.js";
import { shellStrings } from "../../../main/shellStrings.js";
import {
  WORKSHOP_MAX_BATCH_BYTES,
  WORKSHOP_MAX_BATCH_FILES,
  WORKSHOP_MAX_FILE_BYTES,
  WORKSHOP_MAX_OUTPUT_BYTES,
  type WorkshopFileHost,
  type WorkshopPickedFile,
} from "../shared/workshopFiles.js";
import { asBatchFiles, asBytes, asFileKind, asSuggestedName, numberedFileName } from "./filesPure.js";

/**
 * WORKSHOP's file channels in the main process: the open dialog and the bounded
 * read that bring files in, and the save dialog and the chosen folder that take
 * results out (ADR-090, SEC-EL).
 *
 * **Why the files pass through here at all.** The tools themselves run in a
 * renderer Web Worker — pdf-lib and a canvas are both renderer work, and a
 * hundred-page merge belongs off the UI thread rather than in main. What main
 * owns is the two things a renderer must never have: a filesystem PATH and the
 * authority to read or write one. So a path exists only inside this file, from
 * the moment a dialog hands it over to the moment the bytes are written back,
 * and the renderer sees a file's name and its bytes and nothing else.
 *
 * **Every write is named by main.** The renderer proposes a name and main
 * derives the real one: `sanitizeFileName` (the app's existing rule — no
 * separators, no control characters, never empty, capped) and then the
 * extension the bytes' own magic earns, so a PDF saved as `photo.png` is
 * written as `photo.pdf` rather than as a PNG the OS would hand to an image
 * viewer. That is `safeOpenName`'s rule from `attachments.ts`, applied to the
 * recording side instead of the opening side.
 *
 * **Nothing here overwrites.** A single save is the native dialog's own
 * question — the OS asks before replacing a file, which is the right authority
 * for it. A batch writes into a chosen FOLDER, where no per-file question is
 * asked, so a name already in that folder is answered with a numbered sibling
 * (`report (2).pdf`) and the file is created with `wx`, which is the OS
 * refusing to replace anything. The names actually written travel back in the
 * answer, so the page can print them.
 */

/** The default window a dialog is modal to: whichever one the user is looking at. */
function focusedWindow(): BrowserWindow | null {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows().at(0) ?? null;
}

/**
 * The dialog filters one kind of pick uses.
 *
 * The image filter is the shell's own `imageFilterName`, read at the moment the
 * dialog opens so a locale switch changes what the NEXT dialog shows — the rule
 * `shellStrings.ts` states for every piece of native chrome in this app, and the
 * reason this is not a string of ours. The PDF filter is the literal `"PDF"`,
 * because that is the format's name in both languages (`markdownImport.ts`
 * writes `"Markdown"` on the same grounds) and a shell string for it would be
 * two identical rows.
 */
function pickOptions(kind: "pdf" | "image"): OpenDialogOptions {
  const extensions = kind === "pdf" ? ["pdf"] : ["png", "jpg", "jpeg", "webp"];
  return {
    properties: ["openFile", "multiSelections"],
    filters: [{ name: kind === "pdf" ? "PDF" : shellStrings().imageFilterName, extensions }],
  };
}

/**
 * The name a written file gets: the proposed name, sanitized, with the
 * extension its own bytes earn.
 *
 * The base keeps whatever the user called it — a name is how they will find
 * the file again — and only the LAST extension is main's, which is
 * `safeOpenName`'s rule and its reason: on Windows the extension is what the
 * shell executes.
 */
function writtenName(suggested: string, bytes: Uint8Array): string {
  const sanitized = sanitizeFileName(suggested);
  const claimed = sanitized.lastIndexOf(".");
  const base = claimed > 0 ? sanitized.slice(0, claimed) : sanitized;
  const trimmed = base.trim();
  const extension = extensionForMime(sniffMime(bytes));
  return `${trimmed.length === 0 ? "workshop" : trimmed}${extension}`;
}

/** How many numbered siblings a batch will try before giving up on a name. */
const MAX_NAME_ATTEMPTS = 1000;

/**
 * Writes `bytes` into `folder` under the first free numbered candidate of
 * `name`, and answers the name it used.
 *
 * `wx` rather than a folder listing: the existence check and the create are one
 * operation, so two runs of this cannot both decide a name is free.
 */
async function writeWithoutReplacing(folder: string, name: string, bytes: Uint8Array): Promise<string> {
  for (let attempt = 1; attempt <= MAX_NAME_ATTEMPTS; attempt += 1) {
    const candidate = numberedFileName(name, attempt);
    try {
      await writeFile(join(folder, candidate), bytes, { flag: "wx" });
      return candidate;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") continue;
      throw error;
    }
  }
  throw new Error(`Nexus could not find a free name for "${name}" in the chosen folder.`);
}

/**
 * Registers the module's three file handlers.
 *
 * The window is injected with a default rather than read here, for the reason
 * every dialog in this app is injected: the merge that wires this module up can
 * hand in the real main window so the dialogs are modal to it, and nothing in
 * this file has to guess which window that is. The default walks the app's own
 * windows, because a kit module's handler is given no window by the kit's
 * platform (`main/moduleIpc.ts`) — the one thing this file cannot be handed.
 */
export function registerWorkshopFiles(
  host: WorkshopFileHost,
  parentWindow: () => BrowserWindow | null = focusedWindow,
): void {
  host.handle("pickFiles", async (payload, call) => {
    const body = call.as.asRecord(payload);
    const kind = asFileKind(call.as.asString(body.kind, "kind"));
    if (kind === null) {
      throw new Error('Invalid IPC payload: "kind" must be "pdf" or "image".');
    }
    const win = parentWindow();
    const options = pickOptions(kind);
    const { canceled, filePaths } = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options);
    if (canceled) {
      return { canceled: true, files: [], skippedTooLarge: 0, skippedUnreadable: 0 };
    }

    const files: WorkshopPickedFile[] = [];
    let total = 0;
    let skippedTooLarge = 0;
    let skippedUnreadable = 0;
    for (const path of filePaths) {
      // The batch's own caps come first: a pick that has already reached its
      // file count or its total does not need the disk read at all, and the
      // count of what was left out is what the page tells the user.
      if (files.length >= WORKSHOP_MAX_BATCH_FILES) {
        skippedTooLarge += 1;
        continue;
      }
      // The read is bounded by the SMALLER of the two remaining budgets, so a
      // file over the per-file cap and a file that would take the batch over
      // its total are both refused before their bytes are loaded.
      const room = Math.min(WORKSHOP_MAX_FILE_BYTES, WORKSHOP_MAX_BATCH_BYTES - total);
      const read = await readFileBounded(path, room);
      if (read.status === "too-large") {
        skippedTooLarge += 1;
        continue;
      }
      if (read.status !== "ok") {
        skippedUnreadable += 1;
        continue;
      }
      files.push({ name: basename(path), bytes: read.bytes });
      total += read.size;
    }
    return { canceled: false, files, skippedTooLarge, skippedUnreadable };
  });

  host.handle("saveFile", async (payload, call) => {
    const body = call.as.asRecord(payload);
    const bytes = asBytes(body.bytes, "bytes", WORKSHOP_MAX_OUTPUT_BYTES);
    const name = writtenName(asSuggestedName(call.as, body.suggestedName), bytes);
    const win = parentWindow();
    const { canceled, filePath } = win
      ? await dialog.showSaveDialog(win, { defaultPath: name })
      : await dialog.showSaveDialog({ defaultPath: name });
    if (canceled || filePath === undefined || filePath.length === 0) {
      return { canceled: true, savedName: null };
    }
    await writeFile(filePath, bytes);
    return { canceled: false, savedName: basename(filePath) };
  });

  host.handle("saveBatch", async (payload, call) => {
    const body = call.as.asRecord(payload);
    const files = asBatchFiles(body.files);
    const win = parentWindow();
    const options: OpenDialogOptions = { properties: ["openDirectory"] };
    const { canceled, filePaths } = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options);
    // A chosen folder is a single path in `filePaths`; a dialog that answered a
    // directory out of `canceled: false` with nothing in it is an answer this
    // module cannot act on, and is treated as the cancellation it effectively is.
    const folder = filePaths.at(0);
    if (canceled || folder === undefined) {
      return { canceled: true, writtenNames: [], folderName: null };
    }

    const writtenNames: string[] = [];
    for (const file of files) {
      writtenNames.push(await writeWithoutReplacing(folder, writtenName(file.name, file.bytes), file.bytes));
    }
    return { canceled: false, writtenNames, folderName: basename(folder) };
  });
}
