/**
 * The app-wide location: where the machine is, when the user says so.
 *
 * **What this is for.** A GPS puck on a serial port is the only way this product
 * can know where it is without a network, and two surfaces want that answer: the
 * astronomy corner (which computes rise and set times from a latitude and a
 * longitude) and a map. Neither is built on this branch, so what exists is the
 * one fact they will both read — `setDeviceLocation` and the getter below — and
 * the LAB page's own button that fills it from a verified `$GPGGA`/`$GPRMC` fix.
 * The module reaches it through its contract (`setLocation`, `clearLocation`);
 * a future module imports this file directly, which is why the setter is
 * exported under the name the task fixed rather than being a closure inside the
 * IPC handler.
 *
 * **Why it is DEVICE state and not a profile row.** A fix is a fact about the
 * machine right now, and two profiles on one laptop are in the same room. It is
 * also the reason a location never travels in an archive: importing somebody's
 * archive must not move the app's idea of where it is, and the database is not
 * where a value that expires with the session belongs.
 *
 * **Why it is not persisted, and why a session end clears it.** A stored fix is
 * a stale fix: the laptop moves, and a rise time computed from last week's
 * coordinates is wrong in a way nothing on screen reveals. So the value lives in
 * this process's memory, is dropped when the session ends (a lock, a switch, a
 * quit), and the page says plainly that it is remembering a location and for how
 * long. `at` travels with it so a reader can tell how old the fix is.
 */

/** One fix, as the page and the astronomy corner read it. */
export interface DeviceLocation {
  readonly latitude: number;
  readonly longitude: number;
  /** The instant the fix was taken, from the clock the kit injects. */
  readonly at: string;
}

/** The fix this process is holding, or `null` when it holds none. */
let current: DeviceLocation | null = null;

/** Latitude and longitude are refused outside the planet rather than clamped: a fix that is not a place is a bug upstream. */
const LATITUDE_LIMIT = 90;
const LONGITUDE_LIMIT = 180;

/**
 * Remembers where the machine is, app-wide.
 *
 * Throws for a coordinate that is not a place — `|latitude| > 90`, or a
 * longitude outside ±180 — rather than clamping it: a clamp would put the app's
 * idea of its position on the equator or the date line, which are real places,
 * and the sentence that would have named the bug is gone.
 */
export function setDeviceLocation(location: DeviceLocation): DeviceLocation {
  if (
    !Number.isFinite(location.latitude) ||
    Math.abs(location.latitude) > LATITUDE_LIMIT
  ) {
    throw new RangeError("A latitude must be a finite number in -90…90.");
  }
  if (
    !Number.isFinite(location.longitude) ||
    Math.abs(location.longitude) > LONGITUDE_LIMIT
  ) {
    throw new RangeError("A longitude must be a finite number in -180…180.");
  }
  current = {
    latitude: location.latitude,
    longitude: location.longitude,
    at: location.at,
  };
  return current;
}

/** The fix being held, or `null`. */
export function deviceLocation(): DeviceLocation | null {
  return current;
}

/** Forgets it — the „use as my location" button's own undo, and what a session end runs. */
export function clearDeviceLocation(): void {
  current = null;
}
