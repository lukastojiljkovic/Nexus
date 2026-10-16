import { describe, expect, it } from "vitest";
import {
  NO_CONFIRMS,
  dropConfirm,
  enqueueConfirm,
  headConfirm,
  type ConfirmAsk,
} from "./confirmQueue.js";

/**
 * TWO QUESTIONS IN ONE STEP ARE BOTH ANSWERABLE.
 *
 * The defect this pins is a hang, not a wrong screen: two write calls in one
 * model step raised two `confirm` events into a single slot, the first question
 * was overwritten, and the tool behind it waited on a promise that nobody could
 * answer - the turn never finished and the page polled forever. `Page.tsx` is not
 * rendered here, so the queue is pinned as the pure thing it is.
 */

const FIRST: ConfirmAsk = {
  requestId: "r1",
  tool: "tasks.create",
  effect: "write",
  summary: "Add the task «Plaćanje».",
};
const SECOND: ConfirmAsk = {
  requestId: "r2",
  tool: "notes.create",
  effect: "write",
  summary: "Add the note «Spisak».",
};

describe("the questions a turn is waiting on", () => {
  it("draws the oldest question, and the next one after it is answered", () => {
    let queue = enqueueConfirm(NO_CONFIRMS, FIRST);
    queue = enqueueConfirm(queue, SECOND);

    expect(headConfirm(queue)).toEqual(FIRST);
    queue = dropConfirm(queue);
    expect(headConfirm(queue)).toEqual(SECOND);
    expect(headConfirm(dropConfirm(queue))).toBeNull();
  });

  it("draws nothing when no tool is asking, and is unchanged by an answer", () => {
    expect(headConfirm(NO_CONFIRMS)).toBeNull();
    expect(dropConfirm(NO_CONFIRMS)).toBe(NO_CONFIRMS);
  });

  it("keeps the questions in the order the tools were asked in", () => {
    // Both requests are parked at the same moment, so the order they are asked in
    // is the order the model wrote the calls in - and the user answers them in
    // the order the tools are actually waiting.
    expect(enqueueConfirm(enqueueConfirm(NO_CONFIRMS, FIRST), SECOND)).toEqual([FIRST, SECOND]);
    // A queue that was handed out is not mutated by the next question: the page
    // holds one in state, and React compares the reference it renders from.
    const held = enqueueConfirm(NO_CONFIRMS, FIRST);
    enqueueConfirm(held, SECOND);
    expect(held).toEqual([FIRST]);
  });
});
