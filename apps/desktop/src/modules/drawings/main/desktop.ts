import { writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { dialog, type BrowserWindow, type OpenDialogOptions, type SaveDialogOptions } from "electron";
import { readFileBounded } from "../../../main/boundedRead.js";
import { mainLocale } from "../../../main/locale.js";
import { drawingKindOf, MAX_DRAWING_BYTES } from "./open.js";
import {
  provideDrawingsPlatform,
  type DrawingsPlatform,
  type PrintView,
  type ReadDrawing,
} from "./platform.js";

/**
 * The Electron half of DRAWINGS: the native picker, the bounded read and the
 * window's own `printToPDF`.
 *
 * **This is the only file in the module that imports `electron`,** and it is not
 * reachable from `register.ts` - `main/index.ts` imports it and installs it into
 * the platform slot once, at startup. So the kit's rules stay testable and this
 * file holds exactly the things a test could not run anyway.
 *
 * **The path never leaves this file.** Both dialogs are opened here, the size
 * cap is applied by `readFileBounded` before any bytes are read into memory, and
 * what crosses the wire back to the renderer is the file's own NAME rather than
 * where it was. That is the whole point of putting the picker in main: a
 * renderer cannot ask this module to read a file it did not choose.
 */

/**
 * The dialogs' own words, as `{ sr, en }` pairs.
 *
 * Main writes in the language it is serving (`main/locale.ts`), and these are
 * the only user-facing sentences in this module: everything the PAGE says lives
 * in its own copy table, in both languages, where a sentence can be reworded
 * without touching the process boundary.
 */
const COPY = {
  openTitle: { sr: "Otvori crtež", en: "Open a drawing" },
  openButton: { sr: "Otvori", en: "Open" },
  drawingFilter: { sr: "AutoCAD crteži", en: "AutoCAD drawings" },
  saveTitle: { sr: "Sačuvaj crtež kao PDF", en: "Save the drawing as PDF" },
  saveButton: { sr: "Sačuvaj", en: "Save" },
  pdfFilter: { sr: "PDF dokument", en: "PDF document" },
  defaultName: { sr: "crtez.pdf", en: "drawing.pdf" },
} as const;

/** One declared pair, in the language main is writing in. */
function text(pair: { readonly sr: string; readonly en: string }): string {
  return pair[mainLocale()];
}

/**
 * Reads the file a person picked, capped before the bytes exist.
 *
 * The three refusals `readFileBounded` distinguishes are mapped onto the wire's
 * own codes rather than collapsed: "a folder was picked" and "that file cannot
 * be opened" are different sentences on the page, and the reader of either one
 * wants to know which happened.
 */
async function pickAndRead(window: () => BrowserWindow | null): Promise<ReadDrawing> {
  const options: OpenDialogOptions = {
    properties: ["openFile"],
    title: text(COPY.openTitle),
    buttonLabel: text(COPY.openButton),
    filters: [
      { name: text(COPY.drawingFilter), extensions: ["dxf", "dwg"] },
    ],
  };
  const current = window();
  const chosen =
    current === null || current.isDestroyed()
      ? await dialog.showOpenDialog(options)
      : await dialog.showOpenDialog(current, options);
  if (chosen.canceled) return { status: "cancelled" };
  const path = chosen.filePaths[0];
  if (path === undefined) return { status: "cancelled" };

  // The kind comes from the name BEFORE the read, so a `.txt` costs no I/O at
  // all - and a file whose extension the dialog's filter hid but which the user
  // typed anyway is still refused by name rather than handed to the parser.
  const name = basename(path);
  const kind = drawingKindOf(name);
  if (kind === null) return { status: "refused", code: "unknown-format" };

  const read = await readFileBounded(path, MAX_DRAWING_BYTES);
  if (read.status === "too-large") return { status: "refused", code: "too-large" };
  if (read.status === "not-a-file") return { status: "refused", code: "not-a-file" };
  if (read.status === "unreadable") return { status: "refused", code: "unreadable" };
  if (read.size === 0) return { status: "refused", code: "empty" };

  // `Buffer` IS a `Uint8Array`, so the bytes cross the wire as the same view of
  // the same memory rather than through a copy or a base64 round trip.
  return { status: "chosen", name, kind, bytes: read.bytes };
}

/**
 * Prints the current window to a PDF the user names.
 *
 * **The destination is chosen FIRST.** A save dialog that the user cancels must
 * cost nothing, and printing before knowing where the result goes would rasterise
 * the whole drawing for a file nobody asked for.
 *
 * **What ends up on the sheet is the renderer's business, and the page knows
 * it.** `printToPDF` renders the window as it stands, so the page switches to its
 * print layout - chrome hidden, the drawing across the sheet - and only then
 * asks (`drawings.css`, the `@media print` block keyed on `nx-drawings-print`).
 * `printBackground` is on because a drawing on a dark ground is a colour, not a
 * decoration, and dropping the background would print bright entities on white.
 */
async function printView(window: () => BrowserWindow | null): Promise<PrintView> {
  const current = window();
  if (current === null || current.isDestroyed()) return { status: "refused", code: "no-window" };

  const options: SaveDialogOptions = {
    title: text(COPY.saveTitle),
    buttonLabel: text(COPY.saveButton),
    defaultPath: text(COPY.defaultName),
    filters: [{ name: text(COPY.pdfFilter), extensions: ["pdf"] }],
  };
  const target = await dialog.showSaveDialog(current, options);
  if (target.canceled) return { status: "cancelled" };
  const path = target.filePath;
  if (path === undefined || path === "") return { status: "cancelled" };

  try {
    const pdf = await current.webContents.printToPDF({
      // Landscape, because a drawing is wider than it is tall far more often
      // than the reverse, and a portrait A4 would shrink it by half.
      landscape: true,
      printBackground: true,
      pageSize: "A4",
    });
    await writeFile(path, pdf);
  } catch (error) {
    console.error(
      `Nexus: a drawing could not be printed - ${error instanceof Error ? error.message : String(error)}`,
    );
    return { status: "refused", code: "print-failed" };
  }
  return { status: "saved", path };
}

/**
 * Wires this module's platform into the slot `register.ts` reads.
 *
 * Called once, from `main/index.ts`, with a getter rather than the window
 * itself: the window is created and replaced over the app's life, and a capture
 * taken at startup would go stale on the first reopen.
 */
export function installDrawingsPlatform(window: () => BrowserWindow | null): void {
  const platform: DrawingsPlatform = {
    pickAndRead: () => pickAndRead(window),
    printView: () => printView(window),
  };
  provideDrawingsPlatform(platform);
}
