import { buildProfilePlan } from "@nexus/core";
import type { PlanReason, ProfilePlan, Signal } from "@nexus/core";
import { describe, expect, it } from "vitest";

import { createModuleRegistry } from "../../shared/modules.js";
import { resolveModuleSelection } from "../../shared/onboardingPresets.js";
import {
  heardTrades,
  joinList,
  packName,
  planReasonLine,
  planReasonLines,
} from "./profilePlanCopy.js";
import { strings } from "./strings.js";

/**
 * ADR-086 §2: a plan's reasons, as Serbian sentences.
 *
 * The tests run against the REAL registry and the real copy table, because the
 * one property that matters cannot be checked against a fixture: law 4 says
 * every decision names the signals that caused it, and this module says every
 * decision out loud. A reason with no sentence is a decision the product cannot
 * explain — so the load-bearing test here is that a plan built from every
 * answer the questionnaire can produce yields a line for every reason in it.
 */

const REGISTRY = createModuleRegistry();
const BASE = resolveModuleSelection(REGISTRY, {});

function plan(signals: readonly Signal[]): ProfilePlan {
  return buildProfilePlan(signals, REGISTRY, BASE);
}

describe("joinList", () => {
  it("writes the Serbian list, not a comma-joined one", () => {
    const and = strings.onboarding.reveal.and;
    expect(joinList([])).toBe("");
    expect(joinList(["Pravo"])).toBe("Pravo");
    // Two items take „i" with no comma before it — the rule Serbian has.
    expect(joinList(["Pravo", "Gradnja"])).toBe(`Pravo ${and} Gradnja`);
    expect(joinList(["Pravo", "Gradnja", "Zanatstvo"])).toBe(`Pravo, Gradnja ${and} Zanatstvo`);
  });
});

describe("packName", () => {
  it("uses the drawer's own word for a pack", () => {
    expect(packName("pravo")).toBe(strings.pro.packs.pravo.name);
  });

  it("hands back an id it has no name for rather than throwing", () => {
    // A pack removed from the catalogue can still sit in a stored answer, and
    // a reveal that crashes is worse than one naming an id nobody recognises.
    expect(packName("zdravstvo")).toBe("zdravstvo");
  });
});

describe("planReasonLine", () => {
  it("agrees the numeral with the count — 3–6 cards straddles the boundary every time", () => {
    const s = strings.onboarding.reveal;
    const line = (count: number): string | null =>
      planReasonLine({ key: "board", values: [String(count)], causedBy: [] } as PlanReason);
    expect(line(1)).toContain(s.boardUnitOne);
    expect(line(3)).toContain(s.boardUnitFew);
    expect(line(5)).toContain(s.boardUnitMany);
  });

  it("is null for a key this build has no sentence for", () => {
    // Deliberately null rather than the raw key: a decision the product cannot
    // explain must be visibly missing, not disguised as copy.
    const reason = { key: "teleport", values: [], causedBy: [] } as unknown as PlanReason;
    expect(planReasonLine(reason)).toBeNull();
  });

  it("names the calendar view and the accent in the words their own choosers use", () => {
    const calendar = planReasonLine({ key: "calendar", values: ["dan"], causedBy: [] });
    expect(calendar).toContain(strings.calendar.viewDan);
    // `posao` wears graphite (`ACCENT_FOR_SHAPE`), named by „Izgled".
    const accent = planReasonLine({ key: "accent", values: ["posao"], causedBy: [] });
    expect(accent).toContain(strings.settings.appearance.accentNames.grafit);
  });
});

describe("planReasonLines", () => {
  it("says nothing at all about a plan built from nothing", () => {
    // Law 1, one level up: no signals is today's app, and today's app has
    // nothing to explain.
    expect(planReasonLines(plan([]))).toEqual([]);
  });

  it("gives every reason a sentence, for every answer the questionnaire can produce", () => {
    // The load-bearing one. Every week shape, every tempo, every keep and a
    // trade — the widest plan the flow can build — and then the count of lines
    // is compared with the count of reasons rather than with a number, so a
    // reason kind added to `plan.ts` without copy fails here instead of
    // shipping as a decision the app cannot explain.
    const signals: Signal[] = [
      { kind: "week", id: "firma" },
      { kind: "week", id: "kondicija" },
      { kind: "trade", pack: "pravo", term: "advokat", via: "typed" },
      { kind: "trade", pack: "racunovodstvo", term: "Vodim knjige", via: "activity" },
      { kind: "tempo", id: "planer" },
      { kind: "keep", id: "novac" },
      { kind: "keep", id: "zdravlje" },
      { kind: "keep", id: "dokumenta" },
      { kind: "keep", id: "ideje" },
      { kind: "keep", id: "privatno" },
    ];
    const built = plan(signals);
    expect(built.reasons.length).toBeGreaterThan(0);
    const lines = planReasonLines(built);
    expect(lines).toHaveLength(built.reasons.length);
    expect(lines.every((line) => line.trim().length > 0)).toBe(true);
    // Nothing leaks an unfilled slot into the Serbian.
    expect(lines.some((line) => line.includes("{"))).toBe(false);
  });
});

describe("heardTrades", () => {
  it("quotes the person's own spelling back, one entry per term", () => {
    const built = plan([
      { kind: "trade", pack: "gradnja", term: "ZIDAR", via: "typed" },
      { kind: "trade", pack: "zanat", term: "ZIDAR", via: "typed" },
    ]);
    // One word said once, whatever the lexicon opened for it — two chips for
    // one term would look broken.
    expect(heardTrades(built)).toEqual([
      {
        term: "ZIDAR",
        packs: joinList([packName("gradnja"), packName("zanat")]),
      },
    ]);
  });

  it("is empty for a plan nobody named a trade in", () => {
    expect(heardTrades(plan([{ kind: "week", id: "dom" }]))).toEqual([]);
  });
});

/**
 * The other property that cannot be checked against a fixture, and it is not
 * about copy — it is here because this is the only file on the desktop side
 * that builds a plan against the REAL registry.
 *
 * Law 3 („every board entry is drawable") is enforced by FILTERING, so a widget
 * id the want tables name and no manifest publishes is not an error: it is a
 * card that quietly never appears, on a board that is simply one shorter.
 * `plan.test.ts` pins those tables against a fixture whose ids were copied from
 * the real registry BY HAND, which is a property asserted once and assumed ever
 * after (DC-74). ADR-086 added four cards and four table entries naming them,
 * in two packages, so that seam is what this checks.
 */
describe("the want tables against the real registry", () => {
  function boardOf(signals: readonly Signal[]): string[] {
    return plan(signals).board.map((entry) => entry.widgetId);
  }

  it("draws each card ADR-086 added, for the answer that argues for it", () => {
    // „Dokumenta" and „Novac": two keeps, three cards, and DOC's is one of them.
    expect(
      boardOf([
        { kind: "keep", id: "dokumenta" },
        { kind: "keep", id: "novac" },
      ]),
    ).toContain("files:nedavno");

    // A designer gets the drawer's own card and CANV's.
    const designer = boardOf([
      { kind: "trade", pack: "dizajn", term: "dizajner", via: "typed" },
      { kind: "keep", id: "ideje" },
      { kind: "keep", id: "novac" },
    ]);
    expect(designer).toContain("pro:paketi");
    expect(designer).toContain("canvas:table");

    // An engineer gets ELEC's.
    expect(
      boardOf([
        { kind: "trade", pack: "inzenjering", term: "inženjer", via: "typed" },
        { kind: "keep", id: "ideje" },
        { kind: "keep", id: "novac" },
      ]),
    ).toContain("electronics:kola");
  });
});
