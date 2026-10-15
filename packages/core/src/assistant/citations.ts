/**
 * The sources an answer is shown with, and the markers left in its text.
 *
 * Two things were wrong with "everything the loop injected is a source". Every
 * passage that survived the first fit was listed under the answer whether or not
 * the model had used it, so a question about today's tasks showed five
 * unrelated Wikipedia articles; and a passage's NUMBER meant the numbering of
 * the block the model read, which is not the numbering of the list the page
 * drew. Both are decided here, once, from the answer itself:
 *
 *   1. the passages the answer cites by number are the sources, in the block's
 *      own order - and the list is ordered by the answer's markers, so a source
 *      the first sentence cites stands above one a later sentence cites;
 *   2. when the answer cites no number at all, a passage stays if it shares at
 *      least {@link MIN_SHARED_WORDS} content words with the answer, and a
 *      passage from a safety pack always stays, because the safety notice is
 *      drawn from the citations;
 *   3. the answer's markers are rewritten to the 1-based positions in the list
 *      that comes out, and a marker pointing at no source is removed from the
 *      text.
 *
 * **Why the overlap rule exists at all.** A 2-5B model cites by number when it
 * is reminded to and forgets otherwise, and a correct answer with no markers
 * would otherwise be drawn with no sources - which reads as an answer from
 * nowhere. Two shared content words is a POLICY threshold, not a measurement:
 * it is the point where a shared word is unlikely to be an accident, and it is
 * deliberately a count a test can state rather than a score nobody can check.
 *
 * **What does not belong here.** Tool results keep their own citations
 * (`contract.ts`), and the loop is what decides that a failed result contributes
 * none: this module never sees a result, only the sources already chosen for the
 * answer. One source is one entry however many times the turn met it - a page
 * injected once and a tool that returned the same page twice are the same
 * source, and two rows for one article is a list that lies about its length.
 */

import { contentWords } from "./language.js";
import type { Citation, KnowledgeHit } from "./contract.js";

/**
 * How many content words an answer must share with a passage for the passage to
 * be shown beside it when the answer cites nothing. A POLICY number: the
 * threshold is a judgement about coincidence, not a measurement of anything.
 */
export const MIN_SHARED_WORDS = 2;

/**
 * The shortest prefix two words may share and still be one word. Four is the
 * rule `toolChoice.ts` matches a question's words with, stated there: Serbian
 * inflection and English pluralisation stop being coincidence at four
 * characters, and below it `rok`/`red` would match each other.
 */
const MIN_PREFIX_LENGTH = 4;

/** The two kinds of source an answer may be shown with, kept apart on purpose. */
export interface AnswerCitations {
  /** A passage from the knowledge block, with the number the model read it under. */
  readonly passages: readonly KnowledgeHit[];
  /** Citations a tool result contributed. */
  readonly tools: readonly Citation[];
}

export interface FilteredAnswer {
  /** The answer, with every marker rewritten to its source's new number or removed. */
  readonly text: string;
  /** The sources, in the order their numbers name them. */
  readonly citations: readonly Citation[];
}

/**
 * The answer's text and the sources it may be shown with.
 *
 * The order is the order the answer CITES in - so a list is read the way the
 * answer is - then the uncited passages the answer shares words with, then the
 * tool citations as they arrived. Numbering follows that final order, which is
 * what makes `[3]` in the text the third source under it and not the block's
 * third passage.
 *
 * **Reading the numbers the model was given is safe because they never move.**
 * A passage keeps its block number across the steps of a turn: knowledge gives
 * way from the END of the list (`budget.ts`, lowest score first), so the
 * passages that survive are the first ones, still numbered [1], [2], and the
 * loop reads the number of the request that carries the block it counted.
 */
export function filterAnswer(answer: string, sources: AnswerCitations): FilteredAnswer {
  const chosen: Citation[] = [];
  const positionOf = new Map<string, number>();
  /** The source's 1-based position in the list, adding it if it is new. */
  const place = (citation: Citation): number => {
    const key = [citation.kind, citation.id, citation.locator ?? "", citation.packId ?? ""].join("|");
    const existing = positionOf.get(key);
    if (existing !== undefined) return existing;
    chosen.push(citation);
    positionOf.set(key, chosen.length);
    return chosen.length;
  };

  // Pass 1. The markers, in the order the answer writes them, which is what the
  // list's order is. A number outside the block is not a citation: it is a year
  // in brackets or a stray figure, and it leaves no trace in the text.
  const citedNumbers = new Set<number>();
  const markers = new Map<number, number>();
  for (const match of answer.matchAll(CITATION_MARKER)) {
    for (const part of (match[1] ?? "").split(",")) {
      const number = Number.parseInt(part.trim(), 10);
      const hit = Number.isInteger(number) ? sources.passages[number - 1] : undefined;
      if (hit === undefined) continue;
      citedNumbers.add(number);
      markers.set(number, place(hit.citation));
    }
  }
  // Pass 2. An answer that cites nothing is shown with the passages it draws
  // its own words from. One that cites by number has said what it used, and a
  // passage it left out is not added back for sharing a name with it: "Nikola
  // Tesla (TV serija)" shares two words with every answer about Tesla. A safety
  // passage is kept either way, because the page draws the safety notice from
  // the citations, and a notice lost to a forgotten marker is the one mistake
  // this list must not make.
  for (const [index, hit] of sources.passages.entries()) {
    if (citedNumbers.has(index + 1)) continue;
    if (hit.citation.safety === true || (citedNumbers.size === 0 && overlaps(answer, hit.text))) {
      place(hit.citation);
    }
  }
  for (const citation of sources.tools) place(citation);
  return { text: rewriteMarkers(answer, markers), citations: chosen };
}

/** A bracketed run of marker numbers: `[1]`, `[1, 3]`, and `[1][3]` as two markers. */
const CITATION_MARKER = /\[(\d+(?:\s*,\s*\d+)*)\]/g;

/**
 * The answer with every marker replaced by its source's new number, and every
 * marker without a source removed.
 *
 * A marker that goes is replaced by NOTHING rather than by its own number: a
 * number the list under the answer does not carry is the defect this module
 * exists for, and leaving it would keep the model's invented source on screen.
 * The tidy-up is small on purpose - a doubled space and a space left in front of
 * punctuation are the two marks a removal can leave in a sentence.
 */
function rewriteMarkers(answer: string, markers: ReadonlyMap<number, number>): string {
  const rewritten = answer.replace(CITATION_MARKER, (marker: string, list: string) => {
    const kept: string[] = [];
    for (const part of list.split(",")) {
      const value = Number.parseInt(part.trim(), 10);
      const position = Number.isInteger(value) ? markers.get(value) : undefined;
      if (position !== undefined) kept.push(String(position));
    }
    return kept.length === 0 ? "" : `[${kept.join(", ")}]`;
  });
  return rewritten
    .replace(/ +([.,;:!?])/g, "$1")
    .replace(/ {2,}/g, " ")
    .trim();
}

/**
 * Whether an answer and a passage share at least {@link MIN_SHARED_WORDS}
 * content words, one of them a prefix of the other's first
 * {@link MIN_PREFIX_LENGTH} characters.
 */
function overlaps(answer: string, passage: string): boolean {
  const passageWords = new Set(contentWords(passage));
  if (passageWords.size === 0) return false;
  let shared = 0;
  for (const word of new Set(contentWords(answer))) {
    if (word.length < MIN_PREFIX_LENGTH) continue;
    for (const candidate of passageWords) {
      if (candidate.length < MIN_PREFIX_LENGTH) continue;
      if (word.slice(0, MIN_PREFIX_LENGTH) !== candidate.slice(0, MIN_PREFIX_LENGTH)) continue;
      shared += 1;
      break;
    }
    if (shared >= MIN_SHARED_WORDS) return true;
  }
  return false;
}
