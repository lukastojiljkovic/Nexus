import { describe, expect, it } from "vitest";

import { runAgentTurn } from "@nexus/core";

import { createHarness, type HarnessOptions } from "./harness.js";
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

function harnessFor(
  capture: { model?: ScriptedModel } = {},
  options: Partial<HarnessOptions> = {},
) {
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
    ...options,
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
    expect(result.navigations).toEqual([{ module: "settings", settings: "security" }]);
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

  it("asks once when the model repeats a call the user refused, through the real loop", async () => {
    // The one scenario the scripted mode cannot score: `scripted.ts` is a
    // stand-in that implements none of the loop's own rules, so the real loop
    // runs here, and the harness's own `confirm` is what counts the questions.
    const capture: { model?: ScriptedModel } = {};
    const result = await createHarness({
      runAgentTurn,
      modelFor: (current) => {
        const model = createScriptedModel(current.script);
        capture.model = model;
        return model;
      },
    }).runScenario(
      scenario({
        conversation: [{ role: "user", content: "Dodaj zadatak da kupim vodu." }],
        tools: [
          {
            name: "tasks.create",
            effect: "write",
            summary: { sr: "Dodaću zadatak „Kupi vodu“.", en: "I will add the task “Buy water”." },
            content: "Task created: Kupi vodu.",
          },
        ],
        confirmations: [false],
        maxSteps: 3,
        expect: {
          toolsCalled: [{ name: "tasks.create", args: { title: { eq: "Kupi vodu" } } }],
          answerContains: ["nisam dodao"],
          language: "sr",
          maxSteps: 3,
        },
        script: [
          { toolCalls: [{ name: "tasks.create", arguments: { title: "Kupi vodu" } }] },
          { toolCalls: [{ name: "tasks.create", arguments: { title: "Kupi vodu" } }] },
          { text: "U redu, nisam dodao zadatak. Ništa nije promenjeno." },
        ],
      }),
    );

    expect(result.passed).toBe(true);
    expect(result.confirmations).toEqual([{ tool: "tasks.create", approved: false }]);
    // The repeat never reached the tool: the model reads the loop's own answer
    // to it, and not the refusal sentence a second run would have produced.
    expect(capture.model?.requests[2]?.messages.at(-1)?.content).toContain("already refused");
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

  it("records what each request offered, so a turn that never saw a tool is visible", async () => {
    const result = await harnessFor().runScenario(
      scenario({
        tools: [{ name: "app.open", effect: "navigate" }, { name: "tasks.list", effect: "read" }],
        expect: { toolsCalled: [{ name: "app.open" }] },
        script: [
          { toolCalls: [{ name: "app.open", arguments: { module: "tasks" } }] },
          { text: "Otvorio sam zadatke." },
        ],
      }),
    );
    expect(result.toolsOffered).toEqual([["app.open", "tasks.list"], ["app.open", "tasks.list"]]);
  });

  it("records where an app.open result pointed, and checks it against `navigatesTo`", async () => {
    const found = await harnessFor().runScenario(
      scenario({
        expect: {
          toolsCalled: [{ name: "app.open" }],
          navigatesTo: [{ module: "settings", settings: "security" }],
        },
      }),
    );
    expect(found.passed).toBe(true);
    expect(found.navigations).toEqual([{ module: "settings", settings: "security" }]);

    const missed = await harnessFor().runScenario(
      scenario({ expect: { navigatesTo: [{ module: "tasks" }] } }),
    );
    expect(missed.passed).toBe(false);
    expect(missed.expectations[0]?.detail).toContain("settings/security");
  });

  it("keeps no location when the call did not run, so a refused turn navigated nowhere", async () => {
    const result = await harnessFor().runScenario(
      scenario({
        tools: [
          {
            name: "tasks.create",
            effect: "write",
            summary: { sr: "Dodati zadatak.", en: "Add a task." },
            content: "Task created.",
          },
        ],
        confirmations: [false],
        expect: { toolsCalled: [{ name: "tasks.create" }], navigatesTo: [{ module: "tasks" }] },
        script: [
          { toolCalls: [{ name: "tasks.create", arguments: { title: "Kupi vodu" } }] },
          { text: "Nisam dodao zadatak." },
        ],
      }),
    );
    expect(result.navigations).toEqual([]);
    expect(result.passed).toBe(false);
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

  it("hands the tool a caller's real spec, and the generic one when nobody has it", async () => {
    const spec = {
      description: { sr: "Pravi zadatak.", en: "Creates a task." },
      parameters: {
        type: "object",
        properties: { title: { type: "string" } },
        required: ["title"],
        additionalProperties: false,
      },
    };
    const capture: { model?: ScriptedModel } = {};
    await harnessFor(capture, { toolSpecs: { "app.open": spec } }).runScenario(scenario());
    expect(capture.model?.requests[0]?.tools[0]?.description).toEqual(spec.description);
    expect(capture.model?.requests[0]?.tools[0]?.parameters).toEqual(spec.parameters);
    // The name nobody handed a spec in keeps the scenario's own generic one.
    const generic: { model?: ScriptedModel } = {};
    await harnessFor(generic, { toolSpecs: { "tasks.create": spec } }).runScenario(scenario());
    expect(generic.model?.requests[0]?.tools[0]?.description).toEqual({ sr: "app.open", en: "app.open" });
    expect(generic.model?.requests[0]?.tools[0]?.parameters).toMatchObject({
      additionalProperties: true,
    });
  });

  it("reports every call with what its result said", async () => {
    const result = await harnessFor().runScenario(
      scenario({
        tools: [
          {
            name: "tasks.create",
            effect: "write",
            summary: { sr: "Dodati zadatak.", en: "Add a task." },
            fail: "the store is locked",
          },
        ],
        confirmations: [true],
        expect: { claimsOnlyWhatRan: true, maxSteps: 2 },
        script: [
          { toolCalls: [{ name: "tasks.create", arguments: { title: "Kupi vodu" } }] },
          { text: "Nisam dodao zadatak: baza je zaključana." },
        ],
      }),
    );
    expect(result.passed).toBe(true);
    expect(result.calls).toEqual([
      { name: "tasks.create", arguments: { title: "Kupi vodu" }, ok: false },
    ]);
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
