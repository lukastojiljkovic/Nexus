/**
 * check:copy — every leaf of the copy table is read by something.
 *
 * WHY THIS GATE EXISTS.
 *
 * The app's user-facing copy is one typed table — 15 927 leaves across the two
 * apps' tables the day this file was written — and NOTHING checked that any of
 * them is ever read. It is the same shape as an unused import, a half-built
 * feature, except that the compiler cannot see it: an unread leaf is a perfectly
 * valid `Strings` member, it type-checks, it lints, `check:string-capture` has
 * nothing to say about it, and it ships.
 *
 * The instance that motivated this file is a separator rule. Four keys sat in a
 * dialog's copy table that the dialog never rendered. Three were column headings
 * for a table the design no longer had — the other way round, and a human's call.
 * The fourth was `waveValuesHint`, the ONLY sentence anywhere telling the user
 * that a list of readings is separated by SEMICOLONS: „Razdvoj vrednosti tačkom
 * i zarezom: 0; 1,5; 3,3". That separator is a rule this app invented, because it
 * writes decimals the Serbian way and „1,5" inside a comma-separated list could
 * be one number or two. Nothing announced it, so a user typing `0, 1,5` got ONE
 * reading and no error — a feature half-shipped, and the half that is missing is
 * the half that explains it.
 *
 * A FINDING HERE IS A QUESTION, NOT A LICENCE. „A hint that was never rendered"
 * and „a heading that was never needed" are opposite defects and they look
 * identical to this file — both are a leaf nobody reads. Classifying which is
 * which means reading the copy, and it is the human's job. Nothing is deleted on
 * the strength of a green check, and nothing is deleted on the strength of a red
 * one either.
 *
 * AND THERE IS A THIRD ANSWER, which the twenty-four below turn out to be full
 * of: copy whose slot was deliberately removed, where the DESIGN is right and
 * the leaf is what was left behind. `dashboard.fitnessToday.todayLabel` reads
 * „Danas", and the row that would draw it carries the comment saying the tag was
 * dropped on purpose („the gutter was spending itself on a word already printed
 * two lines above it"). Nothing there wants rendering; the leaf wants the bin.
 * That distinction is invisible from here and it is the whole reason a human
 * reads this list.
 *
 * WHY THE OBVIOUS RULE IS WRONG, measured over this tree rather than asserted.
 * „Does any source file mention this leaf's name" is the scan anybody writes
 * first, and it fails both ways at once:
 *   - on the leaf's own NAME it names 15 915 of the census's 15 927 leaves —
 *     `title`, `start`, `space` and `heading` are ordinary words — and 15 895 of
 *     those are read, so 99.9% of its report is noise;
 *   - on the leaf's full dotted PATH it names 782, and every one of them is
 *     read: it finds none of the twenty-four leaves this gate reports.
 * One mechanism produces both numbers. `s.reasons[row.reason]` is how the app
 * reads a whole class of tables — wire-skip reasons, unit labels, waveform
 * kinds, weekday names — because the key is a runtime tag (a union member, a
 * registry id), not a word in the program. The leaf is read every time the
 * dialog opens and is never NAMED, and neither is the path above it.
 *
 * THE RULE, and this is the whole difficulty: a leaf is READ when any of
 *   (a) something NAMES it — a property chain that spells its path
 *       (`strings.settings.appearance.themeLabel`), a literal index that spells
 *       it (`strings.pro.agro["bale-count-storage"]`), or the path written as
 *       DATA in a source file (`titleKey: "devtools.name.riscv"`, which the
 *       registry resolves at runtime); or
 *   (b) AN ANCESTOR IS INDEXED COMPUTATIONALLY — `s.tool[tool.id]`,
 *       `lookup(s.units, unit.id)`, or `Object.keys`/`values`/`entries` over
 *       one — which marks that ancestor's entire subtree as read, because the
 *       code that indexes it knows the subtree's boundary and cannot know the
 *       keys; or
 *   (c) AN ANCESTOR IS HANDED OUT OF THIS WALK'S SIGHT — `formatStructuredError(
 *       s.errors, …)`, `<BitwiseOperandView s={s} />`, `chrome: () => strings.pro`
 *       — which is not a finding and is not proof either; see the BOUNDARY
 *       below.
 * Everything else is a finding.
 *
 * THE BOUNDARY, and the reason the verdict has TWO tiers. (c) is real evidence:
 * `formatStructuredError(s.errors, s.position, …)` is a helper whose `errors`
 * parameter is deliberately typed `Readonly<Record<string, string>>`, because it
 * is generic over which error table it formats — the PATH exists only at the
 * call site, and all sixty leaves of that table are read by the line that hands
 * them over. But „handed to a helper that indexes it" and „handed to a component
 * that ignores the prop" are the same statement to this file, and they are
 * opposite facts. So the leaves under a handoff are NOT the verdict: they are
 * printed as NOT JUDGED on the same run, and counted on the green line. Dropping
 * them would lose a real finding (`pro.biznis.iban-check.bban2` is one — the app
 * reads `s.bban`, a key that was not always spelled that way); calling them
 * findings would put 206 leaves on a red list that a reader learns to scroll
 * past. The gate says which leaves it cannot decide about instead of deciding.
 *
 * THE ONE PLACE THE RULE IS DELIBERATELY NARROWER than its own wording: an index
 * — or a handoff — on the table ROOT does NOT clear every leaf.
 * `lookupString(strings, control.labelKey)` is in the tree, and honouring it
 * literally would make this gate silent by construction: the root is indexed
 * somewhere in any app this size. The honest answer is not „assume fine" but „the
 * subtree boundary is what the code knows": at the root it knows nothing, while
 * the KEYS it indexes with are themselves written down, as dotted literals in the
 * registries, where clause (a) sees them. If the root is ever indexed by keys that
 * are NOT written anywhere, the leaves behind those keys are the ones this gate
 * cannot see — and that is stated here rather than papered over.
 *
 * WHAT IT CANNOT SEE, said plainly so a green run is not read as proof:
 *   - What is read on the OTHER SIDE of a handoff. A leaf under one is not
 *     judged, and a leaf that a callee reads by a computed key is cleared
 *     nowhere — that is the whole of the second tier, and the count of it is on
 *     every run so it cannot be mistaken for zero.
 *   - A binding reached through a default or a helper's return
 *     (`const s = pickCopy("pro.agro")`). Only `const s = <chain>` and an
 *     annotated parameter/type are followed, so a table reached that way is
 *     reported while it is in fact read — the recommendation is the same one the
 *     finding already asks for.
 *   - An array's ELEMENTS. `weekdayShort: ["pon", …]` is one leaf, read or not
 *     as a whole; the tables' arrays are each indexed with a computed key at
 *     their call sites (`s.weekdayShort[iso - 1]`), which clears the leaf, so
 *     none of them is a finding today.
 *   - WHICH clause cleared a leaf beyond the first one that matches: `read`
 *     records the strongest evidence, so a leaf named in one file and indexed in
 *     another says `named`. The clauses are ordered by strength, not by truth.
 *   - The `enumerated` clause has NO WITNESS in this tree — not one
 *     `Object.keys/values/entries` over a copy subtree exists today, so a
 *     `0 enumerated` tally is what a working clause and a dead one both produce.
 *     It is pinned by a fixture case beside this file, and only there.
 *   - A TEST that reads a leaf. The walk covers `apps` and `packages` whole, and
 *     tests are files like any other: a leaf only a suite names is counted as
 *     read. The direction of that error is a MISSED finding — the safe one —
 *     and it is stated so that „read" is not over-read either.
 *   - The two apps share a path space. A leaf of the desktop table and a leaf of
 *     the web table with the same dotted path are cleared by the same evidence;
 *     today they can only be cleared, never falsely freed, because reads are
 *     attributed per app (`app` on the row) and a shared file reaches both.
 *
 * NO ALLOWLIST, and one is not wanted. Every clause above is a statement about
 * what the code DOES, so a leaf that stops being read stops being cleared by
 * anything, which is exactly what a finding is. An entry list would be the thing
 * that rots: it would survive the deletion of the call site it was written for,
 * and the next reader would find the opposite of the truth in it.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import ts from "typescript";

/**
 * The repository this gate lives in, and the default both the census and the
 * verdict read: `scanRepo()` with no argument has to mean the real tree, or a CI
 * run would be judging whatever fixture was passed last.
 */
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The tables the census starts from — the two apps' own roots, each with the
 * name it exports. A leaf's path is what it is called under its root, so the
 * desktop's `modules.dashboard` and the web's are different ROWS of the census
 * even though they spell the same dotted path.
 */
const ENTRIES = [
  { file: "apps/desktop/src/renderer/src/strings.sr.ts", exported: "sr", app: "desktop" },
  { file: "apps/web/src/strings.ts", exported: "strings", app: "web" },
];

/**
 * Where the modules a table composes from live. The big table is an index of
 * them — `devtools: devtoolsSr`, `gradnja: PRO_GRADNJA_SR` — and the leaf is
 * written in the module, so that is the file and the line a finding has to name.
 */
const MODULE_DIRS = ["apps/desktop/src/renderer/src/strings"];

/**
 * A DISCOVERED module's own copy table: `modules/<id>/renderer/copy.sr.ts`,
 * with `copy.en.ts` beside it (ADR-090).
 *
 * **Why these are found rather than listed.** The kit's whole promise is that a
 * module is a folder nobody has to register, and this gate is the other half of
 * that promise: the shell's table was covered from the day this file was written
 * and a module's was covered by NOTHING — so a module could ship a sentence no
 * screen reads and no run would say so. The table is discovered off the same
 * folder contract `shared/modules.ts` globs, which is why a module that exists
 * is measured without anybody adding it here.
 *
 * The file is read ON ITS OWN rather than through the shared index: that index
 * is keyed by the exported name, and a module's table exports `sr` exactly as
 * the shell's does — so a shared index would let the second one silently
 * overwrite the first.
 */
function kitCopyFiles(root) {
  const found = [];
  const modulesDir = join(root, "apps", "desktop", "src", "modules");
  let names;
  try {
    names = readdirSync(modulesDir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of names.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (!entry.isDirectory()) continue;
    const file = join(modulesDir, entry.name, "renderer", "copy.sr.ts");
    if (existsSync(file)) found.push(relPath(root, file));
  }
  return found;
}

/** Build output, installed packages, and the screenshot sweep's own output. */
const SKIP_DIRS = new Set(["node_modules", "out", "dist", "release", "shots", ".turbo"]);

/** Where a READER of the copy can live. Both apps, and the packages they share. */
const SCAN_ROOTS = ["apps", "packages"];

/**
 * A module that exports a copy table, as a consumer writes the specifier — the
 * repo's convention is the `.js` extension over a `.ts` file, and both `strings`
 * and the source table `strings.sr` are imported directly (the tests do).
 *
 * `copy.js` is the third name, and it belongs to the KIT (ADR-090): a module
 * built from its own folder registers its table with `defineModuleCopy` and
 * hands it out under the one name the kit's convention fixes, so this gate can
 * see that `copy.countdowns.start` is a read without knowing which module wrote
 * it. A module that exported its table under another name would be invisible
 * here — which is why the name is a convention rather than a preference, and
 * why `adding-a-module.md` spells it out.
 */
const TABLE_MODULE = /(?:^|\/)(?:strings(?:\.sr)?|copy)\.js$/;

/** The helpers that read a table by a key only known at runtime. */
const DYNAMIC_READERS = new Set(["lookup", "lookupString"]);

/** The three that walk a table's own keys. */
const ENUMERATORS = new Set(["keys", "values", "entries"]);

/**
 * A dotted path written as DATA. At least two segments, because a single word is
 * not evidence of anything — `"title"` appears in a hundred files, and a table
 * with a top-level `title` would be cleared by every one of them.
 */
const PATH_LITERAL = /^[A-Za-z_$][\w$-]*(?:\.[\w$-]+)+$/;

/** The clause that cleared a leaf, strongest evidence first. */
const CLAUSES = ["named", "keyed", "indexed", "enumerated", "handed"];

/** A key the code computes, where a path segment would be. */
const COMPUTED = Symbol("computed");

/** Every file under `dir` whose name ends in one of `endings`. */
function walk(dir, endings, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(join(dir, entry.name), endings, out);
    } else if (endings.some((ending) => entry.name.endsWith(ending))) {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

/** A path as this file spells it: forward slashes, relative to the root. */
function relPath(root, file) {
  return relative(root, file).split(sep).join("/");
}

/**
 * Which table a file's reads belong to. A file under neither app can reach both
 * tables, so it counts for both — the conservative direction, since a read that
 * clears a leaf is evidence and a missing one is a report somebody has to read.
 */
function appOf(path) {
  if (path.startsWith("apps/desktop/")) return "desktop";
  if (path.startsWith("apps/web/")) return "web";
  return "shared";
}

/** `as const`, `satisfies X` and parentheses hide the literal underneath. */
function unwrap(node) {
  let current = node;
  while (
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isParenthesizedExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

/** The type inside `(X)` and `readonly X`, which carry nothing of their own. */
function unwrapType(node) {
  if (ts.isParenthesizedTypeNode(node)) return unwrapType(node.type);
  if (ts.isTypeOperatorNode(node)) return unwrapType(node.type);
  return node;
}

/** A node that owns its parameters, and is a scope for the names they bind. */
function isFunctionLike(node) {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  );
}

/** Every `type X = …` and `interface X { … }` in one file, in source order. */
function typeDeclarationsIn(sf) {
  const found = [];
  const visit = (node) => {
    if (ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node)) found.push(node);
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
  return found;
}

/** The 1-based line of `node`, which is what a human opens the file to find. */
function lineOf(sf, node) {
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
}

/** The key a member contributes, or `null` for one this file cannot read. */
function keyOf(member) {
  const name = member.name;
  if (name === undefined) return null;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  if (ts.isComputedPropertyName(name)) {
    const inside = unwrap(name.expression);
    if (ts.isStringLiteral(inside) || ts.isNoSubstitutionTemplateLiteral(inside)) return inside.text;
  }
  return null;
}

/**
 * Every top-level `export const NAME = { … }` in these modules, by NAME.
 *
 * A table composes another module's object by referencing it, and the exporter's
 * name is how this file follows the reference; no two tables in the tree share
 * one, which is what makes the name a key rather than a guess.
 */
export function tableIndex(files) {
  const index = new Map();
  for (const [file, text] of files) {
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    for (const statement of sf.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      const modifiers = statement.modifiers ?? [];
      if (!modifiers.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined) continue;
        const value = unwrap(declaration.initializer);
        if (!ts.isObjectLiteralExpression(value)) continue;
        if (!index.has(declaration.name.text)) {
          index.set(declaration.name.text, { node: value, sf, file });
        }
      }
    }
  }
  return index;
}

/**
 * Every leaf of one table, as `[{ file, line, path }]`.
 *
 * A leaf is anything that is not an object: a string, a concatenation of two, a
 * template, a `null` (the electronics units table uses one for a unit that has
 * no word), an array, or an identifier this file cannot follow. The unit is the
 * leaf and not the class of value, because a leaf is what a translator writes
 * and what a screen reads, and both are the same thing whichever shape it has.
 */
export function tableLeaves(entry, index = new Map(), path = [], seen = new Set()) {
  const rows = [];
  const object = unwrap(entry.node);
  if (!ts.isObjectLiteralExpression(object)) return rows;
  for (const member of object.properties) {
    if (!ts.isPropertyAssignment(member)) continue;
    const key = keyOf(member);
    if (key === null) continue;
    const here = [...path, key];
    const value = unwrap(member.initializer);
    const composed = ts.isIdentifier(value) ? index.get(value.text) : undefined;
    if (composed !== undefined) {
      if (seen.has(composed.node)) continue;
      rows.push(
        ...tableLeaves(composed, index, here, new Set([...seen, composed.node])),
      );
      continue;
    }
    if (ts.isObjectLiteralExpression(value)) {
      rows.push(...tableLeaves({ node: value, sf: entry.sf, file: entry.file }, index, here, seen));
      continue;
    }
    rows.push({
      file: entry.file,
      line: lineOf(entry.sf, member.name),
      path: here.join("."),
    });
  }
  return rows;
}

/** A node that can hold a binding — what a reference walks up the tree to find. */
function isScope(node) {
  return (
    ts.isSourceFile(node) ||
    ts.isBlock(node) ||
    ts.isModuleBlock(node) ||
    ts.isCaseBlock(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node) ||
    ts.isForStatement(node) ||
    ts.isForInStatement(node) ||
    ts.isForOfStatement(node)
  );
}

/** The innermost scope a binding declares into. */
function enclosingScope(node) {
  for (let parent = node.parent; parent !== undefined; parent = parent.parent) {
    if (isScope(parent)) return parent;
  }
  return undefined;
}

/**
 * What a name stands for at a reference, walking outwards: the path its
 * initializer resolves to, `null` for a binding this file cannot follow, or
 * `undefined` for a name nothing here binds.
 *
 * The `null` is load-bearing. A name bound to something that is NOT the copy
 * table (`const s = makeThing()`) has to STOP the walk rather than be skipped
 * over, or the shadowing file would be read through the outer alias and would
 * mark a subtree as read that it never touches.
 */
function bindingAt(name, node, bindings) {
  for (let at = node; at !== undefined; at = at.parent) {
    if (!isScope(at)) continue;
    const scope = bindings.get(at);
    if (scope !== undefined && scope.has(name)) return scope.get(name);
  }
  return undefined;
}

/**
 * Every expression in `text` that reads a copy table, as five sets of paths.
 *
 * The five are the five WAYS the app reads its copy, and each is a clause of the
 * verdict: `named` (a chain that spells the path), `keyed` (the path written as a
 * dotted literal), `indexed` (a computed key on a subtree, or a `lookup` call),
 * `enumerated` (`Object.keys`/`values`/`entries` over one) and `handed` (a
 * subtree passed to a call, a prop, or a return, where the walk stops). `paths`
 * is every path the tables contain, so a chain that continues past a leaf —
 * `s.title.length` — records the leaf rather than the method.
 */
export function readsIn(text, file, paths) {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const found = {
    named: new Set(),
    keyed: new Set(),
    indexed: new Set(),
    enumerated: new Set(),
    handed: new Set(),
  };

  /**
   * The names this file imported from a copy table. Resolving them rather than
   * assuming them is what keeps the walk honest: a local `strings` bound to
   * something else is not this table, and only an import says which it is.
   */
  const roots = new Set();
  for (const statement of sf.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const specifier = statement.moduleSpecifier;
    if (!ts.isStringLiteral(specifier) || !TABLE_MODULE.test(specifier.text)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings !== undefined && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) roots.add(element.name.text);
    }
  }
  // NOT an early return when `roots` is empty: a file that never imports the
  // table can still hold its keys — `titleKey: "devtools.name.riscv"` lives in
  // the module registry, which reads no copy at all. The chain clauses are inert
  // without a root, deliberately, so only the binding pass is skipped.
  const bindings = new Map();
  /** The file's own type declarations, by name — a props type names a subtree. */
  const typeDeclarations = new Map();
  const namedTypes = new Map();
  const record = (scope, name, value) => {
    const known = bindings.get(scope) ?? new Map();
    bindings.set(scope, known);
    if (!known.has(name)) known.set(name, value);
  };
  const bind = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const scope = enclosingScope(node);
      if (scope !== undefined) {
        const at = chainOf(node.initializer);
        record(scope, node.name.text, at === null ? null : at.path);
      }
    }
    if (isFunctionLike(node)) bindParameters(node);
    ts.forEachChild(node, bind);
  };
  if (roots.size > 0) {
    // The type declarations first: a parameter's type is resolved through them,
    // and `type B = A["x"]` is as likely to be written above `type A` as below.
    for (const declaration of typeDeclarationsIn(sf)) {
      if (!typeDeclarations.has(declaration.name.text)) {
        typeDeclarations.set(declaration.name.text, declaration);
      }
    }
    ts.forEachChild(sf, bind);
  }

  /**
   * What an expression reads: `{ path, computed }`, or `null` when it reads
   * nothing in the table.
   *
   * A chain is resolved from its root outwards so that the LONGEST prefix which
   * is a real path wins: `s.counts.length` reads `counts`, and a walk that kept
   * the whole trail would record `counts.length`, miss the table, and report a
   * leaf that is read on the line below the one that reads it.
   *
   * `computed` is the whole of clause (b): the chain hit a key the code builds
   * (`s.week.shapes[shape]`), so what is read is the SUBTREE up to that key and
   * not one leaf in it. The two facts travel together rather than being two
   * functions, because the binding pass needs the path a computed chain lands on
   * — `const copy = s.week.shapes[shape]` is how `copy.name` reaches a leaf the
   * dialogs above can see, and it is the reason those leaves are not findings.
   */
  function chainOf(node) {
    const segments = [];
    let current = node;
    while (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
      if (ts.isPropertyAccessExpression(current)) {
        segments.unshift(current.name.text);
      } else {
        const argument = unwrap(current.argumentExpression);
        if (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument)) {
          segments.unshift(argument.text);
        } else {
          // A computed key: everything past it is unknowable, and the subtree it
          // is applied to is what this clause is about.
          segments.unshift(COMPUTED);
        }
      }
      current = current.expression;
    }
    if (!ts.isIdentifier(current)) return null;
    return resolve(current, segments);
  }

  /** The same walk, from a root identifier this file knows something about. */
  function resolve(root, segments) {
    const start = roots.has(root.text) ? "" : bindingAt(root.text, root, bindings);
    if (start === undefined || start === null) return null;

    let path = start;
    let last = paths.has(path) ? path : null;
    for (const segment of segments) {
      if (segment === COMPUTED) return last === null ? null : { path: last, computed: true };
      path = path === "" ? segment : `${path}.${segment}`;
      if (paths.has(path)) last = path;
    }
    return last === null ? null : { path: last, computed: false };
  }

  /**
   * What a function's own parameters stand for.
   *
   * A subtree reaches a name this way more often than it reaches one by being
   * re-read: `function ModeSwitch({ s }: ModeSwitchProps)` reads
   * `s.modeAssemble`, and nothing in the function body names the table at all.
   * An annotated parameter is bound to the path its TYPE names; a destructured
   * one is bound through the props type's property, which is how
   * `(typeof strings.pro.kuhinja)["pan-area-volume"]` arrives at a name.
   *
   * A parameter that is NOT one of these is bound to `null` rather than left
   * unbound, and that is deliberate: it stops the outward walk at the parameter,
   * so a function's `s` never resolves through some outer `s` that happens to
   * share the letter — which would clear leaves on a name that never referred to
   * them.
   */
  function bindParameters(fn) {
    for (const parameter of fn.parameters) {
      if (ts.isIdentifier(parameter.name)) {
        record(fn, parameter.name.text, pathOfType(parameter.type));
        continue;
      }
      if (!ts.isObjectBindingPattern(parameter.name)) continue;
      const properties = propertiesOfType(parameter.type);
      for (const element of parameter.name.elements) {
        if (!ts.isIdentifier(element.name)) continue;
        const named = element.propertyName;
        const key =
          named !== undefined && ts.isIdentifier(named) ? named.text : element.name.text;
        record(fn, element.name.text, pathOfType(properties.get(key)));
      }
    }
  }

  /** The properties a props type declares, by name: inline literal or interface. */
  function propertiesOfType(node) {
    const type = node === undefined ? undefined : unwrapType(node);
    if (type === undefined) return new Map();
    if (ts.isTypeLiteralNode(type)) return propertyTypes(type.members);
    if (ts.isTypeReferenceNode(type) && ts.isIdentifier(type.typeName)) {
      const declaration = typeDeclarations.get(type.typeName.text);
      if (declaration === undefined) return new Map();
      if (ts.isInterfaceDeclaration(declaration)) return propertyTypes(declaration.members);
      const aliased = unwrapType(declaration.type);
      if (ts.isTypeLiteralNode(aliased)) return propertyTypes(aliased.members);
    }
    return new Map();
  }

  function propertyTypes(members) {
    const found = new Map();
    for (const member of members) {
      if (!ts.isPropertySignature(member)) continue;
      const name = member.name;
      if (name === undefined) continue;
      if (ts.isIdentifier(name) || ts.isStringLiteral(name)) {
        if (!found.has(name.text)) found.set(name.text, member.type);
      }
    }
    return found;
  }

  /** `strings.pro.kuhinja` written in TYPE space, as a root and its segments. */
  function entityOf(name) {
    const segments = [];
    let current = name;
    while (ts.isQualifiedName(current)) {
      segments.unshift(current.right.text);
      current = current.left;
    }
    return ts.isIdentifier(current) ? { root: current, segments } : null;
  }

  /**
   * The path a TYPE names, or `null`.
   *
   * THE SECOND WAY A SUBTREE REACHES A NAME, and the one the first draft of this
   * gate went without: a component that renders one tool does not re-read
   * `strings.devtools.riscv` — it takes the subtree as a prop, typed
   * `RiscvStrings` or `(typeof strings.pro.kuhinja)["pan-area-volume"]`, and
   * reads `s.modeAssemble` through the parameter. Most of the first three
   * hundred and seventy-six findings this gate produced were that shape, and
   * every one of them was a leaf that IS read — which is exactly the report that
   * gets a gate switched off.
   *
   * The TYPE is better evidence than the call site: `Strings["devtools"]["riscv"]`
   * is a statement TypeScript checks, where the argument at one call site is a
   * statement about one call site.
   */
  function pathOfType(node) {
    const type = node === undefined ? undefined : unwrapType(node);
    if (type === undefined) return null;
    if (ts.isTypeQueryNode(type)) {
      const name = entityOf(type.exprName);
      return name === null ? null : (resolve(name.root, name.segments)?.path ?? null);
    }
    if (ts.isIndexedAccessTypeNode(type)) {
      const base = pathOfType(type.objectType);
      const index = unwrapType(type.indexType);
      if (base === null || !ts.isLiteralTypeNode(index)) return null;
      if (!ts.isStringLiteral(index.literal)) return null;
      return base === "" ? index.literal.text : `${base}.${index.literal.text}`;
    }
    if (ts.isTypeReferenceNode(type) && ts.isIdentifier(type.typeName)) {
      return namedTypePath(type.typeName.text);
    }
    return null;
  }

  /**
   * A named type, resolved once — `type B = A["x"]` may precede `type A`.
   *
   * The table's own imported type names (`Strings`, imported beside `strings`)
   * are the ROOT and not a subtree: `type RiscvStrings = Strings["devtools"]
   * ["riscv"]` indexes the table the way a value chain does, and a file that
   * names either half of that pair has said which table it means.
   */
  function namedTypePath(name) {
    const known = namedTypes.get(name);
    if (known !== undefined) return known;
    // Guard first: an alias that names itself must not recurse forever.
    namedTypes.set(name, null);
    const declaration = typeDeclarations.get(name);
    const found =
      declaration !== undefined && ts.isTypeAliasDeclaration(declaration)
        ? pathOfType(declaration.type)
        : roots.has(name)
          ? ""
          : null;
    namedTypes.set(name, found);
    return found;
  }

  // Pass two: the reads.
  const read = (node) => {
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const read = chainOf(node);
      if (read !== null) found[read.computed ? "indexed" : "named"].add(read.path);
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      // The two shapes are separate guards, and they were one until a fixture
      // case asked: `const callee = node.expression.text` never matches
      // `Object.values`, whose callee is a property access and not an
      // identifier, so the enumerated clause could not fire at all — its
      // `0 enumerated` in the tally was a dead clause and not a quiet one, and
      // nothing in this repository could tell the two apart. That case is the
      // only thing that did.
      if (ts.isIdentifier(callee) && DYNAMIC_READERS.has(callee.text)) {
        const table = node.arguments[0];
        // The ROOT excepted, deliberately — see the header. A `lookup` on a
        // subtree is the app saying „the keys are runtime tags inside this
        // object"; a `lookup` on the whole table says nothing about any leaf,
        // and honouring it would clear every one of them.
        const at = table === undefined ? null : chainOf(table);
        if (at !== null && at.path !== "") found.indexed.add(at.path);
      } else if (isObjectCall(node) && ENUMERATORS.has(callee.name.text)) {
        const at = node.arguments[0] === undefined ? null : chainOf(node.arguments[0]);
        if (at !== null && at.path !== "") found.enumerated.add(at.path);
      }
    }
    if (ts.isStringLiteral(node) && !isNamePosition(node) && PATH_LITERAL.test(node.text)) {
      if (paths.has(node.text)) found.keyed.add(node.text);
    }
    // Clause (c): a subtree handed out of this walk's sight is not judged. See
    // `handoffs` for what counts as a handoff, and the header for why a HANDOFF
    // is evidence rather than a nicety.
    for (const expression of handoffs(node)) {
      const at = chainOf(expression);
      if (at !== null && at.path !== "") found.handed.add(at.path);
    }
    // `` `dashboard.config.fields.${key}` `` — a template whose head is a real
    // path computes a key INSIDE that subtree, and the subtree is what is read:
    // no name and no literal anywhere says which leaf, which is the same
    // statement `s.tool[tool.id]` makes.
    //
    // The head has to be a DOTTED path, for the reason a one-word string literal
    // is not evidence either: `dashboard.${id}.title` is a NAMESPACE a registry
    // builds — `packages/core`'s `plan.test.ts` writes exactly that — and a
    // single-segment head would clear the whole `dashboard` subtree on the
    // strength of it. Measured: relaxing this to a bare trailing dot took the
    // verdict from 24 leaves to 23 and the one it lost was `todayLabel`, which
    // nothing reads. Two segments plus `paths.has` is the same evidence the
    // dotted-literal clause asks for, and a template that is a sentence has
    // neither.
    if (ts.isTemplateExpression(node)) {
      const head = node.head.text.replace(/\.$/, "");
      if (PATH_LITERAL.test(head) && paths.has(head)) found.indexed.add(head);
    }
    ts.forEachChild(node, read);
  };
  ts.forEachChild(sf, read);
  return found;
}

/**
 * The expression `node` hands a subtree to, or `null`.
 *
 * A handoff is one of the three ways a value leaves the sight of this walk: an
 * ARGUMENT to a call, a JSX ATTRIBUTE, or a RETURN. In all three the code on the
 * other side decides what is read, this walk cannot follow it, and the honest
 * answer about the leaves under it is „not judged" rather than „unread".
 *
 * It is a HANDOFF and not a finding because the alternative is a report nobody
 * reads: `formatStructuredError(s.errors, s.position, …)` is a helper whose
 * `errors` parameter is deliberately typed `Readonly<Record<string, string>>`,
 * because it is generic over which error table it formats — the PATH exists only
 * at the call site, and every one of that table's sixty leaves is read by the
 * line that hands them over. `chrome: () => strings.tools` is the same shape one
 * hop further out: the drawer's copy is chosen at a call this walk cannot see
 * into, and both drawers' chrome would otherwise be reported twice over.
 */
function handoffs(node) {
  if (ts.isCallExpression(node)) return node.arguments.map((argument) => unwrap(argument));
  if (ts.isReturnStatement(node) && node.expression !== undefined) return [unwrap(node.expression)];
  // A concise arrow IS a return, and this is the case that made the rule
  // necessary rather than tidy: `chrome: () => strings.tools` is how the tool
  // drawer's copy reaches its page, and there is no `return` node to find.
  if (ts.isArrowFunction(node) && !ts.isBlock(node.body)) return [node.body];
  if (ts.isJsxAttribute(node) && node.initializer !== undefined && ts.isJsxExpression(node.initializer)) {
    const expression = node.initializer.expression;
    return expression === undefined ? [] : [expression];
  }
  return [];
}

/** `Object.keys(…)`, and not `myMap.keys(…)`, which walks someone else's keys. */
function isObjectCall(node) {
  const callee = node.expression;
  return (
    ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(callee.expression) &&
    callee.expression.text === "Object"
  );
}

/** A string literal used as a NAME — a key, a module specifier, an attribute. */
function isNamePosition(node) {
  const parent = node.parent;
  if (parent === undefined) return false;
  if (parent.name === node) return true;
  if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) return true;
  if (ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent)) return true;
  if (ts.isJsxAttribute(parent)) return true;
  return false;
}

/**
 * The set of every path the tables contain — leaves and the objects above them.
 *
 * Exported because it IS the path space the reads are recorded in, and a fixture
 * that hand-built its own would be asserting against a different space from the
 * one the walk reads in. `pathsOf(census)` takes the rows the census returns, so
 * a test can hand `readsIn` a string and the real table's paths together.
 */
export function pathsOf(rows) {
  const paths = new Set();
  for (const row of rows) {
    const segments = row.path.split(".");
    for (let at = 1; at <= segments.length; at += 1) paths.add(segments.slice(0, at).join("."));
  }
  return paths;
}

/**
 * Which clause of the rule reads a leaf, or `null` when nothing does.
 *
 * The five are asked in the order of the strength of the evidence, and the last
 * three ask about ANCESTORS rather than the leaf: an index on `pro.packs` clears
 * everything under `pro.packs`, because the code that wrote the index knows the
 * subtree's boundary and cannot know the keys.
 */
function clauseFor(path, ...sources) {
  const any = (clause, matches) => sources.some((reads) => matches(reads[clause]));
  if (any("named", (set) => set.has(path))) return "named";
  if (any("keyed", (set) => set.has(path))) return "keyed";
  if (any("indexed", (set) => underSubtree(set, path))) return "indexed";
  if (any("enumerated", (set) => underSubtree(set, path))) return "enumerated";
  if (any("handed", (set) => underSubtree(set, path))) return "handed";
  return null;
}

/** The five empty sets a file's reads merge into, or one app's running total. */
function noReads() {
  return {
    named: new Set(),
    keyed: new Set(),
    indexed: new Set(),
    enumerated: new Set(),
    handed: new Set(),
  };
}

/**
 * The census: one row per leaf of every copy table, each carrying the clause
 * that reads it — or `null`, which is what a finding is.
 *
 * `read` is the census's whole point. The verdict on this tree is not `[]` — it
 * is the twenty-four leaves below — and „found nothing" and „looked at nothing"
 * are the same shape from the outside, so a test has to be able to ask a
 * different question: was this leaf looked at, and if something reads it, WHAT.
 * `named` is a chain that spells it, `keyed` is its path written as data,
 * `indexed` and `enumerated` are an ancestor read by runtime key, and `handed`
 * is the second tier — an ancestor that left this walk's sight. Ordering is by
 * strength of evidence and not by truth — a leaf named in one file and indexed
 * in another reports the first — so the column answers „is it read" and „how",
 * never „how alone".
 *
 * `root` is a parameter so the verdict can be shown to FIRE on a tree of its
 * own, not only to be quiet on this one: a walk pointed at the wrong directory
 * returns no rows, and a walk whose reader broke returns rows with every
 * `read` at `null` — two different failures that a bare `[]` cannot tell apart.
 */
export function repoCopyLeaves(root = repoRoot) {
  const files = new Map();
  for (const entry of ENTRIES) {
    try {
      files.set(entry.file, readFileSync(join(root, entry.file), "utf8"));
    } catch {
      // A checkout without one of the two apps is not this gate's problem.
    }
  }
  for (const dir of MODULE_DIRS) {
    for (const file of walk(join(root, dir), [".ts"])) {
      files.set(relPath(root, file), readFileSync(file, "utf8"));
    }
  }

  const index = tableIndex(files);
  const rows = [];
  for (const entry of ENTRIES) {
    const table = index.get(entry.exported);
    if (table === undefined) continue;
    for (const leaf of tableLeaves(table, index)) {
      rows.push({ ...leaf, app: entry.app, read: null });
    }
  }
  // A kit module's table, indexed on its own so the shell's `sr` cannot shadow
  // it — the two export the same name by convention, which is exactly why one
  // shared index would be wrong here.
  for (const file of kitCopyFiles(root)) {
    const own = tableIndex(new Map([[file, files.get(file) ?? readFileSync(join(root, file), "utf8")]]));
    const table = own.get("sr");
    if (table === undefined) continue;
    for (const leaf of tableLeaves(table, own)) {
      rows.push({ ...leaf, app: "desktop", read: null });
    }
  }
  const paths = pathsOf(rows);

  const reads = { desktop: noReads(), web: noReads(), shared: noReads() };
  for (const file of SCAN_ROOTS.flatMap((dir) => walk(join(root, dir), [".ts", ".tsx"]))) {
    const path = relPath(root, file);
    const where = reads[appOf(path)];
    const here = readsIn(readFileSync(file, "utf8"), path, paths);
    for (const clause of CLAUSES) {
      for (const at of here[clause]) where[clause].add(at);
    }
  }

  for (const row of rows) {
    row.read = clauseFor(row.path, reads[row.app], reads.shared);
  }

  // `readdirSync` order is the filesystem's, not ours, and this is an artifact a
  // reader and a test both compare.
  return rows.sort(
    (a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line),
  );
}

/** Is any ancestor of `path` in `tables`? The clause that clears a subtree. */
function underSubtree(tables, path) {
  const segments = path.split(".");
  for (let at = 1; at <= segments.length; at += 1) {
    if (tables.has(segments.slice(0, at).join("."))) return true;
  }
  return false;
}

/**
 * The verdict over a census, on its own so a fixture can ask it a question
 * without a repository.
 *
 * A leaf with no clause is a finding. That is the whole rule: no name, no key,
 * no indexed ancestor — nothing in the tree reads it, and the only two ways that
 * can be true are a copy that was never wired up and a copy that was never
 * needed.
 */
export function findings(census) {
  return census.filter((leaf) => leaf.read === null);
}

/**
 * The leaves no clause read, and the walk cannot even ask about: an ancestor of
 * each was handed to a call, an attribute or a return, and what happens on the
 * other side is not in this file.
 *
 * This is NOT the verdict — `findings` is — and the difference matters. „Handed
 * to `formatStructuredError`, whose `errors` parameter indexes whatever table it
 * is given" is a leaf that is READ, and reporting it would be the report that
 * gets a gate switched off; „handed to a component that ignores the prop" is a
 * leaf that is not, and dropping it would lose a real finding. The gate cannot
 * tell them apart, so it says which it cannot tell apart, on the same run, and a
 * human decides. A green run prints the count of these and nothing else.
 */
export function unjudged(census) {
  return census.filter((leaf) => leaf.read === "handed");
}

/** Every unread leaf in `root` — the real tree unless given one. */
export function scanRepo(root = repoRoot) {
  return findings(repoCopyLeaves(root));
}

function main() {
  const census = repoCopyLeaves();
  const reports = findings(census);
  const tally = CLAUSES.map(
    (clause) => `${census.filter((leaf) => leaf.read === clause).length} ${clause}`,
  ).join(", ");
  if (reports.length > 0) {
    console.error(`check-copy: ${reports.length} copy leaf/leaves nothing reads.\n`);
    for (const f of reports) console.error(`  ${f.file}:${f.line}: ${f.path}`);
    console.error(
      `\nOf ${census.length} leaf/leaves: ${tally}.\n` +
        "A leaf nothing reads is half a feature, and the half that is missing is\n" +
        "the one that explains it: `waveValuesHint` was the only sentence saying a\n" +
        "list of readings is separated by semicolons, so `0, 1,5` was one reading\n" +
        "and no error. Read each one — a hint nobody renders and a heading nobody\n" +
        "needed are opposite defects and they look identical here — then either\n" +
        "render it or record why it is gone.",
    );
    // The second list is what keeps the report honest about its own reach: these
    // are the leaves that no clause read, under a subtree that left this walk's
    // sight. Somewhere in here a dead hint can hide (`pro.biznis.iban-check.bban2`
    // is one — the app reads `s.bban`, a key that was not always spelled that
    // way), and this gate will not be the one to say so.
    const notJudged = unjudged(census);
    if (notJudged.length > 0) {
      console.error(
        `\nNot judged: ${notJudged.length} more leaf/leaves under a subtree that is\n` +
          "handed to code this walk cannot follow — an argument, a prop or a\n" +
          "return. They are read by nothing this file can see, which is not the\n" +
          "same as being read by nothing.\n",
      );
      for (const f of notJudged) console.error(`  ${f.file}:${f.line}: ${f.path}`);
    }
    process.exit(1);
  }
  // The tally is on the green line, so that a run which read nothing says so
  // instead of printing the sentence a run which read everything prints.
  console.log(
    `check-copy: every copy leaf is read ` +
      `(${census.length} leaf/leaves — ${tally}; ` +
      `${unjudged(census).length} more are handed out of sight and not judged).`,
  );
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
