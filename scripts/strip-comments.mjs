/**
 * Blanks comment bodies while preserving line count and line breaks, so a
 * finding's reported line number still points at the right line.
 *
 * Blanked rather than deleted for exactly that reason. This is a lexer, not a
 * parser: it tracks whether it is inside a string, a template literal, a line
 * comment or a block comment, because a naive `replace(/\/\/.*$/)` eats the
 * `//` in every `https://` URL, and a gate that reads a URL as a comment is a
 * gate that goes quietly green.
 *
 * **It lives in its own module because two gates need it.** It was written for
 * `check:egress`, which learned the hard way that a gate firing on prose about
 * itself teaches people to stop writing the prose — its two remaining findings
 * were `strings.sr.ts`'s own privacy copy and a JSDoc line. `check:elec` has the
 * identical problem for the identical reason: six files in this repository
 * explain in comments that a wire's colour is painted through a
 * `--nx-elec-wire-*` token.
 *
 * The alternative was a second copy in the second gate, and that copy was
 * actually written before this module existed: nine lines, no string tracking,
 * and therefore blind to a URL. Two readings of one rule is the shape the
 * `.nx-swatch` promotion had already cost us once this month, so there is one
 * reading of it.
 */
export function stripComments(source) {
  let out = "";
  let i = 0;
  let quote = null;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (quote !== null) {
      out += ch;
      if (ch === "\\") {
        out += next ?? "";
        i += 2;
        continue;
      }
      if (ch === quote) quote = null;
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i += 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) {
        // Newlines survive, so every later line keeps its number.
        if (source[i] === "\n") out += "\n";
        i += 1;
      }
      i += 2;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}
