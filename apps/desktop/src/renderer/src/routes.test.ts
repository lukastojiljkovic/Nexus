import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * The startup chunk is what `main.tsx` reaches through STATIC imports, and a
 * lazy page is only lazy while nothing on that path imports it.
 *
 * That is the one way `routes.tsx` can be defeated, and it is silent: one value
 * import of a page module from anything the shell loads puts the whole page
 * back in the startup chunk, and the build succeeds, the app works and every
 * other test passes — it is only slower, by however much the page weighs. The
 * bundler does print a warning when a module is both imported and
 * `import()`ed, but a warning in a build log is a sentence nobody is made to
 * read. This test is the version that fails.
 *
 * It reads source rather than the build, on purpose: it runs in `pnpm test`
 * with no build output, and the question — „what does the shell import" — is a
 * question about the import graph, which the source states exactly. Types are
 * erased and so are not edges: `import type` and all-`type` specifier lists are
 * skipped, which is what lets `App.tsx` keep naming `TasksIntent`.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const ENTRY = join(HERE, "main.tsx");

function parse(file: string): ts.SourceFile {
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  return ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, kind);
}

/** `./x.js` from `file` → the `.ts`/`.tsx` on disk, or null for a stylesheet or anything else. */
function resolveRelative(file: string, specifier: string): string | null {
  const base = join(dirname(file), specifier).replace(/\.js$/, "");
  for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** An import or re-export that exists at runtime — neither `import type` nor a list of types only. */
function isValueEdge(statement: ts.ImportDeclaration | ts.ExportDeclaration): boolean {
  if (ts.isExportDeclaration(statement)) return !statement.isTypeOnly;
  const clause = statement.importClause;
  if (clause === undefined) return true; // `import "./x.css"` — an effect, and an edge
  if (clause.isTypeOnly) return false;
  const bindings = clause.namedBindings;
  if (clause.name === undefined && bindings !== undefined && ts.isNamedImports(bindings)) {
    return bindings.elements.length === 0 || bindings.elements.some((e) => !e.isTypeOnly);
  }
  return true;
}

interface Graph {
  /** Every renderer or shared module reached, as absolute paths. */
  readonly modules: Set<string>;
  /** Every package specifier a reached module imports by value (`katex`, `@tiptap/react`). */
  readonly packages: Map<string, string>;
}

/** The static value-import graph from one entry, through relative specifiers. */
function staticGraph(entry: string): Graph {
  const modules = new Set<string>();
  const packages = new Map<string, string>();
  const queue = [entry];
  for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
    if (modules.has(file)) continue;
    modules.add(file);
    for (const statement of parse(file).statements) {
      if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue;
      const specifier = statement.moduleSpecifier;
      if (specifier === undefined || !ts.isStringLiteral(specifier)) continue;
      if (!isValueEdge(statement)) continue;
      if (specifier.text.startsWith(".")) {
        const target = resolveRelative(file, specifier.text);
        if (target !== null) queue.push(target);
      } else if (!packages.has(specifier.text)) {
        packages.set(specifier.text, relative(HERE, file));
      }
    }
  }
  return { modules, packages };
}

/** Every renderer module some other renderer module reaches with `import("./…")`. */
function dynamicTargets(): Map<string, string> {
  const targets = new Map<string, string>();
  for (const name of readdirSync(HERE)) {
    if (!/\.tsx?$/.test(name) || name.endsWith(".test.ts")) continue;
    const file = join(HERE, name);
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments[0] !== undefined &&
        ts.isStringLiteral(node.arguments[0]) &&
        node.arguments[0].text.startsWith(".")
      ) {
        const target = resolveRelative(file, node.arguments[0].text);
        if (target !== null) targets.set(target, name);
      }
      ts.forEachChild(node, visit);
    };
    visit(parse(file));
  }
  return targets;
}

/**
 * Dependencies that belong to one page each and weigh enough to matter — the
 * reason the split was worth doing, named so a regression names itself.
 * Excalidraw is STATUS §4.1's own item; KaTeX draws formulas on „Učenje"; the
 * editor stack (TipTap, ProseMirror, Yjs) is the note and private-note editor.
 * This is a list, and a list can miss a newcomer; what it cannot do is go
 * stale in the dangerous direction, because every entry is a package the
 * startup path must never import directly.
 */
const PAGE_ONLY_PACKAGES = [/^@excalidraw\//, /^katex$/, /^@tiptap\//, /^prosemirror-/, /^yjs$/];

describe("the startup import graph", () => {
  const graph = staticGraph(ENTRY);
  const lazy = dynamicTargets();

  it("reaches the shell at all", () => {
    // „Found nothing" and „looked at nothing" must not be the same green line.
    const reached = [...graph.modules].map((file) => relative(HERE, file));
    expect(reached).toContain("App.tsx");
    expect(reached).toContain("routes.tsx");
    expect(lazy.size).toBeGreaterThan(0);
  });

  it("loads every page lazily", () => {
    // Derived from the directory rather than listed: a page added tomorrow is
    // a `…Page.tsx` file, and it is covered the day it is written.
    const pages = readdirSync(HERE).filter((name) => /Page\.tsx$/.test(name));
    const notLazy = pages.filter((name) => !lazy.has(join(HERE, name)));
    expect(notLazy).toEqual([]);
  });

  it("does not also reach a lazily loaded module statically", () => {
    // Each finding names the lazy module and the file that `import()`s it; the
    // static path back to `main.tsx` is what `pnpm build`'s warning prints.
    const defeated = [...lazy]
      .filter(([target]) => graph.modules.has(target))
      .map(([target, by]) => `${relative(HERE, target)} (import()ed by ${by})`);
    expect(defeated).toEqual([]);
  });

  it("imports no page-only dependency", () => {
    const eager = [...graph.packages]
      .filter(([specifier]) => PAGE_ONLY_PACKAGES.some((pattern) => pattern.test(specifier)))
      .map(([specifier, by]) => `${specifier} (from ${by})`);
    expect(eager).toEqual([]);
  });
});
