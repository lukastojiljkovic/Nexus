/**
 * The one thing the LAB needs from the shell that the module kit does not hand
 * out: a save dialog and a file write.
 *
 * **Why the saver is INJECTED rather than imported.** `dialog.showSaveDialog`
 * and `fs.writeFile` live in Electron and Node, and the module's `register.ts`
 * is a file with a Vitest suite — a static import of `electron` there would make
 * every test load an Electron stub. So the contract is a type and one variable,
 * the Electron implementation is installed at startup (`main/electron.ts`, one
 * line in `main/index.ts`), and the seam is also what lets a test drive the two
 * save ops end to end with a recording stub.
 *
 * **Why a missing saver THROWS rather than answering „canceled".** A file the
 * user asked for that was not written is the one outcome that must never look
 * like a choice, and an unwired saver is a startup bug rather than a user's
 * decision — so the failure names itself.
 */

/** What one save asks the shell for. */
export interface SaveTextRequest {
  /** The dialog's title, already in the language main is writing in. */
  readonly title: string;
  /** The name the dialog offers — a file name, not a path. */
  readonly defaultFileName: string;
  /** The bytes to write, as text. UTF-8, with the BOM question settled by the caller. */
  readonly text: string;
}

/** Where the file landed, or that the user closed the dialog. */
export interface SaveTextResult {
  readonly canceled: boolean;
  readonly path: string | null;
}

/** The implementation the main process installs at startup. */
export type TextSaver = (request: SaveTextRequest) => Promise<SaveTextResult>;

let saver: TextSaver = async () => {
  throw new Error("Nexus: the Lab module's file saver was not installed.");
};

/** Installs the real saver. Called once, from `main/index.ts`, while the app is starting. */
export function installTextSaver(implementation: TextSaver): void {
  saver = implementation;
}

/** Saves one text file through the installed saver. */
export function saveTextFile(request: SaveTextRequest): Promise<SaveTextResult> {
  return saver(request);
}
