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
