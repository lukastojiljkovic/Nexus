/**
 * Cutting an answer into the pieces a voice can start speaking.
 *
 * Speech is the one place where waiting for the whole thing is the defect: an
 * answer of six sentences takes seconds to generate, and a user watching a
 * silent screen for those seconds has no way to tell the assistant is working.
 * So the answer is split and each sentence is synthesized as soon as its own
 * text is finished — which means the split has to be RIGHT rather than merely
 * plausible, because a wrong cut is heard: „This costs 3." / „50 dinars" is two
 * utterances with a pause and a falling, then rising, intonation between them.
 *
 * Which is why the two things that stop a full stop from ending a sentence are
 * here rather than in a caller. A decimal point sits between two digits, and an
 * abbreviation or an initial is a period that belongs to a word. Both are read
 * case-insensitively because a Serbian sentence may begin with a capitalized
 * abbreviation („Npr." at the start of a line) and a list of abbreviations that
 * only matched lower case would silently stop working there.
 *
 * The Serbian and English abbreviation tables are one set, not two, and that is
 * deliberate: they do not collide — no Serbian abbreviation here is an English
 * one with a different meaning — and a single table cannot be forgotten by one
 * language's branch. `npr.` and `e.g.` both mean the same thing to this function:
 * do not stop here.
 */

/** The characters that end a sentence. `\u2026` is the single-character ellipsis. */
const TERMINATORS: ReadonlySet<string> = new Set([".", "!", "?", "\u2026"]);

/**
 * Words whose trailing full stop belongs to the word.
 *
 * Serbian first, then English, then the months both languages abbreviate. Kept
 * short on purpose: every addition is a case where a sentence that SHOULD have
 * been split is not, so the list holds only abbreviations a Nexus answer is
 * likely to contain.
 */
const ABBREVIATIONS: ReadonlySet<string> = new Set([
  // Serbian.
  "npr",
  "tj",
  "itd",
  "dr",
  "g",
  "gosp",
  "str",
  "br",
  "op",
  "mr",
  "prof",
  "doc",
  "adm",
  "apr",
  "v",
  "d",
  // English.
  "e.g",
  "i.e",
  "etc",
  "vs",
  "fig",
  "no",
  "approx",
  "mr",
  "mrs",
  "ms",
  "st",
  "inc",
  "ltd",
  "dept",
  "jan",
  "feb",
  "mar",
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
 * How long one spoken chunk may be, in characters.
 *
 * A sentence is the unit of speech because it is the unit of intonation, but an
 * answer is allowed to contain a sentence nobody should read aloud in one
 * breath: a generated paragraph with no full stop in it, a quoted list, a URL.
 * At this length the chunk is roughly fifteen seconds of speech at a normal
 * rate, which is a long sentence and a short wait — and the cut is made at a
 * comma or a space, so the audio joins back up without a click in the middle of
 * a word.
 */
export const MAX_SPEECH_CHARS = 240;

/** The word a full stop belongs to, lower-cased and stripped of punctuation. */
function wordEndingAt(text: string, dotIndex: number): string {
  let start = dotIndex;
  while (start > 0 && !/\s/.test(text[start - 1] as string)) start -= 1;
  return text.slice(start, dotIndex).toLowerCase();
}

/**
 * Whether the full stop at `dotIndex` ends a sentence.
 *
 * Two ways it does not: it sits between two digits (3.5, 1.000), or the word it
 * is attached to is an abbreviation or a one-letter initial („J. Smith"). A
 * single letter is treated as an initial in both scripts.
 */
function fullStopEndsSentence(text: string, dotIndex: number): boolean {
  const before = text[dotIndex - 1];
  const after = text[dotIndex + 1];
  if (before !== undefined && after !== undefined && /\d/.test(before) && /\d/.test(after)) {
    return false;
  }
  const word = wordEndingAt(text, dotIndex);
  if (word.length === 1) return false;
  return !ABBREVIATIONS.has(word);
}

/** The index just past the sentence beginning at `start`, or `text.length`. */
function sentenceEnd(text: string, start: number): number {
  for (let index = start; index < text.length; index += 1) {
    const char = text[index] as string;
    if (char === "\n") return index;
    if (!TERMINATORS.has(char)) continue;
    if (char === "." && !fullStopEndsSentence(text, index)) continue;
    // A run of terminators is one ending: "?!", "…", "..." stay together, and
    // so does a closing quote or bracket that follows them.
    let end = index + 1;
    while (end < text.length && (TERMINATORS.has(text[end] as string) || /["')\]\u201d\u2019]/.test(text[end] as string))) {
      end += 1;
    }
    if (end >= text.length || /\s/.test(text[end] as string)) return end;
    // A terminator with a word letter on both sides is part of a token, not an
    // ending: `nexus.app`, `hrvatski?`. Keep reading.
    index = end - 1;
  }
  return text.length;
}

/** `text` cut into pieces no longer than `maxChars`, preferring a comma, then a space. */
function cutToLength(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const window = text.slice(0, maxChars + 1);
  for (const separator of [", ", "; ", ": ", " "]) {
    const at = window.lastIndexOf(separator);
    if (at > 0) {
      return [text.slice(0, at + separator.length - 1).trimEnd(), ...cutToLength(text.slice(at + separator.length).trimStart(), maxChars)];
    }
  }
  return [text.slice(0, maxChars), ...cutToLength(text.slice(maxChars), maxChars)];
}

/**
 * The sentences of `text`, in order, each still carrying its own terminator.
 *
 * Whitespace inside a sentence is collapsed to single spaces, because the
 * answer is generated text and a newline inside a sentence is a line break the
 * model chose for a screen, not a pause a voice should take.
 */
export function splitSentences(text: string, maxChars: number = MAX_SPEECH_CHARS): readonly string[] {
  if (!Number.isSafeInteger(maxChars) || maxChars <= 0) {
    throw new RangeError("splitSentences: maxChars must be a positive whole number.");
  }
  const sentences: string[] = [];
  let start = 0;
  while (start < text.length) {
    // Leading whitespace between sentences, including a blank line, is a break
    // and never a sentence of its own.
    while (start < text.length && /\s/.test(text[start] as string)) start += 1;
    if (start >= text.length) break;
    const end = sentenceEnd(text, start);
    const sentence = text.slice(start, end).replace(/\s+/g, " ").trim();
    if (sentence !== "") sentences.push(...cutToLength(sentence, maxChars));
    start = end;
  }
  return sentences;
}
