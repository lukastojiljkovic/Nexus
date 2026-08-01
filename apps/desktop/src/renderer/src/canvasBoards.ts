import type { CanvasBoard } from "../../shared/ipc.js";

/**
 * The pure decisions „Tabla" makes, kept out of the component so they can be
 * tested without an editor (`focusPhases.ts`'s arrangement).
 */

/**
 * The diagram keywords Excalidraw's own paste handler recognises, restated.
 *
 * **This list is a COPY, and the copy is load-bearing.** Excalidraw's
 * `isMermaidDefinition` is not exported, and its paste handler dynamic-imports
 * 3.35 MB of `@excalidraw/mermaid-to-excalidraw` and silently converts anything
 * that matches it. Somebody pasting a note that begins with the word „graph"
 * would get a diagram instead of their text, and — the other half of the same
 * problem — nobody would ever discover the feature on purpose. So `CanvasPage`
 * intercepts the paste through the supported `onPaste` prop, returns `false` for
 * a match (which cancels Excalidraw's own handling, mermaid branch included) and
 * inserts the text as text, while the conversion moves to an explicit button.
 *
 * The consequence of it being a copy: if Excalidraw ADDS a keyword and this list
 * does not, that one keyword goes back to converting on paste. The list is
 * therefore taken verbatim from `@excalidraw/excalidraw@0.18.1` and must be
 * re-checked on an upgrade — `canvasBoards.test.ts` pins it, so the check is a
 * failing test rather than a memory.
 */
export const MERMAID_KEYWORDS = [
  "flowchart",
  "graph",
  "sequenceDiagram",
  "classDiagram",
  "stateDiagram",
  "stateDiagram-v2",
  "erDiagram",
  "journey",
  "gantt",
  "pie",
  "quadrantChart",
  "requirementDiagram",
  "gitGraph",
  "C4Context",
  "mindmap",
  "timeline",
  "zenuml",
  "sankey",
  "xychart",
  "block",
] as const;

/**
 * Excalidraw's own detector, restated: an optional `%%{ … }%%` directive, then
 * one of the keywords, optionally suffixed `-beta`, at a word boundary.
 *
 * Deliberately as PERMISSIVE as theirs rather than stricter: this predicate
 * decides what we intercept, so anything it misses is something their handler
 * still converts silently — which is the behaviour being removed.
 */
const MERMAID_PATTERN = new RegExp(
  `^(?:%%\\{.*?\\}%%[\\s\\n]*)?\\b(?:${MERMAID_KEYWORDS.map((word) => `\\s*${word}(-beta)?`).join("|")})\\b`,
);

/** Whether Excalidraw would have converted this pasted text into a diagram behind the user's back. */
export function looksLikeMermaid(text: string): boolean {
  return MERMAID_PATTERN.test(text.trim());
}

/**
 * Which board to show once `deletedId` is gone.
 *
 * The NEIGHBOUR rather than the first board, and rather than nothing: deleting
 * the third of five and landing on the first would scroll the strip away from
 * where the user was working, while landing on nothing would make a delete feel
 * like a crash. The one after it, or the one before it when there is no after,
 * or null when that board was the last one there was.
 *
 * `boards` is the list as it stood BEFORE the delete — the caller has it already,
 * and computing from it is what makes „the one after" meaningful.
 */
export function boardAfterDelete(
  boards: readonly CanvasBoard[],
  deletedId: string,
): string | null {
  const index = boards.findIndex((board) => board.id === deletedId);
  if (index < 0) return boards[0]?.id ?? null;
  return boards[index + 1]?.id ?? boards[index - 1]?.id ?? null;
}

/**
 * Which board to show given a list and whatever the page was showing before.
 *
 * Keeps the current one whenever it is still there — a refresh after a rename or
 * a save must not move the user — and otherwise falls to the first, which is the
 * sr-Latn alphabetical head the store already sorted.
 */
export function resolveActiveBoard(
  boards: readonly CanvasBoard[],
  current: string | null,
): string | null {
  if (current !== null && boards.some((board) => board.id === current)) return current;
  return boards[0]?.id ?? null;
}
