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

import { claimsCompletion, detectDoesNotKnow, detectLanguage, detectScript } from "./language.js";
import type { ReplyScript } from "./language.js";
import type {
  ArgumentConstraint,
  ExpectedLocation,
  ScenarioExpectation,
  ToolCallExpectation,
} from "./scenario.js";

/** What the harness saw a turn do. The checkers read nothing else. */
export interface TurnTrace {
  /**
   * The tool names the turn was OFFERED, one list per model request, in order.
   * A turn that never saw the right tool cannot call it, and a scenario that
   * only says `toolsCalled` cannot tell that failure from a model that was
   * offered the tool and chose not to use it.
   */
  readonly toolsOffered: readonly (readonly string[])[];
  /**
   * Every call the loop emitted, in order, with what its result said. `false`
   * is a refusal, a failure, or a call whose result never arrived (an aborted
   * turn); in all three the call did not do anything, which is the only thing
   * the checkers below read it for.
   */
  readonly toolCalls: readonly {
    readonly name: string;
    readonly arguments: unknown;
    readonly ok: boolean;
  }[];
  /**
   * Where the turn's tool results said to go, in order — the `navigateTo` of
   * each result, which is what the page acts on. A result that carries none
   * contributes nothing.
   */
  readonly navigations: readonly ExpectedLocation[];
  /** Citation ids the turn emitted, on message events and on tool results, deduplicated in order. */
  readonly citationIds: readonly string[];
  /** Whether the answer's own citations include a safety pack's: what makes the page draw the safety notice under it. */
  readonly safety: boolean;
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
/** The first constraint a call's arguments break, as the report words it; `undefined` when none is broken. */
function argumentRefusal(
  callArguments: unknown,
  constraints: Readonly<Record<string, ArgumentConstraint>>,
): string | undefined {
  const args =
    typeof callArguments === "object" && callArguments !== null && !Array.isArray(callArguments)
      ? (callArguments as Record<string, unknown>)
      : {};
  for (const [name, constraint] of Object.entries(constraints)) {
    const outcome = matchArgument(args[name], constraint);
    if (!outcome.ok) return `argument "${name}" is ${json(args[name])} but ${outcome.reason}`;
  }
  return undefined;
}

/**
 * A turn may call one tool more than once (two tasks in one message), and the
 * expectation is met by any one of those calls: an expectation per task then
 * reads two different calls, not the first one twice.
 */
function checkCall(expectation: ToolCallExpectation, calls: TurnTrace["toolCalls"]): ExpectationResult {
  const label = `toolsCalled(${expectation.name})`;
  const named = calls.filter((entry) => entry.name === expectation.name);
  if (named.length === 0) {
    const made = calls.length === 0 ? "none" : calls.map((entry) => entry.name).join(", ");
    return { kind: "toolsCalled", label, passed: false, detail: `not called; the turn called: ${made}` };
  }
  let refusal: string | undefined;
  for (const call of named) {
    const broken = argumentRefusal(call.arguments, expectation.args ?? {});
    if (broken === undefined) {
      return { kind: "toolsCalled", label, passed: true, detail: "called with the expected arguments" };
    }
    refusal ??= broken;
  }
  return { kind: "toolsCalled", label, passed: false, detail: refusal ?? "" };
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

/**
 * Whether `actual` holds everything `expected` says, and nothing it contradicts:
 * every key the expectation writes is compared, and a key it does not write is
 * free. That is the shape every other expectation here already has (a constraint
 * on an argument the call never sent fails; an argument the expectation does not
 * mention is not looked at), and it is what lets a destination say `{ module:
 * "tasks" }` without having to restate the item and the settings card.
 */
function holds(actual: unknown, expected: unknown): boolean {
  if (typeof expected !== "object" || expected === null) return equal(actual, expected);
  if (Array.isArray(expected)) {
    return Array.isArray(actual) && expected.every((entry, index) => holds(actual[index], entry));
  }
  if (typeof actual !== "object" || actual === null || Array.isArray(actual)) return false;
  return Object.entries(expected).every(([key, value]) =>
    holds((actual as Record<string, unknown>)[key], value),
  );
}

/**
 * Where the turn moved the page. The pages a turn navigated to are a LIST, and
 * each expectation is satisfied by one of them — a turn that opened two pages
 * satisfies one expectation per page, and a scenario that cares about the order
 * writes one expectation per destination.
 */
function checkNavigatesTo(expected: ExpectedLocation, navigations: TurnTrace["navigations"]): ExpectationResult {
  const label = `navigatesTo(${labelOf(expected)})`;
  const passed = navigations.some((location) => holds(location, expected));
  const seen = navigations.length === 0 ? "nowhere" : navigations.map(labelOf).join(", ");
  return {
    kind: "navigatesTo",
    label,
    passed,
    detail: passed ? "the turn navigated there" : `the turn navigated: ${seen}`,
  };
}

/** A destination as one report column: the module, plus the item or card when the scenario names one. */
function labelOf(location: ExpectedLocation): string {
  return [location.module, location.item, location.settings].filter((part) => part !== undefined).join("/");
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

function checkScript(script: ReplyScript, trace: TurnTrace): ExpectationResult {
  const reading = detectScript(trace.finalText);
  return {
    kind: "script",
    label: `script(${script})`,
    passed: reading === script,
    detail: reading === script ? `read as ${reading}` : `read as ${reading}, expected ${script}`,
  };
}

/**
 * The claim check: when a tool was called and no call of that tool ever
 * succeeded, the answer must not say the thing was done.
 *
 * **Why the tool names and not the words.** The list behind
 * {@link claimsCompletion} is per language and cannot say WHICH tool a sentence
 * is about, so a turn that both failed one write and made another is not
 * checked at all: its answer legitimately claims the write that did run. The
 * README names that limit beside the others.
 */
function checkClaimsOnlyWhatRan(trace: TurnTrace): ExpectationResult {
  const succeeded = new Set(trace.toolCalls.filter((call) => call.ok).map((call) => call.name));
  const unfinished = [
    ...new Set(trace.toolCalls.filter((call) => !call.ok).map((call) => call.name)),
  ].filter((name) => !succeeded.has(name));
  const claimed = claimsCompletion(trace.finalText);
  const passed = unfinished.length === 0 || !claimed;
  return {
    kind: "claimsOnlyWhatRan",
    label: "claimsOnlyWhatRan",
    passed,
    detail:
      unfinished.length === 0
        ? "nothing was refused or failed"
        : claimed
          ? `the answer claims a write that did not run: ${unfinished.join(", ")}`
          : `nothing claimed beyond what ran: ${unfinished.join(", ")}`,
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
 * Every expectation a scenario declares, in a fixed order: the tools it calls
 * and the ones it may not, where it navigates, citations, the notice, the text,
 * the claim, the language and the script, the gap, the budget. The order is the
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
  for (const location of expect.navigatesTo ?? []) results.push(checkNavigatesTo(location, trace.navigations));
  for (const id of expect.cites ?? []) results.push(checkCite(id, trace));
  if (expect.safetyNotice !== undefined) {
    // The user sees the notice when the page draws it under the answer, and
    // also when the model wrote it into the text itself.
    const found = trace.safety || includes(trace.finalText, notice[locale]);
    results.push({
      kind: "safetyNotice",
      label: `safetyNotice(${locale})`,
      passed: found === expect.safetyNotice,
      detail: found
        ? expect.safetyNotice
          ? trace.safety
            ? "the page draws the notice under the answer"
            : "the notice is in the answer"
          : "the notice is shown, and the scenario expects it to be absent"
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
  if (expect.claimsOnlyWhatRan === true) results.push(checkClaimsOnlyWhatRan(trace));
  if (expect.language !== undefined) results.push(checkLanguage(expect.language, trace));
  if (expect.script !== undefined) results.push(checkScript(expect.script, trace));
  if (expect.doesNotKnow !== undefined) results.push(checkDoesNotKnow(expect.doesNotKnow, trace));
  if (expect.maxSteps !== undefined) results.push(checkMaxSteps(expect.maxSteps, trace));
  return results;
}
