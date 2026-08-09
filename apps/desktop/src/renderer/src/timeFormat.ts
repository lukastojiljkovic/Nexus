/**
 * The clock, spelled once.
 *
 * `new Intl.DateTimeFormat("sr-Latn", { hour: "2-digit", minute: "2-digit" })`
 * had been written out at three separate call sites — the focus history, the
 * notification centre and the calendar — which is three chances for one of them
 * to drift to a 12-hour clock, or to plain `"sr"`, whose Latin tailoring is
 * wrong for š/č/ć (the same trap `Intl.Collator(["sr-Latn","sr"])` exists to
 * avoid one layer over). It is one function now.
 *
 * The formatter is constructed once rather than per call: `Intl` object
 * construction is the expensive part, and the save indicator asks for a time on
 * every write.
 */
const CLOCK = new Intl.DateTimeFormat("sr-Latn", { hour: "2-digit", minute: "2-digit" });

/**
 * "HH:MM" in the host's local time zone for a real instant. An unparseable
 * string comes back untouched — the same refusal the other renderer formatters
 * make, because printing "Invalid Date" into a UI is worse than printing the
 * raw value somebody can at least recognise.
 */
export function formatClockTime(instant: string | Date): string {
  const date = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(date.getTime())) return typeof instant === "string" ? instant : "";
  return CLOCK.format(date);
}

/** The day half of {@link formatArchiveInstant}, built once for the same reason. */
const DAY = new Intl.DateTimeFormat("sr-Latn", { day: "numeric", month: "long", year: "numeric" });

/**
 * An instant as a full sr-Latn day + time label ("8. jul 2026. 14:32").
 *
 * `formatClockTime` without the year would do for anything recent; this carries
 * it because what it labels never is by nature — a restore archive can have been
 * written at any time and its age is exactly what the user is judging, and the
 * date sync was switched on is a fact about a past decision.
 *
 * It LIVED IN `SettingsPage.tsx` and was imported from there by `App.tsx`'s undo
 * banner. That was fine while the screen that owned it was the only other
 * caller; a third caller in its own file („Sinhronizacija") would have had to
 * import a formatter from a page that imports it back, so it moved to the module
 * whose whole subject is „the clock, spelled once". Raw input on an unparseable
 * string, exactly as above.
 */
export function formatArchiveInstant(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${DAY.format(date)} ${CLOCK.format(date)}`;
}
