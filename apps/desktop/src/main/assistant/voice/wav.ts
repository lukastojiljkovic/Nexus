/**
 * The one audio container this service reads and writes on disk.
 *
 * A voice pack builder has to hand the maintainer's smoke test a file, and the
 * smoke test has to read a recording back, so something has to write bytes that
 * outlive the process. WAV rather than MP3 or FLAC because WAV needs no
 * dependency at all — the header is 44 bytes of little-endian integers and the
 * payload is the samples — while both of the others would mean either a new
 * library or a codec written here.
 *
 * What it deliberately does NOT do, because a permissive decoder is a parser
 * on hostile input: it reads PCM (format 1) and IEEE float (format 3) and
 * refuses everything else by its format code rather than by guessing. A
 * compressed WAV reaches the app only through a pack a user built, and a pack
 * whose audio this cannot read fails here with a code that names the format,
 * instead of producing noise that the model then transcribes into a sentence.
 */

/** Decoded audio: samples in `[-1, 1]`, mono, and the rate they were recorded at. */
export interface WavAudio {
  readonly pcm: Float32Array;
  readonly sampleRate: number;
}

/** Why a buffer is not a WAV this service reads. */
export type WavProblem =
  | "too-short"
  | "not-riff"
  | "not-wave"
  | "no-format"
  | "format-unsupported"
  | "no-data"
  | "channels-unsupported"
  | "bit-depth-unsupported"
  | "truncated";

/** WAVE format tags. 1 is integer PCM, 3 is IEEE float; everything else is a codec. */
const FORMAT_PCM = 1;
const FORMAT_FLOAT = 3;

function readAscii(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(
    bytes[offset] as number,
    bytes[offset + 1] as number,
    bytes[offset + 2] as number,
    bytes[offset + 3] as number,
  );
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] as number) |
      ((bytes[offset + 1] as number) << 8) |
      ((bytes[offset + 2] as number) << 16) |
      ((bytes[offset + 3] as number) << 24)) >>>
    0
  );
}

function readUint16(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] as number) | ((bytes[offset + 1] as number) << 8)) >>> 0;
}

/** One sample, by bit depth, as a number in `[-1, 1]`. */
function sampleAt(bytes: Uint8Array, offset: number, bits: number, float: boolean): number {
  if (float) {
    if (bits === 32) {
      return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getFloat32(0, true);
    }
    return new DataView(bytes.buffer, bytes.byteOffset + offset, 8).getFloat64(0, true);
  }
  if (bits === 8) {
    // 8-bit WAV is UNSIGNED, unlike every other depth: 128 is zero.
    return ((bytes[offset] as number) - 128) / 128;
  }
  if (bits === 16) {
    const value = ((bytes[offset + 1] as number) << 8) | (bytes[offset] as number);
    return ((value << 16) >> 16) / 32_768;
  }
  if (bits === 24) {
    const value =
      ((bytes[offset + 2] as number) << 16) | ((bytes[offset + 1] as number) << 8) | (bytes[offset] as number);
    return ((value << 8) >> 8) / 8_388_608;
  }
  const value = readUint32(bytes, offset);
  return (value | 0) / 2_147_483_648;
}

/**
 * Why `bytes` is not a readable WAV, or `null` when it is.
 *
 * Separate from {@link decodeWav} so a caller can ask the question without
 * paying for the decode, and so each refusal has a test of its own.
 */
export function wavProblem(bytes: Uint8Array): WavProblem | null {
  if (bytes.byteLength < 12) return "too-short";
  if (readAscii(bytes, 0) !== "RIFF") return "not-riff";
  if (readAscii(bytes, 8) !== "WAVE") return "not-wave";

  const view = { format: 0, channels: 0, bits: 0, data: false };
  let offset = 12;
  while (offset + 8 <= bytes.byteLength) {
    const id = readAscii(bytes, offset);
    const size = readUint32(bytes, offset + 4);
    const body = offset + 8;
    if (body + size > bytes.byteLength) return "truncated";
    if (id === "fmt ") {
      if (size < 16) return "no-format";
      view.format = readUint16(bytes, body);
      view.channels = readUint16(bytes, body + 2);
      view.bits = readUint16(bytes, body + 14);
    } else if (id === "data") {
      view.data = true;
    }
    // Chunks are padded to an even length, and a decoder that forgets the pad
    // byte reads every following chunk one byte early.
    offset = body + size + (size % 2);
  }

  if (view.format === 0) return "no-format";
  if (view.format !== FORMAT_PCM && view.format !== FORMAT_FLOAT) return "format-unsupported";
  if (view.channels === 0 || view.channels > 2) return "channels-unsupported";
  if (view.format === FORMAT_PCM && view.bits !== 8 && view.bits !== 16 && view.bits !== 24 && view.bits !== 32) {
    return "bit-depth-unsupported";
  }
  if (view.format === FORMAT_FLOAT && view.bits !== 32 && view.bits !== 64) {
    return "bit-depth-unsupported";
  }
  if (!view.data) return "no-data";
  return null;
}

/**
 * The audio in `bytes`, mono, as `[-1, 1]` samples.
 *
 * A stereo file is mixed down by averaging the channels, which is what a
 * microphone that recorded in stereo would have produced in mono: the channels
 * carry the same room and the same voice, and picking one would throw away half
 * the signal-to-noise ratio for nothing.
 */
export function decodeWav(bytes: Uint8Array): WavAudio {
  const problem = wavProblem(bytes);
  if (problem !== null) throw new Error(`decodeWav: the buffer is not a readable WAV (${problem}).`);

  let offset = 12;
  let channels = 1;
  let sampleRate = 0;
  let bits = 16;
  let float = false;
  let dataOffset = 0;
  let dataSize = 0;
  while (offset + 8 <= bytes.byteLength) {
    const id = readAscii(bytes, offset);
    const size = readUint32(bytes, offset + 4);
    const body = offset + 8;
    if (id === "fmt ") {
      const format = readUint16(bytes, body);
      channels = readUint16(bytes, body + 2);
      sampleRate = readUint32(bytes, body + 4);
      bits = readUint16(bytes, body + 14);
      float = format === FORMAT_FLOAT;
    } else if (id === "data") {
      dataOffset = body;
      dataSize = size;
    }
    offset = body + size + (size % 2);
  }

  const bytesPerSample = bits / 8;
  const frames = Math.floor(dataSize / (bytesPerSample * channels));
  const pcm = new Float32Array(frames);
  for (let frame = 0; frame < frames; frame += 1) {
    let sum = 0;
    for (let channel = 0; channel < channels; channel += 1) {
      sum += sampleAt(bytes, dataOffset + (frame * channels + channel) * bytesPerSample, bits, float);
    }
    pcm[frame] = sum / channels;
  }
  return { pcm, sampleRate };
}

/**
 * `pcm` as a 16-bit mono WAV.
 *
 * 16-bit because that is what the two ends of this pipeline are: a microphone
 * hands the app 16-bit samples, and a voice pack's own samples were quantised
 * once before this. Samples outside `[-1, 1]` are clamped rather than wrapped,
 * so a rounding excursion at full scale is a barely-audible flat top instead of
 * a full-amplitude click with the sign inverted.
 */
export function encodeWav(pcm: Float32Array, sampleRate: number): Uint8Array {
  if (!Number.isSafeInteger(sampleRate) || sampleRate <= 0) {
    throw new RangeError("encodeWav: sampleRate must be a positive whole number.");
  }
  const dataBytes = pcm.length * 2;
  const bytes = new Uint8Array(44 + dataBytes);
  const view = new DataView(bytes.buffer);

  const ascii = (offset: number, text: string): void => {
    for (let index = 0; index < text.length; index += 1) {
      bytes[offset + index] = text.charCodeAt(index);
    }
  };

  ascii(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, FORMAT_PCM, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, dataBytes, true);

  for (let index = 0; index < pcm.length; index += 1) {
    const clamped = Math.max(-1, Math.min(1, pcm[index] as number));
    view.setInt16(44 + index * 2, Math.round(clamped * 32_767), true);
  }
  return bytes;
}
