/**
 * Sentence splitting for the sentence translator (SR/EN).
 *
 * **Why this is ours and not the engine's.** Bergamot translates a batch of
 * strings and has no document context; it also does its own internal
 * segmentation, which is fine when you hand it a paragraph and useless when you
 * want to show the reader what is being worked on. This splitter is the
 * renderer's own answer to "what is one sentence here", so the page can count
 * sentences, translate them in stable batches and show progress per batch.
 *
 * **What it is not.** Not a linguist's segmenter: it is a rule set small enough
 * to read here in full, tuned against the two languages this app ships, where
 * the only hard cases are abbreviations (`npr.`, `e.g.`, `Mr.`), initials
 * (`J. Petrović`) and decimals (`3.14`, `1.5.2026.`). A candidate boundary is a
 * run of `.`/`!`/`?`/`…` followed by whitespace; it is NOT a boundary when the
 * text before it is one of those three shapes, or when what follows is not the
 * start of a new sentence (a lower-case letter — `u 15. veku`).
 *
 * Every rule below is written as a small function so a test can name the case
 * it pins, and the abbreviation list holds both languages: Serbian abbreviations
 * keep the dot (`npr.`, `itd.`, `str.`) and English ones do too (`etc.`,
 * `Dr.`), and both are matched case-insensitively except for the single-letter
 * initial rule, which is case-sensitive by construction.
 */

/**
 * Abbreviations that carry a dot and never end a sentence. Lower case, no
 * trailing dot, internal dots kept (`e.g`, `i.e`) — the lookup is done on the
 * dotted chain exactly as it appears in the text, folded to lower case.
 *
 * The list is deliberately short: every entry here is a word that a Serbian or
 * English sentence would otherwise be cut after, and a word missing from it is
 * a wrong split in a test rather than a wrong split in production, because the
 * caller translates each piece on its own.
 */
export const ABBREVIATIONS: ReadonlySet<string> = new Set([
  // Serbian
  "npr",
  "itd",
  "tj",
  "str",
  "br",
  "dr",
  "mr",
  "prof",
  "doc",
  "g",
  "god",
  "ul",
  "op",
  "sv",
  "min",
  "maks",
  "čl",
  "sl",
  "st",
  "d",
  "i.d",
  "o.g",
  "a.d",
  "p.n",
  "p.p",
  "r.k",
  // English
  "e.g",
  "i.e",
  "etc",
  "mr",
  "mrs",
  "ms",
  "dr",
  "prof",
  "st",
  "vs",
  "no",
  "vol",
  "fig",
  "approx",
  "inc",
  "ltd",
  "dept",
  "est",
  "jan",
  "feb",
  "mar",
  "apr",
  "jun",
  "jul",
  "aug",
  "sep",
  "sept",
  "oct",
  "nov",
  "dec",
]);

/**
 * Characters that may sit between the final mark and the whitespace: a closing
 * quote or bracket belongs to the sentence that just ended. `“` and `”` are both
 * here because the app's Serbian copy closes a quotation with `“` (`„Idem.“`)
 * where English closes with `”`.
 */
const CLOSERS = "\"')]»“”’‘";

/** Characters that may open the next sentence: an upper-case letter, a digit (a numbered list) or an opening quote. */
const OPENERS = "„“\"'«([";

/** One candidate terminator: a run of marks. */
const TERMINATORS = /[.!?…]+/gu;

/** The dotted chain immediately before `end`: `npr.`, `e.g.`, `J.`, or `null`. */
function dottedChainBefore(text: string, end: number): string | null {
  const match = /(?:\p{L}+\.)+$/u.exec(text.slice(0, end));
  return match === null ? null : match[0];
}

/** True when the text before a candidate boundary says the mark is not a sentence end. */
function isNotBoundary(text: string, markStart: number, markEnd: number): boolean {
  const chain = dottedChainBefore(text, markEnd);
  // The mark itself is the last character of the chain, so a chain of exactly one
  // letter and one dot is an initial — `J. Petrović` — and one of any length
  // whose folded spelling is in the list is an abbreviation.
  if (chain !== null) {
    const folded = chain.toLowerCase();
    if (/^\p{Lu}\.$/u.test(chain)) return true;
    if (ABBREVIATIONS.has(folded) || ABBREVIATIONS.has(folded.replace(/\.$/u, ""))) return true;
  }
  // A bare `.` after a digit is a decimal or one field of a date: 3.14, 1.5.2026.
  if (markEnd - markStart === 1 && text[markStart] === "." && /\d$/u.test(text.slice(0, markStart))) {
    return true;
  }
  return false;
}

/** True when `char` starts a new sentence — the guard that keeps `u 15. veku` together. */
function startsSentence(char: string): boolean {
  return /\p{Lu}/u.test(char) || /\d/u.test(char) || OPENERS.includes(char);
}

/**
 * The sentences of `text`, in order, each trimmed, with its own final mark kept.
 *
 * A paragraph break is a boundary of its own: `Prva.\nDruga.` is two sentences
 * whether or not the first one ended a line, and a blank line adds nothing
 * because empty pieces are dropped.
 */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  let start = 0;
  TERMINATORS.lastIndex = 0;
  for (let match = TERMINATORS.exec(text); match !== null; match = TERMINATORS.exec(text)) {
    const markStart = match.index;
    let end = match.index + match[0].length;
    while (end < text.length && CLOSERS.includes(text[end] ?? "")) end += 1;
    if (end < text.length && !/\s/u.test(text[end] ?? "")) continue;
    if (end < text.length && !startsSentence(text.slice(end).trimStart().charAt(0))) continue;
    if (isNotBoundary(text, markStart, markStart + match[0].length)) continue;
    const sentence = text.slice(start, end).trim();
    if (sentence.length > 0) out.push(sentence);
    start = end;
    TERMINATORS.lastIndex = end;
  }
  const tail = text.slice(start).trim();
  if (tail.length > 0) out.push(tail);
  return out;
}

/**
 * The sentences of a text, grouped by paragraph.
 *
 * **Why the paragraph survives at all.** A sentence translator has no document
 * context, but a pasted paragraph is a shape the reader typed on purpose, and
 * reflowing three paragraphs into one would be the translator editing the text.
 * The splitter itself stays paragraph-blind (one rule, tested above); this
 * wrapper is the only place that remembers where a blank line was, and the
 * caller joins each group with a space and the groups with a blank line.
 */
export function splitParagraphs(text: string): string[][] {
  return text
    .split(/\n\s*\n/u)
    .map((paragraph) => splitSentences(paragraph))
    .filter((sentences) => sentences.length > 0);
}
