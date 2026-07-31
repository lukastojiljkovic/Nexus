import { describe, expect, it } from "vitest";

import type { ExamType, StudyLogDay } from "../../shared/ipc.js";
import { STUDY_LOG_WINDOW_DAYS, studyLogExamLabels, studyLogFacts } from "./studyLog.js";

/**
 * `studyLog.ts` is pure and reads its wording from `strings.ts`, so the Serbian
 * text is asserted verbatim — these ARE the lines the subject panel draws.
 */

/** A day with nothing on it; each test turns on only the fields it is about. */
function day(fields: Partial<StudyLogDay> = {}): StudyLogDay {
  return {
    day: "2026-07-08",
    reviews: 0,
    focusMinutes: 0,
    plannedMinutes: 0,
    examIds: [],
    ...fields,
  };
}

describe("STUDY_LOG_WINDOW_DAYS", () => {
  it("is the 60-day page the store is asked for and „Prikaži još“ adds", () => {
    expect(STUDY_LOG_WINDOW_DAYS).toBe(60);
  });
});

describe("studyLogFacts", () => {
  it("says nothing about a day that holds only an exam", () => {
    expect(studyLogFacts(day({ examIds: ["exam-1"] }))).toEqual([]);
  });

  it("counts reviews with all three Serbian forms", () => {
    expect(studyLogFacts(day({ reviews: 1 }))).toEqual(["1 ponavljanje"]);
    expect(studyLogFacts(day({ reviews: 3 }))).toEqual(["3 ponavljanja"]);
    expect(studyLogFacts(day({ reviews: 5 }))).toEqual(["5 ponavljanja"]);
    expect(studyLogFacts(day({ reviews: 11 }))).toEqual(["11 ponavljanja"]);
    expect(studyLogFacts(day({ reviews: 21 }))).toEqual(["21 ponavljanje"]);
  });

  it("labels focus time with the shared duration formatter", () => {
    expect(studyLogFacts(day({ focusMinutes: 45 }))).toEqual(["45 min fokusa"]);
    expect(studyLogFacts(day({ focusMinutes: 65 }))).toEqual(["1 h 5 min fokusa"]);
  });

  it("prefixes the planned minutes with „plan“", () => {
    expect(studyLogFacts(day({ plannedMinutes: 30 }))).toEqual(["plan 30 min"]);
  });

  it("keeps the three facts in reading order", () => {
    expect(
      studyLogFacts(day({ reviews: 5, focusMinutes: 45, plannedMinutes: 30, examIds: ["e"] })),
    ).toEqual(["5 ponavljanja", "45 min fokusa", "plan 30 min"]);
  });

  it("omits every fact that did not happen", () => {
    expect(studyLogFacts(day())).toEqual([]);
    expect(studyLogFacts(day({ focusMinutes: 20 }))).toEqual(["20 min fokusa"]);
  });
});

describe("studyLogExamLabels", () => {
  const types = new Map<string, ExamType>([
    ["exam-1", "pismeni"],
    ["exam-2", "kolokvijum"],
  ]);

  it("names each exam by its type, in the order given, keyed by its id", () => {
    expect(studyLogExamLabels(["exam-2", "exam-1"], types)).toEqual([
      { id: "exam-2", label: "Ispit: Kolokvijum" },
      { id: "exam-1", label: "Ispit: Pismeni" },
    ]);
  });

  it("keeps the milestone for an exam the page cannot resolve", () => {
    expect(studyLogExamLabels(["gone"], types)).toEqual([{ id: "gone", label: "Ispit" }]);
  });

  it("is empty for a day with no exam", () => {
    expect(studyLogExamLabels([], types)).toEqual([]);
  });
});
