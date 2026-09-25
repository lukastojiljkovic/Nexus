import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { REPO_ROOT, repoRelative } from "./check-colours.mjs";

/**
 * `"sideEffects"` is a CLAIM a package makes to the bundler, and nothing else in
 * the repository checks it.
 *
 * `false` tells Rollup that importing any module of the package and using none
 * of its exports does nothing — so it may drop the module whole, top-level code
 * included. That is what let the web shell fall from 632 106 bytes to 246 175 on
 * 2026-09-26: the FIT food catalogue and most of `@nexus/core` were in it only
 * because Rollup could not prove that a module-scope `new Map(...)` or `utf8(...)`
 * was harmless, and the declaration is how it is told.
 *
 * **The claim is wrong the day a module starts doing something at import time
 * that somebody depends on, and nothing notices.** Vitest does not tree-shake,
 * so every suite goes on passing; `tsc` has no opinion; the dev server serves
 * modules unbundled. Only the BUILT product loses the effect, silently, and only
 * where the importer used none of the module's exports — which is exactly the
 * case a side-effect import exists for. This file is what keeps the claim true:
 *
 *  1. every package under `packages/` declares the field, because a package
 *     that omits it is the defect this started from — nothing in it can be
 *     tree-shaken — and a new package would omit it by default;
 *  2. the declaration is `false`, or a list of stylesheet globs and nothing
 *     else, because a stylesheet is the one thing a package here imports for
 *     its effect;
 *  3. no module in a declaring package imports another for its effect alone
 *     (`import "./x.js"`), since that is the import the bundler now deletes;
 *  4. no module-scope STATEMENT reaches past its own module. Filling a map the
 *     module itself declared is local — `pro/tekst.ts` builds its two
 *     transliteration tables in two top-level loops, and dropping both along
 *     with the unused module loses nothing. Calling an import, writing a
 *     global, or pushing into somebody else's registry is not local, and is the
 *     shape that would vanish.
 *
 * **Why the apps do not declare it,** measured rather than assumed: adding it
 * to `apps/desktop`, `apps/web` and `apps/gallery` changed the size of every
 * build output by exactly zero bytes, because an app's own modules are all
 * reached for their exports. What it WOULD change is `CanvasPage.tsx`'s
 * `import "./excalidrawAssets.js"` — a side-effect import that sets the global
 * Excalidraw reads its font path from — which the bundler would then be free
 * to drop, sending every font request to the CSP's refusal. Rule 3 applies to
 * any workspace member that declares the field, so an app that later does is
 * checked the same way and that import is its first finding.
 *
 * **What it does not see:** a module-scope effect hidden inside a declaration
 * — `const x = register(...)` — because an initializer that calls an import is
 * also how `const SESSION_INFO = utf8("…")` computes a constant, and no reader
 * of the text can tell the two apart. Nor does it follow a call into a local
 * function's body: `init()` at module scope is reported as a call, not traced.
 */

/** Every workspace member that has a `package.json`, as `{ dir, rel, pkg }`. */
function workspaceMembers(repoRoot = REPO_ROOT) {
  const members = [];
  for (const group of ["apps", "packages"]) {
    const groupDir = join(repoRoot, group);
    if (!existsSync(groupDir)) continue;
    for (const name of readdirSync(groupDir)) {
      const dir = join(groupDir, name);
      const manifest = join(dir, "package.json");
      if (!existsSync(manifest)) continue;
      members.push({
        dir,
        rel: `${group}/${name}`,
        group,
        pkg: JSON.parse(readFileSync(manifest, "utf8")),
      });
    }
  }
  return members;
}

/** The directories a member's shipped modules live in: `src/`, and `gen/` where a build writes source. */
const SHIPPED_ROOTS = ["src", "gen"];

/** Script modules a bundler would read. Tests are excluded: nothing ships them. */
function isShippedModule(name) {
  return /\.(m?[jt]sx?|cts)$/.test(name) && !/\.d\.[cm]?ts$/.test(name) && !/\.test\./.test(name);
}

function shippedModules(dir) {
  const out = [];
  const walk = (at) => {
    for (const entry of readdirSync(at)) {
      if (entry === "node_modules") continue;
      const full = join(at, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (isShippedModule(entry)) out.push(full);
    }
  };
  for (const root of SHIPPED_ROOTS) {
    const full = join(dir, root);
    if (existsSync(full)) walk(full);
  }
  return out;
}

/** A module whose import is for its effect by design: the stylesheet. */
const STYLESHEET = /\.css(\?.*)?$/;

/** The leftmost identifier of `a.b.c`, `a[b]`, `a.b()`, `(a)`; null when there is none (`this`, a literal). */
function rootIdentifier(node) {
  let at = node;
  for (;;) {
    if (ts.isIdentifier(at)) return at.text;
    if (
      ts.isPropertyAccessExpression(at) ||
      ts.isElementAccessExpression(at) ||
      ts.isCallExpression(at) ||
      ts.isNonNullExpression(at) ||
      ts.isParenthesizedExpression(at) ||
      ts.isAsExpression(at) ||
      ts.isSatisfiesExpression(at)
    ) {
      at = at.expression;
      continue;
    }
    return null;
  }
}

/** Names a binding pattern introduces — `x`, `[a, b]`, `{ c, d: e }`. */
function boundNames(name, into) {
  if (ts.isIdentifier(name)) into.add(name.text);
  else for (const element of name.elements) if (!ts.isOmittedExpression(element)) boundNames(element.name, into);
}

const DECLARATION_KINDS = new Set([
  ts.SyntaxKind.ImportDeclaration,
  ts.SyntaxKind.ImportEqualsDeclaration,
  ts.SyntaxKind.ExportDeclaration,
  ts.SyntaxKind.ExportAssignment,
  ts.SyntaxKind.FunctionDeclaration,
  ts.SyntaxKind.ClassDeclaration,
  ts.SyntaxKind.InterfaceDeclaration,
  ts.SyntaxKind.TypeAliasDeclaration,
  ts.SyntaxKind.EnumDeclaration,
  ts.SyntaxKind.ModuleDeclaration,
  ts.SyntaxKind.VariableStatement,
  ts.SyntaxKind.EmptyStatement,
]);

const ASSIGNMENT_OPERATORS = new Set([
  ts.SyntaxKind.EqualsToken,
  ts.SyntaxKind.PlusEqualsToken,
  ts.SyntaxKind.MinusEqualsToken,
  ts.SyntaxKind.AsteriskEqualsToken,
  ts.SyntaxKind.SlashEqualsToken,
  ts.SyntaxKind.PercentEqualsToken,
  ts.SyntaxKind.AmpersandEqualsToken,
  ts.SyntaxKind.BarEqualsToken,
  ts.SyntaxKind.CaretEqualsToken,
  ts.SyntaxKind.LessThanLessThanEqualsToken,
  ts.SyntaxKind.GreaterThanGreaterThanEqualsToken,
  ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken,
  ts.SyntaxKind.AsteriskAsteriskEqualsToken,
  ts.SyntaxKind.QuestionQuestionEqualsToken,
  ts.SyntaxKind.BarBarEqualsToken,
  ts.SyntaxKind.AmpersandAmpersandEqualsToken,
]);

/**
 * Every place one module could act on the world at import time, as
 * `{ line, rule, text }`. `rule` is `bare-import` or `escaping-statement`.
 */
export function importTimeEffects(text, fileName = "module.ts") {
  const kind = fileName.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, kind);
  const findings = [];
  const at = (node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;

  // What the module itself owns. An import is deliberately NOT here: a call on
  // an imported binding is a call into somebody else's state.
  const moduleLocal = new Set();
  for (const statement of source.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        boundNames(declaration.name, moduleLocal);
      }
    }
  }

  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement) && statement.importClause === undefined) {
      const specifier = statement.moduleSpecifier.text;
      if (!STYLESHEET.test(specifier)) {
        findings.push({ line: at(statement), rule: "bare-import", text: specifier });
      }
      continue;
    }
    if (DECLARATION_KINDS.has(statement.kind)) continue;

    // Bindings the statement introduces itself — a loop's `const [a, b]`, a
    // block's own `const` — are as local as the module's.
    const local = new Set(moduleLocal);
    const escapes = [];
    const visit = (node) => {
      if (ts.isVariableDeclaration(node)) boundNames(node.name, local);
      if (ts.isFunctionLike(node) && node !== statement) return; // a body defined here is not RUN here
      if (ts.isCallExpression(node)) {
        const root = rootIdentifier(node.expression);
        if (root === null || !local.has(root)) escapes.push(node.expression.getText(source));
      }
      if (ts.isBinaryExpression(node) && ASSIGNMENT_OPERATORS.has(node.operatorToken.kind)) {
        const root = rootIdentifier(node.left);
        if (root === null || !local.has(root)) escapes.push(node.left.getText(source));
      }
      if (
        (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
        (node.operator === ts.SyntaxKind.PlusPlusToken ||
          node.operator === ts.SyntaxKind.MinusMinusToken)
      ) {
        const root = rootIdentifier(node.operand);
        if (root === null || !local.has(root)) escapes.push(node.operand.getText(source));
      }
      ts.forEachChild(node, visit);
    };
    visit(statement);
    if (escapes.length > 0) {
      findings.push({ line: at(statement), rule: "escaping-statement", text: escapes.join(", ") });
    }
  }
  return findings;
}

describe("importTimeEffects", () => {
  it("passes declarations, and initializers it cannot judge", () => {
    const text = [
      'import { utf8 } from "./bytes.js";',
      'export { thing } from "./thing.js";',
      'export * from "./all.js";',
      'const INFO = utf8("nexus/v1");',
      "export function f() { globalThis.x = 1; }",
      "export class C { static n = 0; }",
      "export interface I { a: string }",
      "export type T = string;",
      "export const enum E { A }",
      "declare global { interface Window { y?: 1 } }",
    ].join("\n");
    expect(importTimeEffects(text)).toEqual([]);
  });

  it("passes a module-scope loop that only fills the module's own table", () => {
    // `pro/tekst.ts`'s exact shape.
    const text = [
      'const PAIRS = [["а", "a"]];',
      "const MAP = new Map();",
      "for (const [cyrillic, latin] of PAIRS) {",
      "  if ([...latin].length > 1) continue;",
      "  MAP.set(cyrillic, latin);",
      "  MAP.set(cyrillic.toUpperCase(), latin.toUpperCase());",
      "}",
      "let count = 0;",
      "count += 1;",
      "count++;",
    ].join("\n");
    expect(importTimeEffects(text)).toEqual([]);
  });

  it("reports an import made for its effect, and not a stylesheet", () => {
    const text = ['import "./register-all.js";', 'import "./styles.css";', 'import "x/y.css?inline";'].join(
      "\n",
    );
    expect(importTimeEffects(text)).toEqual([
      { line: 1, rule: "bare-import", text: "./register-all.js" },
    ]);
  });

  it("reports a statement that writes a global, calls an import, or fills an imported registry", () => {
    const text = [
      'import { registry, init } from "./registry.js";',
      "window.EXCALIDRAW_ASSET_PATH = '/x/';",
      "globalThis.ready = true;",
      "init();",
      'registry.register("tool");',
      "Object.freeze(registry);",
      "registry.count++;",
    ].join("\n");
    expect(importTimeEffects(text).map(({ line, rule }) => `${line}:${rule}`)).toEqual([
      "2:escaping-statement",
      "3:escaping-statement",
      "4:escaping-statement",
      "5:escaping-statement",
      "6:escaping-statement",
      "7:escaping-statement",
    ]);
  });

  it("reports a call on a local function, because what it does is not followed", () => {
    const text = ["function setUp() {}", "setUp();"].join("\n");
    expect(importTimeEffects(text)).toEqual([{ line: 2, rule: "escaping-statement", text: "setUp" }]);
  });

  it("does not count a function DEFINED in a statement as run by it", () => {
    const text = ["const handlers = [];", "handlers.push(() => { globalThis.x = 1; });"].join("\n");
    expect(importTimeEffects(text)).toEqual([]);
  });

  it("reports the desktop app's own font-path module, which is why the app does not declare the field", () => {
    const text = readFileSync(
      join(REPO_ROOT, "apps/desktop/src/renderer/src/excalidrawAssets.ts"),
      "utf8",
    );
    expect(importTimeEffects(text, "excalidrawAssets.ts").map((f) => f.rule)).toEqual([
      "escaping-statement",
    ]);
  });
});

describe("the sideEffects declarations", () => {
  const members = workspaceMembers();

  it("finds the workspace at all", () => {
    // „Found nothing" and „looked at nothing" must not be the same green line.
    expect(members.filter((m) => m.group === "packages").length).toBeGreaterThanOrEqual(9);
    expect(members.filter((m) => m.group === "apps").length).toBeGreaterThanOrEqual(3);
  });

  it("are made by every package", () => {
    const silent = members
      .filter((m) => m.group === "packages" && m.pkg.sideEffects === undefined)
      .map((m) => m.rel);
    expect(silent).toEqual([]);
  });

  it("claim nothing but stylesheets", () => {
    const wider = members
      .filter((m) => m.pkg.sideEffects !== undefined && m.pkg.sideEffects !== false)
      .filter(
        (m) =>
          !Array.isArray(m.pkg.sideEffects) ||
          m.pkg.sideEffects.some((glob) => typeof glob !== "string" || !glob.endsWith(".css")),
      )
      .map((m) => `${m.rel}: ${JSON.stringify(m.pkg.sideEffects)}`);
    expect(wider).toEqual([]);
  });

  it("are true of every module they cover", () => {
    const declaring = members.filter((m) => m.pkg.sideEffects !== undefined);
    const findings = [];
    const unread = [];
    for (const member of declaring) {
      const files = shippedModules(member.dir);
      if (files.length === 0) unread.push(member.rel);
      for (const file of files) {
        for (const finding of importTimeEffects(readFileSync(file, "utf8"), file)) {
          findings.push(`${repoRelative(file)}:${finding.line} ${finding.rule} — ${finding.text}`);
        }
      }
    }
    expect(findings).toEqual([]);
    // The census, for the same reason as above, and per member rather than as a
    // total: a figure would be one more number to keep true by hand, while „every
    // declaring package had modules to read" cannot go stale. A member whose
    // shipped roots moved would otherwise pass here with nothing checked.
    expect(unread).toEqual([]);
  });
});
