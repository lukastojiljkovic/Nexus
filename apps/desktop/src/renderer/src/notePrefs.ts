/**
 * The two NOTE editor preferences (ADR-036), stored per device in
 * `localStorage` exactly as `theme.ts` and `accent.ts` store theirs: they
 * describe how this machine renders the editor, not what the profile contains,
 * so they belong beside the theme rather than in the encrypted database — and
 * they must be readable before the first paint, which an IPC round trip is not.
 *
 * Both readers narrow an arbitrary stored string to the typed value and fall
 * back to the default for anything unrecognized (including nothing stored yet),
 * so a hand-edited or stale key can never put the editor into a state the UI
 * cannot name.
 */

const WIDTH_KEY = "nexus.noteWidth";
const MARKDOWN_KEY = "nexus.noteMarkdownShortcuts";

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
