import { describe, expect, it } from "vitest";

import { emittedTokenNames, scanReferences } from "./check-tokens.mjs";

/**
 * The gate's own coverage, on `check-contrast.test.mjs`'s terms: asserting only
 * that the real tree is clean would leave „the auditor checks nothing at all"
 * and „every reference is correct" indistinguishable — which is precisely the
 * failure mode (DC-01) that let three earlier gates ship covering nothing.
 *
 * So every test below hands the auditor engineered input and asserts what it
 * catches, and only the last one looks at the repository.
 */

/** A stand-in source tree, in the shape `scanReferences` reads. */
function tree(...files) {
  return files.map(([path, text]) => ({ path, text }));
}

const NAMES = new Set(["--nx-text", "--nx-font-size-body-sm", "--nx-space-2"]);

describe("scanReferences", () => {
  it("catches the defect this gate was written for — a misspelled token", () => {
    // The real one, verbatim: the emitted name is kebab-case, and the camelCase
    // spelling was silently dropped by CSS for as long as the title strip had
    // existed.
    const failures = scanReferences(
      NAMES,
      tree(["a.css", ".x {\n  font-size: var(--nx-font-size-bodySm);\n}"]),
    );
    expect(failures).toHaveLength(1);
    expect(failures[0]?.name).toBe("--nx-font-size-bodysm");
    expect(failures[0]?.line).toBe(2);
  });

  it("accepts a reference to a token the build really emits", () => {
    expect(scanReferences(NAMES, tree(["a.css", ".x { color: var(--nx-text); }"]))).toEqual([]);
  });

  it("accepts a component's own private property, declared anywhere in the tree", () => {
    // `--nx-tone` is set on one element and read by that component's own rules.
    // Both orders must pass, which is why the scan collects declarations in a
    // first pass — a single pass would fail every rule above the declaration.
    const readFirst = tree(
      ["read.css", ".a { fill: var(--nx-tone); }"],
      ["set.css", ".b { --nx-tone: red; }"],
    );
    const setFirst = tree(
      ["set.css", ".b { --nx-tone: red; }"],
      ["read.css", ".a { fill: var(--nx-tone); }"],
    );
    expect(scanReferences(NAMES, readFirst)).toEqual([]);
    expect(scanReferences(NAMES, setFirst)).toEqual([]);
  });

  it("skips a name completed at runtime, and does not report its bare prefix", () => {
    const failures = scanReferences(
      NAMES,
      tree(["a.ts", "const c = `var(--nx-swatch-${accent})`;"]),
    );
    expect(failures).toEqual([]);
  });

  it("skips a wildcard written in prose, which is a comment and not a reference", () => {
    expect(
      scanReferences(NAMES, tree(["a.ts", " * read through a `var(--nx-swatch-*)` once."])),
    ).toEqual([]);
  });

  it("still catches a broken reference sitting beside a composed one", () => {
    // The reason the composed test is re-run from each match's own offset
    // rather than once per line: one legitimate `${` must not excuse its
    // neighbour.
    const failures = scanReferences(
      NAMES,
      tree(["a.ts", "`var(--nx-swatch-${a}) var(--nx-nonesuch)`"]),
    );
    expect(failures).toHaveLength(1);
    expect(failures[0]?.name).toBe("--nx-nonesuch");
  });

  it("ignores a custom property outside the --nx- family", () => {
    // `--cal-hour-h` is a page's own local variable; enrolling those would mean
    // re-implementing CSS scoping badly.
    expect(scanReferences(NAMES, tree(["a.css", ".x { height: var(--cal-hour-h); }"]))).toEqual([]);
  });
});

describe("emittedTokenNames", () => {
  it("agrees with the build about how a nested key is spelled", () => {
    const names = emittedTokenNames();
    // camelCase in the JSON, kebab-case on the wire — the exact transformation
    // the misspelling above got wrong.
    expect(names.has("--nx-font-size-body-sm")).toBe(true);
    expect(names.has("--nx-font-size-bodySm")).toBe(false);
    // The semantic layer and the accent swatches both have to be in the set, or
    // the gate would fail the whole app on its most-used tokens.
    expect(names.has("--nx-text-muted")).toBe(true);
    expect(names.has("--nx-surface-raised")).toBe(true);
    expect(names.has("--nx-swatch-zlato")).toBe(true);
  });
});

describe("the repository itself", () => {
  it("has no reference to a token that does not exist", () => {
    expect(scanReferences(emittedTokenNames())).toEqual([]);
  });
});
