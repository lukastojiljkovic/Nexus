// No shebang, for the reason the other gates in this directory have none: this
// module is both a CLI (`node scripts/check-pro-flags.mjs`) and an import target
// for its own tests.
//
// WHAT THIS GATE ENFORCES.
//
// A professional tool sometimes has to say something ABOUT its own answer that
// the numbers cannot say for themselves. „These are the exclusive method's
// quartiles, but n = 3, so do not read them as a spread." „This zero is the
// target already being met, not a calculation that collapsed." „This amount is
// negative, and the two figures beside the words are magnitudes." Each of those
// was written into the core as a boolean, tested there, and then never named by
// the screen — so the misreading the flag exists to prevent is exactly what the
// user got.
//
// That is DC-48, and it is invisible to every other check in this repo. The
// type system cannot see it: reading three fields of a result and not the
// fourth is a well-typed program. The linter cannot see it: an unused object
// PROPERTY is not an unused variable. The tests cannot see it: the core's own
// tests assert the flag is computed correctly, which it always was. And a
// review cannot see it, because the defect is a line that is not there.
//
// THE RULE, and it is one rule.
//
//   Every boolean field on an EXPORTED result interface in `packages/core/src/
//   pro/<pack>.ts` must be named somewhere in `apps/.../pro/<pack>.tsx`.
//
// „Named" is deliberately weak — the identifier appearing anywhere in the
// surface passes. A gate that tried to check the flag is rendered CORRECTLY
// would be a type checker, and would be wrong often enough to be switched off.
// This one asks the only question that can be asked mechanically and that
// catches every instance found so far: did the person writing the screen ever
// see this field at all.
//
// WHY THERE IS NO ALLOWLIST. The first run of this rule produced six findings.
// Three were real (the three quoted above). The other three were booleans that
// restated something the surface already derived — `farIsInfinite` beside a
// `farLimit` that is undefined in exactly that case, `usedMeasured` as the OR
// of two flags the screen does read, and a `music` boolean beside an optional
// spelling, which between them spelled four states for three outcomes. Every
// one of those was worth deleting on its own terms, and they were, so the rule
// holds at zero exceptions. An allowlist would have kept all three, and the
// next reader would have taken „it is on the list" for „somebody decided".
//
// SCOPE. Booleans only, and only on exported interfaces whose name does not end
// in `Input` or `Options` — a caller's own parameter is not a claim the tool
// makes. Unexported interfaces are the module's internal lookup tables; their
// booleans are working, not output. Both exclusions were learned by running the
// check without them and reading what came back.
//
// This gate says nothing about non-boolean fields. A widened census over every
// result field returns about a hundred and forty candidates, nearly all of them
// intermediate figures that are correctly internal, and a rule with that ratio
// is not a rule. The boolean restriction is what makes the signal clean: a
// boolean on a result is almost always a caveat, and a caveat nobody prints is
// almost always a defect.

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(HERE, "..");

const PRO_DIR = "packages/core/src/pro";
const SURFACE_DIR = "apps/desktop/src/renderer/src/pro";

/** `readonly foo: boolean;` or `readonly foo?: boolean | undefined;`. */
const BOOLEAN_FIELD = /^\s*readonly\s+([A-Za-z0-9_]+)\s*\??\s*:\s*boolean(\s*\|\s*undefined)?\s*;/;

/** Exported or not — the walk back needs both, so it can tell them apart. */
const INTERFACE_DECL = /^\s*(export\s+)?interface\s+(\w+)/;

/**
 * A caller's parameter object, not an answer. `Input` is the convention across
 * all eighteen packs; `Options` appears on the two that take a formatting bag.
 */
function isParameterShape(owner) {
  return owner.endsWith("Input") || owner.endsWith("Options");
}

/**
 * Every boolean a pack's exported result types declare, with where it sits.
 *
 * Textual on purpose. The question is „does this name appear", and a name that
 * appears nowhere cannot be read by any narrowing a compiler would see — so a
 * parse buys nothing here that the regex does not already have.
 */
export function resultBooleans(source) {
  const lines = source.split(/\r?\n/);
  const found = [];
  for (let i = 0; i < lines.length; i += 1) {
    const field = BOOLEAN_FIELD.exec(lines[i] ?? "");
    if (field === null) continue;
    let owner = "";
    let exported = false;
    for (let j = i; j >= 0; j -= 1) {
      const decl = INTERFACE_DECL.exec(lines[j] ?? "");
      if (decl !== null) {
        owner = decl[2] ?? "";
        exported = decl[1] !== undefined;
        break;
      }
    }
    if (!exported || isParameterShape(owner)) continue;
    found.push({ owner, name: field[1] ?? "", line: i + 1 });
  }
  return found;
}

/** True when `name` appears as a whole word anywhere in the surface. */
export function surfaceNames(surface, name) {
  return new RegExp(`\\b${name}\\b`).test(surface);
}

export function auditAll(repoRoot = REPO_ROOT) {
  const modules = readdirSync(join(repoRoot, PRO_DIR))
    .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))
    .sort();
  const surfaces = new Set(readdirSync(join(repoRoot, SURFACE_DIR)));

  const findings = [];
  let packCount = 0;
  let flagCount = 0;
  for (const module of modules) {
    const pack = module.slice(0, -3);
    // `result.ts` and the other shared kit files have no surface of their own,
    // and a helper's boolean is not a claim any screen owes a reader.
    if (!surfaces.has(`${pack}.tsx`)) continue;
    packCount += 1;
    const source = readFileSync(join(repoRoot, PRO_DIR, module), "utf8");
    const surface = readFileSync(join(repoRoot, SURFACE_DIR, `${pack}.tsx`), "utf8");
    for (const flag of resultBooleans(source)) {
      flagCount += 1;
      if (surfaceNames(surface, flag.name)) continue;
      findings.push({
        file: `${PRO_DIR}/${module}`,
        line: flag.line,
        detail: `\`${flag.owner}.${flag.name}\` is never named in ${pack}.tsx`,
      });
    }
  }
  return { findings, packCount, flagCount };
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { findings, packCount, flagCount } = auditAll();
  if (findings.length === 0) {
    console.log(
      `check-pro-flags: ${flagCount} result flags across ${packCount} professional packs — ` +
        "every one of them named by its surface.",
    );
    process.exit(0);
  }
  console.error(`check-pro-flags: ${findings.length} finding(s).\n`);
  for (const f of findings) console.error(`  ${f.file}:${f.line}  ${f.detail}`);
  console.error(
    "\nA boolean on a result is a caveat the tool attaches to its own answer.\n" +
      "One the screen never names is a caveat the user never reads, so the\n" +
      "misreading it exists to prevent is what ships. Either render it, or —\n" +
      "if it only restates something the surface already derives from an\n" +
      "absent field — delete it, because a redundant flag reads as information.",
  );
  process.exit(1);
}
