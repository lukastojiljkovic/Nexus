import { describe, expect, it } from "vitest";

import { parseScenario, parseScenarioFile, ScenarioError } from "./scenario.js";

/** A minimal scenario that parses, as `structuredClone`-able JSON — the base every bad case mutates. */
function base(): Record<string, unknown> {
  return {
    id: "nav-passcode-sr",
    title: "Where the passcode is changed",
    locale: "sr",
    conversation: [{ role: "user", content: "Gde menjam šifru?" }],
    tools: [{ name: "app.open", effect: "navigate" }],
    knowledge: [
      {
        citation: { kind: "app-manual", id: "manual-security", title: "Bezbednost i šifra" },
        text: "Šifra se menja u Podešavanjima, na kartici Bezbednost.",
        score: 0.9,
      },
    ],
    confirmations: [],
    maxSteps: 2,
    expect: {
      toolsCalled: [{ name: "app.open", args: { settings: { eq: "security" } } }],
      language: "sr",
      maxSteps: 2,
    },
    script: [
      { toolCalls: [{ name: "app.open", arguments: { module: "settings", settings: "security" } }] },
      { text: "Šifru menjaš u Podešavanjima, na kartici Bezbednost." },
    ],
  };
}

/** The base with a mutation applied, as the JSON a broken file would hold. */
function broken(mutate: (draft: Record<string, unknown>) => void): unknown {
  const draft = base();
  mutate(draft);
  return draft;
}

describe("parseScenario", () => {
  it("parses a well-formed scenario and drops no field", () => {
    const scenario = parseScenario(base(), "navigation.json");
    expect(scenario.id).toBe("nav-passcode-sr");
    expect(scenario.locale).toBe("sr");
    expect(scenario.tools[0]?.name).toBe("app.open");
    expect(scenario.knowledge[0]?.citation.id).toBe("manual-security");
    expect(scenario.script).toHaveLength(2);
    expect(scenario.expect.language).toBe("sr");
    // The turn under test is the last message, and the harness reads it from there.
    expect(scenario.conversation.at(-1)?.role).toBe("user");
  });

  it("parses a multi-turn conversation and keeps the order", () => {
    const scenario = parseScenario(
      broken((draft) => {
        draft["conversation"] = [
          { role: "user", content: "Otkazano je, cekam helikopter." },
          { role: "assistant", content: "Gde se nalazis?" },
          { role: "user", content: "Na planini, bez signala." },
        ];
      }),
      "hiker.json",
    );
    expect(scenario.conversation.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "user",
    ]);
  });

  const refusals: readonly [string, unknown][] = [
    ["a scenario with no id", broken((draft) => delete draft["id"])],
    ["an id that is not a slug", broken((draft) => (draft["id"] = "Nav Passcode"))],
    ["an unknown locale", broken((draft) => (draft["locale"] = "de"))],
    ["an unknown top-level key", broken((draft) => (draft["expects"] = {}))],
    [
      "a conversation that does not end with the user turn",
      broken((draft) => {
        draft["conversation"] = [{ role: "assistant", content: "Kako mogu da pomognem?" }];
      }),
    ],
    ["an empty conversation", broken((draft) => (draft["conversation"] = []))],
    [
      "a message with no content",
      broken((draft) => {
        draft["conversation"] = [{ role: "user" }];
      }),
    ],
    ["a tool name that is not module.verb", broken((draft) => {
      draft["tools"] = [{ name: "openSettings", effect: "navigate" }];
    })],
    [
      "the same tool offered twice",
      broken((draft) => {
        draft["tools"] = [
          { name: "app.open", effect: "navigate" },
          { name: "app.open", effect: "navigate" },
        ];
      }),
    ],
    [
      "a write tool with no confirmation line",
      broken((draft) => {
        draft["tools"] = [{ name: "tasks.create", effect: "write" }];
      }),
    ],
    [
      "a write tool with nobody to answer the confirmation",
      broken((draft) => {
        draft["tools"] = [
          { name: "tasks.create", effect: "write", summary: { sr: "Dodati zadatak.", en: "Add a task." } },
        ];
        draft["expect"] = { toolsCalled: [{ name: "tasks.create" }] };
        draft["confirmations"] = [];
      }),
    ],
    [
      "an expectation of a tool the scenario never offers",
      broken((draft) => {
        draft["expect"] = { toolsCalled: [{ name: "tasks.create" }] };
      }),
    ],
    [
      "forbidding a tool the scenario never offers",
      broken((draft) => {
        draft["expect"] = { toolsNotCalled: ["notes.create"] };
      }),
    ],
    [
      "citing a passage no fixture carries",
      broken((draft) => {
        draft["expect"] = { cites: ["pack-unknown"] };
      }),
    ],
    [
      "expecting a safety notice with no safety fixture",
      broken((draft) => {
        draft["expect"] = { safetyNotice: true };
      }),
    ],
    [
      "an unknown expectation key",
      broken((draft) => {
        draft["expect"] = { citesEverything: true };
      }),
    ],
    [
      "an argument constraint that constrains nothing",
      broken((draft) => {
        draft["expect"] = { toolsCalled: [{ name: "app.open", args: { module: {} } }] };
      }),
    ],
    [
      "an argument constraint whose pattern is not a pattern",
      broken((draft) => {
        draft["expect"] = { toolsCalled: [{ name: "app.open", args: { module: { matches: "(" } } }] };
      }),
    ],
    [
      "a script longer than the step budget it is scored against",
      broken((draft) => {
        draft["maxSteps"] = 1;
      }),
    ],
    ["a script with no completions", broken((draft) => (draft["script"] = []))],
    [
      "a completion that neither says anything nor calls anything",
      broken((draft) => {
        draft["script"] = [{ promptTokens: 10 }];
      }),
    ],
    ["a step budget of zero", broken((draft) => (draft["maxSteps"] = 0))],
    [
      "the same citation id in two fixtures",
      broken((draft) => {
        const knowledge = draft["knowledge"] as unknown[];
        draft["knowledge"] = [knowledge[0], knowledge[0]];
      }),
    ],
    [
      "a citation of an unknown kind",
      broken((draft) => {
        draft["knowledge"] = [
          { citation: { kind: "webpage", id: "x", title: "X" }, text: "X", score: 1 },
        ];
      }),
    ],
    [
      "a citation whose id is not a slug",
      broken((draft) => {
        draft["knowledge"] = [
          { citation: { kind: "pack", id: "Pack 01", title: "X" }, text: "X", score: 1 },
        ];
      }),
    ],
    [
      "an id longer than the bound",
      broken((draft) => {
        draft["id"] = "a".repeat(201);
      }),
    ],
    [
      "a fixture whose score is not a number",
      broken((draft) => {
        draft["knowledge"] = [
          { citation: { kind: "pack", id: "x", title: "X" }, text: "X", score: "high" },
        ];
      }),
    ],
    [
      "a location with an unknown key",
      broken((draft) => {
        draft["tools"] = [{ name: "app.open", effect: "navigate", navigateTo: { module: "settings", tab: "security" } }];
      }),
    ],
  ];

  for (const [what, value] of refusals) {
    it(`refuses ${what}`, () => {
      expect(() => parseScenario(value, "bad.json")).toThrow(ScenarioError);
    });
  }

  it("names the field and the file in the refusal", () => {
    const value = broken((draft) => (draft["locale"] = "de"));
    expect(() => parseScenario(value, "navigation.json")).toThrow(
      /navigation\.json\.locale must be one of sr, en/,
    );
  });
});

describe("parseScenarioFile", () => {
  it("reads a file as a list of scenarios", () => {
    const parsed = parseScenarioFile({ scenarios: [base()] }, "navigation.json");
    expect(parsed).toHaveLength(1);
  });

  it("refuses a bare array, so a mis-shaped file names itself", () => {
    expect(() => parseScenarioFile([base()], "navigation.json")).toThrow(
      /navigation\.json must be an object/,
    );
  });

  it("refuses a file with no scenarios", () => {
    expect(() => parseScenarioFile({ scenarios: [] }, "empty.json")).toThrow(/empty\.json\.scenarios is empty/);
  });

  it("refuses an unknown key beside `scenarios`", () => {
    expect(() => parseScenarioFile({ scenarios: [base()], locale: "sr" }, "navigation.json")).toThrow(
      /unknown key "locale"/,
    );
  });
});
