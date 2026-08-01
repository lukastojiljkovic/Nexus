import { CANVAS_REF_KINDS, canvasRefText, parseCanvasRef } from "@nexus/core";
import type { CanvasRef, CanvasRefKind } from "@nexus/core";
import type { ExcalidrawEmbeddableElement } from "@excalidraw/excalidraw/element/types";
import type { CanvasRefCard, SearchKind, SearchResult } from "../../shared/ipc.js";
import { formatContextDate } from "./searchShared.js";
import { strings } from "./strings.js";

/**
 * The pure decisions a CARD on „Tabla" makes (CANV slice c) — which references a
 * scene holds, whether that set changed, which of four things a card draws, and
 * the element a „Dodaj karticu" actually inserts.
 *
 * **What a card is, mechanically.** Excalidraw puts a Nexus object on the board
 * as an *embeddable*: an element whose whole identity is a `link` string the
 * editor stores verbatim, validates through `validateEmbeddable`, and hands back
 * to `renderEmbeddable` so the host can draw it instead of an iframe. Arrows
 * bind to embeddables like they bind to any other bindable element, which is why
 * this — rather than a group of rectangles and text — is what makes „notes
 * become cards you arrange spatially, with links drawn as arrows" true.
 *
 * **`link` is the source of truth, and `customData` is deliberately EMPTY.**
 * Both survive the JSON round trip, so the choice is not about persistence; it
 * is about which field the editor itself reads:
 *
 *  - `validateEmbeddable` is handed the LINK and nothing else. If the reference
 *    lived in `customData`, the predicate that decides „will this app draw it
 *    itself, or does it become an iframe" would be reading a different field
 *    from the one the card is built out of — and `canvasRef.ts`'s whole security
 *    argument (the predicate admits exactly what we promise to draw) collapses.
 *  - Excalidraw's own hyperlink editor can REWRITE an embeddable's link, and it
 *    re-runs validation when it does. It does not touch `customData`. Two fields
 *    would silently disagree the first time anybody used that popup.
 *  - `restore` normalizes `link` through `sanitizeUrl` on every load; a
 *    `nexus://kind/uuid` passes through unchanged (no scheme in sanitize-url's
 *    deny list, no host to lower-case, nothing to percent-decode), so the
 *    grammar survives the round trip that `customData` would merely bypass.
 *
 * One field, one spelling, one predicate. Nothing here reads `customData` and
 * nothing here writes it.
 *
 * **No migration and no interchange bump, deliberately.** A scene is stored
 * verbatim in `canvas_boards.scene` as one JSON document, and an embeddable is
 * an ordinary element inside it — so a board with cards is the same column, the
 * same validator (`parseCanvasScene`) and the same archive entry as a board
 * without. Slice c adds a kind of element, not a kind of storage. The absence of
 * a migration here is a decision, not an omission.
 *
 * **What the mechanism costs, recorded rather than discovered.** A card is a DOM
 * overlay positioned above the canvas, not something drawn INTO it, and three
 * consequences follow: it will not appear in a PNG/SVG export of the board (the
 * editor's own exporter renders embeddables only when explicitly asked, and then
 * as an iframe it cannot rasterize); its text is invisible to Excalidraw's own
 * canvas search, which indexes text elements; and the cost scales with the
 * number of cards on screen, since each one is a live React subtree. The store's
 * `MAX_CANVAS_REF_BATCH` (500) is the ceiling that bounds the last of those.
 *
 * Pure: no editor, no IPC, no DOM. Every colour and every upstream constant the
 * element needs is passed IN by the page that reads it off the live tokens —
 * `elementDefaults()`'s arrangement, and for its reason.
 */

/**
 * A card's box, in scene units.
 *
 * Wide enough for a title on one or two lines plus a context line at the app's
 * own type scale, and shorter than it is wide because that is the proportion a
 * list row has everywhere else in Nexus — a card is a row that happens to have
 * coordinates. Fixed rather than measured: the element's size is a scene value
 * written at insert time, the user can resize it afterwards like any other
 * element, and a card that re-measured itself would fight them for it.
 */
export const CANVAS_CARD_WIDTH = 260;
export const CANVAS_CARD_HEIGHT = 132;

/* --- Which references a scene holds --------------------------------------- */

/** The little of an Excalidraw element this module needs to find a reference on it. */
export interface CanvasSceneElement {
  readonly type: string;
  readonly link?: string | null;
  readonly isDeleted?: boolean;
}

/**
 * Every Nexus reference the scene currently carries, deduplicated, in scene
 * order.
 *
 * **Deleted elements are skipped, and that is not a detail.** Excalidraw's
 * `onChange` is handed `getElementsIncludingDeleted()` — the tombstones an undo
 * stands on ride in the same array — so a card the user just deleted would
 * otherwise stay in every resolve request for the life of the board.
 *
 * Only embeddables are considered. An ordinary shape may carry a `link` too (the
 * hyperlink popup puts one on anything), and one of those is a hyperlink on a
 * rectangle, not a card: it has no `renderEmbeddable` call behind it and nothing
 * to resolve.
 */
export function canvasSceneRefs(elements: readonly CanvasSceneElement[]): string[] {
  const refs = new Set<string>();
  for (const element of elements) {
    if (element.type !== "embeddable" || element.isDeleted === true) continue;
    const link = element.link;
    if (typeof link === "string" && parseCanvasRef(link) !== null) refs.add(link);
  }
  return [...refs];
}

/**
 * Whether two reference lists name the same SET — the guard that keeps
 * resolution off the pointer-move path.
 *
 * `onChange` fires hundreds of times per stroke, and moving a card changes the
 * scene without changing what is on it; so does re-ordering two cards, and so
 * does drawing a rectangle beside them. What must trigger a re-resolve is a
 * reference appearing or disappearing, nothing else. This is `getSceneVersion`'s
 * trick applied to a different question: a cheap comparison in front of an
 * expensive round trip.
 *
 * Both inputs come from `canvasSceneRefs` and are therefore already
 * deduplicated, which is what makes „same length and every one present" the
 * whole of set equality rather than half of it.
 */
export function sameCanvasRefs(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const present = new Set(a);
  return b.every((ref) => present.has(ref));
}

/**
 * The resolver's positional answer, turned into the map a card looks itself up
 * in.
 *
 * `resolveRefs` answers one card per reference asked, in the order asked
 * (its own contract) — so this is a zip, and the guard on a short answer is
 * there because a card with NO entry draws „loading", which is the honest state
 * for a reference nothing answered for, while a card zipped against the wrong
 * neighbour would draw somebody else's note under this one's arrow.
 */
export function canvasCardMap(
  refs: readonly string[],
  cards: readonly CanvasRefCard[],
): Map<string, CanvasRefCard> {
  const byRef = new Map<string, CanvasRefCard>();
  refs.forEach((ref, index) => {
    const card = cards[index];
    if (card !== undefined) byRef.set(ref, card);
  });
  return byRef;
}

/* --- What one card draws --------------------------------------------------- */

/**
 * The four things a card can be, and there is no fifth.
 *
 * A closed union rather than a record with nullable fields, because every one of
 * these has to RENDER — a card that fell through to nothing is the one outcome
 * `renderEmbeddable` may never produce (see `CanvasCard.tsx`'s header for what a
 * nullish return costs).
 */
export type CanvasCardView =
  | { readonly state: "ready"; readonly ref: CanvasRef; readonly title: string; readonly detail: string | null }
  | { readonly state: "missing"; readonly ref: CanvasRef }
  | { readonly state: "loading"; readonly ref: CanvasRef }
  | { readonly state: "foreign" };

/**
 * Which of the four a given link and a given resolution map add up to. Total:
 * every input has an answer, including `null`, `""` and a link that is not ours.
 *
 * The lookup is keyed by the link TEXT, which is safe precisely because
 * `parseCanvasRef` admits one canonical spelling and no other — there is no
 * second way to write the same reference that would miss the map.
 */
export function canvasCardView(
  link: string | null | undefined,
  resolved: ReadonlyMap<string, CanvasRefCard>,
): CanvasCardView {
  if (typeof link !== "string") return { state: "foreign" };
  const ref = parseCanvasRef(link);
  if (ref === null) return { state: "foreign" };
  const card = resolved.get(link);
  if (card === undefined) return { state: "loading", ref };
  if (card.missing) return { state: "missing", ref };
  return { state: "ready", ref, title: card.title, detail: canvasCardDetail(card.detail) };
}

/**
 * The context line, in Serbian, or null when this kind has none.
 *
 * `detail` is raw column text — a task's `due_date`, an event's `start_at`, and
 * nothing at all for a note, which has no second fact its own list rows show.
 * That is migration 017's `context_date` per kind, which is exactly what the
 * search row beside it draws, so the formatting is `formatContextDate`'s rather
 * than a third opinion about the same two column shapes: a bare "YYYY-MM-DD"
 * reads as a day, a full instant as „HH:MM danas" or a day and a time.
 *
 * An empty string is treated as absent. A stored date is never blank, but a card
 * showing an empty second line would be a layout the data cannot justify.
 */
export function canvasCardDetail(detail: string | null): string | null {
  if (detail === null || detail.trim().length === 0) return null;
  return formatContextDate(detail);
}

/**
 * What the card shows as its title.
 *
 * The store hands back the row's own `title` column verbatim — „a note that was
 * never named carries the empty string it really has" — so the fallback belongs
 * here, on the surface, and never in the read. A card is a pointer with nothing
 * else to show, so an untitled one has to say so rather than draw a blank.
 */
export function canvasCardTitle(title: string): string {
  return title.trim().length === 0 ? strings.canvas.card.untitled : title;
}

/**
 * How the editor currently regards this element, which is the only thing that
 * decides whether a click on our card can land at all.
 *
 * Excalidraw gates an embeddable's DOM overlay behind `pointerEvents`, enabled
 * only while `appState.activeEmbeddable` names this element with state
 * „active". Hovering the middle third arms it („hover"); a short click there
 * makes it active; only THEN does a second click reach anything we rendered.
 * That is the editor's own two-step, and this reads it rather than fighting it
 * — see `CanvasCard.tsx` for why the hint that goes with it is ours.
 */
export type CanvasCardInteraction = "idle" | "hint" | "active";

export function canvasCardInteraction(
  elementId: string,
  activeEmbeddable: { readonly element: { readonly id: string }; readonly state: string } | null,
): CanvasCardInteraction {
  if (activeEmbeddable === null || activeEmbeddable.element.id !== elementId) return "idle";
  return activeEmbeddable.state === "active" ? "active" : "hint";
}

/* --- What the picker offers ------------------------------------------------ */

/** One offerable object: everything „Dodaj karticu" draws and everything a reference needs. */
export interface CanvasPickerRow {
  readonly kind: CanvasRefKind;
  readonly id: string;
  readonly title: string;
  /** The row's own `contextDate`, already formatted — null for a note and for a kind that carries none. */
  readonly detail: string | null;
}

/**
 * The `CanvasRefKind` a search hit stands for, or null when a card cannot point
 * at that kind of thing.
 *
 * `SearchKind` is the wider vocabulary — it also indexes documents, subjects,
 * exams, decks, cards and attachments — and `CanvasRefKind` is the closed three
 * a reference admits. Asked as a lookup into the reference grammar's own list
 * rather than restated as a second table, so a kind added to one side can never
 * quietly become droppable on the other.
 */
export function canvasRefKindOf(kind: SearchKind): CanvasRefKind | null {
  return CANVAS_REF_KINDS.find((candidate) => candidate === kind) ?? null;
}

/**
 * The picker's rows, from whatever the search surface answered.
 *
 * **The search channels are the right source and they carry exactly enough.**
 * A `SearchResult` names its `kind` and its `entityId`, which is the whole of a
 * reference, plus the `title` and `contextDate` the card will draw — so the
 * picker needs no channel of its own, and „recent with no query, live search as
 * you type" comes free with `searchRecent`/`searchQuery`.
 *
 * **And they carry the module gate with them**, which is why reusing them is not
 * merely convenient. `searchGate.ts` filters every hit by the profile's enabled
 * modules in MAIN, on the one shared path all three search channels take — so a
 * profile with BELEŠKE switched off cannot be offered a note here, and a picker
 * with its own read would have had to re-implement that rule or quietly break
 * it (ADR-058 §5 is the note about what happens when two surfaces disagree
 * about the same gate).
 *
 * Kinds a card cannot point at are dropped rather than shown greyed: „Dodaj
 * karticu" is not a search page, and a row that cannot be picked is a row that
 * should not be drawn.
 */
export function canvasPickerRows(results: readonly SearchResult[]): CanvasPickerRow[] {
  const rows: CanvasPickerRow[] = [];
  for (const result of results) {
    const kind = canvasRefKindOf(result.kind);
    if (kind === null) continue;
    rows.push({
      kind,
      id: result.entityId,
      title: canvasCardTitle(result.title),
      detail: canvasCardDetail(result.contextDate),
    });
  }
  return rows;
}

/* --- Putting a card on the board ------------------------------------------- */

/** The `appState` fields a drop reads. `CanvasToolbar`'s `CanvasViewport`, minus what a zoom step needs and nothing more. */
export interface CanvasDropViewport {
  readonly scrollX: number;
  readonly scrollY: number;
  readonly width: number;
  readonly height: number;
  readonly zoom: number;
}

/**
 * Where a new element goes when nothing pointed at a spot: the middle of what is
 * on screen, in scene coordinates, with the element's own box centred on it.
 *
 * This is `onPaste`'s arithmetic, lifted rather than copied — the pasted text
 * element asks for it with a zero-sized box, a card asks for it with its own,
 * and the two must not be able to drift on what „the centre" means. Scene
 * coordinates are viewport coordinates divided by the zoom and offset by the
 * scroll, which is why all three fields are read.
 */
export function canvasDropOrigin(
  view: CanvasDropViewport,
  width: number,
  height: number,
): { x: number; y: number } {
  return {
    x: -view.scrollX + view.width / 2 / view.zoom - width / 2,
    y: -view.scrollY + view.height / 2 / view.zoom - height / 2,
  };
}

/**
 * Everything the element needs that this module will not invent: the two colour
 * STRINGS (read off the live `--nx-*` tokens by the page, exactly as
 * `elementDefaults()` does, because a literal here would be a raw hex in the
 * app's own source), Excalidraw's own corner-radius constant, and an id and a
 * seed the caller mints.
 */
export interface CanvasCardElementInput {
  readonly ref: CanvasRef;
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly strokeColor: string;
  readonly backgroundColor: string;
  /** `ROUNDNESS.ADAPTIVE_RADIUS`, handed in by the page — the editor's constant, not a number of ours. */
  readonly roundness: ExcalidrawEmbeddableElement["roundness"];
  /** Seeds roughjs so the border does not re-scribble on every frame. */
  readonly seed: number;
  readonly updated: number;
}

/**
 * The element a picked object becomes — a COMPLETE embeddable, deliberately.
 *
 * **`convertToExcalidrawElements` will not build one for you, and that is worth
 * saying out loud.** Its transform has a factory per element type — `newElement`
 * for the shapes, `newTextElement` for text, `newImageElement` for an image —
 * but its `case "freedraw": case "iframe": case "embeddable"` arm is `s = l`:
 * the skeleton is passed through VERBATIM, with only the id regenerated and the
 * fractional index synced afterwards. Its `ExcalidrawElementSkeleton` type says
 * the same thing more quietly, by admitting the whole `ExcalidrawEmbeddableElement`
 * for these kinds instead of a partial. So a half-built skeleton would land in
 * the scene half-built — no `version`, no `seed`, no `versionNonce` — and
 * `getSceneVersion` (the autosave's whole guard) sums a field that would not be
 * there. It is still `convertToExcalidrawElements` that inserts it, for the id
 * and the index; this is just the half it does not do.
 *
 * `customData` is absent rather than empty — see the module header for why the
 * reference lives in `link` and in nothing else.
 */
export function canvasCardElement(input: CanvasCardElementInput): ExcalidrawEmbeddableElement {
  return {
    type: "embeddable",
    id: input.id,
    x: input.x,
    y: input.y,
    width: CANVAS_CARD_WIDTH,
    height: CANVAS_CARD_HEIGHT,
    // `Radians` is a branded number and nothing exported mints one. Zero
    // radians is zero in any brand, which is what makes this the assertion the
    // brand is asking for rather than a way around it — `zoomAboutViewportCentre`'s
    // `NormalizedZoomValue` cast, for the same reason.
    angle: 0 as ExcalidrawEmbeddableElement["angle"],
    strokeColor: input.strokeColor,
    backgroundColor: input.backgroundColor,
    fillStyle: "solid",
    strokeWidth: 1,
    strokeStyle: "solid",
    // Zero, not the editor's default 1: a Nexus card is a card, not a sketch,
    // and a hand-drawn wobble around a typographic surface would read as two
    // design languages in one box.
    roughness: 0,
    opacity: 100,
    roundness: input.roundness,
    seed: input.seed,
    // `version` counts edits and `versionNonce` breaks ties between two peers
    // that made the same edit — a collaboration concern this offline product
    // does not have. The editor takes both over from the first change onwards.
    version: 1,
    versionNonce: 0,
    // Assigned by `syncInvalidIndices` when the element joins the scene; an
    // element that has never been in one has no place in its ordering yet.
    index: null,
    isDeleted: false,
    groupIds: [],
    frameId: null,
    boundElements: null,
    updated: input.updated,
    link: canvasRefText(input.ref),
    locked: false,
  };
}
