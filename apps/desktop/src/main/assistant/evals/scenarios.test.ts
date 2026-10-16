import { describe, expect, it } from "vitest";

import { createHarness, loadScenarios, loadSafetyNotice } from "./harness.js";
import { createScriptedModel, referenceRunAgentTurn } from "./scripted.js";

/**
 * The scenario set itself, as the suite the maintainer will read.
 *
 * The scripted mode is the harness's own proof: every scenario carries a
 * transcript that a well-behaved model would produce, and every expectation in
 * every scenario must hold against it. A red scenario here is a broken
 * expectation, not a broken model — and the failure list prints the expectation
 * and its reason so the break is visible without opening the file.
 */
const scenarios = loadScenarios();

/**
 * The scenarios a fix this wave did not ship yet leaves red, each with why.
 *
 * Written out and checked in BOTH directions: every listed id exists, still
 * fails, and fails for the reason below, and nothing else fails. An entry that
 * is missing here is a broken expectation or a broken script; an entry that
 * passes is a stale list (the feature landed, or the script lost its teeth),
 * and both are failures of this test rather than of the model.
 */
const PENDING: readonly { readonly id: string; readonly why: string; readonly reasons: readonly string[] }[] = [
  {
    id: "date-relative-relative-days-sr",
    why: "no argument resolver turns \u201eprekosutra\u201c into a day yet",
    reasons: ["toolsCalled(tasks.create)"],
  },
  {
    id: "date-relative-relative-days-en",
    why: "no argument resolver turns \u201cthe day after tomorrow\u201d into a day yet",
    reasons: ["toolsCalled(tasks.create)"],
  },
  {
    id: "quantity-decimal-comma-sr",
    why: "no argument resolver turns \u201e1,5\u201c into 1.5 yet",
    reasons: ["toolsCalled(pantry.add)"],
  },
  {
    id: "quantity-decimal-comma-en",
    why: "no argument resolver turns \u201c1,5\u201d into 1.5 yet",
    reasons: ["toolsCalled(pantry.add)"],
  },
  {
    id: "quantity-spelled-unit-sr",
    why: "no argument resolver maps \u201ekila\u201c onto the declared unit yet",
    reasons: ["toolsCalled(pantry.add)"],
  },
  {
    id: "quantity-spelled-unit-en",
    why: "no argument resolver maps \u201ckilos\u201d onto the declared unit yet",
    reasons: ["toolsCalled(pantry.add)"],
  },
  {
    id: "quantity-half-kilo-sr",
    why: "no argument resolver turns \u201epola kile\u201c into 0.5 kg yet",
    reasons: ["toolsCalled(pantry.add)"],
  },
  {
    id: "quantity-half-kilo-en",
    why: "no argument resolver turns \u201chalf a kilo\u201d into 0.5 kg yet",
    reasons: ["toolsCalled(pantry.add)"],
  },
  {
    id: "claim-without-doing-tasks-sr",
    why: "no verification pass stops a claim about a write that failed",
    reasons: ["claimsOnlyWhatRan"],
  },
  {
    id: "claim-without-doing-tasks-en",
    why: "no verification pass stops a claim about a write that failed",
    reasons: ["claimsOnlyWhatRan"],
  },
];

const harness = createHarness({
  runAgentTurn: referenceRunAgentTurn,
  modelFor: (scenario) =>
    createScriptedModel(
      scenario.script,
      scenario.modelContextTokens === undefined ? {} : { contextTokens: scenario.modelContextTokens },
    ),
});

describe("the scenario set", () => {
  it("holds at least forty scenarios", () => {
    // The brief's floor. A count below it is the failure; the exact number is
    // whatever the files hold, and the report prints it.
    expect(scenarios.length).toBeGreaterThanOrEqual(40);
  });

  it("covers both languages, and at least a dozen scenarios in each", () => {
    const serbian = scenarios.filter((scenario) => scenario.locale === "sr").length;
    const english = scenarios.filter((scenario) => scenario.locale === "en").length;
    expect(serbian).toBeGreaterThanOrEqual(12);
    expect(english).toBeGreaterThanOrEqual(12);
    expect(serbian + english).toBe(scenarios.length);
  });

  it("has unique ids", () => {
    expect(new Set(scenarios.map((scenario) => scenario.id)).size).toBe(scenarios.length);
  });

  it("covers every topic the brief names", () => {
    const ids = scenarios.map((scenario) => scenario.id).join(" ");
    for (const topic of [
      "navigation",
      "tasks",
      "calendar",
      "hiker",
      "injection",
      "unknown",
      "long-context",
      "tool-error",
      "web-off",
      "date-relative",
      "quantity",
      "open-",
      "two-writes",
      "claim-without-doing",
    ]) {
      expect(ids).toContain(topic);
    }
  });

  it("gives every scenario a title and a scripted transcript", () => {
    for (const scenario of scenarios) {
      expect(scenario.title.length).toBeGreaterThan(0);
      expect(scenario.script.length).toBeGreaterThan(0);
    }
  });
});

describe("the scripted mode", () => {
  it("passes every scenario except the ones waiting on a fix this wave did not ship", async () => {
    const suite = await harness.runSuite(scenarios, "scripted transcript");
    const failed = new Map(
      suite.results.filter((result) => !result.passed).map((result) => [result.id, result]),
    );
    const expected = new Set(PENDING.map((entry) => entry.id));
    const unlisted = [...failed.keys()].filter((id) => !expected.has(id)).flatMap((id) => {
      const result = failed.get(id);
      return [
        `${id}: ${result?.error ?? ""}`,
        ...(result?.expectations ?? [])
          .filter((expectation) => !expectation.passed)
          .map((expectation) => `${id}: ${expectation.label} - ${expectation.detail}`),
      ];
    });
    // Nothing outside the list may fail: an unlisted failure is an expectation
    // written wrong or a transcript that no longer does what it says.
    expect(unlisted).toEqual([]);
    // Nothing on the list may pass either, or a stale entry would hide a
    // scenario that stopped measuring anything.
    expect(PENDING.map((entry) => entry.id).filter((id) => !failed.has(id))).toEqual([]);
    for (const entry of PENDING) {
      const result = failed.get(entry.id);
      const reasons = [
        ...(result?.error === undefined ? [] : [`the turn threw: ${result.error}`]),
        ...(result?.expectations ?? [])
          .filter((expectation) => !expectation.passed)
          .map((expectation) => expectation.label),
      ].join(" | ");
      for (const reason of entry.reasons) {
        expect(reasons, `${entry.id}: ${entry.why}`).toContain(reason);
      }
    }
    expect(suite.totals.passed).toBe(scenarios.length - PENDING.length);
    expect(suite.totals.failed).toBe(PENDING.length);
    // Every scenario spends at least one model call and at least one expectation
    // is scored, so the suite cannot be green by asserting nothing.
    expect(suite.totals.steps).toBeGreaterThanOrEqual(scenarios.length);
    expect(
      suite.results.every((result) => result.expectations.length > 0),
    ).toBe(true);
  });
});

describe("the safety notice fixture", () => {
  it("carries both languages, and the Serbian half is Serbian", () => {
    const notice = loadSafetyNotice();
    expect(notice.sr).toContain("stručnu pomoć");
    expect(notice.sr).toContain("112");
    expect(notice.en).toContain("professional help");
    expect(notice.en).toContain("112");
  });
});
