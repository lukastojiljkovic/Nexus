/**
 * The wiki page's pure half: the URL a frame is pointed at, the numbers it
 * draws, and nothing that touches React or main.
 *
 * **Why the URL is NOT built here.** Main answers an opened entry with the
 * address to load, because the address is the SERVER's: `main/zim/paths.ts` owns
 * the one percent-encoder, and a second one in the renderer would be a second
 * answer to what a Cyrillic title looks like on the wire — with only one of the
 * two accepted by the `nx-zim://` handler. The page's job is to put that string
 * in an `src`.
 *
 * **Why the byte formatter lives here.** A pack is 3.6 MB or 119 GB and both
 * numbers are drawn on the same card, so the unit is chosen by magnitude and the
 * NUMBER goes through `Intl` in the interface's language — Serbian writes
 * `1,9 GB` where English writes `1.9 GB`, and a hand-rolled `toFixed(1)` would
 * make the two locales disagree about a decimal point.
 */

/** The tag `Intl` gets for one interface language. `sr-Latn`, because the app's Serbian is Latin script. */
export function localeTag(locale: string): string {
  return locale === "en" ? "en" : "sr-Latn";
}

/** The units `formatBytes` chooses between, in the order it tries them. */
const BYTE_UNITS = [
  { suffix: "GB", divisor: 1024 ** 3, digits: 1 },
  { suffix: "MB", divisor: 1024 ** 2, digits: 1 },
  { suffix: "KB", divisor: 1024, digits: 0 },
  { suffix: "B", divisor: 1, digits: 0 },
] as const;

/** A byte count as a person reads it: the number through `Intl`, the unit by magnitude. */
export function formatBytes(bytes: number, tag: string): string {
  const unit = BYTE_UNITS.find((candidate) => bytes >= candidate.divisor) ?? BYTE_UNITS[3];
  const value = bytes / unit.divisor;
  const number = new Intl.NumberFormat(tag, {
    maximumFractionDigits: unit.digits,
    minimumFractionDigits: 0,
  }).format(Number.isFinite(value) ? value : 0);
  return `${number} ${unit.suffix}`;
}

/** A download's completion, 0…100, floored at 0 and capped at 100. */
export function progressPercent(receivedBytes: number, totalBytes: number): number {
  if (!Number.isFinite(totalBytes) || totalBytes <= 0) return 0;
  const percent = Math.floor((receivedBytes / totalBytes) * 100);
  return Math.max(0, Math.min(100, percent));
}

/** One entry's name as a list row draws it: the title the file gave it, or the path. */
export function entryLabel(title: string, zimPath: string): string {
  return title === "" ? zimPath : title;
}
