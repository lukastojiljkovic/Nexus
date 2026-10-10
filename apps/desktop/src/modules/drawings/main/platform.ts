import type { DrawingRefusalCode } from "../shared/ipc.js";
import type { DrawingKind } from "./open.js";

/**
 * The two effects DRAWINGS' handlers need that only `electron` can supply, as an
 * interface this folder owns.
 *
 * **Why this file exists rather than an `electron` import in `register.ts`.**
 * `moduleHost.ts` discovers `modules/<id>/main/register.ts` and runs it inside the
 * app; the kit's register TEST runs the very same file under Vitest, where there
 * is no Electron runtime. So the rules - the wire check, the seam, the mapping
 * onto the wire's result - stay in a file with no `electron` import, and the two
 * Electron-shaped facts (a native dialog plus a bounded read, and
 * `webContents.printToPDF`) arrive here as an interface. `desktop.ts` implements
 * it and `main/index.ts` installs it once, at startup.
 *
 * **Why the holder is a module-scope slot.** `register(host)` is the only
 * signature the discovery glue calls, so there is nowhere else to hand a module
 * its platform; the alternative would be widening the kit's own `ModulePlatform`
 * for one module's sake. The slot is written once, before any handler can run
 * (the host is built at module load, the first renderer call arrives long
 * afterwards), and a missing platform is an explicit error rather than a
 * `undefined is not a function` on the first click.
 */

/**
 * What `pickFile` answers: the file the user chose, a refusal, or a cancelled
 * dialog.
 *
 * **A PATH, and it stays in main.** The renderer never sees it: `register.ts`
 * reads the file it names (bounded) or hands it to the pack's converter and puts
 * only the drawing and the file's own NAME on the wire. That is the whole point
 * of putting the picker in main — a renderer cannot ask this module to read a
 * file it did not choose — and it is why the picker and the read are two steps
 * here: a `.dwg` is not read into memory at all, because the pack's converter
 * reads it once, out of the file the user picked.
 */
export type PickDrawing =
  | {
      readonly status: "picked";
      /** The file's own name, as the dialog reported it. */
      readonly name: string;
      readonly kind: DrawingKind;
      /** Where the user's file is. Main's own value, and it never reaches the renderer. */
      readonly path: string;
    }
  | { readonly status: "cancelled" }
  | { readonly status: "refused"; readonly code: DrawingRefusalCode };

/** What `printView` answers: the written file, a cancelled dialog, or a refusal the page can word. */
export type PrintView =
  | { readonly status: "saved"; readonly path: string }
  | { readonly status: "cancelled" }
  | { readonly status: "refused"; readonly code: "no-window" | "print-failed" };

/** The Electron-shaped half of this module, as `register.ts` sees it. */
export interface DrawingsPlatform {
  /**
   * Opens the native picker and answers what was chosen. Never throws for a file
   * it cannot use: a refusal is an answer.
   */
  pickFile(): Promise<PickDrawing>;
  /**
   * Prints the CURRENT WINDOW to a PDF the user names, through a save dialog.
   * What is on the sheet is the renderer's business: the page puts the app into
   * its print layout before asking (`drawings.css`).
   */
  printView(): Promise<PrintView>;
}

let installed: DrawingsPlatform | null = null;

/** Installs the platform. Called once, by `main/index.ts`, at startup. */
export function provideDrawingsPlatform(platform: DrawingsPlatform): void {
  installed = platform;
}

/** The installed platform. Throws rather than answering `undefined`: a caller with no platform is a wiring bug. */
export function drawingsPlatform(): DrawingsPlatform {
  if (installed === null) {
    throw new Error(
      "Nexus: the drawings module has no platform installed; main/index.ts must call installDrawingsPlatform().",
    );
  }
  return installed;
}
