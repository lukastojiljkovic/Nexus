import { ACCENT_IDS, type AccentId } from "@nexus/tokens";

/**
 * The pure decisions „Tabla"'s own toolbar makes (CANV slice b1).
 *
 * **Why there is a toolbar of ours at all.** Excalidraw ships 54 locales and
 * none of them is Serbian, and none can be added: the loader is a hard-coded
 * import map inside the bundle and `setLanguage` is not re-exported. Its colour
 * picker also offers violet, blue and orange — three hues this project bans
 * outright. So the editor is used as a drawing ENGINE and never as a user
 * interface: `app.css` hides its chrome, and `CanvasToolbar.tsx` drives it
 * through `ExcalidrawImperativeAPI` with our own controls, our own tokens and
 * our own strings.
 *
 * **Everything here is a decision, never a call.** The component holds the one
 * reference to the editor; this module holds what to ask it for — the tool
 * table, which control the editor's own state says is active, how a zoom step
 * lands, and which elements a colour change is allowed to touch. That is what
 * makes all of it testable in `apps/desktop`'s node-only Vitest, where there is
 * no DOM and no editor (`canvasBoards.ts`'s arrangement).
 *
 * **Three things here are restatements of Excalidraw's own internals**, each
 * for the reason `MERMAID_KEYWORDS` is one — the value is not exported, and a
 * type-only import would not survive to runtime. They are `carriesStrokeColour`
 * (its `hasStrokeColor`), the zoom bounds and step, and the centre-preserving
 * zoom algebra (its `getStateForZoom`). `canvasTools.test.ts` reads the
 * installed package and fails when any of them drifts.
 *
 * **What the API CANNOT drive, and is therefore not a button.** A dead control
 * is worse than an absent one, so this is written down rather than discovered:
 *
 * - **Undo and redo.** `ExcalidrawImperativeAPI.history` exposes `clear` and
 *   nothing else, and `registerAction` only ADDS an action — there is no way to
 *   RUN a named one. Ctrl+Z and Ctrl+Shift+Z are the whole story, and they work
 *   because the editor binds them itself.
 * - **Delete, duplicate, group, and layer order.** All are actions, with the
 *   same problem. They stay on the keyboard and in the editor's own right-click
 *   menu, which `app.css` deliberately leaves standing for exactly this reason.
 * - **Zoom as a method.** `zoomCanvas` is on the editor's App class but not on
 *   the imperative API, which is why `zoomAboutViewportCentre` exists below:
 *   the public route is `updateScene`, and it needs the scroll half too.
 *
 * **What the API COULD drive and this bar still leaves out**, deliberately, so
 * the next slice starts from the analysis rather than redoing it: opacity,
 * fill style (hachure/cross-hatch/solid), roughness, edge roundness,
 * arrowheads, and the text font, size and alignment. Every one of them is a
 * `currentItem*` key plus an element field, so each would follow the
 * `CANVAS_STYLE_CHANNELS` recipe exactly. They are out because a bar carrying
 * all of them is twice as tall for controls a person reaches for a fraction as
 * often as a colour — not because anything blocks them.
 */

/**
 * The tools our toolbar offers, in the order it draws them, with the editor's
 * own keyboard shortcut for each.
 *
 * **The ids are Excalidraw's `ToolType` values**, passed verbatim to
 * `setActiveTool` — a test reads the installed package's `constants.d.ts` and
 * fails if an upstream rename would turn one of these into a dead button.
 *
 * **The shortcuts are the editor's, not ours.** They keep working whether or
 * not this toolbar exists, which is precisely why each one is named in a
 * `title`: the fastest route to a tool is the key, and a toolbar that hid that
 * fact would be teaching the slower one.
 *
 * NOT offered, deliberately: `frame`, `embeddable`, `magicframe` and `laser`.
 * The first two are layout and web-embed concepts this product has no story
 * for, `magicframe` belongs to the AI path `CanvasPage` switches off with
 * `aiEnabled={false}`, and the laser pointer is a live-presentation device for
 * a shared session — which an offline, single-user canvas does not have. All
 * four remain reachable from the editor's own keyboard handling; none of them
 * would be a control anybody looked for here.
 */
export const CANVAS_TOOLS = [
  { id: "selection", shortcut: "V" },
  { id: "hand", shortcut: "H" },
  { id: "rectangle", shortcut: "R" },
  { id: "diamond", shortcut: "D" },
  { id: "ellipse", shortcut: "O" },
  { id: "arrow", shortcut: "A" },
  { id: "line", shortcut: "L" },
  { id: "freedraw", shortcut: "P" },
  { id: "text", shortcut: "T" },
  { id: "image", shortcut: "9" },
  { id: "eraser", shortcut: "E" },
] as const;

export type CanvasToolId = (typeof CANVAS_TOOLS)[number]["id"];

const CANVAS_TOOL_IDS: ReadonlySet<string> = new Set(CANVAS_TOOLS.map((tool) => tool.id));

/**
 * Which of OUR tools the editor is on, or null when it is on one we do not
 * draw (`frame`, `laser`, a custom tool).
 *
 * Null rather than a fallback to „Izbor", because the toolbar must never claim
 * a tool is active that is not: the editor's own keyboard handling can reach
 * tools this bar does not show, and a highlight sitting on „Izbor" while the
 * canvas is in frame mode is worse than no highlight at all.
 *
 * This is the whole reason the toolbar reads `appState.activeTool` instead of
 * remembering what was last clicked — press `R` on the keyboard and the
 * highlight moves, because the editor is the one source of truth about it.
 */
export function activeCanvasTool(activeTool: { readonly type: string }): CanvasToolId | null {
  return CANVAS_TOOL_IDS.has(activeTool.type) ? (activeTool.type as CanvasToolId) : null;
}

/**
 * The ink swatch — the drawing colour a board starts on, and the one entry in
 * the palette that is not an accent.
 *
 * It is `--nx-text`, exactly what `elementDefaults()` seeds a new scene's
 * stroke with, so „the colour it was already drawing in" is always reachable
 * from the palette rather than only from a fresh board.
 */
export const CANVAS_INK_ID = "mastilo";

export type CanvasSwatchId = typeof CANVAS_INK_ID | AccentId;

/**
 * The palette: ink, then the eight Nexus accents in the order Settings shows
 * them.
 *
 * All eight regardless of which one the profile picked, because this is a
 * DRAWING colour and not the app's accent — a diagram wants more than one hue,
 * and the accent that happens to be active is merely the first one it inherits
 * (`elementDefaults`). The tokens package publishes `--nx-swatch-<id>` for
 * exactly this: every accent's colour, readable whichever accent is live.
 */
export const CANVAS_SWATCHES: readonly CanvasSwatchId[] = [CANVAS_INK_ID, ...ACCENT_IDS];

/**
 * The CSS custom property a swatch paints from and writes into the scene.
 *
 * Two callers, and the split is the point: the dot on screen is painted with
 * `var(…)` and never reads anything, while the value stored in an element is
 * read off the computed style at PICK time — the same rule `elementDefaults()`
 * follows, and for the same reason. A colour literal in this file would be a
 * raw hex in the app's own source, which the raw-colour gate forbids; reading
 * it live is also what makes a swatch resolve under whichever theme is on when
 * it is clicked.
 */
export function canvasSwatchToken(id: CanvasSwatchId): string {
  return id === CANVAS_INK_ID ? "--nx-text" : `--nx-swatch-${id}`;
}

/**
 * A shape with no fill, and the default for every new one.
 *
 * A CSS keyword rather than a colour — it is Excalidraw's own default, and
 * `elementDefaults()` restates it for the reason stated there: a drawing whose
 * rectangles arrived pre-filled would be deciding something for the user.
 */
export const CANVAS_TRANSPARENT = "transparent";

/**
 * Stroke widths, as Excalidraw's own `STROKE_WIDTH` names them (`thin`, `bold`,
 * `extraBold`) and numbers them. Restated rather than imported: the constant is
 * declared in `constants.d.ts` and never re-exported from the package entry, so
 * there is no runtime value to import.
 */
export const CANVAS_STROKE_WIDTHS = [
  { id: "tanko", value: 1 },
  { id: "srednje", value: 2 },
  { id: "debelo", value: 4 },
] as const;

export type CanvasStrokeWidthId = (typeof CANVAS_STROKE_WIDTHS)[number]["id"];

/** Which width button is pressed, or null for a width the editor reached some other way. */
export function activeStrokeWidth(value: number): CanvasStrokeWidthId | null {
  return CANVAS_STROKE_WIDTHS.find((width) => width.value === value)?.id ?? null;
}

/* --- Style changes -------------------------------------------------------- */

/**
 * The three element properties this toolbar can change, and how each one
 * behaves — restated from the editor's own `changeStrokeColor`,
 * `changeBackgroundColor` and `changeStrokeWidth` actions, which are not
 * reachable through the imperative API (there is no way to run a named action;
 * `registerAction` only ADDS one).
 *
 * **`appStateKey` and `elementKey` are two different jobs, and both are
 * needed.** The `currentItem*` key decides what the NEXT shape is drawn with;
 * the element key changes what is selected right now. A control that only did
 * the first would appear dead to anybody who selected a rectangle and clicked a
 * colour, and one that only did the second would forget the choice the moment
 * the selection cleared.
 *
 * **`includeBoundText` is upstream's, verbatim.** A stroke colour reaches the
 * label inside a container (a rectangle and its caption are one thing to the
 * person who drew them); a fill and a width do not. Copying the distinction
 * rather than inventing one is what keeps this toolbar and the editor's own
 * keyboard shortcuts from disagreeing about the same document.
 */
export const CANVAS_STYLE_CHANNELS = {
  stroke: {
    appStateKey: "currentItemStrokeColor",
    elementKey: "strokeColor",
    includeBoundText: true,
  },
  background: {
    appStateKey: "currentItemBackgroundColor",
    elementKey: "backgroundColor",
    includeBoundText: false,
  },
  strokeWidth: {
    appStateKey: "currentItemStrokeWidth",
    elementKey: "strokeWidth",
    includeBoundText: false,
  },
} as const;

export type CanvasStyleChannel = keyof typeof CANVAS_STYLE_CHANNELS;

/**
 * Excalidraw's `hasStrokeColor`, restated: everything except an image and the
 * two frame kinds carries one.
 *
 * Only the stroke channel has such a guard, because only its own action does —
 * a fill or a width set on an element that ignores it is a no-op upstream too,
 * and adding a guard the editor does not have would make the two disagree.
 */
export function carriesStrokeColour(type: string): boolean {
  return type !== "image" && type !== "frame" && type !== "magicframe";
}

/** The little of an Excalidraw element this module needs to decide anything. */
export interface StyleableElement {
  readonly id: string;
  readonly type: string;
  readonly isDeleted?: boolean;
  /** Labels and arrows attached to a container; only the text ones matter here. */
  readonly boundElements?: readonly { readonly id: string; readonly type: string }[] | null;
}

/**
 * Which elements a style change applies to — the editor's `changeProperty`,
 * restated.
 *
 * **The input is the scene INCLUDING deleted elements**, because that is what
 * has to be handed back to `updateScene`, which replaces the element list
 * outright. Passing only the live ones would drop the tombstones an undo of a
 * delete needs. Deleted elements are skipped as targets all the same, which is
 * why `isDeleted` is read here rather than filtered by the caller.
 *
 * An empty set means „nothing is selected" — the caller then writes only the
 * `currentItem*` default and leaves the scene alone, which is the difference
 * between choosing a colour to draw with and repainting somebody's diagram.
 */
export function canvasStyleTargets(
  elements: readonly StyleableElement[],
  selectedIds: Readonly<Record<string, boolean | undefined>>,
  channel: CanvasStyleChannel,
): ReadonlySet<string> {
  const { includeBoundText } = CANVAS_STYLE_CHANNELS[channel];
  const byId = new Map(elements.map((element) => [element.id, element]));
  const targets = new Set<string>();

  const take = (element: StyleableElement | undefined): void => {
    if (element === undefined || element.isDeleted === true) return;
    if (channel === "stroke" && !carriesStrokeColour(element.type)) return;
    targets.add(element.id);
  };

  for (const element of elements) {
    if (selectedIds[element.id] !== true || element.isDeleted === true) continue;
    take(element);
    if (!includeBoundText) continue;
    for (const bound of element.boundElements ?? []) {
      if (bound.type === "text") take(byId.get(bound.id));
    }
  }
  return targets;
}

/* --- Zoom ----------------------------------------------------------------- */

/**
 * The editor's own `ZOOM_STEP`, `MIN_ZOOM` and `MAX_ZOOM`, restated — declared
 * in `constants.d.ts`, never re-exported as values. Matching them is what keeps
 * our „Uvećaj" and the editor's Ctrl + `+` landing on the same numbers.
 */
export const CANVAS_ZOOM_STEP = 0.1;
export const CANVAS_MIN_ZOOM = 0.1;
export const CANVAS_MAX_ZOOM = 30;

/** Excalidraw's `getNormalizedZoom`: rounded to six places, then clamped. */
export function normalizeCanvasZoom(value: number): number {
  const rounded = Math.round(value * 1e6) / 1e6;
  return Math.min(Math.max(rounded, CANVAS_MIN_ZOOM), CANVAS_MAX_ZOOM);
}

/** What the readout says. Whole percent, as the editor's own reset button shows it. */
export function formatZoomPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/** The `appState` fields a zoom step reads, and the three it writes back. */
export interface CanvasViewport {
  readonly zoom: number;
  readonly scrollX: number;
  readonly scrollY: number;
  readonly width: number;
  readonly height: number;
}

export interface CanvasViewportChange {
  readonly zoom: number;
  readonly scrollX: number;
  readonly scrollY: number;
}

/**
 * A zoom step that keeps the MIDDLE of the canvas still — Excalidraw's
 * `getStateForZoom` with the viewport centre as its anchor, which is the same
 * anchor its own zoom buttons and Ctrl + `+` use.
 *
 * **The scroll half is not optional.** `zoomCanvas` is a method on the editor's
 * App class and is NOT on `ExcalidrawImperativeAPI`, so the only public route
 * to a zoom level is `updateScene({ appState: { zoom } })` — and zoom alone
 * pins the top-left corner instead of the centre, which reads as the drawing
 * sliding away every time somebody zooms. Writing `scrollX`/`scrollY` in the
 * same call is what makes the step land where a person expects.
 *
 * The algebra collapses to one term: at the centre, `appLayerX` is `width / 2`,
 * and upstream's base-scroll and offset terms cancel to
 * `scrollX + (width / 2) * (1 / next - 1 / current)`.
 */
export function zoomAboutViewportCentre(
  view: CanvasViewport,
  nextZoom: number,
): CanvasViewportChange {
  const zoom = normalizeCanvasZoom(nextZoom);
  const shift = 1 / zoom - 1 / view.zoom;
  return {
    zoom,
    scrollX: view.scrollX + (view.width / 2) * shift,
    scrollY: view.scrollY + (view.height / 2) * shift,
  };
}

/* --- What the toolbar draws ----------------------------------------------- */

/**
 * Everything the toolbar RENDERS, and nothing else.
 *
 * `onChange` fires on every pointer move — hundreds of times per stroke — so
 * the bar cannot simply re-render from `appState`. It keeps this snapshot
 * instead and only re-renders when the snapshot actually differs
 * (`sameCanvasToolbarState`), which is the `getSceneVersion` trick
 * `CanvasPage`'s autosave already uses: cheap comparison in front of expensive
 * work.
 *
 * What is deliberately NOT here: the selection. Whether anything is selected
 * changes constantly during a drag and changes nothing on screen — so the
 * click handlers read it off `getAppState()` at the moment they need it,
 * rather than the bar re-rendering to hold it.
 */
export interface CanvasToolbarState {
  readonly tool: CanvasToolId | null;
  readonly stroke: string;
  readonly background: string;
  readonly strokeWidth: number;
  readonly zoom: number;
}

/** The `appState` fields the snapshot is taken from. */
export interface CanvasToolbarAppState {
  readonly activeTool: { readonly type: string };
  readonly currentItemStrokeColor: string;
  readonly currentItemBackgroundColor: string;
  readonly currentItemStrokeWidth: number;
  readonly zoom: { readonly value: number };
}

export function canvasToolbarStateOf(appState: CanvasToolbarAppState): CanvasToolbarState {
  return {
    tool: activeCanvasTool(appState.activeTool),
    stroke: appState.currentItemStrokeColor,
    background: appState.currentItemBackgroundColor,
    strokeWidth: appState.currentItemStrokeWidth,
    zoom: appState.zoom.value,
  };
}

export function sameCanvasToolbarState(a: CanvasToolbarState, b: CanvasToolbarState): boolean {
  return (
    a.tool === b.tool &&
    a.stroke === b.stroke &&
    a.background === b.background &&
    a.strokeWidth === b.strokeWidth &&
    a.zoom === b.zoom
  );
}

/**
 * Whether a swatch reads as chosen.
 *
 * Case-insensitively, because the colour on the element is whatever wrote it
 * last: our own swatches carry the computed token text, while the editor's
 * eyedropper and a pasted element can both put a differently-cased hex in the
 * same field. Two spellings of one colour must not light two different dots.
 */
export function sameCanvasColour(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}
