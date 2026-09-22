import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  classesDeclaringTheTier,
  elementsByClass,
  findings,
  repoTierDeclarations,
  scanRepo,
} from "./check-tiers.mjs";

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
 *
 * AND THE SENTENCE THE TWO MAKE, added 2026-09-22, because proving the halves is
 * exactly what made the whole easy to leave untested. `scanRepo()` was asserted
 * to be `[]` on the real tree and that was the entire test of the composition —
 * and `[]` is the answer this tree gives AND the answer a join that returns
 * nothing gives, which no assertion could tell apart. A refactor that made the
 * sentence unconditionally silent would have kept all of this green. So the gate
 * takes a root, the fixture block below drives the composition on a tree of its
 * own, and the census it now exports is what lets a test ask „did it look at the
 * classes this rule exists to judge" rather than only „was it quiet".
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

/**
 * The verdict on its own — the clause the composition is made of, asked in both
 * directions without a tree.
 *
 * It exists as a named export for this gate's own reason: `scanRepo()` returning
 * `[]` is the correct answer AND the answer a composition that returns nothing
 * gives, and the census would be full either way.
 */
describe("findings", () => {
  const row = (tags, shared = false) => ({ file: "x.css", line: 1, cls: "x", tags, shared });

  /**
   * The tag SET is what is tested and not the call sites: a class worn by a
   * `<p>` in fifty places is still a paragraph tier, and what clears it is a
   * second KIND of element carrying the same class. A census row's `tags` is
   * that set, so reading `length !== 1` as „written once" is the wrong lesson
   * from it.
   */
  it("is a finding only for a class worn by exactly one tag, and that tag a <p>", () => {
    expect(findings([row(["p"])])).toHaveLength(1);
    expect(findings([row(["span"])])).toEqual([]);
    expect(findings([row(["p", "span"])])).toEqual([]);
    expect(findings([row([])])).toEqual([]);
    expect(findings([row(["p"], true)])).toEqual([]);
  });
});

/**
 * The composition, on a tree of its own — the half the blocks above cannot
 * reach. `classesDeclaringTheTier` finds a rule and `elementsByClass` attributes
 * a class to a tag, both proven in both directions; what was never proven is the
 * sentence they are joined into, because the only test of it was `[]` on the
 * real tree, which is equally the answer a join that returns nothing gives.
 *
 * EVERY CASE READS THE CENSUS BEFORE IT READS THE VERDICT, and that order is the
 * point. `[]` is also what a fixture whose files were never written produces, so
 * a positive control that cannot tell „the rule held" from „the walk found
 * nothing" is not a control at all. A census row is the same statement the gate
 * makes about a real class — which class, in which file, on which tags — so a
 * fixture that stopped declaring the tier fails as a FIXTURE, naming its own
 * class, instead of passing as a verdict.
 */
describe("scanRepo on a tree of its own", () => {
  /** A throwaway repository with exactly the files a case needs, and nothing else. */
  function fakeRepo(files) {
    const root = mkdtempSync(join(tmpdir(), "nexus-tiers-"));
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text, "utf8");
    }
    return root;
  }

  const STYLES = "apps/desktop/src/styles/fixture.css";
  const NOTE = "apps/desktop/src/Note.tsx";

  /**
   * The tier, declared for whatever class a case is about — written out here
   * rather than reused from the unit tests above, because a fixture has to say
   * what the gate reads TODAY. If those constants move, the census assertion in
   * each case is what fails, with the fixture as its subject, rather than the
   * positive control quietly ceasing to control for anything.
   */
  const TIER = (cls) =>
    [
      `.${cls} {`,
      "  margin: 0;",
      "  color: var(--nx-text-muted);",
      "  font-size: var(--nx-font-size-body-sm);",
      "}",
    ].join("\n");

  /**
   * A fixture's census and its verdict together, with the temporary tree removed
   * whether the assertions pass or throw.
   */
  function scanFixture(files) {
    const root = fakeRepo(files);
    try {
      return { census: repoTierDeclarations(root), verdict: scanRepo(root) };
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  /** What `main()` prints for a finding, so a case can assert the report too. */
  const reported = (rows) => rows.map((f) => `${f.file}:${f.line}: .${f.cls}`);

  it("reports a tier declared on a class whose only call site is a <p>", () => {
    const { census, verdict } = scanFixture({
      [STYLES]: TIER("fixture__note"),
      [NOTE]: '<p className="fixture__note">{s.note}</p>',
    });
    expect(census, JSON.stringify(census, null, 1)).toEqual([
      { file: STYLES, line: 1, cls: "fixture__note", tags: ["p"], shared: false },
    ]);
    // The string the gate prints, so the file the finding names is the file the
    // fixture wrote — which is also what proves `root` reaches the REPORTING and
    // not only the walk.
    expect(reported(verdict)).toEqual([`${STYLES}:1: .fixture__note`]);
  });

  it("names the paragraph tier and not the tier declared beside it", () => {
    const { census, verdict } = scanFixture({
      [STYLES]: `${TIER("fixture__note")}\n\n${TIER("fixture__meta")}`,
      [NOTE]: [
        '<p className="fixture__note">{s.note}</p>',
        '<span className="fixture__meta">{s.meta}</span>',
      ].join("\n"),
    });
    expect(census.map((d) => d.cls)).toEqual(["fixture__note", "fixture__meta"]);
    // Two declarations in one file, one a finding and one not. A verdict that
    // answered everything or nothing would pass every case above this one.
    expect(reported(verdict)).toEqual([`${STYLES}:1: .fixture__note`]);
  });

  it("says nothing when the class is only ever a <span>", () => {
    const { census, verdict } = scanFixture({
      [STYLES]: TIER("fixture__note"),
      [NOTE]: '<span className="fixture__note">{s.note}</span>',
    });
    // An inline box takes neither a margin nor a measure, so the tier on one is
    // legitimate and folding it would be wrong. The census says WHICH clause
    // cleared it — the tag it was seen on, not a walk that missed the class.
    expect(census.map((d) => [d.cls, d.tags])).toEqual([["fixture__note", ["span"]]]);
    expect(verdict).toEqual([]);
  });

  it("says nothing when a second kind of element wears the same class", () => {
    const { census, verdict } = scanFixture({
      [STYLES]: TIER("fixture__note"),
      [NOTE]: [
        '<p className="fixture__note">{s.note}</p>',
        '<span className="fixture__note">{s.extra}</span>',
      ].join("\n"),
    });
    expect(census.map((d) => [d.cls, d.tags])).toEqual([["fixture__note", ["p", "span"]]]);
    expect(verdict).toEqual([]);
  });

  it("says nothing when the class is written beside nx-hint", () => {
    const { census, verdict } = scanFixture({
      [STYLES]: TIER("fixture__note"),
      [NOTE]: '<p className="nx-hint fixture__note">{s.note}</p>',
    });
    // The adoption exclusion — and the real tree cannot witness it: no class
    // declaring the tier there is written beside `nx-hint`, so a `shared` column
    // reading `false` is what a working exclusion and a broken one both produce.
    expect(census.map((d) => [d.cls, d.tags, d.shared])).toEqual([["fixture__note", ["p"], true]]);
    expect(verdict).toEqual([]);
  });

  it("says nothing about a class only a component wears, and records that it looked", () => {
    const { census, verdict } = scanFixture({
      [STYLES]: TIER("fixture__note"),
      [NOTE]: '<Note className="fixture__note" />',
    });
    // `[]` here is an ANSWER and not an absence: the walk read the markup, and
    // the only element carrying the class is a component whose rendered tag this
    // gate cannot see and must not guess at. Dropping the row instead of
    // emptying it would hide the difference.
    expect(census.map((d) => [d.cls, d.tags])).toEqual([["fixture__note", []]]);
    expect(verdict).toEqual([]);
  });
});

describe("the live tree", () => {
  it("has no class that re-declares the explanation tier on a paragraph", () => {
    expect(scanRepo()).toEqual([]);
  });

  /**
   * THE TEST THAT WOULD HAVE CAUGHT A BROKEN JOIN. `scanRepo()` returning `[]`
   * is the correct answer AND the answer a join that returns nothing gives, and
   * the fixture block above only covers the shapes that fixture happens to be
   * written in. So the suite asks the census about the classes this gate exists
   * to judge: are they still being READ, and is each still cleared by the clause
   * that is supposed to clear it?
   *
   * It is a tripwire and not a diagnosis: a failure here means one of these rows
   * changed. Usually that is the tree, and occasionally it is the walk — which is
   * why a row names the file, the class and the tags rather than counting them.
   *
   * The adoption clause has NO witness here, and that is not an oversight: no
   * class declaring the tier in this tree is written beside `nx-hint`, so a
   * `shared` column reading `false` is what a working exclusion and a broken one
   * both produce. That clause is pinned by a fixture case, and only there.
   */
  it("still sees the tier declarations it exists to judge, on the tags it saw them", () => {
    const census = repoTierDeclarations();
    const row = (cls) => census.find((d) => d.cls === cls);

    // Coarse on purpose: this catches a walk that stopped descending the tree,
    // and it is a floor rather than a figure, so a class legitimately folded
    // away does not have to be counted again here.
    expect(census.length, JSON.stringify(census.map((d) => d.cls))).toBeGreaterThan(30);

    // One row per clause of the verdict, so a silent change to any one of them
    // lands on a line that names the clause it broke.
    expect(row("cal__time")?.tags, "cleared by the tag it is worn on").toEqual(["span"]);
    expect(row("cal__time")?.file).toBe("apps/desktop/src/renderer/src/styles/calendar.css");
    expect(row("search__row-title")?.tags, "cleared by wearing two kinds of element").toEqual([
      "div",
      "span",
    ]);
    // Declared in three stylesheets and built by interpolation in
    // `notePopover.tsx`, so `className="…"` never contains it and no tag can be
    // attributed to it. The row is the honest answer — seen on nothing — and the
    // class is in fact on a `<button>`.
    expect(row("note__menu-trigger")?.tags, "a class this gate cannot attribute").toEqual([]);
    expect(row("gallery__header")?.file, "the walk reaches the other app root").toBe(
      "apps/gallery/src/gallery.css",
    );
  });
});
