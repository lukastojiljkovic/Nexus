import { describe, expect, it } from "vitest";
import { LOW_CONFIDENCE_LEVEL, pageLines, scanOutcome, scanPhase } from "./ocrResult.js";

/**
 * The result shaping, on confidences and lines whose expected values are the
 * arithmetic written beside them.
 */

describe("scanOutcome", () => {
  it("keeps the lines in the engine's order, their confidences and their marks", () => {
    const outcome = scanOutcome([
      { text: "Prvi red", confidence: 92 },
      { text: "   ", confidence: 40 },
      { text: "Drugi red", confidence: 61 },
    ]);

    // The blank line is dropped; the other two keep the order they came in.
    expect(outcome.lines).toEqual([
      { text: "Prvi red", confidence: 92, low: false },
      { text: "Drugi red", confidence: 61, low: true },
    ]);
    expect(outcome.text).toBe("Prvi red\nDrugi red");
    // (92 + 61) / 2 = 76.5 -> 77
    expect(outcome.confidence).toBe(77);
    expect(outcome.lowCount).toBe(1);
  });

  it("trims a line's outer whitespace and keeps the whitespace inside it", () => {
    const outcome = scanOutcome([{ text: "  Ukupno 1.234,50 RSD  ", confidence: 95 }]);
    expect(outcome.text).toBe("Ukupno 1.234,50 RSD");
  });

  it("counts the level itself as confident - a line is marked only BELOW it", () => {
    const outcome = scanOutcome(
      [
        { text: "tačno na nivou", confidence: LOW_CONFIDENCE_LEVEL },
        { text: "ispod nivoa", confidence: LOW_CONFIDENCE_LEVEL - 1 },
      ],
      LOW_CONFIDENCE_LEVEL,
    );
    expect(outcome.lines.map((line) => line.low)).toEqual([false, true]);
  });

  it("clamps the -1 tesseract reports for an unscored line, so it counts as uncertain", () => {
    const outcome = scanOutcome([{ text: "???", confidence: -1 }]);
    expect(outcome.lines).toEqual([{ text: "???", confidence: 0, low: true }]);
    expect(outcome.confidence).toBe(0);
  });

  it("answers an empty page with nothing rather than a zero-length line", () => {
    expect(scanOutcome([])).toEqual({ text: "", confidence: 0, lines: [], lowCount: 0 });
    expect(scanOutcome([{ text: "\n", confidence: 10 }])).toEqual({
      text: "",
      confidence: 0,
      lines: [],
      lowCount: 0,
    });
  });
});

describe("scanPhase", () => {
  it("maps every status tesseract's worker reports to the phase the page names", () => {
    // The five strings are read off `src/worker-script/index.js` and
    // `src/worker-script/browser/getCore.js` of tesseract.js 7.0.0.
    expect(scanPhase("loading tesseract core")).toBe("core");
    expect(scanPhase("initializing tesseract")).toBe("init");
    expect(scanPhase("loading language traineddata")).toBe("languages");
    expect(scanPhase("initializing api")).toBe("api");
    expect(scanPhase("recognizing text")).toBe("text");
  });

  it("answers a status this build does not know with the honest generic phase", () => {
    expect(scanPhase("polishing the lens")).toBe("other");
    expect(scanPhase("")).toBe("other");
  });
});

describe("pageLines", () => {
  it("walks the engine's nesting into one list, in reading order", () => {
    const page = {
      blocks: [
        { paragraphs: [{ lines: [{ text: "prvi", confidence: 90 }] }, { lines: [{ text: "drugi", confidence: 80 }] }] },
        { paragraphs: [{ lines: [{ text: "treci", confidence: 70 }] }] },
      ],
    };
    expect(pageLines(page).map((line) => line.text)).toEqual(["prvi", "drugi", "treci"]);
  });

  it("answers an empty list for a page the engine could not lay out", () => {
    expect(pageLines({ blocks: null })).toEqual([]);
    expect(pageLines({ blocks: [] })).toEqual([]);
    // A block with no paragraphs, and a paragraph with no lines: both are
    // "nothing here", not a crash halfway through the walk.
    expect(pageLines({ blocks: [{}, { paragraphs: [{}, { lines: [] }] }] })).toEqual([]);
  });
});
