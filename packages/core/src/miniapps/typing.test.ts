import { describe, expect, it } from "vitest";
import {
  TYPING_LAYOUTS,
  TYPING_LESSONS,
  TYPING_PRACTISE_KEYS,
  layoutKeys,
  scoreTypingSession,
  typingKeyPosition,
  type TypingKeystroke,
} from "./typing.js";

/** Every keystroke of `target` typed correctly, one every 100 ms from 100 ms. */
const exact = (target: string): TypingKeystroke[] =>
  [...target].map((typed, index) => ({ atMs: (index + 1) * 100, typed }));

describe("the layouts", () => {
  it("puts every key of the home row where the hardware does", () => {
    // US ANSI, from kbdlayout.info's KBDUS.DLL table: the A row starts under
    // Caps Lock (1.75 key widths in), f under the 4th key of it.
    expect(typingKeyPosition("en-US", "f")).toEqual({ label: "f", row: 2, column: 4.75 });
    expect(typingKeyPosition("en-US", "j")).toEqual({ label: "j", row: 2, column: 7.75 });
    expect(typingKeyPosition("en-US", ";")).toEqual({ label: ";", row: 2, column: 10.75 });
    expect(typingKeyPosition("en-US", "y")).toEqual({ label: "y", row: 1, column: 6.5 });
    expect(typingKeyPosition("en-US", "z")).toEqual({ label: "z", row: 3, column: 2.25 });
    expect(typingKeyPosition("en-US", "1")).toEqual({ label: "1", row: 0, column: 1 });
    expect(typingKeyPosition("en-US", "=")).toEqual({ label: "=", row: 0, column: 12 });
  });

  it("puts the swapped Serbian letters where the QWERTZ layout puts them", () => {
    // Serbian (Latin), KLID 0000081a (KBDYCL.DLL): z takes the US y position and
    // y takes the US z position on the lower row.
    expect(typingKeyPosition("sr-Latn", "z")).toEqual({ label: "z", row: 1, column: 6.5 });
    expect(typingKeyPosition("sr-Latn", "y")).toEqual({ label: "y", row: 3, column: 2.25 });
  });

  it("puts č, ć, ž, š and đ on their Serbian Latin keys", () => {
    // Same table: the home row runs a s d f g h j k l č ć ž, so č sits where the
    // US layout has ";", ć where it has "'", and ž on the extra ISO key right of
    // that. The upper row runs q w e r t z u i o p š đ, so š is where "[" is and
    // đ where "]" is.
    expect(typingKeyPosition("sr-Latn", "č")).toEqual({ label: "č", row: 2, column: 10.75 });
    expect(typingKeyPosition("sr-Latn", "ć")).toEqual({ label: "ć", row: 2, column: 11.75 });
    expect(typingKeyPosition("sr-Latn", "ž")).toEqual({ label: "ž", row: 2, column: 12.75 });
    expect(typingKeyPosition("sr-Latn", "š")).toEqual({ label: "š", row: 1, column: 11.5 });
    expect(typingKeyPosition("sr-Latn", "đ")).toEqual({ label: "đ", row: 1, column: 12.5 });
  });

  it("knows nothing of a key the layout does not carry", () => {
    expect(typingKeyPosition("en-US", "č")).toBeNull();
    expect(typingKeyPosition("sr-Latn", "€")).toBeNull();
  });

  it("keeps every row's keys in one physical order", () => {
    for (const layout of Object.values(TYPING_LAYOUTS)) {
      const rows = [...layout.rows].sort((left, right) => left.row - right.row);
      expect(rows.map((row) => row.row)).toEqual([0, 1, 2, 3]);
      for (const row of layout.rows) {
        row.keys.forEach((key, index) => {
          expect(typingKeyPosition(layout.id, key)?.column).toBe(row.column + index);
        });
      }
    }
  });
});

type TypingLayoutId = keyof typeof TYPING_LAYOUTS;

describe("the lessons", () => {
  it("starts on the home row and moves outwards", () => {
    const shape = (id: TypingLayoutId) =>
      TYPING_LESSONS[id].map(
        (lesson) => typingKeyPosition(id, lesson.keys[0] as string)?.row,
      );
    // Home row (2), then the row above (1), then the row below (3), then the
    // digit row (0), then whatever the last lesson has left.
    expect(shape("en-US")).toEqual([
      2, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1, 3, 3, 3, 3, 3, 0, 0, 0, 0, 0, 0,
    ]);
    expect(shape("sr-Latn")).toEqual([
      2, 2, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 3, 3, 3, 3, 3, 0, 0, 0, 0, 0, 0,
    ]);
  });

  it("introduces the index fingers' home keys first", () => {
    expect(TYPING_LESSONS["en-US"][0]?.keys).toEqual(["f", "j"]);
    expect(TYPING_LESSONS["sr-Latn"][0]?.keys).toEqual(["f", "j"]);
    expect(TYPING_LESSONS["en-US"][1]?.keys).toEqual(["g", "h"]);
  });

  it("teaches every key of its layout exactly once", () => {
    for (const [id, lessons] of Object.entries(TYPING_LESSONS)) {
      const layoutId = id as TypingLayoutId;
      const taught = lessons.flatMap((lesson) => [...lesson.keys]);
      expect(new Set(taught).size).toBe(taught.length);
      expect([...taught].sort()).toEqual([...layoutKeys(layoutId)].sort());
    }
  });

  it("makes each lesson cumulative, so a drill can use everything learned", () => {
    for (const lessons of Object.values(TYPING_LESSONS)) {
      lessons.forEach((lesson, index) => {
        const expected = lessons
          .slice(0, index + 1)
          .flatMap((held) => [...held.keys]);
        expect(lesson.cumulative).toEqual(expected);
      });
      expect(lessons.length).toBeGreaterThan(15);
    }
  });

  it("leaves the five Serbian diacritics for the Serbian layout", () => {
    const serbian = TYPING_LESSONS["sr-Latn"].flatMap((lesson) => [...lesson.keys]);
    for (const key of ["č", "ć", "š", "ž", "đ"]) expect(serbian).toContain(key);
    const english = TYPING_LESSONS["en-US"].flatMap((lesson) => [...lesson.keys]);
    for (const key of ["č", "ć", "š", "ž", "đ"]) expect(english).not.toContain(key);
  });

  it("shares its lesson ids between the layouts", () => {
    const english = TYPING_LESSONS["en-US"].map((lesson) => lesson.id).sort();
    const serbian = TYPING_LESSONS["sr-Latn"].map((lesson) => lesson.id).sort();
    // The Serbian board holds two keys the US board has no lesson for — the
    // home row's twelfth key and the upper row's "š" and "đ" — and those are
    // the only two lessons the two lists do not share.
    expect(serbian.filter((id) => !english.includes(id))).toEqual([
      "home-pinky-reach-2",
      "top-pinky-reach",
    ]);
    expect(english.every((id) => serbian.includes(id))).toBe(true);
    expect(new Set(serbian).size).toBe(serbian.length);
  });
});

describe("scoreTypingSession", () => {
  it("scores a clean minute at the five-character word convention", () => {
    // 60 characters in 60 s = 12 words of five characters per minute; the word
    // convention is the "five characters or keystrokes" one of Wikipedia's
    // Words per minute article.
    const target = "k".repeat(60);
    const score = scoreTypingSession({ target, keystrokes: exact(target) });
    expect(score.typed).toBe(60);
    expect(score.correct).toBe(60);
    expect(score.errors).toBe(0);
    expect(score.accuracy).toBe(1);
    expect(score.durationSeconds).toBeCloseTo(6, 9); // 60 keystrokes 100 ms apart
    expect(score.grossWpm).toBeCloseTo(120, 9);
    expect(score.netWpm).toBeCloseTo(120, 9);
    expect(score.errorKeys).toEqual([]);
    expect(score.practiseKeys).toEqual([]);
  });

  it("charges net speed for wrong characters only", () => {
    // 60 keystrokes one second apart (a minute), the tenth typed "l" for "k":
    // gross (60 / 5) / 1 = 12 WPM, and net counts only the 59 correct ones,
    // (59 / 5) / 1 = 11.8 WPM — net = gross x accuracy.
    const target = "k".repeat(60);
    const keystrokes = [...target].map((typed, index) => ({
      atMs: (index + 1) * 1000,
      typed: index === 9 ? "l" : typed,
    }));
    const score = scoreTypingSession({ target, keystrokes });
    expect(score.durationSeconds).toBe(60);
    expect(score.errors).toBe(1);
    expect(score.accuracy).toBeCloseTo(59 / 60, 12);
    expect(score.grossWpm).toBeCloseTo(12, 9);
    expect(score.netWpm).toBeCloseTo(11.8, 9);
    expect(score.netWpm).toBeCloseTo(score.grossWpm * score.accuracy, 9);
    expect(score.errorKeys).toEqual([{ key: "k", count: 1 }]);
    expect(score.practiseKeys).toEqual(["k"]);
  });

  it("blames the key the target asked for, not the one that was typed", () => {
    const score = scoreTypingSession({
      target: "abc",
      keystrokes: [
        { atMs: 100, typed: "a" },
        { atMs: 200, typed: "x" },
        { atMs: 300, typed: "c" },
      ],
    });
    expect(score.errorKeys).toEqual([{ key: "b", count: 1 }]);
  });

  it("counts keystrokes past the end of the target as errors with no key to blame", () => {
    // 3 characters typed over 0.3 s: gross (3 / 5) / 0.005 min = 120 WPM.
    const score = scoreTypingSession({
      target: "ab",
      keystrokes: [
        { atMs: 100, typed: "a" },
        { atMs: 200, typed: "b" },
        { atMs: 300, typed: "c" },
      ],
    });
    expect(score.typed).toBe(3);
    expect(score.correct).toBe(2);
    expect(score.errors).toBe(1);
    expect(score.errorKeys).toEqual([]);
    expect(score.grossWpm).toBeCloseTo(120, 9);
    expect(score.netWpm).toBeCloseTo(80, 9);
  });

  it("takes a duration the page supplies instead of the last keystroke", () => {
    const score = scoreTypingSession({
      target: "abcde",
      keystrokes: exact("abcde"),
      durationMs: 60_000,
    });
    expect(score.durationSeconds).toBe(60);
    expect(score.grossWpm).toBeCloseTo(1, 9);
  });

  it("reads an empty session as nothing typed, not as a failure", () => {
    expect(scoreTypingSession({ target: "abc", keystrokes: [] })).toMatchObject({
      typed: 0,
      correct: 0,
      errors: 0,
      accuracy: 1,
      durationSeconds: 0,
      grossWpm: 0,
      netWpm: 0,
      errorKeys: [],
      practiseKeys: [],
    });
  });

  it("ranks the keys to practise next by the Serbian collation", () => {
    // Both keys are wrong once, so the tie is broken by the collator: Serbian
    // orders č before d, where a plain code-point sort would put "d" first.
    const score = scoreTypingSession({
      target: "čd",
      keystrokes: [
        { atMs: 100, typed: "x" },
        { atMs: 200, typed: "y" },
      ],
    });
    expect(score.errorKeys).toEqual([
      { key: "č", count: 1 },
      { key: "d", count: 1 },
    ]);
    expect(score.practiseKeys).toEqual(["č", "d"]);
  });

  it("caps the practice list while keeping the worst keys", () => {
    const target = "abcdefg";
    const score = scoreTypingSession({
      target,
      keystrokes: [...target].map((_typed, index) => ({ atMs: (index + 1) * 100, typed: "x" })),
    });
    expect(score.errorKeys).toHaveLength(7);
    expect(score.practiseKeys).toHaveLength(TYPING_PRACTISE_KEYS);
    expect(score.practiseKeys).toEqual(["a", "b", "c", "d", "e", "f"]);
  });

  it("refuses keystroke times that do not run forwards", () => {
    expect(() =>
      scoreTypingSession({ target: "ab", keystrokes: [{ atMs: -1, typed: "a" }] }),
    ).toThrow(RangeError);
    expect(() =>
      scoreTypingSession({
        target: "ab",
        keystrokes: [
          { atMs: 200, typed: "a" },
          { atMs: 100, typed: "b" },
        ],
      }),
    ).toThrow(RangeError);
  });
});
