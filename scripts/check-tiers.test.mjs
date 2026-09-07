import { describe, expect, it } from "vitest";

import { classesDeclaringTheTier, elementsByClass, scanRepo } from "./check-tiers.mjs";

/**
 * `check:tiers` makes „adopt the shared tier" structural instead of remembered.
 *
 * The class it enforces is DC-02 one tier below the eyebrow: thirty-three
 * classes across fifteen stylesheets had written out `.nx-hint`'s declarations
 * by hand, and every one of them was locally correct — tokens throughout,
 * `check:colours` and `check:tokens` green, and each rule perfectly readable on
 * its own. The damage only exists in the aggregate: four leadings for one tier,
 * three measures including a raw `64ch`, and forty-eight paragraphs whose class
 * never reset the UA's `<p>` margin, so the same sentence sat differently on
 * eleven screens.
 *
 * What this suite has to show is the two halves of the discriminator, because
 * either one alone gives a gate nobody keeps. Ink-and-size alone fires on a
 * disclosure BUTTON and on an inline `<span>`; „is a `<p>`" alone fires on every
 * paragraph in the app.
 */

describe("classesDeclaringTheTier", () => {
  const HINT = [
    ".a__note {",
    "  margin: 0;",
    "  color: var(--nx-text-muted);",
    "  font-size: var(--nx-font-size-body-sm);",
    "}",
  ].join("\n");

  it("finds a rule that re-declares the tier", () => {
    expect([...classesDeclaringTheTier(HINT).keys()]).toEqual(["a__note"]);
  });

  it("reports the line the reader has to open", () => {
    expect(classesDeclaringTheTier(`\n\n${HINT}`).get("a__note")).toBe(3);
  });

  /**
   * `.a, .b { … }` is two copies of one block. Three of the folded rules were
   * written that way, and a scanner that took only the first selector would
   * have left the second copy in the tree, still drifting.
   */
  it("counts every class in a selector list, not just the first", () => {
    const css = HINT.replace(".a__note {", ".a__note,\n.b__note {");
    expect([...classesDeclaringTheTier(css).keys()].sort()).toEqual(["a__note", "b__note"]);
  });

  it("says nothing about a rule that is muted but not 13px", () => {
    expect(classesDeclaringTheTier(HINT.replace("body-sm", "caption")).size).toBe(0);
  });

  it("says nothing about a rule that is 13px but not muted", () => {
    expect(classesDeclaringTheTier(HINT.replace("text-muted", "danger")).size).toBe(0);
  });

  /**
   * The declaration is matched from its own start, not as a substring of the
   * block. `border-color: var(--nx-text-muted)` contains the ink test exactly,
   * and a card with a muted hairline over 13px text is not a paragraph tier.
   */
  it("does not read `border-color` as `color`", () => {
    const card = HINT.replace("  color:", "  border-color:");
    expect(classesDeclaringTheTier(card).size).toBe(0);
  });

  it("reads a declaration written without its space", () => {
    const tight = HINT.replace("color: var", "color:var");
    expect([...classesDeclaringTheTier(tight).keys()]).toEqual(["a__note"]);
  });

  /**
   * `.elec-sim__readout` is the live instance: a `<p>`, muted, 13px — and mono
   * with tabular figures, because it is the simulator's tick counter. A block
   * that names its own face has declared itself a different tier out loud, and
   * folding it would mean overriding the family and the measure straight back.
   */
  it("says nothing about a rule that declares its own face", () => {
    const readout = HINT.replace("  margin: 0;", "  font-family: var(--nx-font-family-mono);");
    expect(classesDeclaringTheTier(readout).size).toBe(0);
  });

  /**
   * The gate's own documentation is written in the shape it forbids — this
   * file, and the comment above `.nx-hint` itself, both quote the declarations.
   * `check:egress` and `check:elec` each learned separately that a rule which
   * fires on the sentence describing it teaches people to stop writing the
   * sentence.
   */
  it("is not set off by prose about the tier", () => {
    const css = [
      "/* the tier is color: var(--nx-text-muted) at",
      "   font-size: var(--nx-font-size-body-sm) */",
      ".x { color: red; }",
    ].join("\n");
    expect(classesDeclaringTheTier(css).size).toBe(0);
  });

  it("keeps a finding's line honest across a multi-line comment", () => {
    expect(classesDeclaringTheTier(`/* one\n   two\n   three */\n${HINT}`).get("a__note")).toBe(4);
  });
});

describe("elementsByClass", () => {
  it("attributes a class to the tag that carries it", () => {
    const found = elementsByClass('<p className="a__note">x</p>');
    expect([...(found.get("a__note") ?? [])]).toEqual(["p"]);
  });

  it("records every tag a class appears on", () => {
    const source = '<p className="q">a</p>\n<span className="q">b</span>';
    expect([...(elementsByClass(source).get("q") ?? [])].sort()).toEqual(["p", "span"]);
  });

  /**
   * The same negative control `check:controls` needed, for the same reason: an
   * element does not end at the first `>`, because in real markup that `>` is
   * the arrow inside `onChange={(e) => …}`. Here it would attribute a class to
   * the wrong tag rather than to none.
   */
  it("is not ended early by the arrow in a handler", () => {
    const source = ['<p onClick={(e) => go(e)}', '   className="a__note">x</p>'].join("\n");
    expect([...(elementsByClass(source).get("a__note") ?? [])]).toEqual(["p"]);
  });

  it("splits a multi-class attribute", () => {
    const found = elementsByClass('<p className="nx-hint a__note">x</p>');
    expect([...found.keys()].sort()).toEqual(["a__note", "nx-hint"]);
  });

  /**
   * A React component is not an element. `<PageHeader className="…">` says
   * nothing about the tag that eventually renders, and treating it as one would
   * let a component name decide whether a stylesheet rule is a finding.
   */
  it("ignores components, which render tags it cannot see", () => {
    expect(elementsByClass('<PageHeader className="a__note" />').size).toBe(0);
  });
});

describe("the live tree", () => {
  it("has no class that re-declares the explanation tier on a paragraph", () => {
    expect(scanRepo()).toEqual([]);
  });
});
