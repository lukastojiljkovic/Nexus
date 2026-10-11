/**
 * The typing tutor (mini-apps, stage 1): the lessons as data, and the arithmetic
 * that turns a timed session into a score. No clock is read here — the page
 * timestamps the keystrokes.
 *
 * **Where the key positions come from.** The two layouts are transcribed from
 * the keyboard layouts Windows ships, because that is the board the app runs on:
 *
 * - English (US): `KBDUS.DLL` — https://kbdlayout.info/kbdus
 * - Serbian (Latin): `KBDYCL.DLL`, KLID `0000081a` — https://kbdlayout.info/0000081a
 *
 * The Serbian one is the reason this data exists at all: it is QWERTZ, so `z`
 * sits where the US layout puts `y` and `y` takes the US `z` position, and its
 * home row runs `a s d f g h j k l č ć ž` — the five letters with diacritics are
 * one keystroke each, where they are, and a Serbian drill that reached for a
 * dead-key composition would be teaching a different keyboard than the user has.
 *
 * **Why the lesson ids are shared between the two layouts.** A lesson's id is
 * what stage 2 maps to its own copy, and "the index fingers' home keys" is one
 * lesson whatever alphabet it drills; a per-layout prefix would give the strings
 * table two entries saying the same thing.
 *
 * **Why net speed is gross times accuracy.** A word is five characters (see
 * `scoreTypingSession`), so gross counts every keystroke the user made and net
 * counts only the characters that were right: `net = gross x accuracy`. The
 * other convention in circulation charges a whole word per error, which makes a
 * single mistake in a short session cost more than the session could ever earn.
 *
 * **Not here:** shifted characters. Capitals and the symbols above the digits
 * need a modifier concept, and this stage's lessons drill unshifted characters
 * only; a page that wants capitals says so in its own copy until the lesson data
 * grows a shift flag.
 */

export type TypingLayoutId = "en-US" | "sr-Latn";

/** One row of the board: the keys left to right, and where the row starts. */
export interface TypingKeyRow {
  /** 0 the digit row, 1 the upper letter row, 2 the home row, 3 the lower letter row. */
  readonly row: number;
  /** Left edge of the row's first key, in key widths from the board's left edge. */
  readonly column: number;
  /** The unshifted characters of the row, left to right. Every key is one width wide. */
  readonly keys: readonly string[];
}

export interface TypingLayout {
  readonly id: TypingLayoutId;
  readonly rows: readonly TypingKeyRow[];
}

/** A key and the physical position it sits at. */
export interface TypingKey {
  readonly label: string;
  readonly row: number;
  /** Left edge of the key, in key widths from the board's left edge. */
  readonly column: number;
}

/**
 * The two boards. Rows do not share an offset: the digit row starts above the
 * `1`, the upper row is inset by the Tab key, the home row by Caps Lock, and the
 * lower row by Shift — 1.25 of a key on the ISO board the Serbian layout is
 * drawn for, which is what makes room for its `<` key.
 */
export const TYPING_LAYOUTS: Readonly<Record<TypingLayoutId, TypingLayout>> = {
  "en-US": {
    id: "en-US",
    rows: [
      { row: 0, column: 1, keys: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "-", "="] },
      { row: 1, column: 1.5, keys: ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"] },
      { row: 2, column: 1.75, keys: ["a", "s", "d", "f", "g", "h", "j", "k", "l", ";", "'"] },
      { row: 3, column: 2.25, keys: ["z", "x", "c", "v", "b", "n", "m", ",", ".", "/"] },
    ],
  },
  "sr-Latn": {
    id: "sr-Latn",
    rows: [
      { row: 0, column: 1, keys: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "'", "+"] },
      { row: 1, column: 1.5, keys: ["q", "w", "e", "r", "t", "z", "u", "i", "o", "p", "š", "đ"] },
      { row: 2, column: 1.75, keys: ["a", "s", "d", "f", "g", "h", "j", "k", "l", "č", "ć", "ž"] },
      { row: 3, column: 1.25, keys: ["<", "y", "x", "c", "v", "b", "n", "m", ",", ".", "-"] },
    ],
  },
};

/** Every key of a layout, in board order. */
export function layoutKeys(layout: TypingLayoutId): string[] {
  return TYPING_LAYOUTS[layout].rows.flatMap((row) => [...row.keys]);
}

/** One key's position, or `null` when the layout carries no such key. */
export function typingKeyPosition(layout: TypingLayoutId, key: string): TypingKey | null {
  for (const row of TYPING_LAYOUTS[layout].rows) {
    const index = row.keys.indexOf(key);
    if (index >= 0) return { label: key, row: row.row, column: row.column + index };
  }
  return null;
}

export interface TypingLesson {
  /** Stable id, shared between the layouts; stage 2 maps it to its own copy in both locales. */
  readonly id: string;
  /** The keys this lesson introduces, in drill order: the left hand's key, then the right's. */
  readonly keys: readonly string[];
  /** Every key available by the end of this lesson, in the order it was introduced. */
  readonly cumulative: readonly string[];
}

/** The lesson keys, with `cumulative` filled in — the one thing the data below does not state twice. */
function lessons(rows: readonly (readonly [string, readonly string[]])[]): TypingLesson[] {
  const soFar: string[] = [];
  return rows.map(([id, keys]) => {
    soFar.push(...keys);
    return { id, keys, cumulative: [...soFar] };
  });
}

/**
 * The progression, from the home row outwards: the home keys finger by finger
 * from the index to the pinky, then the same fingers' keys on the row above,
 * then below, then the digits in the vertical pairs the fingers already know,
 * then whatever the board has left over. A lesson that pairs two keys takes the
 * left hand's first.
 *
 * The ids name the lesson, not its place in the list, so the two layouts share
 * the twenty-two lessons they have in common and stage 2's copy table holds one
 * entry per lesson rather than one per lesson per layout.
 */
export const TYPING_LESSONS: Readonly<Record<TypingLayoutId, readonly TypingLesson[]>> = {
  "en-US": lessons([
    ["home-index-inner", ["f", "j"]],
    ["home-index-outer", ["g", "h"]],
    ["home-middle", ["d", "k"]],
    ["home-ring", ["s", "l"]],
    ["home-pinky", ["a", ";"]],
    ["home-pinky-reach", ["'"]],
    ["top-index-inner", ["r", "u"]],
    ["top-index-outer", ["t", "y"]],
    ["top-middle", ["e", "i"]],
    ["top-ring", ["w", "o"]],
    ["top-pinky", ["q", "p"]],
    ["bottom-index-inner", ["v", "n"]],
    ["bottom-index-outer", ["b", "m"]],
    ["bottom-middle", ["c", ","]],
    ["bottom-ring", ["x", "."]],
    ["bottom-pinky", ["z", "/"]],
    ["digits-47", ["4", "7"]],
    ["digits-38", ["3", "8"]],
    ["digits-29", ["2", "9"]],
    ["digits-10", ["1", "0"]],
    ["digits-56", ["5", "6"]],
    ["symbols", ["-", "="]],
  ]),
  "sr-Latn": lessons([
    ["home-index-inner", ["f", "j"]],
    ["home-index-outer", ["g", "h"]],
    ["home-middle", ["d", "k"]],
    ["home-ring", ["s", "l"]],
    ["home-pinky", ["a", "č"]],
    ["home-pinky-reach", ["ć"]],
    ["home-pinky-reach-2", ["ž"]],
    ["top-index-inner", ["r", "u"]],
    ["top-index-outer", ["t", "z"]],
    ["top-middle", ["e", "i"]],
    ["top-ring", ["w", "o"]],
    ["top-pinky", ["q", "p"]],
    ["top-pinky-reach", ["š", "đ"]],
    ["bottom-index-inner", ["v", "n"]],
    ["bottom-index-outer", ["b", "m"]],
    ["bottom-middle", ["c", ","]],
    ["bottom-ring", ["x", "."]],
    ["bottom-pinky", ["y", "-"]],
    ["digits-47", ["4", "7"]],
    ["digits-38", ["3", "8"]],
    ["digits-29", ["2", "9"]],
    ["digits-10", ["1", "0"]],
    ["digits-56", ["5", "6"]],
    ["symbols", ["'", "+", "<"]],
  ]),
};

/** How many keys of `errorKeys` `practiseKeys` carries over. */
export const TYPING_PRACTISE_KEYS = 6;

export interface TypingKeystroke {
  /** Milliseconds since the session's clock started. */
  readonly atMs: number;
  /** The character the user typed. */
  readonly typed: string;
}

export interface TypingSession {
  readonly target: string;
  /** The keystrokes in the order they were typed, one per attempted character. */
  readonly keystrokes: readonly TypingKeystroke[];
  /**
   * The session's length, when the page's clock is not the last keystroke's
   * timestamp (a clock that starts on the first key). Defaults to the last
   * keystroke's `atMs`.
   */
  readonly durationMs?: number;
}

export interface TypingKeyErrors {
  /** The key the TARGET asked for — what to practise, not what was typed. */
  readonly key: string;
  readonly count: number;
}

export interface TypingScore {
  readonly targetLength: number;
  /** The keystrokes supplied. */
  readonly typed: number;
  readonly correct: number;
  readonly errors: number;
  /** `correct / typed`, or 1 for a session that has not started. */
  readonly accuracy: number;
  readonly durationSeconds: number;
  readonly grossWpm: number;
  readonly netWpm: number;
  /** Keys with at least one wrong keystroke, most often missed first. */
  readonly errorKeys: readonly TypingKeyErrors[];
  /** The worst `TYPING_PRACTISE_KEYS` of `errorKeys`, or empty after a clean run. */
  readonly practiseKeys: readonly string[];
}

/** Single characters, so the tie-break between two equally missed keys reads in Serbian order. */
const KEY_COLLATOR = new Intl.Collator(["sr-Latn", "sr"]);

/**
 * A session's score, from the target text and the timed keystrokes.
 *
 * **The word convention.** A word counts as five characters, the standard for
 * text entry — "each word is often standardized to be five characters or
 * keystrokes long in English, including spaces and punctuation"
 * (https://en.wikipedia.org/wiki/Words_per_minute). So gross speed is
 * `(typed / 5) / minutes` and net speed is `(correct / 5) / minutes`, which is
 * gross multiplied by accuracy.
 *
 * **What is measured.** Keystroke `i` answers the target's character at `i`: a
 * session that never mentions the target cannot be scored against it, and a
 * backspace is the page's own business — it feeds the accepted keystrokes only.
 * Strokes past the end of the target count as errors with no key to blame, since
 * no character was asked for there. Nothing is rounded: the page's own formatter
 * decides how many decimals a WPM figure shows.
 */
export function scoreTypingSession(session: TypingSession): TypingScore {
  // Code points, not UTF-16 units: one character of the target is one keystroke.
  const target = [...session.target];
  const keystrokes = session.keystrokes;
  const counts = new Map<string, number>();
  let correct = 0;
  let errors = 0;

  keystrokes.forEach((stroke, index) => {
    if (!Number.isFinite(stroke.atMs) || stroke.atMs < 0) {
      throw new RangeError("keystroke times run forward from zero");
    }
    const previous = keystrokes[index - 1];
    if (previous !== undefined && stroke.atMs < previous.atMs) {
      throw new RangeError("keystroke times run forward from zero");
    }
    const expected = target[index];
    if (expected === undefined) {
      errors += 1;
      return;
    }
    if (stroke.typed === expected) {
      correct += 1;
      return;
    }
    errors += 1;
    counts.set(expected, (counts.get(expected) ?? 0) + 1);
  });

  const typed = keystrokes.length;
  const lastAtMs = typed === 0 ? 0 : (keystrokes[typed - 1] as TypingKeystroke).atMs;
  const durationMs = session.durationMs ?? lastAtMs;
  if (!Number.isFinite(durationMs) || durationMs < 0 || durationMs < lastAtMs) {
    throw new RangeError("a session cannot be shorter than its last keystroke");
  }
  const minutes = durationMs / 1000 / 60;

  const errorKeys: TypingKeyErrors[] = [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((left, right) => right.count - left.count || KEY_COLLATOR.compare(left.key, right.key));

  return {
    targetLength: target.length,
    typed,
    correct,
    errors,
    accuracy: typed === 0 ? 1 : correct / typed,
    durationSeconds: durationMs / 1000,
    grossWpm: minutes === 0 ? 0 : typed / 5 / minutes,
    netWpm: minutes === 0 ? 0 : correct / 5 / minutes,
    errorKeys,
    practiseKeys: errorKeys.slice(0, TYPING_PRACTISE_KEYS).map((entry) => entry.key),
  };
}
