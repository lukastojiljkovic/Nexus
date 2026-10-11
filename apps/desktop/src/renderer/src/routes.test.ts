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
/** The kit modules' folder (`apps/desktop/src/modules`), one level above the renderer's `src` — where a discovered page lives (ADR-090). */
const MODULES = join(HERE, "..", "..", "modules");

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
  for (const file of rendererSources()) {
    const name = relative(HERE, file);
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
      // `import.meta.glob(pattern)` with NO `eager` — the kit's discovery
      // (ADR-090). Vite turns every match into a dynamic import, so each match
      // is a lazily reached module; the pattern is expanded here the way the
      // bundler would, which is what keeps a DISCOVERED PAGE out of a startup
      // graph nobody would otherwise ask about.
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === "glob" &&
        node.arguments[0] !== undefined &&
        ts.isStringLiteral(node.arguments[0]) &&
        !isEagerGlob(node)
      ) {
        for (const target of expandGlob(file, node.arguments[0].text)) targets.set(target, name);
      }
      ts.forEachChild(node, visit);
    };
    visit(parse(file));
  }
  return targets;
}

/** Every `.ts`/`.tsx` under the renderer, minus the tests, which are not part of the shipped graph. */
function rendererSources(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules" && entry.name !== "dist" && entry.name !== "out") {
          walk(full);
        }
        continue;
      }
      if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith(".test.ts")) out.push(full);
    }
  };
  walk(HERE);
  return out;
}

/** Whether a glob call passes `{ eager: true }` — the difference between a file in the startup chunk and one in a chunk of its own. */
function isEagerGlob(node: ts.CallExpression): boolean {
  const options = node.arguments[1];
  if (options === undefined || !ts.isObjectLiteralExpression(options)) return false;
  return options.properties.some(
    (property) =>
      ts.isPropertyAssignment(property) &&
      property.name.getText() === "eager" &&
      property.initializer.kind === ts.SyntaxKind.TrueKeyword,
  );
}

/**
 * The files a relative glob pattern matches, expanded segment by segment: `*`
 * stands for one directory, `..`/`.` move the cursor and everything else is a
 * literal name. Enough for the patterns this repository writes, and deliberately
 * not a glob library — a second implementation of Vite's matching rules would be
 * one more thing to keep in step with the bundler.
 */
function expandGlob(from: string, pattern: string): string[] {
  let matches = [dirname(from)];
  for (const segment of pattern.split("/")) {
    if (segment === "..") {
      matches = matches.map((dir) => dirname(dir));
      continue;
    }
    if (segment === ".") continue;
    if (segment === "*") {
      matches = matches.flatMap((dir) =>
        readdirSync(dir, { withFileTypes: true })
          .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
          .map((entry) => join(dir, entry.name)),
      );
      continue;
    }
    matches = matches
      .map((dir) => join(dir, segment))
      .filter((candidate) => existsSync(candidate));
  }
  return matches;
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

  it("loads every DISCOVERED page lazily too, and discovers at least one", () => {
    // A kit module's page is reached through `import.meta.glob` rather than
    // through a line in `routes.tsx` (ADR-090), so the assertions above would
    // not see it at all: the directory-derived list covers `src/renderer`, and
    // the glob expansion is what covers `src/modules`. Both halves are needed —
    // the first would report „nothing wrong" about a page it never looked at,
    // which is the failure this whole file exists to refuse.
    const discovered: string[] = [];
    for (const dir of readdirSync(MODULES)) {
      const page = join(MODULES, dir, "renderer", "Page.tsx");
      if (existsSync(page)) discovered.push(page);
    }
    expect(discovered.length).toBeGreaterThan(0);
    // Every discovered page is in the lazy set (reached by a glob, not by an
    // import) ...
    expect(discovered.filter((page) => !lazy.has(page))).toEqual([]);
    // ... and none of them is also reached STATICALLY from the shell, which is
    // the one way a lazy page stops being one.
    expect(discovered.filter((page) => graph.modules.has(page))).toEqual([]);
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
