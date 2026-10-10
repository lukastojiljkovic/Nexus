/**
 * The cities the world clock offers, and the IANA zone each one is on.
 *
 * **Why a curated list rather than a search over the whole tz database.** The
 * clock answers "what time is it where the other person is", and the useful
 * answer is a city the user recognises; the database behind it has several
 * hundred ids, including several for one country and retired spellings, and a
 * picker that offers them all is a spelling test. The ids are the runtime's own
 * keys - nothing here is a table of OFFSETS, which would go stale the moment a
 * government moved a clock (`@nexus/core`'s `worldClock.ts` makes the same
 * argument about the hard part).
 *
 * **Where the zone ids come from.** The IANA time zone database, as the runtime
 * ships it; `cities.test.ts` asks `Intl.DateTimeFormat` whether every id below
 * is one the runtime knows, so a typo or an id a future tzdb retires fails here
 * rather than on the page.
 *
 * The label a user reads is NOT here: it is `copy.cities[<id>]`, in both
 * locales, so this file stays a list of ids and zones and carries no words.
 */

export interface MiniappsCity {
  /** A stable key: the label lives in the copy tables, under this id. */
  readonly id: string;
  /** An IANA zone id, as `Intl` takes it. */
  readonly zone: string;
}

export const MINIAPPS_CITIES: readonly MiniappsCity[] = [
  { id: "beograd", zone: "Europe/Belgrade" },
  { id: "zagreb", zone: "Europe/Zagreb" },
  { id: "sarajevo", zone: "Europe/Sarajevo" },
  { id: "podgorica", zone: "Europe/Podgorica" },
  { id: "ljubljana", zone: "Europe/Ljubljana" },
  { id: "bec", zone: "Europe/Vienna" },
  { id: "budimpesta", zone: "Europe/Budapest" },
  { id: "prag", zone: "Europe/Prague" },
  { id: "berlin", zone: "Europe/Berlin" },
  { id: "pariz", zone: "Europe/Paris" },
  { id: "amsterdam", zone: "Europe/Amsterdam" },
  { id: "london", zone: "Europe/London" },
  { id: "rim", zone: "Europe/Rome" },
  { id: "madrid", zone: "Europe/Madrid" },
  { id: "atina", zone: "Europe/Athens" },
  { id: "istanbul", zone: "Europe/Istanbul" },
  { id: "moskva", zone: "Europe/Moscow" },
  { id: "kijev", zone: "Europe/Kyiv" },
  { id: "njujork", zone: "America/New_York" },
  { id: "cikago", zone: "America/Chicago" },
  { id: "losandjeles", zone: "America/Los_Angeles" },
  { id: "toronto", zone: "America/Toronto" },
  { id: "meksiko", zone: "America/Mexico_City" },
  { id: "saopaulo", zone: "America/Sao_Paulo" },
  { id: "buenosajres", zone: "America/Argentina/Buenos_Aires" },
  { id: "kairo", zone: "Africa/Cairo" },
  { id: "najrobi", zone: "Africa/Nairobi" },
  { id: "dubai", zone: "Asia/Dubai" },
  { id: "mumbaj", zone: "Asia/Kolkata" },
  { id: "singapur", zone: "Asia/Singapore" },
  { id: "hongkong", zone: "Asia/Hong_Kong" },
  { id: "sangaj", zone: "Asia/Shanghai" },
  { id: "tokio", zone: "Asia/Tokyo" },
  { id: "seul", zone: "Asia/Seoul" },
  { id: "sidnej", zone: "Australia/Sydney" },
  { id: "okland", zone: "Pacific/Auckland" },
  { id: "honolulu", zone: "Pacific/Honolulu" },
];

/** The zone id a city id stands for, or `null` for one this build does not offer. */
export function zoneOfCity(id: string): string | null {
  return MINIAPPS_CITIES.find((city) => city.id === id)?.zone ?? null;
}

/** The city id a zone belongs to, or `null` - how a kept zone id becomes a label. */
export function cityOfZone(zone: string): string | null {
  return MINIAPPS_CITIES.find((city) => city.zone === zone)?.id ?? null;
}
