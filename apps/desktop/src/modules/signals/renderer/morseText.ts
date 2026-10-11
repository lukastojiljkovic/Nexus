import {
  MAX_WPM,
  MIN_WPM,
  charForMorse,
  encodeMorse,
  morseSchedule,
  scheduleDurationMs,
  type MorseInterval,
} from "@nexus/core";

import { effectiveWpm } from "./prefs.js";

/**
 * The Morse tab's three conversions, over the engine.
 *
 * The engine owns the alphabet, the timing and the decoding of a list of
 * intervals; what it does not own is the two things a page needs on top of that:
 * a typed MESSAGE read back the way it was printed (three spaces between words,
 * or a slash, the convention `ITU-R M.1677-1`-era practice uses for a word
 * break), and a plan that says whether there is anything to play at all. Both
 * live here, and both are pure — the page that draws them is a component, and
 * this is the half of it a test can hold.
 */

/** A message as dots and dashes, plus every character that had to be sent as another one. */
export interface MorseCodeResult {
  readonly code: string;
  /** The characters the international alphabet has no code for, in the order first met — e.g. `["č", "š"]`. */
  readonly transliterated: readonly string[];
}

/** Text as Morse. The engine's `encodeMorse` under this module's own name for it. */
export function textToMorseCode(text: string): MorseCodeResult {
  const { code, transliterated } = encodeMorse(text);
  return { code, transliterated };
}

/** A message read back out of typed Morse. */
export interface MorseTextResult {
  /** The message, with `?` wherever a token matched no code — a mis-key made visible rather than dropped. */
  readonly text: string;
  /** The tokens that matched nothing, in the order they were read. */
  readonly unknown: readonly string[];
}

/**
 * A word break in typed Morse: two or more spaces, or a slash however it is
 * spaced.
 *
 * Three spaces is what this app's own encoder writes, and the engine's own
 * printed example uses it; the slash is the convention a person copying Morse
 * off a card writes, and refusing it would mean telling somebody their correct
 * message is wrong. A slash is safe as a separator because the code for a slash
 * is `-..-.` — dots and dashes — so a `/` inside a token is never part of one.
 */
const WORD_BREAK = /\s{2,}|\s*\/\s*/;

/** Typed Morse as text, with every token that is not a character reported. */
export function morseCodeToText(code: string): MorseTextResult {
  const trimmed = code.trim();
  if (trimmed === "") return { text: "", unknown: [] };
  const unknown: string[] = [];
  const words = trimmed.split(WORD_BREAK).filter((word) => word.trim() !== "");
  const rendered = words.map((word) =>
    word
      .trim()
      .split(/\s+/)
      .map((token) => {
        const character = charForMorse(token);
        if (character !== null) return character;
        unknown.push(token);
        return "?";
      })
      .join(""),
  );
  return { text: rendered.join(" "), unknown };
}

/** A message ready to key: what it says in code, the intervals, and how long they last. */
export interface MorsePlan {
  readonly code: string;
  readonly transliterated: readonly string[];
  readonly intervals: readonly MorseInterval[];
  readonly totalMs: number;
}

/**
 * The whole plan for playing a message, or null when there is nothing to play.
 *
 * Total on purpose: a speed outside the range Morse timing is defined over
 * answers null rather than reaching `morseSchedule`, which throws — a page that
 * has to catch an exception to draw a form has the wrong shape, and the prefs
 * reader is where the value is narrowed anyway. The two speeds are the engine's
 * own pair: `wpm` is the character speed and `messageWpm` the effective one,
 * which `effectiveWpm` keeps at or below it (Farnsworth only slows a message).
 */
export function planMorseMessage(
  text: string,
  wpm: number,
  messageWpm: number,
): MorsePlan | null {
  const { code, transliterated } = textToMorseCode(text);
  if (code === "" || !inRange(wpm) || !inRange(messageWpm)) return null;
  const intervals = morseSchedule(text, { charWpm: wpm, wpm: effectiveWpm(wpm, messageWpm) });
  return { code, transliterated, intervals, totalMs: scheduleDurationMs(intervals) };
}

/** Whether a speed is one the engine's timing is defined over (`MIN_WPM…MAX_WPM`). */
function inRange(wpm: number): boolean {
  return Number.isInteger(wpm) && wpm >= MIN_WPM && wpm <= MAX_WPM;
}
