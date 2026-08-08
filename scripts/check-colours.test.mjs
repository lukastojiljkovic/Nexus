// Unit tests for `check-colours.mjs`. This is the gate that keeps raw colour
// literals out of the tree — if it silently stops catching a form, or starts
// crying wolf on something that was never a colour, that is worse than not
// having the gate at all. So every forbidden form is proven caught, every
// false-positive risk found in the real tree (see check-colours.mjs's own
// header comment) is proven NOT caught, and the escape hatch is proven to
// work exactly as awkwardly as designed.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

import { findScanFiles, REPO_ROOT, scanSource, sourceRoots } from "./check-colours.mjs";

/** Violations only — the shape a caller checking "did this fail" wants. */
function violations(filePath, text) {
  return scanSource(filePath, text).filter((h) => h.status !== "allowed");
}

describe("scanSource — clean input", () => {
  it("finds nothing in ordinary token-only TypeScript", () => {
    const src = `
      export const Button = () => (
        <button style={{ background: "var(--nx-accent)", color: "var(--nx-bg)" }}>
          Sačuvaj
        </button>
      );
    `;
    expect(scanSource("apps/desktop/src/renderer/src/Button.tsx", src)).toEqual([]);
  });

  it("finds nothing in ordinary token-only CSS", () => {
    const src = `.nx-button { background: var(--nx-accent); color: var(--nx-bg); }`;
    expect(scanSource("packages/ui/src/styles.css", src)).toEqual([]);
  });

  it("the current repo tree is clean end to end", () => {
    const files = findScanFiles(REPO_ROOT);
    expect(files.length).toBeGreaterThan(100); // sanity: the walk actually found the tree
    const found = files.flatMap((file) => violations(file, readFileSync(file, "utf8")));
    expect(found).toEqual([]);
  });

  it("never scans packages/tokens", () => {
    const files = findScanFiles(REPO_ROOT);
    expect(files.some((f) => f.split(/[\\/]/).includes("tokens"))).toBe(false);
  });
});

describe("sourceRoots — the scope both styling gates share", () => {
  /** Every package that actually has a `src/`, worked out here independently of the gate. */
  function packagesWithSource() {
    const found = [];
    for (const group of ["apps", "packages"]) {
      for (const name of readdirSync(join(REPO_ROOT, group))) {
        const src = join(REPO_ROOT, group, name, "src");
        try {
          if (statSync(src).isDirectory()) found.push(`${group}/${name}`);
        } catch {
          // a package without a `src/` (packages/tokens ships JSON + a build script)
        }
      }
    }
    return found;
  }

  // The defect this replaced: `check-tokens.mjs` carried four hand-written
  // roots under a comment saying they mirrored this gate's. `packages/db` was
  // added later and never reached the copy, so one package was outside a scan
  // that claimed to include it — invisible unless you read both files at once.
  // Discovery is what makes the claim self-maintaining; this test is what makes
  // the discovery provable, since "covers everything" and "covers nothing new"
  // otherwise look identical from a green run.
  it("covers every package that has a src/ directory, except packages/tokens", () => {
    const covered = sourceRoots(REPO_ROOT).map((dir) =>
      relative(REPO_ROOT, join(dir, "..")).split(/[\\/]/).join("/"),
    );
    const expected = packagesWithSource().filter((p) => p !== "packages/tokens");
    expect(expected.length).toBeGreaterThan(1); // the walk found real packages, not an empty tree
    expect(covered.sort()).toEqual(expected.sort());
  });

  it("excludes packages/tokens, the one package allowed to hold real colour values", () => {
    expect(sourceRoots(REPO_ROOT).some((dir) => dir.includes(join("packages", "tokens")))).toBe(false);
  });
});

describe("scanSource — every forbidden form is caught", () => {
  const cases = [
    ["3-digit hex", `const c = "#fff";`, "#fff"],
    ["4-digit hex (RGBA short)", `const c = "#fffa";`, "#fffa"],
    ["6-digit hex", `const c = "#ff00aa";`, "#ff00aa"],
    ["8-digit hex (RRGGBBAA)", `const c = "#ff00aa80";`, "#ff00aa80"],
    ["rgb()", `const c = "rgb(255, 0, 0)";`, "rgb("],
    ["rgba()", `const c = "rgba(255, 0, 0, .5)";`, "rgba("],
    ["hsl()", `const c = "hsl(20, 90%, 50%)";`, "hsl("],
    ["hsla()", `const c = "hsla(20, 90%, 50%, .5)";`, "hsla("],
    ["oklch()", `const c = "oklch(0.7 0.15 30)";`, "oklch("],
    ["lab()", `const c = "lab(50% 40 30)";`, "lab("],
    ["lch()", `const c = "lch(50% 40 30)";`, "lch("],
    ["color()", `const c = "color(srgb 1 0 0)";`, "color("],
  ];

  for (const [label, src, expectedText] of cases) {
    it(`catches ${label} in a TS string literal`, () => {
      const hits = violations("apps/desktop/src/renderer/src/x.ts", src);
      expect(hits).toHaveLength(1);
      expect(hits[0].status).toBe("violation");
      expect(hits[0].text.toLowerCase()).toBe(expectedText.toLowerCase());
    });
  }

  it("catches a bare hex literal in a CSS declaration", () => {
    const hits = violations("packages/ui/src/styles.css", `.x { background: #ff00aa; }`);
    expect(hits).toEqual([expect.objectContaining({ text: "#ff00aa", status: "violation" })]);
  });

  it("catches rgba() in a CSS declaration", () => {
    const hits = violations("packages/ui/src/styles.css", `.x { background: rgba(0,0,0,.4); }`);
    expect(hits).toEqual([expect.objectContaining({ text: "rgba(", status: "violation" })]);
  });

  it("catches a hex literal inside an HTML style attribute", () => {
    const hits = violations("apps/desktop/src/renderer/index.html", `<div style="color:#ff00aa"></div>`);
    expect(hits).toEqual([expect.objectContaining({ text: "#ff00aa" })]);
  });

  it("catches a colour hidden inside a template literal's static text", () => {
    const hits = violations("apps/desktop/src/renderer/src/x.ts", "const c = `border: #ff00aa`;");
    expect(hits).toEqual([expect.objectContaining({ text: "#ff00aa" })]);
  });

  it("rejects invalid CSS hex lengths (5 and 7 digits) rather than matching a shorter run inside them", () => {
    expect(violations("x.ts", `const a = "#12345";`)).toEqual([]);
    expect(violations("x.ts", `const b = "#1234567";`)).toEqual([]);
  });

  it("reports the correct line number for a multi-line file", () => {
    const src = ['const a = 1;', 'const b = 2;', 'const c = "#ff00aa";', ''].join("\n");
    const hits = violations("x.ts", src);
    expect(hits).toEqual([expect.objectContaining({ line: 3 })]);
  });
});

describe("scanSource — false-positive constructs found in the real tree are not caught", () => {
  it("ignores a TS line comment, even one that looks exactly like a hex colour", () => {
    // Real shape from apps/desktop/src/shared/ipc.ts: "founder decision #4".
    const src = `// founder decision #4 / ADR-058, and a git sha for good measure: 90d2695\nconst x = 1;`;
    expect(violations("x.ts", src)).toEqual([]);
  });

  it("ignores an issue-style numeric reference inside a comment", () => {
    // #1234 is 4 hex-valid digits — exactly a plausible RGBA-short length —
    // but it is prose in a comment, never a candidate in the first place.
    const src = `// fixes #1234, see also #123456\nconst x = 1;`;
    expect(violations("x.ts", src)).toEqual([]);
  });

  it("ignores a JSDoc block comment mentioning a hex-looking word", () => {
    const src = `/**\n * bordo accent, decision #11, not #deadbeef\n */\nconst x = 1;`;
    expect(violations("x.ts", src)).toEqual([]);
  });

  it("ignores `href=\"#\"` and other short/plain hash attributes", () => {
    const src = `const link = <a href="#">top</a>;`;
    expect(violations("x.tsx", src)).toEqual([]);
  });

  it("ignores a CSS id selector, even one built only from hex-valid letters", () => {
    // "#root" itself is safe because r/o/o/t are not hex digits; "#face" IS
    // hex-valid (f,a,c,e) and four characters long, so it is the sharper
    // case: a real CSS id that happens to spell a valid short hex colour.
    expect(violations("x.css", `#root { margin: 0; }`)).toEqual([]);
    expect(violations("x.css", `#face { margin: 0; }`)).toEqual([]);
  });

  it("ignores a CSS `content` string that looks like a colour", () => {
    const src = `.x::after { content: "#deadbeef"; }`;
    expect(violations("x.css", src)).toEqual([]);
  });

  it("ignores a CSS font-family string that happens to be hex-valid text", () => {
    const src = `.x { font-family: "abcdef"; }`;
    expect(violations("x.css", src)).toEqual([]);
  });

  it("ignores a base64 data URI (the alphabet cannot spell `#` or `(`)", () => {
    const src = `const icon = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB";`;
    expect(violations("x.ts", src)).toEqual([]);
  });

  it("ignores a hex-shaped test fixture written without its `#`, the house convention for this exact situation", () => {
    // Mirrors apps/desktop/src/renderer/src/canvasPalette.test.ts.
    const src = `expect(toCanvasPalette("AABBCC")).toBe("AABBCC");`;
    expect(violations("x.test.ts", src)).toEqual([]);
  });

  it("ignores the static parts of a template literal building a dynamic CSS var name", () => {
    // Mirrors HabitsPage.tsx / NoteOrganizer.tsx: `var(--nx-swatch-${id})`.
    const src = "const style = { background: `var(--nx-swatch-${id})` };";
    expect(violations("x.tsx", src)).toEqual([]);
  });

  it("does not flag `recolor(` or `backgroundColor(` as the color() function", () => {
    const src = `function recolor(id, color) { return backgroundColor(id); }`;
    expect(violations("x.ts", src)).toEqual([]);
  });

  it("does not flag a `#oznaka`-style hashtag token (not hex-valid past the first letter)", () => {
    const src = `const hint = "#oznaka · rok:danas";`;
    expect(violations("x.ts", src)).toEqual([]);
  });
});

describe("scanSource — escape hatch", () => {
  it("allows a flagged literal with a reason, and reports it rather than staying silent", () => {
    const src = `const legacy = "#1a1a1a"; // nx-colour-allow: pinned to match an external OAuth provider's brand mark, ADR-071`;
    const hits = scanSource("x.ts", src);
    expect(hits).toHaveLength(1);
    expect(hits[0].status).toBe("allowed");
    expect(hits[0].reason).toContain("OAuth provider");
  });

  it("does NOT allow the escape hatch to suppress a violation on a different line", () => {
    const src = ['// nx-colour-allow: this comment is on the wrong line', 'const c = "#1a1a1a";'].join("\n");
    const hits = scanSource("x.ts", src);
    expect(hits).toEqual([expect.objectContaining({ status: "violation", line: 2 })]);
  });

  it("rejects the marker with no reason as its own failure, not a silent pass", () => {
    const src = `const c = "#1a1a1a"; // nx-colour-allow:`;
    const hits = scanSource("x.ts", src);
    expect(hits).toHaveLength(1);
    expect(hits[0].status).toBe("invalid-escape");
  });

  it("works the same way for a CSS trailing comment", () => {
    const src = `.x { background: #1a1a1a; } /* nx-colour-allow: matches the vendor widget's fixed chrome colour */`;
    const hits = scanSource("x.css", src);
    expect(hits).toEqual([expect.objectContaining({ status: "allowed" })]);
  });

  // The three below all describe ONE defect, and it is the one that matters
  // most in a gate: a block-comment marker with source after it on the same
  // line — which is how anybody would actually write it in CSS — used to make
  // the hatch FAIL OPEN. The reason was read to end-of-line rather than to the
  // end of its own comment, so a marker closed mid-line came back with the
  // comment terminator and the trailing brace AS its reason: non-empty,
  // therefore "valid", therefore a literal was permitted by a marker that gave
  // no reason at all.
  it("ends the reason at the comment's end, not the line's", () => {
    const src = `.x { background: #1a1a1a; /* nx-colour-allow: vendor chrome */ }`;
    const hits = scanSource("x.css", src);
    expect(hits).toHaveLength(1);
    expect(hits[0].status).toBe("allowed");
    expect(hits[0].reason).toBe("vendor chrome");
  });

  it("still rejects an empty reason when source follows the marker's comment", () => {
    const src = `.x { background: #1a1a1a; /* nx-colour-allow: */ }`;
    const hits = scanSource("x.css", src);
    expect(hits).toHaveLength(1);
    expect(hits[0].status).toBe("invalid-escape");
  });

  it("ends an HTML reason at `-->` for the same reason", () => {
    const src = `<div style="color:#1a1a1a"><!-- nx-colour-allow: vendor chrome --></div>`;
    const hits = scanSource("x.html", src);
    expect(hits).toHaveLength(1);
    expect(hits[0].status).toBe("allowed");
    expect(hits[0].reason).toBe("vendor chrome");
  });
});
