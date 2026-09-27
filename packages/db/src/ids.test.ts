import { afterEach, describe, expect, it, vi } from "vitest";
import { uuidv7 } from "./ids.js";

const UUID_V7 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("uuidv7", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("produces canonical lowercase form with version 7 and variant bits", () => {
    for (let i = 0; i < 100; i++) {
      expect(uuidv7()).toMatch(UUID_V7);
    }
  });

  it("sorts lexicographically by generation time (5ms apart)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-05T00:00:00.000Z"));
    const earlier = uuidv7();
    vi.setSystemTime(new Date("2026-07-05T00:00:00.005Z"));
    const later = uuidv7();
    expect(earlier < later).toBe(true);
  });

  /**
   * Stores list rows by a timestamp and then by id, so the id IS the order of
   * everything written in one millisecond — and a batch writes a great deal in
   * one millisecond. With 74 random bits after the timestamp that order was a
   * shuffle: the demo profile's parts, wires and same-day transactions came
   * back in a different order every seed. RFC 9562 §6.2 says a generator
   * SHOULD be monotonic for exactly this case.
   */
  it("sorts ids minted within one millisecond in the order they were minted", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-26T03:00:00.000Z"));
    const minted = Array.from({ length: 5_000 }, () => uuidv7());
    expect([...minted].sort()).toEqual(minted);
  });

  it("keeps sorting forward when the clock steps back", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-26T03:00:00.010Z"));
    const before = uuidv7();
    vi.setSystemTime(new Date("2026-09-26T03:00:00.000Z"));
    const after = uuidv7();
    expect(before < after).toBe(true);
  });

  it("keeps sixty-two random bits in every id, so the sequence is not the whole id", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-26T03:00:00.000Z"));
    const tails = new Set(Array.from({ length: 1_000 }, () => uuidv7().slice(19)));
    expect(tails.size).toBe(1_000);
  });

  it("is unique across 10k generations", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      ids.add(uuidv7());
    }
    expect(ids.size).toBe(10_000);
  });
});
