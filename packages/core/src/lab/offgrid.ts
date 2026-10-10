/**
 * The off-grid budget: what a laptop's own battery and a panel or power bank
 * would carry, from a list of devices and hours.
 *
 * **This is arithmetic a user can check, which is the only kind that belongs
 * here.** A device is `watts × hours per day`; a day is the sum of those; the
 * battery is `capacity × depth of discharge`, because a lead-acid or lithium
 * pack that is emptied to zero is a pack that does not come back — the depth of
 * discharge is an INPUT, not a constant this file chooses for somebody's
 * hardware. A panel is `consumption ÷ sun hours ÷ charge efficiency`, the same
 * division every off-grid worksheet makes.
 *
 * **Nothing here invents a number, and that is deliberate.** There is no default
 * sun-hour figure (it is latitude and season), no default depth of discharge (it
 * is chemistry) and no default efficiency (it is an inverter's, a controller's
 * and a cable's together). Every one of them arrives from a field the user can
 * see, and the page shows the arithmetic rather than pronouncing a verdict:
 * "how long will this last" is a figure, never "your setup is fine".
 */

/** One thing that draws power. */
export interface OffGridDevice {
  readonly name: string;
  /** Its draw while it is on, in watts. */
  readonly watts: number;
  /** How many hours a day it is on. */
  readonly hoursPerDay: number;
}

/** What one device costs per day, in watt-hours. */
export function deviceWhPerDay(device: OffGridDevice): number {
  return device.watts * device.hoursPerDay;
}

/** The whole list's daily consumption, in watt-hours. */
export function whPerDay(devices: readonly OffGridDevice[]): number {
  return devices.reduce((total, device) => total + deviceWhPerDay(device), 0);
}

/**
 * The watt-hours a pack really offers: its nameplate capacity times the depth of
 * discharge the user allows. A depth of 1 is a pack discharged to empty.
 */
export function usableWh(capacityWh: number, depthOfDischarge: number): number {
  return capacityWh * depthOfDischarge;
}

/**
 * How many days the usable capacity lasts at this consumption.
 *
 * `null` — not infinity and not zero — when the consumption is zero, because
 * "how long does nothing last" has no answer and a page that printed `Infinity`
 * would be printing a bug.
 */
export function daysOfPower(usableWattHours: number, consumptionWhPerDay: number): number | null {
  if (consumptionWhPerDay <= 0) return null;
  return usableWattHours / consumptionWhPerDay;
}

/** The nameplate capacity a pack needs to carry `days` of this consumption, at the given depth of discharge. */
export function requiredCapacityWh(
  consumptionWhPerDay: number,
  days: number,
  depthOfDischarge: number,
): number {
  if (depthOfDischarge <= 0) throw new RangeError("A depth of discharge must be above zero.");
  return (consumptionWhPerDay * days) / depthOfDischarge;
}

/**
 * The panel that would replace this consumption in a day: the daily need,
 * divided by the hours of usable sun and by how much of what arrives reaches the
 * battery.
 *
 * Both divisors are inputs — a panel rated 200 W produces its rating at one
 * irradiance, and a charge controller is not lossless.
 */
export function requiredPanelWatts(
  consumptionWhPerDay: number,
  sunHoursPerDay: number,
  chargeEfficiency: number,
): number {
  if (sunHoursPerDay <= 0) throw new RangeError("Sun hours must be above zero.");
  if (chargeEfficiency <= 0 || chargeEfficiency > 1) {
    throw new RangeError("A charge efficiency must be in (0, 1].");
  }
  return consumptionWhPerDay / (sunHoursPerDay * chargeEfficiency);
}
