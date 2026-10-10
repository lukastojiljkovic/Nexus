/**
 * Morse — the ITU alphabet, the timing that turns it into a schedule, and the
 * decoder that reads a sender's timings back.
 *
 * **The table is ITU-R M.1677-1's own.** Every code below was read out of the
 * Recommendation's Annex 1 (letters §1.1.1, figures §1.1.2, punctuation and
 * miscellaneous signs §1.1.3, 10/2009). Nothing is carried over from an
 * amateur list, and the signals that are not letters are the Recommendation's
 * procedural signals printed rather than named: `.-.-.` is „invitation to
 * transmit" and `.-...` is „wait", and both are absent from alphabet tables.
 *
 * **Serbian letters have no code, so they are transliterated and the
 * transliteration is reported.** č → c, ć → c, š → s, ž → z, đ → dj. No code is
 * invented for them, and `encodeMorse` hands back every letter it changed so a
 * screen can say so. The ITU Recommendation itself has a rule for this case
 * (§3.1: a sign with no Morse signal is transmitted as its name), and a
 * diacritic is not a letter of the international alphabet — the transliteration
 * is the one that keeps the text readable at the other end.
 *
 * **Timing is the PARIS standard.** One dit is `1200 / WPM` ms: the word PARIS
 * is 50 dit units of signalling, so N words a minute is N × 50 units a minute,
 * and the unit is therefore 1200000 / (50 × WPM). ITU-R M.1677-1 §2 then fixes
 * the rest of the scale: a dash is three dits, the gap inside a character is
 * one, between characters three, between words seven.
 *
 * **Farnsworth spacing is derived, not quoted.** Farnsworth sends the
 * characters at one speed and the message at a slower one, by stretching the
 * gaps and nothing else. The derivation is in `farnsworthGapUnits` below; it
 * follows from the standard's own per-character arithmetic, and it reduces to
 * the standard gaps when the two speeds are equal.
 */

import type { MorseCharacter } from "./morseTable.js";
import { MORSE_BY_CHARACTER, MORSE_BY_CODE } from "./morseTable.js";

/** One keyed interval. `on` is the tone or the lit screen, `off` the silence after it. */
export interface MorseInterval {
  readonly on: boolean;
  /** Duration of this interval in milliseconds. */
  readonly ms: number;
}

/** The speeds a schedule is built from, in words per minute. */
export interface MorseTiming {
  /** The speed the CHARACTERS are sent at — this one sets the dit and the gaps inside a character. */
  readonly charWpm: number;
  /**
   * The speed the MESSAGE is sent at — this one sets the gaps between characters
   * and between words. Absent or equal to `charWpm` is ordinary PARIS timing.
   */
  readonly wpm?: number;
}

/** One character of a decoded message, with the timings it was read from. */
export interface MorseDecodedChar {
  /** The decoded character, or null when the run of marks matched no ITU code. */
  readonly char: string | null;
  /** The marks as they were read, dots and dashes. */
  readonly code: string;
  /** Walls between characters: a fresh word starts at this one. */
  readonly wordGap: boolean;
}

/** What a decoder learned from a list of timings. */
export interface MorseDecodeResult {
  /** The message, with `?` where a run matched no ITU code. */
  readonly text: string;
  /** The dit length the reading was taken at, in milliseconds. */
  readonly unitMs: number;
  /** The sender's speed as that dit implies it, in words per minute. */
  readonly wpm: number;
  readonly characters: readonly MorseDecodedChar[];
  /**
   * True when nothing in the input measured one unit, so the unit was a guess.
   * `decodeMorse` says what that is and what to do about it; the text is still
   * the best reading of the timings.
   */
  readonly ambiguous: boolean;
}

export interface MorseEncodeResult {
  /** The message in dots and dashes: one space between characters, three between words. */
  readonly code: string;
  /** Every character that was transliterated, in the order first met, e.g. `["č", "š"]`. */
  readonly transliterated: readonly string[];
}

/** What a caller can tell the decoder that the timings cannot. */
export interface MorseDecodeOptions {
  /**
   * The sender's speed in words per minute, when it is known. Without it the
   * unit is measured from the timings, and a message that measures nothing one
   * unit long comes back `ambiguous` rather than guessed. A value that is not a
   * finite positive number is ignored, and the unit is measured instead.
   */
  readonly expectedWpm?: number;
}

/** The PARIS constant: `1200 / WPM` ms per dit, and the anchor of every duration below. */
export const PARIS_DIT_MS = 1200;

/** Between these the arithmetic stays sane and the timing stays readable. */
export const MIN_WPM = 1;
export const MAX_WPM = 60;

/**
 * Characters with no code of their own, mapped to what is sent instead.
 *
 * - The Serbian diacritics have no ITU code and are sent as their base
 *   letters. dj is the digraph because `đ` is a single Serbian letter whose
 *   Latin fallback is two characters, the same reason `nj` and `lj` are taught
 *   as letters.
 * - ITU-R M.1677-1 itself sends three signs as other characters: the
 *   multiplication sign as the letter X (§3.2.1), and `%` and `‰` as the figure
 *   0, the fraction bar and 0 or 00 (§3.3.1).
 */
export const MORSE_TRANSLITERATIONS: Readonly<Record<string, string>> = {
  č: "c",
  ć: "c",
  š: "s",
  ž: "z",
  đ: "dj",
  "×": "x",
  "%": "0/0",
  "‰": "0/00",
};

/** Milliseconds one dit lasts at `wpm`, by the PARIS standard. */
export function ditMs(wpm: number): number {
  return PARIS_DIT_MS / wpm;
}

/**
 * The gap between characters, in dit units, for Farnsworth spacing.
 *
 * Farnsworth sends the characters at one speed and the message at a slower one,
 * by stretching the gaps and nothing else, so the marks below stay one dit and
 * three dits long. The stretch is DERIVED here rather than quoted, from the
 * scale `ITU-R M.1677-1` §2 fixes and the standard's own definition of a word:
 *
 *   - the word PARIS is 31 dit of marks and gaps inside characters — P 11,
 *     A 5, R 7, I 3, S 5 units, read off `./morseTable.js` — plus four gaps
 *     between its five characters and one gap between words;
 *   - at effective speed `w` that word has to last `60 000 / w` ms, because a
 *     unit is `1200 / w` ms and PARIS is the standard's 50 units;
 *   - the word gap stays the standard's `7/3` of the character gap, which is
 *     what keeps the 1 : 3 : 7 rhythm recognisable at any stretch.
 *
 * With the character gap `g` in dit units, `unit · (31 + 4g + 7g/3) = 60 000/w`
 * and `unit = 1200/c` give
 *
 *     g = (150 · c / w − 93) / 19   units,
 *
 * which is 3 exactly when `w === c` — so the standard timing is the special
 * case, not a branch — and grows as `w` falls. When the effective speed is the
 * faster of the two there is nothing to stretch (Farnsworth only slows a
 * message down) and the standard gap comes back.
 *
 * The per-character constant is a fact about the word PARIS, which is what the
 * PARIS standard is: the derivation assumes five letters to the word. A message
 * of one-letter words therefore lands a little under its nominal speed, exactly
 * as it does on air.
 */
export function farnsworthGapUnits(charWpm: number, wpm: number): number {
  if (!(wpm < charWpm)) return 3;
  return (150 * (charWpm / wpm) - 93) / 19;
}

/**
 * The gap between words, in dit units: seven at standard spacing, stretched by
 * the same factor the character gap was stretched by — the Recommendation's
 * 1 : 3 : 7 ratio is preserved, which is what keeps the rhythm recognisable.
 */
export function farnsworthWordGapUnits(charWpm: number, wpm: number): number {
  return (farnsworthGapUnits(charWpm, wpm) / 3) * 7;
}

/**
 * The ITU code for one character, or null when the alphabet has none.
 *
 * Input is matched after trimming and upper-casing, so `"a"` and `"A"` are the
 * same character. A Serbian diacritic is NOT resolved here — it reaches null,
 * because inventing a code for it is the one thing this module must not do;
 * `encodeMorse` is where transliteration happens, out loud.
 */
export function morseForChar(char: string): string | null {
  return MORSE_BY_CHARACTER.get(char.trim().toUpperCase())?.code ?? null;
}

/** The character an ITU code stands for, or null. Separators in `code` are ignored. */
export function charForMorse(code: string): string | null {
  const cleaned = code.replace(/[^.-]/g, "");
  return cleaned.length === 0 ? null : characterForCode(cleaned);
}

/** Every entry of the alphabet, in table order — what alphabet pickers and legends read. */
export function morseAlphabet(): readonly MorseCharacter[] {
  return [...MORSE_BY_CHARACTER.values()];
}

/**
 * A message as dots and dashes.
 *
 * Words are separated by three spaces and characters by one, which is the
 * convention every other implementation prints. Serbian diacritics are
 * transliterated here and each one is reported; a character the ITU alphabet
 * does not have and transliteration does not cover is dropped and reported the
 * same way, because silently shortening a message is how a wrong message is
 * sent.
 */
export function encodeMorse(text: string): MorseEncodeResult {
  const transliterated: string[] = [];
  const note = (char: string): void => {
    if (!transliterated.includes(char)) transliterated.push(char);
  };

  const words: string[] = [];
  for (const word of text.trim().split(/\s+/)) {
    if (word.length === 0) continue;
    const codes: string[] = [];
    for (const char of word.toLowerCase()) {
      // The transliteration is really a transliteration: `đ` is sent as two
      // letters, so what is looked up is every character of the replacement and
      // not the replacement as if it were one.
      const sent = MORSE_TRANSLITERATIONS[char] ?? char;
      const marks: string[] = [];
      let known = true;
      for (const letter of sent) {
        const code = MORSE_BY_CHARACTER.get(letter.toUpperCase())?.code;
        if (code === undefined) {
          known = false;
          break;
        }
        marks.push(code);
      }
      if (!known) {
        note(char);
        continue;
      }
      if (sent !== char) note(char);
      codes.push(marks.join(" "));
    }
    if (codes.length > 0) words.push(codes.join(" "));
  }
  return { code: words.join("   "), transliterated };
}

/**
 * A message as keyed intervals, ready to play as a tone or a flashing screen.
 *
 * The intervals alternate on and off and start with an on, so a player can walk
 * them and flip the key at each boundary without a state machine. The last
 * interval is the gap inside the final character — a message does not end with
 * trailing silence, because nothing follows it to be separated from.
 *
 * Throws on a speed outside `MIN_WPM`–`MAX_WPM` or an effective speed faster
 * than the character speed: neither is a schedule anybody meant, and a duration
 * of zero or infinity is not something a player should have to defend against.
 */
export function morseSchedule(text: string, timing: MorseTiming): MorseInterval[] {
  const charWpm = timing.charWpm;
  if (!Number.isFinite(charWpm) || charWpm < MIN_WPM || charWpm > MAX_WPM) {
    throw new RangeError(`charWpm ${charWpm} is outside ${MIN_WPM}–${MAX_WPM}`);
  }
  const wpm = timing.wpm ?? charWpm;
  if (!Number.isFinite(wpm) || wpm < MIN_WPM || wpm > MAX_WPM) {
    throw new RangeError(`wpm ${wpm} is outside ${MIN_WPM}–${MAX_WPM}`);
  }
  if (wpm > charWpm) throw new RangeError(`wpm ${wpm} is faster than charWpm ${charWpm}`);

  const unit = ditMs(charWpm);
  const gap = farnsworthGapUnits(charWpm, wpm) * unit;
  const wordGap = farnsworthWordGapUnits(charWpm, wpm) * unit;

  const intervals: MorseInterval[] = [];
  const { code } = encodeMorse(text);
  const words = code.split("   ").filter((word) => word.length > 0);
  words.forEach((word, wordIndex) => {
    const characters = word.split(" ");
    characters.forEach((character, charIndex) => {
      [...character].forEach((mark, markIndex) => {
        intervals.push({ on: true, ms: mark === "-" ? unit * 3 : unit });
        if (markIndex < character.length - 1) intervals.push({ on: false, ms: unit });
      });
      if (charIndex < characters.length - 1) intervals.push({ on: false, ms: gap });
    });
    if (wordIndex < words.length - 1) intervals.push({ on: false, ms: wordGap });
  });
  return intervals;
}

/** Total keyed time of a schedule, in milliseconds. */
export function scheduleDurationMs(intervals: readonly MorseInterval[]): number {
  return intervals.reduce((total, interval) => total + interval.ms, 0);
}

/**
 * Read a sender's timings back into a message.
 *
 * The sender's speed is not known in advance and is measured from the timings
 * themselves: the unit is the shortest cluster of ALL the intervals, marks and
 * gaps together. The gaps belong in it because the gap INSIDE a character is
 * one unit too, and that is what a message without a dot has to be read by —
 * `- --- --` is `TOM`, while reading its marks alone takes the dash for the
 * unit and answers `EEE`. The cluster is the mean of the shortest quarter
 * rather than the single shortest interval, so one clipped or one stretched
 * mark cannot set the scale for the whole message.
 *
 * **Standard spacing is what this assumes, and nothing else.** A dash is three
 * units, the gap inside a character one, between characters three, between
 * words seven, and the boundaries are the geometric means of that scale — √3
 * between a dot and a dash, √3 between the gaps inside and between characters,
 * √21 between those and a word gap. Geometric means are what make the
 * classification robust to a hand key's error, because a wrong decision takes
 * an interval to be off by more than a factor of √3 rather than by a fixed
 * margin. A message sent with Farnsworth spacing is therefore read as if its
 * spacing were standard: its marks keep the sender's character speed and land
 * right, while a character gap stretched past √21 units is read as a word gap.
 * Farnsworth decoding is deliberately not here, because timings alone do not
 * say whether a wide gap is a stretch or a slower fist.
 *
 * When nothing in the input measures one unit — single-element characters
 * only, `T`, `T T`, `TTT`, where every mark is three units and every gap is a
 * gap between characters or between words — the unit is a guess drawn from
 * those same timings and `ambiguous` says so. That is the honest answer rather
 * than a lucky one: `...` (S) at one speed and three dashes at a third of it
 * are the same list of durations, and only the caller knows which was sent.
 * `expectedWpm` is what turns the guess into a measurement.
 *
 * A run of marks matching no ITU code decodes to `?` and its code is listed, so
 * a mis-key is visible rather than dropped.
 */
export function decodeMorse(
  intervals: readonly MorseInterval[],
  options: MorseDecodeOptions = {},
): MorseDecodeResult {
  const durations = intervals.map((interval) => interval.ms);
  const expectedWpm = options.expectedWpm;
  const told = typeof expectedWpm === "number" && Number.isFinite(expectedWpm) && expectedWpm > 0;
  const unit = told ? ditMs(expectedWpm) : estimateUnitMs(durations);
  const markThreshold = unit * Math.sqrt(3);
  const letterThreshold = unit * Math.sqrt(3);
  const wordThreshold = unit * Math.sqrt(21);

  const characters: MorseDecodedChar[] = [];
  // A run is walked as marks and thrown away at each character boundary; the
  // unit tables are not consulted until it ends, because a run that is not a
  // letter is still a run and `...-.` has to be able to fail to be one.
  let marks = "";
  let pendingWordGap = false;

  const flush = (): void => {
    if (marks.length === 0) return;
    characters.push({ char: characterForCode(marks), code: marks, wordGap: pendingWordGap });
    marks = "";
    // The flag belongs to the run it was seen before, so it is cleared by the
    // flush and not by the next mark: clearing it on the mark loses the space
    // between two words, because that mark is exactly the run it was set for.
    pendingWordGap = false;
  };

  for (const segment of intervals) {
    if (segment.on) {
      marks += segment.ms > markThreshold ? "-" : ".";
      continue;
    }
    if (marks.length === 0) continue;
    if (segment.ms >= wordThreshold) {
      flush();
      pendingWordGap = true;
    } else if (segment.ms >= letterThreshold) {
      flush();
    }
  }
  flush();

  const text = characters
    .map((character, index) => `${index > 0 && character.wordGap ? " " : ""}${character.char ?? "?"}`)
    .join("");
  return {
    text,
    unitMs: unit,
    wpm: unit > 0 ? PARIS_DIT_MS / unit : 0,
    characters,
    ambiguous: !told && durations.length > 0 && !unitIsMeasured(durations, unit),
  };
}

/**
 * The character a run stands for. A run that is a procedural signal and not a
 * character answers `?`, which is what the reading already is: the run is real
 * and the message cannot be spelled with it.
 */
function characterForCode(code: string): string | null {
  return MORSE_BY_CODE.get(code)?.char ?? null;
}

/**
 * The sender's dit length, in milliseconds, read off the shortest cluster of
 * the input. Zero when the input has no intervals at all.
 *
 * Marks and gaps are pooled on purpose: a character of two or more elements has
 * a one-unit gap between them, so the one-unit scale is in the gaps even when
 * the message has no dot, which is what `TOM` needs and what reading the marks
 * alone gets wrong. The cluster is every interval within √3 of the shortest —
 * √3 being the boundary this decoder itself draws between one unit and three —
 * and its MEAN is the estimate: one clipped interval cannot set the scale for
 * the message, and a message that is mostly dashes cannot drag the scale up
 * either, which a fixed shortest quarter of the pool does — `MMMM` is three
 * one-unit gaps against eleven dashes, and its quarter reads one and a half.
 *
 * A message that measures nothing one unit long lands its estimate on the dash
 * instead — three units — and `unitIsMeasured` is what says so, because the
 * estimate itself cannot tell a dot cluster from a dash cluster.
 */
function estimateUnitMs(durations: readonly number[]): number {
  if (durations.length === 0) return 0;
  let shortest = durations[0] as number;
  for (const ms of durations) if (ms < shortest) shortest = ms;
  const limit = shortest * Math.sqrt(3);
  let sum = 0;
  let count = 0;
  for (const ms of durations) {
    if (ms > limit) continue;
    sum += ms;
    count += 1;
  }
  return count === 0 ? shortest : sum / count;
}

/**
 * How far an interval may sit from a scale and still be that scale: a fifth,
 * which is the error a hand key produces and the jitter a decoder is expected
 * to read.
 */
const SCALE_TOLERANCE = 0.2;

/** True when `ms` is `scale` to within {@link SCALE_TOLERANCE}. */
function atScale(ms: number, scale: number): boolean {
  return Math.abs(ms - scale) <= SCALE_TOLERANCE * scale;
}

/**
 * Whether the input carries a scale to measure the estimate against: an
 * interval three units long — a dash, or the gap between two characters — or
 * one seven units long, the gap between two words.
 *
 * The unit itself is measured by definition, so what this asks is whether a
 * SECOND scale is there. Where one is, the estimate is pinned: `TOM` has no
 * dot, and its dashes and its letter gaps are what say that the one-unit gaps
 * inside `O` and `M` are one unit. Where none is, every interval is the same
 * scale and the reading is a coin toss — `T`, `T T` and `TTT` are dots at a
 * third of the sender's speed, and `E`, `I` and `S` are dashes at three times
 * it.
 */
function unitIsMeasured(durations: readonly number[], unit: number): boolean {
  if (!(unit > 0)) return false;
  return durations.some((ms) => atScale(ms, unit * 3) || atScale(ms, unit * 7));
}
