/**
 * The `{{…}}` cloze grammar, and the rendering of one deletion into plain
 * front/back text (STUDY-006 / ADR-042, explicit numbering ADR-068).
 *
 * This module is the SINGLE source of that grammar. It was private to
 * `notes/noteCards.ts` while a cloze card existed only as a note's by-product;
 * a first-class cloze card has four independent readers, and two of them are
 * nowhere near a note:
 *
 *   - the editor's decoration plugin (`noteFlashcard.ts`, via `parseCardBlock`),
 *   - the note-card generator (`collectNoteCards`),
 *   - `CardStore`, which RE-DERIVES a cloze row's stored `front`/`back` from
 *     `(cloze_text, cloze_ordinal)` on every write, and
 *   - the reviewer, which shows the blank in context and then the answer in
 *     its place (`splitClozeSegments`).
 *
 * They must never disagree about what a deletion is, so `noteCards.ts` imports
 * these back rather than keeping a second copy.
 *
 * **The one closed rule: a deletion's number is its label when it has one, and
 * otherwise its position + 1, counting all runs left to right.** A run's inner
 * text may open with an explicit `c<digits>::` label — `{{c1::Beograd}}` is
 * deletion number 1 with the answer `Beograd` — and a run without one is
 * numbered by where it sits. That single rule is what makes today's implicit
 * reading and the explicit spelling of it THE SAME numbering, which is in turn
 * why materialising labels into an existing text (`clozeDeletionEdits`) changes
 * no card's identity: every run keeps the number it already had.
 *
 * **Numbers are identity, and identity may repeat.** A card is keyed by
 * (text, number), so two runs carrying the same number are ONE card with two
 * blanks — Anki's behaviour, and forced on us by that key anyway. `renderClozeSide`
 * therefore masks every run of the target number and `splitClozeSegments` emits
 * a `target` segment for each of them. Labels need not be contiguous or ordered
 * (`{{c3::…}} {{c1::…}}` is legal); a text's cards list in number order
 * (`clozeNumbers`).
 *
 * Why numbers at all: position is not identity. Inserting a deletion in the
 * middle of a sentence shifts every later deletion onto a different slot, so
 * their FSRS review histories silently swap onto different content. A number
 * survives the insertion — which is why `clozeDeletionEdits` assigns the next
 * unused one rather than reusing a freed one.
 *
 * Pure and platform-neutral: strings in, strings out, no clock, no IO.
 */

/** A `{{…}}` run; `[^{}]*` both bans nesting and lets a run's own inner text decide if it is empty. */
const CLOZE_RUN = /\{\{([^{}]*)\}\}/g;

/**
 * An explicit number at the head of a run's inner text: `c1::`, Anki's own
 * spelling. `[1-9]\d{0,5}` deliberately: `c0::` names no deletion (numbers
 * start at 1, in Anki as here), a leading zero is not a number anyone writes,
 * and six digits is the most a label may carry so a parsed one is always a safe
 * integer — and the value goes on to be stored in an INTEGER column. Anything
 * else is simply not a label: the run keeps its inner text verbatim and is
 * numbered by position, exactly as it was before labels existed.
 */
const CLOZE_LABEL = /^c([1-9]\d{0,5})::/;

/**
 * The largest number a label can spell, and therefore the largest a NEW
 * deletion may be given (`clozeDeletionEdits` refuses past it rather than
 * writing `c1000000::`, which this grammar would read back as answer text).
 * Unreachable by ordinary authoring: an unlabelled run's number is bounded by
 * how many `{{…}}` runs fit in a card's text cap.
 */
export const MAX_CLOZE_NUMBER = 999_999;

/**
 * What a masked deletion renders as in derived text. A literal, stable token:
 * it is written into `cards.front`, so it is also what the search index, the
 * palette snippet, the deck list row and the CSV export all show for a cloze
 * card — changing it would silently rewrite every one of them.
 */
export const CLOZE_MASK = "[…]";

/** One `{{…}}` run whose ANSWER is non-empty after trimming — a cloze deletion, as half-open offsets. */
export interface ClozeRun {
  /** Offset of the opening `{{`. */
  start: number;
  /** Offset just past the closing `}}`. */
  end: number;
  /**
   * Where this run's ANSWER begins: `start + 2`, or past the `cN::` label when
   * the run carries one — so `[start + 2, answerStart)` IS the label, which is
   * the range the editor decorates as a number rather than as answer text.
   */
  answerStart: number;
  /** The answer, with the label (if any) stripped. */
  inner: string;
  /** The number this run DECLARES, or null when it declares none. */
  label: number | null;
  /** This deletion's number, by the one closed rule: `label ?? position + 1`. */
  number: number;
}

/**
 * Every non-overlapping `{{…}}` run with a non-empty (trimmed) answer, in
 * left-to-right order — the deletions of this text, each carrying its number.
 * A run whose answer is empty or whitespace-only (`{{}}`, `{{ }}`, `{{c1::}}`)
 * is not a deletion: it is ignored, exactly as if it were not there, rather
 * than rendered as an empty hidden slot — and it does not consume a position
 * either, so the numbering counts deletions and nothing else.
 */
export function findClozeRuns(text: string): ClozeRun[] {
  const runs: ClozeRun[] = [];
  for (const match of text.matchAll(CLOZE_RUN)) {
    if (match.index === undefined) continue; // matchAll always sets it; guard keeps strict mode happy
    const raw = match[1] ?? "";
    const labelMatch = CLOZE_LABEL.exec(raw);
    const labelText = labelMatch?.[0] ?? "";
    const inner = raw.slice(labelText.length);
    if (inner.trim().length === 0) continue;
    const label = labelMatch === null ? null : Number.parseInt(labelMatch[1] ?? "", 10);
    runs.push({
      start: match.index,
      end: match.index + match[0].length,
      answerStart: match.index + 2 + labelText.length,
      inner,
      label,
      // `runs.length` is this deletion's 0-based position, since a skipped run
      // never reached the array.
      number: label ?? runs.length + 1,
    });
  }
  return runs;
}

/**
 * The distinct numbers `runs` carries, ascending — ONE PER CARD, which is why
 * a repeated number appears once and why the order is numeric rather than
 * positional. This is the list every generator walks to decide how many cards
 * a template makes.
 */
export function clozeNumbers(runs: readonly ClozeRun[]): number[] {
  return [...new Set(runs.map((run) => run.number))].sort((a, b) => a - b);
}

/**
 * Rebuilds one side of a cloze card: EVERY run numbered `target` is replaced by
 * `CLOZE_MASK` (Anki's "hide only this one" behaviour, and its two-blank case),
 * every other run is unwrapped to its own answer. `target: null` unwraps every
 * run — the one back all of a text's cloze cards share.
 */
export function renderClozeSide(
  text: string,
  runs: readonly ClozeRun[],
  target: number | null,
): string {
  let result = "";
  let cursor = 0;
  for (const run of runs) {
    result += text.slice(cursor, run.start);
    result += run.number === target ? CLOZE_MASK : run.inner;
    cursor = run.end;
  }
  return result + text.slice(cursor);
}

/**
 * The ONE helper a cloze card's stored sides are derived by: the masked front
 * and the fully-unwrapped back of deletion `number` of `text`, both trimmed
 * exactly as the note generator has always trimmed them.
 *
 * `null` when `number` names no deletion in `text` — including 0, a negative or
 * a fractional one, none of which any run can carry. That answer is
 * load-bearing, not defensive: it is how `CardStore.update` refuses an edit
 * that would delete the very deletion the row asks about, and how the archive
 * parser rejects a cloze row whose number its own template does not contain.
 */
export function renderClozeCard(
  text: string,
  number: number,
): { front: string; back: string } | null {
  const runs = findClozeRuns(text);
  if (!runs.some((run) => run.number === number)) return null;
  return {
    front: renderClozeSide(text, runs, number).trim(),
    back: renderClozeSide(text, runs, null).trim(),
  };
}

/**
 * One piece of a cloze line: ordinary text, or one of the deletions this card
 * asks about, carrying its answer.
 */
export type ClozeSegment =
  | { kind: "text"; value: string }
  | { kind: "target"; value: string };

/**
 * Deletion `number`'s line, split so a renderer can show the blank and the
 * answer IN THE SAME PLACE: every other run is already unwrapped into the
 * surrounding `text` segments, and each `target` segment carries the answer for
 * the caller to render either as a blank chip (before reveal) or as the answer
 * itself (after). A number carried by two runs yields two target segments — one
 * card, two blanks. Empty text segments are dropped rather than emitted.
 *
 * `null` when `number` names no deletion — the caller falls back to the row's
 * stored `front`/`back`, which are plain strings and always renderable.
 */
export function splitClozeSegments(text: string, number: number): ClozeSegment[] | null {
  const runs = findClozeRuns(text);
  if (!runs.some((run) => run.number === number)) return null;

  const segments: ClozeSegment[] = [];
  // Everything between two targets — plain text and the non-target runs
  // unwrapped in place — accumulates here and is flushed as ONE text segment,
  // which is what keeps the context on the same line as the blank.
  let pending = "";
  let cursor = 0;
  const flush = (): void => {
    if (pending.length > 0) segments.push({ kind: "text", value: pending });
    pending = "";
  };

  for (const run of runs) {
    pending += text.slice(cursor, run.start);
    cursor = run.end;
    if (run.number === number) {
      flush();
      segments.push({ kind: "target", value: run.inner });
    } else {
      pending += run.inner;
    }
  }
  pending += text.slice(cursor);
  flush();

  return segments;
}

/**
 * The number a NEW deletion added to `text` must carry: one past the HIGHEST
 * number already in it (1 when it has none).
 *
 * One past the highest, never the lowest unused: a number freed by deleting a
 * blank still belongs to whatever review history that blank had, and handing it
 * to a new blank is precisely the silent history swap explicit numbering exists
 * to prevent.
 */
export function nextClozeNumber(text: string): number {
  return findClozeRuns(text).reduce((max, run) => Math.max(max, run.number), 0) + 1;
}

/** One text insertion: the string to put at this offset of the ORIGINAL text. */
export interface ClozeEdit {
  at: number;
  text: string;
}

/**
 * The edits that add a deletion around `[from, to)` — the answer the author
 * selected, or an empty deletion at a caret when the two are equal — and, in
 * the same act, spell out the number of every run that carries no label yet.
 *
 * Materialising is safe by construction: by the one closed rule an unlabelled
 * run's number IS its position + 1, so writing that number down changes no
 * card's identity — while leaving it implicit would let the NEW deletion, which
 * takes `nextClozeNumber`, shift every later run onto a different card.
 *
 * Returned DESCENDING by offset, so a caller can apply them in order — to a
 * string or to a ProseMirror transaction — without re-mapping anything behind
 * them. `null` when the range overlaps an existing run (a deletion cannot nest,
 * and a caret inside one is the same refusal), falls outside the text, or would
 * need a number past `MAX_CLOZE_NUMBER` — a label this grammar could not read
 * back is worse than no new deletion at all.
 */
export function clozeDeletionEdits(text: string, from: number, to: number): ClozeEdit[] | null {
  if (!Number.isInteger(from) || !Number.isInteger(to)) return null;
  if (from < 0 || to < from || to > text.length) return null;

  const runs = findClozeRuns(text);
  // Half-open overlap, which is also what refuses a caret INSIDE a run while
  // allowing one flush against either of its ends.
  if (runs.some((run) => from < run.end && to > run.start)) return null;

  const number = nextClozeNumber(text);
  if (number > MAX_CLOZE_NUMBER) return null;
  const opening = `{{c${number}::`;
  const label = (run: ClozeRun): ClozeEdit => ({ at: run.start + 2, text: `c${run.number}::` });
  const unlabelled = runs.filter((run) => run.label === null);

  // Every run is wholly before `from` or wholly after `to` — the overlap check
  // above leaves no third case — so the two halves need no sort between them.
  return [
    ...unlabelled.filter((run) => run.start >= to).reverse().map(label),
    { at: to, text: "}}" },
    { at: from, text: opening },
    ...unlabelled.filter((run) => run.end <= from).reverse().map(label),
  ];
}

/**
 * `clozeDeletionEdits` applied to the string itself, with the new answer's
 * range in the RESULT — what a plain `<textarea>` needs to put the caret back
 * where the author was typing. `null` on exactly the terms the edits are.
 */
export function withClozeDeletion(
  text: string,
  from: number,
  to: number,
): { text: string; from: number; to: number } | null {
  const edits = clozeDeletionEdits(text, from, to);
  if (edits === null) return null;

  let result = text;
  for (const edit of edits) {
    result = result.slice(0, edit.at) + edit.text + result.slice(edit.at);
  }
  // What moves the answer: the labels materialised BEFORE it (each sits at its
  // run's `start + 2`, strictly inside a run that ends at or before `from`),
  // plus the opening this call inserted at `from` itself. The closing `}}`
  // never does, not even when the selection was empty and it shares `from`'s
  // offset — it is applied first and the opening then pushes it right.
  const opening = edits.find((edit) => edit.at === from && edit.text.startsWith("{{"));
  const offset =
    edits
      .filter((edit) => edit.at < from)
      .reduce((total, edit) => total + edit.text.length, 0) + (opening?.text.length ?? 0);
  return { text: result, from: from + offset, to: to + offset };
}
