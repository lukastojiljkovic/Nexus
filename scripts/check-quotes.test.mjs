import { describe, expect, it } from "vitest";

import { CLOSE, OPEN, scanFiles, scanRepo, scanSource } from "./check-quotes.mjs";

/**
 * `check:quotes` makes Serbian's closing quotation mark structural instead of
 * remembered.
 *
 * One hundred and seventy-two quoted phrases in the shipped copy closed with an
 * ASCII `"` or an English `”` instead of `“`, across twenty-nine files — more
 * than a third of every quotation in the product. All of it typechecked, linted,
 * passed `check:address` and photographed as a quotation mark of some kind, so
 * this suite's first job is to show the gate goes RED on each of the four shapes
 * that were actually in the tree, and its second is to show it stays quiet on
 * the three shapes that are correct and would otherwise need an exemption list.
 */

const FILE = "apps/desktop/src/renderer/src/strings/x.ts";
const BS = String.fromCharCode(92);

describe("scanSource — the shapes that were in the tree", () => {
  /** The commonest one by far: inside a double-quoted literal the ASCII quote
   *  has to be escaped, and the backslash makes it read as deliberate. */
  it("refuses an escaped ASCII quote as the closer", () => {
    const source = `const s = "Datum ${OPEN}od${BS}" mora biti ispravan.";`;
    const findings = scanSource(FILE, source);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.closer).toBe(`${BS}"`);
  });

  it("refuses the English right double quote as the closer", () => {
    const findings = scanSource(FILE, `const s = "u kartici ${OPEN}Fitnes”.";`);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.closer).toBe("”");
  });

  /** The quotation opens before an interpolation and closes after it — the
   *  shape every one of `datetime.ts`'s cron messages had. */
  it("carries the open quotation across a template interpolation", () => {
    const findings = scanSource(FILE, 'const s = `Polje „${label}" ne razume.`;');
    expect(findings).toHaveLength(1);
  });

  /**
   * Same sentence, hand-wrapped near 100 columns onto a `+`: the „ is the last
   * thing in one literal and its closer is the first thing in the next.
   */
  it("carries the open quotation across a `+` concatenation", () => {
    const source = `const s = "u obliku ${OPEN}1:45" +\n  "${BS}" mora";`;
    expect(source).toContain(`${OPEN}1:45" +`);
    expect(scanSource(FILE, source)).toHaveLength(1);
  });

  it("reports the line the closer is on", () => {
    const source = `const a = 1;\nconst s = "u kartici ${OPEN}Fitnes”.";`;
    expect(scanSource(FILE, source)[0]?.line).toBe(2);
  });
});

describe("scanSource — the shapes that are correct", () => {
  it("accepts the Serbian pair", () => {
    expect(scanSource(FILE, `const s = "u kartici ${OPEN}Fitnes${CLOSE}.";`)).toHaveLength(0);
  });

  /**
   * The rule is a PAIRING rule, which is what lets `pro/tekst.ts` keep its table
   * of quote pairs and `imex/ankiTranslate.ts` keep `rdquo: "”"`. A gate that
   * banned the character outright would have needed an exemption list, and an
   * exemption list is a thing somebody widens.
   */
  it("says nothing about a closer with no „ before it", () => {
    expect(scanSource(FILE, 'const s = `he said "hi"`;')).toHaveLength(0);
    expect(scanSource(FILE, `const P = [["${OPEN}", "${CLOSE}"], ["${CLOSE}", "”"]];`)).toHaveLength(
      0,
    );
    expect(scanSource(FILE, 'const s = "RFC 6234’s “abc” vector";')).toHaveLength(0);
  });

  /** A comma between two array entries is not „the same sentence continues". */
  it("does not carry an open quotation across anything but + and ${}", () => {
    const source = `const a = ["opens ${OPEN}here", "and ${BS}" is unrelated"];`;
    expect(scanSource(FILE, source)).toHaveLength(0);
  });

  /**
   * An unclosed „ is the line wrapper's doing, not the author's, and a gate that
   * reported it would be reporting a hundred false positives on copy that is
   * correct — DC-01's shape.
   */
  it("does not report a quotation left open at the end of a literal", () => {
    expect(scanSource(FILE, `const s = "otvara ${OPEN}";`)).toHaveLength(0);
  });

  it("ignores a file with no „ at all", () => {
    expect(scanSource(FILE, 'const s = "plain ascii \\" quote";')).toHaveLength(0);
  });
});

describe("the walk", () => {
  /**
   * A migration's SQL is a template literal, so its `--` comments are literal
   * text to a parser. Twelve of this gate's first findings were comments in
   * them, and a comment is never shown to anybody.
   */
  it("never enters packages/db/src/migrations", () => {
    const files = scanFiles().map((f) => f.split(/[\\/]/).join("/"));
    expect(files.some((f) => f.includes("/migrations/"))).toBe(false);
    expect(files.some((f) => f.endsWith("apps/desktop/src/renderer/src/strings.sr.ts"))).toBe(true);
  });
});

describe("the repository", () => {
  it("closes every „ with “", () => {
    expect(scanRepo()).toEqual([]);
  });
});
