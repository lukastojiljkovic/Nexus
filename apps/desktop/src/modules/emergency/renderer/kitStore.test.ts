import { addKitEntry, defaultKit, toggleKitEntry } from "@nexus/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readKit, writeKit } from "./kitStore.js";

/** A `localStorage` that holds strings, which is all the page ever asks of it. */
function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
    clear: () => {
      values.clear();
    },
    key: () => null,
    get length() {
      return values.size;
    },
  } as Storage;
}

describe("the kit checklist's storage", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", memoryStorage());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("answers the defaults for nothing stored", () => {
    expect(readKit("p1")).toEqual(defaultKit());
  });

  it("reads back what was written, for that profile and no other", () => {
    const kit = addKitEntry(toggleKitEntry(defaultKit(), "water"), "Cash");
    writeKit("p1", kit);
    expect(readKit("p1")).toEqual(kit);
    expect(readKit("p2")).toEqual(defaultKit());
  });

  it("falls back to the defaults for a stored value it did not write, or one that is not JSON", () => {
    localStorage.setItem("nexus.emergency.p1.kit72", "{not json");
    expect(readKit("p1")).toEqual(defaultKit());
    localStorage.setItem("nexus.emergency.p1.kit72", JSON.stringify([{ id: "nope", text: null, done: true }]));
    expect(readKit("p1")).toEqual(defaultKit());
  });

  it("falls back to the defaults when there is no storage at all", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(readKit("p1")).toEqual(defaultKit());
  });
});
