// No shebang — same reason as the other two gates: this module is a CLI and an
// import target for its own tests, and Vite does not strip a shebang from an
// `.mjs` it transforms.
//
// WHY THIS GATE EXISTS. Switching language rewrites the leaves of the `strings`
// table in place, keeping the object's identity, so everything that reads
// `strings.a.b` AT CALL TIME sees the new text — which is every render, every
// error mapper, every comparator, and every subtree alias.
//
// The one thing that does not work is a read evaluated ONCE, when the module
// is first imported:
//
//     const COMMANDS = [{ label: strings.search.commands.newTask }];  // frozen
//
// That copies a primitive out of the table before the user has chosen anything,
// and no later `applyLocale` can reach it. The app still compiles, every test
// still passes, and the defect appears only as a few Serbian labels inside an
// otherwise translated UI — in a menu somebody has to actually open.
//
// TypeScript cannot see this: the type of a string is the same whenever it was
// read. So the discipline has to be enforced structurally, and this is that
// enforcement — the same move `check-colours.mjs` makes for raw colour values.
//
// THE RULE. Inside the desktop renderer, a `strings.…` expression may not be
// evaluated at module scope. Put it inside the function that uses it, or expose
// it through a getter, and it becomes live again at no cost.
//
// A SUBTREE alias (`const s = strings.tasks;`) is, strictly, safe — it holds
// the very object being rewritten. It is banned anyway, deliberately: telling
// leaf reads from subtree reads requires resolving types, „safe" here depends
// on an invariant of `applyLocale` that a future edit could quietly break, and
// a rule with an exception is a rule nobody can apply from memory. A flat ban
// is one sentence and needs no case law.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, relative, sep } from "node:path";
import ts from "typescript";

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(HERE, "..");

/**
 * The two trees whose files import a live copy table: the shell's renderer, and
 * every DISCOVERED module's `renderer/` folder (ADR-090).
 *
 * The second was a hole for as long as the kit has existed: a kit module carries
 * its own table (`copy.ts`, registered with `defineModuleCopy`), and a module
 * that read `copy.countdowns.start` at module scope would freeze a sentence
 * exactly the way a `strings.…` read does — while this gate, pointed only at
 * `src/renderer`, never opened the file that did it.
 */
const SCAN_ROOTS = [
  join(REPO_ROOT, "apps", "desktop", "src", "renderer"),
  join(REPO_ROOT, "apps", "desktop", "src", "modules"),
];

/**
 * Where a table is DEFINED rather than consumed: the shell's `strings` and its
 * Serbian source, and a kit module's own three files — `copy.sr.ts`/`copy.en.ts`
 * are data and `copy.ts` is the one place the live object is built.
 */
const EXEMPT = new Set(["strings.ts", "strings.sr.ts", "copy.ts", "copy.sr.ts", "copy.en.ts"]);

/**
 * The module a kit module's copy table is imported FROM. The one name the kit
 * fixes (`adding-a-module.md` spells it out), because the table's identity as
 * „a live table“ is what the rule is about — a module that handed its table out
 * of some other file would be invisible here, which the header states below
 * rather than pretending otherwise.
 */
const COPY_MODULE = /(?:^|\/)copy\.js$/;

export function findScanFiles(root = SCAN_ROOTS) {
  const out = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      // A checkout without one of the trees is not this gate's problem.
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry !== "node_modules" && entry !== "dist" && entry !== "out") walk(full);
        continue;
      }
      if (/\.(ts|tsx)$/.test(entry) && !EXEMPT.has(entry)) out.push(full);
    }
  };
  for (const dir of Array.isArray(root) ? root : [root]) walk(dir);
  return out;
}

/**
 * True when `node` sits inside something that runs later than module
 * evaluation — any function, method, accessor or class member initialiser.
 *
 * Class property initialisers run at construction, not at import, so they are
 * as safe as a method body; there are none in this tree today, and treating
 * them as safe keeps the rule honest rather than merely convenient.
 */
function insideDeferredScope(node) {
  for (let parent = node.parent; parent !== undefined; parent = parent.parent) {
    switch (parent.kind) {
      case ts.SyntaxKind.FunctionDeclaration:
      case ts.SyntaxKind.FunctionExpression:
      case ts.SyntaxKind.ArrowFunction:
      case ts.SyntaxKind.MethodDeclaration:
      case ts.SyntaxKind.GetAccessor:
      case ts.SyntaxKind.SetAccessor:
      case ts.SyntaxKind.Constructor:
      case ts.SyntaxKind.PropertyDeclaration:
        return true;
      default:
        break;
    }
  }
  return false;
}

/** Find the leftmost identifier of a property-access chain: `a.b.c` -> `a`. */
function rootIdentifier(node) {
  let current = node;
  while (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
    current = current.expression;
  }
  return ts.isIdentifier(current) ? current.text : null;
}

/**
 * Report every module-scope read of the strings table in one file.
 * Returns `[{ line, column, text }]`.
 */
export function scanSource(filePath, text) {
  const source = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true);
  const hits = [];
  /**
   * The names this file bound a LIVE copy table to. Resolved from the imports
   * rather than assumed, on the same rule the walk above applies to `strings`: a
   * local called `copy` bound to something else is not this table, and only an
   * import says which it is.
   */
  const copyRoots = new Set();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const specifier = statement.moduleSpecifier;
    if (!ts.isStringLiteral(specifier) || !COPY_MODULE.test(specifier.text)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings === undefined || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) copyRoots.add(element.name.text);
  }
  const visit = (node) => {
    const root = ts.isPropertyAccessExpression(node) ? rootIdentifier(node) : null;
    if (ts.isPropertyAccessExpression(node) && (root === "strings" || copyRoots.has(root))) {
      // Only report the OUTERMOST access of a chain, so `strings.a.b.c` is one
      // finding rather than three nested ones.
      const parentIsAccess =
        node.parent !== undefined && ts.isPropertyAccessExpression(node.parent) &&
        node.parent.expression === node;
      if (!parentIsAccess && !insideDeferredScope(node)) {
        const { line, character } = source.getLineAndCharacterOfPosition(node.getStart(source));
        hits.push({ line: line + 1, column: character + 1, text: node.getText(source).slice(0, 80) });
      }
      return;
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(source, visit);
  return hits;
}

export function auditAll() {
  const findings = [];
  for (const file of findScanFiles()) {
    for (const hit of scanSource(file, readFileSync(file, "utf8"))) {
      findings.push({ file: relative(REPO_ROOT, file).split(sep).join("/"), ...hit });
    }
  }
  return findings;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const findings = auditAll();
  if (findings.length === 0) {
    console.log("check-string-capture: no module-scope reads of a copy table.");
    process.exit(0);
  }
  console.error(
    `check-string-capture: ${findings.length} module-scope read(s) of a copy table ` +
      "(the shell's `strings` or a kit module's `copy`).\n" +
      "These are evaluated once at import and can never change language.\n",
  );
  for (const f of findings) {
    console.error(`  ${f.file}:${f.line}:${f.column}  ${f.text}`);
  }
  console.error(
    "\nMove the read inside the function that uses it, or expose it as a getter.",
  );
  process.exit(1);
}
