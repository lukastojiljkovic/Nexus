/**
 * The clock, spelled once.
 *
 * The "HH:MM" formatter had been written out at three separate call sites — the
 * focus history, the notification centre and the calendar — which is three
 * chances for one of them to drift to a 12-hour clock. It is one function now,
 * and it reads the ACTIVE interface locale through `intl.ts`: the language
 * switches at runtime without a reload, so the formatter is requested AT USE
 * TIME rather than captured at import. `intl.ts` memoises it per locale, which
 * is what keeps construction off the save indicator's per-write path.
 */
import { dateTimeFormat } from "./intl.js";

/**
 * "HH:MM" in the host's local time zone for a real instant. An unparseable
 * string comes back untouched — the same refusal the other renderer formatters
 * make, because printing "Invalid Date" into a UI is worse than printing the
 * raw value somebody can at least recognise.
 */
export function formatClockTime(instant: string | Date): string {
  const date = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(date.getTime())) return typeof instant === "string" ? instant : "";
  return dateTimeFormat({ hour: "2-digit", minute: "2-digit" }).format(date);
}

/**
 * An instant as a full day + time label ("8. jul 2026. 14:32", "8 July 2026
 * 14:32"), in the active locale.
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
  const day = dateTimeFormat({ day: "numeric", month: "long", year: "numeric" }).format(date);
  return `${day} ${formatClockTime(date)}`;
}
