import { describe, expect, it } from "vitest";

import {
  arraySizing,
  autonomyDays,
  batteryBankSizing,
  chargeControllerCurrent,
  deviceDailyEnergy,
  inverterSizing,
} from "./energija.js";

/**
 * The off-grid toolkit's arithmetic, against numbers worked out by hand.
 *
 * Every case here is deliberately built on round figures — a watt times an hour
 * is a watt-hour, and 4 000 Wh a day for three days at 50 % of a 24 V bank is
 * 1 000 Ah — so that each expected value can be re-derived on paper rather than
 * taken from the code. The one thing that is NOT arithmetic is the peak sun
 * hours, and it is an input precisely because no value of it could be derived
 * here at all.
 */

describe("deviceDailyEnergy", () => {
  it("adds power times time over a list of devices", () => {
    // Fridge 150 W × 24 h = 3 600 Wh; two lights 20 W × 5 h = 100 Wh each;
    // total 3 800 Wh = 3,8 kWh, connected load 190 W
    const result = deviceDailyEnergy([
      { name: "Frižider", watts: 150, hoursPerDay: 24 },
      { name: "Svetlo", watts: 20, hoursPerDay: 5 },
      { name: "Svetlo 2", watts: 20, hoursPerDay: 5 },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toHaveLength(3);
    expect(result.rows[0]?.wattHoursPerDay).toBeCloseTo(3600, 9);
    expect(result.totalWattHoursPerDay).toBeCloseTo(3800, 9);
    expect(result.totalKwhPerDay).toBeCloseTo(3.8, 9);
    expect(result.connectedWatts).toBeCloseTo(190, 9);
  });

  it("names the row that is wrong rather than the list", () => {
    const bad = deviceDailyEnergy([
      { name: "A", watts: 100, hoursPerDay: 2 },
      { name: "B", watts: 0, hoursPerDay: 2 },
    ]);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.reason).toBe("watts:1");

    const hours = deviceDailyEnergy([{ name: "A", watts: 100, hoursPerDay: 30 }]);
    expect(hours.ok).toBe(false);
    if (!hours.ok) expect(hours.reason).toBe("hours:0");
  });

  it("refuses an empty list", () => {
    expect(deviceDailyEnergy([]).ok).toBe(false);
  });
});

describe("batteryBankSizing", () => {
  it("sizes the bank from the autonomy and the depth of discharge", () => {
    // 4 000 Wh × 3 days = 12 000 Wh of load; at 50 % DoD the bank must hold
    // 24 000 Wh; at 24 V that is 1 000 Ah
    const result = batteryBankSizing({
      dailyEnergyWh: 4000,
      autonomyDays: 3,
      depthOfDischargePct: 50,
      systemVoltageV: 24,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.loadWh).toBeCloseTo(12000, 9);
    expect(result.requiredWh).toBeCloseTo(24000, 9);
    expect(result.requiredAh).toBeCloseTo(1000, 9);
  });

  it("needs a smaller bank when a deeper discharge is allowed", () => {
    const shallow = batteryBankSizing({
      dailyEnergyWh: 4000,
      autonomyDays: 3,
      depthOfDischargePct: 50,
      systemVoltageV: 24,
    });
    const deep = batteryBankSizing({
      dailyEnergyWh: 4000,
      autonomyDays: 3,
      depthOfDischargePct: 80,
      systemVoltageV: 24,
    });
    expect(shallow.ok && deep.ok).toBe(true);
    if (!shallow.ok || !deep.ok) return;
    expect(deep.requiredAh).toBeCloseTo(625, 9);
    expect(deep.requiredAh).toBeLessThan(shallow.requiredAh);
  });

  it("refuses a depth of discharge and an autonomy it cannot use", () => {
    const base = { dailyEnergyWh: 4000, autonomyDays: 3, depthOfDischargePct: 50, systemVoltageV: 24 };
    expect(batteryBankSizing({ ...base, depthOfDischargePct: 0 }).ok).toBe(false);
    expect(batteryBankSizing({ ...base, autonomyDays: 0 }).ok).toBe(false);
    expect(batteryBankSizing({ ...base, systemVoltageV: 0 }).ok).toBe(false);
  });
});

describe("arraySizing", () => {
  it("divides the daily energy by the peak sun hours and the derate", () => {
    // 4 000 Wh/(4 h × 0,8) = 1 250 Wp, which is five 250 Wp panels
    const result = arraySizing({
      dailyEnergyWh: 4000,
      peakSunHours: 4,
      deratePct: 80,
      panelWp: 250,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.arrayWp).toBeCloseTo(1250, 9);
    expect(result.derateUsed).toBeCloseTo(0.8, 9);
    expect(result.panelCount).toBe(5);
    expect(result.installedWp).toBeCloseTo(1250, 9);
  });

  it("rounds the panel count up, a fraction of a panel being unbuyable", () => {
    // 4 000/(4 × 0,8) = 1 250 Wp over 400 Wp panels is 3,125, so four panels
    const result = arraySizing({
      dailyEnergyWh: 4000,
      peakSunHours: 4,
      deratePct: 80,
      panelWp: 400,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.panelCount).toBe(4);
    expect(result.installedWp).toBeCloseTo(1600, 9);
  });

  it("answers the array alone when no panel was given", () => {
    const result = arraySizing({ dailyEnergyWh: 4000, peakSunHours: 4, deratePct: 80 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.arrayWp).toBeCloseTo(1250, 9);
    expect(result.panelCount).toBeUndefined();
    expect(result.installedWp).toBeUndefined();
  });

  it("refuses peak sun hours outside what a site can have", () => {
    expect(arraySizing({ dailyEnergyWh: 4000, peakSunHours: 0, deratePct: 80 }).ok).toBe(false);
    expect(arraySizing({ dailyEnergyWh: 4000, peakSunHours: 20, deratePct: 80 }).ok).toBe(false);
  });
});

describe("inverterSizing", () => {
  it("converts watts to volt-amperes and reports the surge ratio", () => {
    // 2 000 W at pf 0,8 is 2 500 VA; a 5 000 W surge is 6 250 VA, 2,5 times
    const result = inverterSizing({ continuousW: 2000, surgeW: 5000, powerFactor: 0.8 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.continuousVa).toBeCloseTo(2500, 9);
    expect(result.surgeVa).toBeCloseTo(6250, 9);
    expect(result.surgeRatio).toBeCloseTo(2.5, 9);
  });

  it("refuses a surge below the continuous load", () => {
    expect(inverterSizing({ continuousW: 2000, surgeW: 1000, powerFactor: 0.8 }).ok).toBe(false);
    expect(inverterSizing({ continuousW: 2000, surgeW: 5000, powerFactor: 0.2 }).ok).toBe(false);
  });
});

describe("chargeControllerCurrent", () => {
  it("divides the array power by the battery voltage, with the margin asked for", () => {
    // 1 250 Wp at 24 V is 52,0833 A; a 25 % margin gives 65,1042 A
    const result = chargeControllerCurrent({ arrayWp: 1250, systemVoltageV: 24, marginPct: 25 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.currentA).toBeCloseTo(52.083333, 6);
    expect(result.currentWithMarginA).toBeCloseTo(65.104167, 6);
    expect(result.marginUsed).toBe(25);
  });

  it("refuses a voltage and a margin it cannot use", () => {
    expect(chargeControllerCurrent({ arrayWp: 1250, systemVoltageV: 0, marginPct: 25 }).ok).toBe(false);
    expect(chargeControllerCurrent({ arrayWp: 1250, systemVoltageV: 24, marginPct: 200 }).ok).toBe(
      false,
    );
  });
});

describe("autonomyDays", () => {
  it("is the inverse of the bank sizing", () => {
    // 1 000 Ah × 24 V × 0,5 = 12 000 Wh usable; at 4 000 Wh a day that is 3 days
    const result = autonomyDays({
      bankAh: 1000,
      systemVoltageV: 24,
      depthOfDischargePct: 50,
      dailyEnergyWh: 4000,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.usableWh).toBeCloseTo(12000, 9);
    expect(result.days).toBeCloseTo(3, 9);
    expect(result.wholeDays).toBe(3);
  });

  it("rounds a part day up in the whole-day figure", () => {
    // 12 000 Wh usable over 4 500 Wh a day is 2,6667 days — three nights
    const result = autonomyDays({
      bankAh: 1000,
      systemVoltageV: 24,
      depthOfDischargePct: 50,
      dailyEnergyWh: 4500,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.days).toBeCloseTo(2.666667, 6);
    expect(result.wholeDays).toBe(3);
  });

  it("refuses a capacity and a discharge it cannot use", () => {
    const base = { bankAh: 1000, systemVoltageV: 24, depthOfDischargePct: 50, dailyEnergyWh: 4000 };
    expect(autonomyDays({ ...base, bankAh: 0 }).ok).toBe(false);
    expect(autonomyDays({ ...base, depthOfDischargePct: 0 }).ok).toBe(false);
    expect(autonomyDays({ ...base, dailyEnergyWh: 0 }).ok).toBe(false);
  });
});
