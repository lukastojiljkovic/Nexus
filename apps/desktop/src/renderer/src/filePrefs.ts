/**
 * DOC's one device preference, stored in `localStorage` on the
 * `taskPrefs.ts` / `notePrefs.ts` recipe: a closed value set, a safe fallback
 * for anything unrecognized, and no IPC — this says how THIS machine draws
 * „Datoteke", never what the profile contains.
 *
 * Like the TASK preference and unlike the note width, there is no document
 * attribute to write: the value is read by the page itself, not by the
 * stylesheet.
 */

const FILE_VIEW_KEY = "nexus.files.view";

/** Which shape „Datoteke" opens in: a dense row list, or a thumbnail grid. */
export type FileView = "lista" | "mreza";

export const FILE_VIEWS: readonly FileView[] = ["lista", "mreza"];

/**
 * The list. It shows the owner, the size and the date of every row at once,
 * which is what somebody hunting for a file they half-remember needs; the grid
 * is for the case where the picture IS the file name, and that is the
 * deliberate choice rather than the default.
 */
const DEFAULT_FILE_VIEW: FileView = "lista";

function isFileView(value: string | null): value is FileView {
  return value != null && FILE_VIEWS.some((view) => view === value);
}

export function readStoredFileView(): FileView {
  const stored = localStorage.getItem(FILE_VIEW_KEY);
  return isFileView(stored) ? stored : DEFAULT_FILE_VIEW;
}

export function persistFileView(view: FileView): void {
  localStorage.setItem(FILE_VIEW_KEY, view);
}

/** Forgets this card's one key, so the next read opens on the list again — „Datoteke"'s „Vrati na podrazumevano" (SET §5). */
export function clearStoredFilePreferences(): void {
  localStorage.removeItem(FILE_VIEW_KEY);
}
