import { dBfsFromRms, rms } from "@nexus/core";

/**
 * The microphone, opened here and nowhere else.
 *
 * **`startMicrophone` is the ONLY `getUserMedia` call in this module**, and it is
 * called from the three „Pokreni" buttons — the Morse decoder, the tuner and the
 * meter — and by nothing else: not on mount, not on a tab switch, and not by any
 * of the module's other controls. That is the whole of the promise the brief
 * makes about the device: a page that opened the microphone to draw a tab would
 * be listening to a room for a number nobody asked for.
 *
 * **Two windows on one source, and why.** One `AnalyserNode` is sized for the
 * tuner (4096 samples: YIN has to see a whole period of the lowest note this
 * module tunes, and the guitar's low E is in there) and the other for the Morse
 * envelope (128 samples, read every 3 ms — a reading per 3 ms is a fifth of a dit
 * at the fastest speed the module offers). Reading the wide window at the narrow
 * window's rate would be a megabyte a second of copies for no answer, and the
 * narrow one cannot measure a pitch at all.
 *
 * **The constraints are the honest ones.** Echo cancellation, noise suppression
 * and automatic gain control all shape the signal, and a meter measuring a level
 * while the driver raises the gain is measuring the driver. They are asked for
 * off — a request, not a guarantee, which is why the meter says in plain words
 * that it is not calibrated.
 */

/** The tuner's and the meter's frame: 4096 samples is 85 ms at 48 kHz, and half of it is YIN's analysis window. */
const WIDE_FRAME = 4096;
/** The Morse envelope's window: 128 samples is 2.7 ms at 48 kHz. */
const NARROW_FRAME = 128;

export interface MicrophoneSession {
  /** The most recent wide window, as a fresh array — a caller may transfer it to the worker. */
  readFrame(): Float32Array;
  /** The most recent narrow window's level in dBFS — one reading for the Morse keyer. */
  readLevelDb(): number;
  /** When the level above was read: a monotonic instant, in milliseconds. */
  nowMs(): number;
  /** The sample rate of the context these windows came from; what the engines are told. */
  readonly sampleRate: number;
  /** Releases the device and closes the context. Idempotent. */
  stop(): void;
}

/**
 * Asks for the microphone and answers a session over it. Throws when the device
 * is refused (the caller shows `copy.common.micDenied`) or the context cannot
 * start.
 */
export async function startMicrophone(): Promise<MicrophoneSession> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  });
  const context = new AudioContext();
  try {
    // A context created before any gesture is often born suspended; the caller is
    // a click, so resuming here is a no-op the rest of the time.
    await context.resume();
    const source = context.createMediaStreamSource(stream);
    const wide = context.createAnalyser();
    wide.fftSize = WIDE_FRAME;
    const narrow = context.createAnalyser();
    narrow.fftSize = NARROW_FRAME;
    source.connect(wide);
    source.connect(narrow);
    // NOTE, and it is load-bearing: neither analyser is connected to the
    // destination. Routing a live microphone to the speakers is feedback, and
    // nothing about these three tools needs to be heard.

    const envelope = new Float32Array(NARROW_FRAME);
    let stopped = false;

    return {
      readFrame(): Float32Array {
        const next = new Float32Array(WIDE_FRAME);
        wide.getFloatTimeDomainData(next);
        return next;
      },
      readLevelDb(): number {
        narrow.getFloatTimeDomainData(envelope);
        return dBfsFromRms(rms(envelope));
      },
      nowMs(): number {
        return performance.now();
      },
      sampleRate: context.sampleRate,
      stop(): void {
        if (stopped) return;
        stopped = true;
        for (const track of stream.getTracks()) track.stop();
        source.disconnect();
        wide.disconnect();
        narrow.disconnect();
        void context.close();
      },
    };
  } catch (error) {
    for (const track of stream.getTracks()) track.stop();
    void context.close();
    throw error;
  }
}

/**
 * Why opening the microphone failed, in the two cases the module's copy can say:
 * the device was refused, or it is not there.
 *
 * `getUserMedia` rejects with a `DOMException` whose `name` is the answer —
 * `NotAllowedError` is a refusal (the handler in main said no, or Windows denied
 * the device), `SecurityError` the same refusal at the origin level, and anything
 * else (`NotFoundError`, `NotReadableError`, `OverconstrainedError`) is a device
 * this machine does not have, is busy, or cannot be opened with the constraints
 * asked for. A page that said „denied" to all of them would send somebody to a
 * permission dialog that was never the problem.
 */
export function microphoneFailure(error: unknown): "denied" | "failed" {
  if (typeof DOMException === "undefined" || !(error instanceof DOMException)) return "failed";
  return error.name === "NotAllowedError" || error.name === "SecurityError" ? "denied" : "failed";
}
