/**
 * Where this computer is, without asking the network: an IANA time zone name to
 * the coordinates of that zone's principal city.
 *
 * **Why a zone name at all.** A zone is the one thing a machine states about
 * its place by itself: `Intl.DateTimeFormat().resolvedOptions().timeZone`
 * answers `Europe/Belgrade` with no permission, no prompt, no geolocation API
 * and no request of any kind. It is a TIMEKEEPING label rather than a position,
 * which is exactly why the coordinates come from a shipped table instead of
 * being derived: an offset is not a longitude.
 *
 * **The table is `zone1970.tab` from the tz database** (public domain; the
 * notice is quoted in `tzTable.ts`, which also describes the row format and
 * what was left out). Each row names one zone and gives the coordinates of the
 * first city in that row's own comment column: its principal city, by the
 * file's own convention.
 *
 * **A zone the table does not carry answers `null`, and that is deliberate.**
 * `zone1970.tab` describes zones whose civil clocks have AGREED since 1970, so
 * a zone that keeps a neighbour's time has no row of its own: measured on
 * 2026-10-10 against this runtime (Node 24), 297 of the 418 names
 * `Intl.supportedValuesOf("timeZone")` reports are in the table and 121 are not
 * (Europe/Amsterdam, Europe/Oslo, Europe/Stockholm, Europe/Zagreb,
 * Asia/Calcutta, and the rest of that list).
 *
 * Those 121 could be resolved through the database's own link table, and this
 * module does not, because a link is a statement about CLOCKS and not about
 * places: `Europe/Oslo` is a link to `Europe/Berlin` and `Europe/Zagreb` to
 * `Europe/Belgrade` (both read from the database's `backward` file on
 * 2026-10-10). Pinning the map at Berlin for a reader in Oslo would be a
 * thousand kilometres of fabricated precision. `null` says the honest thing,
 * that this zone's principal city is not something this table knows, and the
 * surface above asks for a place, with the shipped city table (`cities.ts`) or
 * typed coordinates to answer with.
 *
 * Nothing here consults a clock, a daylight-saving rule or the network, and no
 * caller should read a zone's coordinates as the reader's OWN position: the
 * city a zone is named for can be a hundred kilometres away, and the reader
 * refines it when it matters.
 */
import type { LatLon } from "./contract.js";
import { ZONE_TABLE } from "./tzTable.js";

/** A zone name, and the coordinates the tz database gives that zone's principal city. */
export interface ZoneObserver {
  readonly zone: string;
  readonly point: LatLon;
}

/** The parsed table, built on first use and kept for the life of the process. */
let parsed: Map<string, LatLon> | null = null;

function zoneTable(): Map<string, LatLon> {
  if (parsed !== null) return parsed;
  const table = new Map<string, LatLon>();
  for (const row of ZONE_TABLE.split("\n")) {
    const [zone, latDeg, lonDeg] = row.split("|");
    if (zone === undefined || latDeg === undefined || lonDeg === undefined) continue;
    table.set(zone, { latDeg: Number(latDeg), lonDeg: Number(lonDeg) });
  }
  parsed = table;
  return table;
}

/** How many zones the shipped table carries. Exported for the census its test prints. */
export function zoneCount(): number {
  return zoneTable().size;
}

/** The principal city of a zone, or `null` for a zone the table does not carry (see the header). */
export function zonePoint(zone: string): LatLon | null {
  return zoneTable().get(zone) ?? null;
}

/**
 * The zone this computer keeps time in, as `Intl` names it, or `null` when the
 * runtime offers none.
 *
 * The `try` is not defensiveness for its own sake: `Intl.DateTimeFormat` is
 * resolved against the runtime's ICU data, and a build without the time-zone
 * data raises rather than answering. A machine that cannot say which zone it is
 * in is a machine this feature has no default place for, and `null` is that
 * fact.
 */
export function computerZone(): string | null {
  try {
    const zone: unknown = new Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof zone === "string" && zone.length > 0 ? zone : null;
  } catch {
    return null;
  }
}

/**
 * The default observer: this computer's zone and the coordinates of its
 * principal city, or `null` when either half is unknown.
 *
 * The two halves are answered together because a caller showing a place needs
 * both or neither: a pin with no zone cannot be explained, and a zone with no
 * pin cannot be drawn.
 */
export function computerObserver(): ZoneObserver | null {
  const zone = computerZone();
  if (zone === null) return null;
  const point = zonePoint(zone);
  return point === null ? null : { zone, point };
}
