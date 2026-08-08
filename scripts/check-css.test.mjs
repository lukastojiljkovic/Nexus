import { describe, expect, it } from "vitest";

import { checkCss, scanStylesheets } from "./check-css.mjs";

/**
 * The gate's own coverage. Asserting only that the tree is clean would leave
 * „the checker finds nothing" and „the stylesheets are fine" indistinguishable
 * — DC-01, which this repo has paid for three times.
 */

const kinds = (css) => checkCss(css).map((problem) => problem.kind);

describe("checkCss", () => {
  it("catches the defect this gate was written for — a comment closed early", () => {
    // Verbatim the shape that shipped: the block closes on the first line, and
    // everything after it is prose sitting at the top level. CSS then reads it
    // as the start of a selector and swallows the rule below, which silently
    // stops applying.
    const css = `/* A note about the row. */
   „black" here is not a colour: a mask reads only the alpha. */
.row {
  color: red;
}`;
    expect(kinds(css)).toContain("prose-at-top-level");
  });

  it("accepts an ordinary stylesheet", () => {
    expect(checkCss(".a { color: red; }\n/* why */\n.b:hover > .c { top: 0; }")).toEqual([]);
  });

  it("accepts the constructs a real stylesheet is made of", () => {
    const css = `@import "./a.css";
@media (min-resolution: 2dppx) { .a { border-width: 0.5px; } }
@supports (display: grid) { .b { display: grid; } }
@keyframes x { 0%, 75% { opacity: 1; } 100% { opacity: 0; } }
.c[data-theme="noc"]:not(.d)::after { content: ""; }
.e { background: linear-gradient(to bottom, transparent 0, black 12px); }`;
    expect(checkCss(css)).toEqual([]);
  });

  it("catches an unclosed comment", () => {
    expect(kinds("/* opened and never closed\n.a { color: red; }")).toContain("unclosed-comment");
  });

  it("catches unbalanced braces in both directions", () => {
    expect(kinds(".a { color: red;")).toContain("unclosed-brace");
    expect(kinds(".a { color: red; } }")).toContain("unmatched-close-brace");
  });

  it("catches a declaration that escaped its rule", () => {
    // The other way a stylesheet goes quietly wrong: a property left outside
    // any block after a brace was deleted.
    expect(kinds("color: red;\n.a { top: 0; }")).toContain("statement-outside-a-rule");
  });

  it("does not mistake a comment's own prose for top-level text", () => {
    // The gate has to tolerate this codebase's actual comment density, which is
    // Serbian sentences with „…“ quotes, several paragraphs at a time.
    const css = `/* „Zid navika" — jedan kvadrat je jedan dan.
   Ovo je druga rečenica, sa dijakritikom: š, č, ć, ž, đ. */
.wall { display: block; }`;
    expect(checkCss(css)).toEqual([]);
  });
});

describe("the repository itself", () => {
  it("has no stylesheet that fails to parse as CSS", () => {
    expect(scanStylesheets()).toEqual([]);
  });
});
