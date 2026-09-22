/**
 * check:fields — a surface does not draw its own text field.
 *
 * WHY THIS GATE EXISTS. [[DC-120]] was the text-field layer never having
 * `Select`'s contract: `Select` has always required a `label` and has always
 * drawn it, and `TextField`'s name was optional for four months, so 38 of 143
 * call sites named their field invisibly and one named it not at all. The
 * repair ran in four steps and the last of them is this one — a gate, because
 * step three („the hand-rolled inputs") is the step that comes back.
 *
 * WHY IT COUNTS TYPES AND NOT CLASS NAMES, which is what it did first. The
 * obvious rule is „no call site writes `nx-textfield__input`", and it has the
 * same defect `check:names` had before [[DC-109]] reached it: it is a check on
 * a NAME, so a field wearing some other name is not seen at all. Two were
 * living in `noteFindBar.tsx` while that rule was being written — the Ctrl+F
 * bar's query and replace fields, `className="note__find-input"`, which never
 * spelled the shared class and therefore never appeared in a census that
 * searched for it. `check:tiers` found the same shape in the type layer: 33
 * classes writing `.nx-hint`'s five declarations by hand, every one of them
 * locally correct. So the question this asks is not „does it wear the class"
 * but „what IS it" — and a text entry is a text entry whatever it is called.
 *
 * The discriminator is `type`. An `<input>` with no `type` at all IS a text
 * field: that is the HTML default, and it is how a hand-rolled one usually
 * arrives. Four types draw something else, and each is either somebody else's
 * subject or nobody's — see `NOT_A_TEXT_FIELD`.
 *
 * WHAT IT CANNOT SEE, stated so nobody mistakes green for proof:
 *   - A computed `type`. `type={kind}` is read as a question and skipped rather
 *     than guessed at, because this gate reads a literal. Nothing in the tree
 *     writes one; a field that starts to is a gap worth naming rather than a
 *     check worth faking.
 *   - A field that is not an `<input>` at all — a `contentEditable` region or a
 *     third-party editor. `NoteEditor`'s ProseMirror surface is the one here,
 *     and it is not `TextField`'s subject. Worth stating because the near miss
 *     is real: CAL does NOT belong on this list, and it looks as though it
 *     might — its date and both its time fields are `type="date"` and
 *     `type="time"` — but every one of them goes through `TextField`, which is
 *     the ruling this gate encodes rather than an exception to it.
 *   - A `.js`/`.mjs` module that BUILDS the markup as a string. Nothing does.
 *   - Whether the field is any good once it is a `TextField`: its name, its
 *     row, whether a caller's face landed on its wrapper. Those are three
 *     separate subjects — `check:names` and `check:rows` own two of them by
 *     gate, and the wrapper/control split is [[DC-130]] and is held by
 *     convention and by review rather than by a check.
 *
 * WHAT THIS GATE MADE TRUE. It is green on this tree for a reason worth
 * recording, because the census it replaces said the opposite: step three was
 * reported as down to two sites, and it was down to FOUR. Two of the four were
 * unseen purely because of what they were called, and one of the two said so in
 * its own stylesheet — „the .nx-textfield__input recipe, compacted", eight
 * declarations of which five were the primitive's own words, character for
 * character. A rule phrased as a count of what a thing IS would have found it
 * on the day it was written.
 */
import { readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { blankComments, walk } from "./check-rows.mjs";
import { jsxElements } from "./jsx-elements.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The intrinsic element, and only it. A capital initial is a React component,
 * which draws whatever it likes and which no reader of a call site can see —
 * so `jsxElements` is asked for `input` and the components stay another gate's
 * subject.
 */
const INPUT = /input/;

/**
 * The input types that draw something other than a text entry.
 *
 * Four, and none of them is an exemption invented here: a radio and a checkbox
 * are `check:controls`' subject — that gate exists because the OS widget is
 * 13x13, grey in both themes and eleven pixels under the pointer floor — a
 * range draws a slider and takes no keystroke, and a `type="file" hidden` input
 * draws nothing at all and exists only as a ref target (`NoteEditor`'s
 * attachment picker).
 *
 * `date` and `time` are deliberately NOT here, and that is the ruling rather
 * than an oversight: UČENJE's weekday boxes, TASK's list rows and HABITS'
 * reminder field all send a `type="time"` or a `type="date"` through
 * `TextField`. The app has already decided that a field a user types a value
 * into is the primitive's subject whatever the browser draws beside it, and
 * FINANSIJE's „Od – Do" pair took the same route last, in this change.
 */
const NOT_A_TEXT_FIELD = new Set(["radio", "checkbox", "range", "file"]);

/**
 * The primitive, and the only file allowed to write a bare text `<input>`.
 *
 * ONE file, and the number is the rule rather than a list: this is the
 * component the gate exists to make the sole writer of a text field, so a
 * second entry here would mean a second component drawing the same input —
 * which is the thing being checked for. The element this component renders
 * carries no `type` of its own because `{...rest}` forwards the caller's, so
 * the exemption is structural and not a courtesy.
 */
const PRIMITIVE = "packages/ui/src/components/TextField.tsx";

/**
 * The value region of `name="…"` inside an opening tag, exactly and only.
 *
 * `jsxElements` has already found the tag's real end, quote- and brace-aware,
 * so the value is taken the same way: a quoted string ends at its closing
 * quote, a braced one when the depth it opened returns to zero. Returning the
 * REST OF THE TAG would be four lines shorter and would fire on an unrelated
 * attribute that spelled the value out — and the app is one attribute away from
 * that: FINANSIJE's period pair carries `type="date"` and `aria-label` on the
 * same element, and a name is user-facing copy that may say anything. This is
 * `check:rows`' `\blabel=` trap in a different coat, so a test owns the case.
 */
function attributeValue(tag, name) {
  const at = new RegExp(`(?<![-\\w])${name}=`).exec(tag);
  if (at === null) return null;
  const rest = tag.slice(at.index + at[0].length);
  const first = rest[0];
  if (first === '"' || first === "'") {
    const end = rest.indexOf(first, 1);
    return end < 0 ? rest : rest.slice(0, end + 1);
  }
  if (first !== "{") return rest;
  let depth = 0;
  let quote = null;
  for (let i = 0; i < rest.length; i += 1) {
    const ch = rest[i];
    if (quote !== null) {
      if (ch === "\\") i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return rest.slice(0, i + 1);
    }
  }
  return rest;
}

/**
 * What the element declares itself to be.
 *
 * `null` means NO `type` attribute, which is not the same as an unknown one:
 * absent is the HTML default and the default is text. A braced value is the
 * third answer, because this gate reads a literal and will not guess.
 */
export function declaredType(tag) {
  const value = attributeValue(tag, "type");
  if (value === null) return null;
  const literal = /^"([^"]*)"$/.exec(value) ?? /^'([^']*)'$/.exec(value);
  if (literal === null) return "?";
  return literal[1].trim().toLowerCase();
}

/**
 * Every intrinsic `<input>` in `tsx`, with what it says it is.
 *
 * The census is exported beside the verdict for [[DC-109]]'s reason: a scan
 * that stops finding anything reports `[]`, which is the correct answer AND
 * the answer a walk pointed at the wrong directory gives. A test has to be able
 * to ask „is this walk still reading the tree at all", and only the census can
 * answer that — the verdict cannot, because the verdict is the thing in doubt.
 */
export function inputsIn(tsx) {
  const source = blankComments(tsx);
  const found = [];
  for (const element of jsxElements(source, INPUT)) {
    if (element.name !== "input") continue;
    found.push({ line: tsx.slice(0, element.start).split("\n").length, type: declaredType(element.text) });
  }
  return found;
}

/** A text entry drawn by hand: no `type`, or one that is not in the four. */
export function findings(inputs) {
  return inputs.filter((input) => input.type === null || !NOT_A_TEXT_FIELD.has(input.type));
}

/**
 * Every `<input>` in the tree, the primitive's own excluded, with its file.
 *
 * `root` is a parameter so the verdict can be shown to FIRE on a tree of its
 * own, not only to be quiet on this one — `scanRepo()` returning `[]` is the
 * correct answer and the answer a walk pointed at the wrong directory gives.
 */
export function inputsInRepo(root = repoRoot) {
  const all = [];
  for (const dir of ["apps", "packages"]) {
    for (const file of walk(join(root, dir), [".tsx"])) {
      const relativePath = relative(root, file).split("\\").join("/");
      if (relativePath === PRIMITIVE) continue;
      for (const input of inputsIn(readFileSync(file, "utf8"))) {
        all.push({ file: relativePath, ...input });
      }
    }
  }
  return all;
}

/** The verdict, on its own so it can be asked a question about a tree. */
export function scanRepo(root = repoRoot) {
  return findings(inputsInRepo(root));
}

function main() {
  const found = scanRepo();
  if (found.length > 0) {
    console.error(
      `check-fields: ${found.length} text field(s) drawn by hand instead of by\n` +
        "`TextField`.\n",
    );
    for (const f of found) {
      const what = f.type === null ? "no `type` at all — the HTML default is text" : `type="${f.type}"`;
      console.error(`  ${f.file}:${f.line}: <input> with ${what}`);
    }
    console.error(
      "\nA text field is `TextField`'s subject: it draws the box, it takes the\n" +
        "name, and it is the one place the wrapper/control split is written down —\n" +
        "a caller's `className` sizes the BOX while the properties that reach text\n" +
        "belong on the control. A hand-written `<input type=\"text\">` is the shape\n" +
        "that lost the label 38 times (DC-120), and a hand-written copy of the\n" +
        "box is the shape that goes stale silently: noteFindBar's carried eight\n" +
        "declarations, five of them the primitive's own words character for\n" +
        "character, so nothing could see it drift.\n" +
        "\n`type=\"radio\"`, `checkbox`, `range` and `file` are another component's\n" +
        "subject or nobody's, and stay as they are. Everything else — including\n" +
        "`date` and `time` — goes through `TextField`.",
    );
    process.exit(1);
  }
  console.log("check-fields: every text field in the app is drawn by `TextField`.");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
