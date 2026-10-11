import { BrowserWindow, dialog, type Session } from "electron";
import { writeFile } from "node:fs/promises";
import { LAB_DIALOG_COPY, dialogText } from "./dialogCopy.js";
import { installTextSaver } from "./saveFile.js";
import { installSerialPortPicker } from "./serialPicker.js";

/**
 * The LAB's Electron half, installed with one call from `main/index.ts` — the
 * house's arrangement for a feature whose rules are testable and whose wiring is
 * not (`main/update/electron.ts` and `main/download/electron.ts` are the same
 * shape).
 *
 * **What it installs, and nothing else.** The session's serial port picker (the
 * one place a serial port is ever chosen, `serialPicker.ts`) and the save dialog
 * the module's two file ops go through. It deliberately does NOT touch the
 * session's permission handlers: those are extended by several modules at once
 * and each one contributes a pure rule plus one line at the handler
 * (`serialPermission.ts` and `main/index.ts` say so), which is why nothing here
 * calls `setPermissionCheckHandler`.
 *
 * **Why the save dialog is modal to the focused window and writes UTF-8.** A
 * save dialog that could be buried behind the app is a dialog the user thinks
 * did not open, and every file this module writes is text a spreadsheet or a
 * text editor reads — a CSV whose fields are numbers and column names, and a
 * terminal log. The path comes back from the OS and is never computed here.
 */
export function installLabElectron(ses: Session): void {
  installSerialPortPicker(ses);
  installTextSaver(saveText);
}

/** The real saver: a save dialog, then a write to the path it answered with. */
async function saveText(request: {
  readonly title: string;
  readonly defaultFileName: string;
  readonly text: string;
}): Promise<{ canceled: boolean; path: string | null }> {
  const owner = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
  const options = {
    title: request.title,
    defaultPath: request.defaultFileName,
    // No filter list: the two files this module writes are `.csv` for a
    // spreadsheet and `.log` for a terminal's own record, and a filter that
    // named neither would be a dialog that hides the file the user asked for.
    // Its LABEL is copy like every other word on a screen, so it comes from the
    // module's own bilingual table rather than being spelled in English here.
    filters: [
      { name: dialogText(LAB_DIALOG_COPY.fileFilter), extensions: ["csv", "log", "txt"] },
    ],
  };
  const answer =
    owner === null
      ? await dialog.showSaveDialog(options)
      : await dialog.showSaveDialog(owner, options);
  if (answer.canceled || answer.filePath === undefined) {
    return { canceled: true, path: null };
  }
  await writeFile(answer.filePath, request.text, "utf8");
  return { canceled: false, path: answer.filePath };
}
