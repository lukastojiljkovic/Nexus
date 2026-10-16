import { describe, expect, it } from "vitest";
import { DOCK_WIDTH, FOLLOW_SLACK_PX, clampDockWidth, isNearBottom, locationTiming } from "./dockRules.js";

/**
 * A DOCKED ASSISTANT OPENS ITS PLACES WHEN THEY ARRIVE, AND A FULL PAGE WAITS.
 *
 * The two rules fire for the same place, so a docked turn that also kept the
 * end-of-turn rule would open the place twice. One helper states which rule is
 * in force, and this pins both answers.
 */
describe("when a turn's place opens", () => {
  it("opens as the result arrives when the assistant is docked, because the turn carries on", () => {
    expect(locationTiming(true)).toBe("as-it-arrives");
  });

  it("waits for the end of the turn on the full page, because leaving it would stop the turn", () => {
    expect(locationTiming(false)).toBe("at-turn-end");
  });
});

describe("the dock's width", () => {
  it("holds a width inside its bounds", () => {
    expect(clampDockWidth(DOCK_WIDTH.min - 100)).toBe(DOCK_WIDTH.min);
    expect(clampDockWidth(DOCK_WIDTH.max + 100)).toBe(DOCK_WIDTH.max);
    expect(clampDockWidth(400.4)).toBe(400);
  });
});

/**
 * THE THREAD FOLLOWS THE STREAM UNTIL THE READER SCROLLS UP.
 *
 * The page reads this on each scroll event: a reader who is within the slack of
 * the bottom is following the answer, and one who has moved up is reading
 * something above it and must not be pulled back down.
 */
describe("the thread's follow", () => {
  it("counts a thread scrolled to its bottom as following", () => {
    expect(isNearBottom({ scrollTop: 500, scrollHeight: 800, clientHeight: 300 })).toBe(true);
  });

  it("counts a thread within the slack of its bottom as following", () => {
    const scrollTop = 500 - FOLLOW_SLACK_PX + 1;
    expect(isNearBottom({ scrollTop, scrollHeight: 800, clientHeight: 300 })).toBe(true);
  });

  it("stops following once the reader has scrolled up past the slack", () => {
    expect(isNearBottom({ scrollTop: 100, scrollHeight: 800, clientHeight: 300 })).toBe(false);
  });
});
