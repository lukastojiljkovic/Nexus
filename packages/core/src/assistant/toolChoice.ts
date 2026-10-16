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
 * **The choice is deterministic and lexical by default.** The same turn gives the
 * same tools, in the registry's order, because a prompt prefix that changes
 * between two identical turns is a prompt that cannot be cached and a behaviour
 * that cannot be reproduced. A tool is scored by the words its name and its own
 * descriptions share with the question, with both languages folded to Latin and
 * inflection stripped by a light stemmer (see {@link scoreTool}). When an
 * embedder is loaded the caller may add a meaning score per tool
 * (`toolMeaning.ts`); without one this module is exactly the lexical choice.
 *
 * The page the user has open comes first: its module's tools are what "this"
 * and "here" refer to, so they are offered before the question is read.
 */

import { CHARACTERS_PER_TOKEN_STRUCTURED } from "./budget.js";
import type { ChatMessage, ToolSpec } from "./contract.js";

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
 *
 * Lowered from 0.4 on 2026-10-16. Measured with the registry at 148 tools on an
 * 8 192-token window: a turn that filled 0.4 of the ceiling (2 867 tokens) with
 * the headroom query's prompt (1 365 tokens) left 2 936 for the conversation,
 * under the 3 000 the tools test (`index.test.ts`) requires. The number is still
 * a policy choice; the measurement is why it moved.
 */
export const TOOL_BUDGET_SHARE = 0.35;

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
 * How many of the open page's own tools a turn offers first.
 *
 * A POLICY number. Three is what a page's everyday verbs need (a list, a create,
 * an update), and it leaves the rest of the cap for the question's own tools.
 */
export const LOCATION_TOOL_LIMIT = 3;

/**
 * The cosine a tool's meaning must reach before it counts at all.
 *
 * A POLICY number, not a measurement. Without a floor every tool has some
 * similarity to every question, and those small positive scores would outrank
 * the lexical answer. It has NOT been tuned against an installed embedding model;
 * the tests use a fake embedder, so this is a value to revisit with a real one.
 */
export const MEANING_FLOOR = 0.5;

/**
 * Points a meaning score adds per unit of cosine above {@link MEANING_FLOOR}.
 *
 * A POLICY number on the same scale as the lexical score, where a word of the
 * question is worth two points: at the floor a tool gets nothing, and a cosine of
 * 1 (identical text) is worth four, two shared words.
 */
export const MEANING_WEIGHT = 8;

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
 * matching each other. The prefix test is what carries the matching; the suffix
 * table below only makes the stems it compares shorter.
 */
const MIN_PREFIX_LENGTH = 4;

/**
 * Word endings stripped before two words are compared: Serbian noun, adjective
 * and plural endings, and the English plural `s` is left alone on purpose.
 *
 * A HEURISTIC, not a stemmer. It knows which endings are common, not which words
 * a language has, so it can shorten a word a prefix test would then match
 * wrongly; {@link MIN_STEM_LENGTH} is what keeps that rare. Longest first, so
 * `ama` is taken before `a`.
 */
const ENDINGS: readonly string[] = [
  "ama", "ima", "ovi", "evi", "ove", "ega", "oga", "om", "em", "og", "oj", "ih", "ak", "a", "e", "i", "u", "o",
];

/** A stem a suffix may not shorten below: `zadatak` gives `zadat`, `tasks` stays whole. */
const MIN_STEM_LENGTH = 4;

/**
 * Cyrillic letters folded to the Latin spelling the Serbian Latin alphabet uses,
 * so a question typed in Cyrillic finds the tools whose descriptions are Latin.
 * Lower case only: the text is lower-cased first.
 */
const CYRILLIC: Readonly<Record<string, string>> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", ђ: "dj", е: "e", ж: "z", з: "z", и: "i", ј: "j",
  к: "k", л: "l", љ: "lj", м: "m", н: "n", њ: "nj", о: "o", п: "p", р: "r", с: "s", т: "t",
  ћ: "c", у: "u", ф: "f", х: "h", ц: "c", ч: "c", џ: "dz", ш: "s",
};

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
  /** The module the user has open beside the assistant, if any: its tools are offered first. */
  readonly location?: string;
  /**
   * How close each tool's description is to the question, as a cosine per tool
   * name, when an embedder is loaded. Absent means the lexical choice alone.
   */
  readonly meaning?: ReadonlyMap<string, number>;
}

/**
 * The tools one turn offers, in registry order.
 *
 * The fast path comes first: a set that is small enough and cheap enough is
 * handed on whole, which is what a workflow's two to four tools are and what
 * every small registry is. Otherwise the candidates are ordered - the open
 * page's tools, then the recent calls, then the tools the question scores, then
 * the core tools, then the area siblings of everything already chosen - and the
 * walk takes each one that fits
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

  const query = [...new Set(tokens(input.query))];
  const queryStems = new Set(query.map(stem));
  // An earlier word the question already says is not counted twice (see scoreTool).
  const earlier = input.earlier
    .slice(0, MAX_EARLIER_MESSAGES)
    .flatMap(tokens)
    .filter((token) => !queryStems.has(stem(token)));
  const vocabularies = tools.map((tool) => ({
    tool,
    vocabulary: vocabularyOf([tool.name, tool.description.sr, tool.description.en]),
  }));
  const ranked = vocabularies
    .map(({ tool, vocabulary }, index) => ({
      tool,
      index,
      score: scoreTool(vocabulary, query, earlier, input.meaning?.get(tool.name)),
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index);

  // (a) The open page's own tools, best first. Module ids and tool areas are the
  //     same names, so the area of a location is the location itself.
  if (input.location !== undefined) {
    for (const entry of ranked.filter((item) => areaOf(item.tool.name) === input.location).slice(0, LOCATION_TOOL_LIMIT)) {
      add(entry.tool.name);
    }
  }

  // (b) What the last turns already used. A follow-up ("i jos jedan") names no
  //     subject of its own, and the tool that answered the previous message is
  //     the best guess at what it means.
  const recent = input.recent.filter((name) => byName.has(name)).slice(0, MAX_RECENT_TOOLS);
  for (const name of recent) {
    add(name);
  }

  // (c) What the question names, best score first, ties in registry order.
  for (const entry of ranked) {
    if (entry.score > 0) add(entry.tool.name);
  }

  // (d) The two tools that answer "where is" and "show me" when nothing scored.
  for (const name of CORE_TOOLS) add(name);

  // (e) Every area already in play, registry order. Adding siblings adds no new
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
 * A word of the question is two points, a word of an earlier message one, each
 * scaled by how exactly the tool spells it (see {@link fitOf}), and a word is
 * counted once however many of the tool's words it matches: a tool whose
 * description says "zadatak" three times is not three times the answer. Earlier
 * words the question already names are dropped before this (in `chooseTools`),
 * or a follow-up repeating the question's own subject would weigh twice. The
 * meaning score, when there is one, is added on the same scale.
 *
 * No word is weighted by how rare it is. A rarity weight (inverse document
 * frequency) was tried and reverted: it let a rare word of the question ("račun")
 * outrank the word that names the tool's own area ("zadatak") on the request set
 * in `offering.requests.json`.
 */
function scoreTool(
  vocabulary: Vocabulary,
  query: readonly string[],
  earlier: readonly string[],
  meaning: number | undefined,
): number {
  let score = 0;
  for (const token of query) score += 2 * fitOf(token, vocabulary);
  for (const token of earlier) score += fitOf(token, vocabulary);
  if (meaning !== undefined) score += MEANING_WEIGHT * Math.max(0, meaning - MEANING_FLOOR);
  return score;
}

/**
 * The words a tool can be recognised by, in the two forms the matcher reads:
 * `forms` are the words as the text spells them, `stems` the same words with
 * their endings stripped.
 */
interface Vocabulary {
  readonly forms: ReadonlySet<string>;
  readonly stems: ReadonlySet<string>;
}

/**
 * How much one word of the question counts for a tool. A word the tool spells
 * the same way counts in full; a word that matches only after its endings are
 * stripped counts half, so `zadatak` does not tie with every tool that says
 * `zadatke` - the exact spelling outranks the inflection. The 1 and the 0.5 are
 * POLICY numbers, chosen so an exact match beats a stem match and a stem match
 * still beats nothing.
 */
function fitOf(token: string, vocabulary: Vocabulary): number {
  if (vocabulary.forms.has(token)) return 1;
  return matches(stem(token), vocabulary.stems) ? 0.5 : 0;
}

/**
 * The user messages of a history, newest first: what the tool chooser reads as
 * the conversation's subject.
 */
export function earlierUserMessages(history: readonly ChatMessage[]): readonly string[] {
  const texts: string[] = [];
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const message = history[index];
    if (message !== undefined && message.role === "user") texts.push(message.content);
  }
  return texts;
}

/** How many of the newest turns {@link recentSuccessfulTools} reads. */
const RECENT_TURNS = 2;

/**
 * The tools the assistant called successfully in the last {@link RECENT_TURNS}
 * turns, newest first, in each step's own order.
 *
 * A turn starts at a user message, so the window opens at the second-newest one.
 * A call counts only when its result said `ok`: a tool that was refused or
 * failed is not the one the user is continuing with.
 */
export function recentSuccessfulTools(history: readonly ChatMessage[]): readonly string[] {
  let start = 0;
  let turns = 0;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (history[index]?.role !== "user") continue;
    turns += 1;
    if (turns === RECENT_TURNS) {
      start = index;
      break;
    }
  }
  const window = history.slice(start);
  const succeeded = new Set(
    window.filter((message) => message.role === "tool" && message.ok === true).map((message) => message.toolCallId),
  );
  const names: string[] = [];
  for (let index = window.length - 1; index >= 0; index -= 1) {
    for (const call of window[index]?.toolCalls ?? []) {
      if (succeeded.has(call.id)) names.push(call.name);
    }
  }
  return names;
}

/**
 * The vocabulary of a tool: its name's area and verb, and both halves of its
 * description.
 *
 * The Serbian half is here even though the model never reads it, because the
 * USER'S words are what is being matched, and a Serbian question about tasks
 * shares its words with the Serbian description far more often than with the
 * English one.
 */
function vocabularyOf(texts: readonly string[]): Vocabulary {
  const forms = new Set(texts.flatMap(tokens));
  return { forms, stems: new Set([...forms].map(stem)) };
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
 * case, Cyrillic folded to Latin, `đ` folded to `dj`, combining marks stripped,
 * split on anything that is not a letter or a digit, words of at least three
 * characters, stop words gone. The words as spelled; {@link stem} strips them.
 *
 * The NFD-and-strip step is what makes `zadatke` and `zadátak` one word, and
 * the explicit `đ` is there because it is the one Serbian letter NFD does not
 * decompose - it is a `d` with a stroke, not a `d` with a mark. The Cyrillic
 * fold is what makes `задатак` the same word as `zadatak`.
 */
function tokens(text: string): readonly string[] {
  return text
    .toLowerCase()
    .replace(/\p{Script=Cyrillic}/gu, (letter) => CYRILLIC[letter] ?? "")
    .replace(/đ/g, "dj")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3 && !STOP_WORDS.has(word));
}

/** The word without its first matching {@link ENDINGS} entry, if what remains is at least {@link MIN_STEM_LENGTH} long. */
function stem(word: string): string {
  for (const ending of ENDINGS) {
    if (word.length - ending.length >= MIN_STEM_LENGTH && word.endsWith(ending)) {
      return word.slice(0, -ending.length);
    }
  }
  return word;
}
