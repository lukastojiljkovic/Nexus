import { describe, expect, it } from "vitest";

import { compareVersions, isNewerVersion, parseVersion } from "./version.js";

describe("the hand-written version compare", () => {
  it("reads v?MAJOR.MINOR.PATCH and nothing else", () => {
    expect(parseVersion("1.5.0")).toEqual({ major: 1, minor: 5, patch: 0 });
    expect(parseVersion("v2.0.3")).toEqual({ major: 2, minor: 0, patch: 3 });
    expect(parseVersion("1.10.0")).toEqual({ major: 1, minor: 10, patch: 0 });
  });

  it("answers null for anything it cannot read", () => {
    for (const bad of [
      "",
      "1.5",
      "1.5.0.1",
      "one.two.three",
      "1.5.x",
      "latest",
      "-1.0.0",
      // No pre-releases and no build metadata: the product never tags one, and
      // a lexical pre-release order was a downgrade path.
      "1.5.0-rc.1",
      "1.5.0+build.7",
      // No leading zeros, and a lowercase `v` is the only prefix.
      "01.5.0",
      "V1.5.0",
      // Parses as digits but does not fit a safe integer.
      "99999999999999999999.0.0",
    ]) {
      expect(parseVersion(bad), bad).toBeNull();
    }
  });

  it("orders by major, then minor, then patch", () => {
    expect(compareVersions("1.4.0", "1.5.0")).toBeLessThan(0);
    expect(compareVersions("1.5.0", "1.4.9")).toBeGreaterThan(0);
    expect(compareVersions("v1.5.0", "1.5.0")).toBe(0);
    expect(compareVersions("2.0.0", "1.99.99")).toBeGreaterThan(0);
    // Numerically, not lexically: 1.10.0 is newer than 1.9.9.
    expect(compareVersions("1.10.0", "1.9.9")).toBeGreaterThan(0);
    expect(compareVersions("1.9.9", "1.10.0")).toBeLessThan(0);
  });

  it("is undecidable, never falsely older, for an unparseable side", () => {
    expect(compareVersions("latest", "1.4.0")).toBeNull();
    expect(compareVersions("1.4.0", "not-a-version")).toBeNull();
    // `isNewerVersion` answers false here, which is why `decideRelease` checks
    // parseability separately rather than trusting this alone.
    expect(isNewerVersion("latest", "1.4.0")).toBe(false);
  });
});
