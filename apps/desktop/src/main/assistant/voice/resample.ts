/**
 * Resampling, so that one audio format is enough everywhere else.
 *
 * The whole voice path is defined in ONE format — 16 kHz mono `Float32Array` —
 * because that is what both models of this service are built around: Whisper's
 * feature extractor resamples to 16 kHz (`preprocessor_config.json` says
 * `"sampling_rate": 16000`) and the VITS voices return 16 kHz, so a caller
 * holding audio from a microphone at 44.1 or 48 kHz needs one conversion and
 * nothing downstream needs to know what the microphone did.
 *
 * The kernel is a windowed sinc rather than linear interpolation, and the
 * difference matters in exactly one direction: DOWNsampling. A linear
 * interpolation of a 48 kHz signal to 16 kHz leaves everything above 8 kHz
 * folded back into the band as aliasing, and a voice recording has plenty up
 * there — sibilants and room noise land on top of the speech the model is
 * trying to read. The sinc kernel is scaled by the rate ratio so its cutoff
 * follows the output rate, which is what makes the conversion band-limited in
 * both directions.
 *
 * The output LENGTH is exact rather than approximate (`round(input * out / in)`)
 * because it is the one property every caller can check without listening: a
 * transcript of a three-second clip and a waveform of a three-second clip have
 * to agree about how long three seconds is.
 */

/** The rate the assistant's audio path is defined in: 16 kHz mono. */
export const VOICE_SAMPLE_RATE = 16_000;

/**
 * How many input samples either side of the output sample the kernel looks at,
 * before it is widened by the downsampling ratio.
 *
 * Eight either side is the usual compromise for speech: the windowed sinc's
 * stop-band is already below the level of the 16-bit quantisation noise a
 * microphone produces, and the cost is 16 multiply-adds per output sample,
 * which at 16 kHz is a rounding error beside the model inference it precedes.
 */
const KERNEL_HALF_WIDTH = 8;

/** Windowed sinc: 1 at the centre, 0 at every other input sample. */
function sinc(value: number): number {
  if (value === 0) return 1;
  const scaled = Math.PI * value;
  return Math.sin(scaled) / scaled;
}

/** A Hann window over `[-1, 1]`, zero outside. Keeps the truncated kernel from ringing. */
function hann(position: number): number {
  if (position <= -1 || position >= 1) return 0;
  return 0.5 * (1 + Math.cos(Math.PI * position));
}

/** The rule a rate broke. Returning the rule rather than a boolean is what lets each have its own test. */
export type RateProblem = "not-a-number" | "not-positive";

/** Why `value` is not a usable sample rate, or `null` when it is. */
export function rateProblem(value: number): RateProblem | null {
  if (!Number.isFinite(value)) return "not-a-number";
  if (value <= 0) return "not-positive";
  return null;
}

/**
 * `pcm` moved from `inputRate` to `outputRate`, mono, one channel in and out.
 *
 * Equal rates return a COPY rather than the argument: a resampler that
 * sometimes aliases its caller's buffer is the kind of function whose bug
 * appears three layers away, in the one caller that wrote to the array it
 * thought was its own.
 */
export function resamplePcm(pcm: Float32Array, inputRate: number, outputRate: number): Float32Array {
  const inputProblem = rateProblem(inputRate);
  if (inputProblem !== null) throw new RangeError(`resamplePcm: inputRate is ${inputProblem}.`);
  const outputProblem = rateProblem(outputRate);
  if (outputProblem !== null) throw new RangeError(`resamplePcm: outputRate is ${outputProblem}.`);

  if (pcm.length === 0) return new Float32Array(0);
  if (inputRate === outputRate) return Float32Array.from(pcm);

  // Input samples consumed per output sample.
  const ratio = inputRate / outputRate;
  const outputLength = Math.round((pcm.length * outputRate) / inputRate);
  const output = new Float32Array(outputLength);

  // The kernel's bandwidth follows the LOWER of the two rates, so a
  // downsampling ratio lowers the cutoff instead of folding the band above it
  // back into the signal. `ratio` is input per output, so a ratio above one is
  // the downsampling case and the cutoff is its reciprocal.
  const cutoff = outputRate < inputRate ? 1 / ratio : 1;
  const halfWidth = KERNEL_HALF_WIDTH / cutoff;

  for (let index = 0; index < outputLength; index += 1) {
    const centre = index * ratio;
    // Clamped to the buffer, and the weights are normalised over the taps that
    // are left. Reading the outside as silence and still counting its weight
    // was tried and is arithmetically wrong: the excluded taps carry negative
    // coefficients, so their weight does not cancel, and a constant signal came
    // out 2 % loud at the edge of the buffer. A shorter kernel edge is the
    // honest reading of a signal that stops.
    const first = Math.max(0, Math.ceil(centre - halfWidth));
    const last = Math.min(pcm.length - 1, Math.floor(centre + halfWidth));
    let weighted = 0;
    let weight = 0;
    for (let tap = first; tap <= last; tap += 1) {
      const offset = tap - centre;
      const coefficient = cutoff * sinc(cutoff * offset) * hann(offset / halfWidth);
      weighted += coefficient * (pcm[tap] as number);
      weight += coefficient;
    }
    output[index] = weight === 0 ? 0 : weighted / weight;
  }

  return output;
}
