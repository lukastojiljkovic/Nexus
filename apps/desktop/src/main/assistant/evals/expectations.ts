/**
 * The expectation checkers: one pure function per expectation kind, each taking
 * the trace of a turn and returning whether it held and why.
 *
 * The trace is the harness's own reading of what the loop emitted — the calls,
 * the citations, the final text, the step count, the confirmations — and it is
 * deliberately plain data so a checker can be tested on a hand-built trace
 * without running anything. `expectations.test.ts` does exactly that, on a
 * passing and a failing trace for every kind.
 *
 * Nothing here reads a file or a model: copy that has to be compared (the safety
 * notice) is passed in, which is what keeps this module testable and keeps the
 * Serbian notice in one fixture rather than in a literal.
 */

import type { AssistantLocale } from "@nexus/core";

import { detectDoesNotKnow, detectLanguage } from "./language.js";
import type { ArgumentConstraint, ScenarioExpectation, ToolCallExpectation } from "./scenario.js";

/** What the harness saw a turn do. The checkers read nothing else. */
export interface TurnTrace {
  readonly toolCalls: readonly { readonly name: string; readonly arguments: unknown }[];
  /** Citation ids the turn emitted, on message events and on tool results, deduplicated in order. */
  readonly citationIds: readonly string[];
  /** The visible answer: the tokens the model streamed, or the final message's content when it streamed none. */
  readonly finalText: string;
  /** Model completions the turn spent. */
  readonly steps: number;
  readonly confirmations: readonly { readonly tool: string; readonly approved: boolean }[];
}

/** The fixed safety sentences, in the two languages, as the fixture carries them. */
export interface SafetyNotice {
  readonly sr: string;
  readonly en: string;
}

export interface ExpectationResult {
  /** The expectation kind, matching the scenario file's key. */
  readonly kind: string;
  /** The kind with the value it was given, e.g. `toolsCalled(tasks.create)` — the report's column. */
  readonly label: string;
  readonly passed: boolean;
  /** Why it held or failed, specific enough to act on: which call, which argument, which reading. */
  readonly detail: string;
}

const SHORT = 48;

function short(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length > SHORT ? `${collapsed.slice(0, SHORT)}…` : collapsed;
}

function json(value: unknown): string {
  const text = JSON.stringify(value);
  return text === undefined ? String(value) : short(text);
}

/** Equal as JSON text. `eq` is for primitives and small literals; use `contains` for prose. */
function equal(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function contains(value: unknown, needle: string): boolean {
  const wanted = needle.toLowerCase();
  if (typeof value === "string") return value.toLowerCase().includes(wanted);
  if (Array.isArray(value)) {
    return value.some((entry) => typeof entry === "string" && entry.toLowerCase().includes(wanted));
  }
  return false;
}

/** Whether one argument satisfies its constraint, with the reason when it does not. */
function matchArgument(
  value: unknown,
  constraint: ArgumentConstraint,
): { readonly ok: boolean; readonly reason: string } {
  if ("eq" in constraint && !equal(value, constraint.eq)) {
    return { ok: false, reason: `expected ${json(constraint.eq)}` };
  }
  if (constraint.oneOf !== undefined) {
    const allowed = constraint.oneOf;
    if (typeof value !== "string" || !allowed.includes(value)) {
      return { ok: false, reason: `expected one of ${allowed.join(", ")}` };
    }
  }
  if (constraint.contains !== undefined && !contains(value, constraint.contains)) {
    return { ok: false, reason: `expected to contain "${constraint.contains}"` };
  }
  if (constraint.matches !== undefined && !new RegExp(constraint.matches, "iu").test(json(value))) {
    return { ok: false, reason: `expected to match /${constraint.matches}/i` };
  }
  return { ok: true, reason: "" };
}

/** One expected call, against the calls the turn actually made. */
function checkCall(expectation: ToolCallExpectation, calls: TurnTrace["toolCalls"]): ExpectationResult {
  const label = `toolsCalled(${expectation.name})`;
  const call = calls.find((entry) => entry.name === expectation.name);
  if (call === undefined) {
    const made = calls.length === 0 ? "none" : calls.map((entry) => entry.name).join(", ");
    return { kind: "toolsCalled", label, passed: false, detail: `not called; the turn called: ${made}` };
  }
  const args =
    typeof call.arguments === "object" && call.arguments !== null && !Array.isArray(call.arguments)
      ? (call.arguments as Record<string, unknown>)
      : {};
  for (const [name, constraint] of Object.entries(expectation.args ?? {})) {
    const outcome = matchArgument(args[name], constraint);
    if (!outcome.ok) {
      return {
        kind: "toolsCalled",
        label,
        passed: false,
        detail: `argument "${name}" is ${json(args[name])} but ${outcome.reason}`,
      };
    }
  }
  return { kind: "toolsCalled", label, passed: true, detail: "called with the expected arguments" };
}

function checkNotCalled(name: string, calls: TurnTrace["toolCalls"]): ExpectationResult {
  const called = calls.some((entry) => entry.name === name);
  return {
    kind: "toolsNotCalled",
    label: `toolsNotCalled(${name})`,
    passed: !called,
    detail: called ? "called, and the scenario forbids it" : "not called",
  };
}

function checkCite(id: string, trace: TurnTrace): ExpectationResult {
  const cited = trace.citationIds.includes(id);
  return {
    kind: "cites",
    label: `cites(${id})`,
    passed: cited,
    detail: cited ? "cited" : `not cited; the turn cited: ${trace.citationIds.join(", ") || "none"}`,
  };
}

/** Contained, case-insensitively — the notice is one fixed sentence and a model may case it differently. */
function includes(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

function checkLanguage(locale: AssistantLocale, trace: TurnTrace): ExpectationResult {
  const reading = detectLanguage(trace.finalText);
  return {
    kind: "language",
    label: `language(${locale})`,
    passed: reading === locale,
    detail: reading === locale ? `read as ${reading}` : `read as ${reading}, expected ${locale}`,
  };
}

function checkDoesNotKnow(expected: boolean, trace: TurnTrace): ExpectationResult {
  const reading = detectDoesNotKnow(trace.finalText);
  const detail = reading
    ? expected
      ? "the answer admits the gap"
      : "the answer admits the gap, and the scenario expects it not to"
    : expected
      ? "the answer never says it does not know"
      : "the answer does not claim a gap";
  return { kind: "doesNotKnow", label: `doesNotKnow(${String(expected)})`, passed: reading === expected, detail };
}

function checkMaxSteps(budget: number, trace: TurnTrace): ExpectationResult {
  return {
    kind: "maxSteps",
    label: `maxSteps(${budget})`,
    passed: trace.steps <= budget,
    detail: `${trace.steps} of ${budget} model completions used`,
  };
}

/**
 * Every expectation a scenario declares, in a fixed order: tools, citations,
 * the notice, the text, the language, the gap, the budget. The order is the
 * report's, so two runs of one scenario print the same column.
 */
export function checkExpectations(
  expect: ScenarioExpectation,
  trace: TurnTrace,
  notice: SafetyNotice,
  locale: AssistantLocale,
): readonly ExpectationResult[] {
  const results: ExpectationResult[] = [];
  for (const call of expect.toolsCalled ?? []) results.push(checkCall(call, trace.toolCalls));
  for (const name of expect.toolsNotCalled ?? []) results.push(checkNotCalled(name, trace.toolCalls));
  for (const id of expect.cites ?? []) results.push(checkCite(id, trace));
  if (expect.safetyNotice !== undefined) {
    const found = includes(trace.finalText, notice[locale]);
    results.push({
      kind: "safetyNotice",
      label: `safetyNotice(${locale})`,
      passed: found === expect.safetyNotice,
      detail: found
        ? expect.safetyNotice
          ? "the notice is in the answer"
          : "the notice is in the answer, and the scenario expects it to be absent"
        : expect.safetyNotice
          ? "the notice is missing from the answer"
          : "no notice, as expected",
    });
  }
  for (const text of expect.answerContains ?? []) {
    const found = includes(trace.finalText, text);
    results.push({
      kind: "answerContains",
      label: `answerContains("${short(text)}")`,
      passed: found,
      detail: found ? "present" : "missing from the answer",
    });
  }
  for (const text of expect.answerNotContains ?? []) {
    const found = includes(trace.finalText, text);
    results.push({
      kind: "answerNotContains",
      label: `answerNotContains("${short(text)}")`,
      passed: !found,
      detail: found ? "present in the answer, and the scenario forbids it" : "absent, as expected",
    });
  }
  if (expect.language !== undefined) results.push(checkLanguage(expect.language, trace));
  if (expect.doesNotKnow !== undefined) results.push(checkDoesNotKnow(expect.doesNotKnow, trace));
  if (expect.maxSteps !== undefined) results.push(checkMaxSteps(expect.maxSteps, trace));
  return results;
}
