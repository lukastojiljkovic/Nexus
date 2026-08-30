import type { ProfilePlan } from "@nexus/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DashboardWidgetInstance } from "../../shared/ipc.js";
import { createModuleRegistry } from "../../shared/modules.js";
import { ESSENTIALS_MODULE_PRESET } from "../../shared/onboardingPresets.js";
import { readPinnedModules } from "./navPrefs.js";
import {
  ACCENT_FOR_SHAPE,
  applyProfilePlan,
  PLAN_STAGES,
  type PlanApplyPorts,
  type PlanStage,
} from "./profilePlanApply.js";
import { memoryStorage } from "./testStorage.js";

/**
 * ADR-086 §4. The decision is tested in `@nexus/core`; what is tested here is
 * everything a plan COSTS — which flags are written and in which order, how the
 * board is rebuilt without ever passing through an empty state, and which
 * device preferences a plan may write over.
 */

const registry = createModuleRegistry();

/** Every call the ports took, in order, as flat strings — the whole point is the ORDER. */
interface Recorder {
  readonly ports: PlanApplyPorts;
  readonly calls: string[];
}

function recorder(existing: readonly string[] = []): Recorder {
  const calls: string[] = [];
  const layout: DashboardWidgetInstance[] = existing.map((widgetId, index) => ({
    instanceId: `before-${index}`,
    widgetId,
    size: "M",
    config: null,
  }));
  return {
    calls,
    ports: {
      setFlag: async (_profileId, moduleId, enabled) => {
        calls.push(`flag ${moduleId}=${enabled}`);
      },
      dashboardWidgets: async () => {
        calls.push("list");
        return layout;
      },
      addDashboardWidget: async (_profileId, widgetId, size) => {
        calls.push(`add ${widgetId} ${size}`);
        return layout;
      },
      removeDashboardWidget: async (_profileId, instanceId) => {
        calls.push(`remove ${instanceId}`);
        return layout;
      },
    },
  };
}

/** A plan with nothing in it — law 1's artefact, the one „Preskoči" produces. */
function emptyPlan(): ProfilePlan {
  return {
    modules: ESSENTIALS_MODULE_PRESET,
    packs: [],
    board: [],
    navPrimary: [],
    accentShape: null,
    calendarView: null,
    reasons: [],
  };
}

/** A bricklayer's, near enough: a trade, a composed board, a pinned shortlist and a rhythm. */
function fullPlan(): ProfilePlan {
  return {
    modules: { ...ESSENTIALS_MODULE_PRESET, pro: true, finance: true },
    packs: ["gradnja", "zanat"],
    board: [
      { widgetId: "calendar:danas", size: "M" },
      { widgetId: "finance:naplate", size: "M" },
      { widgetId: "tasks:hitno-kasni", size: "L" },
    ],
    navPrimary: ["pro", "tasks", "calendar"],
    accentShape: "posao",
    calendarView: "dan",
    reasons: [],
  };
}

function apply(
  plan: ProfilePlan,
  ports: PlanApplyPorts,
  options: {
    currentFlags?: Readonly<Record<string, boolean>> | null;
    kind?: "personal" | "business";
    onStage?: (stage: PlanStage) => void;
  } = {},
): Promise<void> {
  return applyProfilePlan({
    ports,
    profileId: "p1",
    kind: options.kind ?? "personal",
    registry,
    plan,
    currentFlags: options.currentFlags ?? null,
    ...(options.onStage === undefined ? {} : { onStage: options.onStage }),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubBrowser(seed: Readonly<Record<string, string>> = {}): {
  storage: Storage;
  painted: string[];
} {
  const storage = memoryStorage(seed);
  const painted: string[] = [];
  vi.stubGlobal("localStorage", storage);
  vi.stubGlobal("document", {
    documentElement: {
      setAttribute: (name: string, value: string) => painted.push(`${name}=${value}`),
    },
  });
  return { storage, painted };
}

describe("the flags", () => {
  /**
   * PACKS BEFORE MODULES, and the order is load-bearing rather than tidy:
   * „Stručne alatke" is switched on exactly when a pack was chosen, so a
   * failure between the two loops must leave the drawer OFF with packs on
   * record — harmless, and fixed by the retry — rather than ON with nothing in
   * it, which is the empty page the whole design exists to make unreachable.
   */
  it("writes every pack before it writes any module", () => {
    const { ports, calls } = recorder();
    stubBrowser();
    return apply(fullPlan(), ports).then(() => {
      const firstModule = calls.findIndex((call) => call === "flag pro=true");
      const lastPack = calls.map((call) => call.startsWith("flag pack:")).lastIndexOf(true);
      expect(lastPack).toBeGreaterThanOrEqual(0);
      expect(firstModule).toBeGreaterThan(lastPack);
      expect(calls).toContain("flag pack:gradnja=true");
      expect(calls).toContain("flag pack:zanat=true");
      // Every pack is written on a first run, „no" included: what toolkits you
      // have is a stored fact of the profile, not an accident of this build.
      expect(calls).toContain("flag pack:kuhinja=false");
    });
  });

  it("writes every selectable module on a first run, and only the changes on a rerun", async () => {
    const first = recorder();
    stubBrowser();
    await apply(fullPlan(), first.ports);
    const written = first.calls.filter(
      (call) => call.startsWith("flag ") && !call.startsWith("flag pack:"),
    );
    expect(written).toHaveLength(Object.keys(ESSENTIALS_MODULE_PRESET).length);

    const again = recorder();
    await apply(fullPlan(), again.ports, {
      currentFlags: { ...ESSENTIALS_MODULE_PRESET, "pack:gradnja": true, "pack:zanat": true },
    });
    expect(
      again.calls.filter((call) => call.startsWith("flag ") && !call.startsWith("flag pack:")),
    ).toEqual(["flag pro=true"]);
  });

  it("changes nothing on a rerun that answered nothing", async () => {
    const { ports, calls } = recorder();
    stubBrowser();
    await apply(emptyPlan(), ports, {
      currentFlags: ESSENTIALS_MODULE_PRESET,
    });
    expect(calls.filter((call) => call.startsWith("flag ") && call.endsWith("=true"))).toEqual([]);
  });
});

describe("the board", () => {
  /**
   * THE ONE ORDER THAT WORKS, and it reads backwards on purpose.
   *
   * A board with no rows IS the default arrangement, so removing the last
   * placement puts the five default cards back and the next `add` writes them
   * out as real rows before appending. Clear-then-fill therefore leaves eleven
   * cards: the five it thought it had deleted, plus the plan's. Adding first
   * never passes through zero.
   */
  it("adds every card the plan composed before it removes anything", async () => {
    const { ports, calls } = recorder(["calendar:danas", "tasks:predstojece"]);
    stubBrowser();
    await apply(fullPlan(), ports);
    expect(calls.filter((call) => !call.startsWith("flag "))).toEqual([
      "list",
      "add calendar:danas M",
      "add finance:naplate M",
      "add tasks:hitno-kasni L",
      "remove before-0",
      "remove before-1",
    ]);
  });

  /**
   * Law 1 one level down — and on a rerun it is also what keeps a plan with
   * nothing to say from flattening a board somebody arranged by hand.
   */
  it("does not touch the board when the plan composed none", async () => {
    const { ports, calls } = recorder(["calendar:danas"]);
    stubBrowser();
    await apply(emptyPlan(), ports);
    expect(calls.filter((call) => !call.startsWith("flag "))).toEqual([]);
  });
});

describe("the look", () => {
  it("pins the shortlist, and seeds the view and the accent a fresh profile has none of", async () => {
    const { ports } = recorder();
    const { storage, painted } = stubBrowser();
    await apply(fullPlan(), ports);
    expect(readPinnedModules("p1")).toEqual(["pro", "tasks", "calendar"]);
    expect(storage.getItem("nexus.calendar.view.p1")).toBe("dan");
    expect(storage.getItem("nexus.accent.p1")).toBe(ACCENT_FOR_SHAPE.posao);
    expect(painted).toEqual([`data-accent=${ACCENT_FOR_SHAPE.posao}`]);
  });

  /**
   * SEEDED, NOT SET. Both of these have a chooser of their own, so somebody who
   * reopens the questionnaire a year later to switch one module on must not
   * find their app repainted and their calendar back on a view they left.
   */
  it("leaves an accent and a view the profile already chose", async () => {
    const { ports } = recorder();
    const { storage, painted } = stubBrowser({
      "nexus.accent.p1": "maslina",
      "nexus.calendar.view.p1": "agenda",
    });
    await apply(fullPlan(), ports);
    expect(storage.getItem("nexus.accent.p1")).toBe("maslina");
    expect(storage.getItem("nexus.calendar.view.p1")).toBe("agenda");
    expect(painted).toEqual([]);
  });

  /**
   * A business profile is created and set up from the personal one still on
   * screen, so its accent is written WITHOUT painting — repainting would
   * recolour the shell around the dialog rather than the profile being prepared.
   */
  it("writes a business profile's accent without repainting the document", async () => {
    const { ports } = recorder();
    const { storage, painted } = stubBrowser();
    await apply(fullPlan(), ports, { kind: "business" });
    expect(storage.getItem("nexus.accent.p1")).toBe(ACCENT_FOR_SHAPE.posao);
    expect(painted).toEqual([]);
  });

  it("pins nothing, and writes no preference, for a plan that decided nothing", async () => {
    const { ports } = recorder();
    const { storage } = stubBrowser();
    await apply(emptyPlan(), ports);
    expect(readPinnedModules("p1")).toEqual([]);
    expect(storage.getItem("nexus.calendar.view.p1")).toBeNull();
    expect(storage.getItem("nexus.accent.p1")).toBeNull();
  });

  /**
   * Every shape wears a colour, and no two wear the same one — the accent is
   * the first thing a person sees about their own Nexus, so „posao" and
   * „firma" landing on the same graphite would silently undo the distinction
   * the question was asked to draw.
   */
  it("gives every week shape its own accent", () => {
    const worn = Object.values(ACCENT_FOR_SHAPE);
    expect(new Set(worn).size).toBe(worn.length);
    // „zlato" is what a profile that never answered gets, so nothing may map to
    // it: „nobody said anything" has to stay distinguishable from „somebody
    // said something and it happened to land on the default".
    expect(worn).not.toContain("zlato");
  });
});

describe("the „Priprema“ screen steps", () => {
  it("names each stage once, in order, before its work", async () => {
    const { ports, calls } = recorder();
    stubBrowser();
    const seen: PlanStage[] = [];
    await apply(fullPlan(), ports, {
      onStage: (stage) => {
        seen.push(stage);
        calls.push(`stage ${stage}`);
      },
    });
    expect(seen).toEqual([...PLAN_STAGES]);
    expect(calls.indexOf("stage packs")).toBeLessThan(calls.indexOf("flag pack:gradnja=true"));
    expect(calls.indexOf("stage board")).toBeLessThan(calls.indexOf("list"));
  });
});
