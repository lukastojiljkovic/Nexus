import { describe, expect, it } from "vitest";
import { RECORDING_MIME_TYPES } from "@nexus/core";
import {
  bytesPerMs,
  captureElapsedMs,
  levelFromWaveform,
  measuredBytesPerMs,
  mimePreferences,
  pickMime,
  remainingMs,
} from "./capture.js";

/**
 * The recorder's capture arithmetic. What is pinned here is every number the
 * page shows DURING a capture — the level bar, the clock, and the room left
 * inside the store's size cap — because those are the figures a user reads to
 * decide whether to keep talking, and none of them can be checked by eye.
 */

describe("mimePreferences", () => {
  it("splits the closed list by kind, keeping the order `@nexus/core` declares", () => {
    expect(mimePreferences("audio")).toEqual(["audio/webm;codecs=opus", "audio/ogg;codecs=opus"]);
    expect(mimePreferences("video")).toEqual([
      "video/webm;codecs=vp8,opus",
      "video/webm;codecs=vp9,opus",
    ]);
    // Every mime the module can store is offered by exactly one kind: a list
    // that lost an entry would make a recording this store would accept
    // unrequestable.
    expect([...mimePreferences("audio"), ...mimePreferences("video")]).toEqual([
      ...RECORDING_MIME_TYPES,
    ]);
  });
});

describe("pickMime", () => {
  it("asks for the first mime this machine really supports, in the closed list's order", () => {
    // A machine that records both: the list's own order decides, and WebM comes
    // first — so two builds of this app record the same container.
    expect(pickMime("audio", () => true)).toBe("audio/webm;codecs=opus");
    // A machine without WebM/Ogg support for voice: what is left is chosen.
    expect(pickMime("audio", (mime) => mime === "audio/ogg;codecs=opus")).toBe(
      "audio/ogg;codecs=opus",
    );
  });

  it("answers null when the machine can record none of the four, rather than a guess", () => {
    expect(pickMime("video", () => false)).toBeNull();
    expect(pickMime("audio", () => false)).toBeNull();
  });

  it("only ever answers a mime the store accepts", () => {
    const picked = pickMime("video", () => true);
    expect(picked).not.toBeNull();
    expect(RECORDING_MIME_TYPES).toContain(picked!);
  });
});

describe("levelFromWaveform", () => {
  it("reads silence at rest, full scale at full scale, and the RMS in between", () => {
    // 128 is the buffer's zero point: every sample centred on it is no signal.
    expect(levelFromWaveform(new Uint8Array(64).fill(128))).toBe(0);
    // A constant +50% sample: the mean square is 0.25, so the RMS is 0.5.
    expect(levelFromWaveform(new Uint8Array(4).fill(192))).toBe(0.5);
    expect(levelFromWaveform(new Uint8Array(4).fill(64))).toBe(0.5);
    // Alternating extremes. Unsigned bytes have no exact +1: the loudest sample
    // is 255, which is (255 - 128) / 128 = 0.9921875 of full scale, so the RMS
    // of {-1, 0.9921875} averaged is sqrt((1 + 0.9921875²) / 2) = 0.996101…
    expect(levelFromWaveform(Uint8Array.from([0, 255, 0, 255]))).toBeCloseTo(
      0.9961014092842781,
      10,
    );
    // 128 ± 32 is a quarter of full scale either way: (0.25² + 0.25²) / 2 = 0.0625,
    // whose square root is exactly 0.25.
    expect(levelFromWaveform(Uint8Array.from([160, 96]))).toBe(0.25);
  });

  it("answers 0 for an empty buffer rather than NaN", () => {
    expect(levelFromWaveform(new Uint8Array(0))).toBe(0);
  });
});

describe("the size cap's arithmetic", () => {
  it("turns a requested bitrate into bytes per millisecond", () => {
    // 128 kbit/s = 128 000 / 8 = 16 000 bytes a second = 16 bytes a millisecond;
    // an hour is then 16 × 3 600 000 = 57 600 000 bytes, the figure the report
    // states for an hour of voice.
    expect(bytesPerMs(128_000)).toBe(16);
    // 2 500 kbit/s = 312.5 bytes a millisecond; ten minutes is 187 500 000 bytes.
    expect(bytesPerMs(2_500_000)).toBe(312.5);
  });

  it("measures the real rate from what has been written and how long it took", () => {
    expect(measuredBytesPerMs(100_000, 10_000)).toBe(10);
    // Nothing written yet, or no time passed, is no measurement rather than a
    // rate of zero.
    expect(measuredBytesPerMs(0, 10_000)).toBeNull();
    expect(measuredBytesPerMs(100_000, 0)).toBeNull();
    expect(measuredBytesPerMs(0, 0)).toBeNull();
  });

  it("buys time with the room that is left, and none once the cap is reached", () => {
    // 1 000 000-byte cap, 100 000 written, 10 bytes a millisecond: 900 000 bytes
    // of room is 90 000 ms.
    expect(remainingMs(1_000_000, 100_000, 10)).toBe(90_000);
    expect(remainingMs(1_000_000, 1_000_000, 10)).toBe(0);
    expect(remainingMs(1_000_000, 1_000_001, 10)).toBe(0);
    // No rate to divide by: the page falls back to the requested bitrate's
    // estimate rather than showing a number this function invented.
    expect(remainingMs(1_000_000, 0, 0)).toBeNull();
    expect(remainingMs(1_000_000, 0, Number.NaN)).toBeNull();
    expect(remainingMs(1_000_000, 0, -1)).toBeNull();
  });
});

describe("captureElapsedMs", () => {
  it("counts wall-clock time, minus the stretches spent paused", () => {
    expect(captureElapsedMs(1_000, 5_000, 1_000)).toBe(3_000);
    expect(captureElapsedMs(1_000, 5_000, 0)).toBe(4_000);
    // Never negative, however the readings arrive.
    expect(captureElapsedMs(5_000, 1_000, 0)).toBe(0);
  });
});
