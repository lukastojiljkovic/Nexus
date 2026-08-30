import { describe, expect, it } from "vitest";

import { ModuleRegistry } from "../modules/registry.js";
import type { ModuleManifest } from "../modules/manifest.js";
import type { WidgetContract } from "../contracts/widgets.js";
import { buildProfilePlan } from "./plan.js";
import type { Signal } from "./signals.js";

/**
 * A stand-in for the desktop registry, holding exactly the widget ids the app
 * publishes — the twelve it had, plus the four ADR-086 argued for — because the
 * laws under test are about the RELATIONSHIP between a plan and a registry, and
 * a fixture that carried every real manifest would be testing `modules.ts`
 * instead. The IDS have to match the real ones or the want tables below would
 * be checked against names nothing draws.
 */
function widget(id: string): WidgetContract {
  return { id, title: `dashboard.${id}.title`, sizes: ["S", "M", "L"], deepLink: "dashboard" };
}

function manifest(id: string, widgets: readonly string[] = []): ModuleManifest {
  return {
    id,
    prefix: id.toUpperCase().slice(0, 4),
    category: "Life hubs",
    defaultEnabled: true,
    widgets: widgets.map(widget),
  };
}

function testRegistry(): ModuleRegistry {
  const registry = new ModuleRegistry();
  registry.register(manifest("dashboard"));
  registry.register(manifest("tasks", ["predstojece", "hitno-kasni"]));
  registry.register(manifest("calendar", ["danas", "isticanja"]));
  registry.register(manifest("notes", ["nedavno"]));
  registry.register(manifest("priv"));
  registry.register(manifest("files", ["nedavno"]));
  registry.register(manifest("study", ["ispiti", "ucenje"]));
  registry.register(manifest("finance", ["naplate"]));
  registry.register(manifest("habits", ["danas"]));
  registry.register(manifest("fitness", ["danas", "trening"]));
  registry.register(manifest("focus", ["fokus"]));
  registry.register(manifest("tools"));
  registry.register(manifest("canvas", ["table"]));
  registry.register(manifest("electronics", ["kola"]));
  registry.register(manifest("pro", ["paketi"]));
  registry.register(manifest("settings"));
  return registry;
}

/** Today's personal defaults, as `resolveModuleSelection` would hand them over on a first run. */
const BASE: Readonly<Record<string, boolean>> = {
  tasks: true,
  calendar: true,
  notes: true,
  priv: false,
  files: true,
  study: true,
  finance: true,
  habits: true,
  focus: true,
  fitness: true,
  tools: true,
  canvas: true,
  electronics: true,
  pro: false,
};

function plan(signals: readonly Signal[]) {
  return buildProfilePlan(signals, testRegistry(), BASE);
}

describe("law 1 — no signals produce today's app", () => {
  /**
   * The whole engine is inert until somebody answers something, and that is
   * what makes „Preskoči" free. An empty board and nothing pinned are „write no
   * rows": the app's own `DEFAULT_DASHBOARD_LAYOUT` and its sidebar categories
   * then stand through the path they always have, which is also why this
   * package does not restate either of them — a copy is a thing that drifts.
   */
  it("returns the base untouched, nothing composed, and nothing to write", () => {
    expect(plan([])).toEqual({
      modules: BASE,
      packs: [],
      board: [],
      navPrimary: [],
      accentShape: null,
      calendarView: null,
      reasons: [],
    });
  });
});

describe("law 2 — the module decision is total and never subtracts", () => {
  it("decides every module the base named, whatever was answered", () => {
    const result = plan([
      { kind: "week", id: "kondicija" },
      { kind: "keep", id: "novac" },
    ]);
    expect(Object.keys(result.modules).sort()).toEqual(Object.keys(BASE).sort());
  });

  /**
   * „You did not mention cooking" is not evidence that somebody wants their
   * notes gone. Taking a feature away stays where it has always been — the
   * „Napredno" screen, where a person decides it themselves.
   */
  it("never turns a module off that the base had on", () => {
    for (const signals of [
      [{ kind: "week", id: "firma" }],
      [{ kind: "week", id: "skola" }, { kind: "tempo", id: "reaktivan" }],
      [{ kind: "keep", id: "ideje" }],
    ] satisfies Signal[][]) {
      const result = plan(signals);
      const removed = Object.keys(BASE).filter((id) => BASE[id] === true && !result.modules[id]);
      expect(removed, JSON.stringify(signals)).toEqual([]);
    }
  });

  it("leaves the private section off until somebody asks for it, and only then", () => {
    expect(plan([{ kind: "week", id: "posao" }]).modules.priv).toBe(false);
    expect(plan([{ kind: "keep", id: "privatno" }]).modules.priv).toBe(true);
  });

  /** A professional drawer with no packs is an empty page, so the two move together. */
  it("switches the professional drawer on exactly when a trade was recognised", () => {
    expect(plan([{ kind: "week", id: "posao" }]).modules.pro).toBe(false);
    expect(
      plan([{ kind: "trade", pack: "zanat", term: "stolar", via: "typed" }]).modules.pro,
    ).toBe(true);
  });
});

describe("law 3 — every board entry is drawable", () => {
  it("composes a board a student would recognise", () => {
    const result = plan([{ kind: "week", id: "skola" }, { kind: "keep", id: "ideje" }]);
    expect(result.board.map((entry) => entry.widgetId)).toEqual([
      "study:ispiti",
      "study:ucenje",
      "calendar:danas",
      "notes:nedavno",
    ]);
  });

  /** And a different person gets a different board — the entire point of the exercise. */
  it("composes a different board for a different week", () => {
    const student = plan([{ kind: "week", id: "skola" }]);
    const builder = plan([
      { kind: "week", id: "firma" },
      { kind: "trade", pack: "gradnja", term: "zidar", via: "typed" },
    ]);
    expect(builder.board.map((entry) => entry.widgetId)).not.toEqual(
      student.board.map((entry) => entry.widgetId),
    );
    expect(builder.board.map((entry) => entry.widgetId)).not.toContain("study:ispiti");
  });

  it("emits no card whose module this same plan left off", () => {
    // „privatno" is the only keep with no card at all, so the strongest form of
    // this check is over every signal kind at once: whatever is composed, its
    // owning module has to be on in the same plan.
    const result = plan([
      { kind: "week", id: "firma" },
      { kind: "week", id: "kondicija" },
      { kind: "keep", id: "novac" },
      { kind: "keep", id: "privatno" },
      { kind: "tempo", id: "reaktivan" },
    ]);
    for (const entry of result.board) {
      const moduleId = entry.widgetId.split(":")[0] ?? "";
      expect(result.modules[moduleId], entry.widgetId).toBe(true);
    }
  });

  /**
   * A TRADE composes the board too, and this is what „the app is built for you"
   * finally cashes out as: two people who answer the week question identically
   * get different home screens because they do different work. It is also the
   * only route to „Elektronika"'s card — no week shape is „I wire circuits".
   */
  it("gives two people with the same week different boards for different trades", () => {
    const engineer = plan([
      { kind: "week", id: "posao" },
      { kind: "trade", pack: "inzenjering", term: "inženjer", via: "typed" },
    ]);
    const lawyer = plan([
      { kind: "week", id: "posao" },
      { kind: "trade", pack: "pravo", term: "advokat", via: "typed" },
    ]);
    expect(engineer.board.map((entry) => entry.widgetId)).toContain("electronics:kola");
    expect(lawyer.board.map((entry) => entry.widgetId)).toContain("files:nedavno");
    expect(lawyer.board.map((entry) => entry.widgetId)).not.toContain("electronics:kola");
  });

  /** A pack with no row of its own argues for the drawer and nothing else — the common case. */
  it("composes nothing extra for a trade that says nothing about modules", () => {
    const chef = plan([
      { kind: "week", id: "posao" },
      { kind: "trade", pack: "kuhinja", term: "kuvar", via: "typed" },
    ]);
    const plain = plan([{ kind: "week", id: "posao" }]);
    expect(chef.board.map((entry) => entry.widgetId)).toEqual([
      "pro:paketi",
      ...plain.board.map((entry) => entry.widgetId),
    ]);
  });

  it("emits no card the registry does not publish", () => {
    const registry = testRegistry();
    const published = new Set(
      registry.all().flatMap((m) => (m.widgets ?? []).map((w) => `${m.id}:${w.id}`)),
    );
    const result = plan([
      { kind: "week", id: "stvaranje" },
      { kind: "trade", pack: "dizajn", term: "dizajner", via: "typed" },
    ]);
    for (const entry of result.board) expect(published, entry.widgetId).toContain(entry.widgetId);
  });

  it("never composes more than two rows of cards", () => {
    const result = plan([
      { kind: "week", id: "posao" },
      { kind: "week", id: "kondicija" },
      { kind: "keep", id: "novac" },
      { kind: "keep", id: "dokumenta" },
      { kind: "keep", id: "ideje" },
      { kind: "keep", id: "zdravlje" },
      { kind: "tempo", id: "planer" },
    ]);
    expect(result.board.length).toBeLessThanOrEqual(6);
  });

  /**
   * Below the floor a composed board is WORSE than the five the app ships, so
   * the plan declines rather than handing somebody a home screen with two
   * cards on it. „privatno" alone is exactly that case: it argues for a module
   * and, deliberately, for no card at all.
   */
  it("declines to compose rather than hand over a nearly empty board", () => {
    expect(plan([{ kind: "keep", id: "privatno" }]).board).toEqual([]);
  });
});

describe("law 4 — every reason names a signal", () => {
  it("holds for every decision in a fully answered plan", () => {
    const result = plan([
      { kind: "week", id: "firma" },
      { kind: "week", id: "posao" },
      { kind: "keep", id: "novac" },
      { kind: "keep", id: "privatno" },
      { kind: "tempo", id: "planer" },
      { kind: "trade", pack: "gradnja", term: "zidar", via: "typed" },
    ]);
    expect(result.reasons.length).toBeGreaterThan(0);
    for (const reason of result.reasons) {
      expect(reason.causedBy.length, reason.key).toBeGreaterThan(0);
    }
  });

  it("holds when a TRADE is the only thing said — a board a trade composed is a board a trade caused", () => {
    // The hole the fully-answered case cannot show. Three named trades put
    // three cards on the board on their own („Stručne alatke", „Datoteke",
    // „Finansije"), so the floor is cleared with no week, keep or tempo answer
    // anywhere in the set — and the board reason listed exactly those three
    // kinds. „Somebody who only tells us their trade" is not an edge case; it
    // is the shortest complete answer the flow accepts.
    const result = plan([
      { kind: "trade", pack: "gradnja", term: "zidar", via: "typed" },
      { kind: "trade", pack: "pravo", term: "advokat", via: "typed" },
      { kind: "trade", pack: "racunovodstvo", term: "knjigovođa", via: "typed" },
    ]);
    expect(result.board.length).toBeGreaterThanOrEqual(3);
    expect(result.reasons.map((reason) => reason.key)).toContain("board");
    for (const reason of result.reasons) {
      expect(reason.causedBy.length, reason.key).toBeGreaterThan(0);
    }
  });

  it("gives a reason for each thing it actually changed, and for nothing it did not", () => {
    const quiet = plan([{ kind: "tempo", id: "beleznik" }]);
    expect(quiet.reasons.map((reason) => reason.key)).toEqual(["calendar"]);
  });
});

describe("the rest of the plan", () => {
  it("takes the rhythm from the tempo and nothing else", () => {
    expect(plan([{ kind: "tempo", id: "planer" }]).calendarView).toBe("mesec");
    expect(plan([{ kind: "tempo", id: "reaktivan" }]).calendarView).toBe("dan");
    expect(plan([{ kind: "tempo", id: "beleznik" }]).calendarView).toBe("agenda");
    expect(plan([{ kind: "week", id: "posao" }]).calendarView).toBeNull();
  });

  it("puts the card the tempo asked for first, ahead of what the week wanted", () => {
    const result = plan([{ kind: "week", id: "skola" }, { kind: "tempo", id: "reaktivan" }]);
    expect(result.board[0]?.widgetId).toBe("tasks:hitno-kasni");
  });

  it("keeps the packs in the order the person said them", () => {
    const result = plan([
      { kind: "trade", pack: "zanat", term: "stolar", via: "typed" },
      { kind: "trade", pack: "gradnja", term: "stolar", via: "typed" },
      { kind: "trade", pack: "zanat", term: "namestaj", via: "typed" },
    ]);
    expect(result.packs).toEqual(["zanat", "gradnja"]);
  });

  it("pins only what was said about, most-argued-for first", () => {
    const result = plan([
      { kind: "week", id: "kondicija" },
      { kind: "keep", id: "zdravlje" },
      { kind: "keep", id: "novac" },
    ]);
    // „fitness" and „habits" were argued for twice — by the week AND by the
    // keep — so they lead. „focus" and „finance" were argued for once each and
    // fall back to the order they were argued in. Nothing else is pinned:
    // „notes", „calendar" and the rest keep their categories below, untouched.
    expect(result.navPrimary).toEqual(["fitness", "habits", "focus", "finance"]);
  });

  /**
   * A shortlist that grows to half the sidebar has stopped being a shortlist.
   * Six answers reach nine modules between them and only five may be pinned.
   */
  it("pins at most five, and pins the professional drawer when a trade was named", () => {
    const result = plan([
      { kind: "week", id: "posao" },
      { kind: "trade", pack: "gradnja", term: "zidar", via: "typed" },
      { kind: "keep", id: "novac" },
      { kind: "keep", id: "zdravlje" },
    ]);
    expect(result.navPrimary).toHaveLength(5);
    expect(result.navPrimary).toContain("pro");
  });

  /**
   * Ties are the common case — most answers argue for a module exactly once —
   * so what breaks a tie is what actually orders the sidebar, and the rule is
   * specificity: the trade first, then the week, then what to keep an eye on.
   * A bricklayer's Nexus leads with the professional drawer and not with the
   * four modules every employed person gets.
   */
  it("breaks a tie in favour of the more specific answer", () => {
    const result = plan([
      { kind: "week", id: "posao" },
      { kind: "trade", pack: "gradnja", term: "zidar", via: "typed" },
      { kind: "keep", id: "novac" },
    ]);
    expect(result.navPrimary[0]).toBe("pro");
    expect(result.navPrimary).not.toContain("finance");
  });

  it("takes the accent from the first thing the person said about their week", () => {
    expect(plan([{ kind: "week", id: "firma" }, { kind: "week", id: "dom" }]).accentShape).toBe(
      "firma",
    );
    expect(plan([{ kind: "tempo", id: "planer" }]).accentShape).toBeNull();
  });
});
