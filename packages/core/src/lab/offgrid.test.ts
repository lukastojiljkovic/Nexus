import { describe, expect, it } from "vitest";

import {
  daysOfPower,
  deviceWhPerDay,
  requiredCapacityWh,
  requiredPanelWatts,
  usableWh,
  whPerDay,
} from "./offgrid.js";

/**
 * The hand calculations these expectations come from are written beside each
 * one, so a reader can re-derive rather than trust: a device is watts × hours,
 * and everything else is one division.
 */
describe("the off-grid budget", () => {
  const devices = [
    { name: "Laptop", watts: 45, hoursPerDay: 8 }, // 360 Wh … 380 with the lamp
    { name: "Lamp", watts: 10, hoursPerDay: 2 }, // 20 Wh
  ];

  it("multiplies watts by hours for one device and sums the list", () => {
    expect(deviceWhPerDay(devices[0] as (typeof devices)[number])).toBe(360);
    expect(deviceWhPerDay(devices[1] as (typeof devices)[number])).toBe(20);
    expect(whPerDay(devices)).toBe(380);
    expect(whPerDay([])).toBe(0);
  });

  it("takes the depth of discharge out of the nameplate capacity", () => {
    // A 100 Ah 12 V pack is 1200 Wh; at 50 % depth of discharge it offers 600.
    expect(usableWh(1_200, 0.5)).toBe(600);
    expect(usableWh(1_200, 1)).toBe(1_200);
  });

  it("divides the usable capacity by the daily consumption", () => {
    expect(daysOfPower(600, 380)).toBeCloseTo(600 / 380, 12);
    expect(daysOfPower(3_800, 380)).toBe(10);
    // Nothing drawn has no answer, and `null` is that answer — not `Infinity`,
    // which would be a number on a screen.
    expect(daysOfPower(600, 0)).toBeNull();
  });

  it("works backwards from the days wanted to the pack's nameplate", () => {
    // Three days at 380 Wh a day, at 50 % depth of discharge: 380 × 3 / 0.5.
    expect(requiredCapacityWh(380, 3, 0.5)).toBe(2_280);
    expect(() => requiredCapacityWh(380, 3, 0)).toThrow(RangeError);
  });

  it("divides the daily need by sun hours and by the charge efficiency", () => {
    // 380 Wh over 4 h of sun with 80 % reaching the battery: 380 / (4 × 0.8).
    expect(requiredPanelWatts(380, 4, 0.8)).toBeCloseTo(118.75, 10);
    expect(requiredPanelWatts(380, 4, 1)).toBe(95);
    expect(() => requiredPanelWatts(380, 0, 1)).toThrow(RangeError);
    expect(() => requiredPanelWatts(380, 4, 0)).toThrow(RangeError);
    expect(() => requiredPanelWatts(380, 4, 1.5)).toThrow(RangeError);
  });
});
