/**
 * The agent loop: one turn of the assistant, from the user's message to the
 * events a page draws.
 *
 * The shape is fixed by `RunAgentTurn` in `contract.ts` - assemble, retrieve,
 * complete, run what the model asked for, feed the results back, repeat - and
 * this file is the whole of it, in the order the brief fixes:
 *
 *   1. the system prompt, the history and the user message (`prompts.ts`);
 *   2. knowledge, retrieved ONCE before the first completion and injected as a
 *      fenced block, so every step of the turn reads the same passages;
 *   3. the model, streamed out as `token` events;
 *   4. the model's tool calls, each one normalised for the loose values a small
 *      model writes (`arguments.ts`) and then checked against its own JSON
 *      schema before anything runs (`schema.ts`), then run together;
 *   5. the results, fenced as data, back to the model; repeat until it answers,
 *      or until `maxSteps`.
 *
 * **A turn offers only the tools the window can hold.** Thirty-seven specs
 * beside a conversation do not fit a local model's 8192 tokens, so the loop
 * picks the subset the request can carry (`toolChoice.ts`) BEFORE it builds the
 * prompt: the prompt names the offered tools, every request offers exactly
 * them, and a call to anything else is answered as a name this turn does not
 * have.
 *
 * **Nothing the model writes can end the turn badly.** An unknown tool name and
 * a call whose arguments fail its schema both come back as a tool error MESSAGE
 * the model can read and correct - a `tool-result` with `ok: false`, no `error`
 * event, and nothing thrown. A tool that THREW is answered the same way and
 * also emits `error` with `tool-failed`, because that one is the app's fault
 * and the user should see it. The turn ends early only for `context-full`
 * (`budget.ts` refuses a request that cannot fit), `model-failed`, `step-limit`,
 * or the user's own abort.
 *
 * **A refusal names what the schema wanted, and a second one ends the trying.**
 * The message a refused call comes back as carries the finding and the fields
 * with what each expects, built from the schema, and NOT the call the model
 * just made: a small model copies a failed call that sits in its context back
 * verbatim. The same tool refused twice in one turn is answered with the same
 * sentence - do not call it again, tell the user - and a third attempt is not
 * read at all, because a model that has written the same bad call twice will
 * write it a third time, and the turn has `maxSteps` steps to answer in.
 *
 * **A tool call is never lost to the step limit.** The limit counts MODEL calls;
 * a final call that still asks for tools has those tools run and its results
 * emitted, and then the turn stops with `step-limit`. Discarding a call the
 * model already made would drop a write the user had confirmed, and the page
 * would draw a request with no answer.
 *
 * **Stop reasons are the model's, with two exceptions.** `length` and `end` pass
 * through as reported; a turn cut short by the step limit or by a request that
 * cannot fit reports `length`, because those are the two cases where the answer
 * is short of what the conversation had left to say, and the `error` event
 * beside it says which. An abort emits `error` with `aborted` and then `done`
 * with `aborted`, so a page can tell a stop it asked for from a model that
 * finished.
 */

import {
  answerReserveTokens,
  createEstimator,
  createToolEstimator,
  planContext,
} from "./budget.js";
import { DAY_PATTERN, normalizeToolArguments } from "./arguments.js";
import { createFenceBoundary, fenceUntrusted, isFenced } from "./fence.js";
import { buildSystemPrompt } from "./prompts.js";
import { validateToolArguments } from "./schema.js";
import { parseToolCalls } from "./toolCalls.js";
import {
  TOOL_BUDGET_SHARE,
  chooseTools,
  toolSpecCharacters,
  toolSpecTokens,
} from "./toolChoice.js";
import type { MeasuredUsage } from "./budget.js";
import type {
  AgentEvent,
  ChatMessage,
  Citation,
  CompletionResult,
  JsonSchema,
  KnowledgeHit,
  RunAgentTurn,
  StopReason,
  Tool,
  ToolCall,
  ToolContext,
  ToolResult,
  ToolSpec,
} from "./contract.js";

/**
 * The model calls one turn may make before it stops with `step-limit`.
 *
 * Eight covers the recipes the assistant ships with (a search, one or two
 * reads, one write, and the answer) with room for a correction; a turn that
 * wants more than eight is a loop, and a loop on a local model is a fan
 * spinning for minutes.
 */
export const DEFAULT_MAX_STEPS = 8;

/**
 * How many knowledge passages one turn may inject. Six fits in the window
 * beside a conversation on a small model and is more than an answer can use;
 * the knowledge service ranks them, so the seventh is the least useful one.
 */
export const KNOWLEDGE_HIT_LIMIT = 6;

export interface AgentLoopOptions {
  /**
   * A fresh fence boundary for each turn. Injectable so a test can pin it and
   * assert the assembled request character for character.
   */
  readonly newFenceBoundary?: () => string;
  /** Ids for calls recovered from text, which arrive without one. */
  readonly newCallId?: () => string;
}

/** The loop, with its test seams named. `runAgentTurn` is the production instance. */
export function createAgentTurn(options: AgentLoopOptions = {}): RunAgentTurn {
  return async (input, emit) => {
    const signal = input.context.signal;
    const finish = (stopReason: StopReason): void => {
      emit({ type: "done", stopReason });
    };
    const stopped = (): void => {
      emit({ type: "error", code: "aborted" });
      finish("aborted");
    };

    if (signal.aborted) {
      stopped();
      return;
    }
    if (!input.model.info.capabilities.includes("chat")) {
      emit({ type: "error", code: "no-model" });
      finish("end");
      return;
    }

    const boundary = options.newFenceBoundary?.() ?? createFenceBoundary();
    let sequence = 0;
    const nextCallId = options.newCallId ?? ((): string => `call_${(sequence += 1)}`);

    const citations = new CitationList();
    let hits: readonly KnowledgeHit[] = [];
    try {
      const found = await input.knowledge.search(
        { text: input.user.content, limit: KNOWLEDGE_HIT_LIMIT, locale: input.locale },
        signal,
      );
      hits = found.slice(0, KNOWLEDGE_HIT_LIMIT);
    } catch {
      if (signal.aborted) {
        stopped();
        return;
      }
      // Knowledge is an aid, not the turn: a search that fails leaves the model
      // answering from the conversation alone, which is honest and visible
      // (the request simply carries no knowledge block).
    }

    const specs: readonly ToolSpec[] = input.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      effect: tool.effect,
    }));
    const reserve = answerReserveTokens(input.model.info.contextTokens);
    const ceiling = Math.max(0, input.model.info.contextTokens - reserve);
    // Only the tools that fit the window are offered, and only those reach the
    // prompt, the request and the tool runner: a call to anything else is a
    // name the turn does not have, which is the same answer an unknown name
    // has always been given. The runner is filtered rather than rebuilt so the
    // registry's own objects (and their order) are what a call is dispatched to.
    const offered = chooseTools({
      tools: specs,
      query: input.user.content,
      earlier: earlierUserMessages(input.history),
      recent: recentToolNames(input.history),
      budgetTokens: Math.floor(ceiling * TOOL_BUDGET_SHARE),
    });
    const offeredNames = new Set(offered.map((spec) => spec.name));
    const offeredTools = input.tools.filter((tool) => offeredNames.has(tool.name));
    // What the offered specs add to EVERY request of this turn: the template
    // renders one function per tool beside the messages, so the plan has to know
    // their cost before it can say whether a request fits.
    const fixedTokens = offered.reduce((sum, spec) => sum + toolSpecTokens(spec), 0);
    const offeredCharacters = offered.reduce((sum, spec) => sum + toolSpecCharacters(spec), 0);
    const system = buildSystemPrompt({
      locale: input.locale,
      tools: offered,
      maxSteps: input.maxSteps,
      today: input.today,
    });
    // The loop owns the system prompt, so a system message that arrived in the
    // history would be a second, invisible instruction set beside it.
    // A tool result in that history is data like any other, and is fenced here
    // because the page replays what it drew (a `tool-result` event carries the
    // raw text) rather than what the model read.
    const history = input.history
      .filter((message) => message.role !== "system")
      .map((message) =>
        message.role === "tool" && !isFenced(message.content)
          ? {
              ...message,
              content: fenceUntrusted(message.content, {
                label: "TOOL RESULT (history)",
                source: message.toolCallId ?? "",
                boundary,
              }),
            }
          : message,
      );
    const pending: ChatMessage[] = [input.user];
    let measured: MeasuredUsage | undefined;
    let counted = false;
    /**
     * How many times this turn a tool's arguments have been refused, by tool
     * name. The loop's own small memory, kept as its own object so a second one
     * (another reason a call must not be repeated) can sit beside it rather
     * than inside it.
     */
    const invalidCalls = new Map<string, number>();

    for (let step = 0; step < input.maxSteps; step += 1) {
      if (signal.aborted) {
        stopped();
        return;
      }
      const plan = planContext({
        system,
        knowledge: hits,
        history,
        pending,
        ceiling,
        fixedTokens,
        boundary,
        estimate: createEstimator(input.locale, measured),
        estimateTool: createToolEstimator(input.locale, measured),
      });
      if (!plan.ok) {
        emit({ type: "error", code: "context-full" });
        finish("length");
        return;
      }
      if (!counted) {
        // Only the hits that survived the FIRST fit are sources of this answer:
        // a passage the model never read cannot be what it cites.
        for (const hit of plan.knowledge) citations.add(hit.citation);
        counted = true;
      }

      let result: CompletionResult;
      try {
        result = await input.model.complete(
          { messages: plan.messages, tools: offered, maxTokens: reserve },
          signal,
          (text) => {
            emit({ type: "token", text });
          },
        );
      } catch (error) {
        if (signal.aborted) {
          stopped();
          return;
        }
        emit({ type: "error", code: "model-failed", detail: errorMessage(error) });
        finish("end");
        return;
      }
      if (signal.aborted || result.stopReason === "aborted") {
        stopped();
        return;
      }
      measured = {
        promptTokens: result.promptTokens,
        // The model counted the tools too: every request carries the offered
        // tools' specs beside its messages, and the ratio this measurement
        // becomes has to be over everything the count was made of, or the next
        // request's estimate would be short by the tools' own share.
        characters: requestCharacters(plan.messages) + offeredCharacters,
      };

      // Some GGUF templates emit a tool call as text. The fallback only speaks
      // when the runtime reported no calls and at least one tool was offered.
      const recovered =
        result.toolCalls.length === 0 && offered.length > 0 ? parseToolCalls(result.text) : null;
      const calls: readonly ToolCall[] =
        recovered !== null && recovered.calls.length > 0
          ? recovered.calls.map((call) => ({
              id: nextCallId(),
              name: call.name,
              arguments: call.arguments,
            }))
          : result.toolCalls;
      const text =
        recovered !== null && recovered.calls.length > 0 ? recovered.text : result.text;

      if (text.trim().length > 0) {
        emit({
          type: "message",
          message:
            calls.length > 0
              ? { role: "assistant", content: text, toolCalls: calls }
              : { role: "assistant", content: text },
          citations: citations.all(),
        });
      }
      if (calls.length === 0) {
        finish(result.stopReason === "length" ? "length" : "end");
        return;
      }

      pending.push({ role: "assistant", content: text, toolCalls: calls });
      for (const call of calls) emit({ type: "tool-call", call });
      const outcome = await runToolCalls(
        calls,
        offeredTools,
        input.context,
        emit,
        input.today,
        invalidCalls,
      );
      if (outcome.aborted) {
        stopped();
        return;
      }
      for (const entry of outcome.entries) {
        emit({ type: "tool-result", callId: entry.call.id, result: entry.result });
        for (const citation of entry.result.citations ?? []) citations.add(citation);
        // What the PAGE draws is the result itself; what the MODEL reads is the
        // same text fenced and labelled as data (`fence.ts`).
        pending.push({
          role: "tool",
          content: fenceUntrusted(entry.result.content, {
            label: `TOOL RESULT ${entry.call.name}`,
            source: entry.call.id,
            boundary,
          }),
          toolCallId: entry.call.id,
        });
      }
      if (step === input.maxSteps - 1) {
        emit({ type: "error", code: "step-limit" });
        finish("length");
        return;
      }
    }

    // `maxSteps <= 0`: no model call was allowed at all.
    emit({ type: "error", code: "step-limit" });
    finish("length");
  };
}

/** The production loop. */
export const runAgentTurn: RunAgentTurn = createAgentTurn();

interface ToolEntry {
  readonly call: ToolCall;
  readonly result: ToolResult;
}

/** A call whose tool threw, as opposed to one refused before it ran. */
interface ToolThrew extends ToolEntry {
  readonly threw: true;
}

type ToolOutcome =
  | { readonly aborted: true }
  | { readonly aborted: false; readonly entries: readonly ToolEntry[] };

/**
 * Run every call of one model step, in parallel, and answer in the model's own
 * order.
 *
 * Parallel because two reads have no reason to queue; ordered because a page
 * (and a test) should not see the results of a step reshuffled by whichever
 * tool was faster. A refusal is not here at all: `ToolContext.confirm` is the
 * tool's own question, and the tool decides what a „no" means.
 *
 * `today` is the turn's own day, which a day word in the arguments is resolved
 * against before validation; `invalidCalls` is what the turn remembers about tools
 * whose arguments were already refused, so the third attempt can be answered
 * without being read (`createAgentTurn` owns that map).
 */
async function runToolCalls(
  calls: readonly ToolCall[],
  tools: readonly Tool[],
  context: ToolContext,
  emit: (event: AgentEvent) => void,
  today: string,
  invalidCalls: Map<string, number>,
): Promise<ToolOutcome> {
  const names = tools.map((tool) => tool.name);
  const settled = await Promise.all(
    calls.map(async (call): Promise<{ aborted: boolean; entry: ToolEntry | ToolThrew }> => {
      const tool = tools.find((candidate) => candidate.name === call.name);
      if (tool === undefined) {
        return {
          aborted: false,
          entry: {
            call,
            result: failure(
              `Unknown tool "${call.name}". The tools this turn may use are: ${names.length > 0 ? names.join(", ") : "(none)"}. Call one of those, or answer without a tool.`,
            ),
          },
        };
      }
      const refused = invalidCalls.get(call.name) ?? 0;
      if (refused >= 2) {
        // Not validated and not run: the model has written this same bad call
        // twice already, and the answer it gets is the one that tells it to
        // stop, in the same words as the second refusal.
        return { aborted: false, entry: { call, result: failure(refusedTwice(call.name)) } };
      }
      const check = validateToolArguments(
        tool.parameters,
        normalizeToolArguments(tool.parameters, call.arguments, today),
      );
      if (!check.ok) {
        invalidCalls.set(call.name, refused + 1);
        return {
          aborted: false,
          entry: {
            call,
            result: failure(
              refused + 1 >= 2
                ? refusedTwice(call.name)
                : refusal(call.name, tool.parameters, check.errors),
            ),
          },
        };
      }
      try {
        const result = await tool.run(check.value, context);
        if (context.signal.aborted) {
          return { aborted: true, entry: { call, result } };
        }
        return { aborted: false, entry: { call, result } };
      } catch (error) {
        if (context.signal.aborted) {
          return { aborted: true, entry: { call, result: failure(`The tool ${call.name} was stopped.`) } };
        }
        return {
          aborted: false,
          entry: {
            call,
            threw: true,
            result: failure(
              `The tool ${call.name} failed: ${errorMessage(error)}. Do not repeat the call unchanged.`,
            ),
          },
        };
      }
    }),
  );
  if (settled.some((outcome) => outcome.aborted)) return { aborted: true };
  const entries = settled.map((outcome) => outcome.entry);
  for (const entry of entries) {
    // Only a tool that THREW is an error the page should show. A name the
    // registry does not have and arguments the schema refused are the model's
    // own corrections, and the brief's answer to both is a tool message.
    if ("threw" in entry) emit({ type: "error", code: "tool-failed" });
  }
  return { aborted: false, entries };
}

function failure(content: string): ToolResult {
  return { ok: false, content };
}

/**
 * What one refused call tells the model: the finding, what the tool's schema
 * wants of each field, and the two ways out.
 *
 * The failed arguments are deliberately NOT repeated. A small model copies a
 * call that sits in its context back verbatim - the 2.0.3 run this repairs is
 * the proof - so the one thing this message must not carry is a second copy of
 * the call it is answering. The finding (`schema.ts`'s own sentence) names the
 * field and the shape it wanted; the rest is read off the schema rather than
 * written out by hand, because a hand-kept list is wrong the first time a tool
 * changes its arguments.
 */
function refusal(name: string, schema: JsonSchema, errors: readonly string[]): string {
  return `Invalid arguments for ${name}: ${errors.join("; ")}. ${expectations(schema)} Call it again with the corrected arguments, or tell the user what is missing.`;
}

/**
 * The same tool refused twice in one turn. The model is told the call will not
 * run and asked to answer instead, which is the only useful thing left to say:
 * a second identical refusal has already been read and not acted on.
 */
function refusedTwice(name: string): string {
  return `${name} failed twice this turn. Do not call it again: tell the user it was not done and why.`;
}

/** What a tool's schema expects of its arguments, one clause per field. */
function expectations(schema: JsonSchema): string {
  const properties = isPlainObject(schema["properties"]) ? schema["properties"] : {};
  const required = stringList(schema["required"]);
  const fields = Object.entries(properties).map(([name, property]) =>
    expectation(name, isPlainObject(property) ? property : {}, required.includes(name)),
  );
  return fields.length === 0 ? "It takes no arguments." : `Its arguments are: ${fields.join("; ")}.`;
}

/** One field: its name, whether it may be left out, and what it expects. */
function expectation(name: string, property: JsonSchema, required: boolean): string {
  return `${name} (${required ? "required" : "optional"}): ${expected(property)}`;
}

/**
 * What one field expects, in the schema's own terms: a closed vocabulary is
 * quoted, a calendar day is named as the form it takes, and everything else is
 * its type.
 */
function expected(property: JsonSchema): string {
  if (property["pattern"] === DAY_PATTERN) return "a day as YYYY-MM-DD";
  const members = stringList(property["enum"]);
  if (members.length > 0) return `one of ${members.map((member) => JSON.stringify(member)).join(", ")}`;
  switch (property["type"]) {
    case "integer":
      return "a whole number";
    case "number":
      return "a number";
    case "boolean":
      return "true or false";
    case "array":
      return "a list";
    case "object":
      return "an object";
    default:
      return text(property);
  }
}

/** A text field, with the length the schema states when it states one. */
function text(property: JsonSchema): string {
  const bounds: string[] = [];
  const min = property["minLength"];
  const max = property["maxLength"];
  if (typeof min === "number" && min > 0) bounds.push(`at least ${characters(min)}`);
  if (typeof max === "number") bounds.push(`at most ${characters(max)}`);
  return ["text", ...bounds].join(", ");
}

/** A count of characters a refusal can read. */
function characters(count: number): string {
  return count === 1 ? "1 character" : `${count} characters`;
}

/** The strings of a list-valued keyword, ignoring anything that is not one. */
function stringList(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** What the model counted as the request, in characters. */
function requestCharacters(messages: readonly ChatMessage[]): number {
  let total = 0;
  for (const message of messages) total += message.content.length;
  return total;
}

/** The user messages of the history, newest first: what the tool chooser reads as context. */
function earlierUserMessages(history: readonly ChatMessage[]): readonly string[] {
  const texts: string[] = [];
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const message = history[index];
    if (message !== undefined && message.role === "user") texts.push(message.content);
  }
  return texts;
}

/** The tools the assistant called in the history, newest first, in each step's own order. */
function recentToolNames(history: readonly ChatMessage[]): readonly string[] {
  const names: string[] = [];
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const message = history[index];
    if (message === undefined) continue;
    for (const call of message.toolCalls ?? []) names.push(call.name);
  }
  return names;
}

/**
 * The citations one turn collected, in the order they arrived and without
 * repeating one: a hit injected once and a tool that returned the same page
 * twice are one source, and the page shows the list.
 */
class CitationList {
  private readonly seen = new Set<string>();
  private readonly list: Citation[] = [];

  add(citation: Citation): void {
    const key = [citation.kind, citation.id, citation.locator ?? "", citation.packId ?? ""].join("|");
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.list.push(citation);
  }

  all(): readonly Citation[] {
    return this.list;
  }
}
