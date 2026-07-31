import { describe, expect, it } from "vitest";
import {
  CLOZE_MASK,
  MAX_CLOZE_NUMBER,
  clozeDeletionEdits,
  clozeNumbers,
  findClozeRuns,
  nextClozeNumber,
  renderClozeCard,
  renderClozeSide,
  splitClozeSegments,
  withClozeDeletion,
} from "./clozeText.js";

describe("findClozeRuns", () => {
  it("finds every non-overlapping run, left to right, with its offsets and inner text", () => {
    const text = "Glavni grad je {{Beograd}}, a reka je {{Sava}}.";
    expect(findClozeRuns(text)).toEqual([
      { start: 15, end: 26, answerStart: 17, inner: "Beograd", label: null, number: 1 },
      { start: 38, end: 46, answerStart: 40, inner: "Sava", label: null, number: 2 },
    ]);
  });

  it("ignores a run whose inner text is empty or whitespace-only", () => {
    expect(findClozeRuns("a {{}} b {{   }} c")).toEqual([]);
  });

  it("returns nothing for text with no run at all", () => {
    expect(findClozeRuns("obična rečenica")).toEqual([]);
  });

  it("does not nest: `[^{}]*` refuses the outer pair and the INNER run is the deletion", () => {
    // The outer `{{` cannot reach a `}}` without crossing a brace, so the scan
    // moves on and matches `{{b}}`. Nesting is not a feature — this pins which
    // of the two candidate runs a stray nested pair actually yields.
    expect(findClozeRuns("{{a{{b}}c}}").map((run) => run.inner)).toEqual(["b"]);
  });

  it("reads a `cN::` label as the run's number and strips it from the answer", () => {
    expect(findClozeRuns("Glavni grad je {{c1::Beograd}}.")).toEqual([
      { start: 15, end: 30, answerStart: 21, inner: "Beograd", label: 1, number: 1 },
    ]);
  });

  it("numbers a run by its label when it has one and by position + 1 when it does not", () => {
    // The one closed rule, in one line of text: the labels say 3 and 1, the
    // unlabeled run in the middle is the second deletion, so it is 2.
    expect(findClozeRuns("{{c3::a}} {{b}} {{c1::c}}").map((run) => run.number)).toEqual([3, 2, 1]);
  });

  it("lets two runs carry the SAME number — one card with two blanks", () => {
    expect(findClozeRuns("{{c1::a}} i {{c1::b}}").map((run) => run.number)).toEqual([1, 1]);
  });

  it("counts skipped empty runs as if they were not there when numbering by position", () => {
    expect(findClozeRuns("{{}} {{a}} {{  }} {{b}}").map((run) => run.number)).toEqual([1, 2]);
  });

  it("is not a label unless it is exactly `c<positive integer>::`", () => {
    // `c0` names no deletion in Anki either, a leading zero is not a number
    // anyone writes, and `C1`/`c1:` are simply other text. Each stays part of
    // the ANSWER, and the run is numbered by position, exactly as before
    // labels existed.
    const runs = findClozeRuns("{{c0::a}} {{c01::b}} {{C1::c}} {{c1:d}}");
    expect(runs.map((run) => run.inner)).toEqual(["c0::a", "c01::b", "C1::c", "c1:d"]);
    expect(runs.map((run) => run.label)).toEqual([null, null, null, null]);
    expect(runs.map((run) => run.number)).toEqual([1, 2, 3, 4]);
  });

  it("refuses a label of more than six digits rather than parsing an unsafe number", () => {
    const runs = findClozeRuns("{{c1234567::a}}");
    expect(runs[0]?.label).toBeNull();
    expect(runs[0]?.inner).toBe("c1234567::a");
  });

  it("drops a labelled run whose ANSWER is empty, exactly as it drops `{{}}`", () => {
    expect(findClozeRuns("a {{c1::}} b {{c2::   }} c")).toEqual([]);
  });
});

describe("clozeNumbers", () => {
  it("lists a text's distinct numbers in number order, however the labels were written", () => {
    expect(clozeNumbers(findClozeRuns("{{c3::a}} {{c1::b}} {{c3::c}}"))).toEqual([1, 3]);
  });

  it("is 1..n for an unlabelled text — the numbering it always implied", () => {
    expect(clozeNumbers(findClozeRuns("{{a}} i {{b}} i {{c}}"))).toEqual([1, 2, 3]);
  });
});

describe("renderClozeSide", () => {
  const text = "Glavni grad je {{Beograd}}, a reka je {{Sava}}.";
  const runs = findClozeRuns(text);

  it("masks the target run and unwraps every other one", () => {
    expect(renderClozeSide(text, runs, 1)).toBe(`Glavni grad je ${CLOZE_MASK}, a reka je Sava.`);
    expect(renderClozeSide(text, runs, 2)).toBe(`Glavni grad je Beograd, a reka je ${CLOZE_MASK}.`);
  });

  it("unwraps every run when the target is null — the shared back", () => {
    expect(renderClozeSide(text, runs, null)).toBe("Glavni grad je Beograd, a reka je Sava.");
  });

  it("masks EVERY run of the target number — the same card, two blanks", () => {
    const twice = "{{c1::A}} i {{c2::B}} i {{c1::C}}";
    expect(renderClozeSide(twice, findClozeRuns(twice), 1)).toBe(
      `${CLOZE_MASK} i B i ${CLOZE_MASK}`,
    );
  });

  it("strips the label from every unwrapped run", () => {
    const labelled = "{{c2::A}} i {{c1::B}}";
    expect(renderClozeSide(labelled, findClozeRuns(labelled), null)).toBe("A i B");
  });

  it("renders the mask as `[…]`, the form derived text has always used", () => {
    expect(CLOZE_MASK).toBe("[…]");
  });
});

describe("renderClozeCard", () => {
  it("returns the masked front and fully-unwrapped back of one deletion, trimmed", () => {
    expect(renderClozeCard("  {{Ana}} voli {{čaj}}  ", 2)).toEqual({
      front: `Ana voli ${CLOZE_MASK}`,
      back: "Ana voli čaj",
    });
  });

  it("returns null when the number names no deletion in this text", () => {
    expect(renderClozeCard("{{Ana}} voli čaj", 2)).toBeNull();
    expect(renderClozeCard("bez praznina", 1)).toBeNull();
  });

  it("returns null for 0, a negative or a non-integer number rather than guessing", () => {
    // A number is 1-based, so 0 is not "the first deletion" — it is no
    // deletion, which is exactly what a pre-1.26.0 archive's un-upgraded
    // ordinal would say.
    expect(renderClozeCard("{{Ana}} voli čaj", 0)).toBeNull();
    expect(renderClozeCard("{{Ana}} voli čaj", -1)).toBeNull();
    expect(renderClozeCard("{{Ana}} voli čaj", 0.5)).toBeNull();
  });

  it("finds a deletion by its LABEL, not by where it sits", () => {
    expect(renderClozeCard("{{c7::Ana}} voli čaj", 7)).toEqual({
      front: `${CLOZE_MASK} voli čaj`,
      back: "Ana voli čaj",
    });
    expect(renderClozeCard("{{c7::Ana}} voli čaj", 1)).toBeNull();
  });

  it("agrees with `renderClozeSide` — one grammar, two entry points", () => {
    const text = "{{a}} i {{b}} i {{c}}";
    const runs = findClozeRuns(text);
    for (const number of clozeNumbers(runs)) {
      expect(renderClozeCard(text, number)).toEqual({
        front: renderClozeSide(text, runs, number).trim(),
        back: renderClozeSide(text, runs, null).trim(),
      });
    }
  });
});

describe("splitClozeSegments", () => {
  it("splits into plain text around one target segment carrying the answer", () => {
    expect(splitClozeSegments("Glavni grad je {{Beograd}}, a reka je {{Sava}}.", 1)).toEqual([
      { kind: "text", value: "Glavni grad je " },
      { kind: "target", value: "Beograd" },
      { kind: "text", value: ", a reka je Sava." },
    ]);
  });

  it("unwraps every non-target run in place, so the context never leaves the line", () => {
    expect(splitClozeSegments("{{a}} i {{b}} i {{c}}", 2)).toEqual([
      { kind: "text", value: "a i " },
      { kind: "target", value: "b" },
      { kind: "text", value: " i c" },
    ]);
  });

  it("emits one target segment per run of the number — both blanks of one card", () => {
    expect(splitClozeSegments("{{c1::a}} i {{c2::b}} i {{c1::c}}", 1)).toEqual([
      { kind: "target", value: "a" },
      { kind: "text", value: " i b i " },
      { kind: "target", value: "c" },
    ]);
  });

  it("drops empty leading/trailing text segments instead of emitting blanks", () => {
    expect(splitClozeSegments("{{sam}}", 1)).toEqual([{ kind: "target", value: "sam" }]);
  });

  it("returns null when the number names no run — the caller falls back", () => {
    expect(splitClozeSegments("bez praznina", 1)).toBeNull();
    expect(splitClozeSegments("{{a}}", 2)).toBeNull();
  });
});

describe("nextClozeNumber", () => {
  it("is 1 for a text with no deletion at all", () => {
    expect(nextClozeNumber("obična rečenica")).toBe(1);
  });

  it("is one past the HIGHEST number already in the text, never a gap it could reuse", () => {
    // Reusing a freed number is the whole defect this feature exists to
    // prevent: the new blank would inherit the review history of the one the
    // author deleted.
    expect(nextClozeNumber("{{a}} i {{b}}")).toBe(3);
    expect(nextClozeNumber("{{c1::a}} i {{c9::b}}")).toBe(10);
    expect(nextClozeNumber("{{c5::a}}")).toBe(6);
  });
});

describe("clozeDeletionEdits", () => {
  it("wraps the range and spells out every existing run's number, back to front", () => {
    const text = "Ana voli čaj";
    expect(clozeDeletionEdits(text, 9, 12)).toEqual([
      { at: 12, text: "}}" },
      { at: 9, text: "{{c1::" },
    ]);
  });

  it("materialises the labels of an existing unlabelled text in the same act", () => {
    const text = "{{Ana}} voli čaj";
    expect(clozeDeletionEdits(text, 13, 16)).toEqual([
      { at: 16, text: "}}" },
      { at: 13, text: "{{c2::" },
      { at: 2, text: "c1::" },
    ]);
  });

  it("leaves an already-labelled run alone", () => {
    expect(clozeDeletionEdits("{{c4::Ana}} voli čaj", 17, 20)).toEqual([
      { at: 20, text: "}}" },
      { at: 17, text: "{{c5::" },
    ]);
  });

  it("inserts an empty deletion at a caret", () => {
    expect(clozeDeletionEdits("Ana ", 4, 4)).toEqual([
      { at: 4, text: "}}" },
      { at: 4, text: "{{c1::" },
    ]);
  });

  it("refuses a range that overlaps an existing run, or a caret inside one", () => {
    const text = "Ana voli {{čaj}}";
    expect(clozeDeletionEdits(text, 4, 12)).toBeNull();
    expect(clozeDeletionEdits(text, 12, 12)).toBeNull();
    // Flush against a run on either side is not an overlap.
    expect(clozeDeletionEdits(text, 9, 9)).not.toBeNull();
    expect(clozeDeletionEdits(text, 16, 16)).not.toBeNull();
  });

  it("refuses a range outside the text", () => {
    expect(clozeDeletionEdits("Ana", -1, 2)).toBeNull();
    expect(clozeDeletionEdits("Ana", 0, 4)).toBeNull();
    expect(clozeDeletionEdits("Ana", 2, 1)).toBeNull();
  });

  it("refuses rather than write a label the grammar could not read back", () => {
    // `c1000000::` is seven digits, past what a label may carry — written
    // anyway it would come back as ANSWER text on an unlabelled run.
    const maxed = `{{c${MAX_CLOZE_NUMBER}::a}} b`;
    expect(nextClozeNumber(maxed)).toBe(MAX_CLOZE_NUMBER + 1);
    expect(clozeDeletionEdits(maxed, findClozeRuns(maxed)[0]?.end ?? 0, maxed.length)).toBeNull();
  });
});

describe("withClozeDeletion", () => {
  it("applies the edits and reports where the new answer sits", () => {
    expect(withClozeDeletion("Ana voli čaj", 9, 12)).toEqual({
      text: "Ana voli {{c1::čaj}}",
      from: 15,
      to: 18,
    });
  });

  it("keeps every existing card's number across the materialisation", () => {
    const before = "{{Ana}} voli {{čaj}}";
    const after = withClozeDeletion(before, 8, 12);
    expect(after?.text).toBe("{{c1::Ana}} {{c3::voli}} {{c2::čaj}}");
    // The point of the whole feature: the two cards that already existed still
    // render exactly what they rendered, under the same numbers.
    for (const number of clozeNumbers(findClozeRuns(before))) {
      expect(renderClozeCard(after?.text ?? "", number)?.front).toBe(
        renderClozeCard(before, number)?.front,
      );
    }
  });

  it("is null on the terms `clozeDeletionEdits` is", () => {
    expect(withClozeDeletion("Ana voli {{čaj}}", 10, 12)).toBeNull();
  });
});

describe("the unlabelled compatibility bar", () => {
  // A text that uses no labels must behave EXACTLY as it did before labels
  // existed: the same cards, the same sides, the same segments — only read
  // under 1-based numbers rather than 0-based positions.
  const texts = [
    "Glavni grad je {{Beograd}}, a reka je {{Sava}}.",
    "{{a}} i {{b}} i {{c}}",
    "{{sam}}",
    "a {{}} b {{x}} c",
  ];

  it("gives deletion i (0-based) the number i + 1 and nothing else", () => {
    for (const text of texts) {
      const runs = findClozeRuns(text);
      expect(runs.map((run) => run.number)).toEqual(runs.map((_, index) => index + 1));
      expect(runs.every((run) => run.label === null)).toBe(true);
      expect(runs.every((run) => run.answerStart === run.start + 2)).toBe(true);
    }
  });

  it("renders each card's sides from the run at that position, as it always did", () => {
    for (const text of texts) {
      const runs = findClozeRuns(text);
      runs.forEach((run, index) => {
        const card = renderClozeCard(text, index + 1);
        expect(card?.front).toContain(CLOZE_MASK);
        expect(card?.back).not.toContain(CLOZE_MASK);
        // The masked front is the text with exactly THIS run replaced.
        expect(card?.front).toBe(
          (text.slice(0, run.start) + CLOZE_MASK + text.slice(run.end))
            .replace(/\{\{([^{}]*)\}\}/g, (whole, inner: string) =>
              inner.trim().length === 0 ? whole : inner,
            )
            .trim(),
        );
      });
    }
  });
});
