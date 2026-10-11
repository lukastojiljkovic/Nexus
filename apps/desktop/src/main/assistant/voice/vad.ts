/**
 * Knowing when the user stopped talking.
 *
 * Hands-free mode has one question to answer, over and over and in real time:
 * is this frame of microphone audio speech or room? Everything else in the
 * voice path can wait for an answer; this cannot, because a detector that
 * notices the end of an utterance a second late is a second of silence the user
 * spends wondering whether the assistant heard them.
 *
 * WHY AN ENERGY DETECTOR AND NOT SILERO. Silero VAD is a small ONNX model
 * (MIT) and a genuinely better classifier, and it is NOT what this file is,
 * for one reason that is measured rather than argued: a neural VAD needs an
 * inference session, which means loading a second ONNX runtime graph and
 * running it on every 32 ms frame of every hands-free session, competing for
 * the same CPU as the Whisper decoder that is the actual work. The frame-level
 * decision here is a runtime measurement against an adaptive noise floor: it
 * costs one pass over the frame and cannot make the machine's fans audible.
 * The cost is honest and bounded: this measures LEVEL, so it cannot tell a
 * television in the next room from a person, and it reports speech for any
 * sustained loud noise. `docs/architecture/adr/105-voice.md` records the
 * measurement that made the trade, and `Silero VAD` remains the upgrade path
 * if a user's recordings show this is not good enough.
 *
 * THE NOISE FLOOR IS THE WHOLE DESIGN. A fixed threshold is the thing that
 * makes an energy VAD useless on real hardware: a quiet room and a train
 * carriage are 40 dB apart, so the constant that works in one is deaf in the
 * other. The floor here follows the signal with an asymmetric tracker — down
 * immediately, up slowly, and only while the frame is judged non-speech — so a
 * fan spinning up is absorbed in a few hundred milliseconds and a word is not.
 */

/** One span of speech, in samples of the buffer it came from. */
export interface SpeechSegment {
  readonly startSample: number;
  readonly endSample: number;
}

/** How the detector is tuned. Every value has a default; `VAD_DEFAULTS` states them. */
export interface VadOptions {
  /** Frame length in milliseconds. Frames do not overlap. */
  readonly frameMs?: number;
  /** How far above the noise floor a frame has to be to count as speech. */
  readonly thresholdDb?: number;
  /** A run of speech shorter than this is a click, not an utterance. */
  readonly minSpeechMs?: number;
  /** A gap shorter than this does not end an utterance — it is a breath or a stop consonant. */
  readonly minSilenceMs?: number;
}

/**
 * The defaults, and where each comes from.
 *
 * `frameMs` 20 is the analysis window every speech tool uses; at 16 kHz it is
 * 320 samples, short enough to see a plosive and long enough for a stable RMS.
 * `thresholdDb` 12 sits above the level at which a phone's own noise gate
 * chatters and below the level at which a soft-spoken word is missed.
 * `minSilenceMs` 400 is the documented behaviour of every voice interface a
 * user has met: a pause for breath does not end the turn, a pause for thought
 * does. `minSpeechMs` 150 is just above the length of a door click.
 */
export const VAD_DEFAULTS = {
  frameMs: 20,
  thresholdDb: 12,
  minSpeechMs: 150,
  minSilenceMs: 400,
} as const satisfies Required<VadOptions>;

/**
 * The level reported for digital silence.
 *
 * An RMS of zero is minus infinity in decibels, and a floor is not a
 * cosmetic choice here: `-Infinity + 12` is still minus infinity, so a
 * threshold derived from a silent recording would be a threshold nothing can
 * reach and the answer would be „no speech" for every frame of a loud one.
 * Clamping gives silence a number that means „quieter than any real
 * microphone", which is exactly what it is.
 */
export const SILENCE_DB = -100;

/** How fast the streaming tracker forgets a noise floor it has been told is too high. */
const FLOOR_RISE_RATE = 0.25;

/** The options with their defaults filled in, validated. */
function resolveOptions(options: VadOptions): Required<VadOptions> {
  const resolved: Required<VadOptions> = {
    frameMs: options.frameMs ?? VAD_DEFAULTS.frameMs,
    thresholdDb: options.thresholdDb ?? VAD_DEFAULTS.thresholdDb,
    minSpeechMs: options.minSpeechMs ?? VAD_DEFAULTS.minSpeechMs,
    minSilenceMs: options.minSilenceMs ?? VAD_DEFAULTS.minSilenceMs,
  };
  if (!Number.isSafeInteger(resolved.frameMs) || resolved.frameMs <= 0) {
    throw new RangeError("vad: frameMs must be a positive whole number of milliseconds.");
  }
  if (!Number.isFinite(resolved.thresholdDb) || resolved.thresholdDb <= 0) {
    throw new RangeError("vad: thresholdDb must be a positive number of decibels.");
  }
  for (const key of ["minSpeechMs", "minSilenceMs"] as const) {
    if (!Number.isSafeInteger(resolved[key]) || resolved[key] < 0) {
      throw new RangeError(`vad: ${key} must be a whole number of milliseconds, zero or more.`);
    }
  }
  return resolved;
}

/** Samples in one frame at `sampleRate`, at least one. */
export function frameSamples(sampleRate: number, frameMs: number): number {
  return Math.max(1, Math.round((sampleRate * frameMs) / 1000));
}

/**
 * The frame's level in decibels, from its RMS.
 *
 * RMS rather than peak: a peak detector fires on a single sample of electrical
 * click, and speech is a sustained signal.
 */
export function frameLevelDb(frame: Float32Array): number {
  if (frame.length === 0) return SILENCE_DB;
  let sum = 0;
  for (const sample of frame) sum += sample * sample;
  const rms = Math.sqrt(sum / frame.length);
  if (rms <= 0) return SILENCE_DB;
  return Math.max(SILENCE_DB, 20 * Math.log10(rms));
}

/** Frames a duration is worth, rounded up — a rule about a duration may not be cheated by half a frame. */
function framesFor(ms: number, frameMs: number): number {
  return Math.ceil(ms / frameMs);
}

/**
 * Every span of speech in `pcm`, in sample offsets.
 *
 * Two parameters are inferred from the signal rather than passed in, and each
 * is the reason this is usable without calibration: the noise floor is the
 * quietest frame in the buffer, and the frames are the signal's own. The floor
 * is read from a frame rather than from a percentile because the interesting
 * recordings are short: at 20 ms a five-second utterance has 250 frames, and a
 * tenth percentile of 250 frames is a statistic, while the quietest frame is
 * simply the room. The assumption that follows is stated rather than hidden:
 * **a recording with no quiet frame in it has no floor to find**, and this
 * returns no segments for it. A stream that starts mid-conversation is the
 * hands-free gate's problem, and `createStreamingVad` handles it because it
 * keeps its floor from the frames it has already seen.
 */
export function detectSpeechSegments(
  pcm: Float32Array,
  sampleRate: number,
  options: VadOptions = {},
): readonly SpeechSegment[] {
  const resolved = resolveOptions(options);
  const length = frameSamples(sampleRate, resolved.frameMs);
  const frameCount = Math.floor(pcm.length / length);
  if (frameCount === 0) return [];

  const levels: number[] = [];
  for (let index = 0; index < frameCount; index += 1) {
    levels.push(frameLevelDb(pcm.subarray(index * length, (index + 1) * length)));
  }
  const floorDb = Math.min(...levels);
  const threshold = floorDb + resolved.thresholdDb;

  // Frame runs first, so the two duration rules are arithmetic on indices
  // rather than conditions inside a loop that also has to decide where a
  // segment ends.
  const runs: { start: number; end: number }[] = [];
  for (let index = 0; index < frameCount; index += 1) {
    const speech = (levels[index] as number) >= threshold;
    const last = runs[runs.length - 1];
    if (!speech) continue;
    if (last !== undefined && last.end === index) last.end = index + 1;
    else runs.push({ start: index, end: index + 1 });
  }

  const minSilenceFrames = framesFor(resolved.minSilenceMs, resolved.frameMs);
  const merged: { start: number; end: number }[] = [];
  for (const run of runs) {
    const last = merged[merged.length - 1];
    if (last !== undefined && run.start - last.end < minSilenceFrames) last.end = run.end;
    else merged.push({ ...run });
  }

  const minSpeechFrames = framesFor(resolved.minSpeechMs, resolved.frameMs);
  return merged
    .filter((run) => run.end - run.start >= minSpeechFrames)
    .map((run) => ({
      startSample: run.start * length,
      endSample: Math.min(run.end * length, pcm.length),
    }));
}

/** A detector that is fed one frame at a time and answers about that frame. */
export interface StreamingVad {
  /** Whether the frame just pushed is speech. */
  push(frame: Float32Array): boolean;
  /** The noise floor as it currently stands, in decibels. Diagnostic, and shown in the devtools panel. */
  readonly noiseFloorDb: number;
}

/**
 * A streaming detector, for a microphone that never stops.
 *
 * The floor tracks the signal asymmetrically: a quieter frame pulls it down at
 * once, because a room that just got quiet is a room this detector should
 * believe, and a louder frame raises it at `FLOOR_RISE_RATE`, because a louder
 * frame is much more likely to be the user talking than a change in the room.
 * Raising it only on frames judged non-speech is what closes the loop that
 * would otherwise end every utterance: without that, a long sentence would
 * raise its own floor until it was no longer speech, and the user would be
 * interrupted by their own voice.
 */
export function createStreamingVad(sampleRate: number, options: VadOptions = {}): StreamingVad {
  const resolved = resolveOptions(options);
  let level = Number.NaN;
  return {
    push(frame: Float32Array): boolean {
      const current = frameLevelDb(frame);
      if (Number.isNaN(level)) level = current;
      const speech = current >= level + resolved.thresholdDb;
      if (current < level) level = current;
      else if (!speech) level += FLOOR_RISE_RATE * (current - level);
      return speech;
    },
    get noiseFloorDb(): number {
      return Number.isNaN(level) ? SILENCE_DB : level;
    },
  };
}

/** The frame length a streaming detector expects, so a caller does not re-derive it. */
export function streamingFrameSamples(sampleRate: number, options: VadOptions = {}): number {
  return frameSamples(sampleRate, resolveOptions(options).frameMs);
}
