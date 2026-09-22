import { afterEach, describe, expect, it, vi } from "vitest";
import { canvasRefText } from "@nexus/core";
import type { CanvasRefCard, SearchResult } from "../../shared/ipc.js";
import {
  CANVAS_CARD_HEIGHT,
  CANVAS_CARD_WIDTH,
  canvasCardDetail,
  canvasCardElement,
  canvasCardInteraction,
  canvasCardMap,
  canvasCardTitle,
  canvasCardView,
  canvasDropOrigin,
  canvasPickerRows,
  canvasRefKindOf,
  canvasSceneRefs,
  sameCanvasRefs,
} from "./canvasCards.js";
import { strings } from "./strings.js";

/**
 * The card decisions (CANV slice c), all of them decidable without an editor —
 * `canvasTools.test.ts`'s arrangement, and for its reason: this runs in
 * `apps/desktop`'s node-only Vitest, where there is no DOM and no Excalidraw.
 *
 * The `canvasCardView` block is the one that matters most. Excalidraw's
 * embeddable call site falls through to a REAL IFRAME on a nullish
 * `renderEmbeddable` return, so „this function has an answer for every input"
 * is a security property, and it is asserted here over the pure decision rather
 * than trusted to a reading of the component that consumes it.
 *
 * `canvasCardDetail` reads the clock through `formatNotificationWhen`, so those
 * cases pin "now" and assert output SHAPES rather than locale-rendered month
 * names — `searchShared.test.ts`'s discipline, since it is that formatter.
 */

const NOTE_ID = "01890000-0000-7000-8000-000000000000";
const TASK_ID = "0189abcd-1234-7abc-8def-0123456789ab";
const EVENT_ID = "0189ffff-9999-7fff-bfff-ffffffffffff";
const NOTE_REF = canvasRefText({ kind: "note", id: NOTE_ID });
const TASK_REF = canvasRefText({ kind: "task", id: TASK_ID });
const EVENT_REF = canvasRefText({ kind: "event", id: EVENT_ID });

afterEach(() => {
  vi.useRealTimers();
});

function embeddable(link: string | null, extra: { isDeleted?: boolean } = {}) {
  return { type: "embeddable", link, ...extra };
}

// --- canvasSceneRefs ----------------------------------------------------------

describe("canvasSceneRefs", () => {
  it("collects the references the board's embeddables carry, in scene order", () => {
    expect(
      canvasSceneRefs([embeddable(EVENT_REF), embeddable(NOTE_REF), embeddable(TASK_REF)]),
    ).toEqual([EVENT_REF, NOTE_REF, TASK_REF]);
  });

  it("names the same object once however many cards point at it", () => {
    expect(canvasSceneRefs([embeddable(NOTE_REF), embeddable(NOTE_REF)])).toEqual([NOTE_REF]);
  });

  it("skips deleted elements — `onChange` is handed the tombstones an undo stands on", () => {
    expect(
      canvasSceneRefs([embeddable(NOTE_REF, { isDeleted: true }), embeddable(TASK_REF)]),
    ).toEqual([TASK_REF]);
  });

  it("ignores a link on anything that is not an embeddable", () => {
    // The hyperlink popup can put a link on any shape; that is a hyperlink on a
    // rectangle, not a card, and nothing resolves it.
    expect(canvasSceneRefs([{ type: "rectangle", link: NOTE_REF }])).toEqual([]);
  });

  it("ignores links that are not references, whatever they are", () => {
    expect(
      canvasSceneRefs([
        embeddable(null),
        embeddable("https://example.com"),
        embeddable("javascript:alert(1)"),
        embeddable("nexus://note/not-a-uuid"),
        embeddable("nexus://folder/01890000-0000-7000-8000-000000000000"),
      ]),
    ).toEqual([]);
  });

  it("reads an element with no link at all", () => {
    expect(canvasSceneRefs([{ type: "embeddable" }])).toEqual([]);
  });
});

// --- sameCanvasRefs -----------------------------------------------------------

describe("sameCanvasRefs", () => {
  it("compares as a SET, so re-ordering two cards does not re-resolve", () => {
    expect(sameCanvasRefs([NOTE_REF, TASK_REF], [TASK_REF, NOTE_REF])).toBe(true);
  });

  it("sees a card added", () => {
    expect(sameCanvasRefs([NOTE_REF], [NOTE_REF, TASK_REF])).toBe(false);
  });

  it("sees a card swapped for another", () => {
    expect(sameCanvasRefs([NOTE_REF], [TASK_REF])).toBe(false);
  });

  it("holds for two empty boards", () => {
    expect(sameCanvasRefs([], [])).toBe(true);
  });
});

// --- canvasCardMap ------------------------------------------------------------

describe("canvasCardMap", () => {
  const cards: CanvasRefCard[] = [
    { kind: "note", id: NOTE_ID, missing: false, title: "Plan", detail: null },
    { kind: "task", id: TASK_ID, missing: true },
  ];

  it("zips the resolver's positional answer onto the references asked", () => {
    const map = canvasCardMap([NOTE_REF, TASK_REF], cards);
    expect(map.get(NOTE_REF)).toEqual(cards[0]);
    expect(map.get(TASK_REF)).toEqual(cards[1]);
  });

  it("leaves a reference the answer never reached unmapped, rather than mis-paired", () => {
    const map = canvasCardMap([NOTE_REF, TASK_REF, EVENT_REF], cards);
    expect(map.has(EVENT_REF)).toBe(false);
    expect(map.size).toBe(2);
  });
});

// --- canvasCardView -----------------------------------------------------------

describe("canvasCardView", () => {
  const resolved = new Map<string, CanvasRefCard>([
    [NOTE_REF, { kind: "note", id: NOTE_ID, missing: false, title: "Plan puta", detail: null }],
    [TASK_REF, { kind: "task", id: TASK_ID, missing: true }],
  ]);

  it("draws a resolved object", () => {
    expect(canvasCardView(NOTE_REF, resolved)).toEqual({
      state: "ready",
      ref: { kind: "note", id: NOTE_ID },
      title: "Plan puta",
      detail: null,
    });
  });

  it("says the object is gone rather than dropping the card", () => {
    expect(canvasCardView(TASK_REF, resolved)).toEqual({
      state: "missing",
      ref: { kind: "task", id: TASK_ID },
    });
  });

  it("draws loading while the resolution has not answered for this reference", () => {
    expect(canvasCardView(EVENT_REF, resolved)).toEqual({
      state: "loading",
      ref: { kind: "event", id: EVENT_ID },
    });
  });

  it("draws a refusal for a link that is not one of ours", () => {
    expect(canvasCardView("https://example.com", resolved)).toEqual({ state: "foreign" });
  });

  /**
   * The whole point of the function. A nullish return from `renderEmbeddable`
   * becomes a real `<iframe>` in a sandboxed renderer, so the decision behind it
   * must be TOTAL — and the proof belongs over the pure function, not over a
   * reading of the JSX that consumes it.
   */
  it("answers for every link a scene could possibly carry, and never with nothing", () => {
    const links: (string | null | undefined)[] = [
      null,
      undefined,
      "",
      "   ",
      NOTE_REF,
      TASK_REF,
      EVENT_REF,
      `${NOTE_REF}\n`,
      ` ${NOTE_REF}`,
      NOTE_REF.toUpperCase(),
      "nexus://note/not-a-uuid",
      "nexus://note/01890000-0000-4000-8000-000000000000",
      "nexus://document/01890000-0000-7000-8000-000000000000",
      "nexus:",
      "nexus://",
      "https://youtube.com/watch?v=x",
      "javascript:alert(1)",
      "data:text/html,<script>x</script>",
      "file:///etc/passwd",
      "about:blank",
      "/relative/path",
      "x".repeat(5000),
    ];
    const states = new Set<string>();
    for (const link of links) {
      const view = canvasCardView(link, resolved);
      expect(view, `link ${JSON.stringify(link)} must produce a card`).toBeDefined();
      expect(["ready", "missing", "loading", "foreign"]).toContain(view.state);
      states.add(view.state);
    }
    // And the table above genuinely exercises more than one arm, so a function
    // that answered „foreign" to everything could not pass this.
    expect(states.size).toBeGreaterThan(1);
  });

  it("admits exactly ONE spelling of a reference, so the lookup can be keyed by the text", () => {
    // Whitespace, a trailing newline and a different case are all NOT this
    // reference — `parseCanvasRef` is anchored and lower-case only, which is
    // what makes the map key safe.
    for (const variant of [` ${NOTE_REF}`, `${NOTE_REF}\n`, NOTE_REF.toUpperCase()]) {
      expect(canvasCardView(variant, resolved)).toEqual({ state: "foreign" });
    }
  });

  it("formats a resolved task's own due date into the context line", () => {
    const map = new Map<string, CanvasRefCard>([
      [TASK_REF, { kind: "task", id: TASK_ID, missing: false, title: "Rok", detail: "2026-07-08" }],
    ]);
    const view = canvasCardView(TASK_REF, map);
    expect(view.state).toBe("ready");
    if (view.state !== "ready") return;
    expect(view.detail).not.toBe("2026-07-08");
    expect(view.detail).toContain("2026");
  });
});

// --- canvasCardDetail ---------------------------------------------------------

describe("canvasCardDetail", () => {
  it("has no line for a note, which carries no second fact", () => {
    expect(canvasCardDetail(null)).toBeNull();
  });

  it("treats a blank column as absent rather than drawing an empty line", () => {
    expect(canvasCardDetail("")).toBeNull();
    expect(canvasCardDetail("   ")).toBeNull();
  });

  it("renders a task's bare due date as a day, never as a clock", () => {
    const rendered = canvasCardDetail("2026-07-08");
    expect(rendered).not.toBeNull();
    expect(rendered).not.toBe("2026-07-08");
    expect(rendered).toContain("2026");
    expect(rendered).not.toMatch(/\d{2}:\d{2}/);
  });

  it("renders an event's instant as a time", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 8, 12, 0, 0));
    const rendered = canvasCardDetail(new Date(2026, 6, 8, 9, 30, 0).toISOString());
    expect(rendered).toMatch(/\d{2}:\d{2}/);
  });
});

// --- canvasCardTitle ----------------------------------------------------------

describe("canvasCardTitle", () => {
  it("says so when a note was never named", () => {
    expect(canvasCardTitle("")).toBe(strings.canvas.card.untitled);
    expect(canvasCardTitle("   ")).toBe(strings.canvas.card.untitled);
  });

  it("leaves a real title exactly as the row carries it", () => {
    expect(canvasCardTitle("Šema baze")).toBe("Šema baze");
  });
});

// --- canvasCardInteraction ----------------------------------------------------

describe("canvasCardInteraction", () => {
  it("is idle when the editor has no embeddable armed", () => {
    expect(canvasCardInteraction("el-1", null)).toBe("idle");
  });

  it("is idle when the armed embeddable is a different card", () => {
    expect(
      canvasCardInteraction("el-1", { element: { id: "el-2" }, state: "active" }),
    ).toBe("idle");
  });

  it("hints while the pointer is over this card's middle", () => {
    expect(canvasCardInteraction("el-1", { element: { id: "el-1" }, state: "hover" })).toBe("hint");
  });

  it("is active once the first click has armed it — the click after that reaches our DOM", () => {
    expect(canvasCardInteraction("el-1", { element: { id: "el-1" }, state: "active" })).toBe(
      "active",
    );
  });
});

// --- canvasRefKindOf / canvasPickerRows ---------------------------------------

describe("canvasRefKindOf", () => {
  it("admits the three kinds a reference can name", () => {
    expect(canvasRefKindOf("note")).toBe("note");
    expect(canvasRefKindOf("task")).toBe("task");
    expect(canvasRefKindOf("event")).toBe("event");
  });

  it("refuses every other indexed kind", () => {
    // Listed rather than derived from `SEARCH_KINDS`, because „every other
    // kind" is the CLAIM: a `SEARCH_KINDS.filter(...)` would silently follow a
    // kind that moved into `CANVAS_REF_KINDS`, which is the one thing this test
    // is for. The circuit (the tenth kind) was added here the day it existed.
    for (const kind of [
      "document",
      "subject",
      "exam",
      "deck",
      "card",
      "attachment",
      "circuit",
    ] as const) {
      expect(canvasRefKindOf(kind)).toBeNull();
    }
  });
});

describe("canvasPickerRows", () => {
  function hit(kind: SearchResult["kind"], entityId: string, over: Partial<SearchResult> = {}) {
    return {
      kind,
      entityId,
      parentId: null,
      title: "Naslov",
      titleRanges: [],
      snippet: "",
      snippetRanges: [],
      contextDate: null,
      updatedAt: "2026-07-08T09:00:00.000Z",
      fromAttachment: false,
      ...over,
    } satisfies SearchResult;
  }

  it("offers only what a card can point at", () => {
    const rows = canvasPickerRows([
      hit("note", NOTE_ID),
      hit("exam", "exam-1"),
      hit("task", TASK_ID),
      hit("attachment", "att-1"),
      hit("event", EVENT_ID),
      hit("deck", "deck-1"),
    ]);
    expect(rows.map((row) => row.kind)).toEqual(["note", "task", "event"]);
    expect(rows.map((row) => row.id)).toEqual([NOTE_ID, TASK_ID, EVENT_ID]);
  });

  it("carries the untitled fallback and the formatted context line the card will draw", () => {
    const rows = canvasPickerRows([
      hit("note", NOTE_ID, { title: "" }),
      hit("task", TASK_ID, { contextDate: "2026-07-08" }),
    ]);
    expect(rows[0]?.title).toBe(strings.canvas.card.untitled);
    expect(rows[0]?.detail).toBeNull();
    expect(rows[1]?.detail).toContain("2026");
  });

  it("offers nothing when the profile's enabled modules left nothing to offer", () => {
    // main filters by module before this ever runs (`searchGate.ts`); an empty
    // answer is the shape that arrives, and it must not become a broken list.
    expect(canvasPickerRows([])).toEqual([]);
  });
});

// --- canvasDropOrigin ---------------------------------------------------------

describe("canvasDropOrigin", () => {
  const view = { scrollX: -100, scrollY: -50, width: 800, height: 600, zoom: 1 };

  it("is `onPaste`'s own arithmetic for a zero-sized box", () => {
    expect(canvasDropOrigin(view, 0, 0)).toEqual({
      x: -view.scrollX + view.width / 2 / view.zoom,
      y: -view.scrollY + view.height / 2 / view.zoom,
    });
  });

  it("centres a sized element on that same point rather than hanging it off the corner", () => {
    const centre = canvasDropOrigin(view, 0, 0);
    const card = canvasDropOrigin(view, CANVAS_CARD_WIDTH, CANVAS_CARD_HEIGHT);
    expect(card.x + CANVAS_CARD_WIDTH / 2).toBe(centre.x);
    expect(card.y + CANVAS_CARD_HEIGHT / 2).toBe(centre.y);
  });

  it("reads the zoom, because the centre of the screen is not the centre of the scene", () => {
    const zoomed = canvasDropOrigin({ ...view, zoom: 2 }, 0, 0);
    expect(zoomed).toEqual({ x: 100 + 200, y: 50 + 150 });
  });
});

// --- canvasCardElement --------------------------------------------------------

describe("canvasCardElement", () => {
  const element = canvasCardElement({
    ref: { kind: "note", id: NOTE_ID },
    id: "element-1",
    x: 10,
    y: 20,
    strokeColor: "var-border",
    backgroundColor: "var-surface",
    roundness: { type: 3 },
    seed: 12345,
    updated: 1_700_000_000_000,
  });

  it("carries the reference in `link`, in the grammar's own spelling", () => {
    expect(element.link).toBe(NOTE_REF);
    expect(element.type).toBe("embeddable");
  });

  it("keeps the reference in ONE field — nothing rides in `customData`", () => {
    // Two copies of the same reference is two things that can disagree, and the
    // editor's own hyperlink editor rewrites only one of them.
    expect(Object.keys(element)).not.toContain("customData");
  });

  it("is a COMPLETE element, because `convertToExcalidrawElements` passes an embeddable through verbatim", () => {
    // Its transform has a factory per shape but its `case "embeddable"` arm is
    // `s = l` — so a half-built skeleton lands in the scene half-built, and
    // `getSceneVersion` (the autosave's whole guard) sums a `version` that
    // would not be there. `excalidrawSurface.test.ts` pins that upstream fact;
    // this pins our half of the bargain.
    for (const field of [
      "id",
      "type",
      "x",
      "y",
      "width",
      "height",
      "angle",
      "strokeColor",
      "backgroundColor",
      "fillStyle",
      "strokeWidth",
      "strokeStyle",
      "roughness",
      "opacity",
      "roundness",
      "seed",
      "version",
      "versionNonce",
      "index",
      "isDeleted",
      "groupIds",
      "frameId",
      "boundElements",
      "updated",
      "link",
      "locked",
    ]) {
      expect(Object.keys(element), `element must carry ${field}`).toContain(field);
    }
  });

  it("takes its box from the card size and its position from where it was dropped", () => {
    expect(element.width).toBe(CANVAS_CARD_WIDTH);
    expect(element.height).toBe(CANVAS_CARD_HEIGHT);
    expect(element.x).toBe(10);
    expect(element.y).toBe(20);
  });

  it("arrives live, un-grouped and un-indexed — the scene assigns the ordering", () => {
    expect(element.isDeleted).toBe(false);
    expect(element.groupIds).toEqual([]);
    expect(element.index).toBeNull();
    expect(element.locked).toBe(false);
  });

  it("takes both colours from the caller, so no colour literal is ever written here", () => {
    expect(element.strokeColor).toBe("var-border");
    expect(element.backgroundColor).toBe("var-surface");
  });
});
