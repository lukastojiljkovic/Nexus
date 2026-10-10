import { describe, expect, it } from "vitest";

import { createHarness } from "./harness.js";
import { parseScenario, type Scenario } from "./scenario.js";
import { createScriptedModel, referenceRunAgentTurn, type ScriptedModel } from "./scripted.js";

/**
 * A scenario built through the validator, so the harness is tested on the same
 * shapes the files hold. `scripted` captures the model the harness built, which
 * is how a test inspects what the loop actually asked for.
 */
function scenario(overrides: Record<string, unknown> = {}): Scenario {
  const draft: Record<string, unknown> = {
    id: "harness-test-sr",
    title: "Harness test",
    locale: "sr",
    conversation: [{ role: "user", content: "Gde menjam šifru?" }],
    tools: [{ name: "app.open", effect: "navigate" }],
    knowledge: [
      {
        citation: { kind: "app-manual", id: "manual-security", title: "Bezbednost" },
        text: "Šifra se menja u Podešavanjima, na kartici Bezbednost.",
        score: 0.9,
      },
    ],
    confirmations: [],
    maxSteps: 3,
    expect: { toolsCalled: [{ name: "app.open" }], language: "sr", maxSteps: 2 },
    script: [
      { toolCalls: [{ name: "app.open", arguments: { module: "settings", settings: "security" } }] },
      { text: "Šifru menjaš u Podešavanjima, na kartici Bezbednost." },
    ],
    ...overrides,
  };
  return parseScenario(draft, "test.json");
}

function harnessFor(capture: { model?: ScriptedModel } = {}) {
  let ticks = 0;
  return createHarness({
    runAgentTurn: referenceRunAgentTurn,
    modelFor: (current) => {
      const options =
        current.modelContextTokens === undefined ? {} : { contextTokens: current.modelContextTokens };
      const model = createScriptedModel(current.script, options);
      capture.model = model;
      return model;
    },
    // A clock that advances 3 ms per reading, so a duration is a computed
    // number and the two readings of one scenario differ by exactly 3.
    now: () => (ticks += 3),
  });
}

describe("createHarness", () => {
  it("runs a scenario through the loop and scores it", async () => {
    const capture: { model?: ScriptedModel } = {};
    const result = await harnessFor(capture).runScenario(scenario());
    expect(result.passed).toBe(true);
    expect(result.steps).toBe(2);
    expect(result.tokens.estimated).toBe(true);
    expect(result.durationMs).toBe(3);
    expect(result.finalText).toBe("Šifru menjaš u Podešavanjima, na kartici Bezbednost.");
    expect(result.expectations.map((entry) => entry.passed)).toEqual([true, true, true]);
    // The loop asked for the tool before answering, and the fake tool was offered.
    expect(capture.model?.requests).toHaveLength(2);
    expect(capture.model?.requests[0]?.tools.map((tool) => tool.name)).toEqual(["app.open"]);
    expect(capture.model?.requests[0]?.messages.at(-1)?.content).toBe("Gde menjam šifru?");
  });

  it("fails a scenario whose expectation the turn did not meet", async () => {
    const result = await harnessFor().runScenario(
      scenario({ expect: { toolsCalled: [{ name: "app.open", args: { settings: { eq: "passcode" } } }] } }),
    );
    expect(result.passed).toBe(false);
    expect(result.expectations[0]?.detail).toContain("security");
  });

  it("spends the scenario's confirmations in order and refuses once they run out", async () => {
    const write = {
      name: "tasks.create",
      effect: "write",
      summary: { sr: "Dodati zadatak.", en: "Add a task." },
      content: "Task created.",
    };
    const capture: { model?: ScriptedModel } = {};
    const result = await harnessFor(capture).runScenario(
      scenario({
        tools: [write],
        confirmations: [false],
        expect: { toolsCalled: [{ name: "tasks.create" }], maxSteps: 2 },
        script: [
          { toolCalls: [{ name: "tasks.create", arguments: { title: "Kupi vodu" } }] },
          { text: "U redu, nisam dodao zadatak." },
        ],
      }),
    );
    expect(result.passed).toBe(true);
    // A refusal is a normal result: the model read it and answered around it.
    expect(capture.model?.requests[1]?.messages.at(-1)?.content).toBe(
      "The user declined. Nothing changed.",
    );
  });

  it("sends a scenario's own `declined` line to the model when the user refuses", async () => {
    const capture: { model?: ScriptedModel } = {};
    await harnessFor(capture).runScenario(
      scenario({
        tools: [
          {
            name: "tasks.create",
            effect: "write",
            summary: { sr: "Dodati zadatak.", en: "Add a task." },
            declined: "Korisnik je odbio. Nista nije promenjeno.",
          },
        ],
        confirmations: [false],
        expect: { toolsCalled: [{ name: "tasks.create" }] },
        script: [
          { toolCalls: [{ name: "tasks.create", arguments: { title: "Kupi vodu" } }] },
          { text: "Nista nije promenjeno." },
        ],
      }),
    );
    expect(capture.model?.requests[1]?.messages.at(-1)?.content).toBe(
      "Korisnik je odbio. Nista nije promenjeno.",
    );
  });

  it("recovers from a tool that throws, and hands the failure to the model", async () => {
    const capture: { model?: ScriptedModel } = {};
    const result = await harnessFor(capture).runScenario(
      scenario({
        tools: [{ name: "tasks.list", effect: "read", fail: "the task store is locked" }],
        expect: {
          toolsCalled: [{ name: "tasks.list" }],
          maxSteps: 2,
          answerContains: ["zakljucana"],
        },
        script: [
          { toolCalls: [{ name: "tasks.list", arguments: {} }] },
          { text: "Baza je zakljucana, ne mogu da procitam zadatke." },
        ],
      }),
    );
    expect(result.passed).toBe(true);
    // The loop did not throw: it turned the failure into a tool message.
    expect(result.error).toBeUndefined();
    expect(capture.model?.requests[1]?.messages.at(-1)?.content).toContain("the task store is locked");
  });

  it("stops on the step budget and reports it", async () => {
    const result = await harnessFor().runScenario(
      // Straight through the validator, which refuses a script longer than the
      // budget — so this one is built by hand, as a model that never answers is.
      {
        ...scenario({ maxSteps: 2, expect: { maxSteps: 1 } }),
        script: [
          { toolCalls: [{ name: "app.open", arguments: { module: "settings" } }] },
          { toolCalls: [{ name: "app.open", arguments: { module: "tasks" } }] },
        ],
      },
    );
    expect(result.passed).toBe(false);
    expect(result.steps).toBe(2);
    expect(result.expectations[0]?.detail).toBe("2 of 1 model completions used");
  });

  it("records a call to a tool the scenario never offered", async () => {
    const result = await harnessFor().runScenario(
      scenario({
        expect: { toolsCalled: [{ name: "app.open" }] },
        script: [
          { toolCalls: [{ name: "tasks.list", arguments: {} }] },
          { text: "Ne mogu to da uradim." },
        ],
      }),
    );
    expect(result.passed).toBe(false);
    // The call is in the trace even though no tool answers to that name: the
    // harness scores what the model asked for, not what the fakes executed.
    expect(result.expectations[0]?.detail).toContain("tasks.list");
  });

  it("fails the scenario, with the message, when the loop throws", async () => {
    const harness = createHarness({
      runAgentTurn: async () => {
        throw new Error("no model loaded");
      },
      modelFor: (current) => createScriptedModel(current.script),
    });
    const result = await harness.runScenario(scenario());
    expect(result.passed).toBe(false);
    expect(result.error).toBe("no model loaded");
  });
});

describe("runSuite", () => {
  it("totals the scenarios it ran", async () => {
    const suite = await harnessFor().runSuite(
      [scenario(), scenario({ id: "harness-test-two-sr" })],
      "scripted transcript",
    );
    expect(suite.model).toBe("scripted transcript");
    expect(suite.totals).toMatchObject({
      scenarios: 2,
      passed: 2,
      failed: 0,
      steps: 4,
    });
    expect(suite.totals.promptTokens).toBeGreaterThan(0);
    expect(suite.totals.estimatedTokens).toBe(true);
    // Six readings of a clock that advances 3 ms each: the suite's own start is
    // the first, so the span it reports is 15.
    expect(suite.totals.durationMs).toBe(15);
    expect(suite.results.map((result) => result.durationMs)).toEqual([3, 3]);
  });
});
