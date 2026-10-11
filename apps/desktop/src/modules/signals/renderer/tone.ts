import type { MorseInterval } from "@nexus/core";

/**
 * The Morse beat note: a scheduled sine, played by the audio clock.
 *
 * **The whole schedule is handed to the audio thread at once.** Every interval's
 * boundary becomes a gain change booked at an absolute `AudioContext` time, so
 * the tone does not depend on a JavaScript timer that a busy renderer can delay —
 * which is what a hand-keyed message has to survive to be readable at the other
 * end of the room. Nothing here is on the UI thread after the first call.
 *
 * **Each edge is a 4 ms ramp, and that is not decoration.** A gain that jumps
 * from 0 to 1 in one sample is a click, and a click at every boundary is a
 * message that sounds like it is being keyed through a broken contact.
 */

/** Peak amplitude of the beat note. Comfortable on a laptop speaker, and far below full scale. */
const TONE_AMPLITUDE = 0.2;
/** The edge of a key's on and off, in seconds. */
const EDGE_SECONDS = 0.004;

export interface ToneSession {
  /** How long the whole schedule lasts, in milliseconds — the page's own „štampanje" of it. */
  readonly totalMs: number;
  /** Stops the tone at once and closes the context. Idempotent. */
  stop(): void;
}

/**
 * Plays a keyed schedule as a sine at `pitchHz`, starting now. Returns null when
 * there is nothing to play.
 */
export function playTone(
  intervals: readonly MorseInterval[],
  pitchHz: number,
): ToneSession | null {
  const totalMs = intervals.reduce((total, interval) => total + interval.ms, 0);
  if (totalMs <= 0) return null;
  const context = new AudioContext();
  const oscillator = context.createOscillator();
  oscillator.type = "sine";
  oscillator.frequency.value = pitchHz;
  const gain = context.createGain();
  gain.gain.value = 0;
  oscillator.connect(gain);
  gain.connect(context.destination);

  let at = context.currentTime;
  for (const interval of intervals) {
    const length = interval.ms / 1000;
    if (interval.on) {
      // The ramp is clamped to the interval, because a 2 ms mark at 60 WPM is
      // shorter than two edges and a longer ramp would make it louder than it is.
      const edge = Math.min(EDGE_SECONDS, length / 2);
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(TONE_AMPLITUDE, at + edge);
      gain.gain.setValueAtTime(TONE_AMPLITUDE, at + length - edge);
      gain.gain.linearRampToValueAtTime(0, at + length);
    }
    at += length;
  }
  oscillator.start();

  let stopped = false;
  /**
   * The one teardown, used by the Stop button AND by the schedule's own end.
   *
   * The end is a JavaScript timer rather than `oscillator.stop(end)`, and that is
   * deliberate: a node stopped twice is a behaviour the Web Audio spec leaves to
   * the last call, and a timer that starts the same teardown means there is
   * exactly one `stop()` per node and no case to reason about. The tone itself is
   * still booked entirely on the audio clock — the timer carries nothing but the
   * release, sixty milliseconds after the last interval.
   */
  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    const now = context.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(0, now + EDGE_SECONDS);
    oscillator.stop(now + EDGE_SECONDS * 2);
  };
  const endTimer = window.setTimeout(stop, totalMs + 60);
  oscillator.addEventListener("ended", () => {
    window.clearTimeout(endTimer);
    void context.close();
  });
  return { totalMs, stop };
}
