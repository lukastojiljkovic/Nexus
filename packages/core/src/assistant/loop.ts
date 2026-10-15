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
 *   4. the model's tool calls, each one checked against its own JSON schema
 *      before anything runs (`schema.ts`), then run together;
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
 * **A tool call is never lost to the step limit.** The limit counts MODEL calls;
 * a final call that still asks for tools has those tools run and its results
 * emitted, and then the turn stops with `step-limit`. Discarding a call the
 * model already made would drop a write the user had confirmed, and the page
 * would draw a request with no answer.
 *
 * **The last step carries the sources, and the reply's script is the loop's.**
 * A step that calls tools is not an answer, so its `message` event carries no
 * citations; the step that calls nothing is the answer, and the event that
 * carries it is emitted after the whole turn - because the sources are decided
 * by the answer and by the results of every call the turn made
 * (`citations.ts`). The text itself streams as it arrives, transliterated to the
 * script `language.ts` decided, and the stored answer is transliterated the same
 * way, so the draft a page shows and the message it replaces are one text.
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
import { filterAnswer } from "./citations.js";
import { createFenceBoundary, fenceUntrusted, isFenced } from "./fence.js";
import { replyLanguage, transliterateToLatin } from "./language.js";
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

    /**
     * The sources this turn collected, ready for the answer's filter
     * (`citations.ts`). The passages and the tool citations are kept apart
     * because they are chosen by different rules: a passage is a source when
     * the answer cites it or shares words with it, and a tool citation stands
     * on its own once its result said `ok`.
     */
    const passageCitations: KnowledgeHit[] = [];
    const toolCitations: Citation[] = [];
    // The reply's language and script, decided here rather than asked of the
    // model (`language.ts`): the prompt states it as a fact, and a Latin answer
    // is transliterated on the way out.
    const reply = replyLanguage(input.user.content, input.locale);
    const { script } = reply;
    const latin = (text: string): string =>
      script === "latin" ? transliterateToLatin(text) : text;
    /** The turn's final answer: its text, held until the sources are settled. */
    let answer: string | null = null;
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
      reply,
      // What the Rules block says about grounding is a fact about this turn:
      // retrieval already ran, so the loop knows whether there is a block.
      passages: hits.length > 0,
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
        reply,
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
        passageCitations.push(...plan.knowledge);
        counted = true;
      }

      let result: CompletionResult;
      try {
        result = await input.model.complete(
          { messages: plan.messages, tools: offered, maxTokens: reserve },
          signal,
          (text) => {
            // What a page draws as the answer arrives, transliterated like the
            // message that replaces it (`language.ts` pins the two agreeing).
            emit({ type: "token", text: latin(text) });
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
        if (calls.length > 0) {
          // A step that answers AND calls tools is not an answer: what it says
          // is the preamble to the calls ("let me look"), and no source belongs
          // beside it. The sources are what the ANSWER draws on, and the answer
          // is the step that calls nothing.
          emit({
            type: "message",
            message: { role: "assistant", content: latin(text), toolCalls: calls },
            citations: [],
          });
        } else {
          // The final answer. Its TEXT streams below as it arrives; the event
          // that carries it waits for the whole turn, because a citation is
          // decided by the answer and by the citations of any result the turn
          // has not received yet.
          answer = text;
        }
      }
      if (calls.length === 0) {
        emitAnswer(answer ?? "", passageCitations, toolCitations, latin, emit);
        finish(result.stopReason === "length" ? "length" : "end");
        return;
      }

      pending.push({ role: "assistant", content: text, toolCalls: calls });
      for (const call of calls) emit({ type: "tool-call", call });
      const outcome = await runToolCalls(calls, offeredTools, input.context, emit);
      if (outcome.aborted) {
        stopped();
        return;
      }
      for (const entry of outcome.entries) {
        emit({ type: "tool-result", callId: entry.call.id, result: entry.result });
        // A result that failed is not a source: a tool that refused, threw, or
        // was called by a name the turn does not have contributed nothing the
        // answer may be shown with. A result that said `ok` did, whether or not
        // the answer cites it (`contract.ts`: a tool names its own source).
        if (entry.result.ok) toolCitations.push(...(entry.result.citations ?? []));
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
 */
async function runToolCalls(
  calls: readonly ToolCall[],
  tools: readonly Tool[],
  context: ToolContext,
  emit: (event: AgentEvent) => void,
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
      const check = validateToolArguments(tool.parameters, call.arguments);
      if (!check.ok) {
        return {
          aborted: false,
          entry: {
            call,
            result: failure(
              `Invalid arguments for ${call.name}: ${check.errors.join("; ")}. Call it again with arguments that match its schema.`,
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** What the model counted as the request, in characters. */
function requestCharacters(messages: readonly ChatMessage[]): number {
  let total = 0;
  for (const message of messages) total += message.content.length;
  return total;
}

/**
 * The turn's answer, as the page draws it: the text in the decided script, and
 * the sources it may be shown with.
 *
 * The text is transliterated here as well as token by token above, because a
 * stored answer and a streamed one have to be the same text - and because a
 * script the loop decided is enforced rather than requested (`language.ts`).
 * The text the citations are filtered against is the transliterated one, so a
 * Cyrillic answer and a Latin passage meet each other in one script.
 */
function emitAnswer(
  text: string,
  passages: readonly KnowledgeHit[],
  tools: readonly Citation[],
  latin: (text: string) => string,
  emit: (event: AgentEvent) => void,
): void {
  const content = latin(text);
  if (content.trim().length === 0) return;
  const filtered = filterAnswer(content, { passages, tools });
  emit({
    type: "message",
    message: { role: "assistant", content: filtered.text },
    citations: filtered.citations,
  });
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

