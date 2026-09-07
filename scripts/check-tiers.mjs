/**
 * check:tiers — a typographic tier is declared once and adopted, never retyped.
 *
 * `packages/ui/src/styles.css` owns the app's shared tiers. `.nx-hint` is the
 * explanation tier: muted ink, 13px, the app's base leading, and a prose
 * measure. Before it existed the same five declarations had been written out by
 * hand in thirty-three classes across fifteen stylesheets, and the drift DC-02
 * predicts had already happened four ways — four leadings for one tier, three
 * measures including a raw `64ch` where a token exists, and forty-eight
 * paragraphs whose class never reset the UA's `<p>` margin at all.
 *
 * WHAT MAKES THIS GATEABLE, when the eyebrow tier's equivalent was not.
 *
 * The ink and the size alone do not identify a hint. `.tasks__archive-toggle`
 * is a BUTTON that borrows both on purpose — the quiet typographic disclosure
 * idiom, shared with `.set__disclosure` — and a rule that fired on it would
 * have an allowlist within a month, which is the shape that stops being read.
 * A `<span>` that carries a timestamp beside a title borrows them too, and an
 * inline box takes neither a margin nor a measure, so folding it would be
 * wrong.
 *
 * The discriminator is not in the stylesheet. It is the ELEMENT: a class whose
 * every call site is a `<p>` is a paragraph tier, whatever it is called. So the
 * gate reads both sides — the declaration in CSS and the tags in TSX — and
 * fires only where they agree. That is exactly the evidence the fold was made
 * on, and it has no allowlist at all.
 *
 * One further exclusion, and it is a rule rather than a name: a block that sets
 * its own `font-family` has declared itself a different tier out loud, so it is
 * not this one. `.elec-sim__readout` is the case — a `<p>`, muted, 13px, and
 * mono with tabular figures, because it is the simulator's tick counter and not
 * a sentence. Folding it would have meant re-overriding the family and the
 * measure straight back, which is the shape a fold is supposed to remove. None
 * of the twenty-nine rules the fold did absorb declared a family.
 *
 * It does NOT cover:
 *   - `packages/ui/src/styles.css` itself, which is where the tier is declared.
 *   - the eyebrow tier. Sixty-five rules still hand-write uppercase + label
 *     tracking, seventeen of them with `--nx-text-muted` where `.nx-eyebrow`
 *     says `--nx-text-subtle` — the ink its own comment names as the wrong one.
 *     That adoption is unfinished (`docs/STATUS.md`), and a rule that reported
 *     sixty-five findings on the day it landed would be turned off on the same
 *     day. It becomes enforceable when the adoption is done, not before.
 *   - explanation prose set at 11px. Nineteen rules do it; the settings page's
 *     own note says why it is wrong („prose set in it is not READ — it is
 *     skipped"), but telling an explanation from a figure caption means reading
 *     the Serbian sentence, and that is a judgement, not a rule.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

// Where a JSX opening tag ends, which is not where a regex thinks it does:
// a handler's `=>` is a `>` inside a brace, and a class written after one
// would otherwise be invisible here — a gate reporting nothing, which looks
// exactly like a gate finding nothing.
import { jsxElements } from "./jsx-elements.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The tier this gate enforces: the declarations that ARE `.nx-hint`.
 *
 * Written without spaces because they are matched against a squeezed
 * declaration, per declaration and from its start — never as a substring of the
 * whole block. `border-color: var(--nx-text-muted)` contains the ink test
 * exactly, and a card with a muted hairline and 13px text is not a paragraph
 * tier.
 */
const HINT_INK = "color:var(--nx-text-muted)";
const HINT_SIZE = "font-size:var(--nx-font-size-body-sm)";
const OWN_FACE = "font-family:";
const SHARED = "nx-hint";

/** An intrinsic tag. A capital initial is a component, whose tag we cannot see. */
const TAG = /[a-z][a-zA-Z0-9]*/;

/** Build output and installed packages: a copy of the tree, not the tree. */
const SKIP = new Set(["node_modules", "out", "dist", "release"]);

/** Every file under `dir` whose name ends in one of `endings`. */
export function walk(dir, endings, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (SKIP.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, endings, out);
    else if (endings.some((e) => name.endsWith(e))) out.push(full);
  }
  return out;
}

/** Comment bodies blanked, line count preserved, so a finding's line is real. */
function blankComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
}

/**
 * A block's declarations, each squeezed, so `color: var(--x)` and
 * `color:var(--x)` are one declaration and `border-color:` is not `color:`.
 */
function declarations(body) {
  return body.split(";").map((d) => d.replace(/\s+/g, ""));
}

/**
 * Classes whose rule declares the hint tier's ink AND size.
 *
 * A selector list contributes every class it names: `.a, .b { … }` is two
 * copies of one block, which is the case that produced three of the folded
 * rules.
 */
export function classesDeclaringTheTier(css) {
  const found = new Map();
  const source = blankComments(css);
  const rule = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = rule.exec(source)) !== null) {
    const [, selector, body] = m;
    const declared = declarations(body);
    const has = (prefix) => declared.some((d) => d.startsWith(prefix));
    if (!has(HINT_INK) || !has(HINT_SIZE) || has(OWN_FACE)) continue;
    // `[^{}]+` swallows every blank line and blanked comment back to the
    // previous `}`, so `m.index` is not the selector — it is wherever the last
    // rule ended. Skip that leading whitespace before counting, or a finding
    // points at the top of the comment above the rule, or at the top of the
    // file.
    const at = m.index + (selector.length - selector.trimStart().length);
    const line = source.slice(0, at).split("\n").length;
    for (const cls of selector.matchAll(/\.([A-Za-z][A-Za-z0-9_-]*)/g)) {
      if (!found.has(cls[1])) found.set(cls[1], line);
    }
  }
  return found;
}

/**
 * Every `<tag className="…">` in the source, as tag → set of classes.
 *
 * Deliberately literal-only. A computed className cannot be attributed to a
 * tag by reading, and a gate that guessed at one would be reporting on its own
 * guess; every class this rule is about is written as a plain literal, and one
 * that stops being written that way stops being visible here — which is a gap
 * worth stating rather than a check worth faking.
 */
export function elementsByClass(tsx) {
  const byClass = new Map();
  for (const { name, text } of jsxElements(tsx, TAG)) {
    const attribute = /className="([^"]*)"/.exec(text);
    if (attribute === null) continue;
    for (const cls of attribute[1].trim().split(/\s+/)) {
      if (cls === "") continue;
      if (!byClass.has(cls)) byClass.set(cls, new Set());
      byClass.get(cls).add(name);
    }
  }
  return byClass;
}

/** Every class in the live tree that re-declares the tier on a paragraph. */
export function scanRepo() {
  const tags = new Map();
  const carriesShared = new Set();
  for (const file of walk(join(root, "apps"), [".tsx"])) {
    const source = readFileSync(file, "utf8");
    for (const [cls, found] of elementsByClass(source)) {
      if (!tags.has(cls)) tags.set(cls, new Set());
      for (const tag of found) tags.get(cls).add(tag);
    }
    // Deliberately every attribute, not only the ones on an intrinsic tag: a
    // component that forwards `nx-hint` alongside its own class has adopted the
    // tier just as much as a `<p>` that carries both.
    for (const m of source.matchAll(/className="([^"]*)"/g)) {
      const classes = m[1].trim().split(/\s+/);
      if (classes.includes(SHARED)) for (const c of classes) carriesShared.add(c);
    }
  }

  const findings = [];
  for (const file of walk(join(root, "apps"), [".css"])) {
    for (const [cls, line] of classesDeclaringTheTier(readFileSync(file, "utf8"))) {
      const on = tags.get(cls);
      // Only paragraphs, and at least one of them: a class we cannot see in the
      // markup is not evidence of anything.
      if (on === undefined || on.size !== 1 || !on.has("p")) continue;
      if (carriesShared.has(cls)) continue;
      findings.push({ file: relative(root, file).split("\\").join("/"), line, cls });
    }
  }
  return findings;
}

function main() {
  const findings = scanRepo();
  if (findings.length > 0) {
    console.error(
      `check-tiers: ${findings.length} class(es) re-declare .nx-hint on an element\n` +
        "that is only ever a <p>. The explanation tier is declared once, in\n" +
        "packages/ui/src/styles.css, and adopted by putting `nx-hint` on the\n" +
        "element — a surface that needs a variant adds a modifier beside it.\n",
    );
    for (const f of findings) console.error(`  ${f.file}:${f.line}: .${f.cls}`);
    process.exit(1);
  }
  console.log("check-tiers: the explanation tier is declared once and adopted.");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
