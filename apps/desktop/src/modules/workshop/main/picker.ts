import { BrowserWindow, dialog, type OpenDialogOptions } from "electron";
import type { WorkshopTarget } from "../shared/ipc.js";
import { dialogFilterName } from "./dialogCopy.js";

/**
 * The one Electron-shaped file in this module: the native open dialog.
 *
 * **Why it is a file of its own, imported lazily.** `register.ts` must stay
 * runnable under Vitest, where there is no Electron at all, and the whole point
 * of the injectable picker there is that the tests drive the file-reading and
 * conversion halves for real. So this module is reached through a dynamic
 * `import()` at the moment a dialog is actually opened, and a test that never
 * opens one never loads it.
 *
 * **The filter is a convenience and the parse is the check.** A `.stl` named
 * `.txt` still opens (the STL reader decides what the file is from its bytes),
 * and a `.gtl` full of prose is refused by the converter. The filter is what
 * makes the dialog usable.
 *
 * **Several files at once, for a board only.** A board is a stack of layers -
 * copper, mask, silk, drill - and a dialog that opened them one at a time would
 * make the one thing this viewer is for take eight clicks. A model or a toolpath
 * is one file, so its dialog allows one.
 */

/** The extensions each target offers. KiCad, Eagle, Altium and the slicers between them write all of these. */
const FILTERS: Readonly<Record<WorkshopTarget, readonly string[]>> = {
  model: ["stl"],
  toolpath: ["gcode", "gco", "g", "nc", "ngc"],
  board: ["gbr", "gtl", "gbl", "gts", "gbs", "gto", "gbo", "gtp", "gbp", "gko", "gm1", "ger", "drl", "xln", "nc", "txt"],
};

/**
 * Opens the dialog for one target and answers the paths the user chose, or
 * `null` when they cancelled. Nothing is read here: this answers paths, and
 * `register.ts` does the reading, so the cap and the refusals live in one place.
 */
export async function pickWorkshopFiles(target: WorkshopTarget): Promise<readonly string[] | null> {
  const options: OpenDialogOptions = {
    properties: target === "board" ? ["openFile", "multiSelections"] : ["openFile"],
    filters: [{ name: dialogFilterName(target), extensions: [...FILTERS[target]] }],
  };
  // The window is used when there is one, so the dialog is modal over the app;
  // a launch with no window yet still opens it, which is what `packs/registry`'s
  // own picker does with the same two lines.
  const window = BrowserWindow.getAllWindows()[0];
  const chosen = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
  return chosen.canceled ? null : chosen.filePaths;
}
