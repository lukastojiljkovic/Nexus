import { describe, expect, it } from "vitest";
import {
  isGameLogEntry,
  isUndoEntry,
  logCanUndo,
  logMoves,
  logPushUndo,
  logPushMove,
  UNDO_ENTRY,
  type GameLogEntry,
} from "./log.js";

/** A stand-in move vocabulary: the stack's behaviour does not depend on one. */
type Step = { readonly kind: "step"; readonly step: number };
const isStep = (value: unknown): value is Step =>
  typeof value === "object" &&
  value !== null &&
  (value as { kind?: unknown }).kind === "step" &&
  typeof (value as { step?: unknown }).step === "number";

const step = (n: number): Step => ({ kind: "step", step: n });

describe("the action log", () => {
  it("appends without touching the log it was given", () => {
    const empty: readonly GameLogEntry<Step>[] = [];
    const one = logPushMove(empty, step(1));
    const two = logPushUndo(one);
    expect(empty).toEqual([]);
    expect(one).toEqual([{ kind: "step", step: 1 }]);
    expect(two).toEqual([{ kind: "step", step: 1 }, { kind: "undo" }]);
  });

  it("shares the one undo entry, which no game's move vocabulary can be confused with", () => {
    expect(UNDO_ENTRY).toEqual({ kind: "undo" });
    expect(isUndoEntry(UNDO_ENTRY)).toBe(true);
    expect(isUndoEntry(step(1))).toBe(false);
    expect(isUndoEntry({ kind: "undo", step: 1 })).toBe(true);
    expect(isUndoEntry(null)).toBe(false);
  });

  it("reads the live stack by walking the log, not by counting entries", () => {
    // `[1, 2, undo, 3]` leaves 1 and 3 standing. Counting entries would answer
    // „the first two moves", which is the wrong two — and the reason this walks.
    const log: readonly GameLogEntry<Step>[] = [
      step(1),
      step(2),
      UNDO_ENTRY,
      step(3),
    ];
    expect(logMoves(log)).toEqual([step(1), step(3)]);
    expect(logCanUndo(log)).toBe(true);
  });

  it("cannot undo past the beginning, however many undos the log carries", () => {
    const log: readonly GameLogEntry<Step>[] = [UNDO_ENTRY, step(1), UNDO_ENTRY];
    expect(logMoves(log)).toEqual([]);
    expect(logCanUndo(log)).toBe(false);
    expect(logCanUndo([])).toBe(false);
    expect(logMoves([])).toEqual([]);
  });

  it("guards an entry's shape against the move vocabulary it is handed", () => {
    expect(isGameLogEntry(step(2), isStep)).toBe(true);
    expect(isGameLogEntry(UNDO_ENTRY, isStep)).toBe(true);
    expect(isGameLogEntry({ kind: "step", step: "2" }, isStep)).toBe(false);
    expect(isGameLogEntry({ kind: "step" }, isStep)).toBe(false);
    expect(isGameLogEntry({ kind: "redo", step: 1 }, isStep)).toBe(false);
    expect(isGameLogEntry([{ kind: "undo" }], isStep)).toBe(false);
    expect(isGameLogEntry(null, isStep)).toBe(false);
  });
});
