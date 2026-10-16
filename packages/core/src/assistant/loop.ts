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
 * **A refusal is remembered for the rest of the turn.** A tool that has to ask
 * (`write`, `network`: `ToolContext.confirm`) would otherwise have the user
 * answer one question twice, because a local model repeats the call it was just
 * refused often enough to be worth guarding against. The loop keeps those "no"s
 * (`refusals.ts`): a repeat of a refused call is answered without running the
 * tool and without asking again. A call with other arguments is a new question
 * and is asked normally, and the memory is gone by the next user message.
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
 *
 * **A turn does not end without an answer if the app can help it.** When the
 * step limit is reached, or the request no longer fits, the loop makes one more
 * completion WITHOUT tools and asks the model to answer from what the turn has
 * gathered (`closingPrompt`): a turn that ran out of room still ends in a
 * `message`, and the `error` event beside it is the honest one (`step-limit`,
 * or `context-full` when even the closing step does not fit).
 *
 * **The answer is checked when it is complete.** What the model wrote is
 * compared with what the turn did (`verify.ts`): a claim of a write that never
 * succeeded, a reply in the wrong language or the wrong script. The language
 * and the claim are corrected by ONE re-ask with the problem named, and the
 * script is repaired outright (`language.ts`) because a script is decidable.
 * The text streams as it arrives, so a draft that is re-asked has already been
 * shown; the stored message replaces it when the turn ends. A completion that
 * THREW is retried once with the same request before any of this, and never
 * after an abort: a transient runtime failure should cost a retry, not the
 * user's whole turn.
 */

import {
  answerReserveTokens,
  createEstimator,
  createToolEstimator,
  planContext,
} from "./budget.js";
import { DAY_PATTERN, normalizeToolArguments } from "./arguments.js";
import { filterAnswer } from "./citations.js";
import { createFenceBoundary, fenceUntrusted, isFenced } from "./fence.js";
import {
  detectAnswerScript,
  replyLanguage,
  transliterateToCyrillic,
  transliterateToLatin,
} from "./language.js";
import { buildSystemPrompt, replyLanguageLine } from "./prompts.js";
import { createRefusalMemory } from "./refusals.js";
import { validateToolArguments } from "./schema.js";
import { parseToolCalls } from "./toolCalls.js";
import {
  TOOL_BUDGET_SHARE,
  chooseTools,
  earlierUserMessages,
  recentSuccessfulTools,
  toolSpecCharacters,
  toolSpecTokens,
} from "./toolChoice.js";
import { verifyAnswer } from "./verify.js";
import type { MeasuredUsage } from "./budget.js";
import type { RefusalMemory } from "./refusals.js";
import type { ReplyLanguage } from "./language.js";
import type { VerificationFinding, VerifiedCall } from "./verify.js";
import type {
  AgentEvent,
  AnswerVerification,
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
  ToolEffect,
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
    // One turn, one memory of what the user refused: see `refusals.ts`.
    const refusals = createRefusalMemory();
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
      recent: recentSuccessfulTools(input.history),
      budgetTokens: Math.floor(ceiling * TOOL_BUDGET_SHARE),
      ...(input.location === undefined ? {} : { location: input.location }),
      ...(input.toolMeaning === undefined ? {} : { meaning: input.toolMeaning }),
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
      ...(input.location === undefined ? {} : { location: input.location }),
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
     * How many times a call has been refused, by the tool it named and the
     * fields that failed ({@link argumentKey}). Keyed that way rather than by
     * tool alone, because the model fixes one field and breaks another often
     * enough to matter: a genuinely corrected call is a call the loop has not
     * seen, and it is validated and given its chance to run.
     */
    const refusedArguments = new Map<string, number>();
    /** Every call the turn RAN, with the effect of the tool that ran it (`verify.ts`). */
    const ran: VerifiedCall[] = [];
    /**
     * How many model calls the turn has made. A step and the closing completion
     * both count, which is what makes `maxSteps` a bound on the turn's work and
     * not only on its tool rounds.
     */
    let steps = 0;
    /** Whether the plan itself refused: the closing completion is then the last thing left. */
    let noRoom = false;
    /** Whether the one retry a turn is allowed has been spent. */
    let retried = false;
    /**
     * Corrective re-asks spent, which {@link MAX_CORRECTIONS} bounds: at most
     * one per turn, and the answer that comes back from it is accepted as it is.
     */
    let corrections = 0;
    /** What the check flagged on the draft the one corrective re-ask was spent on. */
    let flagged: readonly VerificationFinding[] = [];
    /**
     * The rules offered tools carry, by name, so a result can be read for what
     * it changed (`verify.ts` reads the effect of the tool that ran).
     */
    const effects = new Map(offered.map((spec) => [spec.name, spec.effect] as const));
    /** Every token goes straight to the page, in the decided script. */
    const showTokens = (text: string): void => {
      emit({ type: "token", text: latin(text) });
    };

    /**
     * The closing step: one completion with NO tool offered, asking the model to
     * answer from what the turn has gathered. A turn that ran out of steps or of
     * context ends in an answer this way rather than in silence, and the answer
     * goes through the same check and repair as any other.
     */
    const closingPrompt: ChatMessage = {
      role: "user",
      content: closingInstruction(reply),
    };

    while (steps < input.maxSteps) {
      if (signal.aborted) {
        stopped();
        return;
      }
      steps += 1;
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
        noRoom = true;
        break;
      }
      if (!counted) {
        // Only the hits that survived the FIRST fit are sources of this answer:
        // a passage the model never read cannot be what it cites.
        passageCitations.push(...plan.knowledge);
        counted = true;
      }

      let result: CompletionResult | undefined;
      try {
        result = await completeOnce(plan.messages, offered, showTokens);
      } catch (error) {
        if (signal.aborted) {
          stopped();
          return;
        }
        if (!retried) {
          // One bounded retry, never after an abort: a runtime hiccup should
          // cost a retry and not the user's whole turn. A failed attempt may
          // already have streamed part of its text; the retry's own text is the
          // one the turn goes on with.
          retried = true;
          try {
            result = await completeOnce(plan.messages, offered, showTokens);
          } catch (again) {
            if (signal.aborted) {
              stopped();
              return;
            }
            // Both attempts failed. The turn keeps the runtime's own sentence
            // for the log, and its last reserve - the closing step - is what
            // gets a chance at an answer next.
            emit({
              type: "error",
              code: "model-failed",
              detail: errorMessage(again),
            });
            result = undefined;
          }
        } else {
          emit({ type: "error", code: "model-failed", detail: errorMessage(error) });
          result = undefined;
        }
      }
      if (result === undefined) {
        // The model failed after its one retry: a third call would fail the same
        // way, and a closing answer would end under the wrong error. The error
        // above says what went wrong.
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

      const settled = settledCalls(result, offered, nextCallId);
      const calls = settled.calls;
      const text = settled.text;

      if (calls.length === 0) {
        // The final answer. An empty step is not an answer, so the loop asks
        // again within its step budget.
        if (text.trim().length > 0 && acceptAnswer(text, true)) {
          finish(result.stopReason === "length" ? "length" : "end");
          return;
        }
        continue;
      }
      if (text.trim().length > 0) {
        // A step that answers AND calls tools is not an answer: what it says is
        // the preamble to the calls ("let me look"), and no source belongs beside
        // it. The sources are what the ANSWER draws on, and the answer is the step
        // that calls nothing. The preamble reaches the page now, streamed and again
        // as the message, because nothing about it is going to be re-asked.
        emit({
          type: "message",
          message: { role: "assistant", content: latin(text), toolCalls: calls },
          citations: [],
        });
      }

      pending.push({ role: "assistant", content: text, toolCalls: calls });
      for (const call of calls) emit({ type: "tool-call", call });
      const outcome = await runToolCalls(
        calls,
        offeredTools,
        input.context,
        emit,
        input.today,
        refusals,
        refusedArguments,
      );
      if (outcome.aborted) {
        stopped();
        return;
      }
      for (const entry of outcome.entries) {
        emit({ type: "tool-result", callId: entry.call.id, result: entry.result });
        ran.push({
          name: entry.call.name,
          effect: effectOf(entry.call.name),
          result: entry.result,
        });
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
    }

    // A turn out of steps or out of room: one closing completion, with no tool
    // offered, from everything the turn has gathered. The token stream carries
    // the results the model is answering from; what it says is a candidate
    // answer like any other, so it goes through the same check and repair.
    const closing = planContext({
      system,
      knowledge: hits,
      history,
      pending: [...pending, closingPrompt],
      ceiling,
      // The offered set rides in the system prompt, and the closing step offers
      // none: counting the tools here would hold room for a menu nobody sends.
      fixedTokens: 0,
      boundary,
      reply,
      estimate: createEstimator(input.locale, measured),
      estimateTool: createToolEstimator(input.locale, measured),
    });
    if (!closing.ok) {
      // Even the instruction does not fit: the turn keeps the error path it
      // always had, and the page draws why. A plan that refused during the loop
      // is `context-full`; a turn that spent its steps is `step-limit`.
      if (noRoom) {
        emit({ type: "error", code: "context-full" });
        finish("length");
        return;
      }
      emit({ type: "error", code: "step-limit" });
      finish("length");
      return;
    }
    if (!counted) passageCitations.push(...closing.knowledge);
    let closingResult: CompletionResult;
    try {
      closingResult = await input.model.complete(
        { messages: closing.messages, tools: [], maxTokens: reserve },
        signal,
        showTokens,
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
    if (signal.aborted || closingResult.stopReason === "aborted") {
      stopped();
      return;
    }
    // The closing answer is the last one there is, so it is checked and repaired
    // but never re-asked; the error beside it says why the turn ended short.
    acceptAnswer(closingResult.text, false);
    emit({ type: "error", code: "step-limit" });
    finish("length");

    /**
     * One completion, streamed to `onToken`. Extracted so the retry and the
     * closing step make the identical request a step does, with the only
     * difference being what is offered.
     */
    async function completeOnce(
      messages: readonly ChatMessage[],
      tools: readonly ToolSpec[],
      onToken: (text: string) => void,
    ): Promise<CompletionResult> {
      return await input.model.complete({ messages, tools, maxTokens: reserve }, signal, onToken);
    }

    /** The effect of a tool this turn offered, as the routing table knows it. */
    function effectOf(name: string): ToolEffect {
      return effects.get(name) ?? "read";
    }

    /**
     * The answer as the turn ends it: the findings the loop's check produced
     * (`verify.ts`). A wrong language or an unsupported claim may earn the one
     * corrective re-ask, when `mayAsk` allows it; a wrong script is repaired
     * deterministically instead (`repairScript`). Emits the answer and returns
     * true when the turn is over; returns false when the model has been asked
     * once more to write it. The draft has already streamed by then, so the
     * stored message is what replaces it when the turn ends.
     */
    function acceptAnswer(text: string, mayAsk: boolean): boolean {
      const findings = verifyAnswer({
        answer: text,
        results: ran,
        citations: toolCitations,
        reply,
      });
      const asked =
        mayAsk &&
        findings.some((finding) => finding.kind !== "script") &&
        corrections < MAX_CORRECTIONS;
      if (asked) {
        corrections += 1;
        flagged = findings;
        pending.push({ role: "user", content: correctiveInstruction(findings, reply) });
        return false;
      }
      // The record names everything the check flagged on this turn, the first
      // draft included: a re-asked answer that came back clean was still corrected.
      const kinds = [...new Set([...flagged, ...findings].map((finding) => finding.kind))];
      const repaired = findings.some((finding) => finding.kind === "script");
      const report: AnswerVerification | undefined =
        kinds.length === 0
          ? undefined
          : { findings: kinds, corrected: corrections, transliterated: repaired };
      const settled = repaired ? repairScript(text, reply) : text;
      emitAnswer(settled, passageCitations, toolCitations, latin, emit, report);
      return true;
    }
  };
}

/**
 * The script repair: the answer rewritten in the script the loop decided, when
 * the answer is in the other one. Both directions, because a reply can be decided
 * Cyrillic as well as Latin.
 */
function repairScript(text: string, decided: ReplyLanguage): string {
  if (detectAnswerScript(text) === decided.script) return text;
  return decided.script === "cyrillic"
    ? transliterateToCyrillic(text)
    : transliterateToLatin(text);
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
 * Run the calls of one model step, and answer in the model's own order.
 *
 * **A step is read in parallel and written one at a time.** Reads have no reason
 * to queue, so every call whose effect is not `write` or `network` runs at once;
 * a write or a network call waits for the ones before it in the model's own
 * order, because both change something outside the app. Two prompts at once
 * would ask the user two questions in one breath - which is the shape that used
 * to hang a page holding one confirm dialog - and the second write of a pair is
 * usually written against what the first one returned. The results are answered
 * in the order the model asked for them either way, so a page (and a test) never
 * sees a step reshuffled by whichever tool was faster.
 *
 * A refusal is the tool's own business: `ToolContext.confirm` is its question,
 * and the tool decides what the answer means for its result.
 *
 * What this adds to that is two memories of the turn, both owned by
 * `createAgentTurn`: the refusals the user already gave (`refusals.ts`), keyed
 * by the NORMALISED arguments so a call they said no to is answered here rather
 * than asked about again, and `refusedArguments`, the tool-and-fields pairs
 * whose arguments were already refused twice, so a third attempt at the same
 * mistake is answered without being read. `today` is the turn's own day, which a
 * day word in the arguments is resolved against before validation.
 */
async function runToolCalls(
  calls: readonly ToolCall[],
  tools: readonly Tool[],
  context: ToolContext,
  emit: (event: AgentEvent) => void,
  today: string,
  refusals: RefusalMemory,
  refusedArguments: Map<string, number>,
): Promise<ToolOutcome> {
  const names = tools.map((tool) => tool.name);
  const settled: (ToolEntry | ToolThrew)[] = [];
  const runOne = async (call: ToolCall): Promise<ToolEntry | ToolThrew | null> => {
      const tool = tools.find((candidate) => candidate.name === call.name);
      if (tool === undefined) {
        return {
          call,
          result: failure(
            `Unknown tool "${call.name}". The tools this turn may use are: ${names.length > 0 ? names.join(", ") : "(none)"}. Call one of those, or answer without a tool.`,
          ),
        };
      }
      // The arguments are normalised FIRST, because both memories of this turn
      // and the tool itself are keyed by what normalisation makes of them: a
      // call repeated with a day word where the first wrote a date is the same
      // question, and asking it twice is the failure `refusals.ts` exists for.
      const normalised = normalizeToolArguments(tool.parameters, call.arguments, today);
      // Before the schema check, because a call in this memory matched its
      // schema when the user was asked about it: what the model has to hear now
      // is that the question was answered, not that its arguments look odd.
      const declined = refusals.alreadyDeclined(call.name, normalised);
      if (declined !== undefined) return { call, result: declined };
      const check = validateToolArguments(tool.parameters, normalised);
      if (!check.ok) {
        // Keyed by the tool AND the fields that failed, so a call the model has
        // meanwhile corrected is validated like any other: what the bound on
        // trying counts is a repeated MISTAKE, not a repeated tool name. The
        // bound is a POLICY choice - two corrections is where a small model that
        // is going to stop has stopped - and its wording is `refusedTwice`.
        const key = argumentKey(call.name, check.errors);
        const refused = (refusedArguments.get(key) ?? 0) + 1;
        refusedArguments.set(key, refused);
        return {
          call,
          result: failure(
            refused >= 2
              ? refusedTwice(call.name)
              : refusal(call.name, tool.parameters, check.errors),
          ),
        };
      }
      try {
        const result = await tool.run(
          check.value,
          refusals.contextFor(call.name, normalised, context),
        );
        return { call, result };
      } catch (error) {
        if (context.signal.aborted) return null;
        return {
          call,
          threw: true,
          result: failure(
            `The tool ${call.name} failed: ${errorMessage(error)}. Do not repeat the call unchanged.`,
          ),
        };
      }
  };

  const parallel = calls.filter((call) => !changesTheWorld(call, tools));
  const sequential = calls.filter((call) => changesTheWorld(call, tools));
  const settledParallel = await Promise.all(parallel.map(async (call) => await runOne(call)));
  // A group that ran together: one stopped call is a stop for the step, and its
  // siblings are discarded rather than half-reported.
  if (settledParallel.some((outcome) => outcome === null)) return { aborted: true };
  for (const outcome of settledParallel) {
    if (outcome !== null) settled.push(outcome);
  }
  for (const call of sequential) {
    if (context.signal.aborted) return { aborted: true };
    const outcome = await runOne(call);
    if (outcome === null) return { aborted: true };
    settled.push(outcome);
  }
  for (const entry of settled) {
    // Only a tool that THREW is an error the page should show. A name the
    // registry does not have and arguments the schema refused are the model's
    // own corrections, and the brief's answer to both is a tool message.
    if ("threw" in entry) emit({ type: "error", code: "tool-failed" });
  }
  return { aborted: false, entries: settled };
}

/** Whether a call is one that changes something outside the app, and so waits its turn. */
function changesTheWorld(call: ToolCall, tools: readonly Tool[]): boolean {
  const effect = tools.find((tool) => tool.name === call.name)?.effect;
  return effect === "write" || effect === "network";
}

/**
 * The key one refused call is counted under: the tool it named, and the JSON
 * pointers its arguments failed at. Two calls that failed on the same field are
 * the same mistake however the model re-spelled them, and a call that fixed
 * that field is a different call - which is the whole difference between this
 * and counting by tool name.
 */
function argumentKey(name: string, errors: readonly string[]): string {
  const pointers = errors.map(errorPointer).sort();
  return `${name}|${pointers.join(",")}`;
}

/**
 * The JSON pointer a validator's finding is about, read off the sentence
 * `schema.ts` writes: it starts with the pointer and a colon (`/title: expected
 * string, got number`), or with `(root)` for the arguments as a whole.
 */
function errorPointer(error: string): string {
  const separator = error.indexOf(":");
  return separator === -1 ? error : error.slice(0, separator);
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
  verification: AnswerVerification | undefined,
): void {
  const content = latin(text);
  if (content.trim().length === 0) return;
  const filtered = filterAnswer(content, { passages, tools });
  emit({
    type: "message",
    message: { role: "assistant", content: filtered.text },
    citations: filtered.citations,
    ...(verification === undefined ? {} : { verification }),
  });
}

/**
 * How many corrective re-asks one turn may spend on its answer.
 *
 * One, and a POLICY choice rather than a measurement: the second answer is
 * accepted as it comes back, so a turn cannot spin on an answer the model
 * cannot write correctly, and a model that has just been told the language
 * still shows exactly one more completion on the wire.
 */
const MAX_CORRECTIONS = 1;

/**
 * The line the closing step carries: what the model must do with a turn that
 * has no more tools to call.
 *
 * One sentence, in English like the rest of the prompt, with the reply language
 * beside it as the prompt states it (`replyLanguageLine`) because this replaces
 * the prompt's own language line as the last thing the model reads.
 */
function closingInstruction(reply: ReplyLanguage): string {
  return [
    "No more tool calls are available in this turn. Answer the user now, in one short reply, from what you already have: what you found, what you did, and what is still missing. Do not call a tool and do not ask for permission to.",
    replyLanguageLine(reply),
  ].join("\n");
}

/**
 * The one corrective re-ask: what the loop found wrong with the answer, in the
 * model's own terms, and what to do instead. Written as a user message rather
 * than a system one because a small model weighs the most recent text most and
 * this has to outweigh the answer it is correcting.
 */
function correctiveInstruction(
  findings: readonly VerificationFinding[],
  reply: ReplyLanguage,
): string {
  const lines: string[] = [];
  if (findings.some((finding) => finding.kind === "completion-claim")) {
    lines.push(
      "Your previous answer said something was created, saved, changed or started, and no write tool succeeded in this turn. Never say a change was made unless a tool result in this turn says it was.",
    );
  }
  if (findings.some((finding) => finding.kind === "language")) {
    lines.push("Your previous answer was written in the wrong language.");
  }
  lines.push("Write the answer again now, correctly, using the results you already have.");
  lines.push(replyLanguageLine(reply));
  return lines.join("\n");
}

/**
 * What a model step actually asked for, and what of its text may be shown.
 *
 * Some GGUF templates emit a tool call as text (`toolCalls.ts`), and a template
 * the runtime parses natively can still have such a block in its prose - a Qwen
 * model explaining the call it is about to make. So the parser runs on every
 * non-empty text: a recognised block is always STRIPPED from what a page would
 * show, and its calls are ADDED only when the runtime reported none, because a
 * list the runtime already parsed is the authoritative one.
 */
function settledCalls(
  result: CompletionResult,
  offered: readonly ToolSpec[],
  nextCallId: () => string,
): { readonly calls: readonly ToolCall[]; readonly text: string } {
  if (result.text.length === 0) return { calls: result.toolCalls, text: result.text };
  const parsed = parseToolCalls(result.text);
  if (parsed.calls.length === 0) return { calls: result.toolCalls, text: result.text };
  if (result.toolCalls.length > 0) return { calls: result.toolCalls, text: parsed.text };
  if (offered.length === 0) return { calls: result.toolCalls, text: result.text };
  return {
    calls: parsed.calls.map((call) => ({
      id: nextCallId(),
      name: call.name,
      arguments: call.arguments,
    })),
    text: parsed.text,
  };
}


