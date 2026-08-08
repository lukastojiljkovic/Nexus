// Unit tests for `check-string-capture.mjs` — the gate that keeps a read of the
// `strings` table from being evaluated once, at import, where no later
// `applyLocale` can ever reach it.
//
// This gate shipped without tests and without a CI step, which is the worst
// combination a gate can have: its whole job is to be quiet, so a regression in
// the AST walk — one `SyntaxKind` dropped from `insideDeferredScope`, one
// `forEachChild` that stops descending — turns it into a script that prints
// "no module-scope reads" over a tree full of them, and nothing anywhere looks
// different. That is DC-01, which this repo has already paid for: an auditor
// that finds nothing and a tree that is clean are indistinguishable unless the
// auditor is proven to still catch the thing it was written for.
//
// So every test below hands the walk engineered source and asserts BOTH
// directions — what must trip it, and what must not — and only the last one
// looks at the repository.

import { describe, expect, it } from "vitest";

import { auditAll, findScanFiles, REPO_ROOT, scanSource } from "./check-string-capture.mjs";

/** Just the flagged expressions, which is what a reader of the failure output sees. */
const texts = (source) => scanSource("x.tsx", source).map((hit) => hit.text);

describe("scanSource — what must trip the gate", () => {
  it("catches the defect this gate was written for — a label frozen at import", () => {
    // Verbatim the shape from the module header: a module-scope table of
    // commands, each carrying a string copied out before the user has chosen a
    // language. It compiles, it tests green, and the menu stays Serbian.
    const source = `const COMMANDS = [{ label: strings.search.commands.newTask }];`;
    expect(texts(source)).toEqual(["strings.search.commands.newTask"]);
  });

  it("catches a subtree alias, which is safe in fact and banned on purpose", () => {
    // `strings.tasks` holds the very object `applyLocale` rewrites, so this one
    // would actually work. It is rejected anyway: a rule with an exception
    // needs case law, and „safe" here rests on an invariant of `applyLocale`
    // that a future edit could quietly break.
    expect(texts(`const s = strings.tasks;`)).toEqual(["strings.tasks"]);
  });

  it("catches a read inside a module-scope template literal", () => {
    expect(texts("const heading = `${strings.tasks.title} — Nexus`;")).toEqual([
      "strings.tasks.title",
    ]);
  });

  it("catches the module-scope read beside a default parameter, and only that one", () => {
    // A default parameter's initialiser sits syntactically inside a function
    // but is evaluated per call, so it is genuinely deferred and must NOT trip.
    // Its module-scope sibling reads the identical path and must — which is the
    // pair that proves the walk decides by SCOPE and not by the text it sees.
    const source = [
      `const FALLBACK = strings.common.none;`,
      `export function render(label = strings.common.none) { return label; }`,
    ].join("\n");
    expect(texts(source)).toEqual(["strings.common.none"]);
    expect(scanSource("x.tsx", source)[0]?.line).toBe(1);
  });

  it("reports the outermost access once, not every link in the chain", () => {
    // `strings.a.b.c` is three nested PropertyAccessExpressions. Reporting each
    // would be three findings for one defect, and a gate that inflates its own
    // count is a gate people learn to skim.
    expect(texts(`const x = strings.a.b.c;`)).toHaveLength(1);
  });

  it("reports the line and column of the read itself", () => {
    const source = ["const a = 1;", "const x = strings.a.b;"].join("\n");
    expect(scanSource("x.tsx", source)).toEqual([
      expect.objectContaining({ line: 2, column: 11 }),
    ]);
  });
});

describe("scanSource — what must not trip the gate", () => {
  it("accepts a read inside a function body, which re-reads on every call", () => {
    expect(texts(`function Title() { return strings.tasks.title; }`)).toEqual([]);
  });

  it("accepts a read inside an arrow component, the shape most of the app uses", () => {
    expect(texts(`export const Title = () => <h1>{strings.tasks.title}</h1>;`)).toEqual([]);
  });

  it("accepts a read inside a method, a getter and a constructor", () => {
    const source = `class Labels {
  get title() { return strings.tasks.title; }
  set title(_v) { void strings.tasks.title; }
  constructor() { this.t = strings.tasks.title; }
  read() { return strings.tasks.title; }
}`;
    expect(texts(source)).toEqual([]);
  });

  it("accepts a class property initialiser, which runs at construction and not at import", () => {
    // Treated as deferred because it genuinely is. There are none in this tree
    // today; the rule is written to be true rather than merely convenient.
    expect(texts(`class L { title = strings.tasks.title; }`)).toEqual([]);
  });

  it("does not fire on an identifier that merely begins with `strings`", () => {
    // A gate that cries wolf gets muted (DC-01), so the root of the chain has
    // to be the identifier `strings` exactly, never a prefix of one.
    expect(texts(`const x = stringsCatalogue.tasks.title;`)).toEqual([]);
  });

  it("does not fire on a property called `strings` hanging off something else", () => {
    expect(texts(`const x = config.strings.tasks;`)).toEqual([]);
  });

  it("does not fire on the import that brings the table in", () => {
    expect(texts(`import { strings } from "./strings";`)).toEqual([]);
  });
});

describe("findScanFiles", () => {
  it("walks the renderer and skips the two files where the table is defined", () => {
    const files = findScanFiles();
    expect(files.length).toBeGreaterThan(50); // sanity: the walk found the tree
    const names = files.map((f) => f.split(/[\\/]/).pop());
    expect(names).not.toContain("strings.ts");
    expect(names).not.toContain("strings.sr.ts");
    expect(files.every((f) => f.startsWith(REPO_ROOT))).toBe(true);
  });
});

describe("the repository itself", () => {
  it("has no module-scope read of the strings table", () => {
    expect(auditAll()).toEqual([]);
  });
});
