import { afterEach, describe, expect, it, vi } from "vitest";

import type { Profile } from "../../shared/ipc.js";
import {
  persistActiveProfile,
  profileDisplayName,
  readStoredActiveProfileId,
  resolveActiveProfile,
} from "./profilePrefs.js";
import { strings } from "./strings.js";
import { memoryStorage } from "./testStorage.js";

/**
 * The last-active-profile device preference (ADR-058 §1) and the display-name
 * fallback the empty-name business sentinel needs. Pure over `localStorage`
 * and a profile list — no IPC, no DOM beyond the storage stub, exactly the
 * `calendarPrefs` recipe the module follows.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Installs a fresh in-memory `localStorage`, optionally pre-seeded, and hands it back for direct inspection. */
function stubStorage(seed: Readonly<Record<string, string>> = {}): Storage {
  const storage = memoryStorage(seed);
  vi.stubGlobal("localStorage", storage);
  return storage;
}

/** A profile row with the fields this module actually reads; the picture triplet is null, as a fresh row's is. */
function profile(id: string, kind: Profile["kind"], name: string): Profile {
  return {
    id,
    kind,
    name,
    createdAt: "2026-07-01T00:00:00.000Z",
    pictureHash: null,
    pictureMime: null,
    pictureSizeBytes: null,
  };
}

// --- readStoredActiveProfileId ------------------------------------------------

describe("readStoredActiveProfileId", () => {
  it("is null when nothing is stored", () => {
    stubStorage();
    expect(readStoredActiveProfileId()).toBeNull();
  });

  it("hands the raw stored id back — validation belongs to resolveActiveProfile", () => {
    stubStorage({ "nexus.activeProfile": "profile-7" });
    expect(readStoredActiveProfileId()).toBe("profile-7");
  });

  it("treats a blank stored value as nothing stored", () => {
    stubStorage({ "nexus.activeProfile": "" });
    expect(readStoredActiveProfileId()).toBeNull();

    stubStorage({ "nexus.activeProfile": "   " });
    expect(readStoredActiveProfileId()).toBeNull();
  });
});

// --- persistActiveProfile -----------------------------------------------------

describe("persistActiveProfile", () => {
  it("round-trips through readStoredActiveProfileId", () => {
    stubStorage();
    persistActiveProfile("profile-9");
    expect(readStoredActiveProfileId()).toBe("profile-9");
  });

  it("touches no other key", () => {
    const storage = stubStorage({ "nexus.theme": "dan", "nexus.accent.p1": "bordo" });
    persistActiveProfile("profile-9");
    expect(storage.getItem("nexus.theme")).toBe("dan");
    expect(storage.getItem("nexus.accent.p1")).toBe("bordo");
  });
});

// --- resolveActiveProfile -----------------------------------------------------

describe("resolveActiveProfile", () => {
  const personal = profile("p-personal", "personal", "Luka");
  const business = profile("p-business", "business", "Posao Lukin");

  it("returns the stored profile while it is still in the live list", () => {
    stubStorage({ "nexus.activeProfile": "p-business" });
    expect(resolveActiveProfile([personal, business])).toBe(business);
  });

  it("falls back to the personal profile for a stale stored id", () => {
    stubStorage({ "nexus.activeProfile": "deleted-long-ago" });
    expect(resolveActiveProfile([business, personal])).toBe(personal);
  });

  it("falls back to the personal profile when nothing is stored", () => {
    stubStorage();
    expect(resolveActiveProfile([business, personal])).toBe(personal);
  });

  it("falls back to the first profile when no personal one exists", () => {
    // Defensive only: the personal profile is the account's anchor and the
    // store refuses to delete it — but a fallback that returns undefined for a
    // non-empty list would gate the whole shell on that invariant.
    stubStorage({ "nexus.activeProfile": "stale" });
    expect(resolveActiveProfile([business])).toBe(business);
  });

  it("is undefined only for an empty list", () => {
    stubStorage();
    expect(resolveActiveProfile([])).toBeUndefined();
  });
});

// --- profileDisplayName -------------------------------------------------------

describe("profileDisplayName", () => {
  it("is the profile's own trimmed name whenever one is set", () => {
    expect(profileDisplayName(profile("p1", "personal", "Luka"))).toBe("Luka");
    expect(profileDisplayName(profile("p2", "business", "  Firma  "))).toBe("Firma");
  });

  it("falls back to „Posao“ for a business profile still carrying the empty-name sentinel", () => {
    expect(profileDisplayName(profile("p2", "business", ""))).toBe(strings.profiles.businessLabel);
    expect(profileDisplayName(profile("p2", "business", "   "))).toBe(
      strings.profiles.businessLabel,
    );
  });

  it("leaves an unnamed personal profile empty — the ONB gate owns that state, nothing ever lists it", () => {
    expect(profileDisplayName(profile("p1", "personal", ""))).toBe("");
  });
});
