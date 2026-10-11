/**
 * The one number that says whether a voice engine is usable on this machine.
 *
 * A real-time factor is audio seconds produced or consumed per wall second:
 * 3.0 means a three-second clip is transcribed in one second, and 0.4 means the
 * assistant falls further behind the longer the user talks. It is the only
 * figure that compares a Whisper size against another on the same laptop, which
 * is why it is a function here and a number in the report rather than a claim
 * in a comment: `docs/architecture/adr/105-voice.md` quotes the values this
 * computed, and a value nobody can recompute is a value nobody can check.
 */

/**
 * Audio seconds per wall second.
 *
 * `elapsedMs` of zero is refused rather than answered with infinity: a sweep
 * that reports a model as infinitely fast because its clock was not started is
 * a sweep whose numbers all have to be thrown away.
 */
export function realTimeFactor(audioSamples: number, sampleRate: number, elapsedMs: number): number {
  if (!Number.isFinite(audioSamples) || audioSamples < 0) {
    throw new RangeError("realTimeFactor: audioSamples must be a non-negative number.");
  }
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new RangeError("realTimeFactor: sampleRate must be a positive number.");
  }
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) {
    throw new RangeError("realTimeFactor: elapsedMs must be a positive number.");
  }
  return audioSamples / sampleRate / (elapsedMs / 1000);
}

/** The same number, as the line a report and the devtools panel both print. */
export function formatRealTimeFactor(rtf: number): string {
  if (!Number.isFinite(rtf)) throw new RangeError("formatRealTimeFactor: rtf must be finite.");
  return `${rtf.toFixed(2)}x real time`;
}
