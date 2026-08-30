import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearStoredSignals,
  parseSignalList,
  persistSignals,
  readStoredSignals,
} from "./signalPrefs.js";
import { memoryStorage } from "./testStorage.js";

/**
 * ADR-086: the profile's stored ANSWERS (`nexus.profile.signals.<profileId>`).
 * Pure over `localStorage`, the `accent.ts`/`profilePrefs.ts` recipe — so the
 * tests stub one in memory and no DOM library is involved.
 *
 * What is actually under test is the narrowing. `localStorage` is writable by
 * anything with a devtools console, and a plan built from a signal whose `pack`
 * is not a pack would compose a board out of a widget id nothing publishes — so
 * every field is checked, and a bad entry costs its own entry and nothing else.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubStorage(seed: Readonly<Record<string, string>> = {}): Storage {
  const storage = memoryStorage(seed);
  vi.stubGlobal("localStorage", storage);
  return storage;
}

const ANSWERS = [
  { kind: "week", id: "firma" },
  { kind: "trade", pack: "zanat", term: "stolar", via: "typed" },
  { kind: "tempo", id: "reaktivan" },
  { kind: "keep", id: "novac" },
] as const;

describe("parseSignalList", () => {
  it("narrows all four kinds", () => {
    expect(parseSignalList([...ANSWERS])).toEqual([...ANSWERS]);
  });

  it("is empty for anything that is not an array", () => {
    for (const value of [null, undefined, 7, "week", { kind: "week", id: "firma" }]) {
      expect(parseSignalList(value)).toEqual([]);
    }
  });

  it("drops an entry whose id is not one this build knows, and keeps the rest", () => {
    expect(
      parseSignalList([
        { kind: "week", id: "astronaut" },
        { kind: "tempo", id: "planer" },
        { kind: "keep", id: "kriptovalute" },
      ]),
    ).toEqual([{ kind: "tempo", id: "planer" }]);
  });

  it("refuses a trade whose pack is not a pack — what a board would be composed from", () => {
    expect(
      parseSignalList([{ kind: "trade", pack: "svemir", term: "astronaut", via: "typed" }]),
    ).toEqual([]);
  });

  it("refuses a trade with an empty term or an unknown provenance", () => {
    expect(parseSignalList([{ kind: "trade", pack: "zanat", term: "", via: "typed" }])).toEqual([]);
    expect(
      parseSignalList([{ kind: "trade", pack: "zanat", term: "stolar", via: "guessed" }]),
    ).toEqual([]);
  });

  it("refuses a kind it has no case for, and every non-object entry", () => {
    expect(parseSignalList([{ kind: "horoskop", id: "vaga" }, 7, null, "week", []])).toEqual([]);
  });

  it("keeps the order it was given — the person's own emphasis survives to the plan", () => {
    const reversed = [...ANSWERS].reverse();
    expect(parseSignalList(reversed)).toEqual(reversed);
  });
});

describe("readStoredSignals", () => {
  it("is empty when nothing is stored", () => {
    stubStorage();
    expect(readStoredSignals("p1")).toEqual([]);
  });

  it("round-trips what was written", () => {
    stubStorage();
    persistSignals("p1", [...ANSWERS]);
    expect(readStoredSignals("p1")).toEqual([...ANSWERS]);
  });

  it("keeps each profile's answers to itself", () => {
    stubStorage();
    persistSignals("p1", [...ANSWERS]);
    expect(readStoredSignals("p2")).toEqual([]);
  });

  it("is empty for unparseable JSON", () => {
    stubStorage({ "nexus.profile.signals.p1": "{not json" });
    expect(readStoredSignals("p1")).toEqual([]);
  });
});

describe("persistSignals", () => {
  it("REMOVES the key for an empty list — „answered nothing“ has one representation", () => {
    const storage = stubStorage();
    persistSignals("p1", [...ANSWERS]);
    persistSignals("p1", []);
    // Not `"[]"`: a stored empty array and no key at all both mean the same
    // thing to `buildProfilePlan`, and two spellings of one fact is one
    // spelling too many.
    expect(storage.getItem("nexus.profile.signals.p1")).toBeNull();
    expect(readStoredSignals("p1")).toEqual([]);
  });
});

describe("clearStoredSignals", () => {
  it("forgets one profile's answers and touches no other key", () => {
    const storage = stubStorage({ "nexus.theme": "dan" });
    persistSignals("p1", [...ANSWERS]);
    persistSignals("p2", [...ANSWERS]);
    clearStoredSignals("p1");
    expect(readStoredSignals("p1")).toEqual([]);
    expect(readStoredSignals("p2")).toEqual([...ANSWERS]);
    expect(storage.getItem("nexus.theme")).toBe("dan");
  });
});
