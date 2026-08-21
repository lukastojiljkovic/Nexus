// No shebang, for the reason the other gates in this directory have none: this
// module is both a CLI (`node scripts/check-elec.mjs`) and an import target for
// its own tests.
//
// WHY THIS GATE EXISTS.
//
// `CLAUDE.md` bans blue and orange as system hues. [DEV-006] carves exactly one
// hole in that ban: inside the Elektronika workbench a wire's colour is DATA —
// red is 5 V, black is ground, blue is very often I²C SDA — and remapping those
// onto the eight-accent palette would produce a wiring diagram that is wrong in
// the one way a wiring diagram must never be. So `packages/tokens` grew a
// `--nx-elec-*` group, and the deviation says, in as many words: „the exemption
// reaches the canvas surface and the component legend, and nothing else."
//
// That sentence is a rule over a REACHABILITY SET, which is the shape [DC-61]
// was written about: a rule stated over „inside the canvas" permits everything
// outside it, and the violation is planted long before anybody notices. Nothing
// in CSS distinguishes `var(--nx-elec-wire-blue)` on a bench from the same
// token on a button — both resolve, both are „tokens only", and `check:colours`
// (which refuses raw hex) is satisfied by both. A developer who wants a blue and
// finds one already in the palette has no reason to think twice.
//
// So the deviation's scope is enforced here rather than remembered: a
// `--nx-elec-*` token may be read only from the workbench's own stylesheet.
// Everywhere else it is a finding, and adding a file to `ALLOWED` is a decision
// somebody has to write down next to the founder's.
//
// COMMENTS ARE STRIPPED BEFORE MATCHING. Six files in this repository explain,
// in prose, that a wire's colour is stored as a NAME and painted through a
// `--nx-elec-wire-*` token — the migration, the domain model, the archive
// reader, the IPC contract and two test files. Every one of them is the rule
// being described rather than broken, and a gate that fires on its own
// documentation teaches people to stop writing it. `check:egress` learned this
// the same way.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// The same lexer `check:egress` uses. A second copy was written here first and
// was blind to a URL; see the module for why there is now one of it.
import { stripComments } from "./strip-comments.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(HERE, "..");

const SCAN_ROOTS = ["apps/desktop/src", "apps/web/src", "packages"];
const IGNORED_DIRS = new Set(["node_modules", "dist", "out", ".turbo", "shots", "coverage"]);
const SCANNED_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".css"]);

/**
 * A workbench token being USED, rather than the characters that spell one.
 *
 * Two shapes, because there are two: `var(--nx-elec-wire-blue)` reads the token
 * and `--nx-elec-wire-blue:` declares one, and a redefinition outside
 * `packages/tokens` is the same escape as a read.
 *
 * The first version matched the bare name and had to be narrowed, which is the
 * more interesting half. Running it turned up one finding — `-- --nx-elec-wire-*
 * token instead of painting a stored value`, a line of PROSE inside migration
 * 067's SQL. `stripComments` had blanked it in neither pass, because a SQL
 * comment opens with `--` and blanking every `--` to end of line would blank
 * every custom-property declaration in every stylesheet: the construct this gate
 * exists to find and the construct that hides it are spelled the same way.
 *
 * So the match is narrowed instead of the stripper widened. That is the better
 * fix regardless of SQL: a gate that looks for a token REFERENCE cannot be set
 * off by a sentence about tokens, in any comment syntax, in any language this
 * repository grows later.
 */
const ELEC_TOKEN = /var\(\s*(--nx-elec-[a-z0-9-]+)|(--nx-elec-[a-z0-9-]+)\s*:/g;

/**
 * The workbench's own stylesheet, and nothing else.
 *
 * One entry rather than a directory, deliberately. „Anything under
 * `styles/elec*`" would be the same rule stated over a set again, and the next
 * file to match it would be admitted by a pattern instead of by a decision.
 */
export const ALLOWED = new Set(["apps/desktop/src/renderer/src/styles/electronics.css"]);

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (SCANNED_EXTENSIONS.has(extname(full))) yield full;
  }
}

export function scanSource(relPath, source) {
  if (ALLOWED.has(relPath.split(sep).join("/"))) return [];
  const findings = [];
  stripComments(source)
    .split("\n")
    .forEach((line, index) => {
      for (const match of line.matchAll(ELEC_TOKEN)) {
        // One alternative or the other matched — a read or a declaration.
        const token = match[1] ?? match[2];
        findings.push({ file: relPath, line: index + 1, token, text: line.trim() });
      }
    });
  return findings;
}

export function scanRepo(root = REPO_ROOT) {
  const findings = [];
  for (const scanRoot of SCAN_ROOTS) {
    for (const file of walk(join(root, scanRoot))) {
      const rel = relative(root, file).split(sep).join("/");
      findings.push(...scanSource(rel, readFileSync(file, "utf8")));
    }
  }
  return findings;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const findings = scanRepo();
  if (findings.length > 0) {
    console.error(
      `ELEC palette audit FAILED — ${findings.length} use(s) of a workbench colour outside the workbench:\n`,
    );
    for (const f of findings) {
      console.error(`  ${f.file}:${f.line}  ${f.token}\n    ${f.text}`);
    }
    console.error(
      "\nThe --nx-elec-* group exists under DEV-006, which exempts the Elektronika\n" +
        "canvas and its legend from the ban on blue and orange — and nothing else.\n" +
        "A blue needed anywhere else is a blue the design rules refuse; use the\n" +
        "theme's own tokens. If a second workbench surface genuinely needs them,\n" +
        "add its path to ALLOWED in scripts/check-elec.mjs and widen DEV-006's\n" +
        "scope in docs/deviations.md in the same change.",
    );
    process.exit(1);
  }
  console.log("ELEC palette audit OK");
}
