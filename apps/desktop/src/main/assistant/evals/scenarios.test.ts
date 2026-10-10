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
  it("passes every scenario", async () => {
    const suite = await harness.runSuite(scenarios, "scripted transcript");
    const failures = suite.results
      .filter((result) => !result.passed)
      .flatMap((result) => [
        result.error === undefined ? undefined : `${result.id}: the turn threw: ${result.error}`,
        ...result.expectations
          .filter((expectation) => !expectation.passed)
          .map((expectation) => `${result.id}: ${expectation.label} — ${expectation.detail}`),
      ])
      .filter((line) => line !== undefined);
    expect(failures).toEqual([]);
    expect(suite.totals.passed).toBe(scenarios.length);
    expect(suite.totals.failed).toBe(0);
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
