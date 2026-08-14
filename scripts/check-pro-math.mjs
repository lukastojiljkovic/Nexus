// No shebang, for the reason the other gates in this directory have none: this
// module is both a CLI (`node scripts/check-pro-math.mjs`) and an import target
// for its own tests.
//
// WHAT THIS GATE ENFORCES.
//
// Two independent verification rounds over the 274 professional tools produced
// sixty-three correctness findings. Thirty-six of them — more than half — were
// ONE shape: a divisor that reached the division without a guard. The symptom is
// always the same and always looks like something else. The tool accepts the
// input, divides, and the surface prints „∞ mm", which reads to everyone as a
// rendering bug rather than as arithmetic that should have refused to answer.
//
// The remaining large group was the mirror image, in the rounding: four toolkits
// had each hand-written their own `roundHalfUp` with an ABSOLUTE `+ 1e-9` before
// the round, which is two different bugs depending on the size of the number. On
// a total of nine hundred million, 1e-9 is far below one unit in the last place
// and does nothing at all. On a quantity of 5e-8 it is twenty times the value
// and rounds noise up to a whole unit. Nine more places had the same epsilon
// inline inside a `Math.ceil`.
//
// Both classes were fixed once, in `packages/core/src/pro/result.ts`: `quotient`
// refuses to be `Infinity`, `roundHalfUp` scales its nudge to the magnitude, and
// `floorSnapped` / `ceilSnapped` take the representation error out first. This
// gate exists so that the fix stays fixed — because every one of those copies
// was written by somebody who needed a rounding helper, could not see one, and
// wrote the obvious three lines. That will happen again on the day a nineteenth
// toolkit is added, and nothing about it will look wrong in review.
//
// Three rules, all of them deliberately narrow:
//
//   1. NO PRIVATE COPY OF A SHARED HELPER. A pack module may not declare a name
//      the kit already exports. This is the rule that actually prevents the
//      class, rather than detecting instances of it.
//
//   2. NO ABSOLUTE EPSILON INSIDE A ROUNDING CALL. An `1e-9` inside
//      `Math.floor` / `Math.ceil` / `Math.round` / `Math.trunc` is the hand-rolled
//      nudge; `floorSnapped` / `ceilSnapped` / `roundHalfUp` are the same idea
//      done once, relatively, with tests. Outside a rounding call the same
//      literal is something else entirely — a tolerance for comparing two
//      computed lengths, or the number of cubic metres in a cubic millimetre —
//      and the rule says nothing about either.
//
//   3. NO DIVISION BY AN UNGUARDED INPUT FIELD. `x / input.foo` inside a
//      function that never passes `foo` to a guard or to `quotient`.
//
// WHAT IS DELIBERATELY NOT A RULE. `Math.floor(a / b)` with no snap in front of
// it is a real defect — a product of two divisions lands one unit in the last
// place below a whole number often enough that „koliko punih komada staje" comes
// out one too few — but it was measured over this tree at a hundred and
// thirty-seven sites, nearly all of them integer calendar arithmetic where the
// operands are whole numbers and the concern cannot arise. A gate whose first
// run produces a hundred and thirty-seven findings is a gate somebody switches
// off, and a switched-off gate is worse than none because it reads as coverage.

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(HERE, "..");

const PRO_DIR = "packages/core/src/pro";

/**
 * The SURFACES, scanned for the same two style rules — and the reason they are
 * here is that the first thing this gate missed was a defect it was written to
 * catch.
 *
 * `amount-in-words` bridged a typed decimal into whole minor units with
 * `Math.abs(x*100 − Math.round(x*100)) > 1e-6`: an absolute epsilon inside a
 * rounding comparison, which is rule 2 exactly, sitting in a `.tsx` this gate
 * did not read. It refused about one legal two-decimal amount in eight above
 * 10^8, and no test caught it because a surface has none. Reach was the real
 * finding, not the literal.
 *
 * Rule 3 stays behind: `input.foo` is the core's parameter shape, and a surface
 * divides by React state whose guard is three lines of JSX away.
 */
const SURFACE_DIR = "apps/desktop/src/renderer/src/pro";

/** The kit itself. It is where these helpers are SUPPOSED to be declared. */
const KIT = "result.ts";

/**
 * Rule 1 — the names a pack module may not declare.
 *
 * `positive` and `nonNegative` are on the list although the kit exports neither:
 * they are the names three packs reached for when the kit's guards could not yet
 * narrow a `number | undefined`, and a name that was chosen once as the way
 * around a shared helper will be chosen again.
 */
export const KIT_NAMES = [
  "ratioAgainst",
  "isPositive",
  "isNonNegative",
  "isInRange",
  "isIntegerIn",
  "quotient",
  "snap",
  "floorSnapped",
  "ceilSnapped",
  "roundHalfUp",
  // Historic spellings of the same helpers, each one a copy that shipped.
  "round9",
  "roundTo",
  "positive",
  "nonNegative",
];

/** `function foo(`, `const foo = (`, `const foo = function`, `let foo = (`. */
const DECLARATION = (name) =>
  new RegExp(`^\\s*(?:export\\s+)?(?:function\\s+${name}\\s*\\(|(?:const|let)\\s+${name}\\s*(?::[^=]+)?=\\s*(?:function\\b|\\(|[A-Za-z0-9_$]+\\s*=>))`);

/** The rounding calls that a hand-rolled epsilon hides inside. */
const ROUNDERS = ["Math.floor", "Math.ceil", "Math.round", "Math.trunc"];

/**
 * An absolute epsilon, in the spellings that shipped.
 *
 * The range starts at `e-4` and not at `e-7`, because it started at `e-7` and
 * the defect that got through was spelled `1e-6`. There is no magnitude at
 * which a hand-written absolute tolerance beside a rounding call is the right
 * tool; the number chosen only decides how large the value has to be before it
 * misbehaves.
 */
const EPSILON = /\b\d(?:\.\d+)?e-(?:[4-9]|1[0-9]|2[0-9])\b|\bNumber\.EPSILON\b/;

/** A line that is only a comment says nothing about what the code does. */
const COMMENT = /^\s*(?:\/\/|\/\*|\*)/;

/** The guards that make a divisor safe, plus the quotient that needs none. */
const GUARDS = "isPositive|isNonNegative|isInRange|isIntegerIn|quotient|ratioAgainst";

/**
 * The argument list of every `Math.round(`-style call on a line, by balanced
 * parentheses rather than by regex.
 *
 * `Math.ceil(x / y - 1e-9)` and `Math.ceil((a + b) / c)` differ only in where the
 * parentheses close, and a non-greedy `\(([^)]*)\)` reads the first of those
 * correctly and the second not at all. Since the thing being detected lives
 * INSIDE the call, stopping at the wrong `)` is the difference between a rule
 * that fires and one that quietly never does.
 */
export function roundingArguments(line) {
  const out = [];
  for (const rounder of ROUNDERS) {
    let from = 0;
    for (;;) {
      const at = line.indexOf(`${rounder}(`, from);
      if (at < 0) break;
      let depth = 0;
      let end = -1;
      for (let i = at + rounder.length; i < line.length; i++) {
        if (line[i] === "(") depth++;
        else if (line[i] === ")") {
          depth--;
          if (depth === 0) {
            end = i;
            break;
          }
        }
      }
      // An unbalanced call is one wrapped across lines. Read to the end of the
      // line rather than skipping it: a nudge on the continuation is still a
      // nudge, and a rule that gives up on multi-line calls is a rule that
      // teaches people to wrap.
      out.push({ rounder, args: line.slice(at + rounder.length + 1, end < 0 ? line.length : end) });
      from = end < 0 ? line.length : end;
    }
  }
  return out;
}

/**
 * Every top-level function in a module, with its body and the line it opens on.
 *
 * Brace counting rather than a parser, for the same reason `check-risk` reads
 * registrations as text: a gate that has to build the package before it can run
 * is a gate that stops being run. Braces inside strings and comments would
 * defeat it, and the modules in this directory contain neither at top level.
 */
export function topLevelFunctions(text) {
  const lines = text.split("\n");
  const out = [];
  let start = -1;
  let depth = 0;
  let name = "";
  for (const [i, line] of lines.entries()) {
    if (start < 0) {
      const m = /^(?:export\s+)?function\s+([A-Za-z0-9_$]+)/.exec(line);
      if (m === null) continue;
      start = i;
      name = m[1];
      depth = 0;
    }
    for (const ch of line) {
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
    }
    if (depth === 0 && i > start) {
      out.push({ name, from: start + 1, lines: lines.slice(start, i + 1) });
      start = -1;
    }
  }
  return out;
}

/** Every toolkit's arithmetic module — the sources, not the tests, not the kit. */
export function proModules(repoRoot = REPO_ROOT) {
  try {
    return readdirSync(join(repoRoot, PRO_DIR))
      .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts") && name !== KIT)
      .sort();
  } catch {
    return [];
  }
}

export function auditFile(file, text) {
  const findings = [];
  const add = (rule, line, detail) => findings.push({ rule, file, line, detail });

  for (const [i, line] of text.split("\n").entries()) {
    // Rule 1 — a private copy of something the kit already owns.
    for (const name of KIT_NAMES) {
      if (DECLARATION(name).test(line)) {
        add(
          "private-kit-copy",
          i + 1,
          `declares its own \`${name}\` — import it from ./result.js instead, or extend the kit`,
        );
      }
    }

    // Rule 2 — a hand-rolled nudge beside a rounding call.
    //
    // BESIDE and not merely inside, which is the correction the surfaces
    // forced. The nudge has two spellings: `Math.ceil(x - 1e-9)` puts it in the
    // arguments, and `Math.abs(x - Math.round(x)) > 1e-6` puts it outside every
    // parenthesis while doing exactly the same job. Reading only the arguments
    // caught the first and was silent on the second, which is the one that
    // shipped. Co-occurrence on one line catches both and, measured over this
    // tree, matches nothing else.
    const calls = roundingArguments(line);
    if (calls.length > 0 && !COMMENT.test(line)) {
      const m = EPSILON.exec(line);
      if (m !== null) {
        const inArgs = calls.some((call) => EPSILON.test(call.args));
        add(
          "absolute-nudge",
          i + 1,
          `\`${calls[0].rounder}\` ${inArgs ? "with" : "on a line with"} \`${m[0]}\` — use ` +
            "floorSnapped / ceilSnapped / roundHalfUp / minorUnits, whose tolerance scales " +
            "with the magnitude",
        );
      }
    }
  }

  // Rule 3 — division by an input field this function never guarded.
  for (const fn of topLevelFunctions(text)) {
    const whole = fn.lines.join("\n");
    for (const [k, line] of fn.lines.entries()) {
      for (const m of line.matchAll(/\/\s*(?:input|in)\.([A-Za-z0-9_$]+)/g)) {
        const field = m[1];
        const guarded = new RegExp(`\\b(?:${GUARDS})\\s*\\([^)]*\\b${field}\\b`).test(whole);
        if (!guarded) {
          add(
            "unguarded-divisor",
            fn.from + k,
            `${fn.name}: divides by \`input.${field}\`, which it never guards — ` +
              "an empty field makes this Infinity and the surface prints „∞\"",
          );
        }
      }
    }
  }

  return findings;
}

/** Every toolkit's SURFACE — the renderer half, where the same nudge reappeared. */
export function proSurfaces(repoRoot = REPO_ROOT) {
  try {
    return readdirSync(join(repoRoot, SURFACE_DIR))
      .filter((name) => name.endsWith(".tsx") && name !== "shared.tsx")
      .sort();
  } catch {
    return [];
  }
}

export function auditAll(repoRoot = REPO_ROOT) {
  const modules = proModules(repoRoot);
  const surfaces = proSurfaces(repoRoot);
  const findings = [];
  for (const name of modules) {
    const file = `${PRO_DIR}/${name}`;
    findings.push(...auditFile(file, readFileSync(join(repoRoot, file), "utf8")));
  }
  // Rules 1 and 2 only: a surface has no `input.foo` to divide by, and rule 3
  // reads that shape. `auditFile` finds none there, so it is simply quiet.
  for (const name of surfaces) {
    const file = `${SURFACE_DIR}/${name}`;
    findings.push(...auditFile(file, readFileSync(join(repoRoot, file), "utf8")));
  }
  return { findings, moduleCount: modules.length, surfaceCount: surfaces.length };
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { findings, moduleCount, surfaceCount } = auditAll();
  if (findings.length === 0) {
    console.log(
      `check-pro-math: ${moduleCount} professional modules and ${surfaceCount} surfaces — no ` +
        "private copy of a shared helper, no absolute epsilon beside a rounding call, no " +
        "division by an unguarded input.",
    );
    process.exit(0);
  }
  console.error(`check-pro-math: ${findings.length} finding(s).\n`);
  for (const f of findings) console.error(`  ${f.file}:${f.line}  [${f.rule}]  ${f.detail}`);
  console.error(
    "\nAll three are the same defect at different scales: arithmetic that was\n" +
      "written a second time instead of being imported. `packages/core/src/pro/result.ts`\n" +
      "is where it lives, and it is tested there.",
  );
  process.exit(1);
}
