import {
  DEFAULT_CLARITY,
  DEFAULT_LEVEL_GATE_DB,
  LeqWindow,
  centsBetween,
  detectPitch,
  frameLevel,
  noteForFrequency,
  type FrameLevel,
  type PitchReading,
  type TuningTarget,
} from "@nexus/core";

/**
 * The page's analysis, as pure functions over one frame of audio.
 *
 * **This file is the worker's whole body, and the fallback's too.** `analyze`
 * below is the same code the worker runs (`analysis.worker.ts` is a `postMessage`
 * around `AnalysisEngine.run`) and the same code the page runs when a worker
 * cannot be constructed, which is the one thing that makes the two paths
 * impossible to drift: there is one implementation, and the worker is a transport
 * for it rather than a second one.
 *
 * **Why the tuner is the job worth a worker.** `detectPitch` is YIN: for a 4096
 * sample frame at 48 kHz it walks 1200 lags over 2048 samples, about 2.4 million
 * multiply-accumulates per frame — a few milliseconds, ten times a second, on a
 * thread that also has to keep a keyboard responsive. The meter's arithmetic
 * (`frameLevel`) is two passes over the frame and the Morse keyer's is a handful
 * of comparisons per reading, and both stay where they are cheap.
 */

/** What the tuner's tab draws: a pitch (when there is one) and the note it is nearest at the current reference. */
export interface TunerReading {
  readonly frequencyHz: number | null;
  /** YIN's periodicity: 1 is perfectly periodic. */
  readonly clarity: number;
  readonly levelDb: number;
  /** True when the frame was too quiet to judge at all — the level gate refused it. */
  readonly gated: boolean;
  /** The nearest note at this reference, or null when nothing was pitched. */
  readonly note: PitchReading | null;
}

/**
 * One frame as a note.
 *
 * The gate and the clarity threshold are the engine's own defaults (`–60 dBFS`
 * and `0.9`, the algorithm's published absolute threshold written as
 * `1 − d′`), and they are passed explicitly rather than left out so that a
 * caller could move them: a bass's low E in a quiet room is right at the gate.
 * The reading comes back WITH the refusal — a gated frame still carries its
 * level, and a frame that is periodic but below the caller's clarity still
 * carries its clarity — so a needle can fade rather than blink.
 */
export function readTuner(
  samples: Float32Array,
  sampleRate: number,
  a4Hz: number,
): TunerReading {
  const detection = detectPitch(samples, {
    sampleRate,
    clarityThreshold: DEFAULT_CLARITY,
    levelGateDb: DEFAULT_LEVEL_GATE_DB,
  });
  return {
    frequencyHz: detection.frequencyHz,
    clarity: detection.clarity,
    levelDb: detection.levelDb,
    gated: detection.gated,
    note:
      detection.frequencyHz === null ? null : noteForFrequency(detection.frequencyHz, a4Hz),
  };
}

/** One frame's level, plus the equivalent level of everything since the measurement began. */
export interface MeterReading extends FrameLevel {
  /** `LeqWindow`'s answer for this measurement — the energy average, not an average of dB values. */
  readonly leqDb: number;
}

/**
 * One frame's level numbers, without the running window: `frameLevel` under this
 * module's name, so the page has one import for the two readings it draws.
 */
export function readMeter(samples: Float32Array): FrameLevel {
  return frameLevel(samples);
}

/** The string of a preset a frequency is nearest, and how far off it is in cents. */
export interface NearestTarget {
  readonly target: TuningTarget;
  /** Signed cents from the string, the same unit `PitchReading.centsOff` is in. */
  readonly cents: number;
}

/**
 * Which string of a preset a frequency is nearest, measured in CENTS.
 *
 * In cents rather than in hertz, because cents are the musical distance and the
 * only one a tuner can honestly highlight: the guitar's low E is 82.41 Hz and the
 * string above it is 110, a hertz distance of 27.6, while the high B is 246.94
 * against the E above it at 329.63, a hertz distance of 82.7 — and the two are a
 * fourth and a fourth. A hertz-nearest rule would put a note between the bass
 * strings on the wrong string and would do it more often the further the tuner is
 * from the low end. `centsBetween` is the engine's own ratio function.
 *
 * `null` for a frequency no string can be compared with (a non-positive or
 * non-finite reading) or for a preset with no strings, rather than a guess.
 */
export function nearestTarget(
  frequencyHz: number,
  targets: readonly TuningTarget[],
): NearestTarget | null {
  let best: NearestTarget | null = null;
  for (const target of targets) {
    const cents = centsBetween(frequencyHz, target.frequencyHz);
    if (cents === null) continue;
    if (best === null || Math.abs(cents) < Math.abs(best.cents)) best = { target, cents };
  }
  return best;
}

/** One job: a frame to read, or the start of a new measurement. */
export type AnalysisJob =
  | {
      readonly kind: "tuner";
      readonly id: number;
      readonly sampleRate: number;
      readonly a4Hz: number;
      readonly samples: Float32Array;
    }
  | {
      readonly kind: "meter";
      readonly id: number;
      readonly samples: Float32Array;
      /** True on the first frame of a measurement: the Leq window starts again. */
      readonly fresh: boolean;
    };

/** What one job answers. `id` is the caller's, handed straight back so replies can be matched to requests. */
export type AnalysisReply =
  | { readonly kind: "tuner"; readonly id: number; readonly reading: TunerReading }
  | { readonly kind: "meter"; readonly id: number; readonly reading: MeterReading };

/**
 * The stateful half: one `LeqWindow`, and one `run` that reads a job against it.
 *
 * The worker constructs one of these and keeps it, which is what makes the
 * equivalent level accumulate across frames; the page's fallback path keeps its
 * own, so the two transports behave identically. Nothing else here holds state —
 * the tuner's reading is of one frame and nothing else.
 */
export class AnalysisEngine {
  #leq = new LeqWindow();

  run(job: AnalysisJob): AnalysisReply {
    if (job.kind === "tuner") {
      return {
        kind: "tuner",
        id: job.id,
        reading: readTuner(job.samples, job.sampleRate, job.a4Hz),
      };
    }
    if (job.fresh) this.#leq.reset();
    this.#leq.addFrame(job.samples);
    return {
      kind: "meter",
      id: job.id,
      reading: { ...readMeter(job.samples), leqDb: this.#leq.leqDb },
    };
  }
}
