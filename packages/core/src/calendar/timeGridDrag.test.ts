import { describe, it, expect } from "vitest";
import {
  TIME_GRID_DRAG_THRESHOLD_PX,
  TIME_GRID_MAX_END_MINUTES,
  TIME_GRID_MIN_EVENT_MINUTES,
  TIME_GRID_SNAP_MINUTES,
  exceedsTimeGridDragThreshold,
  resolveTimeGridColumn,
  resolveTimeGridMove,
  resolveTimeGridResize,
  snapTimeGridMinutes,
  timeGridPixelsToMinutes,
} from "./timeGridDrag.js";

/** The grid's own scale in every test below: 44px per hour, the CSS --cal-hour-h. */
const HOUR_PX = 44;

describe("time grid constants", () => {
  it("snaps to a quarter hour and never lets an event end past 23:59", () => {
    expect(TIME_GRID_SNAP_MINUTES).toBe(15);
    expect(TIME_GRID_MIN_EVENT_MINUTES).toBe(15);
    expect(TIME_GRID_MAX_END_MINUTES).toBe(1439);
    expect(TIME_GRID_DRAG_THRESHOLD_PX).toBe(4);
  });
});

describe("timeGridPixelsToMinutes", () => {
  it("converts a pixel offset at a px-per-hour scale", () => {
    expect(timeGridPixelsToMinutes(44, HOUR_PX)).toBe(60);
    expect(timeGridPixelsToMinutes(22, HOUR_PX)).toBe(30);
    expect(timeGridPixelsToMinutes(11, HOUR_PX)).toBe(15);
    expect(timeGridPixelsToMinutes(0, HOUR_PX)).toBe(0);
  });

  it("carries a negative offset (dragging upwards) through unchanged", () => {
    expect(timeGridPixelsToMinutes(-44, HOUR_PX)).toBe(-60);
  });

  it("does not round — snapping is a separate decision", () => {
    expect(timeGridPixelsToMinutes(1, 60)).toBe(1);
    expect(timeGridPixelsToMinutes(1, 44)).toBeCloseTo(60 / 44, 10);
  });

  it("throws TypeError on a scale that cannot describe a grid", () => {
    expect(() => timeGridPixelsToMinutes(10, 0)).toThrow(TypeError);
    expect(() => timeGridPixelsToMinutes(10, -44)).toThrow(TypeError);
    expect(() => timeGridPixelsToMinutes(10, Number.NaN)).toThrow(TypeError);
    expect(() => timeGridPixelsToMinutes(10, Number.POSITIVE_INFINITY)).toThrow(TypeError);
  });

  it("throws TypeError on a non-finite pixel offset", () => {
    expect(() => timeGridPixelsToMinutes(Number.NaN, HOUR_PX)).toThrow(TypeError);
    expect(() => timeGridPixelsToMinutes(Number.POSITIVE_INFINITY, HOUR_PX)).toThrow(TypeError);
  });
});

describe("snapTimeGridMinutes", () => {
  it("snaps to the nearest quarter hour", () => {
    expect(snapTimeGridMinutes(0)).toBe(0);
    expect(snapTimeGridMinutes(7)).toBe(0);
    expect(snapTimeGridMinutes(7.5)).toBe(15);
    expect(snapTimeGridMinutes(8)).toBe(15);
    expect(snapTimeGridMinutes(22)).toBe(15);
    expect(snapTimeGridMinutes(23)).toBe(30);
    expect(snapTimeGridMinutes(540)).toBe(540);
  });

  it("snaps negatives the same way (clamping is the resolvers' job)", () => {
    expect(snapTimeGridMinutes(-7)).toBe(-0);
    expect(snapTimeGridMinutes(-8)).toBe(-15);
    expect(snapTimeGridMinutes(-100)).toBe(-105);
  });

  it("throws TypeError on a non-finite value", () => {
    expect(() => snapTimeGridMinutes(Number.NaN)).toThrow(TypeError);
    expect(() => snapTimeGridMinutes(Number.NEGATIVE_INFINITY)).toThrow(TypeError);
  });
});

describe("exceedsTimeGridDragThreshold", () => {
  it("is false until the pointer has travelled past 4px", () => {
    expect(exceedsTimeGridDragThreshold(0, 0)).toBe(false);
    expect(exceedsTimeGridDragThreshold(4, 0)).toBe(false);
    expect(exceedsTimeGridDragThreshold(0, -4)).toBe(false);
    expect(exceedsTimeGridDragThreshold(2, 2)).toBe(false); // 2.83px
  });

  it("is true past it, in any direction", () => {
    expect(exceedsTimeGridDragThreshold(5, 0)).toBe(true);
    expect(exceedsTimeGridDragThreshold(0, -5)).toBe(true);
    expect(exceedsTimeGridDragThreshold(-3, 3)).toBe(true); // 4.24px
  });

  it("never arms a drag on a non-finite delta", () => {
    expect(exceedsTimeGridDragThreshold(Number.NaN, 0)).toBe(false);
    expect(exceedsTimeGridDragThreshold(0, Number.NaN)).toBe(false);
  });
});

describe("resolveTimeGridMove", () => {
  it("snaps the start and preserves the duration", () => {
    expect(resolveTimeGridMove({ startMinutes: 540, endMinutes: 600 }, 545)).toEqual({
      startMinutes: 540,
      endMinutes: 600,
    });
    expect(resolveTimeGridMove({ startMinutes: 540, endMinutes: 600 }, 548)).toEqual({
      startMinutes: 555,
      endMinutes: 615,
    });
  });

  it("moves an event with no end as a point — only the start shifts", () => {
    expect(resolveTimeGridMove({ startMinutes: 540, endMinutes: null }, 550)).toEqual({
      startMinutes: 555,
      endMinutes: null,
    });
  });

  it("keeps a fractional proposal (a raw pixel conversion) on the grid", () => {
    expect(resolveTimeGridMove({ startMinutes: 540, endMinutes: 570 }, 547.6)).toEqual({
      startMinutes: 555,
      endMinutes: 585,
    });
  });

  it("clamps to the top of the day", () => {
    expect(resolveTimeGridMove({ startMinutes: 540, endMinutes: 600 }, -100)).toEqual({
      startMinutes: 0,
      endMinutes: 60,
    });
  });

  it("clamps the start so the whole span still fits inside the day", () => {
    // A 60-minute event: the last start that leaves a representable end
    // (<= 23:59) on the 15-minute grid is 22:45.
    expect(resolveTimeGridMove({ startMinutes: 540, endMinutes: 600 }, 1400)).toEqual({
      startMinutes: 1365,
      endMinutes: 1425,
    });
  });

  it("clamps a point event to the last quarter hour of the day", () => {
    expect(resolveTimeGridMove({ startMinutes: 540, endMinutes: null }, 1500)).toEqual({
      startMinutes: 1425,
      endMinutes: null,
    });
  });

  it("treats a zero-length span as a point that keeps its end", () => {
    expect(resolveTimeGridMove({ startMinutes: 540, endMinutes: 540 }, 1500)).toEqual({
      startMinutes: 1425,
      endMinutes: 1425,
    });
  });

  it("treats an end before its start (which the store forbids) as a point rather than throwing mid-drag", () => {
    expect(resolveTimeGridMove({ startMinutes: 600, endMinutes: 550 }, 300)).toEqual({
      startMinutes: 300,
      endMinutes: 300,
    });
  });

  it("never emits an end past the last minute of the day, even for an absurdly long span", () => {
    const moved = resolveTimeGridMove({ startMinutes: 0, endMinutes: 2000 }, 900);
    expect(moved.startMinutes).toBe(0);
    expect(moved.endMinutes).toBe(TIME_GRID_MAX_END_MINUTES);
  });

  it("throws TypeError on a non-finite span or proposal", () => {
    expect(() => resolveTimeGridMove({ startMinutes: Number.NaN, endMinutes: 600 }, 540)).toThrow(
      TypeError,
    );
    expect(() =>
      resolveTimeGridMove({ startMinutes: 540, endMinutes: Number.POSITIVE_INFINITY }, 540),
    ).toThrow(TypeError);
    expect(() => resolveTimeGridMove({ startMinutes: 540, endMinutes: 600 }, Number.NaN)).toThrow(
      TypeError,
    );
  });
});

describe("resolveTimeGridResize", () => {
  it("snaps the end and leaves the start alone", () => {
    expect(resolveTimeGridResize(540, 620)).toBe(615);
    expect(resolveTimeGridResize(540, 611)).toBe(615);
  });

  it("enforces the 15-minute minimum duration", () => {
    expect(resolveTimeGridResize(540, 545)).toBe(555);
    expect(resolveTimeGridResize(540, 540)).toBe(555);
    expect(resolveTimeGridResize(540, 100)).toBe(555);
  });

  it("cannot cross midnight — the end stops at the last representable minute", () => {
    expect(resolveTimeGridResize(540, 2000)).toBe(TIME_GRID_MAX_END_MINUTES);
    expect(resolveTimeGridResize(540, 1436)).toBe(TIME_GRID_MAX_END_MINUTES);
    expect(resolveTimeGridResize(540, 1425)).toBe(1425);
  });

  it("lets midnight win over the minimum for a start too late to fit one", () => {
    // 23:50 + 15 minutes would be 00:05 tomorrow; a resize never crosses the day.
    expect(resolveTimeGridResize(1430, 1500)).toBe(TIME_GRID_MAX_END_MINUTES);
    expect(resolveTimeGridResize(1430, 1500) - 1430).toBeLessThan(TIME_GRID_MIN_EVENT_MINUTES);
  });

  it("throws TypeError on a non-finite start or proposal", () => {
    expect(() => resolveTimeGridResize(Number.NaN, 600)).toThrow(TypeError);
    expect(() => resolveTimeGridResize(540, Number.NaN)).toThrow(TypeError);
  });
});

describe("resolveTimeGridColumn", () => {
  it("resolves the column under the pointer", () => {
    expect(resolveTimeGridColumn(100, 100, 700, 7)).toBe(0);
    expect(resolveTimeGridColumn(250, 100, 700, 7)).toBe(1);
    expect(resolveTimeGridColumn(799, 100, 700, 7)).toBe(6);
  });

  it("clamps a pointer that left the grid to its nearest edge column", () => {
    expect(resolveTimeGridColumn(-500, 100, 700, 7)).toBe(0);
    expect(resolveTimeGridColumn(5000, 100, 700, 7)).toBe(6);
    expect(resolveTimeGridColumn(800, 100, 700, 7)).toBe(6);
  });

  it("always resolves to the only column of a day view", () => {
    expect(resolveTimeGridColumn(-50, 100, 700, 1)).toBe(0);
    expect(resolveTimeGridColumn(5000, 100, 700, 1)).toBe(0);
  });

  it("resolves a collapsed rect to the first column rather than dividing by zero", () => {
    expect(resolveTimeGridColumn(120, 100, 0, 7)).toBe(0);
    expect(resolveTimeGridColumn(120, 100, -10, 7)).toBe(0);
  });

  it("throws TypeError on a column count that is not a positive integer", () => {
    expect(() => resolveTimeGridColumn(120, 100, 700, 0)).toThrow(TypeError);
    expect(() => resolveTimeGridColumn(120, 100, 700, -1)).toThrow(TypeError);
    expect(() => resolveTimeGridColumn(120, 100, 700, 2.5)).toThrow(TypeError);
  });

  it("throws TypeError on non-finite geometry", () => {
    expect(() => resolveTimeGridColumn(Number.NaN, 100, 700, 7)).toThrow(TypeError);
    expect(() => resolveTimeGridColumn(120, Number.NaN, 700, 7)).toThrow(TypeError);
    expect(() => resolveTimeGridColumn(120, 100, Number.NaN, 7)).toThrow(TypeError);
  });
});
