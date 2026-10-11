/**
 * The context budget: what fits in the window, and what gives way first.
 *
 * A local model runs with a fixed context length the runtime reports
 * (`LoadedModelInfo.contextTokens`), and a request that overflows it is not a
 * degraded answer - llama.cpp truncates, and truncation here means the MODEL
 * loses its instructions or the user's question while the app shows a confident
 * reply. So the loop asks this module to assemble the request, and this module
 * either returns something that fits or refuses with `context-full`.
 *
 * **Token counts are estimates, in characters.** There is no tokeniser in this
 * package (it is platform-free, and a BPE vocabulary is a megabyte of data), so
 * the estimator divides a character count by a ratio MEASURED with the
 * tokeniser of a real GGUF family: `@huggingface/transformers` 4.3.1,
 * `AutoTokenizer.from_pretrained("Qwen/Qwen2.5-7B-Instruct")` (Apache-2.0),
 * 2026-10-10. Four shapes were measured, because a request is made of more than
 * prose, and the measurements are stated here so a later run can redo them:
 *
 *   prose, sr    apps/desktop/src/renderer/src/strings.sr.ts  60 014 chars -> 24 214 tokens = 2.478 chars/token
 *   prose, en    apps/desktop/src/renderer/src/strings.en.ts  60 009 chars -> 13 675 tokens = 4.388 chars/token
 *   json,  sr    twelve task records with Serbian values      1 481 chars ->    678 tokens = 2.184 chars/token
 *   json,  en    the same records with English values         1 445 chars ->    546 tokens = 2.647 chars/token
 *   prompt, sr   the assembled system prompt (see prompts.ts) 3 158 chars ->    770 tokens = 4.101 chars/token
 *   prompt, en   the same prompt for the English locale       3 142 chars ->    761 tokens = 4.129 chars/token
 *
 * Serbian is denser than English because its inflections and its diacritics
 * split into more byte-level pieces; the two prose ratios differ by 77 percent,
 * which is why one number for both languages would under-count Serbian requests
 * (the default locale) by a third. A JSON record is denser still, in EITHER
 * language - keys, ids, punctuation and digits are all short pieces - which is
 * why tool results are counted with their own pair of ratios
 * ({@link CHARACTERS_PER_TOKEN_STRUCTURED}). The assembled prompt sits between
 * the two because it is English prose carrying two lines of Serbian; it is
 * counted as prose, and the 4 percent of under-count that leaves is inside the
 * answer's reservation.
 *
 * Every constant below rounds its measurement DOWN, so the estimate errs on the
 * side of a request that fits.
 *
 * A model that reports its own `promptTokens` beats any ratio
 * ({@link MeasuredUsage}): once one request has been counted for real, the
 * estimator uses the model's arithmetic for the rest of the turn
 * (`createEstimator`). A runtime that reports nothing changes nothing.
 *
 * What gives way, in this order, is fixed by the brief and by how bad each loss
 * is to the user: old turns first (the newest exchange is what the question is
 * about), then a long tool result (its head is usually what the model needs,
 * and the page still has the whole of it), then the knowledge passages. The
 * system prompt and the current user message are never dropped, and a request
 * that cannot hold even those is refused rather than trimmed.
 *
 * A trimmed tool result keeps its closing fence marker. Cutting a fenced block's
 * end would leave an unterminated region of untrusted text in the prompt, which
 * is worse than a shorter result: the model can no longer tell where the data
 * stops.
 */

import { renderKnowledgeBlock } from "./prompts.js";
import type { AssistantLocale, ChatMessage, KnowledgeHit } from "./contract.js";

/**
 * Characters per token for PROSE (a prompt, a conversation, a knowledge
 * passage), measured (see the file header). Rounded down from 2.478 and 4.388.
 * Used when the model has reported no counts.
 */
export const CHARACTERS_PER_TOKEN: Readonly<Record<AssistantLocale, number>> = {
  sr: 2.4,
  en: 4.3,
};

/**
 * Characters per token for a TOOL RESULT, measured on the same tokenizer and
 * the same day over twelve JSON records (see the file header). Rounded down
 * from 2.184 and 2.647. A structured result is denser than prose in both
 * languages, and counting it as prose would under-estimate a request's cost by
 * about a third - the direction that ends in a truncated prompt.
 */
export const CHARACTERS_PER_TOKEN_STRUCTURED: Readonly<Record<AssistantLocale, number>> = {
  sr: 2.1,
  en: 2.6,
};

/**
 * The fixed allowance for a chat template's own scaffolding around one message
 * (role markers, separators). Four is the usual cost of `role: content` in the
 * templates this app ships against; it is an allowance, not a measurement, and
 * being a little too generous is the safe direction.
 */
export const CHAT_MESSAGE_OVERHEAD_TOKENS = 4;

/** The same, once per request: the priming text a template appends after the last message. */
export const REQUEST_OVERHEAD_TOKENS = 8;

/**
 * A tool result is never trimmed below this, in characters. Trimming has to
 * make progress (see {@link planContext}), and a floor is what keeps it from
 * shaving a message down to nothing while the loop believes it is converging.
 */
export const MIN_TOOL_RESULT_CHARS = 240;

/** The answer's room, chosen per window: see {@link answerReserveTokens}. */
const MIN_ANSWER_TOKENS = 256;
const MAX_ANSWER_TOKENS = 1024;

/** Bound on the plan's own passes. Each pass makes progress, so this is a runaway guard. */
const MAX_PASSES = 2000;

/**
 * How much of the window is kept for the answer.
 *
 * A quarter of the window, floored at 256 tokens and capped at 1024: a short
 * Serbian answer with the safety notice in it is well under 256, and an answer
 * longer than 1024 tokens costs more wall-clock time than it is worth on a
 * laptop CPU. These are policy numbers, not measurements. The loop passes this
 * same value as the request's `maxTokens`, so the reservation and the request
 * cannot drift.
 */
export function answerReserveTokens(contextTokens: number): number {
  if (!Number.isFinite(contextTokens) || contextTokens <= 0) return MIN_ANSWER_TOKENS;
  return Math.max(
    MIN_ANSWER_TOKENS,
    Math.min(MAX_ANSWER_TOKENS, Math.floor(contextTokens / 4)),
  );
}

/**
 * What a model reported about one request it answered: the prompt tokens it
 * counted, and the characters that request was made of. `promptTokens` is the
 * model's own number, not ours.
 */
export interface MeasuredUsage {
  readonly promptTokens: number;
  readonly characters: number;
}

/** A function that says how many tokens a piece of text will cost. */
export type TokenEstimator = (text: string) => number;

/**
 * An estimator for one turn.
 *
 * With no measurement, the per-language ratio. With one, the model's own ratio
 * for the request that produced it - a blend of the languages and the shapes
 * that request was actually made of, which is a better predictor of the NEXT
 * request than a constant measured over prose. A measurement whose numbers are
 * not positive is ignored rather than turned into a division by zero.
 */
export function createEstimator(locale: AssistantLocale, measured?: MeasuredUsage): TokenEstimator {
  return estimatorFor(CHARACTERS_PER_TOKEN[locale], measured);
}

/**
 * An estimator for a tool result, which is JSON rather than prose
 * ({@link CHARACTERS_PER_TOKEN_STRUCTURED}).
 *
 * A measurement wins here too, and one measurement serves both estimators: the
 * model counted the whole request, prose and JSON together, so its ratio is the
 * blend that request was made of rather than a second guess.
 */
export function createToolEstimator(
  locale: AssistantLocale,
  measured?: MeasuredUsage,
): TokenEstimator {
  return estimatorFor(CHARACTERS_PER_TOKEN_STRUCTURED[locale], measured);
}

/** {@link createEstimator}, for a caller that wants one number. */
export function estimateTokens(
  text: string,
  locale: AssistantLocale,
  measured?: MeasuredUsage,
): number {
  return createEstimator(locale, measured)(text);
}

export interface ContextPlanInput {
  /** The system prompt. Never dropped. */
  readonly system: string;
  /** The knowledge hits, highest score first. Injected as one fenced block. */
  readonly knowledge: readonly KnowledgeHit[];
  /** Earlier turns, oldest first. */
  readonly history: readonly ChatMessage[];
  /** This turn's messages so far, oldest first: the user message, then any assistant and tool messages. */
  readonly pending: readonly ChatMessage[];
  /** Tokens available to the request, the answer's room already subtracted. */
  readonly ceiling: number;
  /** The fence boundary this turn drew, for the knowledge block. */
  readonly boundary: string;
  /** Token estimator for this turn ({@link createEstimator}). */
  readonly estimate: TokenEstimator;
  /**
   * Token estimator for tool results ({@link createToolEstimator}). Defaults to
   * `estimate`, which is what a caller with one estimator means.
   */
  readonly estimateTool?: TokenEstimator;
}

export interface ContextPlanFit {
  readonly ok: true;
  /** The request to send: system prompt, knowledge block, history, pending. */
  readonly messages: readonly ChatMessage[];
  /** The hits that survived the fit, in their original order. */
  readonly knowledge: readonly KnowledgeHit[];
  /** How many turns were dropped from the front of the history. */
  readonly droppedHistory: number;
  /** How many tool results were trimmed (a result may be trimmed more than once). */
  readonly trimmedToolResults: number;
  /** How many knowledge hits were dropped, lowest score first. */
  readonly droppedKnowledge: number;
  /** The plan's own estimate of the request, in tokens. At most `ceiling`. */
  readonly estimatedTokens: number;
}

export interface ContextPlanFull {
  readonly ok: false;
  readonly reason: "context-full";
  /** What the smallest possible request (system prompt and the user message) would cost. */
  readonly requiredTokens: number;
  readonly ceiling: number;
}

export type ContextPlan = ContextPlanFit | ContextPlanFull;

/**
 * Fit one request into the window, or refuse.
 *
 * Deterministic: the same input gives the same plan, and the order in which
 * things give way is a property of this function rather than of how full the
 * window happened to be. `history` and `pending` arrive as arrays this function
 * copies, and the tool results it trims are new objects, so a caller's own
 * conversation state is untouched.
 */
export function planContext(input: ContextPlanInput): ContextPlan {
  const history: ChatMessage[] = [...input.history];
  const pending: ChatMessage[] = [...input.pending];
  const hits: KnowledgeHit[] = [...input.knowledge];
  let droppedHistory = 0;
  let trimmedToolResults = 0;
  let droppedKnowledge = 0;

  const assemble = (): ChatMessage[] => {
    const block = renderKnowledgeBlock(hits, input.boundary);
    const messages: ChatMessage[] = [{ role: "system", content: input.system }];
    if (block !== null) messages.push({ role: "system", content: block });
    messages.push(...history, ...pending);
    return messages;
  };
  const estimateTool = input.estimateTool ?? input.estimate;

  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    const messages = assemble();
    const estimate = requestTokens(messages, input.estimate, estimateTool);
    if (estimate <= input.ceiling) {
      return {
        ok: true,
        messages,
        knowledge: hits,
        droppedHistory,
        trimmedToolResults,
        droppedKnowledge,
        estimatedTokens: estimate,
      };
    }
    // 1. Old turns. Dropping from the front of one message at a time and then
    //    walking on to the next user message keeps every remaining tool result
    //    paired with the assistant call it answers.
    if (history.length > 0) {
      history.shift();
      while (history.length > 0 && history[0]?.role !== "user") history.shift();
      droppedHistory += 1;
      continue;
    }
    // 2. A long tool result, trimmed at its end with a marker that says so.
    if (trimLongestToolResult(history, pending, estimate - input.ceiling, estimateTool)) {
      trimmedToolResults += 1;
      continue;
    }
    // 3. Knowledge, lowest score first, and finally the whole block.
    if (hits.length > 0) {
      hits.pop();
      droppedKnowledge += 1;
      continue;
    }
    return {
      ok: false,
      reason: "context-full",
      requiredTokens: estimate,
      ceiling: input.ceiling,
    };
  }
  const required = requestTokens(assemble(), input.estimate, estimateTool);
  return { ok: false, reason: "context-full", requiredTokens: required, ceiling: input.ceiling };
}

/**
 * What a whole request costs: the messages, the per-message overhead and the
 * priming. A tool message is counted with `estimateTool`, because a tool result
 * is JSON and the two shapes are not the same price per character.
 */
export function requestTokens(
  messages: readonly ChatMessage[],
  estimate: TokenEstimator,
  estimateTool: TokenEstimator = estimate,
): number {
  let total = REQUEST_OVERHEAD_TOKENS;
  for (const message of messages) {
    const cost = message.role === "tool" ? estimateTool : estimate;
    total += CHAT_MESSAGE_OVERHEAD_TOKENS + cost(message.content);
  }
  return total;
}

/** The shared shape of {@link createEstimator} and {@link createToolEstimator}. */
function estimatorFor(measuredRatio: number, measured?: MeasuredUsage): TokenEstimator {
  const ratio =
    measured !== undefined && measured.promptTokens > 0 && measured.characters > 0
      ? measured.characters / measured.promptTokens
      : measuredRatio;
  return (text: string) => Math.ceil(codePointLength(text) / ratio);
}

/**
 * Trim the longest tool result so the request can fit, and say whether anything
 * was trimmed.
 *
 * The head of a result is kept: a tool result is usually a list whose first
 * entries are the ones the question asked about, and the tail is what a cap
 * cuts. The closing fence marker is kept too, or the block would be left open
 * (see the file header). Removal is computed from the message's OWN density
 * (characters divided by its estimated tokens) rather than from a global
 * average, so a result full of Serbian prose gives up the same number of TOKENS
 * as one full of JSON ids. The marker is English because it is read by the
 * model, never drawn.
 */
function trimLongestToolResult(
  history: ChatMessage[],
  pending: ChatMessage[],
  overshootTokens: number,
  estimate: TokenEstimator,
): boolean {
  let bestArray: ChatMessage[] | null = null;
  let bestMessage: ChatMessage | null = null;
  let bestIndex = -1;
  let bestLength = 0;
  for (const array of [history, pending]) {
    for (let index = 0; index < array.length; index += 1) {
      const message = array[index];
      if (message === undefined || message.role !== "tool") continue;
      if (bestArray !== null && message.content.length <= bestLength) continue;
      bestArray = array;
      bestMessage = message;
      bestIndex = index;
      bestLength = message.content.length;
    }
  }
  if (bestArray === null || bestMessage === null) return false;
  const content = bestMessage.content;
  const tail = closingFence(content);
  const body = tail.length > 0 ? content.slice(0, content.length - tail.length) : content;
  if (body.length <= MIN_TOOL_RESULT_CHARS) return false;
  const tokens = Math.max(1, estimate(body));
  const charsPerToken = body.length / tokens;
  const wanted = Math.ceil(Math.max(1, overshootTokens) * charsPerToken * 1.25) + 32;
  const omitted = Math.min(wanted, body.length - MIN_TOOL_RESULT_CHARS);
  const kept = body.slice(0, body.length - omitted);
  const marker = `\n\n[trimmed ${omitted} characters from this tool result]`;
  bestArray[bestIndex] = { ...bestMessage, content: kept + marker + tail };
  return true;
}

/** The block's own closing line, `""` when the content is not a fenced block. */
function closingFence(content: string): string {
  const match = /(?:^|\n)-{5,}[^\S\n]*END[^\S\n]+(?:UNTRUSTED[^\S\n]+)?DATA\b[^\n]*$/.exec(content);
  return match === null ? "" : match[0];
}

function codePointLength(text: string): number {
  return [...text].length;
}
