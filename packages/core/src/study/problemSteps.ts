/**
 * The in-band grammar of a problem card's worked solution, and the rendering of
 * that solution into the one plain `back` every other reader already knows how
 * to show (ADR-046).
 *
 * A problem card is NOT a third card kind: it is a `basic` card that also
 * carries `problem_steps`, and a problem card minus its steps IS a basic card.
 * The steps are the SOURCE, exactly as a cloze template is (`clozeText.ts`);
 * `back` is DERIVED from them and kept, so the search index, the palette
 * snippet, the deck list row, the CSV export and every archive reader keep
 * seeing a card with a readable answer without knowing this feature exists.
 *
 * This module is the SINGLE source of that grammar, for every reader:
 *
 *   - `CardStore`, which re-derives `back` on every write,
 *   - the editor's live „N koraka" count, which must never promise a count the
 *     store would not produce, and
 *   - the reviewer, which shows the steps one at a time.
 *
 * Pure and platform-neutral: strings in, strings out, no clock, no IO.
 */

/**
 * What a step boundary is written as. A WHOLE line, not a substring: prose
 * containing `--`, an em-dash sentence, or a longer `---` rule all stay inside
 * the step they were typed in, so the separator can never swallow a solution's
 * own punctuation. Surrounding whitespace on that line is ignored — a trailing
 * space is invisible to whoever typed it, and a `\r\n` archive would otherwise
 * hide every boundary it carries.
 */
export const PROBLEM_STEP_SEPARATOR = "--";

/**
 * The steps of `text`, trimmed, in order, with the empty ones a stray or
 * doubled separator leaves behind dropped rather than emitted as blank steps.
 * A single step is legal — a solution that takes one move is still a worked
 * solution — and text with no step at all yields an empty array, which is how
 * `CardStore` refuses a problem card that has nothing to reveal.
 */
export function splitProblemSteps(text: string): string[] {
  const steps: string[] = [];
  let current: string[] = [];

  const flush = (): void => {
    const step = current.join("\n").trim();
    if (step.length > 0) steps.push(step);
    current = [];
  };

  for (const line of text.split("\n")) {
    if (line.trim() === PROBLEM_STEP_SEPARATOR) flush();
    else current.push(line);
  }
  flush();

  return steps;
}

/**
 * The `back` a problem card stores: its steps in order, separated by a blank
 * line, with every marker stripped. This is the ADR-042 invariant applied to
 * steps — the stored side is derived from the source and can never disagree
 * with it, because the same function that splits the steps renders them.
 */
export function renderProblemBack(text: string): string {
  return splitProblemSteps(text).join("\n\n");
}
