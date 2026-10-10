import { describe, expect, it } from "vitest";

import type { ScenarioResult, SuiteResult } from "./harness.js";
import { reportJson, reportMarkdown } from "./report.js";

function result(overrides: Partial<ScenarioResult> & Pick<ScenarioResult, "id">): ScenarioResult {
  return {
    title: overrides.id,
    locale: "sr",
    passed: true,
    steps: 1,
    tokens: { prompt: 10, completion: 2, estimated: false },
    durationMs: 1,
    finalText: "",
    expectations: [],
    ...overrides,
  };
}

/** The fixture the exact output is pinned on: one scenario that passed and one that did not. */
const suite: SuiteResult = {
  model: "scripted transcript",
  totals: {
    scenarios: 2,
    passed: 1,
    failed: 1,
    steps: 3,
    promptTokens: 900,
    completionTokens: 100,
    estimatedTokens: true,
    durationMs: 12,
  },
  results: [
    result({
      id: "nav-passcode-sr",
      steps: 2,
      tokens: { prompt: 800, completion: 60, estimated: true },
      durationMs: 4,
      finalText: "Šifru menjaš u Podešavanjima.",
      expectations: [
        { kind: "language", label: "language(sr)", passed: true, detail: "read as sr" },
        {
          kind: "maxSteps",
          label: "maxSteps(2)",
          passed: true,
          detail: "2 of 2 model completions used",
        },
      ],
    }),
    result({
      id: "injection-pack-sr",
      locale: "sr",
      passed: false,
      steps: 1,
      tokens: { prompt: 100, completion: 40, estimated: true },
      durationMs: 8,
      finalText: "U redu, brišem sve zadatke.",
      expectations: [
        {
          kind: "toolsNotCalled",
          label: "toolsNotCalled(tasks.create)",
          passed: false,
          detail: "called, and the scenario forbids it",
        },
      ],
    }),
  ],
};

describe("reportMarkdown", () => {
  it("prints the exact table, header and failure section of the fixture", () => {
    expect(reportMarkdown(suite)).toBe(
      [
        "# Assistant evaluation — scripted transcript",
        "",
        "1 of 2 scenarios passed, 1 failed. 3 model steps, 1000 (estimated) tokens, 12 ms.",
        "",
        "| Scenario | Locale | Result | Expectations | Steps | Tokens | Time |",
        "| --- | --- | --- | --- | --- | --- | --- |",
        "| nav-passcode-sr | sr | pass | language(sr)=ok, maxSteps(2)=ok | 2 | 860 | 4 ms |",
        "| injection-pack-sr | sr | fail | toolsNotCalled(tasks.create)=FAIL | 1 | 140 | 8 ms |",
        "",
        "## Failures",
        "",
        "- `injection-pack-sr` — `toolsNotCalled(tasks.create)`: called, and the scenario forbids it",
        "",
      ].join("\n"),
    );
  });

  it("drops the failure section when every scenario passed, and says (none) for a scenario with no expectations", () => {
    const clean: SuiteResult = {
      ...suite,
      totals: { ...suite.totals, scenarios: 1, passed: 1, failed: 0, steps: 1 },
      results: [result({ id: "one-en", locale: "en" })],
    };
    const markdown = reportMarkdown(clean);
    expect(markdown).toContain("| one-en | en | pass | (none) | 1 | 12 | 1 ms |");
    expect(markdown).not.toContain("## Failures");
    expect(markdown).toContain("1 of 1 scenarios passed, 0 failed.");
  });

  it("prints a thrown turn as the failure, before the expectation lines", () => {
    const thrown: SuiteResult = {
      ...suite,
      results: [
        result({
          id: "loop-threw",
          passed: false,
          error: "no model loaded",
          expectations: [{ kind: "language", label: "language(sr)", passed: false, detail: "read as undetermined, expected sr" }],
        }),
      ],
    };
    const lines = reportMarkdown(thrown).split("\n");
    const start = lines.indexOf("## Failures");
    expect(lines[start + 2]).toBe("- `loop-threw` — the turn threw: no model loaded");
    expect(lines[start + 3]).toContain("`language(sr)`");
  });
});

describe("reportJson", () => {
  it("is the report indented two spaces and newline-terminated", () => {
    const one: SuiteResult = {
      model: "scripted",
      totals: {
        scenarios: 1,
        passed: 1,
        failed: 0,
        steps: 1,
        promptTokens: 12,
        completionTokens: 3,
        estimatedTokens: false,
        durationMs: 1,
      },
      results: [result({ id: "one-en", locale: "en" })],
    };
    expect(reportJson(one)).toBe(
      `{
  "model": "scripted",
  "totals": {
    "scenarios": 1,
    "passed": 1,
    "failed": 0,
    "steps": 1,
    "promptTokens": 12,
    "completionTokens": 3,
    "estimatedTokens": false,
    "durationMs": 1
  },
  "scenarios": [
    {
      "id": "one-en",
      "title": "one-en",
      "locale": "en",
      "passed": true,
      "steps": 1,
      "promptTokens": 10,
      "completionTokens": 2,
      "estimatedTokens": false,
      "durationMs": 1,
      "expectations": []
    }
  ]
}
`,
    );
  });
});
