/**
 * USNO twilight begins and ends for the same places and days as
 * {@link USNO_ONE_DAY_2026}, which publishes CIVIL twilight only.
 *
 * The one-day API has no nautical or astronomical twilight, but the department's
 * "Table of Sunrise/Sunset, Moonrise/Moonset, or Twilight Times for an Entire
 * Year" does — its `task` parameter selects 2 = civil, 3 = nautical,
 * 4 = astronomical. Fetched 2026-10-09 from
 * https://aa.usno.navy.mil/calculated/rstt/year?ID=AA&year=2026&task=TASK&lat=LAT&lon=LON&label=LABEL&tz=0&tz_sign=-1&submit=Get+Data
 * for each of the five places and each of the three tasks (fifteen pages). Each
 * page prints one 366-row preformatted table in UT: twelve 11-character columns
 * of "hhmm hhmm", day of month down the side.
 *
 * **Only the six rows the brief names are kept here, not the fifteen pages** —
 * a page is 13 kB of navigation chrome around one table, and committing 190 kB
 * of it to reach 180 times would be worse than transcribing the 180 times. The
 * values below were read out of those pages by column offset (a month's "Begin"
 * at 4 + 11(m-1), its "End" at 9 + 11(m-1)), and the extraction is checked
 * against the one-day API itself: its civil column is compared with the `Begin
 * Civil Twilight` and `End Civil Twilight` of the corresponding response above,
 * for all thirty rows, before the nautical and astronomical columns are
 * trusted. Twenty-nine of the thirty agree exactly, which is what makes the
 * extraction safe; the thirtieth is Sydney on 21 June, where this table prints
 * 07:21 and the one-day answer 07:22 — a one-minute disagreement between two
 * USNO products, and a fair calibration of how precise the accepted values
 * really are. A cell USNO prints as `////` — the Sun never reaches that limit —
 * is `null` here.
 *
 * "Begin" is dawn and "End" is dusk, as PHENOMENA, not as clock order: at
 * Sydney on 1 January the UTC day opens in the evening, so civil dusk (09:38)
 * is the earlier of the two.
 */
export interface UsnoTwilightDay {
  readonly place: string;
  readonly date: string;
  /** [dawn, dusk] in UT as "hhmm", or null where USNO prints `////`. */
  readonly civil: readonly [string | null, string | null];
  readonly nautical: readonly [string | null, string | null];
  readonly astronomical: readonly [string | null, string | null];
}

/** Thirty days x three twilight limits. */
export const USNO_TWILIGHT_2026: readonly UsnoTwilightDay[] = [
  {
    place: "belgrade", date: "2026-01-01",
    civil: ["0542", "1541"],
    nautical: ["0505", "1618"],
    astronomical: ["0430", "1654"],
  },
  {
    place: "belgrade", date: "2026-03-20",
    civil: ["0412", "1720"],
    nautical: ["0338", "1754"],
    astronomical: ["0303", "1829"],
  },
  {
    place: "belgrade", date: "2026-06-21",
    civil: ["0215", "1905"],
    nautical: ["0125", "1954"],
    astronomical: ["0020", "2100"],
  },
  {
    place: "belgrade", date: "2026-09-23",
    civil: ["0357", "1703"],
    nautical: ["0323", "1737"],
    astronomical: ["0248", "1812"],
  },
  {
    place: "belgrade", date: "2026-10-15",
    civil: ["0424", "1623"],
    nautical: ["0350", "1657"],
    astronomical: ["0316", "1731"],
  },
  {
    place: "belgrade", date: "2026-12-21",
    civil: ["0539", "1534"],
    nautical: ["0502", "1611"],
    astronomical: ["0426", "1646"],
  },
  {
    place: "tromso", date: "2026-01-01",
    civil: ["0827", "1309"],
    nautical: ["0646", "1449"],
    astronomical: ["0529", "1607"],
  },
  {
    place: "tromso", date: "2026-03-20",
    civil: ["0344", "1802"],
    nautical: ["0228", "1919"],
    astronomical: ["0046", "2105"],
  },
  {
    place: "tromso", date: "2026-06-21",
    civil: [null, null],
    nautical: [null, null],
    astronomical: [null, null],
  },
  {
    place: "tromso", date: "2026-09-23",
    civil: ["0327", "1743"],
    nautical: ["0210", "1859"],
    astronomical: ["0026", "2040"],
  },
  {
    place: "tromso", date: "2026-10-15",
    civil: ["0453", "1605"],
    nautical: ["0344", "1714"],
    astronomical: ["0231", "1826"],
  },
  {
    place: "tromso", date: "2026-12-21",
    civil: ["0831", "1253"],
    nautical: ["0647", "1438"],
    astronomical: ["0528", "1556"],
  },
  {
    place: "quito", date: "2026-01-01",
    civil: ["1051", "2344"],
    nautical: ["1025", "0010"],
    astronomical: ["0959", "0036"],
  },
  {
    place: "quito", date: "2026-03-20",
    civil: ["1057", "2345"],
    nautical: ["1033", "0009"],
    astronomical: ["1009", "0033"],
  },
  {
    place: "quito", date: "2026-06-21",
    civil: ["1050", "2342"],
    nautical: ["1024", "0008"],
    astronomical: ["0957", "0034"],
  },
  {
    place: "quito", date: "2026-09-23",
    civil: ["1042", "2330"],
    nautical: ["1018", "2354"],
    astronomical: ["0954", "0018"],
  },
  {
    place: "quito", date: "2026-10-15",
    civil: ["1035", "2324"],
    nautical: ["1011", "2348"],
    astronomical: ["0947", "0013"],
  },
  {
    place: "quito", date: "2026-12-21",
    civil: ["1045", "2339"],
    nautical: ["1019", "0004"],
    astronomical: ["0953", "0031"],
  },
  {
    place: "sydney", date: "2026-01-01",
    civil: ["1819", "0938"],
    nautical: ["1744", "1014"],
    astronomical: ["1705", "1053"],
  },
  {
    place: "sydney", date: "2026-03-20",
    civil: ["1934", "0832"],
    nautical: ["1905", "0901"],
    astronomical: ["1835", "0930"],
  },
  {
    place: "sydney", date: "2026-06-21",
    civil: ["2032", "0721"],
    nautical: ["2001", "0753"],
    astronomical: ["1931", "0823"],
  },
  {
    place: "sydney", date: "2026-09-23",
    civil: ["1918", "0817"],
    nautical: ["1849", "0846"],
    astronomical: ["1819", "0915"],
  },
  {
    place: "sydney", date: "2026-10-15",
    civil: ["1848", "0834"],
    nautical: ["1817", "0904"],
    astronomical: ["1746", "0935"],
  },
  {
    place: "sydney", date: "2026-12-21",
    civil: ["1812", "0935"],
    nautical: ["1736", "1010"],
    astronomical: ["1657", "1050"],
  },
  {
    place: "reykjavik", date: "2026-01-01",
    civil: ["1003", "1700"],
    nautical: ["0855", "1808"],
    astronomical: ["0756", "1907"],
  },
  {
    place: "reykjavik", date: "2026-03-20",
    civil: ["0641", "2031"],
    nautical: ["0543", "2130"],
    astronomical: ["0437", "2237"],
  },
  {
    place: "reykjavik", date: "2026-06-21",
    civil: [null, null],
    nautical: [null, null],
    astronomical: [null, null],
  },
  {
    place: "reykjavik", date: "2026-09-23",
    civil: ["0626", "2013"],
    nautical: ["0527", "2111"],
    astronomical: ["0420", "2216"],
  },
  {
    place: "reykjavik", date: "2026-10-15",
    civil: ["0729", "1856"],
    nautical: ["0634", "1951"],
    astronomical: ["0537", "2047"],
  },
  {
    place: "reykjavik", date: "2026-12-21",
    civil: ["1003", "1649"],
    nautical: ["0854", "1758"],
    astronomical: ["0754", "1858"],
  },
];
