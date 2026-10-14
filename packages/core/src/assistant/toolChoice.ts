/**
 * Which tools one turn offers, and which of them fit.
 *
 * The registry ships thirty-seven tools, and every one of them is described to
 * the model twice: once by the runtime, which renders the name, the English
 * description and the JSON schema as a function the template can call (or, in
 * the text fallback, as a system block - `messages.ts`), and once by
 * `buildSystemPrompt` before this module existed. Measured on 2026-10-14 with
 * the real registry and web search off, the runtime's copy alone was 7 183
 * characters of descriptions and 14 636 characters of schemas, and the prompt's
 * copy took about 8 000 more (11 164 characters, against 3 145 with no tools).
 * A local model loaded with an 8192-token window cannot hold that beside a
 * conversation, and every turn on the installed app ended in `model-failed`.
 *
 * So the loop offers a SUBSET that fits a budget, and the prompt names only the
 * tools it offers. Two things follow, and the second one is the reason this is
 * an improvement rather than only a repair. A request that fits is one the model
 * can actually answer. And a small local model chooses worse among many
 * near-identical schemas than among a handful: thirty-seven tools that all
 * mention "task" or "record" make a worse menu than the four a question is
 * about.
 *
 * **The choice is deterministic and lexical.** The same turn gives the same
 * tools, in the registry's order, because a prompt prefix that changes between
 * two identical turns is a prompt that cannot be cached and a behaviour that
 * cannot be reproduced. Ranking needs no embedding model - the app runs offline
 * on a laptop, and calling one here would cost more than the tools it saved -
 * so a tool is scored by the words its name and its own descriptions share with
 * the question, with the two languages stemmed the crude way a prefix test can
 * (see {@link scoreTool}).
 */

import { CHARACTERS_PER_TOKEN_STRUCTURED } from "./budget.js";
import type { ToolSpec } from "./contract.js";

/**
 * How many tools one turn may offer.
 *
 * A POLICY number, not a measurement: eight covers the recipes the app ships
 * with (a search, one or two reads, one write) with room for a correction, and
 * it is the same shape as `DEFAULT_MAX_STEPS` - a menu a turn can exhaust is a
 * menu the model can still read. What actually limits a turn is the budget
 * below; this is the ceiling on top of it.
 */
export const MAX_TOOLS_PER_TURN = 8;

/**
 * The share of the request ceiling the offered tools' specs may take.
 *
 * A POLICY number, not a measurement. It is the same idea as
 * `answerReserveTokens` in `budget.ts` - a slice of the window spoken for
 * before anything else is placed - and it is deliberately less than half: the
 * prompt, the history, the knowledge passages and the question all have to fit
 * in what is left, and only the question is never allowed to give way.
 */
export const TOOL_BUDGET_SHARE = 0.4;

/**
 * The tools a turn keeps when nothing in it scores and the budget allows.
 *
 * `app.search` finds anything the user already recorded and `app.open` goes
 * there; between them they are the answer to "where is" and "show me", which a
 * question the scorer did not recognise still most often is. Names rather than
 * `Tool`s, because this module is platform-free and works from specs.
 */
export const CORE_TOOLS: readonly string[] = ["app.search", "app.open"];

/**
 * What the template's own scaffolding costs per function, in tokens.
 *
 * An ALLOWANCE, not a measurement, in the sense `CHAT_MESSAGE_OVERHEAD_TOKENS`
 * states: a chat template wraps each function in the markers and separators its
 * own format uses, and 16 is a generous round number for that. Being a little
 * too generous here is the safe direction - it leaves more of the window to the
 * conversation.
 */
export const TOOL_SPEC_OVERHEAD_TOKENS = 16;

/**
 * Characters per token for a tool spec.
 *
 * A spec is the English description plus a JSON schema - structured text, which
 * is denser than prose in both languages - so it is counted with the JSON ratio
 * `budget.ts` measured on the same tokeniser, and with the LOWER of the two
 * languages. The tool's own language is not a property of the spec: the model
 * reads the English half whatever language the user writes in, so taking the
 * Serbian ratio (2.1 against 2.6) counts more tokens for the same characters,
 * which is the direction that leaves the request short of the ceiling rather
 * than over it.
 */
const SPEC_CHARACTERS_PER_TOKEN = Math.min(
  CHARACTERS_PER_TOKEN_STRUCTURED.sr,
  CHARACTERS_PER_TOKEN_STRUCTURED.en,
);

/** Earlier user messages the scorer reads. The newest two are what a follow-up is about. */
const MAX_EARLIER_MESSAGES = 2;

/** Tools from `recent` that jump the queue. `recent` is a follow-up's best guess, not its whole answer. */
const MAX_RECENT_TOOLS = 4;

/**
 * The shortest word a prefix may stand for another with.
 *
 * Four is where Serbian inflection and English pluralisation stop being
 * coincidence: `zadatke` and `zadatak` share `zadat`, `task` and `tasks` share
 * `task`, and below four characters `rok`/`red` and `due`/`dug` would start
 * matching each other. A prefix test rather than a stemmer because the app
 * ships no stemmer for either language, and a table of suffixes is a table that
 * goes stale.
 */
const MIN_PREFIX_LENGTH = 4;

/**
 * Words that carry no topic in either language: articles, pronouns, auxiliaries
 * and question words. Kept short on purpose - a longer list is a place where a
 * real word can go missing - and matched after the normalisation below, which
 * is why the Serbian entries are written without their diacritics (`sta` for
 * `šta`).
 */
const STOP_WORDS: ReadonlySet<string> = new Set([
  "the", "and", "for", "with", "what", "that", "this", "have", "from", "your", "can",
  "koji", "koja", "sta", "kako", "gde", "kada", "sam", "smo", "ste", "mi", "je", "da",
  "li", "na", "za", "od", "sa",
]);

/**
 * What a spec costs the prompt in characters: the name, the ENGLISH description
 * and the schema as the runtime serialises it. The English half only, because
 * that is the half the runtime hands the model (`englishDescription`).
 */
export function toolSpecCharacters(spec: ToolSpec): number {
  return spec.name.length + spec.description.en.length + JSON.stringify(spec.parameters).length;
}

/** {@link toolSpecCharacters} at the structured-text ratio, plus the per-function allowance. */
export function toolSpecTokens(spec: ToolSpec): number {
  return Math.ceil(toolSpecCharacters(spec) / SPEC_CHARACTERS_PER_TOKEN) + TOOL_SPEC_OVERHEAD_TOKENS;
}

export interface ToolChoiceInput {
  /** The turn's tools, registry order. */
  readonly tools: readonly ToolSpec[];
  /** This turn's user message. */
  readonly query: string;
  /** Earlier USER messages, newest first (at most {@link MAX_EARLIER_MESSAGES} are read). */
  readonly earlier: readonly string[];
  /** Tool names the assistant called in the history, newest first. */
  readonly recent: readonly string[];
  /** Tokens the offered tools may take ({@link TOOL_BUDGET_SHARE} of the ceiling). */
  readonly budgetTokens: number;
}

/**
 * The tools one turn offers, in registry order.
 *
 * The fast path comes first: a set that is small enough and cheap enough is
 * handed on whole, which is what a workflow's two to four tools are and what
 * every small registry is. Otherwise the candidates are ordered - the recent
 * calls, then the tools the question scores, then the core tools, then the area
 * siblings of everything already chosen - and the walk takes each one that fits
 * what is left of the budget, skipping the ones that do not rather than
 * stopping, so an expensive favourite does not hide a cheap answer.
 *
 * Siblings are in the list for a reason the score cannot reach: `tasks.list`
 * and `tasks.create` are two names, but "show me my tasks and add one" is one
 * intention, and a tool whose own area is already in play is more likely to be
 * the next step than a stranger that happens to share a word.
 */
export function chooseTools(input: ToolChoiceInput): readonly ToolSpec[] {
  const tools = input.tools;
  const total = tools.reduce((sum, tool) => sum + toolSpecTokens(tool), 0);
  if (tools.length <= MAX_TOOLS_PER_TURN && total <= input.budgetTokens) return tools;

  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  const ordered: string[] = [];
  const add = (name: string): void => {
    if (byName.has(name) && !ordered.includes(name)) ordered.push(name);
  };

  // (a) What the last turn already used. A follow-up ("i jos jedan") names no
  //     subject of its own, and the tool that answered the previous message is
  //     the best guess at what it means.
  const recent = input.recent.filter((name) => byName.has(name)).slice(0, MAX_RECENT_TOOLS);
  for (const name of recent) {
    add(name);
  }

  // (b) What the question names, best score first, ties in registry order.
  const query = new Set(words(input.query));
  const earlier = new Set(input.earlier.slice(0, MAX_EARLIER_MESSAGES).flatMap(words));
  const scored = tools
    .map((tool, index) => ({ tool, index, score: scoreTool(tool, query, earlier) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index);
  for (const entry of scored) add(entry.tool.name);

  // (c) The two tools that answer "where is" and "show me" when nothing scored.
  for (const name of CORE_TOOLS) add(name);

  // (d) Every area already in play, registry order. Adding siblings adds no new
  //     area, so one pass is the whole of it.
  const areas = new Set(ordered.map(areaOf));
  for (const tool of tools) {
    if (areas.has(areaOf(tool.name))) add(tool.name);
  }

  const taken: ToolSpec[] = [];
  let remaining = input.budgetTokens;
  for (const name of ordered) {
    if (taken.length >= MAX_TOOLS_PER_TURN) break;
    const tool = byName.get(name);
    if (tool === undefined) continue;
    const cost = toolSpecTokens(tool);
    if (cost > remaining) continue;
    taken.push(tool);
    remaining -= cost;
  }

  const chosen = new Set(taken.map((tool) => tool.name));
  return tools.filter((tool) => chosen.has(tool.name));
}

/** The text before the dot: `tasks.create` is in the `tasks` area. */
function areaOf(name: string): string {
  return name.slice(0, name.indexOf("."));
}

/**
 * What a tool is worth to this question.
 *
 * A word of the question is two points, a word of an earlier message one, and a
 * word is counted once however many of the tool's words it matches: a tool
 * whose description says "zadatak" three times is not three times the answer.
 * Words the question already counted are not counted again from the earlier
 * messages, or a follow-up repeating the question's own subject would weigh
 * twice.
 */
function scoreTool(tool: ToolSpec, query: ReadonlySet<string>, earlier: ReadonlySet<string>): number {
  const vocabulary = toolVocabulary(tool);
  let score = 0;
  for (const word of query) if (matches(word, vocabulary)) score += 2;
  for (const word of earlier) if (!query.has(word) && matches(word, vocabulary)) score += 1;
  return score;
}

/**
 * The words a tool can be recognised by: its name's area and verb, and both
 * halves of its description.
 *
 * The Serbian half is here even though the model never reads it, because the
 * USER'S words are what is being matched, and a Serbian question about tasks
 * shares its words with the Serbian description far more often than with the
 * English one.
 */
function toolVocabulary(tool: ToolSpec): ReadonlySet<string> {
  return new Set([
    ...words(tool.name),
    ...words(tool.description.sr),
    ...words(tool.description.en),
  ]);
}

/** Whether two words are the same, or one of them is a prefix of the other's at least four characters long. */
function matches(word: string, vocabulary: ReadonlySet<string>): boolean {
  for (const candidate of vocabulary) {
    if (word === candidate) return true;
    if (Math.min(word.length, candidate.length) < MIN_PREFIX_LENGTH) continue;
    if (word.startsWith(candidate) || candidate.startsWith(word)) return true;
  }
  return false;
}

/**
 * The words of a piece of text, in the one shape the matcher compares: lower
 * case, `đ` folded to `dj`, combining marks stripped, split on anything that is
 * not a letter or a digit, words of at least three characters, stop words gone.
 *
 * The NFD-and-strip step is what makes `zadatke` and `zadátak` one word, and
 * the explicit `đ` is there because it is the one Serbian letter NFD does not
 * decompose - it is a `d` with a stroke, not a `d` with a mark.
 */
function words(text: string): readonly string[] {
  return text
    .toLowerCase()
    .replace(/đ/g, "dj")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3 && !STOP_WORDS.has(word));
}
