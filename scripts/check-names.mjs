/**
 * check:names — a field's accessible name is its NAME, never its name and its
 * explanation.
 *
 * WHY THIS GATE EXISTS.
 *
 * A `<label>` that WRAPS its control takes the element's entire text content as
 * that control's accessible name. That is the feature — it is why `<label>Email
 * <input></label>` names the input with no `for` — and it is the defect the
 * moment anything else is inside the label. A hint explaining the field, or the
 * message refusing the value, joins the name.
 *
 * It has shipped twice, in two different shapes, from the same reasoning: „a
 * name above a control above a hint is what the design asks for". UČENJE's two
 * daily caps announced themselves as „Novih kartica dnevno Najviše 200 novih
 * kartica dnevno" — the name and its own explanation read out as one sentence —
 * and the markup looked tidy, because the ARRANGEMENT was right and only the
 * WRAPPING was wrong. PRIVATNO's four credential choices do the same thing to
 * their radios, at the foot of a form where „Zasebna šifra za Privatno" and the
 * sentence describing it arrive as one utterance.
 *
 * WHY THIS IS THE LEVEL TO FIX IT AT. The row is not the defect and neither is
 * the hint; it is that the two are spoken as one. So the rule is a statement
 * about what a wrapping label CONTAINS, and it therefore needs no exemption
 * list and cannot have one: a `<label>` that holds a control and an explanation
 * is a finding, wherever it is written. The four settings rows that had this
 * shape are one component now (`SettingsField`) — this gate is what keeps the
 * shape out of the places a component cannot reach, and out of the next one.
 *
 * WHAT AN EXPLANATION IS, and why it is a PATTERN rather than a list. An element
 * is an explanation when its className carries `nx-hint` or a `__error` token —
 * the two names this app gives the two things it says about a field. That is
 * derived rather than listed for [[DC-109]]'s reason: there are thirteen
 * `__error` classes today (set, fit, auth, tool, fin, onb, hab, elec-inspector,
 * canv, searchpage, search, pro-picker, people), a hand-kept list of them fails
 * by OMISSION, and the fourteenth would have to know to edit this file. A
 * pattern cannot go stale, because the next `__error` class joins it by being
 * written.
 *
 * WHAT IT CANNOT SEE, stated so nobody mistakes green for proof:
 *   - A name written twice — an `aria-label` repeating a visible string, which
 *     is [[DC-120]]'s class and a different question, because it needs the prop
 *     resolved rather than read. `check:controls` and DC-120 step 4 own it.
 *   - A wrapping `<label>` whose extra content carries no class at all.
 *     `<label>Email <input> we will never share it</label>` is the same defect
 *     spelled as a bare text node, and there is nothing to key on: that text is
 *     the element's own child, indistinguishable from a name.
 *   - A computed `className`, so a hint written through a helper is invisible
 *     here. Same reason `check:rows` and `check:tiers` say so.
 *   - A control rendered by a component this gate does not know. `<Checkbox>`
 *     and `<Radio>` are recognised because `packages/ui` renders them as inputs.
 *
 * TWO WAYS OUT, and it accepts both because both are correct. The explanation
 * can move out beside the control, leaving the label to name what the user
 * reads as the name — which is what `TextField`, `Select`, `TextArea` and
 * `Checkbox` do by construction, each drawing a `<label for>` BESIDE its
 * control. Or the control can be named by reference, `aria-labelledby` at the
 * span the user reads, which is `Select`'s own prescription for a field a
 * heading already names. The gate does not choose between them; the layout
 * does.
 */
import { readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { blankComments, elementsWithChildren, walk } from "./check-rows.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * What counts as a control for this rule.
 *
 * The three intrinsics are the whole point of a wrapping label. `Checkbox` and
 * `Radio` are here because `packages/ui` renders them as `<input>` — and a
 * `Checkbox` is itself a wrapping label, so one inside another is a nest of two
 * names where the inner one wins.
 */
const CONTROLS = new Set(["input", "select", "textarea", "Checkbox", "Radio"]);

/** A label of its own: `for`/`htmlFor` names a control from OUTSIDE the tag. */
const NAMES_FROM_OUTSIDE = /(?<![-\w])(htmlFor|for)=/;

/**
 * A control named by something it points at.
 *
 * This is the other way out of the defect, and it is not a loophole: the
 * accessible name is computed from the REFERENCED element, so a wrapping label
 * that contains an explanation no longer contributes to the name at all. PRIV's
 * four choice rows take it, because the row has to stay a `<label>` for the
 * whole box to stay clickable — `cursor: pointer` on `.priv__choice-row` is the
 * interaction — and `aria-labelledby` at the span that names the choice is what
 * keeps the note out of the name.
 *
 * TAKEN AT ITS WORD, which is the gap worth naming: an id that resolves to
 * nothing falls back to the label's own text, which is the defect again, and
 * nothing static can see that — the id may be rendered by a component this file
 * cannot read. Same family as `check:rows`' „a component whose shape it cannot
 * read": the rule says what it checked rather than implying more.
 */
const NAMED_BY_REFERENCE = /(?<![-\w])aria-labelledby=/;

/**
 * The classes that mean „this is what we say ABOUT the field".
 *
 * `nx-hint` and its modifiers, or any class in the `__error` family. Members of
 * the latter are `<span>`/`<p>` elements whose whole job is a sentence about the
 * control next to them.
 */
export function isExplanation(text) {
  const attribute = /className="([^"]*)"/.exec(text);
  if (attribute === null) return false;
  return attribute[1]
    .trim()
    .split(/\s+/)
    .some((cls) => cls === "nx-hint" || cls.startsWith("nx-hint--") || cls.endsWith("__error"));
}

/** Every element inside `element`, at any depth. */
function descendants(element) {
  const out = [];
  for (const child of element.children) {
    out.push(child, ...descendants(child));
  }
  return out;
}

/**
 * The one class that makes an element a finding, for the message.
 *
 * A finding has to NAME THE RULE IT BROKE — „named by the label AND its
 * `<span>`" would have been true of every row in this file — so the reader is
 * told which class turned the element into an explanation.
 */
function explanationClass(text) {
  const attribute = /className="([^"]*)"/.exec(text);
  if (attribute === null) return "?";
  return (
    attribute[1]
      .trim()
      .split(/\s+/)
      .find((cls) => cls === "nx-hint" || cls.startsWith("nx-hint--") || cls.endsWith("__error")) ??
    "?"
  );
}

/**
 * Every wrapping `<label>` in `tsx` that holds a control, with what it says
 * about that control's name.
 *
 * `naming` is the explanation class inside the label, or `null` when there is
 * none; `named` says whether the control is named by reference instead. A
 * FINDING is the two together — `naming !== null && !named` — and the census
 * deliberately reports the four fields rather than only that verdict, because
 * the test has to be able to ask the other question: are the labels this rule
 * exists for still being SEEN? A walk that quietly stopped finding PRIV's four
 * rows would report `[]`, which is the correct answer and the answer a broken
 * one gives. `check:rows` learned that the expensive way.
 */
export function wrappingLabels(tsx) {
  const source = blankComments(tsx);
  const found = [];
  for (const element of elementsWithChildren(source)) {
    if (element.name !== "label") continue;
    if (NAMES_FROM_OUTSIDE.test(element.text)) continue;

    const inside = descendants(element);
    const control = inside.find((child) => CONTROLS.has(child.name));
    if (control === undefined) continue;

    const explanation = inside.find((child) => isExplanation(child.text));
    found.push({
      line: tsx.slice(0, element.start).split("\n").length,
      control: control.name,
      naming: explanation === undefined ? null : explanationClass(explanation.text),
      explanationLine:
        explanation === undefined ? null : tsx.slice(0, explanation.start).split("\n").length,
      named: NAMED_BY_REFERENCE.test(control.text),
    });
  }
  return found;
}

/** The census over the whole tree: every wrapping label, naming or not. */
export function repoWrappingLabels() {
  const seen = [];
  for (const file of walk(join(root, "apps"), [".tsx"])) {
    const source = readFileSync(file, "utf8");
    for (const label of wrappingLabels(source)) {
      seen.push({ file: relative(root, file).split("\\").join("/"), ...label });
    }
  }
  return seen;
}

/**
 * The verdict, on its own so it can be asked a question without a repository.
 *
 * It exists as a named function rather than as the filter inside `scanRepo`
 * because that is where this gate can be silently wrong in a way nothing else
 * notices: `scanRepo()` returning `[]` is the correct answer AND the answer an
 * inverted predicate gives, and the census above would still be full either
 * way. A test asks this directly, in both directions.
 */
export function findings(labels) {
  return labels.filter((label) => label.naming !== null && !label.named);
}

export function scanRepo() {
  return findings(repoWrappingLabels());
}

function main() {
  const findings = scanRepo();
  if (findings.length > 0) {
    console.error(
      `check-names: ${findings.length} wrapping <label>(s) that take an explanation as\n` +
        "part of the control's accessible name.\n",
    );
    for (const f of findings) {
      console.error(
        `  ${f.file}:${f.line}: <${f.control}> named by the label AND its .${f.naming}` +
          ` (line ${f.explanationLine})`,
      );
    }
    console.error(
      "\nA wrapping label takes its ENTIRE text content as the control's name, so a\n" +
        "hint inside one is read out as part of the name: „Zasebna šifra za Privatno\n" +
        "Zasebna šifra ostaje na ovom uređaju…\", one utterance, at every screen\n" +
        "reader. Name the control from the text that names it and move the explanation\n" +
        "out beside it — `TextField`, `Select`, `TextArea` and `Checkbox` all draw a\n" +
        "`<label for>` beside the control rather than around it — or point the control\n" +
        "at the span that names it with `aria-labelledby`.",
    );
    process.exit(1);
  }
  console.log("check-names: no wrapping label speaks its own explanation as a name.");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
