/**
 * The report: a suite result as JSON, and as the Markdown table a maintainer
 * reads.
 *
 * Both halves are pure functions of a {@link SuiteResult} — no clock, no file,
 * no locale — so `report.test.ts` pins the exact bytes of each on a fixture. That
 * exactness is the point: these are the numbers the catalogue, the prompts and
 * every later change are judged by, and a report whose shape drifts quietly
 * makes two runs incomparable without anybody noticing.
 *
 * Numbers are printed as plain digits in both halves, with no thousands
 * separator: a report is diffed and grepped, and a locale-dependent space would
 * make the same run produce two different files.
 */

import type { ScenarioResult, SuiteResult, SuiteTotals } from "./harness.js";

export interface ReportScenario {
  readonly id: string;
  readonly title: string;
  readonly locale: string;
  readonly passed: boolean;
  readonly steps: number;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly estimatedTokens: boolean;
  readonly durationMs: number;
  /** The answer the turn finished with, verbatim — what a failure has to be read against. */
  readonly answer: string;
  /** Every tool call the turn emitted, in order, with the arguments it sent and whether it ran. */
  readonly calls: readonly {
    readonly name: string;
    readonly arguments: unknown;
    readonly ok: boolean;
  }[];
  readonly expectations: readonly {
    readonly kind: string;
    readonly passed: boolean;
    readonly detail: string;
  }[];
  readonly error?: string;
}

export interface Report {
  readonly model: string;
  readonly totals: SuiteTotals;
  readonly scenarios: readonly ReportScenario[];
}

function scenarioReport(result: ScenarioResult): ReportScenario {
  return {
    id: result.id,
    title: result.title,
    locale: result.locale,
    passed: result.passed,
    steps: result.steps,
    promptTokens: result.tokens.prompt,
    completionTokens: result.tokens.completion,
    estimatedTokens: result.tokens.estimated,
    durationMs: result.durationMs,
    answer: result.finalText,
    calls: result.calls.map((call) => ({
      name: call.name,
      arguments: call.arguments,
      ok: call.ok,
    })),
    expectations: result.expectations.map((expectation) => ({
      kind: expectation.label,
      passed: expectation.passed,
      detail: expectation.detail,
    })),
    ...(result.error === undefined ? {} : { error: result.error }),
  };
}

/** The suite as the data a JSON report holds, keyed by scenario id. */
export function toReport(suite: SuiteResult): Report {
  return {
    model: suite.model,
    totals: suite.totals,
    scenarios: suite.results.map(scenarioReport),
  };
}

/** The JSON report, indented two spaces, newline-terminated. */
export function reportJson(suite: SuiteResult): string {
  return `${JSON.stringify(toReport(suite), null, 2)}\n`;
}

/** The token total as the header prints it, with `(estimated)` when no number was measured. */
function tokens(totals: SuiteTotals): string {
  const count = totals.promptTokens + totals.completionTokens;
  return totals.estimatedTokens ? `${count} (estimated)` : `${count}`;
}

/** How much of a failed scenario's answer the Markdown failure section quotes: a line, not a transcript. */
const QUOTED_ANSWER_CHARS = 200;

/** The first {@link QUOTED_ANSWER_CHARS} characters of an answer, on one line. */
function quote(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  const bounded =
    collapsed.length > QUOTED_ANSWER_CHARS
      ? `${collapsed.slice(0, QUOTED_ANSWER_CHARS)}…`
      : collapsed;
  return `“${bounded}”`;
}

/**
 * The Markdown table: one row per scenario, one cell per expectation. A
 * scenario's expectation cell lists every expectation as `label=ok` or
 * `label=FAIL`, in the order the checkers ran, so a failing row says which
 * expectation failed without leaving the table.
 *
 * The failure section quotes the answer, because a failed scenario's row says
 * WHAT failed and never WHAT was said — and the answer is the thing the model
 * actually did. Whitespace is collapsed and the quote is bounded, so the section
 * stays a list of lines whatever the model streamed.
 */
export function reportMarkdown(suite: SuiteResult): string {
  const lines: string[] = [];
  lines.push(`# Assistant evaluation — ${suite.model}`);
  lines.push("");
  lines.push(
    `${suite.totals.passed} of ${suite.totals.scenarios} scenarios passed, ` +
      `${suite.totals.failed} failed. ${suite.totals.steps} model steps, ` +
      `${tokens(suite.totals)} tokens, ${suite.totals.durationMs} ms.`,
  );
  lines.push("");
  lines.push("| Scenario | Locale | Result | Expectations | Steps | Tokens | Time |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- |");
  for (const scenario of suite.results) {
    const expectations =
      scenario.expectations.length === 0
        ? "(none)"
        : scenario.expectations
            .map((expectation) => `${expectation.label}=${expectation.passed ? "ok" : "FAIL"}`)
            .join(", ");
    lines.push(
      `| ${scenario.id} | ${scenario.locale} | ${scenario.passed ? "pass" : "fail"} | ${expectations} | ` +
        `${scenario.steps} | ${scenario.tokens.prompt + scenario.tokens.completion} | ${scenario.durationMs} ms |`,
    );
  }

  const failures = suite.results.filter((scenario) => !scenario.passed);
  if (failures.length > 0) {
    lines.push("");
    lines.push("## Failures");
    lines.push("");
    for (const scenario of failures) {
      if (scenario.error !== undefined) {
        lines.push(`- \`${scenario.id}\` — the turn threw: ${scenario.error}`);
      }
      for (const expectation of scenario.expectations) {
        if (!expectation.passed) {
          lines.push(`- \`${scenario.id}\` — \`${expectation.label}\`: ${expectation.detail}`);
        }
      }
      lines.push(`- \`${scenario.id}\` — the answer: ${quote(scenario.finalText)}`);
    }
  }
  return `${lines.join("\n")}\n`;
}
