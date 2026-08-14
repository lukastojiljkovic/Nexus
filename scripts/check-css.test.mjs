import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

import { REPO_ROOT } from "./check-colours.mjs";
import { checkCss, scanRoots, scanStylesheets } from "./check-css.mjs";

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
    // And the stray `*/` the early close leaves behind, which is the half of
    // the class that survives at any depth — see the case below.
    expect(kinds(css)).toContain("stray-comment-end");
  });

  it("catches the same defect INSIDE a rule body, where the prose test cannot see it", () => {
    // 2026-08-14: this exact shape shipped and this gate passed it. The prose
    // check reads depth zero only, and here the loose text sits at depth one —
    // so the one gate written for early-closed comments found nothing, and the
    // production build was what refused the file. A `*/` outside a comment is
    // unambiguous wherever it appears, which is why that is what is tested.
    const css = `.scroll {
  /* Why the height is bounded.

     A second paragraph. */
     A third paragraph that used to be inside the comment. */
  max-height: 20rem;
}`;
    expect(kinds(css)).toContain("stray-comment-end");
  });

  it("does not report a stray end for a comment that closes exactly once", () => {
    // The negative control the old check could never fail: it required a file
    // with a `*/` and no `/*` at all, so it passed every real stylesheet.
    expect(checkCss("/* a */\n.a { color: red; }\n/* b */\n.b { top: 0; }")).toEqual([]);
    expect(kinds("/* /* not nested */\n.a { top: 0; }")).toEqual([]);
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

  // „No stylesheet failed" is only worth something if every stylesheet was
  // read. This gate used to walk three hand-written roots, so a package that
  // grew its first `.css` after the list was written would have been outside a
  // scan that never said so — the failure `check-tokens.mjs` already shipped
  // once with `packages/db`. The roots are discovered now, and this is what
  // makes the discovery provable rather than merely claimed.
  it("scans every directory that actually holds a stylesheet", () => {
    const walk = (dir, out) => {
      for (const entry of readdirSync(dir)) {
        if (entry === "node_modules" || entry === "dist" || entry === "out") continue;
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) walk(path, out);
        else if (path.endsWith(".css")) out.push(path);
      }
      return out;
    };

    const roots = scanRoots();
    const stylesheets = [];
    for (const group of ["apps", "packages"]) {
      for (const name of readdirSync(join(REPO_ROOT, group))) {
        // `packages/tokens` is out of the shared root list because it is the one
        // package allowed to WRITE colour values. It has no `src/` at all — its
        // CSS is generated into `dist/` — so nothing is skipped here today; if
        // it ever grows one, this exclusion is the thing to re-examine rather
        // than a stylesheet quietly going unread.
        if (group === "packages" && name === "tokens") continue;
        const src = join(REPO_ROOT, group, name, "src");
        try {
          if (statSync(src).isDirectory()) walk(src, stylesheets);
        } catch {
          // a package without a `src/` holds no stylesheet to miss
        }
      }
    }

    expect(stylesheets.length).toBeGreaterThan(10); // sanity: the walk found the tree
    const missed = stylesheets
      .filter((file) => !roots.some((root) => file.startsWith(root)))
      .map((file) => relative(REPO_ROOT, file));
    expect(missed).toEqual([]);
  });
});
