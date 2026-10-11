import type { MorseInterval } from "@nexus/core";

/**
 * The keyer: a stream of microphone LEVEL READINGS in, the sender's keyed
 * intervals out — the half of Morse decoding that the engine deliberately does
 * not do.
 *
 * **Why the engine stops where it does.** `decodeMorse` reads a list of
 * intervals; producing that list from a room is a different problem, and it is
 * this module's. The reading the keyer eats is the envelope of the signal — how
 * loud the microphone was at one instant — and not raw samples, because a key's
 * durations have to be measured in TIME: samples arrive in overlapping windows
 * and counting them would count the overlap twice, while the instant a reading
 * was taken is exact whatever window it came from. `microphone.ts` is what turns
 * samples into readings, at a resolution the shortest dit of the highest speed
 * this module offers (60 WPM is a 20 ms dit) can survive.
 *
 * **The state machine is hysteresis, and the margins are this module's own
 * choices.** A mark opens when the level rises {@link OPEN_MARGIN_DB} above the
 * tracked floor and closes only when it falls back to {@link CLOSE_MARGIN_DB}
 * above it, so one noisy reading cannot break a dash in two. The floor is the
 * quietest level seen lately, tracking downward at once and upward by
 * {@link FLOOR_RISE_DB_PER_SECOND}, which is what lets a session that began in
 * a noisy room still find the key later, and what stops a long mark from
 * raising the floor under itself.
 *
 * **A blip shorter than {@link MIN_INTERVAL_MS} did not happen.** A hand key's
 * contact bounce and a room's click both produce runs of a few milliseconds that
 * are not signalling, so a run shorter than that length is merged into the
 * interval around it — never dropped, because dropping one would shift every
 * following duration by its length. At the engine's own `MAX_WPM` a dit is
 * 20 ms, so the threshold is half the shortest interval the alphabet can carry.
 *
 * The class holds its own state across calls on purpose: a reading is pushed as
 * it arrives, and a sender's message is decoded from `intervals()` at any moment
 * — which is what makes the reading on screen live rather than arriving at the
 * end of a sentence.
 */

/** One envelope reading: how loud the microphone was, and the instant it was read at. */
export interface LevelReading {
  readonly levelDb: number;
  /** Wall-clock milliseconds (`performance.now()`), monotonic within one session. */
  readonly atMs: number;
}

/** How far above the tracked floor a mark has to rise before the key is down. */
export const OPEN_MARGIN_DB = 12;
/** How far above the floor it has to fall before the key is up again — the hysteresis half. */
export const CLOSE_MARGIN_DB = 6;
/** A run shorter than this is contact bounce or a room's click, not signalling. */
export const MIN_INTERVAL_MS = 10;
/** How fast the tracked floor may rise, in dB per second, so a session that opened in noise can still recover. */
export const FLOOR_RISE_DB_PER_SECOND = 6;
/** The floor never rises above this: a level this loud is a mark, not a room. */
export const FLOOR_CEILING_DB = -20;

export class MorseKeyer {
  /** The quietest level seen lately — see this file's header for the tracking rule. */
  #floorDb = Number.POSITIVE_INFINITY;
  #lastAtMs: number | null = null;
  #open = false;
  /** When the current run began, or null while nothing has been keyed yet. */
  #runStartedAtMs: number | null = null;
  /** The raw runs, in order, alternating `on` and `off`. */
  #runs: MorseInterval[] = [];
  /** The merged view of `#runs`, rebuilt as runs arrive. */
  #intervals: MorseInterval[] = [];

  /** Whether the key is down at this instant — what a live indicator draws. */
  get keying(): boolean {
    return this.#open;
  }

  /** The sender's intervals so far, blips merged — what `decodeMorse` is handed. */
  intervals(): readonly MorseInterval[] {
    return this.#intervals;
  }

  /**
   * Feeds one reading and answers with whatever this reading COMPLETED (usually
   * nothing, one interval at a transition). The answer is a convenience for a
   * caller that wants to react at the moment of a change; `intervals()` is the
   * accumulated message.
   */
  push(reading: LevelReading): readonly MorseInterval[] {
    const level = reading.levelDb;
    const completed: MorseInterval[] = [];
    if (this.#lastAtMs === null) {
      this.#floorDb = level;
      this.#lastAtMs = reading.atMs;
      this.#open = false;
      return completed;
    }
    if (!Number.isFinite(level)) {
      // A frame the engine could not measure (digital silence reports the
      // module's floor as a finite number, so this is a NaN from elsewhere)
      // leaves the state exactly as it was rather than inventing a transition.
      this.#lastAtMs = reading.atMs;
      return completed;
    }
    const elapsedSeconds = Math.max(0, (reading.atMs - this.#lastAtMs) / 1000);
    this.#lastAtMs = reading.atMs;
    this.#floorDb = Math.min(
      FLOOR_CEILING_DB,
      level < this.#floorDb
        ? level
        : Math.min(level, this.#floorDb + FLOOR_RISE_DB_PER_SECOND * elapsedSeconds),
    );

    // Hysteresis, one question asked per state: while the key is DOWN the level
    // has to fall to the CLOSE margin to lift it, and while it is UP it has to
    // rise to the OPEN margin to press it. The two margins are what keep one
    // noisy reading from ending a mark or starting one.
    const stillDown = level > this.#floorDb + CLOSE_MARGIN_DB;
    const pressable = level > this.#floorDb + OPEN_MARGIN_DB;
    const unchanged = this.#open ? stillDown : !pressable;
    if (unchanged) return completed;
    if (this.#runStartedAtMs === null) {
      // The first mark of the message: the silence before it is not part of the
      // message, so nothing is emitted for it.
      this.#open = true;
      this.#runStartedAtMs = reading.atMs;
      return completed;
    }
    const run: MorseInterval = {
      on: this.#open,
      ms: reading.atMs - this.#runStartedAtMs,
    };
    this.#open = !this.#open;
    this.#runStartedAtMs = reading.atMs;
    this.#runs.push(run);
    this.#intervals = mergeBlips(this.#runs);
    completed.push(run);
    return completed;
  }

  /** Forgets everything: the next reading starts a new message. */
  reset(): void {
    this.#floorDb = Number.POSITIVE_INFINITY;
    this.#lastAtMs = null;
    this.#open = false;
    this.#runStartedAtMs = null;
    this.#runs = [];
    this.#intervals = [];
  }
}

/**
 * Merges runs shorter than {@link MIN_INTERVAL_MS} into the interval around them.
 *
 * Two rules, and both are needed to keep the list a run of alternating states:
 * a too-short run is absorbed by its predecessor, and a run that now matches its
 * predecessor's state is folded into it. Absorbing without folding is what would
 * leave two `off` intervals side by side, which is a shape `decodeMorse` reads as
 * a longer gap only by luck.
 */
function mergeBlips(runs: readonly MorseInterval[]): MorseInterval[] {
  const merged: MorseInterval[] = [];
  for (const run of runs) {
    const last = merged[merged.length - 1];
    if (last === undefined) {
      if (run.ms >= MIN_INTERVAL_MS) merged.push({ on: run.on, ms: run.ms });
      continue;
    }
    if (last.on === run.on || run.ms < MIN_INTERVAL_MS) {
      merged[merged.length - 1] = { on: last.on, ms: last.ms + run.ms };
      continue;
    }
    merged.push({ on: run.on, ms: run.ms });
  }
  return merged;
}

/**
 * How much of what was heard looks like Morse: the share of the MARKS whose
 * length is the sender's dit or three of them, within a fifth.
 *
 * **Why this is the module's own measure rather than the engine's.** The engine
 * reports one confidence-shaped fact — `ambiguous`, whether anything in the input
 * measured a unit — and that is a boolean: it says the reading is a guess, not
 * how good the guess is. A screen that showed only that would have nothing to
 * draw while a sender's fist was drifting. This is the arithmetic of the decoder
 * itself turned into a share: a mark is either one unit or three (ITU-R
 * M.1677-1 §2), the decoder's boundary is the geometric mean of that scale — √3,
 * which is a factor of 1.73 — and a fifth is the error the engine's own
 * `SCALE_TOLERANCE` calls the jitter a hand key produces. A clean message answers
 * 1; a fist that is drifting answers less, and never the other way round.
 *
 * `null` when there is nothing to judge: no marks, or no unit to judge them
 * against.
 */
export function morseConfidence(
  intervals: readonly MorseInterval[],
  unitMs: number,
): number | null {
  if (!(unitMs > 0)) return null;
  const marks = intervals.filter((interval) => interval.on);
  if (marks.length === 0) return null;
  const tolerance = 0.2;
  const near = (ms: number, scale: number): boolean =>
    Math.abs(ms - scale) <= tolerance * scale;
  let inScale = 0;
  for (const mark of marks) {
    if (near(mark.ms, unitMs) || near(mark.ms, unitMs * 3)) inScale += 1;
  }
  return inScale / marks.length;
}
