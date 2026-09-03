// No shebang, for the reason the other gates in this directory have none: this
// module is both a CLI (`node scripts/check-ids.mjs`) and an import target for
// its own tests.
//
// WHY THIS GATE EXISTS.
//
// An identifier is the field nobody thinks of as untrusted input. It is opaque,
// the app minted it, and it is „just a key“ — so at both of this product's trust
// boundaries every id got the one check that asks whether the string exists, and
// no check at all on what it is:
//
//   nonEmptyStr(raw.profileId, "profileId")        // the archive reader,  46x
//   asNonEmptyString(payload.id, "id")             // the IPC wire,       160x
//
// Neither caps anything. That would be a curiosity if something downstream did,
// and nothing does: `RestoreStore` and every store write through prepared
// statements rather than through each module's validators, and no migration puts
// a CHECK on an id column past `NOT NULL`. So the reader is the only bound
// between an archive file and the database, and the wire is the only bound
// between a compromised renderer and the same place. A ten-megabyte `profileId`
// was a row that landed, that every later query carried, and that no screen
// could draw.
//
// It is invisible to everything else in the tree. It type-checks — `string` is
// `string`. It lints. It uses no colour and no token. It is not a missing check
// but a check that is present and answers a different question, which is the
// shape a review reads past: the call LOOKS validated.
//
// THE RULE. A field whose name is `id` or ends in `Id` must be validated with a
// helper that bounds it — `idStr`/`nullableIdStr` in the archive reader, and
// `asId`/`asNullableId`/`asAccountId` on the wire. The unbounded string helpers
// may not be applied to one.
//
// WHAT IT DELIBERATELY DOES NOT WATCH.
//
// - `packages/db`. A store's `validateNonEmpty` reads an argument from MAIN, not
//   from a file or the renderer; its contract is with code on this side of the
//   wall. Bounding there is defence in depth, and worth doing, but it is not
//   this rule and a gate that conflated them would be enforcing a boundary that
//   does not exist.
// - Composite keys that are not NAMED like ids — `occurrenceKey`,
//   `sourceBlockKey`. Both are bounded in the reader by hand. A name-shaped rule
//   cannot see them, and widening it to `*Key` would swallow `chord.key`, which
//   is a keyboard key and may legitimately be a single space.
// - A field name the source computes (`` `checksums.${key}` ``). Undecidable
//   here, and none of them are ids.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";

import ts from "typescript";

import { REPO_ROOT } from "./check-address.mjs";

/**
 * The unbounded string validators, and what each boundary's bounded one is
 * called. Keyed by the vocabulary a boundary uses, because the two are separate
 * modules that cannot share a helper: one throws `InvalidFieldError` and reports
 * a problem row, the other throws the IPC layer's `Error`.
 */
const UNBOUNDED = new Map([
  ["nonEmptyStr", "idStr"],
  ["nullableNonEmptyStr", "nullableIdStr"],
  ["str", "idStr"],
  ["nullableStr", "nullableIdStr"],
  ["asNonEmptyString", "asId"],
  ["asString", "asId"],
  ["asNullableString", "asNullableId"],
]);

/** Directory names the walk never enters. */
const SKIP_DIRS = new Set(["node_modules", "out", "dist", "shots", ".turbo"]);

/** Where the two boundaries live. `packages/db` is deliberately absent — see the header. */
const SCAN_ROOTS = ["apps", "packages/core"];

/**
 * A field name that names an identifier: `id`, or a camelCase name ending in
 * `Id`, as the LAST segment of a dotted or bracketed path — so `task.listId`
 * and `` `${field}[${index}].id` `` both count, and `checksums.${key}` does not.
 */
const ID_FIELD = /(?:^|[.\]])(?:[A-Za-z0-9]*Id|id)$/;

/** Every `.ts`/`.tsx` under {@link SCAN_ROOTS}, minus {@link SKIP_DIRS}. */
export function scanFiles(root = REPO_ROOT) {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : 1,
    )) {
      const child = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(child);
      } else if (/\.tsx?$/.test(entry.name)) {
        files.push(child);
      }
    }
  };
  for (const scanRoot of SCAN_ROOTS) {
    const dir = join(root, scanRoot);
    try {
      if (statSync(dir).isDirectory()) walk(dir);
    } catch {
      // A checkout without one of the roots is not this gate's problem.
    }
  }
  return files;
}

/**
 * The statically readable TAIL of a field-name argument, or `null`.
 *
 * A plain literal is its own tail. A template's tail is the text after its last
 * interpolation — `` `${field}[${index}].id` `` ends in `.id` and is an id;
 * `` `checksums.${key}` `` ends in nothing at all and is undecidable, which is
 * the honest answer for a name the source computes.
 */
function fieldTail(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (!ts.isTemplateExpression(node)) return null;
  const last = node.templateSpans[node.templateSpans.length - 1];
  return last === undefined ? node.head.text : last.literal.text;
}

/**
 * Findings for one file's source, as `[{ file, line, helper, field, expected }]`.
 *
 * Over the AST rather than a regex, and the reason is this file: a gate that
 * read raw text would fire on the two example calls in `packages/core/src/ids.ts`'s
 * header, which are documentation of the defect. A rule whose own explanation
 * trips it teaches people to stop writing the explanation.
 */
export function scanSource(relPath, source) {
  const parsed = ts.createSourceFile(relPath, source, ts.ScriptTarget.Latest, true);
  const findings = [];
  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const expected = UNBOUNDED.get(node.expression.text);
      const arg = node.arguments[1];
      const field = expected !== undefined && arg !== undefined ? fieldTail(arg) : null;
      if (expected !== undefined && field !== null && ID_FIELD.test(field)) {
        findings.push({
          file: relPath,
          line: parsed.getLineAndCharacterOfPosition(node.getStart(parsed)).line + 1,
          helper: node.expression.text,
          field,
          expected,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return findings;
}

export function scanRepo(root = REPO_ROOT) {
  const findings = [];
  for (const file of scanFiles(root)) {
    const rel = relative(root, file).split(sep).join("/");
    findings.push(...scanSource(rel, readFileSync(file, "utf8")));
  }
  return findings;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const findings = scanRepo();
  if (findings.length === 0) {
    console.log("check-ids: every id at a trust boundary is bounded.");
    process.exit(0);
  }
  console.error(`check-ids: ${findings.length} identifier(s) validated without a bound.\n`);
  for (const f of findings) {
    console.error(`  ${f.file}:${f.line}  ${f.helper}(…, "${f.field}") → use ${f.expected}`);
  }
  console.error(
    "\nNothing downstream bounds an id: stores write through prepared statements\n" +
      "and no migration CHECKs an id column past NOT NULL, so this call is the\n" +
      "only bound the value ever meets. The bounded helpers ask the same three\n" +
      "questions — non-empty, no outer whitespace, inside MAX_ID_LENGTH.",
  );
  process.exit(1);
}
