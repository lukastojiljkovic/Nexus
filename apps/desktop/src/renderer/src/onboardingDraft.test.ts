import { TOOL_PACKS } from "@nexus/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearOnboardingDraft,
  pruneOnboardingDrafts,
  readOnboardingDraft,
  writeOnboardingDraft,
  type OnboardingDraft,
} from "./onboardingDraft.js";
import { memoryStorage } from "./testStorage.js";

/**
 * ADR-065's in-progress questionnaire state (`nexus.onb.<profileId>`). Pure over
 * `localStorage`, the `accent.ts`/`profilePrefs.ts` recipe — so the tests stub
 * one in memory and no DOM library is involved.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubStorage(seed: Readonly<Record<string, string>> = {}): Storage {
  const storage = memoryStorage(seed);
  vi.stubGlobal("localStorage", storage);
  return storage;
}

const DRAFT: OnboardingDraft = {
  step: "oblasti",
  name: "Luka",
  // Already in `TOOL_PACKS` order, so the plain round-trip test below needs no
  // reordering of its own — the reordering property gets its own test further
  // down, seeded deliberately out of order.
  packs: ["softver", "dizajn"],
  modules: { tasks: true, calendar: true, notes: true, priv: false, study: true },
};

describe("readOnboardingDraft", () => {
  it("is null when nothing is stored", () => {
    stubStorage();
    expect(readOnboardingDraft("p1")).toBeNull();
  });

  it("round-trips a written draft", () => {
    stubStorage();
    writeOnboardingDraft("p1", DRAFT);
    expect(readOnboardingDraft("p1")).toEqual(DRAFT);
  });

  it("keeps each profile's draft to itself", () => {
    stubStorage();
    writeOnboardingDraft("p1", DRAFT);
    expect(readOnboardingDraft("p2")).toBeNull();
  });

  it("is null for unparseable JSON", () => {
    stubStorage({ "nexus.onb.p1": "{not json" });
    expect(readOnboardingDraft("p1")).toBeNull();
  });

  it("is null for a shape this build does not recognise", () => {
    stubStorage({ "nexus.onb.p1": JSON.stringify({ step: 2, name: "Luka", modules: {} }) });
    expect(readOnboardingDraft("p1")).toBeNull();

    stubStorage({ "nexus.onb.p1": JSON.stringify({ step: "ime", name: 7, modules: {} }) });
    expect(readOnboardingDraft("p1")).toBeNull();

    stubStorage({ "nexus.onb.p1": JSON.stringify({ step: "ime", name: "Luka" }) });
    expect(readOnboardingDraft("p1")).toBeNull();

    stubStorage({
      "nexus.onb.p1": JSON.stringify({ step: "ime", name: "Luka", modules: { tasks: "da" } }),
    });
    expect(readOnboardingDraft("p1")).toBeNull();

    stubStorage({ "nexus.onb.p1": JSON.stringify([1, 2, 3]) });
    expect(readOnboardingDraft("p1")).toBeNull();
  });

  it("drops a pack it does not know rather than the whole draft", () => {
    stubStorage({
      "nexus.onb.p1": JSON.stringify({ ...DRAFT, packs: ["softver", "nepostojeci-paket", "dizajn"] }),
    });
    // The unknown id is dropped, not the whole array and not the whole draft —
    // exactly `readOnboardingDraft`'s rule for an occupation this build cannot
    // place, applied to a pack it cannot place either.
    expect(readOnboardingDraft("p1")?.packs).toEqual(["softver", "dizajn"]);
    expect(readOnboardingDraft("p1")?.step).toBe("oblasti");
  });

  it("yields no packs, rather than rejecting the draft, when the stored value is not an array", () => {
    for (const notAnArray of ["softver", 7, null]) {
      stubStorage({ "nexus.onb.p1": JSON.stringify({ ...DRAFT, packs: notAnArray }) });
      expect(readOnboardingDraft("p1")?.packs).toEqual([]);
      // The rest of the draft still comes back — a malformed `packs` is not
      // a malformed draft.
      expect(readOnboardingDraft("p1")?.step).toBe("oblasti");
    }
  });

  it("returns the pack list in TOOL_PACKS order, whatever order it was stored in", () => {
    // Any two distinct packs will do — what is under test is the ORDERING
    // rule, not which two packs they are, so this stays true even if
    // `TOOL_PACKS` is reordered or extended later.
    const [first, second] = TOOL_PACKS;
    stubStorage({ "nexus.onb.p1": JSON.stringify({ ...DRAFT, packs: [second, first] }) });
    expect(readOnboardingDraft("p1")?.packs).toEqual([first, second]);
  });

  it("clamps a stored name to the field's own maximum", () => {
    stubStorage({ "nexus.onb.p1": JSON.stringify({ ...DRAFT, name: "x".repeat(300) }) });
    expect(readOnboardingDraft("p1")?.name).toHaveLength(80);
  });

  it("hands the step back RAW — which list it is valid in is the screen's question", () => {
    stubStorage({ "nexus.onb.p1": JSON.stringify({ ...DRAFT, step: "uloga" }) });
    expect(readOnboardingDraft("p1")?.step).toBe("uloga");
  });
});

describe("clearOnboardingDraft", () => {
  it("forgets one profile's draft and touches no other key", () => {
    const storage = stubStorage({ "nexus.theme": "dan" });
    writeOnboardingDraft("p1", DRAFT);
    writeOnboardingDraft("p2", DRAFT);
    clearOnboardingDraft("p1");
    expect(readOnboardingDraft("p1")).toBeNull();
    expect(readOnboardingDraft("p2")).toEqual(DRAFT);
    expect(storage.getItem("nexus.theme")).toBe("dan");
  });
});

describe("pruneOnboardingDrafts", () => {
  it("drops drafts of profiles that are no longer there and keeps the live ones", () => {
    stubStorage();
    writeOnboardingDraft("live", DRAFT);
    writeOnboardingDraft("deleted", DRAFT);
    pruneOnboardingDrafts(["live"]);
    expect(readOnboardingDraft("live")).toEqual(DRAFT);
    expect(readOnboardingDraft("deleted")).toBeNull();
  });

  it("never touches a key outside its own prefix", () => {
    const storage = stubStorage({
      "nexus.theme": "noc",
      "nexus.activeProfile": "live",
      "nexus.accent.deleted": "bordo",
    });
    writeOnboardingDraft("deleted", DRAFT);
    pruneOnboardingDrafts(["live"]);
    expect(storage.getItem("nexus.theme")).toBe("noc");
    expect(storage.getItem("nexus.activeProfile")).toBe("live");
    expect(storage.getItem("nexus.accent.deleted")).toBe("bordo");
    expect(readOnboardingDraft("deleted")).toBeNull();
  });

  it("drops everything when the live list is empty", () => {
    stubStorage();
    writeOnboardingDraft("p1", DRAFT);
    writeOnboardingDraft("p2", DRAFT);
    pruneOnboardingDrafts([]);
    expect(readOnboardingDraft("p1")).toBeNull();
    expect(readOnboardingDraft("p2")).toBeNull();
  });
});
