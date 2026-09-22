/**
 * check:names — a control's accessible name is its NAME, never its name and
 * its explanation.
 *
 * WHY THIS GATE EXISTS.
 *
 * A `<label>` gives the control it names its ENTIRE text content as that
 * control's accessible name. That is the feature — it is why `<label>Email
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
 * about what a label SAYS, and it therefore needs no exemption list and cannot
 * have one: a label that names a control and says more than one thing is a
 * finding, wherever it is written. The four settings rows that had this shape
 * are one component now (`SettingsField`) — this gate is what keeps the shape
 * out of the places a component cannot reach, and out of the next one.
 *
 * WHAT MAKES A FINDING, and why it is a COUNT rather than a search. The
 * accessible name computation does not distinguish a label that wraps its
 * control from one that points at it with `for`; both take the element's whole
 * text content. So the question is not „does this label contain a hint" but „how
 * many things does it say". Each direct child carrying text is one thing, each
 * run of bare text between them is one thing, and the control is not one of them
 * — it is what is being named. More than one, and the control is introduced by a
 * concatenation. Nothing here reads a class name to decide that.
 *
 * WHY NOT A LIST OF CLASSES, which is what this file did first. It keyed on
 * `nx-hint`, `nx-hint--*` and the `__error` family — derived rather than listed,
 * for [[DC-109]]'s reason, and still a list of NAMES. The tree held a hint this
 * app calls something else: `elec-chassis__shape-hint`, a radio's own
 * description, inside a wrapping label in `ElecChassisDialog`. The gate reported
 * `naming: null` and the census counted that defect as a correct case, so the
 * check was green on a field a reader hears as „Kocka Kockasto kućište sa
 * zaobljenim ivicama" while being red on the four rows that had already been
 * fixed. It was found by reading the call site, not by running the check. A rule
 * phrased as a count needs no vocabulary: the fourteenth `__error` class and the
 * `__shape-hint` that is not one are both counted, because both are text.
 *
 * WHAT IT CANNOT SEE, stated so nobody mistakes green for proof:
 *   - A name written twice — an `aria-label` repeating a visible string, which
 *     is [[DC-120]]'s class and a different question, because it needs the prop
 *     resolved rather than read. `check:controls` and DC-120 step 4 own it.
 *   - A computed `className`. A piece rendered through a helper is counted as
 *     the helper's element — one thing — which is right for a helper returning
 *     the name and wrong for one returning a name and a hint.
 *   - A control rendered by a component this gate does not know. `<Checkbox>`
 *     and `<Radio>` are recognised because `packages/ui` renders them as inputs.
 *   - A `for` label whose control sits in another file: the id is resolved
 *     inside this one, and a `for` naming an id it cannot find is reported. That
 *     is a QUESTION rather than a verdict — the control may carry an
 *     `aria-labelledby` nothing here can reach — and it is reported because the
 *     label still says more than one thing, which is a fact about the label
 *     whether or not anything downstream silences it.
 *
 * TWO WAYS OUT, and it accepts both because both are correct. The explanation
 * can move out beside the control, leaving the label to name what the user reads
 * as the name — which is what `TextField`, `Select`, `TextArea` and `Checkbox`
 * do by construction, each drawing a `<label for>` BESIDE its control. Or the
 * control can be named by reference, `aria-labelledby` at the span the user
 * reads, which is `Select`'s own prescription for a field a heading already
 * names. The gate does not choose between them; the layout does.
 */
import { readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { blankComments, elementsWithChildren, walk } from "./check-rows.mjs";
import { jsxElements } from "./jsx-elements.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Any JSX tag name: intrinsic or component. */
const TAG = /[A-Za-z][A-Za-z0-9.]*/;

/**
 * What counts as a control for this rule.
 *
 * The three intrinsics are the whole point of a wrapping label. `Checkbox` and
 * `Radio` are here because `packages/ui` renders them as `<input>` — and a
 * `Checkbox` is itself a wrapping label, so one inside another is a nest of two
 * names where the inner one wins.
 */
const CONTROLS = new Set(["input", "select", "textarea", "Checkbox", "Radio"]);

/** A label that names a control from OUTSIDE the tag. */
const NAMES_FROM_OUTSIDE = /(?<![-\w])(htmlFor|for)=/;

/** The id it names, when that id is a literal this file can follow. */
const NAMED_ID = /(?<![-\w])(?:htmlFor|for)=(?:"([^"]*)"|\{"([^"]*)"\})/;

/**
 * A control named by something it points at.
 *
 * This is the other way out of the defect, and it is not a loophole: the
 * accessible name is computed from the REFERENCED element, so a label that says
 * three things no longer contributes to the name at all. PRIV's four choice rows
 * take it, because the row has to stay a `<label>` for the whole box to stay
 * clickable — `cursor: pointer` on `.priv__choice-row` is the interaction — and
 * `aria-labelledby` at the span that names the choice is what keeps the note out
 * of the name.
 *
 * TAKEN AT ITS WORD, which is the gap worth naming: an id that resolves to
 * nothing falls back to the label's own text, which is the defect again, and
 * nothing static can see that — the id may be rendered by a component this file
 * cannot read. Same family as `check:rows`' „a component whose shape it cannot
 * read": the rule says what it checked rather than implying more.
 */
const NAMED_BY_REFERENCE = /(?<![-\w])aria-labelledby=/;

/** Does this raw region say anything, once tags and braces are removed? */
function saysSomething(region) {
  return region.replace(/<[^>]*>/g, " ").replace(/[{}]/g, " ").trim() !== "";
}

/**
 * Where `element`'s own closing tag sits, relative to its opening one.
 *
 * A DEPTH COUNT over the tags, not the first `</name>` found: a `<span>` holding
 * two `<span>`s meets a closing tag that belongs to its first child, and a
 * search that stopped there would end the parent's content early — which is
 * exactly the shape PRIVATNO writes. Opening tags come from `jsxElements`
 * because a `=>` inside an attribute contains a `>` and a hand-rolled pattern
 * ends the tag at it; closing tags are scanned textually because `</name>`
 * holds nothing that can be mistaken for anything.
 */
function closeOf(tsx, element) {
  const from = element.start + element.text.length;
  const rest = tsx.slice(from);
  const events = [];
  for (const tag of jsxElements(rest, TAG)) {
    if (!tag.text.trimEnd().endsWith("/>")) events.push({ at: tag.start, selfClosing: false });
  }
  for (const m of rest.matchAll(/<\/([A-Za-z][A-Za-z0-9.]*)\s*>/g)) {
    events.push({ at: m.index, close: m[1], selfClosing: false });
  }
  events.sort((a, b) => a.at - b.at);

  let depth = 0;
  for (const event of events) {
    if (event.close !== undefined) {
      if (depth === 0) {
        if (event.close === element.name) return event.at;
        continue;
      }
      depth -= 1;
    } else {
      depth += 1;
    }
  }
  return rest.length;
}

/**
 * What a finding names a piece by: its first class, or its tag when it has none.
 *
 * `?` would have stood for both a `<span id={…}>` and a component, and a reader
 * sent to find one of those by a question mark is sent to the wrong place.
 */
function classNameOf(element) {
  const attribute = /className="([^"]*)"/.exec(element.text);
  return attribute === null ? element.name : attribute[1].trim().split(/\s+/)[0];
}

/**
 * Every text-bearing piece the label contributes to the control's name.
 *
 * LEAVES, not direct children, and the difference is the whole rule. PRIVATNO
 * wraps its name and its note in one `<span class="priv__choice-text">`, so a
 * rule that counted children would see one thing there and call the row clean —
 * and would then have gone on calling it clean after `aria-labelledby` was
 * deleted from it. The name a wrapping label produces is its entire text
 * content, so what has to be counted is every leaf that content is built from,
 * however many wrappers sit between them and the label.
 *
 * A child's region runs from the end of its OWN opening tag to the start of the
 * next sibling, so it holds the child's content and its closing tag and nothing
 * of the sibling — which is why stripping tags from it leaves exactly what the
 * child renders. The element's own closing tag is the first of its name after
 * its opening one; labels do not nest here, and a nested `<Checkbox>` is written
 * self-closing so it contributes no `</label>` of its own.
 */
function pieces(tsx, element, skip) {
  const contentStart = element.start + element.text.length;
  const end = contentStart + closeOf(tsx, element);
  const line = (index) => tsx.slice(0, index).split("\n").length;

  const found = [];
  let cursor = contentStart;
  for (const child of element.children) {
    if (child.start >= end) break;
    if (saysSomething(tsx.slice(cursor, child.start)))
      found.push({ what: "text", line: line(cursor) });
    // Where this child stops, computed from the child rather than from the next
    // sibling — because a control written last would otherwise swallow the text
    // after it, and `<label>Email <input> we never share it</label>` says three
    // things with one child in it.
    const opensAt = child.start + child.text.length;
    const closesAt = child.text.trimEnd().endsWith("/>") ? opensAt : opensAt + closeOf(tsx, child);
    if (child !== skip) {
      if (child.children.length === 0) {
        if (saysSomething(tsx.slice(opensAt, closesAt)))
          found.push({ what: classNameOf(child), line: line(child.start) });
      } else {
        found.push(...pieces(tsx, child, skip));
      }
    }
    cursor = closesAt;
  }
  if (saysSomething(tsx.slice(cursor, end))) found.push({ what: "text", line: line(cursor) });
  return found;
}

/** The control an id belongs to, when that control is in this file. */
function findById(tsx, id) {
  const pattern = new RegExp(`(?<![-\\w])id="${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`);
  return elementsWithChildren(tsx).find((element) => pattern.test(element.text));
}

/**
 * Every `<label>` in `tsx` that names a control, with what it says about it.
 *
 * `says` is every text-bearing piece the label contributes, in document order;
 * `named` says whether the control is named by reference instead. A FINDING is
 * the two together — `says.length > 1 && !named` — and the census deliberately
 * reports the whole record rather than only that verdict, because the test has
 * to be able to ask the other question: are the labels this rule exists for
 * still being SEEN? A walk that quietly stopped finding PRIV's four rows would
 * report `[]`, which is the correct answer and the answer a broken one gives.
 * `check:rows` learned that the expensive way.
 */
export function labelsNamingControls(tsx) {
  const source = blankComments(tsx);
  const found = [];
  for (const element of elementsWithChildren(source)) {
    if (element.name !== "label") continue;

    const outside = NAMES_FROM_OUTSIDE.test(element.text);
    const id = outside ? NAMED_ID.exec(element.text) : null;
    const control = outside
      ? findById(source, id?.[1] ?? id?.[2] ?? "")
      : element.children.find((child) => CONTROLS.has(child.name));
    // A `for` label names a control that may live in another file; the label
    // still says what it says, so the rule applies either way.
    if (!outside && control === undefined) continue;

    const line = tsx.slice(0, element.start).split("\n").length;
    found.push({
      line,
      control: control?.name ?? null,
      says: pieces(source, element, outside ? undefined : control),
      named: control !== undefined && NAMED_BY_REFERENCE.test(control.text),
    });
  }
  return found;
}

/**
 * The census over a tree: every label naming a control, finding or not.
 *
 * `root` is a parameter so the verdict can be shown to FIRE on a tree of its
 * own, not only to be quiet on this one — `scanRepo()` returning `[]` is the
 * correct answer and the answer a walk pointed at the wrong directory gives.
 * The default is this repository, which is what `main()` and CI use.
 */
export function repoLabelsNamingControls(root = repoRoot) {
  const seen = [];
  for (const file of walk(join(root, "apps"), [".tsx"])) {
    const source = readFileSync(file, "utf8");
    for (const label of labelsNamingControls(source)) {
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
  return labels.filter((label) => label.says.length > 1 && !label.named);
}

export function scanRepo(root = repoRoot) {
  return findings(repoLabelsNamingControls(root));
}

function main() {
  const found = scanRepo();
  if (found.length > 0) {
    console.error(
      `check-names: ${found.length} label(s) that take more than a name from the\n` +
        "control they name.\n",
    );
    for (const f of found) {
      const extra = f.says.slice(1).map((s) => (s.what === "text" ? "text" : `.${s.what}`));
      console.error(
        `  ${f.file}:${f.line}: <${f.control ?? "for"}> named by the label AND ` +
          `${extra.join(", ")} (${f.says.slice(1).map((s) => s.line).join(", ")})`,
      );
    }
    console.error(
      "\nA label gives the control it names its ENTIRE text content, so a hint inside\n" +
        "one is read out as part of the name: „Zasebna šifra za Privatno Zasebna šifra\n" +
        "ostaje na ovom uređaju…\", one utterance, at every screen reader. Name the\n" +
        "control from the text that names it and move the explanation out beside it —\n" +
        "`TextField`, `Select`, `TextArea` and `Checkbox` all draw a `<label for>`\n" +
        "beside the control rather than around it — or point the control at the span\n" +
        "that names it with `aria-labelledby`.",
    );
    process.exit(1);
  }
  console.log("check-names: no label speaks more than a name for the control it names.");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
