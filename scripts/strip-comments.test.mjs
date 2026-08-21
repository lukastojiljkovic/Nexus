import { describe, expect, it } from "vitest";

import { stripComments } from "./strip-comments.mjs";

/**
 * These four came from `check-egress.test.mjs`, unchanged, when the lexer moved
 * out of that gate to be shared with `check:elec`. They are the reasons it is a
 * lexer at all, and they now sit next to the code rather than next to one of its
 * two callers.
 */
describe("stripComments", () => {
  it("does not eat the `//` in a URL", () => {
    // The bug this function exists to avoid: `replace(/\/\/.*$/)` deletes
    // everything from the `//` in `https://`, which silently disarms four of
    // the egress rules while leaving the gate green.
    const src = 'const u = "https://esm.sh/x";';
    expect(stripComments(src)).toContain("https://esm.sh/x");
  });

  it("removes line and block comments but keeps the line numbering", () => {
    const src = ["a", "// import('https://x/y')", "/* fetch(", "still comment", "*/", "b"].join("\n");
    const out = stripComments(src);
    expect(out.split("\n")).toHaveLength(6);
    expect(out).not.toContain("esm");
    expect(out).not.toContain("still comment");
    expect(out.split("\n")[5]).toBe("b");
  });

  it("leaves a comment marker that is inside a string alone", () => {
    expect(stripComments('const s = "a // b";')).toBe('const s = "a // b";');
    expect(stripComments("const s = `a /* b */ c`;")).toBe("const s = `a /* b */ c`;");
  });

  it("survives an escaped quote inside a string", () => {
    const src = 'const s = "he said \\"hi\\" // not a comment";';
    expect(stripComments(src)).toBe(src);
  });

  /**
   * The second caller's case. A stylesheet has no `//`, so the only thing the
   * lexer has to get right in CSS is that a block comment does not swallow the
   * declaration after it — and that a custom property, which begins with the
   * same two characters a SQL comment does, is never mistaken for one.
   */
  it("keeps a custom-property declaration that follows a CSS comment", () => {
    const src = "/* the bench */\n.elec { color: var(--nx-elec-wire-red); }";
    const out = stripComments(src);
    expect(out).not.toContain("the bench");
    expect(out.split("\n")[1]).toBe(".elec { color: var(--nx-elec-wire-red); }");
  });
});
