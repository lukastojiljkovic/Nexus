/**
 * What a canvas CARD points at — the reference a note, a task or an event rides
 * on a board as, and the grammar that decides whether a string is one.
 *
 * **Why this is URL-shaped at all.** Excalidraw puts a Nexus object on the board
 * as an *embeddable* element, and an embeddable's whole identity is its `link`:
 * a plain string the editor stores verbatim and hands back to the host, which
 * says whether it is renderable. So the form has to survive being a URL — that
 * is the container it travels in — and it has to be decidable by a total
 * predicate rather than by a formatter's good intentions.
 *
 * **Why the scheme is OURS, and why nothing outside this app may appear in it.**
 * Excalidraw's embeddable call site is, in substance,
 * `(isEmbeddable(el) ? renderEmbeddable?.(el, state) : null) ?? <iframe src=…>`:
 * a NULLISH return from the host's renderer falls through to a real iframe
 * pointed at the link. The predicate this module exists to underwrite is
 * therefore a security boundary inside a sandboxed renderer, not a formatting
 * nicety — every string it admits is a string the app has promised to draw
 * ITSELF, and every string it admits but then fails to draw becomes a frame.
 * `nexus:` is a scheme this product owns, carries nothing but an internal object
 * id, and is deliberately NOT among the schemes the desktop app registers
 * (`nx-blob`, `priv-blob` — see `registerSchemesAsPrivileged`): there is no
 * handler behind it and the renderer's `default-src 'self'` CSP has no frame
 * source for it, so even the fall-through loads nothing. That belt-and-braces is
 * the point. A `https:`, `file:`, `data:` or `javascript:` string must never
 * parse here, and neither must a foreign id shape — the whole value of the form
 * is that admitting it means „this is a row in this profile's database", and
 * nothing else.
 *
 * **Why the id shape is pinned rather than free.** Notes, tasks and events are
 * all keyed by `@nexus/db`'s `uuidv7()` — canonical lowercase, version nibble
 * `7`, variant nibble `8`/`9`/`a`/`b`. Accepting „any token" would let a
 * reference carry a path segment, a query string or a nested URL past the
 * predicate and into the store's `IN (…)` list, and would make the difference
 * between a renderable card and an iframe depend on a later parser instead of
 * this one. The narrowest class that still admits every id this codebase issues
 * is the right class, and this is it.
 *
 * Pure: no dependency on the editor, and none on the database. The store that
 * resolves these references and the IPC layer that validates them share ONE
 * definition of what a legal reference is rather than two copies that could
 * drift on it — `foodRefText`/`parseFoodRef`'s arrangement, for the same reason.
 */

/** The URL scheme a reference lives under. Ours, and deliberately unregistered — see the module header. */
export const CANVAS_REF_SCHEME = "nexus";

/** What a card may stand for. Closed: a kind outside this list does not parse, so it can never reach the resolver. */
export type CanvasRefKind = "note" | "task" | "event";

/** The closed list, in the order the resolver reads its three tables. */
export const CANVAS_REF_KINDS: readonly CanvasRefKind[] = ["note", "task", "event"];

/** One reference: a kind and the id of a row in this profile's database. */
export interface CanvasRef {
  readonly kind: CanvasRefKind;
  readonly id: string;
}

/**
 * The longest reference the grammar can produce — `nexus://event/` plus a
 * 36-character uuid. Exact rather than generous on purpose: it is what the IPC
 * validator caps one array element at, and a bound looser than the grammar would
 * be a second, weaker opinion about the same string.
 */
export const MAX_CANVAS_REF_LENGTH = 50;

/** `uuidv7()`'s canonical output, restated as a character class: lowercase hex, version `7`, variant `10xx`. */
const UUID_V7 = "[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";

/**
 * The whole grammar, anchored, built from the constants above so the scheme and
 * the kind list have exactly one spelling. Anchored with `^`/`$` and no `m`
 * flag, which in JavaScript means the very ends of the string — a trailing
 * newline is not an end, and a second reference smuggled onto a new line is not
 * a reference.
 */
const CANVAS_REF_PATTERN = new RegExp(
  `^${CANVAS_REF_SCHEME}://(${CANVAS_REF_KINDS.join("|")})/(${UUID_V7})$`,
);

/** The text an element's `link` holds. The ONE place that spelling is decided. */
export function canvasRefText(ref: CanvasRef): string {
  return `${CANVAS_REF_SCHEME}://${ref.kind}/${ref.id}`;
}

/**
 * Reads a stored or transmitted reference, or `null` when it is not one.
 *
 * The length guard in front of the pattern is not redundancy for its own sake:
 * this runs over strings a scene hands it, and a scene may carry several
 * megabytes of them, so the cheap bound comes first.
 */
export function parseCanvasRef(text: string): CanvasRef | null {
  if (text.length > MAX_CANVAS_REF_LENGTH) return null;
  const match = CANVAS_REF_PATTERN.exec(text);
  if (match === null) return null;
  return { kind: match[1] as CanvasRefKind, id: match[2] as string };
}

/**
 * Whether a string is a reference this app will draw itself — the predicate the
 * editor's `validateEmbeddable` is built on.
 *
 * Deliberately the SAME decision as `parseCanvasRef`, asked as a question rather
 * than a second implementation: a predicate that admitted one string more than
 * the parser would be a card the resolver cannot answer for, which is an iframe.
 */
export function isCanvasRefText(text: string): boolean {
  return parseCanvasRef(text) !== null;
}
