/**
 * The typing tutor's drill text and its keystroke bookkeeping, as pure
 * functions.
 *
 * **What the drill is.** A lesson (`@nexus/core`'s `TYPING_LESSONS`) carries the
 * keys it introduces and every key available by then (`cumulative`). The drill
 * is pseudo-words drawn from that cumulative set: three to five keys each, which
 * is long enough to build muscle memory for the pair and short enough that a
 * mistake does not run away. The keys that mean something in Serbian
 * (`š đ č ć ž`) are ordinary keys of the drill's alphabet, which is the whole
 * reason the layout data exists.
 *
 * **Why the text is generated with an injected source.** `randomBelow` is the
 * engine's own `RandomBelow` contract, so a test can script it and assert the
 * exact text, and the page passes the crypto-backed one - the same split
 * `@nexus/core`'s `random.ts` uses, for the same reason.
 *
 * **Why the keystrokes are kept rather than counted.** A score needs the TIME
 * each character landed at (`scoreTypingSession` measures speed from them), so
 * the page keeps an array aligned with the field's value: appending a character
 * appends a timestamp, and deleting one drops it. Backspace therefore costs
 * nothing and is not counted as a mistake, which is what the engine's own
 * comment says it expects.
 */
import type { RandomBelow, TypingKeystroke } from "@nexus/core";

/** The shortest word a drill builds, in keys. */
export const DRILL_MIN_WORD = 3;

/** The longest word a drill builds, in keys. */
export const DRILL_MAX_WORD = 5;

/** How many words one drill holds: long enough to measure, short enough to finish. */
export const DRILL_WORDS = 12;

/**
 * One drill: `DRILL_WORDS` pseudo-words of three to five keys, drawn from the
 * lesson's cumulative keys.
 *
 * A lesson with no keys cannot make a drill and answers the empty string rather
 * than throwing: the lesson data is the engine's and is never empty, but a
 * caller that got one is better handed nothing than an exception from a render.
 */
export function drillText(
  keys: readonly string[],
  randomBelow: RandomBelow,
  words = DRILL_WORDS,
): string {
  if (keys.length === 0) return "";
  if (!Number.isInteger(words) || words < 1) {
    throw new RangeError("a drill holds at least one word");
  }
  const built: string[] = [];
  for (let word = 0; word < words; word += 1) {
    const length = DRILL_MIN_WORD + randomBelow(DRILL_MAX_WORD - DRILL_MIN_WORD + 1);
    let text = "";
    for (let key = 0; key < length; key += 1) {
      text += keys[randomBelow(keys.length)] ?? "";
    }
    built.push(text);
  }
  return built.join(" ");
}

/**
 * The keystroke list that matches a field's new value.
 *
 * The value is what the user is looking at, so it decides the list's length: the
 * characters already there keep the instants they landed at, and anything new
 * (a pasted block included) is stamped with `atMs`. A character typed over
 * another - a selection replaced in place - therefore keeps the old instant for
 * its position, which is a deliberate approximation: the alternative is
 * guessing what the field did, and the score is about the session's speed rather
 * than about one keystroke's millisecond.
 */
export function keystrokesFromChange(
  previous: readonly TypingKeystroke[],
  next: string,
  atMs: number,
): TypingKeystroke[] {
  return [...next].map((typed, index) => ({
    atMs: previous[index]?.atMs ?? atMs,
    typed,
  }));
}
