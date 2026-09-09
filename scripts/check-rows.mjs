/**
 * check:rows — a field row aligns its CONTROLS, because it cannot align its boxes.
 *
 * WHY THIS GATE EXISTS.
 *
 * `TextField` and `Select` draw a label above their control, so a field is two
 * boxes tall. A bare `<input>`, a `<Button>`, a `<Checkbox>` and a `Select` in
 * its `inline` layout are one box tall. Put both kinds in one flex row and the
 * row has children of two heights, and then `align-items` is not a cosmetic
 * choice — it decides whether the things a user actually clicks sit on one line
 * or on two.
 *
 * `center` centres the BOXES, which puts every control on its own baseline: the
 * taller child's control sinks below the shorter one's by half the label. That
 * is the defect, and it is invisible until somebody gives a field a label. Four
 * rows shipped that way — CAL's event form, DOKUMENTI's, and UČENJE's exam and
 * plan forms — and all four became visibly ragged the day [[DC-120]]'s labels
 * arrived, because the labels are what made the heights differ.
 *
 * `end` is the answer, and it is the only one: it aligns the bottoms, so the
 * controls share a line and the labels float above the children that have them.
 * `baseline` sounds right and is not — it would level a LABEL with the bare
 * input's text. `start` is right only when every child is the same shape, which
 * is precisely the case this gate does not fire on.
 *
 * WHAT IT READS, and why it has to read both sides. The stylesheet cannot tell
 * you what is in the row: `align-items: center` is correct in most of the app,
 * on toolbars, chip rows and segmented groups, and there are fifty-odd of them.
 * The markup cannot tell you how the row is laid out. So the rule fires only
 * where a container's DIRECT children mix the two shapes AND its class declares
 * a flex row — which needs no exemption list, because it is a statement about
 * what the row contains rather than about what it is called.
 *
 * FRAGMENTS ARE TRANSPARENT ON PURPOSE. `<>…</>` renders nothing, so its
 * children are the enclosing row's flex items; the walk below ignores fragments
 * and therefore gets that right. CAL's form is the case — its two `type="time"`
 * fields live inside `{!allDay && (<>…</>)}` and are laid out by `.cal__form`.
 *
 * WHAT IT CANNOT SEE, stated so nobody mistakes green for proof:
 *   - A child that is somebody else's COMPONENT. `<RecurrencePicker/>` renders
 *     a label over a select and is a stacked field in every way that matters,
 *     but its shape is not readable from the call site, and a gate that guessed
 *     would be reporting on its guess. Only `TextField` and `Select` — the two
 *     primitives whose arrangement is a prop — are recognised.
 *   - A row whose layout is declared through a combinator (`.a > .b { … }`).
 *     Only a rule whose selector is a plain class list is read, because that is
 *     the only shape in which a class states its OWN layout; anything more
 *     specific is a modifier of somebody else's. Every container this rule is
 *     about is written the plain way, and one that stops being is a gap worth
 *     naming rather than a check worth faking.
 *   - A computed `className`. Same reason `check:tiers` says so.
 *
 * THE TRAP, recorded because it cost a measurement. `/\blabel=/` also matches
 * `aria-label=` — `\b` sits happily between `-` and `l` — so a first pass at
 * this rule counted every invisibly-named field as a labelled one and produced
 * five findings that were not. A field is stacked when it has a label of its
 * own; an `aria-label` is the opposite of one, and telling them apart is the
 * whole subject.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { jsxElements } from "./jsx-elements.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Build output and installed packages: a copy of the tree, not the tree. */
const SKIP = new Set(["node_modules", "out", "dist", "release"]);

/**
 * The alignments that put the controls on one line — BOTH spellings.
 *
 * `flex-end` and `end` compute to the same thing in a flex container, so a rule
 * that took only one of them would be a preference wearing a defect's clothes,
 * and eleven correct rows would have been edited to satisfy it. Eleven rows
 * say `flex-end` and four say `end`; the split is worth a tidy-up one day —
 * `end` is the Box Alignment keyword that keeps meaning the same thing if the
 * container later becomes a grid, as `.tasks__fields` did — but a tidy-up is
 * not what this gate is for, and it says so rather than quietly enforcing it.
 */
export const ALIGNED = new Set(["end", "flex-end"]);

/** Any JSX tag: intrinsic or component. Both can carry the row's className. */
const TAG = /[A-Za-z][A-Za-z0-9.]*/;

/** A label of the element's own — never `aria-label`, which is the absence of one. */
const OWN_LABEL = /(?<![-\w])label=/;
const INLINE = /(?<![-\w])layout=\{?["']inline["']/;

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
export function blankComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, lead) => lead + " ".repeat(m.length - lead.length));
}

/** Two boxes tall: it draws a label of its own, above its control. */
export function isStacked({ name, text }) {
  if (name !== "TextField" && name !== "Select") return false;
  if (INLINE.test(text)) return false;
  // `Select` always renders a name; `TextField`'s is still optional (DC-120).
  return name === "Select" ? !/aria-labelledby=/.test(text) : OWN_LABEL.test(text);
}

/** One box tall: a control or a button with nothing drawn above it. */
export function isBare({ name, text }) {
  if (name === "input" || name === "textarea" || name === "Button") return true;
  if (name === "Checkbox") return true;
  if (name === "TextField") return INLINE.test(text) || !OWN_LABEL.test(text);
  if (name === "Select") return INLINE.test(text) || /aria-labelledby=/.test(text);
  return false;
}

/**
 * Every element in `tsx`, each with the elements that are its DIRECT children.
 *
 * A stack over the opening and closing tags in document order. An element is
 * self-closing when its opening tag ends `/>`, which `jsxElements` makes
 * knowable by ending that tag at the right `>`. Fragments match neither the
 * opening pattern nor the closing one and are therefore skipped — see the
 * header: that is the correct reading, not an oversight.
 */
export function elementsWithChildren(tsx) {
  const source = blankComments(tsx);
  const tags = [...jsxElements(source, TAG)].map((t) => ({ ...t, children: [] }));
  const events = [
    ...tags.map((t) => ({ at: t.start, open: t })),
    ...[...source.matchAll(/<\/([A-Za-z][A-Za-z0-9.]*)\s*>/g)].map((m) => ({
      at: m.index,
      close: m[1],
    })),
  ].sort((a, b) => a.at - b.at);

  const stack = [];
  for (const event of events) {
    if (event.open !== undefined) {
      if (stack.length > 0) stack[stack.length - 1].children.push(event.open);
      if (!event.open.text.trimEnd().endsWith("/>")) stack.push(event.open);
      continue;
    }
    for (let i = stack.length - 1; i >= 0; i -= 1) {
      if (stack[i].name === event.close) {
        stack.length = i;
        break;
      }
    }
  }
  return tags;
}

/** The classes on every element whose direct children mix the two shapes. */
export function mixedRowClasses(tsx) {
  const found = new Map();
  for (const element of elementsWithChildren(tsx)) {
    if (!element.children.some(isStacked)) continue;
    if (!element.children.some(isBare)) continue;
    const attribute = /className="([^"]*)"/.exec(element.text);
    if (attribute === null) continue;
    const line = tsx.slice(0, element.start).split("\n").length;
    for (const cls of attribute[1].trim().split(/\s+/)) {
      if (cls !== "" && !found.has(cls)) found.set(cls, line);
    }
  }
  return found;
}

/**
 * What each class declares about its own layout.
 *
 * Only rules whose selector is a plain class list, for the header's reason: a
 * class states its own layout there and nowhere else.
 */
export function layoutByClass(css) {
  const layout = new Map();
  const source = blankComments(css);
  const rule = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = rule.exec(source)) !== null) {
    const [, selector, body] = m;
    const trimmed = selector.trim();
    if (!/^\.[A-Za-z][\w-]*(\s*,\s*\.[A-Za-z][\w-]*)*$/.test(trimmed)) continue;
    const declared = body.split(";").map((d) => d.replace(/\s+/g, ""));
    const value = (prefix) =>
      declared.find((d) => d.startsWith(prefix))?.slice(prefix.length) ?? null;
    const at = m.index + (selector.length - selector.trimStart().length);
    const line = source.slice(0, at).split("\n").length;
    for (const cls of trimmed.split(",")) {
      layout.set(cls.trim().slice(1), {
        line,
        display: value("display:"),
        direction: value("flex-direction:"),
        align: value("align-items:"),
      });
    }
  }
  return layout;
}

/** A flex ROW: the cross axis is vertical, so `align-items` decides heights. */
export function isFlexRow(declared) {
  if (declared === undefined) return false;
  if (declared.display !== "flex" && declared.display !== "inline-flex") return false;
  return declared.direction !== "column" && declared.direction !== "column-reverse";
}

/**
 * The verdict on one class, given what its rule declares — the whole decision,
 * in one place, so it can be asked a question without a repository around it.
 *
 * `null` means „nothing to say": either the class does not lay out a flex row,
 * or it already aligns the controls. A missing `align-items` IS a finding —
 * the default is `stretch`, which makes the bare child as tall as the labelled
 * one, and a stretched `<input>` is a taller box than any other on the row.
 */
export function verdict(declared) {
  if (!isFlexRow(declared)) return null;
  if (declared.align !== null && ALIGNED.has(declared.align)) return null;
  return { line: declared.line, align: declared.align ?? "not declared (so: stretch)" };
}

/**
 * Every mixed row in the tree, by class — the CENSUS, separate from the verdict.
 *
 * Exported because a gate that reports nothing looks exactly like a gate that
 * finds nothing, and this one has already been both: while the shared lexer
 * read `ChangeEvent<HTMLInputElement>` as an unclosed element, the walk found
 * ZERO mixed rows and the gate passed a form written to fail it. A test can ask
 * this for the rows it knows are there; it cannot ask `scanRepo`, whose correct
 * answer is the empty list.
 */
export function repoMixedRows() {
  const mixed = new Map();
  for (const file of walk(join(root, "apps"), [".tsx"])) {
    for (const [cls, line] of mixedRowClasses(readFileSync(file, "utf8"))) {
      if (!mixed.has(cls)) mixed.set(cls, { file: relative(root, file), line });
    }
  }
  return mixed;
}

export function scanRepo() {
  const mixed = repoMixedRows();

  const findings = [];
  for (const file of walk(join(root, "apps"), [".css"])) {
    for (const [cls, declared] of layoutByClass(readFileSync(file, "utf8"))) {
      if (!mixed.has(cls)) continue;
      const bad = verdict(declared);
      if (bad === null) continue;
      findings.push({
        file: relative(root, file).split("\\").join("/"),
        cls,
        ...bad,
        markup: `${mixed.get(cls).file.split("\\").join("/")}:${mixed.get(cls).line}`,
      });
    }
  }
  return findings;
}

function main() {
  const findings = scanRepo();
  if (findings.length > 0) {
    console.error(
      `check-rows: ${findings.length} field row(s) that mix a labelled field with a\n` +
        "bare control and do not align their controls.\n",
    );
    for (const f of findings) {
      console.error(`  ${f.file}:${f.line}: .${f.cls} is ${f.align}   (markup: ${f.markup})`);
    }
    console.error(
      "\nA `TextField`/`Select` that draws a label is two boxes tall; a bare input,\n" +
        "a button, a checkbox and an `inline` select are one. `align-items: center`\n" +
        "centres the BOXES, which puts each control on its own baseline — half a\n" +
        "label apart, at every window size. Say `align-items: end` and the controls\n" +
        "share a line while the labels float above the children that have them.\n" +
        "If instead every child should be the same shape, give the bare ones labels\n" +
        "and the row stops being mixed — which is the better fix where it applies.",
    );
    process.exit(1);
  }
  console.log("check-rows: every mixed field row aligns its controls.");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
