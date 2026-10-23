/**
 * Compaction: a long conversation's first turns, replaced in what the model
 * reads by a summary the model writes of them.
 *
 * Without it the context budget drops the oldest turns that do not fit
 * (`budget.ts`), silently: the model forgets the start of a thread while the
 * page still shows it. A summary keeps what those turns said - who asked for
 * what, the names and numbers, what the tools did - in a few hundred tokens.
 * The messages themselves are never touched; the store keeps a summary beside
 * them and a count of the leading messages it stands for.
 *
 * **When.** A turn compacts first when its history would take more than
 * {@link COMPACT_HISTORY_SHARE} of the window, and only when there is a head to
 * summarize: the last {@link KEEP_RECENT_TURNS} turns are always kept word for
 * word, because the next question is about them.
 *
 * **How.** The head is written out as a plain transcript inside a fence (it is
 * the user's and the tools' text, so it is data), and the model is asked for one
 * summary of it in the interface's language. A head larger than the window is
 * summarized in passes, each pass starting from the summary before it; a thread
 * that was compacted before starts from its own last summary, so the new one
 * stands for everything up to the cut.
 */

import {
  CHARACTERS_PER_TOKEN,
  CHAT_MESSAGE_OVERHEAD_TOKENS,
  REQUEST_OVERHEAD_TOKENS,
  answerReserveTokens,
  createEstimator,
  createToolEstimator,
} from "./budget.js";
import type { AssistantLocale, ChatMessage, ChatModel } from "./contract.js";
import { createFenceBoundary, fenceUntrusted } from "./fence.js";

/**
 * The share of the window's ceiling a history may take before a turn compacts
 * it. A policy, from the measurement `toolChoice.ts` states: on an 8 192-token
 * window the offered tools and the prompt leave about 3 300 tokens, 0.46 of the
 * ceiling, for the conversation; 0.4 leaves the new question room beside it.
 */
export const COMPACT_HISTORY_SHARE = 0.4;

/** The turns a compaction keeps word for word: the exchanges the next question is about. */
export const KEEP_RECENT_TURNS = 2;

/** The summary's room, in tokens: the request's `maxTokens`. A policy number. */
export const SUMMARY_MAX_TOKENS = 512;

/** The length the summary is asked to keep to, in words; under {@link SUMMARY_MAX_TOKENS} in either language. */
const SUMMARY_WORDS = 250;

/** A tool result in the transcript, in characters: its head says what the tool did. */
const TOOL_RESULT_CHARS = 600;

/** The least room a pass may have for the transcript, in tokens; a smaller window cannot summarize. */
const MIN_PASS_TOKENS = 256;

/**
 * Where the kept tail of `history` starts: the {@link KEEP_RECENT_TURNS}-th user
 * message from the end. Cutting at a user message keeps an assistant's tool
 * call and its result on the same side. `0` when there is nothing before the
 * kept turns.
 */
export function compactionCut(history: readonly Pick<ChatMessage, "role">[]): number {
  let turns = 0;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (history[index]?.role !== "user") continue;
    turns += 1;
    if (turns === KEEP_RECENT_TURNS) return index;
  }
  return 0;
}

/** Whether a turn should compact its history before it runs. */
export function shouldCompact(
  history: readonly ChatMessage[],
  contextTokens: number,
  locale: AssistantLocale,
): boolean {
  if (compactionCut(history) === 0) return false;
  const prose = createEstimator(locale);
  const structured = createToolEstimator(locale);
  const tokens = history.reduce(
    (sum, message) =>
      sum + (message.role === "tool" ? structured : prose)(message.content) + CHAT_MESSAGE_OVERHEAD_TOKENS,
    0,
  );
  const ceiling = Math.max(0, contextTokens - answerReserveTokens(contextTokens));
  return tokens > ceiling * COMPACT_HISTORY_SHARE;
}

export interface SummarizeInput {
  readonly model: ChatModel;
  /** The thread's last summary, which the new one folds in; `null` before the first compaction. */
  readonly earlier: string | null;
  /** The messages after the last summary and before the cut. */
  readonly messages: readonly ChatMessage[];
  readonly locale: AssistantLocale;
  readonly signal: AbortSignal;
}

/** One summary of `earlier` and `messages`, written by the model. */
export async function summarizeConversation(input: SummarizeInput): Promise<string> {
  const { model, locale, signal } = input;
  if (signal.aborted) throw new Error("The summary was aborted.");
  const estimate = createEstimator(locale);
  const instructions = summaryInstructions(locale);
  // What every pass costs besides the transcript: the instructions, the fence
  // around it, the two messages and the answer's own room.
  const fixed =
    estimate(instructions) +
    estimate(fenceUntrusted("", { label: "CONVERSATION", boundary: createFenceBoundary() })) +
    2 * CHAT_MESSAGE_OVERHEAD_TOKENS +
    REQUEST_OVERHEAD_TOKENS +
    SUMMARY_MAX_TOKENS;
  const room = model.info.contextTokens - fixed;
  if (room < MIN_PASS_TOKENS) {
    throw new Error(`A ${model.info.contextTokens}-token window has no room to summarize in.`);
  }

  let summary = input.earlier;
  let lines: string[] = [];
  const pass = async (): Promise<void> => {
    summary = await summarizePass(model, instructions, transcript(summary, lines), signal);
    lines = [];
  };
  for (const message of input.messages) {
    const line = transcriptLine(message);
    if (line === null) continue;
    if (lines.length > 0 && estimate(transcript(summary, [...lines, line])) > room) await pass();
    // A single message larger than what is left is cut to fit: its head is what
    // a summary of it would keep, and the page still has the whole of it.
    const left = room - estimate(transcript(summary, lines));
    lines.push(headOf(line, Math.max(0, Math.floor(left * CHARACTERS_PER_TOKEN[locale]) - 1)));
  }
  if (lines.length > 0) await pass();
  if (summary === null) throw new Error("There is nothing to summarize.");
  return summary;
}

async function summarizePass(
  model: ChatModel,
  instructions: string,
  body: string,
  signal: AbortSignal,
): Promise<string> {
  const result = await model.complete(
    {
      messages: [
        { role: "system", content: instructions },
        { role: "user", content: fenceUntrusted(body, { label: "CONVERSATION", boundary: createFenceBoundary() }) },
      ],
      tools: [],
      maxTokens: SUMMARY_MAX_TOKENS,
    },
    signal,
    () => undefined,
  );
  if (signal.aborted || result.stopReason === "aborted") throw new Error("The summary was aborted.");
  const text = result.text.trim();
  if (text.length === 0) throw new Error("The model wrote no summary.");
  return text;
}

function summaryInstructions(locale: AssistantLocale): string {
  const language = locale === "sr" ? "Serbian, in the Latin script with full diacritics" : "English";
  return [
    "You condense a conversation between a user and the assistant built into the Nexus app, so that the assistant can go on from a short summary instead of the whole text.",
    "The conversation is in the fenced block: a summary of its earlier part when there is one, then the messages after it.",
    `Write one summary of all of it in ${language}, in plain sentences, at most ${SUMMARY_WORDS} words. Keep:`,
    "- what the user asked for, and what they said they want or prefer;",
    "- names, numbers, dates and titles exactly as written;",
    "- what each tool was asked to do, and whether it succeeded;",
    "- what was decided, and what is still open.",
    "Leave out greetings and anything said twice. Write only the summary: no heading, no comment on the task.",
  ].join("\n");
}

function transcript(summary: string | null, lines: readonly string[]): string {
  const head = summary === null ? [] : ["Summary so far:", summary, ""];
  return [...head, "Messages:", ...lines].join("\n");
}

/** One message as a transcript line; `null` for a system message, which the loop owns. */
function transcriptLine(message: ChatMessage): string | null {
  switch (message.role) {
    case "system":
      return null;
    case "user":
      return `User: ${message.content}`;
    case "assistant": {
      const parts: string[] = [];
      if (message.content.trim().length > 0) parts.push(`Assistant: ${message.content}`);
      const calls = message.toolCalls ?? [];
      if (calls.length > 0) parts.push(`Assistant called: ${calls.map((call) => call.name).join(", ")}`);
      return parts.length === 0 ? null : parts.join("\n");
    }
    case "tool":
      return `Tool result${message.ok === false ? " (failed)" : ""}: ${headOf(message.content, TOOL_RESULT_CHARS)}`;
  }
}

function headOf(text: string, chars: number): string {
  return text.length <= chars ? text : `${text.slice(0, Math.max(0, chars - 1)).trimEnd()}…`;
}
