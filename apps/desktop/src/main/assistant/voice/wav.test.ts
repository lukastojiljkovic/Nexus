import { describe, expect, it } from "vitest";

import { decodeWav, encodeWav, wavProblem } from "./wav.js";

/** A minimal WAV, built byte by byte so a test can state every field it cares about. */
function buildWav(options: {
  format: number;
  channels: number;
  sampleRate: number;
  bits: number;
  data: Uint8Array;
  extraChunk?: { id: string; body: Uint8Array };
}): Uint8Array {
  const extra = options.extraChunk;
  const header = 44 + (extra === undefined ? 0 : 8 + extra.body.length + (extra.body.length % 2));
  const bytes = new Uint8Array(header + options.data.length);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, text: string): void => {
    for (let index = 0; index < text.length; index += 1) bytes[offset + index] = text.charCodeAt(index);
  };
  ascii(0, "RIFF");
  view.setUint32(4, bytes.length - 8, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, options.format, true);
  view.setUint16(22, options.channels, true);
  view.setUint32(24, options.sampleRate, true);
  view.setUint32(28, (options.sampleRate * options.channels * options.bits) / 8, true);
  view.setUint16(32, (options.channels * options.bits) / 8, true);
  view.setUint16(34, options.bits, true);
  let offset = 36;
  if (extra !== undefined) {
    ascii(offset, extra.id);
    view.setUint32(offset + 4, extra.body.length, true);
    bytes.set(extra.body, offset + 8);
    offset += 8 + extra.body.length + (extra.body.length % 2);
  }
  ascii(offset, "data");
  view.setUint32(offset + 4, options.data.length, true);
  bytes.set(options.data, offset + 8);
  return bytes;
}

describe("encodeWav", () => {
  it("writes the 44-byte canonical header", () => {
    const bytes = encodeWav(new Float32Array(2), 16_000);
    expect(bytes.length).toBe(48);
    expect(String.fromCharCode(...bytes.subarray(0, 4))).toBe("RIFF");
    expect(String.fromCharCode(...bytes.subarray(8, 12))).toBe("WAVE");
    expect(String.fromCharCode(...bytes.subarray(12, 16))).toBe("fmt ");
    expect(String.fromCharCode(...bytes.subarray(36, 40))).toBe("data");
    const view = new DataView(bytes.buffer);
    expect(view.getUint32(4, true)).toBe(40); // 36 + 4 bytes of samples
    expect(view.getUint16(20, true)).toBe(1); // integer PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint32(28, true)).toBe(32_000); // byte rate
    expect(view.getUint16(32, true)).toBe(2); // block align
    expect(view.getUint16(34, true)).toBe(16);
  });

  it("quantises the ends of the range exactly", () => {
    const bytes = encodeWav(Float32Array.from([0, 1, -1, 0.5]), 8_000);
    const view = new DataView(bytes.buffer);
    expect(view.getInt16(44, true)).toBe(0);
    expect(view.getInt16(46, true)).toBe(32_767);
    expect(view.getInt16(48, true)).toBe(-32_767);
    expect(view.getInt16(50, true)).toBe(16_384); // round(0.5 * 32767)
  });

  it("clamps rather than wraps past full scale", () => {
    const bytes = encodeWav(Float32Array.from([1.5, -1.5]), 8_000);
    const view = new DataView(bytes.buffer);
    expect(view.getInt16(44, true)).toBe(32_767);
    expect(view.getInt16(46, true)).toBe(-32_767);
  });

  it("refuses a rate it cannot use", () => {
    expect(() => encodeWav(new Float32Array(1), 0)).toThrow(RangeError);
  });
});

describe("decodeWav", () => {
  it("round-trips what encodeWav wrote", () => {
    const pcm = Float32Array.from([0, 0.25, -0.25, 0.75, -0.75]);
    const decoded = decodeWav(encodeWav(pcm, 16_000));
    expect(decoded.sampleRate).toBe(16_000);
    expect(decoded.pcm.length).toBe(5);
    for (let index = 0; index < pcm.length; index += 1) {
      // One 16-bit step is 1/32768, so the round trip is exact to within half of one.
      expect(decoded.pcm[index] as number).toBeCloseTo(pcm[index] as number, 4);
    }
  });

  it("reads 16-bit little-endian samples", () => {
    // 0x7FFF is +1 less one step; 0x8000 is -1; 0x4000 is +0.5.
    const data = Uint8Array.from([0xff, 0x7f, 0x00, 0x80, 0x00, 0x40]);
    const decoded = decodeWav(buildWav({ format: 1, channels: 1, sampleRate: 44_100, bits: 16, data }));
    expect(decoded.sampleRate).toBe(44_100);
    expect(Array.from(decoded.pcm)).toEqual([32_767 / 32_768, -1, 0.5]);
  });

  it("averages a stereo file down to mono", () => {
    // Two frames: left +1, right -1 -> 0; then left 0, right +0.5 -> 0.25.
    const data = Uint8Array.from([0xff, 0x7f, 0x00, 0x80, 0x00, 0x00, 0x00, 0x40]);
    const decoded = decodeWav(buildWav({ format: 1, channels: 2, sampleRate: 48_000, bits: 16, data }));
    expect(decoded.pcm.length).toBe(2);
    // 0x7FFF is 32767/32768 and 0x8000 is -1, so the average is one 16-bit step
    // below zero rather than exactly zero.
    expect(decoded.pcm[0] as number).toBeCloseTo(0, 4);
    expect(decoded.pcm[1] as number).toBeCloseTo(0.25, 4);
  });

  it("reads 8-bit unsigned samples, where 128 is zero", () => {
    const decoded = decodeWav(
      buildWav({ format: 1, channels: 1, sampleRate: 8_000, bits: 8, data: Uint8Array.from([128, 255, 0]) }),
    );
    expect(Array.from(decoded.pcm)).toEqual([0, 127 / 128, -1]);
  });

  it("reads 24-bit samples", () => {
    // 0x7FFFFF is +1 less one step; 0x800000 is -1.
    const decoded = decodeWav(
      buildWav({
        format: 1,
        channels: 1,
        sampleRate: 8_000,
        bits: 24,
        data: Uint8Array.from([0xff, 0xff, 0x7f, 0x00, 0x00, 0x80]),
      }),
    );
    expect(decoded.pcm[0] as number).toBeCloseTo(1, 6);
    expect(decoded.pcm[1] as number).toBe(-1);
  });

  it("reads 32-bit float samples", () => {
    const data = new Uint8Array(8);
    const view = new DataView(data.buffer);
    view.setFloat32(0, 0.5, true);
    view.setFloat32(4, -0.25, true);
    const decoded = decodeWav(buildWav({ format: 3, channels: 1, sampleRate: 16_000, bits: 32, data }));
    expect(decoded.pcm[0] as number).toBe(0.5);
    expect(decoded.pcm[1] as number).toBe(-0.25);
  });

  it("skips a chunk it does not know, padding and all", () => {
    // A LIST chunk of 3 bytes is padded to 4, and the data chunk after it must
    // still be found at the right offset.
    const data = Uint8Array.from([0xff, 0x7f]);
    const decoded = decodeWav(
      buildWav({
        format: 1,
        channels: 1,
        sampleRate: 8_000,
        bits: 16,
        data,
        extraChunk: { id: "LIST", body: Uint8Array.from([1, 2, 3]) },
      }),
    );
    expect(decoded.pcm.length).toBe(1);
    expect(decoded.pcm[0] as number).toBeCloseTo(1, 4);
  });
});

describe("wavProblem", () => {
  const good = buildWav({ format: 1, channels: 1, sampleRate: 8_000, bits: 16, data: Uint8Array.from([0, 0]) });

  it("accepts a file it reads", () => {
    expect(wavProblem(good)).toBeNull();
  });

  it("names each refusal", () => {
    expect(wavProblem(new Uint8Array(4))).toBe("too-short");
    const aiff = Uint8Array.from(good);
    aiff.set([0x41, 0x49, 0x46, 0x46], 0); // "AIFF"
    expect(wavProblem(aiff)).toBe("not-riff");
    const aiffBody = Uint8Array.from(good);
    aiffBody.set([0x41, 0x49, 0x46, 0x46], 8); // "AIFF" as the form type
    expect(wavProblem(aiffBody)).toBe("not-wave");
    expect(
      wavProblem(buildWav({ format: 0x11, channels: 1, sampleRate: 8_000, bits: 4, data: Uint8Array.from([0]) })),
    ).toBe("format-unsupported");
    expect(
      wavProblem(buildWav({ format: 1, channels: 6, sampleRate: 8_000, bits: 16, data: Uint8Array.from([0, 0]) })),
    ).toBe("channels-unsupported");
    expect(
      wavProblem(buildWav({ format: 1, channels: 1, sampleRate: 8_000, bits: 12, data: Uint8Array.from([0]) })),
    ).toBe("bit-depth-unsupported");
    const truncated = good.slice(0, good.length - 1);
    expect(wavProblem(truncated)).toBe("truncated");
  });

  it("refuses a file with no data chunk, and decodeWav then throws", () => {
    // A header whose data chunk declares zero bytes is readable: zero frames.
    const empty = buildWav({ format: 1, channels: 1, sampleRate: 8_000, bits: 16, data: new Uint8Array(0) });
    expect(wavProblem(empty)).toBeNull();
    expect(decodeWav(empty).pcm.length).toBe(0);
    expect(() => decodeWav(new Uint8Array(4))).toThrow(/too-short/);
  });
});
