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
 * The ink and the size alone do not identify a hint. `.nx-disclosure` is a
 * BUTTON that borrows both on purpose — the quiet typographic disclosure idiom
 * — and a rule that fired on it would have an allowlist within a month, which
 * is the shape that stops being read.
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
 * HOW THE SENTENCE IS TESTED, which is not the same question as whether its
 * words are right. The two halves above were unit-tested in both directions from
 * the start — `classesDeclaringTheTier` finds a rule, `elementsByClass`
 * attributes a class to a `<p>` — and the sentence they compose had exactly one
 * test: `scanRepo()` on the real tree, asserted to be `[]`. That `[]` is the
 * answer this tree gives AND the answer a join that returns nothing gives, and
 * no assertion could tell the two apart: a refactor that made the composition
 * unconditionally silent would have kept this repository entirely green.
 *
 * An INVERTED predicate was never the risk here, and why is the useful half: it
 * would fire on every class the tier is legitimately re-declared for — the
 * timestamps, the counts, the result labels — and the assertion would have gone
 * red on the day it landed. Silence is the failure this gate cannot see from the
 * inside. So `scanRepo(root)` now takes the root it reads, a fixture tree in a
 * temporary directory can drive the composition, and the census below is
 * exported beside the verdict.
 *
 * THE CENSUS IS NOT A COUNT, and that is deliberate. This gate walks the tree
 * for two facts — which classes re-declare the tier, and which tags wear them —
 * and a count of either is INVARIANT under the failure that matters: break the
 * TSX walk and every CSS declaration is still found, every tag empties, every
 * row still exists, and „fifty-six declarations of the tier, none on a
 * paragraph" reads exactly as it does when the walk worked. So a row carries the
 * fields the verdict is computed FROM — the tags the class was seen on, and
 * whether it is written beside `nx-hint` — and a test can ask whether the walk
 * looked at the classes this rule exists to judge, and not only whether it was
 * quiet.
 *
 * TWO CLAUSES THIS TREE HAS NEVER EXERCISED, said plainly so that a green run is
 * not read as proof of them. Not one class declaring the tier here is written
 * beside `nx-hint`, so the adoption exclusion has never cleared anything; and not
 * one is worn by a `<p>` at all — the tier is re-declared for timestamps, counts
 * and result labels, and a `<span>` claims it legitimately, since an inline box
 * takes no margin and no measure — so the finding itself has never been produced
 * by this repository. Sixteen of those fifty-six rows are on a class that no
 * call site in `apps/` names at all, and they are rows and not omissions on
 * purpose: „seen on no tag" is a measurement, and a census that dropped them
 * could not tell that answer from a walk that never opened the file. Both
 * clauses are exercised by the fixture cases beside this file, and only there.
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

/**
 * The repository this gate lives in, and the default both the census and the
 * verdict read: `scanRepo()` with no argument has to mean the real tree, or a
 * CI run would be judging whatever fixture was passed last.
 */
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

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

/**
 * The census: one row per declaration of the tier in the tree, each carrying the
 * two facts the verdict is computed from.
 *
 * The unit is the DECLARATION and not the class, because that is the unit the
 * verdict reports and the unit a reader has to open: a class declared in two
 * stylesheets is two rules, and a finding has always been a `file:line`.
 *
 * `tags` is the sorted names of the tags the class was attributed to by
 * `elementsByClass` — names and not call sites, because a name is the
 * granularity the rule itself works at („exactly one tag, and it is a `<p>`"),
 * and a census at a finer grain would be evidence about something the verdict
 * does not consult. `[]` means the walk read every `.tsx` under `apps/` and the
 * class is written nowhere under that name.
 *
 * `shared` is the other exclusion: `nx-hint` written beside the class in one
 * className, which is how the app adopts the tier. It is `false` in every row of
 * the real tree today, so this field is NOT evidence that the exclusion works —
 * a `carriesShared` that returned nothing would fill the column identically. It
 * is here because a census is the verdict's INPUTS itemised, and an input left
 * out is a clause nobody can ask a question about later; the exclusion itself is
 * pinned by a fixture case beside this file.
 */
export function repoTierDeclarations(root = repoRoot) {
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

  const declarations = [];
  for (const file of walk(join(root, "apps"), [".css"])) {
    for (const [cls, line] of classesDeclaringTheTier(readFileSync(file, "utf8"))) {
      const on = tags.get(cls);
      declarations.push({
        file: relative(root, file).split("\\").join("/"),
        line,
        cls,
        tags: on === undefined ? [] : [...on].sort(),
        shared: carriesShared.has(cls),
      });
    }
  }
  // `readdirSync` order is the filesystem's, not ours, and this is an artifact a
  // reader and a test both compare. A tie on (file, line) is a selector list,
  // and `sort` is stable, so those keep the order the stylesheet wrote them in.
  return declarations.sort(
    (a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line),
  );
}

/**
 * The verdict over a census, on its own so a fixture can ask it a question
 * without a repository.
 *
 * A declaration is a finding when the class it declares is worn by exactly ONE
 * tag and that tag is a `<p>`. Both halves are load-bearing and neither is
 * enough: ink and size alone describe `.nx-disclosure`, which is a BUTTON, and a
 * `<span>` claims the tier legitimately because an inline box takes neither a
 * margin nor a measure. A class seen on no tag is not a finding either — a class
 * we cannot see in the markup is not evidence of anything.
 */
export function findings(declarations) {
  return declarations.filter((d) => d.tags.length === 1 && d.tags[0] === "p" && !d.shared);
}

/** Every declaration of the tier in `root` — the real tree unless given one. */
export function scanRepo(root = repoRoot) {
  return findings(repoTierDeclarations(root));
}

function main() {
  const census = repoTierDeclarations();
  const reports = findings(census);
  if (reports.length > 0) {
    console.error(
      `check-tiers: ${reports.length} class(es) re-declare .nx-hint on an element\n` +
        "that is only ever a <p>. The explanation tier is declared once, in\n" +
        "packages/ui/src/styles.css, and adopted by putting `nx-hint` on the\n" +
        "element — a surface that needs a variant adds a modifier beside it.\n",
    );
    for (const f of reports) console.error(`  ${f.file}:${f.line}: .${f.cls}`);
    process.exit(1);
  }
  // The count is on the line, so that a run which read nothing says so instead
  // of printing the sentence a run which found nothing prints.
  console.log(
    `check-tiers: the explanation tier is declared once and adopted ` +
      `(${census.length} declaration(s) of it read).`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
