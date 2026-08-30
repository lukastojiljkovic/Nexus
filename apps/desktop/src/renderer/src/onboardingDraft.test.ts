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
 * ADR-065's in-progress questionnaire state (`nexus.onb.<profileId>`), carrying
 * ADR-086's signals since the flow stopped collecting ticked boxes. Pure over
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
  step: "ritam",
  name: "Luka",
  trade: "stolar",
  signals: [
    { kind: "week", id: "firma" },
    { kind: "trade", pack: "zanat", term: "stolar", via: "typed" },
    { kind: "keep", id: "novac" },
  ],
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
    stubStorage({ "nexus.onb.p1": JSON.stringify({ step: 2, name: "Luka", signals: [] }) });
    expect(readOnboardingDraft("p1")).toBeNull();

    stubStorage({ "nexus.onb.p1": JSON.stringify({ step: "ime", name: 7, signals: [] }) });
    expect(readOnboardingDraft("p1")).toBeNull();

    stubStorage({ "nexus.onb.p1": JSON.stringify([1, 2, 3]) });
    expect(readOnboardingDraft("p1")).toBeNull();
  });

  it("drops a signal it cannot narrow rather than the whole draft", () => {
    stubStorage({
      "nexus.onb.p1": JSON.stringify({
        ...DRAFT,
        signals: [{ kind: "week", id: "firma" }, { kind: "week", id: "astronaut" }, 7],
      }),
    });
    // The unrecognised entries are dropped, not the whole array and not the
    // whole draft — a person who is mid-answer keeps the answers this build can
    // still make sense of.
    expect(readOnboardingDraft("p1")?.signals).toEqual([{ kind: "week", id: "firma" }]);
    expect(readOnboardingDraft("p1")?.step).toBe("ritam");
  });

  it("yields no signals, rather than rejecting the draft, when the stored value is not an array", () => {
    for (const notAnArray of ["week", 7, null]) {
      stubStorage({ "nexus.onb.p1": JSON.stringify({ ...DRAFT, signals: notAnArray }) });
      expect(readOnboardingDraft("p1")?.signals).toEqual([]);
      // The rest of the draft still comes back — a malformed `signals` is not
      // a malformed draft.
      expect(readOnboardingDraft("p1")?.step).toBe("ritam");
    }
  });

  it("keeps the trade sentence, clamped, and yields an empty one when it is missing", () => {
    stubStorage({ "nexus.onb.p1": JSON.stringify({ ...DRAFT, trade: "x".repeat(300) }) });
    expect(readOnboardingDraft("p1")?.trade).toHaveLength(120);

    stubStorage({ "nexus.onb.p1": JSON.stringify({ step: "ime", name: "Luka" }) });
    expect(readOnboardingDraft("p1")?.trade).toBe("");
  });

  it("reads an ADR-065 draft as its name and nothing else", () => {
    // The old flow's in-progress state: ticked boxes, no signals. There is no
    // honest conversion from a setting to a statement about a person, so the
    // answers go and the typed name — the one thing that is annoying to retype
    // — stays. `resumeStep` refuses the old screen id on its own.
    stubStorage({
      "nexus.onb.p1": JSON.stringify({
        step: "oblasti",
        name: "Luka",
        packs: ["softver", "dizajn"],
        modules: { tasks: true, priv: false },
      }),
    });
    expect(readOnboardingDraft("p1")).toEqual({ step: "oblasti", name: "Luka", signals: [], trade: "" });
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

  it("leaves the profile's ANSWERS alone — the draft is a resume point, not the record", () => {
    // `signalPrefs.ts` owns `nexus.profile.signals.<id>` and it outlives the
    // run: completion clears the draft and keeps the answers, which is what
    // „Kako je Nexus podešen za tebe" reads a year later.
    const storage = stubStorage({ "nexus.profile.signals.p1": "[]" });
    writeOnboardingDraft("p1", DRAFT);
    clearOnboardingDraft("p1");
    expect(storage.getItem("nexus.profile.signals.p1")).toBe("[]");
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
