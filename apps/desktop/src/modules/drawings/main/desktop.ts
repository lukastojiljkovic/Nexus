import { writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { dialog, type BrowserWindow, type OpenDialogOptions, type SaveDialogOptions } from "electron";
import { mainLocale } from "../../../main/locale.js";
import { drawingKindOf } from "./open.js";
import {
  provideDrawingsPlatform,
  type DrawingsPlatform,
  type PickDrawing,
  type PrintView,
} from "./platform.js";

/**
 * The Electron half of DRAWINGS: the native picker and the window's own
 * `printToPDF`.
 *
 * **This is the only file in the module that imports `electron`,** and it is not
 * reachable from `register.ts` - `main/index.ts` imports it and installs it into
 * the platform slot once, at startup. So the kit's rules stay testable and this
 * file holds exactly the things a test could not run anyway.
 *
 * **The path reaches main and stops there.** Both dialogs are opened here, and a
 * chosen file's path is handed to `register.ts` — which reads it, bounded, or
 * gives it to the pack's converter — and never to the renderer, which receives
 * the drawing and the file's own NAME rather than where it was. That is the whole
 * point of putting the picker in main: a renderer cannot ask this module to read
 * a file it did not choose.
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
 * Opens the native picker and answers the file a person chose.
 *
 * **Only the DIALOG is here.** What happens to the path afterwards is
 * `register.ts`'s: a `.dxf` is read there, bounded by the module's own cap before
 * the bytes exist (`main/boundedRead.ts`), and a `.dwg` is handed to the pack's
 * converter, which reads it once from this very file. Neither the cap nor the
 * conversion depends on Electron, so neither belongs in the one file of this
 * module that cannot be tested.
 *
 * The kind is decided from the name BEFORE anything is opened, so a file the
 * dialog's filter hid but which the user typed anyway is refused by name rather
 * than read.
 */
async function pickFile(window: () => BrowserWindow | null): Promise<PickDrawing> {
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
  return { status: "picked", name, kind, path };
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
    pickFile: () => pickFile(window),
    printView: () => printView(window),
  };
  provideDrawingsPlatform(platform);
}
