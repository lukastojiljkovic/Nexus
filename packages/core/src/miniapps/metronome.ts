/**
 * The metronome's beat schedule, its tempo trainer and tap tempo (mini-apps,
 * stage 1). Pure arithmetic: no clock, no audio, no IO — stage 2 hands in the
 * window its Web Audio look-ahead loop wants and schedules what comes back.
 *
 * **The one thing a reader must not have to rediscover** is how a window is
 * decided. `beatSchedule` answers with every click of the grid that falls in
 * `[from, to)`, and the loop that calls it asks for adjacent windows over and
 * over, so the two must join without a gap and without a repeat. Comparing
 * floats at the window edge would not survive that: `start + k * interval` is a
 * double, and the same grid position reached from the upper window's `from` and
 * from the lower window's `to` is the same double only by luck. So membership
 * is decided in INDEX space — `ceil((from - start) / interval)` and
 * `ceil((to - start) / interval)` bound the k's the window owns — and the times
 * are only computed afterwards. Two adjacent windows share the same boundary
 * expression, so a k belongs to exactly one of them, always; the tests assert
 * the join itself rather than the arithmetic behind it.
 *
 * Time is SECONDS throughout, to match `AudioContext.currentTime` and the
 * timings the schedule is played on. Tap tempo takes the same clock.
 *
 * The note value (`2`, `4`, `8`, `16`) names the unit the BPM counts — quarter
 * notes in 4/4, eighth notes in 6/8 — and does not change any interval: the
 * beat IS that unit, and a beat is `60 / bpm` seconds wide whatever the
 * signature calls it. It is carried in the spec because the page labels the
 * signature with it and because stage 2's IPC layer must validate it.
 */

/** The tempo range a metronome can be set to, in beats per minute. */
export const METRONOME_MIN_BPM = 20;
export const METRONOME_MAX_BPM = 400;

/** A bar holds one to sixteen beats. */
export const METRONOME_MIN_BEATS_PER_BAR = 1;
export const METRONOME_MAX_BEATS_PER_BAR = 16;

/** The note values a time signature may name. */
export const METRONOME_NOTE_VALUES = [2, 4, 8, 16] as const;

/** A beat may be split into at most four equal parts. */
export const METRONOME_MAX_SUBDIVISIONS = 4;

/** A pause longer than this many seconds ends a tap-tempo reading and starts a new one. */
export const TAP_RESET_SECONDS = 2;

export type NoteValue = (typeof METRONOME_NOTE_VALUES)[number];

/** `strong` is the accented beat, `weak` a plain one, and `off` a beat played silently. */
export type BeatAccent = "strong" | "weak" | "off";

export interface MetronomeSpec {
  /** Time of the first beat, on the caller's clock (seconds). */
  readonly startSeconds: number;
  /** Tempo of the beat unit, 20–400. */
  readonly bpm: number;
  /** Beats in a bar, 1–16. */
  readonly beatsPerBar: number;
  /** The unit the BPM counts; a display fact, see the header. */
  readonly noteValue: NoteValue;
  /** One accent per beat, in bar order. */
  readonly accents: readonly BeatAccent[];
  /** Clicks per beat, 1–4. `1` is a click on the beat and nothing between. */
  readonly subdivisions: number;
}

export interface MetronomeClick {
  readonly timeSeconds: number;
  /** 1-based bar number. */
  readonly bar: number;
  /** 1-based beat within the bar. */
  readonly beat: number;
  /** `0` on the beat, `1..subdivisions-1` between beats. */
  readonly subdivision: number;
  /** The accent of the beat this click belongs to. */
  readonly accent: BeatAccent;
  /** True for the click that lands on the beat itself. */
  readonly onBeat: boolean;
}

/** Rejects a spec no metronome page can produce; stage 2's IPC layer relies on this. */
function assertSpec(spec: MetronomeSpec): void {
  const { bpm, beatsPerBar, noteValue, accents, subdivisions } = spec;
  if (!Number.isFinite(bpm) || bpm < METRONOME_MIN_BPM || bpm > METRONOME_MAX_BPM) {
    throw new RangeError(`bpm must be ${METRONOME_MIN_BPM}–${METRONOME_MAX_BPM}`);
  }
  if (!Number.isInteger(beatsPerBar) || beatsPerBar < METRONOME_MIN_BEATS_PER_BAR) {
    throw new RangeError(`beatsPerBar must be at least ${METRONOME_MIN_BEATS_PER_BAR}`);
  }
  if (beatsPerBar > METRONOME_MAX_BEATS_PER_BAR) {
    throw new RangeError(`beatsPerBar must be at most ${METRONOME_MAX_BEATS_PER_BAR}`);
  }
  if (!METRONOME_NOTE_VALUES.includes(noteValue)) {
    throw new RangeError(`noteValue must be one of ${METRONOME_NOTE_VALUES.join(", ")}`);
  }
  if (accents.length !== beatsPerBar) {
    throw new RangeError("accents must hold one entry per beat");
  }
  if (!Number.isInteger(subdivisions) || subdivisions < 1) {
    throw new RangeError("subdivisions must be at least 1");
  }
  if (subdivisions > METRONOME_MAX_SUBDIVISIONS) {
    throw new RangeError(`subdivisions must be at most ${METRONOME_MAX_SUBDIVISIONS}`);
  }
  if (!Number.isFinite(spec.startSeconds)) {
    throw new RangeError("startSeconds must be a finite number");
  }
}

/**
 * Every click the metronome plays in `[fromSeconds, toSeconds)`, in time order.
 *
 * A muted beat (`off`) emits nothing at all — neither the beat nor its
 * subdivisions — which is what makes muting useful: the user plays those
 * themselves. A subdivision click carries the accent of its beat and
 * `onBeat: false`, so a caller can give it the lighter gain without a second
 * table to keep in step with this one.
 */
export function beatSchedule(
  spec: MetronomeSpec,
  fromSeconds: number,
  toSeconds: number,
): MetronomeClick[] {
  assertSpec(spec);

  const { startSeconds, bpm, beatsPerBar, accents, subdivisions } = spec;
  const interval = 60 / (bpm * subdivisions);
  const perBar = beatsPerBar * subdivisions;

  // Membership in index space, so the boundary belongs to exactly one of two
  // adjacent windows whatever the interval's binary expansion does.
  const firstIndex = Math.max(0, Math.ceil((fromSeconds - startSeconds) / interval));
  const endIndex = Math.max(0, Math.ceil((toSeconds - startSeconds) / interval));

  const clicks: MetronomeClick[] = [];
  for (let index = firstIndex; index < endIndex; index += 1) {
    const position = index % perBar;
    const beat = Math.floor(position / subdivisions) + 1;
    const accent = accents[beat - 1] as BeatAccent;
    if (accent === "off") continue;
    clicks.push({
      timeSeconds: startSeconds + index * interval,
      bar: Math.floor(index / perBar) + 1,
      beat,
      subdivision: position % subdivisions,
      accent,
      onBeat: position % subdivisions === 0,
    });
  }
  return clicks;
}

export interface TempoTrainerSpec {
  readonly startBpm: number;
  readonly endBpm: number;
  /** How much the tempo moves each step, at least 1 BPM. */
  readonly step: number;
  /** Bars held at each tempo. */
  readonly barsPerStep: number;
}

export interface TempoTrainerStep {
  readonly bpm: number;
  /** 0-based bar this tempo starts on. */
  readonly fromBar: number;
  readonly bars: number;
}

export interface TempoTrainerPlan {
  readonly steps: readonly TempoTrainerStep[];
  readonly totalBars: number;
}

/**
 * The tempo trainer's steps: the tempo is held for `barsPerStep` bars, then
 * moves by `step` towards the target. A distance that is not a multiple of the
 * step is closed by a SHORTER last step rather than an overshoot, so the plan
 * always ends exactly on `endBpm` — a trainer that told the user to reach 110
 * BPM and then asked for 120 has not trained what it promised.
 */
export function tempoTrainerPlan(spec: TempoTrainerSpec): TempoTrainerPlan {
  const { startBpm, endBpm, step, barsPerStep } = spec;
  const inRange = (bpm: number) =>
    Number.isFinite(bpm) && bpm >= METRONOME_MIN_BPM && bpm <= METRONOME_MAX_BPM;
  if (!inRange(startBpm) || !inRange(endBpm)) {
    throw new RangeError(`tempos must be ${METRONOME_MIN_BPM}–${METRONOME_MAX_BPM}`);
  }
  if (!Number.isFinite(step) || step < 1) throw new RangeError("step must be at least 1");
  if (!Number.isInteger(barsPerStep) || barsPerStep < 1) {
    throw new RangeError("barsPerStep must be at least 1");
  }

  const direction = Math.sign(endBpm - startBpm);
  const tempos = [startBpm];
  while (tempos[tempos.length - 1] !== endBpm) {
    const current = tempos[tempos.length - 1] as number;
    const next = direction > 0 ? Math.min(current + step, endBpm) : Math.max(current - step, endBpm);
    tempos.push(next);
  }

  return {
    steps: tempos.map((bpm, index) => ({ bpm, fromBar: index * barsPerStep, bars: barsPerStep })),
    totalBars: tempos.length * barsPerStep,
  };
}

export interface TapTempoResult {
  /** BPM from the median interval, or `null` before a second tap exists. */
  readonly bpm: number | null;
  /** The median interval the BPM came from, in seconds. */
  readonly intervalSeconds: number | null;
  /** Taps in the run that produced the reading; earlier taps are dropped. */
  readonly taps: number;
  /** Intervals the median was taken over (`taps - 1`), zero when there is none. */
  readonly intervals: number;
  /** False when no reading exists, or it falls outside the metronome's range. */
  readonly withinMetronomeRange: boolean;
}

/** The middle value, averaging the two middles for an even count. */
function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] as number;
  return ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

/**
 * BPM from the timestamps of the user's taps, in seconds.
 *
 * The MEDIAN of the intervals, not their mean: a tap that lands 40 ms late must
 * not move the tempo half as much as one that lands 40 ms early, and the median
 * of an odd count ignores a single outlier outright. A pause longer than
 * `TAP_RESET_SECONDS` starts a new reading and drops everything before it — a
 * tap tempo that averaged across a thinking pause would report a tempo nobody
 * tapped.
 *
 * Timestamps must strictly increase; two taps on one clock reading are a
 * programming error, not a tempo of infinity.
 */
export function tapTempo(
  taps: readonly number[],
  resetSeconds = TAP_RESET_SECONDS,
): TapTempoResult {
  const none: TapTempoResult = {
    bpm: null,
    intervalSeconds: null,
    taps: 0,
    intervals: 0,
    withinMetronomeRange: false,
  };
  if (taps.length === 0) return none;

  // Keep only the trailing run: the last index that follows a reset.
  let runStart = 0;
  for (let index = 1; index < taps.length; index += 1) {
    const gap = (taps[index] as number) - (taps[index - 1] as number);
    if (gap <= 0) throw new RangeError("tap timestamps must strictly increase");
    if (gap > resetSeconds) runStart = index;
  }
  const run = taps.slice(runStart);
  if (run.length < 2) return { ...none, taps: run.length };

  const intervals = run.slice(1).map((tap, index) => tap - (run[index] as number));
  const intervalSeconds = median(intervals);
  const bpm = 60 / intervalSeconds;
  return {
    bpm,
    intervalSeconds,
    taps: run.length,
    intervals: intervals.length,
    withinMetronomeRange: bpm >= METRONOME_MIN_BPM && bpm <= METRONOME_MAX_BPM,
  };
}
