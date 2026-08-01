import { describe, expect, it } from "vitest";

import { LICENCE_FONTS, LICENCE_PACKAGES, type LicenceEntry } from "./licences.js";

/**
 * THE gate on `data/licences.json`.
 *
 * **Why this is not a regeneration test.** The stronger test — regenerate and
 * diff — is the one you would write if you could. It cannot run here: the
 * generator shells out to `pnpm licenses list --prod --json`, which needs a
 * package manager on PATH, a fully installed production dependency tree and
 * about twenty seconds, none of which a Vitest run may assume (CI runs the
 * suite in the same job that would be broken by a missing store). So this suite
 * asserts the file's own INVARIANTS instead, and they are chosen to catch the
 * failure a regeneration test would have caught: a dependency change that
 * leaves an entry without a version, without a licence, or — the one that
 * actually matters — claiming a notice it does not carry. Run
 * `pnpm --filter @nexus/desktop licences` after any dependency change; the
 * assertions below are what stop a half-regenerated file from shipping.
 *
 * Nothing here asserts WHICH packages are present. A test that expected "react"
 * would fail the day a bundler changed and would be teaching the file to hold
 * still rather than to be right. The one exception is the font families, which
 * are not dependencies at all: they are copied by `electron.vite.config.ts`, so
 * a family arriving without a notice is exactly the silent gap this work
 * existed to close.
 */

const ALL: readonly LicenceEntry[] = [...LICENCE_PACKAGES, ...LICENCE_FONTS];

/** The operative grant of the SIL OFL — present iff a notice really carries the licence rather than a pointer to it. */
const OFL_GRANT = "Permission is hereby granted, free of charge, to any person obtaining";

describe("the shipped third-party notices", () => {
  it("carries both groups, non-empty", () => {
    expect(LICENCE_PACKAGES.length).toBeGreaterThan(0);
    expect(LICENCE_FONTS.length).toBeGreaterThan(0);
  });

  it("names every entry — an entry with no name, version or licence id is not a notice", () => {
    const bad = ALL.filter(
      (entry) =>
        entry.id.trim().length === 0 ||
        entry.name.trim().length === 0 ||
        entry.version.trim().length === 0 ||
        entry.licence.trim().length === 0,
    ).map((entry) => entry.id);
    expect(bad).toEqual([]);
  });

  it("cites a source for every entry, proved or not", () => {
    expect(ALL.filter((entry) => entry.source.trim().length === 0).map((e) => e.id)).toEqual([]);
  });

  it("carries no duplicate id — one key, one notice, across both groups", () => {
    const seen = new Set<string>();
    const duplicates: string[] = [];
    for (const entry of ALL) {
      if (seen.has(entry.id)) duplicates.push(entry.id);
      seen.add(entry.id);
    }
    expect(duplicates).toEqual([]);
  });

  it("namespaces its two groups, so a font and a package can never collide", () => {
    expect(LICENCE_PACKAGES.filter((entry) => !entry.id.startsWith("npm:"))).toEqual([]);
    expect(LICENCE_FONTS.filter((entry) => !entry.id.startsWith("font:"))).toEqual([]);
  });

  it("is sorted by id in both groups — the generator's determinism, checked from the outside", () => {
    for (const group of [LICENCE_PACKAGES, LICENCE_FONTS]) {
      const ids = group.map((entry) => entry.id);
      expect(ids).toEqual([...ids].sort());
    }
  });

  it("uses only the three declared statuses", () => {
    const unknown = ALL.map((entry) => entry.status).filter(
      (status) => !["file", "declared-only", "unknown"].includes(status),
    );
    expect(unknown).toEqual([]);
  });

  // The load-bearing one. `status` is what the screen believes, so it must not
  // be able to claim a text that is not there, nor hide one that is.
  it("gives every entry either a real notice or an explicit not-established marker", () => {
    const lying = ALL.filter((entry) =>
      entry.status === "declared-only"
        ? entry.notice.length > 0 || entry.licence === "UNKNOWN"
        : entry.notice.trim().length === 0,
    ).map((entry) => `${entry.id} (${entry.status})`);
    expect(lying).toEqual([]);
  });

  it("never marks an entry `unknown` while naming a licence for it", () => {
    const named = ALL.filter(
      (entry) => entry.status === "unknown" && entry.licence !== "UNKNOWN",
    ).map((entry) => entry.id);
    expect(named).toEqual([]);
  });

  it("stores every notice normalised — LF, no BOM, no trailing blank", () => {
    const bad = ALL.filter(
      (entry) =>
        entry.notice.includes("\r") ||
        entry.notice.includes("\uFEFF") ||
        entry.notice !== entry.notice.trimEnd(),
    ).map((entry) => entry.id);
    expect(bad).toEqual([]);
  });

  it("covers every font family the build copies, and no other", () => {
    // The families are `electron.vite.config.ts`'s to decide; the generator
    // reads that file's own DROPPED_FAMILIES so the two cannot drift. Two are
    // left out and must stay out — Xiaolai (a CJK fallback, 12.4 MB) and
    // Liberation Sans (licence not establishable, and `serverSide` so no
    // element can select it). Listing a notice for a font that does not ship is
    // as wrong as omitting one for a font that does.
    expect(LICENCE_FONTS.map((entry) => entry.id)).toEqual([
      "font:Assistant",
      "font:Cascadia",
      "font:ComicShanns",
      "font:Excalifont",
      "font:Lilita",
      "font:Nunito",
      "font:Virgil",
    ]);
  });

  /**
   * The one invariant that is a POLICY rather than a shape check, and the
   * reason it belongs to the fonts alone: a dependency arrives with whatever
   * licence its author gave it, but a bundled font is a file this build chose
   * to copy. „We ship it and cannot say under what terms" is not a state this
   * product may reach, so a future Excalidraw upgrade that adds a family whose
   * licence cannot be read out of the file must fail here — and the fix is a
   * decision (establish the terms, or drop the family), never a regeneration.
   */
  it("ships no font whose licence could not be established", () => {
    const unestablished = LICENCE_FONTS.filter(
      (entry) => entry.status !== "file" || entry.licence === "UNKNOWN",
    ).map((entry) => `${entry.id} (${entry.licence})`);
    expect(unestablished).toEqual([]);
  });

  it("reproduces the whole licence for every font that declares the OFL, not a reference to it", () => {
    // OFL 1.1 §2 is explicit: a bundled font travels with „the above copyright
    // notice and this license". A family whose own metadata carries only the
    // short declaration gets the full text merged in by the generator, and this
    // is what proves the merge happened.
    const short = LICENCE_FONTS.filter(
      (entry) => entry.licence === "OFL-1.1" && !entry.notice.includes(OFL_GRANT),
    ).map((entry) => entry.id);
    expect(short).toEqual([]);
  });

  it("keeps every font notice attributed — a licence without its copyright line is half a notice", () => {
    // Every shipped family is `file` now, so this covers all of them. The
    // `status` filter stays anyway: it is what keeps this test honest if a
    // family ever arrives that the test above has to be argued with.
    const anonymous = LICENCE_FONTS.filter(
      (entry) => entry.status === "file" && !/copyright|©/i.test(entry.notice),
    ).map((entry) => entry.id);
    expect(anonymous).toEqual([]);
  });
});
