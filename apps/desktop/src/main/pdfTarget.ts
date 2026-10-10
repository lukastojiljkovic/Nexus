/**
 * The one check between a save dialog's answer and a file being written.
 *
 * Its own file, and electron-free on purpose: `cardPdf.ts` is where the dialog,
 * the hidden window and `printToPDF` live, and a module that imported `electron`
 * cannot be loaded under Vitest at all. Splitting the validation out is what lets
 * the half that decides whether a string becomes a file be tested with an
 * ordinary unit test instead of being trusted.
 */

/** How long a path may be. Generous for any real filesystem, and far below anything that would make a dialog's answer a payload. */
const MAX_PDF_PATH_LENGTH = 4096;

/**
 * The path a save dialog answered with, or a refusal naming what is wrong.
 *
 * Four questions, each about a value a DIALOG produced but that something other
 * than a dialog could also produce:
 *
 * - that it is a string at all - a cancelled dialog answers `undefined`, which
 *   the caller checks first, so this is the second net;
 * - that it is not blank and not impossibly long;
 * - that it has no NUL and no OUTER whitespace (nothing that names a path has a
 *   space on either end, and trimming would forge a path rather than name one -
 *   `asId`'s rule at the other boundary);
 * - that it names a `.pdf`. The extension is the module's promise rather than the
 *   user's: a card is a file somebody else has to open, and PDF bytes in a
 *   `.txt` fail in exactly the hands this feature exists to help.
 */
export function pdfWriteTarget(filePath: unknown): string {
  if (typeof filePath !== "string") {
    throw new Error("The save dialog answered no file name.");
  }
  if (filePath.length === 0 || filePath.length > MAX_PDF_PATH_LENGTH) {
    throw new Error("The save dialog answered a file name of an impossible length.");
  }
  if (filePath !== filePath.trim() || filePath.includes("\0")) {
    throw new Error("The save dialog answered a file name that is not a path.");
  }
  if (!filePath.toLowerCase().endsWith(".pdf")) {
    throw new Error('A card is saved as a ".pdf" file.');
  }
  return filePath;
}
