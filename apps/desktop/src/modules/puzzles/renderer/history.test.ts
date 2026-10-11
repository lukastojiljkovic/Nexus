import { describe, expect, it } from "vitest";
import {
  MAX_HISTORY,
  canRedo,
  canUndo,
  createHistory,
  push,
  redo,
  undo,
} from "./history.js";

/**
 * The step-back stack, checked by walking one and asserting the whole value at
 * each step — the past, the present and the future — rather than only the state
 * that comes back. „It returned 1" is satisfied by a stack that has quietly lost
 * the branch it stepped back from, and that is the half every editor gets wrong.
 */
describe("the undo/redo stack", () => {
  it("walks forward, back and forward again with the whole value stated each time", () => {
    let history = createHistory("a");
    expect(history).toEqual({ past: [], present: "a", future: [] });
    expect(canUndo(history)).toBe(false);
    expect(canRedo(history)).toBe(false);

    history = push(history, "b");
    history = push(history, "c");
    expect(history).toEqual({ past: ["a", "b"], present: "c", future: [] });

    history = undo(history);
    expect(history).toEqual({ past: ["a"], present: "b", future: ["c"] });
    expect(canRedo(history)).toBe(true);

    history = redo(history);
    expect(history).toEqual({ past: ["a", "b"], present: "c", future: [] });

    history = undo(history);
    history = undo(history);
    expect(history).toEqual({ past: [], present: "a", future: ["b", "c"] });
    // Stepping back from the oldest state is a no-op rather than an error: the
    // button that does it is disabled, and a value that threw would be a page
    // that broke on a click it had already refused.
    expect(undo(history)).toBe(history);

    // A new step after an undo drops the branch: there is one future, and it is
    // the one the next steps make.
    history = push(history, "d");
    expect(history).toEqual({ past: ["a"], present: "d", future: [] });
    expect(canRedo(history)).toBe(false);
    expect(redo(history)).toBe(history);
  });

  it("drops the OLDEST step when the stack is full, so a long game stays bounded", () => {
    let history = createHistory(0);
    for (let step = 1; step <= MAX_HISTORY + 5; step += 1) history = push(history, step);
    expect(history.present).toBe(MAX_HISTORY + 5);
    expect(history.past).toHaveLength(MAX_HISTORY);
    // The oldest five states (0..4) fell off; 5 is now the furthest back.
    expect(history.past[0]).toBe(5);
    let walked = history;
    for (let step = 0; step < MAX_HISTORY; step += 1) walked = undo(walked);
    expect(walked.present).toBe(5);
    expect(canUndo(walked)).toBe(false);
  });
});
