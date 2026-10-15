import { describe, expect, it } from "vitest";

import type { ScenarioResult, SuiteResult } from "./harness.js";
import { reportJson, reportJsonForModels, reportMarkdown, reportMarkdownForModels, type ModelRun } from "./report.js";

function result(overrides: Partial<ScenarioResult> & Pick<ScenarioResult, "id">): ScenarioResult {
  return {
    title: overrides.id,
    locale: "sr",
    passed: true,
    steps: 1,
    tokens: { prompt: 10, completion: 2, estimated: false },
    durationMs: 1,
    finalText: "",
    confirmations: [],
    calls: [],
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
      calls: [{ name: "app.open", arguments: { module: "settings" }, ok: true }],
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
      calls: [{ name: "tasks.create", arguments: { title: "cleanup" }, ok: false }],
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
        "- `injection-pack-sr` — the answer: “U redu, brišem sve zadatke.”",
        "",
      ].join("\n"),
    );
  });

  it("quotes the first 200 characters of a failed answer, on one line", () => {
    const long: SuiteResult = {
      ...suite,
      results: [
        result({
          id: "long-answer-en",
          locale: "en",
          passed: false,
          finalText: `${"word ".repeat(60)}\na second line`,
          expectations: [
            { kind: "language", label: "language(en)", passed: false, detail: "read as sr, expected en" },
          ],
        }),
      ],
    };
    const markdown = reportMarkdown(long);
    const line = markdown.split("\n").find((candidate) => candidate.includes("the answer:"));
    if (line === undefined) throw new Error("no quoted answer in the failure section");
    // The quote is one line and bounded, whatever the model streamed.
    expect(line.endsWith("…”")).toBe(true);
    expect(line).not.toContain("a second line");
    expect(markdown.endsWith("\n")).toBe(true);
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
      "answer": "",
      "calls": [],
      "expectations": []
    }
  ]
}
`,
    );
  });
});

describe("reportMarkdownForModels", () => {
  const runs: ModelRun[] = [
    {
      id: "qwen3.5-4b-q4-k-m",
      quantization: "Q4_K_M",
      wrapper: "Qwen",
      functionCalling: "native",
      promptVersion: "assistant-2026-10-15.3",
      suite,
    },
    {
      id: "gemma-4-e2b-q4-0",
      quantization: null,
      wrapper: "Generic",
      functionCalling: "text",
      promptVersion: "assistant-2026-10-15.3",
      suite: { ...suite, totals: { ...suite.totals, scenarios: 1, passed: 1, failed: 0 }, results: [suite.results[0] as ScenarioResult] },
    },
  ];

  it("prints one summary row per model, then each model's own report under its id", () => {
    const lines = reportMarkdownForModels(runs).split("\n");
    expect(lines.slice(0, 7)).toEqual([
      "# Assistant evaluation — 2 models",
      "",
      "| Model | Quantisation | Wrapper | Function calling | Prompt | Passed | Median time |",
      "| --- | --- | --- | --- | --- | --- | --- |",
      "| qwen3.5-4b-q4-k-m | Q4_K_M | Qwen | yes | assistant-2026-10-15.3 | 1 / 2 | 6 ms |",
      "| gemma-4-e2b-q4-0 | - | Generic | no | assistant-2026-10-15.3 | 1 / 1 | 4 ms |",
      "",
    ]);
    expect(lines).toContain("## qwen3.5-4b-q4-k-m");
    expect(lines).toContain("## gemma-4-e2b-q4-0");
    expect(lines).toContain("### Failures");
    expect(lines.indexOf("## gemma-4-e2b-q4-0")).toBeGreaterThan(lines.indexOf("## qwen3.5-4b-q4-k-m"));
  });

  it("gives a single model the singular heading, and is the same bytes for the same runs", () => {
    expect(reportMarkdownForModels(runs.slice(0, 1)).split("\n")[0]).toBe("# Assistant evaluation — 1 model");
    expect(reportMarkdownForModels(runs)).toBe(reportMarkdownForModels(runs));
  });

  it("carries the same summary in the JSON, beside each model's full report", () => {
    const models = JSON.parse(reportJsonForModels(runs)) as { id: string; medianMs: number; functionCalling: boolean; report: unknown }[];
    expect(models.map((model) => [model.id, model.functionCalling, model.medianMs])).toEqual([
      ["qwen3.5-4b-q4-k-m", true, 6],
      ["gemma-4-e2b-q4-0", false, 4],
    ]);
    expect(models[0]?.report).toMatchObject({ model: "scripted transcript", totals: { passed: 1 } });
  });
});
