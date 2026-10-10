import { numberFormat } from "../../../renderer/src/intl.js";

/**
 * CHESS' clock arithmetic, as pure functions (ADR-090).
 *
 * **Why the clocks live here rather than in a database.** A clock is a live fact
 * about a game being played, and the profile stores what the user AUTHORED: the
 * control the game was played at (`chess_games.time_control`, `chess_resume.
 * time_control`) and nothing about how much of it has run down. So the two
 * remaining figures are the page's own, measured in deltas against a monotonic
 * reading the component supplies — the same rule TOOls' stopwatch follows one
 * module over, and for the same reason: a clock that counted ticks would be
 * wrong the moment the window is hidden, which is when a player is most likely
 * to be thinking.
 *
 * **A time control is `base+increment` seconds and nothing else** — `"600+5"`,
 * `"180+2"`, `"60+0"` — which is the shape the store holds and the one every
 * chess site writes. The presets below are the common ones; a person who wants
 * 25 minutes gets the custom fields, and both roads end in the same string.
 */

/** A parsed time control: seconds on each clock to begin with, and seconds added after every move. */
export interface TimeControl {
  readonly baseSeconds: number;
  readonly incrementSeconds: number;
}

/**
 * The controls a person is most likely to want, as text, in the order they are
 * offered. Bullet through classical, which is the span the common sites use; the
 * custom fields are the answer for anything else.
 */
export const COMMON_TIME_CONTROLS: readonly string[] = [
  "60+0",
  "180+0",
  "180+2",
  "300+0",
  "600+0",
  "600+5",
  "900+10",
  "1800+0",
];

/** The two bounds the store enforces, so a custom control is refused by the form before it reaches a row. */
export const MAX_CLOCK_BASE_SECONDS = 7_200;
export const MAX_CLOCK_INCREMENT_SECONDS = 300;

/** `"600+5"` as its two numbers, or `null` for anything else — including a control outside the store's own bounds. */
export function parseTimeControl(text: string): TimeControl | null {
  const match = /^([1-9]\d{0,3})\+(\d{1,3})$/.exec(text);
  if (match === null) return null;
  const baseSeconds = Number(match[1]);
  const incrementSeconds = Number(match[2]);
  if (baseSeconds > MAX_CLOCK_BASE_SECONDS || incrementSeconds > MAX_CLOCK_INCREMENT_SECONDS) {
    return null;
  }
  return { baseSeconds, incrementSeconds };
}

/** The control a custom form spells, or `null` when either field does not describe one the store would hold. */
export function customTimeControl(baseSeconds: number, incrementSeconds: number): string | null {
  const control = `${baseSeconds}+${incrementSeconds}`;
  return parseTimeControl(control) === null ? null : control;
}

/**
 * A span of seconds in words, through `Intl` in the active language: „3 min",
 * „90 sek", „1 min 30 sek". Whole minutes whenever the span is a whole number of
 * them, because that is how clocks are spoken about.
 */
export function clockWords(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (rest === 0 && minutes > 0) return numberFormat({ style: "unit", unit: "minute" }).format(minutes);
  if (minutes === 0) return numberFormat({ style: "unit", unit: "second" }).format(rest);
  const head = numberFormat({ style: "unit", unit: "minute" }).format(minutes);
  const tail = numberFormat({ style: "unit", unit: "second" }).format(rest);
  return `${head} ${tail}`;
}

/**
 * A time control as a person reads it: „10 min", „5 min + 5 sek".
 *
 * Unreadable text answers itself, so a row carrying something this build does
 * not know still shows the user what it does know — the string the store holds.
 */
export function timeControlWords(text: string): string {
  const control = parseTimeControl(text);
  if (control === null) return text;
  const base = clockWords(control.baseSeconds);
  if (control.incrementSeconds === 0) return base;
  const increment = numberFormat({ style: "unit", unit: "second" }).format(
    control.incrementSeconds,
  );
  return `${base} + ${increment}`;
}

/** One clock reading as `mm:ss`, or `h:mm:ss` past an hour — the shape a clock is read in. */
export function formatRemaining(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  const tail = `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
  return hours > 0 ? `${String(hours)}:${tail}` : tail;
}

/** Both clocks, in milliseconds, and the instant the running one was last measured at. */
export interface ClockState {
  readonly whiteMs: number;
  readonly blackMs: number;
  /** The monotonic reading the last tick was taken at, or null while nothing runs. */
  readonly measuredAt: number | null;
}

/** Two clocks wound to a control's base time, stopped. */
export function startClock(control: TimeControl, measuredAt: number | null = null): ClockState {
  const ms = control.baseSeconds * 1000;
  return { whiteMs: ms, blackMs: ms, measuredAt };
}

/**
 * Lets the clock of the side to move run from `measuredAt` to `nowMs`.
 *
 * `measuredAt` is null while the clock is stopped (a game being reviewed, a
 * game that is over, a pause before the first move), so a tick with nothing to
 * measure answers the state unchanged rather than inventing a start instant.
 * A clock never runs below zero: the flag falls at zero, and a negative reading
 * would be time the player does not owe.
 */
export function tickClock(
  state: ClockState,
  side: "w" | "b",
  nowMs: number,
): ClockState {
  if (state.measuredAt === null) return state;
  const elapsed = Math.max(0, nowMs - state.measuredAt);
  if (elapsed === 0) return state;
  const remaining = Math.max(0, (side === "w" ? state.whiteMs : state.blackMs) - elapsed);
  return side === "w"
    ? { whiteMs: remaining, blackMs: state.blackMs, measuredAt: nowMs }
    : { whiteMs: state.whiteMs, blackMs: remaining, measuredAt: nowMs };
}

/**
 * Hands the turn to the other side: the side that just moved gets its seconds
 * added, and the clock starts measuring for the side about to move.
 *
 * The increment lands on the mover, which is what „Fischer increment" means —
 * and `measuredAt` moves with it, so the seconds spent thinking are not charged
 * to the opponent as well.
 */
export function passClock(
  state: ClockState,
  moved: "w" | "b",
  control: TimeControl,
  nowMs: number,
): ClockState {
  const gained =
    (moved === "w" ? state.whiteMs : state.blackMs) + control.incrementSeconds * 1000;
  return moved === "w"
    ? { whiteMs: gained, blackMs: state.blackMs, measuredAt: nowMs }
    : { whiteMs: state.whiteMs, blackMs: gained, measuredAt: nowMs };
}

/** Which clock has run out, or `null` while both stand. Both at zero is not a state a game reaches. */
export function flaggedSide(state: ClockState): "w" | "b" | null {
  if (state.whiteMs <= 0) return "w";
  if (state.blackMs <= 0) return "b";
  return null;
}

/**
 * Stops both clocks where they stand — a game that is over, or a board showing a
 * position nobody is playing.
 *
 * The readings are KEPT rather than zeroed: „bela je ostala bez vremena" is a
 * fact about the game the user just watched, and a clock that reset to its own
 * start would erase the answer to „how did that end".
 */
export function stopClock(state: ClockState): ClockState {
  return state.measuredAt === null ? state : { ...state, measuredAt: null };
}
