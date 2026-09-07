import { describe, expect, it } from "vitest";

import { jsxElements } from "./jsx-elements.mjs";

/**
 * The scan two gates depend on, tested once.
 *
 * `check:controls` and `check:tiers` both need to know where a JSX opening tag
 * ends, and both are wrong in a silent direction if it guesses: controls
 * reports correct radios, tiers reports nothing at all. It was written twice
 * before it was written here.
 */

const text = (source, tag) => [...jsxElements(source, tag)].map((e) => e.text);

describe("jsxElements", () => {
  it("takes an element from its `<` to its `>`", () => {
    expect(text('<p className="a">x</p>', /p/)).toEqual(['<p className="a">']);
  });

  /**
   * The whole reason this is not a regex. `/<p[^>]*>/` ends the element at the
   * arrow, which is the character before every `className` in the codebase
   * that writes its handler first.
   */
  it("is not ended by the arrow in a handler", () => {
    const source = '<p onClick={(e) => go(e)} className="a">x</p>';
    expect(text(source, /p/)).toEqual(['<p onClick={(e) => go(e)} className="a">']);
  });

  it("is not ended by a `>` inside a nested expression", () => {
    const source = '<p title={n > 3 ? "many" : "few"} className="a">x</p>';
    expect(text(source, /p/)[0]).toContain('className="a"');
  });

  it("is not ended by a `>` inside a string", () => {
    expect(text('<p aria-label="a > b" className="c">x</p>', /p/)[0]).toContain('className="c"');
  });

  it("spans the nine lines a real element is spread over", () => {
    const source = ["<input", "  type=\"radio\"", "  className=\"nx-radio\"", "/>"].join("\n");
    expect(text(source, /input/)[0]).toContain("nx-radio");
  });

  /**
   * `\\` escapes the next character, including a closing quote. Without this the
   * scan would leave the string state open at the first `\"` and run to the end
   * of the file, swallowing every following element into one.
   */
  it("respects a backslash escape inside a string", () => {
    const source = '<p title="a \\" b" className="c">x</p>\n<p className="d">y</p>';
    expect(text(source, /p/)).toHaveLength(2);
  });

  it("reports the tag it matched, so a caller can group by element", () => {
    const found = [...jsxElements('<p className="a" />\n<span className="a" />', /[a-z][a-z0-9]*/)];
    expect(found.map((e) => e.name)).toEqual(["p", "span"]);
  });

  it("reports the offset the element starts at", () => {
    expect([...jsxElements("xx<p />", /p/)][0]?.start).toBe(2);
  });

  /**
   * `\\b` on the tag name. Without it a pattern of `p` matches the `<p` inside
   * `<pre`, and every gate built on this would attribute one element's
   * attributes to another's rule.
   */
  it("matches whole tag names, not prefixes", () => {
    expect(text('<pre className="a">x</pre>', /p/)).toEqual([]);
  });

  it("finds every element, not just the first", () => {
    expect(text('<p className="a" />\n<p className="b" />', /p/)).toHaveLength(2);
  });
});
