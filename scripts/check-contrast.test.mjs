// Unit tests for `check-contrast.mjs`. The gate exists because a palette
// picked by eye went four months without anyone noticing that Dan's muted text
// — the colour of the most common element in the product — sat under the WCAG
// AA floor. A gate that silently stops computing the right number would put us
// straight back there, so the arithmetic is pinned against values that can be
// checked by hand, not against whatever the implementation currently returns.

import { describe, expect, it } from "vitest";

import {
  AA_BODY,
  auditAll,
  auditPalette,
  auditTheme,
  contrast,
  luminance,
} from "./check-contrast.mjs";

describe("luminance", () => {
  it("puts black at 0 and white at 1 — the two ends of the definition", () => {
    expect(luminance("#000000")).toBe(0);
    expect(luminance("#ffffff")).toBeCloseTo(1, 10);
  });

  it("weights green far above red and red above blue, per the coefficients", () => {
    const red = luminance("#ff0000");
    const green = luminance("#00ff00");
    const blue = luminance("#0000ff");
    expect(green).toBeCloseTo(0.7152, 4);
    expect(red).toBeCloseTo(0.2126, 4);
    expect(blue).toBeCloseTo(0.0722, 4);
    expect(green).toBeGreaterThan(red);
    expect(red).toBeGreaterThan(blue);
  });

  it("accepts a leading # or none, and any case", () => {
    expect(luminance("#F7F4EE")).toBeCloseTo(luminance("f7f4ee"), 12);
  });

  it("refuses anything that is not #rrggbb, rather than scoring it", () => {
    // A gate that quietly scored a shorthand or a token ref as 0 would report
    // a perfect 21:1 and pass everything.
    expect(() => luminance("#fff")).toThrow(/not a #rrggbb colour/);
    expect(() => luminance("{color.paper.600}")).toThrow(/not a #rrggbb colour/);
    expect(() => luminance("rgb(0,0,0)")).toThrow(/not a #rrggbb colour/);
  });
});

describe("contrast", () => {
  it("gives the maximum 21:1 for black on white", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 6);
  });

  it("gives 1:1 for a colour against itself", () => {
    expect(contrast("#8a6410", "#8a6410")).toBeCloseTo(1, 12);
  });

  it("is order-independent, because a ratio has no foreground", () => {
    expect(contrast("#221e18", "#f7f4ee")).toBeCloseTo(contrast("#f7f4ee", "#221e18"), 12);
  });

  it("reproduces the failure this gate was written for", () => {
    // The shipped value on 2026-08-07: paper.600 on paper.200 (Dan's
    // `textMuted` on `surfaceAlt`). Hand-computed at 4.01:1.
    expect(contrast("#7a7160", "#efeadd")).toBeCloseTo(4.01, 2);
    expect(contrast("#7a7160", "#efeadd")).toBeLessThan(AA_BODY);
  });

  it("confirms the replacement clears the floor on the tightest ground", () => {
    expect(contrast("#6d6452", "#efeadd")).toBeGreaterThanOrEqual(AA_BODY);
  });
});

describe("the live palette", () => {
  it("has no pair below AA in either theme", () => {
    // The regression test proper: this is the assertion that fails the build
    // when someone nudges a token by eye.
    expect(auditAll()).toEqual([]);
  });

  it("actually examines both themes, not just the first", () => {
    for (const theme of ["dan", "noc"]) {
      const { failures, checked } = auditTheme(theme);
      expect(failures).toEqual([]);
      // 27 palette-wide pairs + 6 per accent × 8 accents. Pinned as a number so
      // that narrowing the walk — the way this gate would rot — fails here
      // rather than passing quietly with less coverage.
      //
      // It went 15 → 27 with the 2026-08-08 ramp, in four steps, and each is
      // the point of the pin: `surfaceRaised` and `surfaceSunken` as new
      // grounds (+4); `textSubtle` on the three grounds, because the tier
      // demoted out of `textMuted` is still set as text (+3); `textFaint` on
      // two grounds at the 3:1 NON-TEXT floor, because it is a mark and holding
      // it to the body floor would delete the tier (+2); and the three hairline
      // pairs, which are checked as a BAND rather than a floor (+3).
      // +12 with the ELEC workbench (DEV-006): the nine jumper colours against
      // the bench and a component's outline against both its own body and the
      // bench, each at the 3:1 NON-TEXT floor because a wire is a mark rather
      // than prose; plus the grid, which is held to the HAIRLINE band instead.
      expect(checked).toBe(87);
    }
  });
});

describe("the auditor itself", () => {
  // Without these, „the auditor found nothing" and „the auditor looks at
  // nothing" are the same green tick — which is precisely how the original
  // defect survived four months of green builds.
  const legible = { bg: "#ffffff", surface: "#ffffff", text: "#000000", textMuted: "#595959" };

  it("catches muted text that is one step too light", () => {
    // #767676 on white is ~4.54:1 (passes); #7a7a7a is ~4.39 (fails).
    const { failures } = auditPalette("test", { ...legible, textMuted: "#7a7a7a" });
    expect(failures).not.toEqual([]);
    expect(failures.every((f) => f.fgRole === "textMuted")).toBe(true);
    expect(failures[0].ratio).toBeLessThan(AA_BODY);
  });

  it("passes the same palette one step darker", () => {
    expect(auditPalette("test", { ...legible, textMuted: "#767676" }).failures).toEqual([]);
  });

  it("audits an accent override, not only the base palette", () => {
    const { failures } = auditPalette("test", legible, {
      // Legible base, illegible accent — only an accent-aware walk sees this.
      pale: { accent: "#e8e8e8", accentSoft: "#ffffff", accentStrong: "#eeeeee" },
    });
    expect(failures.length).toBeGreaterThan(0);
    expect(failures.some((f) => f.why.includes("pale"))).toBe(true);
  });

  it("skips a pair whose role is absent rather than scoring undefined", () => {
    const { failures, checked } = auditPalette("test", { bg: "#ffffff", text: "#000000" });
    expect(failures).toEqual([]);
    expect(checked).toBeGreaterThan(0);
  });
});
