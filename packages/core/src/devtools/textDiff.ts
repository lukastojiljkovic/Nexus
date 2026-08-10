/**
 * Diff — a real Myers O(ND) diff, in linear space, over lines or over words.
 *
 * **Why not the LCS table everybody writes.** The textbook longest-common-
 * subsequence dynamic program is O(N·M) in TIME and, worse, O(N·M) in MEMORY. On
 * the two 5000-line files this tool exists to be handed that is 25 million
 * cells: a hundred megabytes for a table, allocated inside a renderer, to answer
 * a question whose answer is usually „about forty lines changed". Myers' 1986
 * algorithm („An O(ND) Difference Algorithm and Its Variations", Algorithmica
 * 1(2)) is O((N+M)·D) where D is the size of the edit script, so it is fast
 * exactly when the files are similar — which is when a diff is being looked at.
 *
 * **The linear-space refinement is what makes it usable, not a nicety.** The
 * plain greedy form records one frontier per D and reconstructs the path by
 * walking them back, which is O(D²) memory — for two wholly different 5000-line
 * files that is worse than the table it replaced. Section 4b's middle-snake
 * variant instead finds the point where the forward and reverse frontiers meet,
 * splits the problem there, and recurses: two arrays of N+M, and a recursion
 * whose depth is logarithmic because D HALVES at every level.
 *
 * **The comparison key is not the text.** Ignoring case or whitespace changes
 * what counts as equal, never what is displayed — the runs carry the original
 * lines. A diff that showed the normalised text would be showing the user words
 * they did not write.
 *
 * **A final newline is a property of the file, not a line.** `splitLines` drops
 * it, so this module puts it back into the COMPARISON KEY of the last line: a
 * file that ends without one genuinely differs from one that does, and the
 * unified writer reports it exactly as git does, with
 * `\ No newline at end of file`.
 */

import { codepointLength, endsWithNewline, splitLines } from "./text.js";

export type DiffKind = "equal" | "insert" | "delete";

/**
 * One run of consecutive items with the same fate — what a side-by-side view
 * renders as one block.
 *
 * `items` carries the ORIGINAL text: from `a` for `equal` and `delete`, from `b`
 * for `insert`. Under `ignoreCase` or the whitespace options the two sides of an
 * `equal` run can differ character for character, so a two-column view must
 * slice each side by its own `aStart`/`bStart` rather than printing `items`
 * twice — that is the one trap in this shape and it is why both offsets are here
 * even for runs that only touch one side.
 */
export interface DiffRun {
  readonly kind: DiffKind;
  readonly items: readonly string[];
  readonly aStart: number;
  readonly aCount: number;
  readonly bStart: number;
  readonly bCount: number;
}

export interface DiffOptions {
  /** Whitespace at the END of a line stops mattering. */
  readonly ignoreTrailingWhitespace?: boolean;
  /** All whitespace stops mattering — this one wins if both are set. */
  readonly ignoreAllWhitespace?: boolean;
  readonly ignoreCase?: boolean;
}

/** The comparison key for one token. Never displayed; see the module note. */
function comparisonKey(token: string, options: DiffOptions): string {
  let key = token;
  if (options.ignoreAllWhitespace === true) key = key.replace(/\s+/gu, "");
  else if (options.ignoreTrailingWhitespace === true) key = key.replace(/\s+$/u, "");
  if (options.ignoreCase === true) key = key.toLowerCase();
  return key;
}

/** One token's fate, before runs are coalesced. */
interface Step {
  readonly kind: DiffKind;
  readonly a: number;
  readonly b: number;
}

/**
 * Myers' middle snake: the point where a forward and a reverse frontier meet.
 * Returns the split in ABSOLUTE indices, or `null` if none was found inside the
 * D budget (which the caller treats as „replace the whole region").
 */
function middleSnake(
  a: readonly string[],
  aFrom: number,
  aTo: number,
  b: readonly string[],
  bFrom: number,
  bTo: number,
): { readonly a: number; readonly b: number } | null {
  const n = aTo - aFrom;
  const m = bTo - bFrom;
  const maxD = Math.ceil((n + m) / 2);
  const offset = maxD;
  const size = 2 * maxD + 2;
  const forward = new Int32Array(size).fill(-1);
  const reverse = new Int32Array(size).fill(-1);
  forward[offset + 1] = 0;
  reverse[offset + 1] = 0;
  const delta = n - m;
  // With an odd delta the frontiers can only meet on a forward step, with an
  // even one only on a reverse step. Checking the wrong half finds nothing.
  const meetsForward = delta % 2 !== 0;
  let forwardStart = 0;
  let forwardEnd = 0;
  let reverseStart = 0;
  let reverseEnd = 0;

  for (let d = 0; d < maxD; d += 1) {
    for (let k = -d + forwardStart; k <= d - forwardEnd; k += 2) {
      const at = offset + k;
      const left = forward[at - 1] ?? -1;
      const right = forward[at + 1] ?? -1;
      let x = k === -d || (k !== d && left < right) ? right : left + 1;
      let y = x - k;
      while (x < n && y < m && a[aFrom + x] === b[bFrom + y]) {
        x += 1;
        y += 1;
      }
      forward[at] = x;
      if (x > n) forwardEnd += 2;
      else if (y > m) forwardStart += 2;
      else if (meetsForward) {
        const mirror = offset + delta - k;
        const other = mirror >= 0 && mirror < size ? (reverse[mirror] ?? -1) : -1;
        if (other !== -1 && x >= n - other) return { a: aFrom + x, b: bFrom + y };
      }
    }
    for (let k = -d + reverseStart; k <= d - reverseEnd; k += 2) {
      const at = offset + k;
      const left = reverse[at - 1] ?? -1;
      const right = reverse[at + 1] ?? -1;
      let x = k === -d || (k !== d && left < right) ? right : left + 1;
      let y = x - k;
      while (x < n && y < m && a[aTo - x - 1] === b[bTo - y - 1]) {
        x += 1;
        y += 1;
      }
      reverse[at] = x;
      if (x > n) reverseEnd += 2;
      else if (y > m) reverseStart += 2;
      else if (!meetsForward) {
        const mirror = offset + delta - k;
        const other = mirror >= 0 && mirror < size ? (forward[mirror] ?? -1) : -1;
        if (other !== -1 && other >= n - x) {
          return { a: aFrom + other, b: bFrom + offset + other - mirror };
        }
      }
    }
  }
  return null;
}

/** Emits the steps for one region, in order, splitting it at the middle snake. */
function walk(
  a: readonly string[],
  aFromIn: number,
  aToIn: number,
  b: readonly string[],
  bFromIn: number,
  bToIn: number,
  out: Step[],
): void {
  let aFrom = aFromIn;
  let aTo = aToIn;
  let bFrom = bFromIn;
  let bTo = bToIn;

  while (aFrom < aTo && bFrom < bTo && a[aFrom] === b[bFrom]) {
    out.push({ kind: "equal", a: aFrom, b: bFrom });
    aFrom += 1;
    bFrom += 1;
  }
  // The common suffix is found now but emitted last — the middle has to come
  // between the prefix and it.
  const suffix: Step[] = [];
  while (aTo > aFrom && bTo > bFrom && a[aTo - 1] === b[bTo - 1]) {
    aTo -= 1;
    bTo -= 1;
    suffix.push({ kind: "equal", a: aTo, b: bTo });
  }
  suffix.reverse();

  const replaceWhole = (): void => {
    for (let i = aFrom; i < aTo; i += 1) out.push({ kind: "delete", a: i, b: bFrom });
    for (let i = bFrom; i < bTo; i += 1) out.push({ kind: "insert", a: aTo, b: i });
  };

  if (aFrom === aTo || bFrom === bTo) {
    replaceWhole();
  } else {
    const split = middleSnake(a, aFrom, aTo, b, bFrom, bTo);
    // A split that consumes the whole region on either end would recurse on the
    // region it was given — belt and braces against a non-terminating loop, at
    // the cost of one coarse block in a case the algorithm should never produce.
    const degenerate =
      split === null ||
      (split.a === aFrom && split.b === bFrom) ||
      (split.a === aTo && split.b === bTo);
    if (degenerate) replaceWhole();
    else {
      walk(a, aFrom, split.a, b, bFrom, split.b, out);
      walk(a, split.a, aTo, b, split.b, bTo, out);
    }
  }
  for (const step of suffix) out.push(step);
}

/**
 * Steps coalesced into runs, with deletes ordered before inserts inside each
 * changed region. Reordering is safe because a changed region contains no equal
 * steps, so its `a` indices are contiguous and so are its `b` indices; doing it
 * turns the `delete insert delete insert` that recursion can produce into the
 * one deleted block and one inserted block a reader expects.
 */
function coalesce(
  steps: readonly Step[],
  aItems: readonly string[],
  bItems: readonly string[],
): DiffRun[] {
  const ordered: Step[] = [];
  for (let i = 0; i < steps.length; ) {
    if (steps[i]?.kind === "equal") {
      const step = steps[i];
      if (step !== undefined) ordered.push(step);
      i += 1;
      continue;
    }
    let end = i;
    while (end < steps.length && steps[end]?.kind !== "equal") end += 1;
    const region = steps.slice(i, end);
    for (const step of region) if (step.kind === "delete") ordered.push(step);
    for (const step of region) if (step.kind === "insert") ordered.push(step);
    i = end;
  }

  const runs: DiffRun[] = [];
  for (let i = 0; i < ordered.length; ) {
    const first = ordered[i];
    if (first === undefined) break;
    let end = i;
    while (end < ordered.length && ordered[end]?.kind === first.kind) end += 1;
    const count = end - i;
    const source = first.kind === "insert" ? bItems : aItems;
    const from = first.kind === "insert" ? first.b : first.a;
    runs.push({
      kind: first.kind,
      items: source.slice(from, from + count),
      aStart: first.a,
      aCount: first.kind === "insert" ? 0 : count,
      bStart: first.b,
      bCount: first.kind === "delete" ? 0 : count,
    });
    i = end;
  }
  return runs;
}

/** The core: items to display, keys to compare by. */
function diffKeyed(
  aItems: readonly string[],
  aKeys: readonly string[],
  bItems: readonly string[],
  bKeys: readonly string[],
): readonly DiffRun[] {
  const steps: Step[] = [];
  walk(aKeys, 0, aKeys.length, bKeys, 0, bKeys.length, steps);
  return coalesce(steps, aItems, bItems);
}

/** Two token sequences diffed under the given options. The building block both `diffLines` and `diffWords` stand on. */
export function diffTokens(
  a: readonly string[],
  b: readonly string[],
  options: DiffOptions = {},
): readonly DiffRun[] {
  const key = (token: string): string => comparisonKey(token, options);
  return diffKeyed(a, a.map(key), b, b.map(key));
}

/** Two texts diffed line by line. */
export function diffLines(a: string, b: string, options: DiffOptions = {}): readonly DiffRun[] {
  return diffTokens(splitLines(a), splitLines(b), options);
}

/**
 * Text split into words AND the whitespace between them, so `splitWords(t).join("")`
 * is `t` again. Keeping the gaps is what lets a word-level diff be rendered
 * inline over the original text instead of as a list of words.
 */
export function splitWords(text: string): readonly string[] {
  return text.match(/\s+|\S+/gu) ?? [];
}

/** Two texts diffed word by word — the view for a paragraph that was edited rather than rewritten. */
export function diffWords(a: string, b: string, options: DiffOptions = {}): readonly DiffRun[] {
  return diffTokens(splitWords(a), splitWords(b), options);
}

export interface UnifiedDiffOptions extends DiffOptions {
  /** Unchanged lines kept around each change. Default 3, as `diff -u` has since 1990. */
  readonly context?: number;
  readonly fromLabel?: string;
  readonly toLabel?: string;
}

/** git's marker, which is part of the FORMAT rather than user-facing copy, so it stays in English. */
const NO_NEWLINE = "\\ No newline at end of file";

/**
 * Appended to the comparison key of a last line that has no terminator after it.
 * Built from a NUL rather than written as text because no line of a text file
 * can contain one, so it cannot collide with something the user actually typed —
 * a printable sentinel could, and then two different files would compare equal.
 */
const OPEN_END_KEY = `${String.fromCharCode(0)}no-newline`;

interface LineOp {
  readonly kind: DiffKind;
  readonly aIndex: number;
  readonly bIndex: number;
  readonly text: string;
}

/** `-l,s` / `+l,s`, with the count omitted when it is 1 and the start dropped to 0 for an empty range — GNU's rules. */
function range(start: number, count: number): string {
  const first = count === 0 ? start : start + 1;
  return count === 1 ? String(first) : `${first},${count}`;
}

/**
 * A unified diff, or the empty string when the two texts are the same under the
 * options in force.
 *
 * The final newline is handled by making it part of the last line's comparison
 * key rather than by special-casing the output: `"a\nb"` against `"a\nb\n"`
 * therefore comes out as a genuine `-b` / `+b` pair with `\ No newline at end of
 * file` under the deleted side, which is what git prints and what `patch` can
 * apply. Reporting them as an unchanged line and quietly losing the difference
 * would be a diff that lies about a file it is describing.
 */
export function unifiedDiff(a: string, b: string, options: UnifiedDiffOptions = {}): string {
  const { context = 3, fromLabel = "a", toLabel = "b" } = options;
  const aLines = splitLines(a);
  const bLines = splitLines(b);
  const aOpen = aLines.length > 0 && !endsWithNewline(a);
  const bOpen = bLines.length > 0 && !endsWithNewline(b);

  const keys = (lines: readonly string[], open: boolean): string[] =>
    lines.map((line, index) =>
      index === lines.length - 1 && open
        ? `${comparisonKey(line, options)}${OPEN_END_KEY}`
        : comparisonKey(line, options),
    );

  const runs = diffKeyed(aLines, keys(aLines, aOpen), bLines, keys(bLines, bOpen));
  if (runs.every((run) => run.kind === "equal")) return "";

  const ops: LineOp[] = [];
  for (const run of runs) {
    run.items.forEach((text, index) => {
      ops.push({
        kind: run.kind,
        aIndex: run.aStart + (run.kind === "insert" ? 0 : index),
        bIndex: run.bStart + (run.kind === "delete" ? 0 : index),
        text,
      });
    });
  }

  const changed = ops.map((op) => op.kind !== "equal");
  const lines: string[] = [`--- ${fromLabel}`, `+++ ${toLabel}`];
  const width = Math.max(0, context);

  let cursor = 0;
  while (cursor < ops.length) {
    if (changed[cursor] !== true) {
      cursor += 1;
      continue;
    }
    const start = Math.max(0, cursor - width);
    let end = cursor;
    // Absorb the next change too whenever their contexts would touch — a gap of
    // at most 2·context unchanged lines between them. That is what keeps `@@`
    // headers from stuttering over a densely edited region.
    for (;;) {
      let probe = end + 1;
      let gap = 0;
      while (probe < ops.length && changed[probe] !== true) {
        probe += 1;
        gap += 1;
      }
      if (probe < ops.length && gap <= 2 * width) {
        end = probe;
        continue;
      }
      break;
    }
    end = Math.min(ops.length - 1, end + width);

    const hunk = ops.slice(start, end + 1);
    const aCount = hunk.filter((op) => op.kind !== "insert").length;
    const bCount = hunk.filter((op) => op.kind !== "delete").length;
    const aStart = hunk.find((op) => op.kind !== "insert")?.aIndex ?? ops[start]?.aIndex ?? 0;
    const bStart = hunk.find((op) => op.kind !== "delete")?.bIndex ?? ops[start]?.bIndex ?? 0;
    lines.push(`@@ -${range(aStart, aCount)} +${range(bStart, bCount)} @@`);

    for (const op of hunk) {
      const sign = op.kind === "equal" ? " " : op.kind === "delete" ? "-" : "+";
      lines.push(`${sign}${op.text}`);
      const lastOfA = op.kind !== "insert" && op.aIndex === aLines.length - 1 && aOpen;
      const lastOfB = op.kind !== "delete" && op.bIndex === bLines.length - 1 && bOpen;
      if ((op.kind === "delete" && lastOfA) || (op.kind === "insert" && lastOfB)) {
        lines.push(NO_NEWLINE);
      } else if (op.kind === "equal" && lastOfA && lastOfB) {
        lines.push(NO_NEWLINE);
      }
    }
    cursor = end + 1;
  }
  return `${lines.join("\n")}\n`;
}

/** Total codepoints inserted and deleted — the one-line summary a header can show. */
export function diffStats(runs: readonly DiffRun[]): {
  readonly inserted: number;
  readonly deleted: number;
  readonly insertedChars: number;
  readonly deletedChars: number;
} {
  let inserted = 0;
  let deleted = 0;
  let insertedChars = 0;
  let deletedChars = 0;
  for (const run of runs) {
    if (run.kind === "insert") {
      inserted += run.bCount;
      for (const item of run.items) insertedChars += codepointLength(item);
    } else if (run.kind === "delete") {
      deleted += run.aCount;
      for (const item of run.items) deletedChars += codepointLength(item);
    }
  }
  return { inserted, deleted, insertedChars, deletedChars };
}
