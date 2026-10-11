/**
 * The eval harness: run a scenario through an injected `RunAgentTurn` with any
 * `ChatModel`, score it, and return the result the report is written from.
 *
 * **Everything is injected.** The loop, the model, the clock and the abort
 * signal arrive as arguments, so the scripted suite runs on a checked-in
 * transcript with no model file, and the real suite runs the same scenarios
 * through the real loop and a GGUF the user picked — one harness, two modes,
 * identical scoring.
 *
 * **Nothing is read from the file system while a turn runs.** The scenario
 * files and the safety notice are read once, up front, by {@link loadScenarios}
 * and {@link loadSafetyNotice}; a turn touches nothing but the scenario it was
 * handed and the fakes built from it.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type {
  AgentEvent,
  AssistantLocale,
  ChatMessage,
  ChatModel,
  ConfirmRequest,
  RunAgentTurn,
  ToolContext,
} from "@nexus/core";

import { checkExpectations, type ExpectationResult, type SafetyNotice, type TurnTrace } from "./expectations.js";
import { createFakeTools, createKnowledgeBase } from "./fakes.js";
import { parseScenarioFile, ScenarioError, type Scenario } from "./scenario.js";
import type { ScriptedModel } from "./scripted.js";

/** What one scenario scored. */
export interface ScenarioResult {
  readonly id: string;
  readonly title: string;
  readonly locale: AssistantLocale;
  readonly passed: boolean;
  /** Model completions the turn spent. */
  readonly steps: number;
  readonly tokens: {
    readonly prompt: number;
    readonly completion: number;
    /** True when the model approximated rather than reported its counts. */
    readonly estimated: boolean;
  };
  readonly durationMs: number;
  readonly finalText: string;
  readonly expectations: readonly ExpectationResult[];
  /** Set when the loop itself threw — the scenario fails, and the message says how. */
  readonly error?: string;
}

export interface SuiteTotals {
  readonly scenarios: number;
  readonly passed: number;
  readonly failed: number;
  readonly steps: number;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly estimatedTokens: boolean;
  readonly durationMs: number;
}

export interface SuiteResult {
  /** What was scored: a transcript's name, or the model file. */
  readonly model: string;
  readonly results: readonly ScenarioResult[];
  readonly totals: SuiteTotals;
}

export interface HarnessOptions {
  /** The loop under test: the real one in real mode, the reference one in scripted mode. */
  readonly runAgentTurn: RunAgentTurn;
  /** The model each scenario runs against. Scripted mode builds one per scenario; real mode returns the same one. */
  readonly modelFor: (scenario: Scenario) => ChatModel;
  /** The clock, injectable so a fixture can pin the reported durations. */
  readonly now?: () => number;
  /** One signal for every scenario, when the caller owns the life of the run. */
  readonly signal?: AbortSignal;
  /** A per-scenario deadline, in milliseconds. A turn that overruns is aborted rather than waited on. */
  readonly timeoutMs?: number;
  /** The profile a `ToolContext` reports. A scenario is not tied to a real profile. */
  readonly profileId?: string;
}

let noticeCache: SafetyNotice | null = null;

/** The fixed safety notice, read once from its fixture — the one place both languages are written. */
export function loadSafetyNotice(): SafetyNotice {
  if (noticeCache !== null) return noticeCache;
  const text = readFileSync(new URL("./fixtures/safety-notice.json", import.meta.url), "utf8");
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null) {
    throw new ScenarioError("fixtures/safety-notice.json must hold an object.");
  }
  const record = parsed as Record<string, unknown>;
  const sr = record["sr"];
  const en = record["en"];
  if (typeof sr !== "string" || typeof en !== "string") {
    throw new ScenarioError("fixtures/safety-notice.json must hold a string `sr` and a string `en`.");
  }
  noticeCache = { sr, en };
  return noticeCache;
}

/** Where the scenario files live, as an absolute path. */
export function defaultScenariosDirectory(): string {
  return fileURLToPath(new URL("./scenarios", import.meta.url));
}

/**
 * Every scenario under a directory, in file order and then file order again.
 *
 * Sorted by FILE NAME, not by id: a scenario id is an ASCII slug, and sorting
 * the two lists differently would put the report in an order nobody can
 * reproduce in a file browser. Two scenarios sharing an id is refused — the
 * report is keyed by id, so a duplicate would silently overwrite a row.
 */
export function loadScenarios(directory: string = defaultScenariosDirectory()): readonly Scenario[] {
  const names = readdirSync(directory)
    .filter((name) => name.endsWith(".json"))
    .sort();
  if (names.length === 0) {
    throw new ScenarioError(`${directory} holds no scenario files.`);
  }
  const scenarios: Scenario[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    const text = readFileSync(join(directory, name), "utf8");
    const parsed: unknown = JSON.parse(text);
    for (const scenario of parseScenarioFile(parsed, name)) {
      if (seen.has(scenario.id)) {
        throw new ScenarioError(`scenario id "${scenario.id}" is declared more than once (${name}).`);
      }
      seen.add(scenario.id);
      scenarios.push(scenario);
    }
  }
  return scenarios;
}

interface ModelCounter {
  steps: number;
  prompt: number;
  completion: number;
  estimated: boolean;
}

/** Counts what the model was asked for, so a scenario's step and token budgets are the model's, not a guess. */
function wrapModel(inner: ChatModel, counter: ModelCounter): ChatModel {
  return {
    info: inner.info,
    async complete(request, signal, onToken) {
      counter.steps += 1;
      const result = await inner.complete(request, signal, onToken);
      counter.prompt += result.promptTokens;
      counter.completion += result.completionTokens;
      if ((inner as Partial<ScriptedModel>).tokensEstimated === true) counter.estimated = true;
      return result;
    },
  };
}

/** Everything the checkers read, read off the loop's own events. */
function traceOf(
  events: readonly AgentEvent[],
  confirmations: TurnTrace["confirmations"],
  counter: ModelCounter,
): TurnTrace {
  const toolCalls: { name: string; arguments: unknown }[] = [];
  const citationIds: string[] = [];
  const seen = new Set<string>();
  const addCitations = (citations: readonly { readonly kind: string; readonly id: string }[] | undefined): void => {
    for (const citation of citations ?? []) {
      const key = `${citation.kind}:${citation.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      citationIds.push(citation.id);
    }
  };
  let streamed = "";
  let messageText: string | null = null;
  for (const event of events) {
    if (event.type === "token") streamed += event.text;
    else if (event.type === "tool-call") {
      toolCalls.push({ name: event.call.name, arguments: event.call.arguments });
    } else if (event.type === "tool-result") {
      addCitations(event.result.citations);
    } else if (event.type === "message") {
      addCitations(event.citations);
      if (event.message.content.length > 0) messageText = event.message.content;
    }
  }
  return {
    toolCalls,
    citationIds,
    finalText: streamed.length > 0 ? streamed : messageText ?? "",
    steps: counter.steps,
    confirmations,
  };
}

export interface Harness {
  runScenario(scenario: Scenario): Promise<ScenarioResult>;
  runSuite(scenarios: readonly Scenario[], model: string): Promise<SuiteResult>;
}

/**
 * Builds a harness around one loop and one model source.
 *
 * The confirmation the scenario declares is spent in the order the turn asks
 * for it, and an exhausted list refuses: a write that nobody answered must not
 * happen because the file ran out of answers.
 */
export function createHarness(options: HarnessOptions): Harness {
  const now = options.now ?? (() => Date.now());
  const profileId = options.profileId ?? "eval";
  const notice = loadSafetyNotice();

  /** The signal one scenario runs under: the caller's, a fresh deadline, or none at all. */
  function signalFor(): AbortSignal {
    if (options.signal !== undefined) return options.signal;
    if (options.timeoutMs !== undefined) return AbortSignal.timeout(options.timeoutMs);
    return new AbortController().signal;
  }

  async function runScenario(scenario: Scenario): Promise<ScenarioResult> {
    const start = now();
    const signal = signalFor();
    const tools = createFakeTools(scenario.tools, scenario.knowledge);
    const knowledge = createKnowledgeBase(scenario.knowledge);
    const pending = [...scenario.confirmations];
    const confirmations: { tool: string; approved: boolean }[] = [];
    const context: ToolContext = {
      profileId,
      locale: scenario.locale,
      signal,
      async confirm(request: ConfirmRequest): Promise<boolean> {
        const approved = pending.shift() === true;
        confirmations.push({ tool: request.tool, approved });
        return approved;
      },
    };

    const counter: ModelCounter = { steps: 0, prompt: 0, completion: 0, estimated: false };
    const model = wrapModel(options.modelFor(scenario), counter);
    const history: readonly ChatMessage[] = scenario.conversation.slice(0, -1);
    const user = scenario.conversation[scenario.conversation.length - 1];
    if (user === undefined) throw new ScenarioError(`${scenario.id} has no user turn.`);

    const events: AgentEvent[] = [];
    let error: string | undefined;
    try {
      await options.runAgentTurn(
        {
          history,
          user: { role: "user", content: user.content },
          locale: scenario.locale,
          tools,
          knowledge,
          model,
          context,
          maxSteps: scenario.maxSteps,
        },
        (event) => {
          events.push(event);
        },
      );
    } catch (thrown) {
      error = thrown instanceof Error ? thrown.message : String(thrown);
    }

    const trace = traceOf(events, confirmations, counter);
    const expectations = checkExpectations(scenario.expect, trace, notice, scenario.locale);
    return {
      id: scenario.id,
      title: scenario.title,
      locale: scenario.locale,
      passed: error === undefined && expectations.every((result) => result.passed),
      steps: counter.steps,
      tokens: { prompt: counter.prompt, completion: counter.completion, estimated: counter.estimated },
      durationMs: Math.max(0, Math.round(now() - start)),
      finalText: trace.finalText,
      expectations,
      ...(error === undefined ? {} : { error }),
    };
  }

  async function runSuite(scenarios: readonly Scenario[], model: string): Promise<SuiteResult> {
    const start = now();
    const results: ScenarioResult[] = [];
    for (const scenario of scenarios) {
      results.push(await runScenario(scenario));
    }
    return {
      model,
      results,
      totals: {
        scenarios: results.length,
        passed: results.filter((result) => result.passed).length,
        failed: results.filter((result) => !result.passed).length,
        steps: results.reduce((total, result) => total + result.steps, 0),
        promptTokens: results.reduce((total, result) => total + result.tokens.prompt, 0),
        completionTokens: results.reduce((total, result) => total + result.tokens.completion, 0),
        estimatedTokens: results.some((result) => result.tokens.estimated),
        durationMs: Math.max(0, Math.round(now() - start)),
      },
    };
  }

  return { runScenario, runSuite };
}
