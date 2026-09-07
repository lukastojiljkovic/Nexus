import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  LAYER_VALUE_RE,
  findScanFiles,
  readLayerScale,
  scaleFaults,
  scanSource,
} from "./check-layers.mjs";

/**
 * `check:layers` makes „a stacking order is app-wide" structural.
 *
 * The class: twenty-two z-index declarations across eleven files, each chosen
 * at its own call site, so `1` meant „pinned over my rows" in seven places and
 * „the lower of two pinned ranks" in an eighth, while `2` meant „the ghost
 * being dragged" in two files and „a pinned header" in two others. Nothing in
 * the repository could see it: every value is a valid integer, no gate reads
 * stacking, and the sweep photographs a correct order and an accidental one
 * identically — the two only differ when two boxes meet, which on most frames
 * they never do.
 *
 * So this suite carries the burden the run cannot: it shows the rule FIRING.
 * A gate whose tests only assert the tree is clean is indistinguishable from a
 * gate that examines nothing, and this one went green on its first execution.
 */

describe("LAYER_VALUE_RE", () => {
  it("accepts the two forms a stacking value may take", () => {
    expect(LAYER_VALUE_RE.test("auto")).toBe(true);
    expect(LAYER_VALUE_RE.test("var(--nx-layer-dialog)")).toBe(true);
    expect(LAYER_VALUE_RE.test("var( --nx-layer-drawer-scrim )")).toBe(true);
  });

  /**
   * The point of the rule. `0` and `-1` are refused ALONGSIDE `70`, and that is
   * deliberate rather than strict: `--nx-layer-ground` and `--nx-layer-under`
   * exist precisely so the two non-ladder cases have names too, which is what
   * leaves the gate with nothing to exempt.
   */
  it("refuses every bare number, including the two that are not ladder positions", () => {
    for (const value of ["0", "-1", "1", "2", "70", "9999"]) {
      expect(LAYER_VALUE_RE.test(value)).toBe(false);
    }
  });

  it("refuses a token from another group, which is the near miss a spelling rule would allow", () => {
    expect(LAYER_VALUE_RE.test("var(--nx-space-4)")).toBe(false);
  });

  /** Half a value is not a value: `calc()` around a layer is arithmetic on a name. */
  it("refuses a layer buried in an expression", () => {
    expect(LAYER_VALUE_RE.test("calc(var(--nx-layer-menu) + 1)")).toBe(false);
    expect(LAYER_VALUE_RE.test("var(--nx-layer-menu) 2")).toBe(false);
  });
});

describe("scanCss, through scanSource", () => {
  const css = (body) => scanSource("a.css", body);

  it("reports a bare number and the line it is on", () => {
    expect(css(".a {\n  position: sticky;\n  z-index: 5;\n}")).toEqual([{ line: 3, value: "5" }]);
  });

  it("passes a named layer", () => {
    expect(css(".a { z-index: var(--nx-layer-drawer); }")).toEqual([]);
  });

  /**
   * The comment strip is not cosmetic here. Four of the rewritten comments in
   * `notes.css` discuss this very property — „`z-index: 0` against the header's
   * own `position: relative`" — and a gate that fires on prose ABOUT itself is
   * how `check:egress` learned people stop writing the prose.
   */
  it("does not read a comment as a declaration", () => {
    expect(css("/* z-index: 5 was wrong */\n.a { z-index: var(--nx-layer-figure); }")).toEqual([]);
  });

  /** A value may wrap; the line reported is the declaration's, not the value's. */
  it("survives a wrapped declaration", () => {
    expect(css(".a {\n  z-index:\n    5;\n}")).toEqual([{ line: 2, value: "5" }]);
  });

  /**
   * The one false positive a substring rule would produce, and the reason the
   * pattern requires a boundary before `z-index`: a custom property whose name
   * ENDS in it is a different declaration entirely.
   */
  it("does not fire on a custom property whose name ends in the word", () => {
    expect(css(".a { --panel-z-index: 5; }")).toEqual([]);
  });
});

describe("scanTypeScript, through scanSource", () => {
  const tsx = (body) => scanSource("a.tsx", body);

  /**
   * The reason this gate reads two languages. `useAnchoredPosition` builds a
   * `CSSProperties` object for every portalled panel — the boxes at the very
   * top of this ladder — so leaving JS unscanned would close the class in CSS
   * and leave it open one file away.
   */
  it("reports a number in a style object", () => {
    expect(tsx("const style = { zIndex: 70 };")).toEqual([{ line: 1, value: "70" }]);
  });

  it("reports a direct assignment", () => {
    expect(tsx("panel.style.zIndex = '70';")).toEqual([{ line: 1, value: "'70'" }]);
  });

  it("reports the CSSOM spelling", () => {
    expect(tsx('el.style.setProperty("z-index", "70");')).toEqual([{ line: 1, value: '"70"' }]);
  });

  it("passes a named layer in any of the three", () => {
    expect(tsx('const s = { zIndex: "var(--nx-layer-menu)" };')).toEqual([]);
    expect(tsx('p.style.zIndex = "var(--nx-layer-menu)";')).toEqual([]);
    expect(tsx('p.style.setProperty("z-index", "var(--nx-layer-menu)");')).toEqual([]);
  });

  /**
   * The discriminator that makes this an AST pass rather than a grep for the
   * identifier: `shots/audit.ts` READS `style.zIndex` on every positioned box
   * it measures, and a text rule would report the audit's own instrument as a
   * violation of the thing it measures.
   */
  it("does not fire on a read", () => {
    expect(tsx("const z = style.zIndex;")).toEqual([]);
    expect(tsx("boxes.push({ z: style.zIndex });")).toEqual([]);
  });

  /**
   * A computed value is reported rather than waved through. The gate cannot
   * read inside it, and „could not tell" must not resolve to „allowed" — that
   * is the failure mode that made `check-colours`'s escape hatch fail open.
   */
  it("reports a value it cannot read", () => {
    expect(tsx("const s = { zIndex: base + 1 };")).toEqual([{ line: 1, value: "base + 1" }]);
  });

  it("reports the shorthand, which carries no value at all", () => {
    expect(tsx("const s = { zIndex };")).toEqual([{ line: 1, value: "zIndex" }]);
  });
});

describe("the scale itself", () => {
  /**
   * The half a spelling rule would miss entirely. Every call site names a
   * layer, so editing `dialog` down to 4 in the token source would leave all
   * twenty-two of them passing while dialogs painted under drawers.
   */
  it("catches a layer that stops sitting above the one before it", () => {
    expect(scaleFaults([["drawer", 5], ["dialog", 4]])).toEqual([
      "layer.dialog (4) does not sit above layer.drawer (5) — " +
        "the declaration order in global.json IS the stacking order",
    ]);
  });

  it("catches an equal pair, which is an order that does not decide", () => {
    expect(scaleFaults([["a", 5], ["b", 5]])).toHaveLength(1);
  });

  it("catches a value that is not an integer", () => {
    expect(scaleFaults([["a", Number.NaN]])).toEqual(["layer.a = NaN is not an integer"]);
  });

  it("passes an increasing scale", () => {
    expect(scaleFaults([["under", -1], ["ground", 0], ["menu", 70]])).toEqual([]);
  });

  it("the real scale is one, and it opens below the content it is measured against", () => {
    const scale = readLayerScale();
    expect(scaleFaults(scale)).toEqual([]);
    expect(scale[0]).toEqual(["under", -1]);
    expect(scale.at(-1)).toEqual(["menu", 70]);
  });
});

describe("the live tree", () => {
  it("names every stacking value it sets", () => {
    const findings = findScanFiles().flatMap((file) =>
      scanSource(file, readFileSync(file, "utf8")).map((hit) => `${file}:${hit.line}`),
    );
    expect(findings).toEqual([]);
  });

  /**
   * A clean tree is also what a scanner pointed at nothing returns. This is the
   * assertion that tells the two apart — `check:tiers` shipped with a scan that
   * stopped at the first `>` and looked exactly this green.
   */
  it("is actually reading the stylesheets", () => {
    const files = findScanFiles();
    expect(files.length).toBeGreaterThan(500);
    const css = files.filter((f) => f.endsWith(".css"));
    const declarations = css.filter((f) => /^\s*z-index\s*:/m.test(readFileSync(f, "utf8")));
    expect(declarations.length).toBeGreaterThanOrEqual(11);
  });
});
