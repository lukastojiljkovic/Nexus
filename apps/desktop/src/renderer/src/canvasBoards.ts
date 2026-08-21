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

/*
 * „Which board do I land on" used to live here as `boardAfterDelete` and
 * `resolveActiveBoard`. Neither ever read more than a board's `id`, and
 * „Elektronika" asks the identical two questions about circuits, so they moved
 * to `pickedList.ts` rather than being copied — see that file's own comment.
 */
