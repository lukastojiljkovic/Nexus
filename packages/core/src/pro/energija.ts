/**
 * „Energija — solarni i vanmrežni sistemi" — the arithmetic behind the
 * toolkit's tools.
 *
 * **One file per PACK, not per category**, exactly as `pro/gradnja.ts` explains.
 *
 * **These are pure functions and they refuse rather than repair.** No clock, no
 * I/O, no locale, no formatting: the surface owns its state and asks here for
 * every number it prints.
 *
 * **No irradiance data is shipped, and that is the central decision of this
 * file.** Peak sun hours depend on the latitude, the month, the tilt, the
 * shading and the year's weather, and a table of monthly averages embedded in
 * an offline app would be a claim about a place the user is not standing in —
 * and one that goes stale as the climate moves. The figure is therefore an
 * INPUT, with a hint that says where it comes from, and every other number here
 * is arithmetic on top of it.
 *
 * **Nothing here sizes anything to a code.** The depth of discharge is the
 * battery's own figure and the user's decision, the derate belongs to the
 * array, and the margin on a charge controller is a convention rather than a
 * rule; every one of them is a field. The pack is `life-safety` in class,
 * because a battery bank and an inverter are an electrical installation, and
 * what comes back is a quantity and never an „adequate".
 */

import {
  ceilSnapped,
  fail,
  isInRange,
  isPositive,
  quotient,
  type ProResult,
} from "./result.js";

/* ---------------------------------------------------------------------------
 * device-daily-energy — „Potrošnja po uređajima"
 * ------------------------------------------------------------------------ */

export interface DeviceLoad {
  readonly name: string;
  readonly watts: number;
  readonly hoursPerDay: number;
}

export interface DeviceRow {
  readonly name: string;
  readonly watts: number;
  readonly hoursPerDay: number;
  /** Power times time, watt-hours per day. */
  readonly wattHoursPerDay: number;
}

export interface DeviceDailyEnergyResult {
  readonly rows: readonly DeviceRow[];
  readonly totalWattHoursPerDay: number;
  readonly totalKwhPerDay: number;
  /** The connected load if everything ran at once — a sum, not a demand. */
  readonly connectedWatts: number;
}

/**
 * A day's energy from a list of devices — the definition of energy as power
 * times time, summed over the list.
 *
 * A device is entered as watts and hours per day, which is the only form a
 * household can measure: a nameplate says watts, and the hours are the
 * household's own habit. The total is a daily CONSUMPTION and not a demand —
 * nothing here knows whether the fridge and the kettle run at the same moment,
 * and the surface says so rather than letting `connectedWatts` be read as a
 * load.
 *
 * A row's refusal names its own index, because „one of the rows is wrong" in a
 * list of twelve is not something the user can act on.
 */
export function deviceDailyEnergy(
  devices: readonly DeviceLoad[],
): ProResult<DeviceDailyEnergyResult> {
  if (devices.length === 0) return fail("devices");
  if (devices.length > 200) return fail("devices");
  const rows: DeviceRow[] = [];
  let total = 0;
  let connected = 0;
  for (const [index, device] of devices.entries()) {
    if (!isPositive(device.watts) || device.watts > 1e6) return fail(`watts:${index}`);
    if (!isInRange(device.hoursPerDay, 0, 24)) return fail(`hours:${index}`);
    const wattHoursPerDay = device.watts * device.hoursPerDay;
    total += wattHoursPerDay;
    connected += device.watts;
    rows.push({
      name: device.name,
      watts: device.watts,
      hoursPerDay: device.hoursPerDay,
      wattHoursPerDay,
    });
  }
  return {
    ok: true,
    rows,
    totalWattHoursPerDay: total,
    totalKwhPerDay: total / 1000,
    connectedWatts: connected,
  };
}

/* ---------------------------------------------------------------------------
 * battery-bank-sizing — „Baterija za zadatu autonomiju"
 * ------------------------------------------------------------------------ */

export interface BatterySizingInput {
  /** Energy the installation consumes in a day, Wh. */
  readonly dailyEnergyWh: number;
  /** Days of autonomy wanted with no sun at all. The user's number, never a default. */
  readonly autonomyDays: number;
  /** Permitted depth of discharge, %. A property of the chemistry and of the warranty. */
  readonly depthOfDischargePct: number;
  readonly systemVoltageV: number;
}

export interface BatterySizingResult {
  /** Energy the installation must get through: daily consumption times the autonomy. */
  readonly loadWh: number;
  /** Nameplate energy the bank must hold, after the depth of discharge is allowed for. */
  readonly requiredWh: number;
  readonly requiredAh: number;
  /** What is available to the load at the stated depth of discharge. */
  readonly usableWh: number;
  readonly systemVoltageV: number;
}

/**
 * The bank a stated autonomy needs: the daily consumption times the days
 * wanted, divided by the permitted depth of discharge, divided by the system
 * voltage.
 *
 * That is one relation rearranged twice and nothing more, and every figure in
 * it is the user's — the autonomy, the depth of discharge and the voltage —
 * because each is a decision about a specific installation: a lithium bank is
 * happy at 80 % and a lead-acid one at 50 %, and which is right is a warranty
 * and a wallet question.
 *
 * **The two losses it does not carry are named on the surface**: the inverter's
 * efficiency and the battery's own round-trip loss, both of which would grow
 * the bank and neither of which this file will guess on the user's behalf.
 */
export function batteryBankSizing(input: BatterySizingInput): ProResult<BatterySizingResult> {
  const { dailyEnergyWh, autonomyDays, depthOfDischargePct, systemVoltageV } = input;
  if (!isPositive(dailyEnergyWh) || dailyEnergyWh > 1e9) return fail("dailyEnergy");
  if (!isInRange(autonomyDays, 0.5, 365)) return fail("autonomy");
  if (!isInRange(depthOfDischargePct, 5, 100)) return fail("depthOfDischarge");
  if (!isPositive(systemVoltageV) || systemVoltageV > 2000) return fail("voltage");

  const loadWh = dailyEnergyWh * autonomyDays;
  const requiredWh = loadWh / (depthOfDischargePct / 100);
  const requiredAh = quotient(requiredWh, systemVoltageV);
  if (requiredAh === undefined) return fail("voltage");
  return { ok: true, loadWh, requiredWh, requiredAh, usableWh: loadWh, systemVoltageV };
}

/* ---------------------------------------------------------------------------
 * array-sizing — „Polje panela"
 * ------------------------------------------------------------------------ */

export interface ArraySizingInput {
  readonly dailyEnergyWh: number;
  /**
   * Peak sun hours at the site — the equivalent number of hours at 1 000 W/m².
   *
   * Entered by the user and never shipped: it depends on the latitude, the
   * month, the tilt, the shading and the weather, and a value embedded here
   * would be a claim about a place this app has never seen.
   */
  readonly peakSunHours: number;
  /** System derate, %: wiring, soiling, temperature and the controller's own loss. */
  readonly deratePct: number;
  /** One panel's rated power, Wp. Optional — without it only the array size is answered. */
  readonly panelWp?: number | undefined;
}

export interface ArraySizingResult {
  /** The array's rated power, Wp. */
  readonly arrayWp: number;
  /** Energy the array has to produce in a day, before the derate. */
  readonly requiredWh: number;
  readonly derateUsed: number;
  readonly panelCount: number | undefined;
  /** The array the chosen number of panels actually is, Wp. */
  readonly installedWp: number | undefined;
}

/**
 * The array a daily consumption needs: the energy divided by the peak sun
 * hours and by the derate.
 *
 * The energy has to be produced during the equivalent of the peak sun hours at
 * full irradiance, and every part of the path from cell to load loses some of
 * it, so the derate divides the requirement upwards. The peak sun hours are a
 * property of the SITE and the derate of the INSTALLATION, so both are fields.
 *
 * The panel count rounds up and not sideways, because half a panel is not a
 * purchase — and it is `ceilSnapped`, so an array that lands exactly on the
 * boundary does not buy a panel nobody needed.
 */
export function arraySizing(input: ArraySizingInput): ProResult<ArraySizingResult> {
  const { dailyEnergyWh, peakSunHours, deratePct, panelWp } = input;
  if (!isPositive(dailyEnergyWh) || dailyEnergyWh > 1e9) return fail("dailyEnergy");
  if (!isInRange(peakSunHours, 0.5, 12)) return fail("peakSunHours");
  if (!isInRange(deratePct, 20, 100)) return fail("derate");
  if (panelWp !== undefined && (!isPositive(panelWp) || panelWp > 2000)) return fail("panel");

  const arrayWp = dailyEnergyWh / ((peakSunHours * deratePct) / 100);
  if (!Number.isFinite(arrayWp)) return fail("peakSunHours");
  const panelCount =
    panelWp === undefined ? undefined : ceilSnapped(quotient(arrayWp, panelWp) ?? Number.NaN);
  return {
    ok: true,
    arrayWp,
    requiredWh: dailyEnergyWh,
    derateUsed: deratePct / 100,
    panelCount,
    installedWp:
      panelCount === undefined || panelWp === undefined ? undefined : panelCount * panelWp,
  };
}

/* ---------------------------------------------------------------------------
 * inverter-sizing — „Invertor i udarna snaga"
 * ------------------------------------------------------------------------ */

export interface InverterSizingInput {
  /** The load that runs continuously, W. */
  readonly continuousW: number;
  /** The largest load that starts at once, W — a motor's inrush is the usual reason it matters. */
  readonly surgeW: number;
  /** Power factor of the load, 0,5–1. An input, because it belongs to the load. */
  readonly powerFactor: number;
}

export interface InverterSizingResult {
  readonly continuousVa: number;
  readonly surgeVa: number;
  /** How many times the continuous load the surge is. */
  readonly surgeRatio: number;
}

/**
 * The apparent power an inverter has to deliver, continuously and at the
 * surge: the watts over the load's power factor.
 *
 * **The surge is an input and not a factor.** „Three times continuous for five
 * seconds" is a line in one inverter's datasheet and not a property of loads:
 * a fridge compressor, a circular saw and a well pump each ask for something
 * different, and the figure that matters is the one on the load's own plate.
 * Nothing here is compared to a limit, because the limit belongs to a machine
 * the user is still choosing.
 */
export function inverterSizing(input: InverterSizingInput): ProResult<InverterSizingResult> {
  const { continuousW, surgeW, powerFactor } = input;
  if (!isPositive(continuousW) || continuousW > 1e8) return fail("continuous");
  if (!isPositive(surgeW) || surgeW > 1e8) return fail("surge");
  if (!isInRange(powerFactor, 0.5, 1)) return fail("powerFactor");
  if (surgeW < continuousW) return fail("surge");

  const surgeRatio = quotient(surgeW, continuousW);
  if (surgeRatio === undefined) return fail("continuous");
  return {
    ok: true,
    continuousVa: continuousW / powerFactor,
    surgeVa: surgeW / powerFactor,
    surgeRatio,
  };
}

/* ---------------------------------------------------------------------------
 * charge-controller-current — „Struja punjača"
 * ------------------------------------------------------------------------ */

export interface ChargeControllerInput {
  /** The array's rated power, Wp. */
  readonly arrayWp: number;
  readonly systemVoltageV: number;
  /** The margin to add on top, % — a convention the installation's own designer sets. */
  readonly marginPct: number;
}

export interface ChargeControllerResult {
  /** The controller's output current at the system voltage. */
  readonly currentA: number;
  /** The same figure with the user's margin applied. */
  readonly currentWithMarginA: number;
  readonly marginUsed: number;
}

/**
 * The current a charge controller passes: the array's rated power over the
 * battery voltage.
 *
 * This is the MPPT case, where the controller's OUTPUT is at the battery
 * voltage while its input sits at the array's maximum power point, and it is
 * the figure a controller rating is chosen against. **A PWM controller is a
 * different question** — it clamps the array to the battery voltage, so its
 * current is the array's own current rather than power over voltage, and the
 * surface says which one this answers.
 *
 * The margin is an input because it is a convention: a designer's rule of thumb
 * sized for a cold clear day is not a standard, and an embedded 25 % would be
 * this file pretending to be an electrician.
 */
export function chargeControllerCurrent(
  input: ChargeControllerInput,
): ProResult<ChargeControllerResult> {
  const { arrayWp, systemVoltageV, marginPct } = input;
  if (!isPositive(arrayWp) || arrayWp > 1e9) return fail("array");
  if (!isPositive(systemVoltageV) || systemVoltageV > 2000) return fail("voltage");
  if (!isInRange(marginPct, 0, 100)) return fail("margin");
  const currentA = quotient(arrayWp, systemVoltageV);
  if (currentA === undefined) return fail("voltage");
  return {
    ok: true,
    currentA,
    currentWithMarginA: currentA * (1 + marginPct / 100),
    marginUsed: marginPct,
  };
}

/* ---------------------------------------------------------------------------
 * autonomy-days — „Dani autonomije banke"
 * ------------------------------------------------------------------------ */

export interface AutonomyInput {
  /** The bank's nameplate capacity, Ah. */
  readonly bankAh: number;
  readonly systemVoltageV: number;
  readonly depthOfDischargePct: number;
  readonly dailyEnergyWh: number;
}

export interface AutonomyResult {
  /** Energy the bank can actually deliver at that depth of discharge, Wh. */
  readonly usableWh: number;
  /** Days the installation runs with no sun at all. */
  readonly days: number;
  /** The same figure as whole days, rounded up. */
  readonly wholeDays: number;
}

/**
 * How many days a bank of a stated capacity lasts — the exact inverse of
 * `batteryBankSizing`: capacity times voltage times depth of discharge, over
 * the daily consumption.
 *
 * It is here rather than left to arithmetic because two different questions get
 * asked at two different moments: one sizes a bank to a requirement, the other
 * asks what an existing bank would give. The fractional days and the whole days
 * are both printed, because „three and a bit" and „four" are different claims
 * about a night.
 */
export function autonomyDays(input: AutonomyInput): ProResult<AutonomyResult> {
  const { bankAh, systemVoltageV, depthOfDischargePct, dailyEnergyWh } = input;
  if (!isPositive(bankAh) || bankAh > 1e6) return fail("capacity");
  if (!isPositive(systemVoltageV) || systemVoltageV > 2000) return fail("voltage");
  if (!isInRange(depthOfDischargePct, 5, 100)) return fail("depthOfDischarge");
  if (!isPositive(dailyEnergyWh) || dailyEnergyWh > 1e9) return fail("dailyEnergy");
  const usableWh = bankAh * systemVoltageV * (depthOfDischargePct / 100);
  const days = quotient(usableWh, dailyEnergyWh);
  if (days === undefined) return fail("dailyEnergy");
  return { ok: true, usableWh, days, wholeDays: ceilSnapped(days) };
}
