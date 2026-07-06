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

  it("is unique across 10k generations", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      ids.add(uuidv7());
    }
    expect(ids.size).toBe(10_000);
  });
});
