/**
 * What the scanner answers with, from what the OCR engine reported: the lines,
 * each with its confidence, and the two figures the page shows about them.
 *
 * **Why a confidence is shown at all, and why per line.** A reader of an OCR
 * result has one real question about it - "which part of this do I have to
 * check?" - and a single number for the page answers it for nobody: an average
 * of 88 hides the one line that came back as `1.234,5O`. Tesseract reports a
 * confidence per line, so this keeps them, and the page marks the ones under
 * `LOW_CONFIDENCE_LEVEL` rather than showing fifty numbers.
 *
 * **The level is a presentation choice, not a measurement.** 80 is where this
 * module draws the line between "read it and move on" and "look at this one";
 * it is a single constant so the marked lines, the count and the tests cannot
 * disagree about which lines are uncertain. It is deliberately NOT applied to
 * the text that goes into a note - the note carries what the scan really says,
 * with no markup and no second copy of the module's opinion about it.
 */

/**
 * The first confidence that counts as confident: a line is marked when its
 * confidence is BELOW this. Ninety-ish is the usual reading for a clean scan,
 * so the level sits under the healthy range and over obvious noise.
 */
export const LOW_CONFIDENCE_LEVEL = 80;

/** One recognised line. */
export interface ScanLine {
  readonly text: string;
  /** 0..100, clamped: tesseract reports -1 for a line it could not score. */
  readonly confidence: number;
  /** `confidence < level` - what the page marks, and the only thing it marks. */
  readonly low: boolean;
}

/** Everything one recognition produced, ready for the page. */
export interface ScanOutcome {
  /** The lines joined with `\n` - exactly the text "Kopiraj" puts on the clipboard and "Sačuvaj" sends to main. */
  readonly text: string;
  /** The unweighted mean of the line confidences, rounded; 0 for no lines. */
  readonly confidence: number;
  readonly lines: readonly ScanLine[];
  readonly lowCount: number;
}

/** What the engine reports per line - the shape tesseract's `Page.lines` items satisfy. */
export interface RecognisedLine {
  readonly text: string;
  readonly confidence: number;
}

/**
 * A recognised page, as far as this module reads it: the engine nests its lines
 * two levels down (`Page.blocks[].paragraphs[].lines[]`), and every level of that
 * nesting can be absent - tesseract answers `blocks: null` for a page it could
 * not lay out, and a paragraph with no lines is a paragraph with no text.
 */
export interface RecognisedPage {
  readonly blocks:
    | readonly {
        readonly paragraphs?: readonly { readonly lines?: readonly RecognisedLine[] }[] | null;
      }[]
    | null;
}

/**
 * Every line of one page, in reading order.
 *
 * The flattening lives here rather than in the session glue for the reason the
 * rest of this file does: the nesting is where a line's confidence is lost by
 * mistake (`data.text` has none at all), and a walk that skipped a level would
 * be a page of text with no marks on it - invisible in any screenshot of the
 * page, and exactly what a test on a hand-built page pins.
 */
export function pageLines(page: RecognisedPage): RecognisedLine[] {
  const lines: RecognisedLine[] = [];
  for (const block of page.blocks ?? []) {
    for (const paragraph of block.paragraphs ?? []) {
      for (const line of paragraph.lines ?? []) lines.push(line);
    }
  }
  return lines;
}

/**
 * Reads the engine's lines completely, once.
 *
 * Blank lines are dropped rather than shown: tesseract emits them for the
 * space between two blocks, and a row of nothing with a confidence chip beside
 * it is a row a reader has to decide about for no reason. Whitespace INSIDE a
 * line is left exactly as recognised - "1.234,50 RSD" is two words, not one -
 * and only the outer ends are trimmed, which is a difference no reading of the
 * text can see and a difference in every copy of it can.
 */
export function scanOutcome(
  lines: readonly RecognisedLine[],
  level: number = LOW_CONFIDENCE_LEVEL,
): ScanOutcome {
  const kept: ScanLine[] = [];
  for (const line of lines) {
    const text = line.text.trim();
    if (text.length === 0) continue;
    const confidence = clampConfidence(line.confidence);
    kept.push({ text, confidence, low: confidence < level });
  }
  if (kept.length === 0) return { text: "", confidence: 0, lines: [], lowCount: 0 };
  return {
    text: kept.map((line) => line.text).join("\n"),
    // A rounded mean, not a weighted one: every line here is a line of the same
    // page, and weighting by length would let one long confident line hide the
    // short line the user has to check.
    confidence: Math.round(kept.reduce((sum, line) => sum + line.confidence, 0) / kept.length),
    lines: kept,
    lowCount: kept.filter((line) => line.low).length,
  };
}

/** Tesseract's own range is 0..100, and it answers -1 for a line it could not score at all. */
function clampConfidence(confidence: number): number {
  if (!Number.isFinite(confidence)) return 0;
  return Math.min(Math.max(Math.round(confidence), 0), 100);
}

/**
 * The stage of a recognition, as something the page can name.
 *
 * Tesseract reports progress with a status string from a closed set it writes
 * in its own worker (`src/worker-script/`): the core loading, the engine
 * starting, the language data loading, the API initialising, and the
 * recognition itself. Those strings are the library's internals, so they are
 * NOT shown: each is mapped to one of these phases and the page draws the
 * phase's own sentence in the active language. An unrecognised status is
 * `"other"`, which is the honest reading of a stage this build does not know
 * rather than a blank progress line.
 */
export type ScanPhase = "core" | "init" | "languages" | "api" | "text" | "other";

/** The phase one tesseract progress status belongs to. */
export function scanPhase(status: string): ScanPhase {
  switch (status) {
    case "loading tesseract core":
      return "core";
    case "initializing tesseract":
      return "init";
    case "loading language traineddata":
      return "languages";
    case "initializing api":
      return "api";
    case "recognizing text":
      return "text";
    default:
      return "other";
  }
}
