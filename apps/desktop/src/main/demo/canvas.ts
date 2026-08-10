import { CanvasStore, NoteStore, TaskStore } from "@nexus/db";
import { CANVAS_SCENE_TYPE, canvasRefText, serializeCanvasScene } from "@nexus/core";
import type { CanvasRef, CanvasRefKind, CanvasScene } from "@nexus/core";
import { accents, themes } from "@nexus/tokens";
import type { AccentId } from "@nexus/tokens";
import { demoRandom } from "./context.js";
import type { DatabaseHandle, DemoContext, DemoRandom } from "./context.js";

/**
 * CANV's demo slice: three boards, in Serbian, that between them show what
 * „Tabla" is for — a sticky-note weekly plan, a boxes-and-arrows system
 * diagram, and a hand-drawn mind map that also carries Nexus cards. Every
 * other module has a seeder; this is the one that gives „Tabla" the same
 * treatment, through the same public store (`CanvasStore.create`) the IPC
 * handler uses.
 *
 * **A scene is written as raw Excalidraw JSON, not built through the
 * editor.** `CanvasStore` stores `serializeAsJSON`'s document VERBATIM
 * (`canvasScene.ts`'s own header), and this file is main-process code that
 * never touches the editor — so the elements below are the exact shape
 * `restore()` (the renderer's own migrator, `chunk-4FTI6OG3.js` in the
 * installed package) expects a stored document to already be in, field for
 * field, rather than a skeleton the editor would complete for us.
 *
 * **`restore()` runs WITHOUT its binding-repair pass here, which is why every
 * cross-reference below is hand-correct.** `CanvasPage.loadScene` calls
 * `restore(data, null, null)` — three arguments, no `opts` — and
 * `restoreElements` only walks `repairContainerElement`/`repairBoundElement`/
 * the binding-nulling loop when `opts?.repairBindings` is truthy. Left
 * undefined, as it is here, NONE of that runs: a container's `boundElements`
 * and a bound text's `containerId` are taken exactly as stored, with nothing
 * to reconcile them if they disagree. So every rectangle/ellipse below lists
 * its bound text (and, where one lands on it, its bound arrows) in
 * `boundElements`, and every bound text carries the matching `containerId` —
 * both sides written by the same call, never inferred.
 *
 * **Every colour is Dan's, in both themes** — `canvasPalette.ts`'s rule,
 * restated here because that module is a renderer file this one cannot
 * import. Excalidraw inverts the whole canvas under Noć
 * (`invert(93%) hue-rotate(180deg)`), so the value that survives the
 * inversion and reads correctly in both themes is always the light one.
 * `@nexus/tokens` is imported directly for exactly the reason
 * `canvasPalette.ts` gives for doing the same: the live theme only ever
 * exposes the ACTIVE palette, and this needs a specific one regardless of
 * which theme the profile is in.
 *
 * **Three constants are restatements of the installed `@excalidraw/excalidraw`
 * package**, for the same reason `canvasTools.ts` restates `ROUNDNESS`,
 * `ZOOM_STEP` and the rest: a value exported from a package this file must not
 * depend on (main has no business importing an Electron+React drawing editor).
 * `ROUNDNESS.ADAPTIVE_RADIUS` is `3`, `FONT_FAMILY.Excalifont` is `5`, and its
 * own line-height metric is `1.25` — all three read straight out of
 * `constants.d.ts`/`FontMetadata.ts` in `node_modules/@excalidraw/excalidraw`.
 *
 * **Two Nexus cards ride on „Nedeljni plan"**, CANV's distinguishing feature
 * over a plain drawing tool: a card is an `embeddable` element whose `link` is
 * `nexus://kind/uuid` (`canvasRefText`, the one place that spelling exists).
 * The ids come from actually reading the rows `seedDemoTasks`/`seedDemoNotes`
 * wrote, through the same `TaskStore`/`NoteStore` the app itself queries — a
 * title this file no longer recognises resolves to `null` and its card is
 * simply omitted, never a uuid invented to fill the slot. That is also why
 * `seedDemoCanvas` must run after both of them in `index.ts`.
 *
 * Deterministic throughout: one `demoRandom("canvas")` stream feeds every
 * roughjs `seed` below (never `Math.random`), and every element's `updated`
 * timestamp is `ctx.now` (never `Date.now`).
 */

// --- Restatements of the installed @excalidraw/excalidraw package -----------

/** `ROUNDNESS.ADAPTIVE_RADIUS` — the rounded-corner style every shape below uses. */
const ROUNDNESS_ADAPTIVE = 3;
/** `FONT_FAMILY.Excalifont` — the hand-drawn face every text element is set in. */
const FONT_FAMILY_EXCALIFONT = 5;
/** Excalifont's own line-height metric (`FontMetadata.ts`), for text sizing below. */
const EXCALIFONT_LINE_HEIGHT = 1.25;
/** A CSS keyword, not a colour — Excalidraw's own default fill, exempt from the colour gate. */
const TRANSPARENT = "transparent";

// --- Colour rule (Dan's values, in both themes — see the module doc) --------

const INK = themes.dan.text;
/** The two colours a Nexus card is drawn with — `canvasPalette.ts`'s own pair. */
const CARD_STROKE = themes.dan.border;
const CARD_FILL = themes.dan.surface;
/** `canvasCards.ts`'s own card box, restated: main cannot import that renderer module either. */
const CARD_WIDTH = 260;
const CARD_HEIGHT = 132;

// --- The generic element shapes every board is built from --------------------

/** The little of an Excalidraw element this file writes; `restore()` fills in the rest. */
type SceneElement = Record<string, unknown>;

/** One entry in a container's `boundElements` — a bound text or a bound arrow. */
interface BoundRef {
  readonly id: string;
  readonly type: "text" | "arrow";
}

interface ShapeSpec {
  readonly id: string;
  readonly kind: "rectangle" | "ellipse";
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly strokeColor: string;
  readonly backgroundColor: string;
  /** `ROUGHNESS.architect`/`artist`/`cartoonist` — 0 is clean, 2 is hand-drawn. */
  readonly roughness: 0 | 1 | 2;
  readonly seed: number;
  readonly bound: readonly BoundRef[];
}

function shape(spec: ShapeSpec, updated: number): SceneElement {
  return {
    type: spec.kind,
    id: spec.id,
    x: spec.x,
    y: spec.y,
    width: spec.width,
    height: spec.height,
    angle: 0,
    strokeColor: spec.strokeColor,
    backgroundColor: spec.backgroundColor,
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: spec.roughness,
    opacity: 100,
    roundness: { type: ROUNDNESS_ADAPTIVE },
    seed: spec.seed,
    version: 1,
    versionNonce: 0,
    index: null,
    isDeleted: false,
    groupIds: [],
    frameId: null,
    boundElements: spec.bound,
    updated,
    link: null,
    locked: false,
  };
}

interface LabelSpec {
  readonly id: string;
  /** The shape or arrow this text is bound inside, or null for a free-standing heading. */
  readonly containerId: string | null;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly text: string;
  readonly fontSize: number;
  readonly color: string;
  readonly seed: number;
  /** Left for a free-standing heading; centered (the default) for anything bound. */
  readonly align?: "left" | "center";
}

function label(spec: LabelSpec, updated: number): SceneElement {
  return {
    type: "text",
    id: spec.id,
    x: spec.x,
    y: spec.y,
    width: spec.width,
    height: spec.height,
    angle: 0,
    strokeColor: spec.color,
    backgroundColor: TRANSPARENT,
    fillStyle: "solid",
    strokeWidth: 1,
    strokeStyle: "solid",
    roughness: 0,
    opacity: 100,
    roundness: null,
    seed: spec.seed,
    version: 1,
    versionNonce: 0,
    index: null,
    isDeleted: false,
    groupIds: [],
    frameId: null,
    boundElements: null,
    updated,
    link: null,
    locked: false,
    text: spec.text,
    fontSize: spec.fontSize,
    fontFamily: FONT_FAMILY_EXCALIFONT,
    textAlign: spec.align ?? "center",
    verticalAlign: spec.containerId === null ? "top" : "middle",
    containerId: spec.containerId,
    originalText: spec.text,
    autoResize: true,
    lineHeight: EXCALIFONT_LINE_HEIGHT,
  };
}

interface ArrowSpec {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  /** The second (and last) point, relative to `x`/`y` — every arrow here is a straight two-point
   *  one. */
  readonly dx: number;
  readonly dy: number;
  readonly strokeColor: string;
  readonly roughness: 0 | 1 | 2;
  readonly seed: number;
  readonly startId: string;
  readonly endId: string;
  readonly labelId?: string;
}

function arrow(spec: ArrowSpec, updated: number): SceneElement {
  return {
    type: "arrow",
    id: spec.id,
    x: spec.x,
    y: spec.y,
    width: Math.abs(spec.dx),
    height: Math.abs(spec.dy),
    angle: 0,
    strokeColor: spec.strokeColor,
    backgroundColor: TRANSPARENT,
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: spec.roughness,
    opacity: 100,
    roundness: null,
    seed: spec.seed,
    version: 1,
    versionNonce: 0,
    index: null,
    isDeleted: false,
    groupIds: [],
    frameId: null,
    boundElements: spec.labelId === undefined ? null : [{ id: spec.labelId, type: "text" }],
    updated,
    link: null,
    locked: false,
    points: [
      [0, 0],
      [spec.dx, spec.dy],
    ],
    lastCommittedPoint: null,
    startBinding: { elementId: spec.startId, focus: 0, gap: 4 },
    endBinding: { elementId: spec.endId, focus: 0, gap: 4 },
    startArrowhead: null,
    endArrowhead: "arrow",
    elbowed: false,
  };
}

/** A Nexus card — `canvasCards.ts`'s `canvasCardElement`, restated for the reason above. */
function card(
  id: string,
  ref: CanvasRef,
  x: number,
  y: number,
  seed: number,
  updated: number,
): SceneElement {
  return {
    type: "embeddable",
    id,
    x,
    y,
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    angle: 0,
    strokeColor: CARD_STROKE,
    backgroundColor: CARD_FILL,
    fillStyle: "solid",
    strokeWidth: 1,
    strokeStyle: "solid",
    roughness: 0,
    opacity: 100,
    roundness: { type: ROUNDNESS_ADAPTIVE },
    seed,
    version: 1,
    versionNonce: 0,
    index: null,
    isDeleted: false,
    groupIds: [],
    frameId: null,
    boundElements: null,
    updated,
    link: canvasRefText(ref),
    locked: false,
  };
}

/** The next roughjs seed off this run's own stream — never `Math.random`. */
function nextSeed(rnd: DemoRandom): number {
  return rnd.int(1, 2_147_483_647);
}

function scene(elements: readonly SceneElement[]): CanvasScene {
  return {
    type: CANVAS_SCENE_TYPE,
    version: 2,
    source: "nexus",
    elements: [...elements],
    appState: {},
    files: {},
  };
}

// --- Board 1: „Nedeljni plan" — sticky notes in day columns, plus cards ------

interface StickySpec {
  readonly text: string;
  readonly accent: AccentId;
}

interface WeekColumn {
  readonly x: number;
  readonly heading: string;
  readonly stickies: readonly [StickySpec, StickySpec];
}

const WEEK_COLUMNS: readonly WeekColumn[] = [
  {
    x: 60,
    heading: "Ponedeljak",
    stickies: [
      { text: "Sastanak sa mentorom", accent: "zlato" },
      { text: "Vežbe iz baza podataka", accent: "suma" },
    ],
  },
  {
    x: 380,
    heading: "Sreda",
    stickies: [
      { text: "Domaći: mašinsko učenje", accent: "bordo" },
      { text: "Teretana posle posla", accent: "bronza" },
    ],
  },
  {
    x: 700,
    heading: "Petak",
    stickies: [
      { text: "Radni sati — izveštaj", accent: "zlato" },
      { text: "Generalno čišćenje", accent: "suma" },
    ],
  },
];

const STICKY_WIDTH = 260;
const STICKY_HEIGHT = 90;
const STICKY_TEXT_WIDTH = 236;
const STICKY_TEXT_HEIGHT = 22;
const STICKY_Y_TOP = 100;
const STICKY_Y_BOTTOM = 210;
const CARDS_HEAD_Y = 330;
const CARDS_Y = 365;

/** One sticky note — a rectangle with its bound text, the only pair this board repeats. */
function sticky(
  id: string,
  x: number,
  y: number,
  spec: StickySpec,
  rnd: DemoRandom,
  updated: number,
): SceneElement[] {
  const rectId = `${id}-rect`;
  const textId = `${id}-text`;
  const palette = accents.dan[spec.accent];
  return [
    shape(
      {
        id: rectId,
        kind: "rectangle",
        x,
        y,
        width: STICKY_WIDTH,
        height: STICKY_HEIGHT,
        strokeColor: palette.accent,
        backgroundColor: palette.accentSoft,
        roughness: 1,
        seed: nextSeed(rnd),
        bound: [{ id: textId, type: "text" }],
      },
      updated,
    ),
    label(
      {
        id: textId,
        containerId: rectId,
        x: x + (STICKY_WIDTH - STICKY_TEXT_WIDTH) / 2,
        y: y + (STICKY_HEIGHT - STICKY_TEXT_HEIGHT) / 2,
        width: STICKY_TEXT_WIDTH,
        height: STICKY_TEXT_HEIGHT,
        text: spec.text,
        fontSize: 16,
        color: INK,
        seed: nextSeed(rnd),
      },
      updated,
    ),
  ];
}

/** The three Nexus objects „Nedeljni plan" offers a card for — found, never invented. */
interface WeeklyPlanCards {
  readonly cv: CanvasRef | null;
  readonly interview: CanvasRef | null;
  readonly thesis: CanvasRef | null;
}

/** One card's column and id, paired with the reference `refFor` found for it (or none). */
interface CardSlot {
  readonly x: number;
  readonly id: string;
  readonly ref: CanvasRef | null;
}

function buildWeeklyPlanScene(
  rnd: DemoRandom,
  updated: number,
  cards: WeeklyPlanCards,
): CanvasScene {
  const elements: SceneElement[] = [];

  WEEK_COLUMNS.forEach((column, index) => {
    elements.push(
      label(
        {
          id: `wk-head-${index}`,
          containerId: null,
          x: column.x,
          y: 40,
          width: STICKY_WIDTH,
          height: 28,
          text: column.heading,
          fontSize: 22,
          color: INK,
          seed: nextSeed(rnd),
          align: "left",
        },
        updated,
      ),
    );
    const [top, bottom] = column.stickies;
    elements.push(...sticky(`wk-${index}-a`, column.x, STICKY_Y_TOP, top, rnd, updated));
    elements.push(...sticky(`wk-${index}-b`, column.x, STICKY_Y_BOTTOM, bottom, rnd, updated));
  });

  elements.push(
    label(
      {
        id: "wk-cards-head",
        containerId: null,
        x: 60,
        y: CARDS_HEAD_Y,
        width: 300,
        height: 23,
        text: "Iz Nexusa",
        fontSize: 18,
        color: INK,
        seed: nextSeed(rnd),
        align: "left",
      },
      updated,
    ),
  );

  const cardSlots: readonly CardSlot[] = [
    { x: 60, id: "wk-card-cv", ref: cards.cv },
    { x: 380, id: "wk-card-interview", ref: cards.interview },
    { x: 700, id: "wk-card-thesis", ref: cards.thesis },
  ];
  for (const slot of cardSlots) {
    if (slot.ref === null) continue;
    elements.push(card(slot.id, slot.ref, slot.x, CARDS_Y, nextSeed(rnd), updated));
  }

  return scene(elements);
}

// --- Board 2: „Arhitektura sistema" — boxes joined by labelled arrows --------

interface ArchBox {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly text: string;
}

const ARCH_BOX_WIDTH = 240;
const ARCH_BOX_HEIGHT = 100;
const ARCH_TEXT_WIDTH = 200;
const ARCH_TEXT_HEIGHT = 28;

const ARCH_BOXES: readonly ArchBox[] = [
  { id: "arch-desktop", x: 60, y: 60, text: "Desktop aplikacija" },
  { id: "arch-web", x: 60, y: 320, text: "Web aplikacija" },
  { id: "arch-supabase", x: 460, y: 190, text: "Supabase" },
  { id: "arch-postgres", x: 900, y: 190, text: "PostgreSQL baza" },
];

interface ArchArrow {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly x: number;
  readonly y: number;
  readonly dx: number;
  readonly dy: number;
  readonly label: string;
  readonly labelX: number;
  readonly labelY: number;
}

const ARCH_LABEL_WIDTH = 190;
const ARCH_LABEL_HEIGHT = 24;

const ARCH_ARROWS: readonly ArchArrow[] = [
  {
    id: "arch-arrow-sync",
    from: "arch-desktop",
    to: "arch-supabase",
    x: 300,
    y: 110,
    dx: 160,
    dy: 130,
    label: "Sinhronizacija (E2EE)",
    labelX: 285,
    labelY: 163,
  },
  {
    id: "arch-arrow-web",
    from: "arch-web",
    to: "arch-supabase",
    x: 300,
    y: 370,
    dx: 160,
    dy: -130,
    label: "HTTPS / REST",
    labelX: 285,
    labelY: 293,
  },
  {
    id: "arch-arrow-db",
    from: "arch-supabase",
    to: "arch-postgres",
    x: 700,
    y: 240,
    dx: 200,
    dy: 0,
    label: "Upiti",
    labelX: 705,
    labelY: 228,
  },
];

/** Every arrow id that starts or ends on `boxId` — what a box's own `boundElements` must list. */
function archArrowIds(boxId: string): readonly string[] {
  return ARCH_ARROWS.filter((candidate) => candidate.from === boxId || candidate.to === boxId).map(
    (candidate) => candidate.id,
  );
}

function archBoxElements(box: ArchBox, rnd: DemoRandom, updated: number): SceneElement[] {
  const textId = `${box.id}-text`;
  const bound: BoundRef[] = [
    { id: textId, type: "text" },
    ...archArrowIds(box.id).map((id): BoundRef => ({ id, type: "arrow" })),
  ];
  return [
    shape(
      {
        id: box.id,
        kind: "rectangle",
        x: box.x,
        y: box.y,
        width: ARCH_BOX_WIDTH,
        height: ARCH_BOX_HEIGHT,
        strokeColor: INK,
        backgroundColor: accents.dan.grafit.accentSoft,
        roughness: 0,
        seed: nextSeed(rnd),
        bound,
      },
      updated,
    ),
    label(
      {
        id: textId,
        containerId: box.id,
        x: box.x + (ARCH_BOX_WIDTH - ARCH_TEXT_WIDTH) / 2,
        y: box.y + (ARCH_BOX_HEIGHT - ARCH_TEXT_HEIGHT) / 2,
        width: ARCH_TEXT_WIDTH,
        height: ARCH_TEXT_HEIGHT,
        text: box.text,
        fontSize: 18,
        color: INK,
        seed: nextSeed(rnd),
      },
      updated,
    ),
  ];
}

function archArrowElements(spec: ArchArrow, rnd: DemoRandom, updated: number): SceneElement[] {
  const labelId = `${spec.id}-text`;
  return [
    arrow(
      {
        id: spec.id,
        x: spec.x,
        y: spec.y,
        dx: spec.dx,
        dy: spec.dy,
        strokeColor: INK,
        roughness: 0,
        seed: nextSeed(rnd),
        startId: spec.from,
        endId: spec.to,
        labelId,
      },
      updated,
    ),
    label(
      {
        id: labelId,
        containerId: spec.id,
        x: spec.labelX,
        y: spec.labelY,
        width: ARCH_LABEL_WIDTH,
        height: ARCH_LABEL_HEIGHT,
        text: spec.label,
        fontSize: 14,
        color: INK,
        seed: nextSeed(rnd),
      },
      updated,
    ),
  ];
}

function buildArchitectureScene(rnd: DemoRandom, updated: number): CanvasScene {
  const elements: SceneElement[] = [];
  for (const box of ARCH_BOXES) elements.push(...archBoxElements(box, rnd, updated));
  for (const line of ARCH_ARROWS) elements.push(...archArrowElements(line, rnd, updated));
  return scene(elements);
}

// --- Board 3: „Mapa ideja" — a central ellipse with hand-drawn branches -----
//
// `roughness: 2` (`ROUGHNESS.cartoonist`) throughout, deliberately the
// roughest of the three boards: this is the sketch use, and the one the brief
// asks to look hand-drawn rather than drafted.

const MIND_ROUGHNESS = 2;

const MIND_CENTRAL_ID = "mind-central";
const MIND_CENTRAL_X = 380;
const MIND_CENTRAL_Y = 260;
const MIND_CENTRAL_WIDTH = 240;
const MIND_CENTRAL_HEIGHT = 120;
const MIND_CENTRAL_TEXT = "Sledeći koraci";

interface MindBranch {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly text: string;
  readonly accent: AccentId;
  /** The arrow FROM the central ellipse's own boundary TO this branch's — both hand-picked
   *  bounding-box corners, which is why neither endpoint needs a trig call: a bounding-box
   *  corner is always outside the ellipse it bounds (its normalized radius is exactly √2). */
  readonly arrowX: number;
  readonly arrowY: number;
  readonly dx: number;
  readonly dy: number;
}

const MIND_BRANCH_HEIGHT = 90;

const MIND_BRANCHES: readonly MindBranch[] = [
  {
    id: "mind-sync",
    x: 80,
    y: 40,
    width: 210,
    text: "Sinhronizacija",
    accent: "suma",
    arrowX: MIND_CENTRAL_X,
    arrowY: MIND_CENTRAL_Y,
    dx: -90,
    dy: -130,
  },
  {
    id: "mind-web",
    x: 700,
    y: 20,
    width: 210,
    text: "Veb aplikacija",
    accent: "bordo",
    arrowX: MIND_CENTRAL_X + MIND_CENTRAL_WIDTH,
    arrowY: MIND_CENTRAL_Y,
    dx: 80,
    dy: -150,
  },
  {
    id: "mind-shared",
    x: 50,
    y: 470,
    width: 210,
    text: "Deljeni profili?",
    accent: "bronza",
    arrowX: MIND_CENTRAL_X,
    arrowY: MIND_CENTRAL_Y + MIND_CENTRAL_HEIGHT,
    dx: -120,
    dy: 90,
  },
  {
    id: "mind-ai",
    x: 700,
    y: 500,
    width: 210,
    text: "AI asistent",
    accent: "ruza",
    arrowX: MIND_CENTRAL_X + MIND_CENTRAL_WIDTH,
    arrowY: MIND_CENTRAL_Y + MIND_CENTRAL_HEIGHT,
    dx: 80,
    dy: 120,
  },
  {
    id: "mind-mobile",
    x: 900,
    y: 260,
    width: 220,
    text: "Mobilna verzija?",
    accent: "grafit",
    arrowX: MIND_CENTRAL_X + MIND_CENTRAL_WIDTH,
    arrowY: MIND_CENTRAL_Y + MIND_CENTRAL_HEIGHT / 2,
    dx: 280,
    dy: -15,
  },
];

function buildMindMapScene(rnd: DemoRandom, updated: number): CanvasScene {
  const elements: SceneElement[] = [];
  const centralTextId = `${MIND_CENTRAL_ID}-text`;
  const centralBound: BoundRef[] = [
    { id: centralTextId, type: "text" },
    ...MIND_BRANCHES.map((branch): BoundRef => ({ id: `${branch.id}-arrow`, type: "arrow" })),
  ];
  const centralTextWidth = MIND_CENTRAL_WIDTH - 40;
  const centralTextHeight = 30;

  elements.push(
    shape(
      {
        id: MIND_CENTRAL_ID,
        kind: "ellipse",
        x: MIND_CENTRAL_X,
        y: MIND_CENTRAL_Y,
        width: MIND_CENTRAL_WIDTH,
        height: MIND_CENTRAL_HEIGHT,
        strokeColor: accents.dan.zlato.accent,
        backgroundColor: accents.dan.zlato.accentSoft,
        roughness: MIND_ROUGHNESS,
        seed: nextSeed(rnd),
        bound: centralBound,
      },
      updated,
    ),
    label(
      {
        id: centralTextId,
        containerId: MIND_CENTRAL_ID,
        x: MIND_CENTRAL_X + (MIND_CENTRAL_WIDTH - centralTextWidth) / 2,
        y: MIND_CENTRAL_Y + (MIND_CENTRAL_HEIGHT - centralTextHeight) / 2,
        width: centralTextWidth,
        height: centralTextHeight,
        text: MIND_CENTRAL_TEXT,
        fontSize: 22,
        color: INK,
        seed: nextSeed(rnd),
      },
      updated,
    ),
  );

  for (const branch of MIND_BRANCHES) {
    const textId = `${branch.id}-text`;
    const arrowId = `${branch.id}-arrow`;
    const palette = accents.dan[branch.accent];
    const textWidth = branch.width - 40;
    const textHeight = 26;

    elements.push(
      shape(
        {
          id: branch.id,
          kind: "ellipse",
          x: branch.x,
          y: branch.y,
          width: branch.width,
          height: MIND_BRANCH_HEIGHT,
          strokeColor: palette.accent,
          backgroundColor: palette.accentSoft,
          roughness: MIND_ROUGHNESS,
          seed: nextSeed(rnd),
          bound: [
            { id: textId, type: "text" },
            { id: arrowId, type: "arrow" },
          ],
        },
        updated,
      ),
      label(
        {
          id: textId,
          containerId: branch.id,
          x: branch.x + (branch.width - textWidth) / 2,
          y: branch.y + (MIND_BRANCH_HEIGHT - textHeight) / 2,
          width: textWidth,
          height: textHeight,
          text: branch.text,
          fontSize: 18,
          color: INK,
          seed: nextSeed(rnd),
        },
        updated,
      ),
      arrow(
        {
          id: arrowId,
          x: branch.arrowX,
          y: branch.arrowY,
          dx: branch.dx,
          dy: branch.dy,
          strokeColor: INK,
          roughness: MIND_ROUGHNESS,
          seed: nextSeed(rnd),
          startId: MIND_CENTRAL_ID,
          endId: branch.id,
        },
        updated,
      ),
    );
  }

  return scene(elements);
}

// --- Entry point --------------------------------------------------------

/** The id of the row whose `title` matches, or null — never a uuid this file invented. */
function refFor(
  kind: CanvasRefKind,
  rows: readonly { readonly id: string; readonly title: string }[],
  title: string,
): CanvasRef | null {
  const row = rows.find((candidate) => candidate.title === title);
  return row === undefined ? null : { kind, id: row.id };
}

export function seedDemoCanvas(db: DatabaseHandle, ctx: DemoContext): void {
  const rnd = demoRandom("canvas");
  const nowIso = new Date(ctx.now).toISOString();
  const boards = new CanvasStore(db, ctx.profileId);

  // Read back through the same stores the IPC layer queries — never a raw
  // SELECT — so a card points at a row this profile could actually open.
  const tasks = new TaskStore(db, ctx.profileId).listActive();
  const notes = new NoteStore(db, ctx.profileId).list();
  const cards: WeeklyPlanCards = {
    cv: refFor("task", tasks, "Ažurirati CV i portfolio"),
    interview: refFor("task", tasks, "Priprema za tehnički intervju"),
    thesis: refFor("note", notes, "Priprema za odbranu diplomskog rada"),
  };

  const weeklyPlan = serializeCanvasScene(buildWeeklyPlanScene(rnd, ctx.now, cards));
  const architecture = serializeCanvasScene(buildArchitectureScene(rnd, ctx.now));
  const mindMap = serializeCanvasScene(buildMindMapScene(rnd, ctx.now));

  boards.create({ name: "Nedeljni plan", scene: weeklyPlan }, nowIso);
  boards.create({ name: "Arhitektura sistema", scene: architecture }, nowIso);
  boards.create({ name: "Mapa ideja", scene: mindMap }, nowIso);
}
