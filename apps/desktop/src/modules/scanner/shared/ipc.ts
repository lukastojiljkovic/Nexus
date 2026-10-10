import { defineModuleContract, type ModuleApiOf } from "../../../shared/moduleApi.js";

/**
 * SCANNER's contract (ADR-090): the one channel it answers on, the payload it
 * takes, and the API its page calls.
 *
 * **Why there is exactly one op, and why it does not answer with a "view".**
 * Everything else this module does happens in the page: the image never crosses
 * the bridge (it is a local file the user picked, a paste, or a camera frame,
 * and it is recognised by a Web Worker in the renderer), and the recognised
 * text is the page's own state until the user asks for it to be saved. The one
 * thing the renderer must not do itself is create the note - the database lives
 * in main (SEC-EL), and a note is created through the store's own path so the
 * row, its document, its searchable plaintext and its first version checkpoint
 * all land together, exactly as an imported or typed note does.
 *
 * So there is no `TimersView`-shaped read here: a "list" of scans would be a
 * list of nothing, because this module keeps no table. What a successful save
 * answers with is the note the user can go and look at.
 */

/**
 * How many characters of recognised text may be saved into one note.
 *
 * A bound on what the wire accepts rather than a limit a real scan meets: a
 * dense A4 page of Serbian is a few thousand characters, so 64 000 is an order
 * of magnitude past any receipt, page or label. It is a character count rather
 * than a byte count because the store measures text in characters and every
 * Serbian letter carrying a diacritic is two bytes in UTF-8 (`asCappedChars`'s
 * own rule, in `main/ipcValidators.ts`).
 */
export const SCAN_TEXT_MAX_CHARS = 64_000;

/**
 * How long a note title may be.
 *
 * Mirrors `notes.title`'s own cap, which core's `parseMarkdownNote` applies to
 * the title it settles (`capTitle`), so a title that arrives longer than this
 * is refused at the wire instead of being silently cut by the parser.
 */
export const SCAN_TITLE_MAX_CHARS = 200;

/** The note a scan was saved into. */
export interface ScanNoteResult {
  readonly noteId: string;
  /** The title the note actually wears - the user's own, or the one derived from the text's first line. */
  readonly title: string;
}

/**
 * One save. `title` is sent even when it is empty, because empty is a real
 * answer: main then derives the title from the text itself (the notes module's
 * own rule is that a note's title is its first block), which is what the page
 * offers as a prefill and the user may clear.
 */
interface SaveAsNotePayload {
  profileId: string;
  text: string;
  title: string;
}

type ScannerOps = {
  saveAsNote: { request: SaveAsNotePayload; response: ScanNoteResult };
};

/** This module's renderer API: one method per op, named after the op. */
export type ScannerApi = ModuleApiOf<ScannerOps>;

/** The contract the preload builds the bridge from and main refuses foreign ops against. */
export const contract = defineModuleContract<"scanner", ScannerOps>("scanner", ["saveAsNote"]);

/**
 * The type-level half: this module's API joins `NexusApi.modules` from here, so
 * `window.nexus.modules.scanner.saveAsNote(...)` is typed in this module's page
 * without a line in `shared/ipc.ts`.
 */
declare module "../../../shared/moduleApi.js" {
  interface ModuleApis {
    scanner: ScannerApi;
  }
}
