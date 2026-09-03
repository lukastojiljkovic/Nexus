import { describe, expect, it } from "vitest";
import type { SimChannel } from "@nexus/core";

import {
  SIM_PREVIEW_HEIGHT,
  SIM_PREVIEW_PAD,
  SIM_PREVIEW_WIDTH,
  formatSimValue,
  previewPath,
  restingDraft,
  waveFrom,
  wavePreview,
} from "./elecSim.js";

const channel = (over: Partial<SimChannel> = {}): SimChannel => ({
  id: "D9",
  part: "Relej",
  partPin: "IN",
  flow: "actuator",
  unit: "level",
  range: { min: 0, max: 1 },
  topic: undefined,
  ...over,
});

const percent = channel({ unit: "percent", range: { min: 0, max: 100 } });
const volts = channel({ unit: "volts", range: { min: 0, max: 3.3 } });

describe("restingDraft", () => {
  it("opens at the bottom of the range, as a constant", () => {
    expect(restingDraft(percent)).toEqual({
      kind: "constant",
      value: "0",
      from: "0",
      to: "100",
      periodMs: "1000",
      dutyPercent: "50",
      values: "0; 100",
    });
  });

  it("writes the range the way this form reads it back", () => {
    // A Serbian comma, and no thousands grouping — a field holding „3.300"
    // would not parse back to the number it came from.
    const draft = restingDraft(volts);
    expect(draft.to).toBe("3,3");
    expect(waveFrom({ ...draft, kind: "ramp" }, volts)).toEqual({
      kind: "ramp",
      from: 0,
      to: 3.3,
      periodMs: 1000,
    });
  });

  it("fills every field, not only the ones the opening kind uses", () => {
    // Switching kind must never land on an empty form; the draft carries all
    // five fields from the start for exactly that.
    const draft = restingDraft(percent);
    expect(waveFrom({ ...draft, kind: "square" }, percent)).toEqual({
      kind: "square",
      low: 0,
      high: 100,
      periodMs: 1000,
      dutyPercent: 50,
    });
    expect(waveFrom({ ...draft, kind: "steps" }, percent)).toEqual({
      kind: "steps",
      values: [0, 100],
      holdMs: 1000,
    });
  });
});

describe("waveFrom", () => {
  it("reads a Serbian decimal comma", () => {
    const draft = { ...restingDraft(volts), value: "1,25" };
    expect(waveFrom(draft, volts)).toEqual({ kind: "constant", value: 1.25 });
  });

  it("falls back per field, so one cleared box does not reset the rest", () => {
    const draft = { ...restingDraft(percent), kind: "square" as const, periodMs: "", to: "80" };
    expect(waveFrom(draft, percent)).toEqual({
      kind: "square",
      low: 0,
      high: 80, // kept
      periodMs: 1000, // the default, not the channel's range
      dutyPercent: 50,
    });
  });

  it("falls back to the channel's own range rather than to zero", () => {
    const draft = { ...restingDraft(volts), kind: "ramp" as const, from: "", to: "" };
    expect(waveFrom(draft, volts)).toEqual({ kind: "ramp", from: 0, to: 3.3, periodMs: 1000 });
  });

  it("refuses text without throwing", () => {
    const draft = { ...restingDraft(percent), value: "trideset" };
    expect(waveFrom(draft, percent)).toEqual({ kind: "constant", value: 0 });
  });

  it("splits a steps list on semicolons, so a decimal comma still means one number", () => {
    const draft = { ...restingDraft(volts), kind: "steps" as const, values: "0; 1,5; 3,3" };
    expect(waveFrom(draft, volts)).toEqual({
      kind: "steps",
      values: [0, 1.5, 3.3],
      holdMs: 1000,
    });
  });

  it("drops a half-typed entry rather than reading it as a zero", () => {
    // `Number("")` is 0 and not NaN, so a trailing separator would otherwise
    // add a reading the user never typed — on a level channel, a convincing one.
    const of = (values: string): readonly number[] => {
      const wave = waveFrom({ ...restingDraft(percent), kind: "steps", values }, percent);
      return wave.kind === "steps" ? wave.values : [];
    };
    expect(of("10; 20;")).toEqual([10, 20]);
    expect(of("")).toEqual([]);
    expect(of("  ;  ")).toEqual([]);
    expect(of("10; nešto; 30")).toEqual([10, 30]);
  });
});

describe("wavePreview", () => {
  const TOP = SIM_PREVIEW_PAD;
  const FLOOR = SIM_PREVIEW_HEIGHT - SIM_PREVIEW_PAD;

  it("draws a flat line at the top for a constant at the ceiling", () => {
    const points = wavePreview({ kind: "constant", value: 100 }, percent);
    expect(points).toHaveLength(97); // 96 samples, both ends included
    expect(points[0]).toEqual({ x: 0, y: TOP });
    expect(points.at(-1)).toEqual({ x: SIM_PREVIEW_WIDTH, y: TOP });
    expect(points.every((point) => point.y === TOP)).toBe(true);
  });

  it("puts the bottom of the range at the bottom of the box", () => {
    const points = wavePreview({ kind: "constant", value: 0 }, percent);
    expect(points.every((point) => point.y === FLOOR)).toBe(true);
  });

  it("never draws on the boundary, whatever the value", () => {
    // The rule the padding exists for: a stroke centred on the edge is half
    // clipped, and the half that survives reads as the container's border —
    // which is what a resting channel, the state every one of them opens in,
    // would otherwise draw.
    for (const value of [-50, 0, 50, 100, 999]) {
      const points = wavePreview({ kind: "constant", value }, percent);
      expect(points.every((point) => point.y >= TOP && point.y <= FLOOR)).toBe(true);
    }
  });

  it("puts a mid-range value in the middle, flipped for SVG", () => {
    const points = wavePreview({ kind: "constant", value: 50 }, percent);
    expect(points[0]?.y).toBe(SIM_PREVIEW_HEIGHT / 2);
  });

  it("clamps a value the channel cannot carry into the box", () => {
    const points = wavePreview({ kind: "constant", value: 999 }, percent);
    expect(points.every((point) => point.y === TOP)).toBe(true);
  });

  it("rises across the window for a ramp over the whole of it", () => {
    // The preview covers 2 000 ms, so a 2 000 ms ramp fills it exactly: the
    // first sample sits on the floor and the last is one sample short of the
    // ceiling, because 2 000 ms is where the sawtooth starts over.
    const points = wavePreview({ kind: "ramp", from: 0, to: 100, periodMs: 2_000 }, percent);
    expect(points[0]?.y).toBe(FLOOR);
    expect(points[48]?.y).toBe(SIM_PREVIEW_HEIGHT / 2);
    expect(points.at(-1)?.y).toBe(FLOOR);
  });

  it("draws a ramp on a DIGITAL channel as the two states the pin has", () => {
    // The strip is beside the readout and has to be the same number. A pin the
    // board reads as a bit cannot be at 0,4, so a declared ramp is a staircase
    // — which is a true thing to learn about the circuit at the moment the
    // shape is picked, and the reason this goes through `channelValueAt`.
    const points = wavePreview({ kind: "ramp", from: 0, to: 1, periodMs: 2_000 }, channel());
    expect(new Set(points.map((point) => point.y))).toEqual(new Set([TOP, FLOOR]));
    expect(points[0]?.y).toBe(FLOOR); // 0,00 rounds low
    expect(points[47]?.y).toBe(FLOOR); // 0,49 still low
    expect(points[48]?.y).toBe(TOP); // 0,50 rounds high
  });

  it("survives a channel whose range has no width", () => {
    const flat = channel({ unit: "volts", range: { min: 2, max: 2 } });
    const points = wavePreview({ kind: "constant", value: 2 }, flat);
    expect(points.every((point) => Number.isFinite(point.y))).toBe(true);
  });

  it("joins into an attribute a polyline can take", () => {
    const points = wavePreview({ kind: "constant", value: 0 }, percent);
    expect(previewPath(points).startsWith("0,22 1.04,22")).toBe(true);
  });
});

describe("formatSimValue", () => {
  it("names the unit where there is one to name", () => {
    expect(formatSimValue("level", 1)).toBe("1");
    expect(formatSimValue("percent", 33.33)).toBe("33,33 %");
    expect(formatSimValue("volts", 3.3)).toBe("3,3 V");
  });

  it("writes the decimal the way the form takes it back", () => {
    expect(formatSimValue("volts", 1.25)).toBe("1,25 V");
  });
});
