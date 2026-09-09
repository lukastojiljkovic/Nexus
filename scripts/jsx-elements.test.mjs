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
    expect([...jsxElements("x <p />", /p/)][0]?.start).toBe(2);
  });

  /**
   * The cost of the type-argument rule, written down rather than left to be
   * discovered: `xx<p />` — an identifier running straight into a tag — is read
   * as a type argument and skipped. JSX text CAN do that (`<p>foo<b>bar</b>`),
   * so this is a real false negative and not a theoretical one.
   *
   * It is the right trade for this tree, by measurement rather than by taste:
   * every one of the eleven places where an identifier abuts a `<` in the
   * renderer is `typeof` or `keyof`, and not one is markup. The failure it
   * replaces was unbounded — one stray `<HTMLInputElement>` silently ate every
   * sibling after it — while this one costs a tag nothing in the tree writes.
   */
  it("skips a tag that abuts an identifier, which is the trade", () => {
    expect(text("xx<p />", /p/)).toEqual([]);
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

  /**
   * A TYPE ARGUMENT is not an element, and this is the one hazard that stayed
   * hidden for as long as every caller asked for a specific tag: `input` and
   * `select` are not generic type names, so nothing noticed. `check:rows` walks
   * EVERY tag to build a nesting tree, and there the stray `<HTMLInputElement>`
   * — not self-closing, never closed — stayed on the stack and swallowed every
   * following sibling, so the gate reported nothing on a form written to catch.
   *
   * The discriminator is the character before the `<`: a generic's closes up
   * against the name it parameterises, JSX's never does.
   */
  it("is not a type argument", () => {
    const source = "onChange={(e: ChangeEvent<HTMLInputElement>) => set(e)}";
    expect(text(source, /[A-Za-z][A-Za-z0-9]*/)).toEqual([]);
    expect(text("const [a] = useState<Task[] | null>(null);", /[A-Za-z][A-Za-z0-9]*/)).toEqual([]);
  });

  /**
   * …and the other half of that rule, which is why `>` is not excluded: a
   * nested element's `<` follows the `>` of the tag it sits inside.
   */
  it("still finds an element that opens right after another closes", () => {
    const found = text("<div><span /></div>", /[a-z][a-z0-9]*/);
    expect(found).toEqual(["<div>", "<span />"]);
  });
});
