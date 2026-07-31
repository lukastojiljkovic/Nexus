/**
 * The NOTE device preferences, stored in `localStorage` exactly as `theme.ts`
 * and `accent.ts` store theirs: they describe how this machine renders the
 * module, not what the profile contains, so they belong beside the theme rather
 * than in the encrypted database — and they must be readable before the first
 * paint, which an IPC round trip is not.
 *
 * Two of them are the editor's (ADR-036: the reading measure, the markdown
 * input rules). The third is the ROOT's note-list shape (NOTE-002) — see
 * `readStoredRootNoteView` for why the root's view lives here while a folder's
 * lives in the database.
 *
 * Every reader narrows an arbitrary stored string to the typed value and falls
 * back to the default for anything unrecognized (including nothing stored yet),
 * so a hand-edited or stale key can never put the module into a state the UI
 * cannot name.
 */

import type { NoteFolderView } from "../../shared/ipc.js";

const WIDTH_KEY = "nexus.noteWidth";
const MARKDOWN_KEY = "nexus.noteMarkdownShortcuts";
const ROOT_VIEW_KEY = "nexus.notes.rootView";

/** The reading measure of the note editor column. "normalna" is today's 70ch — the default is the status quo. */
export type NoteWidth = "uska" | "normalna" | "siroka";

export const NOTE_WIDTHS: readonly NoteWidth[] = ["uska", "normalna", "siroka"];

const DEFAULT_WIDTH: NoteWidth = "normalna";

function isNoteWidth(value: string | null): value is NoteWidth {
  return value != null && NOTE_WIDTHS.some((width) => width === value);
}

export function readStoredNoteWidth(): NoteWidth {
  const stored = localStorage.getItem(WIDTH_KEY);
  return isNoteWidth(stored) ? stored : DEFAULT_WIDTH;
}

/**
 * Persists the width and applies it to the document root. The measure itself is
 * a CSS value keyed off `data-note-width` (see `app.css`), not a number written
 * from here — so every element on the editor's reading measure follows one
 * declaration instead of each being resized by script.
 */
export function persistNoteWidth(width: NoteWidth): void {
  localStorage.setItem(WIDTH_KEY, width);
  document.documentElement.setAttribute("data-note-width", width);
}

/** Applies whatever width is already stored (main.tsx, before first render — avoids a re-measure flash). */
export function applyStoredNoteWidth(): void {
  persistNoteWidth(readStoredNoteWidth());
}

/**
 * Whether TipTap's markdown input rules are live: typing `# `, `- `, `> `,
 * ``` and friends converts the block as you type. ON by default — turning it
 * off is the deliberate choice, for someone who writes `#` and `*` as
 * literal characters.
 *
 * The slash menu and the `[[` link menu are Suggestion plugins, not input
 * rules, so they keep working either way — which is what makes this safe to
 * express as TipTap's own `enableInputRules` flag rather than by disabling
 * extensions the slash menu still needs.
 */
export function readStoredNoteMarkdownShortcuts(): boolean {
  // Only the exact opt-out string turns it off; anything else (including a
  // corrupt value and the very common "nothing stored yet") stays ON.
  return localStorage.getItem(MARKDOWN_KEY) !== "off";
}

export function persistNoteMarkdownShortcuts(enabled: boolean): void {
  localStorage.setItem(MARKDOWN_KEY, enabled ? "on" : "off");
}

/**
 * The shape the note list draws at the ROOT — "Sve beleške" and "Bez fascikle",
 * the two selections that are not a folder (NOTE-002).
 *
 * **Why this is not in the database.** Every OTHER note-list view is: a folder's
 * shape is a column on its own row (migration 039), so it travels with the
 * folder through an export and a restore, because "this is a folder of recipes,
 * show me cards" is a property of what is filed there. The root has no row to
 * hang that on. Migration 028's folder preferences are columns on `note_folders`
 * too — there is no note-preferences TABLE to extend — so storing the root's
 * choice in the profile would mean a new table holding one enum about a place in
 * the UI rather than about anything the profile contains. It belongs here
 * instead, beside the reading measure: same shape, same fallback, same file.
 *
 * The asymmetry is deliberate and visible: a folder's view syncs with the
 * profile, the root's stays on this machine.
 *
 * ONE key covers both rootless selections. They are the same reading situation
 * — "how do I read notes when I am not inside a folder" — and two keys would be
 * a second thing to explain for no difference the user asked for.
 *
 * The VALUE is `NoteFolderView`, not a parallel type: the toggle produces one
 * choice, and where it is written is the only thing the root changes.
 */
export const ROOT_NOTE_VIEWS: readonly NoteFolderView[] = ["list", "cards"];

/** Rows, matching the shape every folder opens in until its owner says otherwise (migration 039's own default). */
const DEFAULT_ROOT_VIEW: NoteFolderView = "list";

function isRootNoteView(value: string | null): value is NoteFolderView {
  return value != null && ROOT_NOTE_VIEWS.some((view) => view === value);
}

export function readStoredRootNoteView(): NoteFolderView {
  const stored = localStorage.getItem(ROOT_VIEW_KEY);
  return isRootNoteView(stored) ? stored : DEFAULT_ROOT_VIEW;
}

export function persistRootNoteView(view: NoteFolderView): void {
  localStorage.setItem(ROOT_VIEW_KEY, view);
}

/**
 * Forgets all three NOTE device preferences — „Beleške“'s „Vrati na
 * podrazumevano“ (SET §5). The three keys are ENUMERATED rather than swept by
 * prefix, so the reset can never grow to reach something else that happens to
 * be called `nexus.note…`.
 *
 * The root note view has no control on the Settings card (it is chosen in the
 * note list itself), but it IS one of this module's three device preferences,
 * so a card that says „vrati Beleške na podrazumevano“ would be lying if it
 * left it behind. Everything a folder stores stays untouched — that lives in
 * the profile, not here.
 *
 * The width is the only one with a document attribute, and it is rewritten
 * from the read that follows: an editor still laid out at „siroka“ has not
 * been reset.
 */
export function clearStoredNotePreferences(): void {
  localStorage.removeItem(WIDTH_KEY);
  localStorage.removeItem(MARKDOWN_KEY);
  localStorage.removeItem(ROOT_VIEW_KEY);
  document.documentElement.setAttribute("data-note-width", readStoredNoteWidth());
}
