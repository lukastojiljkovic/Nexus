import {
  RECORDING_MIME_TYPES,
  recordingKindForMime,
  type RecordingKind,
  type RecordingMime,
} from "@nexus/core";

/**
 * The RECORDER's capture arithmetic, as pure functions (ADR-090).
 *
 * **Why it lives in the module's folder rather than inline in the page.** This
 * is the half of a capture that can be tested without a DOM — which mime to ask
 * Chromium for, what a level meter's buffer means, what the room left inside the
 * size cap buys — and a page that spelled these out would have its numbers
 * checked by nothing.
 *
 * **Why the remaining-time readout is MEASURED rather than assumed.** A capture
 * asks Chromium for a bitrate and Chromium is free to choose another: a VP8
 * encoder settles where it settles, and the page has no way to know where. So
 * the figure before the first chunk is the requested bitrate's, and from the
 * first chunk onward it is the bytes actually written divided by the time they
 * took — the honest number to show beside „preostalo još 12 minuta".
 */

/**
 * The container/codec pairs this build records, per kind, in the order
 * `@nexus/core`'s closed list declares them.
 *
 * Derived from `RECORDING_MIME_TYPES` rather than written out again: that list
 * is what the store validates against and what migration 077 CHECKs, and a
 * second copy here would be a third opinion about what this app can record.
 */
export function mimePreferences(kind: RecordingKind): readonly RecordingMime[] {
  return RECORDING_MIME_TYPES.filter((mime) => recordingKindForMime(mime) === kind);
}

/**
 * The first mime of `kind` this machine's Chromium can actually record — the
 * string `MediaRecorder` is asked for — or `null` when it can record none of
 * them.
 *
 * `isTypeSupported` is a parameter rather than a reach for
 * `MediaRecorder.isTypeSupported` so this is testable, and so the page passes
 * the same predicate it consults anyway.
 *
 * **What the null means.** The capture does not start. Asking for a mime nothing
 * supports and hoping is the one thing that cannot be allowed here: what gets
 * stored is `MediaRecorder`'s OWN `mimeType` after `start()`, and the store
 * refuses anything outside those four strings — so a device that can record none
 * of them has to say so BEFORE it records rather than after.
 */
export function pickMime(
  kind: RecordingKind,
  isTypeSupported: (mime: string) => boolean,
): RecordingMime | null {
  return mimePreferences(kind).find((mime) => isTypeSupported(mime)) ?? null;
}

/**
 * The level meter's one number: the RMS amplitude of a byte time-domain buffer
 * (`AnalyserNode.getByteTimeDomainData`), in `0..1`.
 *
 * Bytes are unsigned and centred at 128, so each sample is re-centred before it
 * is squared. RMS rather than a peak: a peak meter flickers on every consonant
 * and says nothing about whether the room is loud, while the mean square is what
 * „can the microphone hear me" actually is. An empty buffer answers 0 rather
 * than `NaN` — a `NaN` width on screen is worse than a bar at rest.
 */
export function levelFromWaveform(samples: Uint8Array): number {
  if (samples.length === 0) return 0;
  let sumOfSquares = 0;
  for (const sample of samples) {
    const centred = (sample - 128) / 128;
    sumOfSquares += centred * centred;
  }
  return Math.min(1, Math.sqrt(sumOfSquares / samples.length));
}

/** What one second of recording costs at a requested bitrate, in bytes. */
export function bytesPerMs(bitsPerSecond: number): number {
  return bitsPerSecond / 8 / 1_000;
}

/**
 * What this capture is really costing, in bytes per millisecond, from what has
 * been written and how long that took — or `null` until there is something to
 * measure. Zero elapsed or zero written is „no measurement yet", never a rate of
 * zero, which would read as „this recording will never fill the disk".
 */
export function measuredBytesPerMs(writtenBytes: number, elapsedMs: number): number | null {
  if (writtenBytes <= 0 || elapsedMs <= 0) return null;
  return writtenBytes / elapsedMs;
}

/**
 * How much recording time the room left inside the size cap buys at `rate`, or
 * `null` when there is no rate to divide by — the page then shows the requested
 * bitrate's estimate instead (see this file's header).
 *
 * A cap already reached answers 0, so the readout says „no room left" rather
 * than a negative time, and the caller stops the capture at that point.
 */
export function remainingMs(
  limitBytes: number,
  writtenBytes: number,
  rateBytesPerMs: number,
): number | null {
  if (!Number.isFinite(rateBytesPerMs) || rateBytesPerMs <= 0) return null;
  const room = limitBytes - writtenBytes;
  return room <= 0 ? 0 : room / rateBytesPerMs;
}

/**
 * How long a capture has really run: the wall clock since it started, minus the
 * stretches it spent paused.
 *
 * Measured from instants rather than counted in ticks, on the rule
 * `timers/renderer/timing.ts` states one module over: a hidden window's
 * intervals are throttled, so a counter would under-report the length of a
 * recording — and that length is what the store keeps and what the player draws.
 */
export function captureElapsedMs(
  startedAtMs: number,
  nowMs: number,
  pausedMs: number,
): number {
  return Math.max(0, nowMs - startedAtMs - pausedMs);
}
