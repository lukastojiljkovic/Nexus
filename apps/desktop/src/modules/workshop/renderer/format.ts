import { numberFormat } from "../../../renderer/src/intl.js";
import { copy } from "./copy.js";

/**
 * Every figure this module prints, in the active locale.
 *
 * **Why a factory per call and not a constant.** The language switches at run
 * time without a reload, and `intl.ts` memoises a formatter per locale and
 * options - so asking for one at the moment of use is what makes a ploča
 * re-read itself in the other language, and a module-scope `Intl.NumberFormat`
 * would be Serbian for the life of the process.
 *
 * **Why the unit words come from the module's own table.** "mm" is "mm" in both
 * languages, but "č" and "h" are not, and a duration is the one figure here
 * whose words differ. Keeping them in `copy` means the page and this file
 * cannot disagree about what a unit is called.
 */

/** Digits this module prints for a length: a tenth of a millimetre is the finest any printer holds. */
const LENGTH_DIGITS = 1;

/** A length in millimetres, e.g. „12,3 mm". */
export function millimetreText(value: number, digits = LENGTH_DIGITS): string {
  return `${numberFormat({ maximumFractionDigits: digits, minimumFractionDigits: digits }).format(value)} mm`;
}

/** An area in square millimetres, e.g. „600,00 mm²". */
export function millimetreSquareText(value: number): string {
  return `${numberFormat({ maximumFractionDigits: 2 }).format(value)} mm²`;
}

/** A volume in cubic millimetres, e.g. „1.000 mm³" - with grouping, because a print's volume runs to six figures. */
export function millimetreCubeText(value: number): string {
  return `${numberFormat({ maximumFractionDigits: 2 }).format(value)} mm³`;
}

/** A whole count with the locale's grouping: triangles, layers, segments. */
export function countText(value: number): string {
  return numberFormat({ maximumFractionDigits: 0 }).format(value);
}

/** Three bounds as one line: „10 × 10 × 10 mm". */
export function boundsText(size: readonly [number, number, number]): string {
  // The same tenth of a millimetre a single length carries, so the three figures
  // on this line and the ones on the cards beside it are written the same way.
  const format = numberFormat({
    maximumFractionDigits: LENGTH_DIGITS,
    minimumFractionDigits: LENGTH_DIGITS,
  });
  return `${format.format(size[0])} × ${format.format(size[1])} × ${format.format(size[2])} mm`;
}

/**
 * A duration in the reader's words: „2 č 35 min", „35 min", „48 s".
 *
 * Two units at most, largest first, and the seconds are dropped once there is
 * an hour to show: a print estimate that reads „2 č 35 min 7 s" is claiming a
 * precision its own arithmetic does not have. A figure under a minute is
 * seconds, because "0 min" would say nothing.
 */
export function durationText(seconds: number): string {
  const whole = Number.isFinite(seconds) ? Math.max(0, Math.round(seconds)) : 0;
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = whole % 60;
  const units = copy.units;
  if (hours > 0) return `${countText(hours)} ${units.hour} ${countText(minutes)} ${units.minute}`;
  if (minutes > 0) return `${countText(minutes)} ${units.minute}`;
  return `${countText(rest)} ${units.second}`;
}

/**
 * One file's name with its path, for the recently-opened list: the name is what
 * a person recognises, and the directory is what tells two files of the same
 * name apart. The split is on both separators, because a path in that list may
 * have been written by either platform.
 */
export function pathParts(path: string): { readonly name: string; readonly directory: string } {
  const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  if (cut < 0) return { name: path, directory: "" };
  return { name: path.slice(cut + 1), directory: path.slice(0, cut + 1) };
}
