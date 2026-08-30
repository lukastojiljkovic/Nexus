import type { ToolPack } from "../contracts/tools.js";
import type { WidgetSize } from "../contracts/widgets.js";
import type { ModuleRegistry } from "../modules/registry.js";
import { keeps, tempoOf, tradePacks, weekShapes, type Signal, type WeekShape } from "./signals.js";

/**
 * ADR-086 §2: the artefact between the answers and the app.
 *
 * Everything ONB could decide before this was a `feature_flags` row, so the
 * home screen, the sidebar and every module's opening view were constants for
 * every user of the product — a bricklayer's board led with two cards about
 * exams, and no answer to any question could change it. A `ProfilePlan` is the
 * whole of one person's Nexus, derived here and applied by the desktop.
 *
 * **Four laws, each a test in `plan.test.ts`:**
 *
 * 1. **No signals ⇒ today.** An empty signal set returns the base selection
 *    unchanged, no packs, an EMPTY board and nothing pinned — and empty means
 *    „write nothing", so the app's own defaults stand through the path they
 *    always have. „Preskoči" therefore costs a user nothing, and this whole
 *    engine is inert until somebody answers something.
 * 2. **Total over the registry.** Every selectable module the base names comes
 *    back decided.
 * 3. **Every board entry is drawable** — published by a manifest, owned by a
 *    module this same plan leaves on, and at a size that widget accepts. The
 *    board is filtered THROUGH the module decision rather than beside it, so
 *    „a card for a module you switched off" is unrepresentable.
 * 4. **Every reason names at least one signal.** The reveal screen and the
 *    Settings card are generated from `reasons`, so a decision the product
 *    cannot explain is a decision this type cannot hold.
 *
 * **The plan never turns a module OFF.** It promotes, demotes and composes; it
 * does not take features away, because „you did not mention cooking" is not
 * evidence that somebody wants their notes gone. PRIV and PRO are the two
 * exceptions and they are not exceptions to this rule but to the base: an
 * opt-in section is only ever on because somebody said so, and a professional
 * drawer with no packs is an empty page. Removing a module stays where it has
 * always been — the „Napredno" screen, where a person decides it themselves.
 */

/** One card on the composed board. */
export interface PlanBoardEntry {
  /** `moduleId:widgetId`, exactly as the owning manifest publishes it. */
  readonly widgetId: string;
  readonly size: WidgetSize;
}

/**
 * The calendar views a plan may choose between — core's own subset of the
 * module's seven, because a plan has an opinion about rhythm and none about
 * „Dokumenta" or „Ljudi", which are panels somebody opens deliberately.
 */
export type PlanCalendarView = "mesec" | "nedelja" | "dan" | "agenda";

/**
 * Why one decision was made, in a form a screen can render and a test can check.
 *
 * `key` is a strings path, `values` are the things the copy interpolates, and
 * `causedBy` is what the person actually said. Prose never appears here:
 * `@nexus/core` holds no user-facing text, and a reason that carried its own
 * sentence would be a second place for Serbian copy to live.
 */
export interface PlanReason {
  readonly key: string;
  readonly values: readonly string[];
  readonly causedBy: readonly Signal[];
}

export interface ProfilePlan {
  /** Every selectable module the base named, decided. */
  readonly modules: Readonly<Record<string, boolean>>;
  /** In the order the person argued for them — the order the reveal lists them in. */
  readonly packs: readonly ToolPack[];
  /** Empty means „write no rows": the app's default board stands. */
  readonly board: readonly PlanBoardEntry[];
  /**
   * The modules pinned above the rest of the sidebar, most-argued-for first.
   *
   * A SHORTLIST and not a reordering: the sidebar's categories are load-bearing
   * (fourteen modules read as one flat list without them), so the plan promotes
   * a few and leaves everything else exactly where the registry puts it. Empty
   * means „leave the sidebar alone", which is law 1 one level down.
   */
  readonly navPrimary: readonly string[];
  /**
   * Which week shape the accent is taken from, or null for „leave it alone".
   *
   * The plan names a SHAPE and not a colour on purpose: `@nexus/core` does not
   * depend on `@nexus/tokens` and must not learn to, so which eight colours
   * exist is the design package's business and this is the one fact the
   * renderer needs to look one of them up.
   */
  readonly accentShape: WeekShape | null;
  /** Null for „leave it alone" — which is what no tempo answer means. */
  readonly calendarView: PlanCalendarView | null;
  readonly reasons: readonly PlanReason[];
}

/** What one answer argues for. Never what it argues AGAINST — the plan does not subtract. */
interface Want {
  readonly modules: readonly string[];
  /** Cards it wants on the board, most characteristic first. */
  readonly board: readonly string[];
}

/**
 * What each week shape argues for.
 *
 * Written as a table because it is one — six rows a person can read and
 * disagree with. The board ids are `moduleId:widgetId` and are checked against
 * the live registry before they reach a plan, so a widget that is renamed or
 * retired takes its row out of every board rather than producing a card that
 * cannot be drawn.
 */
const WEEK_WANTS: Readonly<Record<WeekShape, Want>> = {
  posao: {
    modules: ["tasks", "calendar", "notes", "files"],
    board: ["calendar:danas", "tasks:predstojece", "tasks:hitno-kasni"],
  },
  skola: {
    modules: ["study", "calendar", "tasks", "notes"],
    board: ["study:ispiti", "study:ucenje", "calendar:danas"],
  },
  dom: {
    modules: ["calendar", "tasks", "finance"],
    board: ["calendar:danas", "tasks:predstojece", "calendar:isticanja"],
  },
  kondicija: {
    modules: ["fitness", "habits", "focus"],
    board: ["fitness:danas", "habits:danas", "fitness:trening"],
  },
  stvaranje: {
    modules: ["notes", "canvas", "files", "focus"],
    board: ["notes:nedavno", "canvas:table", "focus:fokus"],
  },
  firma: {
    modules: ["finance", "tasks", "calendar", "files"],
    board: ["finance:naplate", "tasks:hitno-kasni", "calendar:isticanja"],
  },
};

/** What „drži mi na oku ovo" argues for — the honest form of the module question. */
const KEEP_WANTS = {
  novac: { modules: ["finance"], board: ["finance:naplate"] },
  zdravlje: { modules: ["habits", "fitness"], board: ["habits:danas"] },
  // TWO cards, and they answer two different questions about the same subject:
  // what is about to expire, and what has just arrived. Somebody who says „drži
  // mi dokumenta na oku" means both.
  dokumenta: { modules: ["files"], board: ["calendar:isticanja", "files:nedavno"] },
  ideje: { modules: ["notes"], board: ["notes:nedavno"] },
  // PRIV contributes NO card. A widget that renders private content on the home
  // screen is the one card the module exists to prevent.
  privatno: { modules: ["priv"], board: [] },
} as const;

/**
 * What a recognised TRADE argues for beyond the professional drawer itself.
 *
 * A pack with no row here argues only for `pro`, which is the common case and
 * the right default: „you are a chef" says a great deal about which tools you
 * need and almost nothing about which MODULES you do. The rows below are the
 * ones where it does say something, and each is a claim somebody can disagree
 * with in one line — an engineer wires things, a designer draws them, a lawyer
 * and an estate agent live in documents, an accountant in money.
 *
 * This is also the only route to „Elektronika"'s card. No week shape is „I wire
 * circuits" and none should be: the question asks what a week is made of, and a
 * workbench is not a week. `inzenjering` is where that fact actually lives.
 */
const PACK_WANTS: Readonly<Partial<Record<ToolPack, Want>>> = {
  inzenjering: { modules: ["electronics"], board: ["electronics:kola"] },
  dizajn: { modules: ["canvas"], board: ["canvas:table"] },
  softver: { modules: ["canvas"], board: ["canvas:table"] },
  foto: { modules: ["files"], board: ["files:nedavno"] },
  pravo: { modules: ["files"], board: ["files:nedavno"] },
  gradnja: { modules: ["files"], board: ["files:nedavno"] },
  nekretnine: { modules: ["files", "finance"], board: ["files:nedavno"] },
  racunovodstvo: { modules: ["finance"], board: ["finance:naplate"] },
  biznis: { modules: ["finance"], board: ["finance:naplate"] },
};

interface TempoWant {
  readonly view: PlanCalendarView;
  readonly board: readonly string[];
}

/** Which card a tempo wants first — „what is coming" against „what is late". */
const TEMPO_WANTS: Readonly<Record<string, TempoWant>> = {
  planer: { view: "mesec", board: ["calendar:isticanja"] },
  reaktivan: { view: "dan", board: ["tasks:hitno-kasni", "calendar:danas"] },
  beleznik: { view: "agenda", board: ["notes:nedavno"] },
};

/** How many cards a composed board may hold. Six is two full rows; more is a list, not a board. */
const BOARD_CAP = 6;

/** Below this a composed board is worse than the default one, so the plan declines to compose. */
const BOARD_FLOOR = 3;

/**
 * How many modules the plan may pin.
 *
 * A shortlist that reached seven would be half the sidebar restated above the
 * sidebar, which is the „Alatke" mistake — a directory of the same eleven rows
 * beside the eleven rows — in a different room. Five is short enough to read as
 * a selection rather than as a second copy.
 */
const NAV_CAP = 5;

interface PublishedWidget {
  readonly moduleId: string;
  readonly sizes: readonly WidgetSize[];
}

/** Every `moduleId:widgetId` the registry publishes, with its owner and the sizes it accepts. */
function publishedWidgets(registry: ModuleRegistry): Map<string, PublishedWidget> {
  const published = new Map<string, PublishedWidget>();
  for (const manifest of registry.all()) {
    for (const widget of manifest.widgets ?? []) {
      published.set(`${manifest.id}:${widget.id}`, { moduleId: manifest.id, sizes: widget.sizes });
    }
  }
  return published;
}

/**
 * The plan.
 *
 * `base` is the module selection the profile already has — its stored flags on
 * a rerun, its manifest defaults on a first run. Passing it in rather than
 * importing a preset is what keeps law 1 honest: with no signals there is
 * nothing to merge, so the answer IS the base, and „the questionnaire was
 * skipped" and „the questionnaire was never built" produce the same app.
 */
export function buildProfilePlan(
  signals: readonly Signal[],
  registry: ModuleRegistry,
  base: Readonly<Record<string, boolean>>,
): ProfilePlan {
  const modules: Record<string, boolean> = { ...base };
  const reasons: PlanReason[] = [];
  const wantedBoard: string[] = [];
  // Evidence per module: how many separate things the person said point at it.
  // This is the sidebar's order, and counting is deliberate — a module two
  // answers argue for outranks one that only a single answer mentioned.
  const evidence = new Map<string, number>();

  function argueFor(moduleId: string, board: readonly string[]): void {
    modules[moduleId] = true;
    evidence.set(moduleId, (evidence.get(moduleId) ?? 0) + 1);
    for (const widgetId of board) if (!wantedBoard.includes(widgetId)) wantedBoard.push(widgetId);
  }

  // THE ANSWERS ARE READ MOST-SPECIFIC FIRST, and that order is load-bearing.
  //
  // `evidence` is a Map, `sort` is stable, and a tie is the COMMON case — most
  // answers argue for a module exactly once — so what actually decides the
  // pinned order is the order of these three loops rather than the counting.
  // The trade goes first because it is the most specific thing anybody says in
  // the whole flow: six week shapes exist and everyone picks one, while „zidar"
  // is a sentence about one person. A week shape is next, and „drži mi na oku"
  // last, because it names content rather than a life. Tempo argues for no
  // module at all.
  const tradeSignals = signals.filter((signal) => signal.kind === "trade");
  const packs = tradePacks(signals);
  // One point per trade NAMED, not one per plan: somebody who says „zidar i
  // vodim knjige" has said two things about their work, which is the same
  // counting rule every other answer obeys. The board dedupes, so the drawer's
  // card is still placed once. „Alatke" — the general utilities drawer — is
  // deliberately NOT argued for here: it is a different module, it is on by
  // default anyway, and a trade says nothing about wanting a unit converter.
  for (let named = 0; named < tradeSignals.length; named += 1) {
    argueFor("pro", ["pro:paketi"]);
  }
  // …and then what each RECOGNISED PACK says about the rest of the app. Walked
  // over `packs` rather than over `PACK_WANTS` so the person's own order
  // survives: somebody who says „advokat i knjigovođa" gets Datoteke ahead of
  // Finansije, and saying it the other way round gets the other order.
  for (const pack of packs) {
    const want = PACK_WANTS[pack];
    if (want === undefined) continue;
    for (const moduleId of want.modules) argueFor(moduleId, want.board);
  }

  const shapes = weekShapes(signals);
  for (const shape of shapes) {
    const want = WEEK_WANTS[shape];
    for (const moduleId of want.modules) argueFor(moduleId, []);
    for (const widgetId of want.board) {
      if (!wantedBoard.includes(widgetId)) wantedBoard.push(widgetId);
    }
  }

  for (const [keep, want] of Object.entries(KEEP_WANTS)) {
    if (!keeps(signals, keep as keyof typeof KEEP_WANTS)) continue;
    for (const moduleId of want.modules) argueFor(moduleId, want.board);
  }

  const tempo = tempoOf(signals);
  const tempoWant = tempo === null ? null : TEMPO_WANTS[tempo];
  if (tempoWant !== undefined && tempoWant !== null) {
    // A tempo's cards go to the FRONT: it is the one answer about rhythm, and
    // rhythm is what decides which card a person looks at first.
    for (const widgetId of [...tempoWant.board].reverse()) {
      const at = wantedBoard.indexOf(widgetId);
      if (at >= 0) wantedBoard.splice(at, 1);
      wantedBoard.unshift(widgetId);
    }
  }

  // ——— the board, filtered through the module decision ———
  const published = publishedWidgets(registry);
  const board: PlanBoardEntry[] = [];
  for (const widgetId of wantedBoard) {
    if (board.length >= BOARD_CAP) break;
    const widget = published.get(widgetId);
    if (widget === undefined) continue;
    if (modules[widget.moduleId] !== true) continue;
    // „M" is what every default placement uses and what every widget accepts;
    // a widget that withheld it gets the largest size it did offer rather than
    // being dropped, because a card that cannot be M is still a card.
    const size: WidgetSize = widget.sizes.includes("M") ? "M" : (widget.sizes.at(-1) ?? "M");
    board.push({ widgetId, size });
  }

  // ——— the sidebar ———
  // Only what something was actually SAID about, most-argued-for first. `sort`
  // is stable, so a tie falls back to the order `argueFor` ran in, which is the
  // order the questions were asked in — trade, week, keeps, most specific first.
  const ranked = [...evidence.entries()].sort((a, b) => b[1] - a[1]).map(([moduleId]) => moduleId);
  // …and the drawer LEADS whenever a trade was named, ahead of the counting.
  //
  // Stated rather than emergent, because the counting alone gets it wrong: a
  // bricklayer's „Datoteke" is argued for twice — once by `gradnja` and once by
  // „posao" — so it outranks a „Stručne alatke" nothing but the trade names,
  // and the sidebar then leads with the module every employed person has
  // instead of the one thing that person told us about themselves. Naming their
  // trade is the most specific act in the whole flow; this is that, said out
  // loud, where it can be disagreed with.
  const navPrimary = (
    packs.length > 0 ? ["pro", ...ranked.filter((moduleId) => moduleId !== "pro")] : ranked
  ).slice(0, NAV_CAP);

  // ——— the reasons, one per decision that was actually made ———
  const weekSignals = signals.filter((signal) => signal.kind === "week");
  const keepSignals = signals.filter((signal) => signal.kind === "keep");
  const tempoSignals = signals.filter((signal) => signal.kind === "tempo");

  if (board.length >= BOARD_FLOOR) {
    reasons.push({
      key: "board",
      values: [String(board.length)],
      // All FOUR kinds, `tradeSignals` included. A trade puts the drawer's own
      // card on the board and brings whatever `PACK_WANTS` argues for with it,
      // so three named trades compose a board of three on their own — and this
      // list once omitted them, which made „somebody who only told us their
      // trade" a plan whose board reason named no cause at all. Law 4 is not a
      // property of the fully answered set; it has to hold for every set.
      causedBy: [...weekSignals, ...keepSignals, ...tempoSignals, ...tradeSignals],
    });
  }
  if (packs.length > 0) {
    reasons.push({ key: "packs", values: [...packs], causedBy: tradeSignals });
  }
  if (navPrimary.length > 0) {
    reasons.push({
      key: "nav",
      values: navPrimary,
      causedBy: [...weekSignals, ...keepSignals, ...tradeSignals],
    });
  }
  if (keeps(signals, "privatno")) {
    reasons.push({
      key: "priv",
      values: [],
      causedBy: keepSignals.filter((signal) => signal.kind === "keep" && signal.id === "privatno"),
    });
  }
  if (tempoWant !== undefined && tempoWant !== null) {
    reasons.push({ key: "calendar", values: [tempoWant.view], causedBy: tempoSignals });
  }
  const accentShape = shapes[0] ?? null;
  if (accentShape !== null) {
    reasons.push({ key: "accent", values: [accentShape], causedBy: weekSignals });
  }

  return {
    modules,
    packs,
    // A board of one or two cards is worse than the five the app ships, so
    // below the floor the plan declines to compose and lets the default stand.
    board: board.length >= BOARD_FLOOR ? board : [],
    navPrimary,
    accentShape,
    calendarView: tempoWant?.view ?? null,
    reasons,
  };
}
