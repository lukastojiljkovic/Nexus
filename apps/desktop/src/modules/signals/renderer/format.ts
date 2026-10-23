import {
  activeLocale,
  numberFormat,
} from "../../../renderer/src/moduleKit/moduleSurface.js";

/**
 * A frequency with its unit, in the active locale (or `locale`): „82,4 Hz".
 *
 * **The unit is appended, not asked of `Intl`.** ECMA-402 sanctions no hertz
 * unit, so `Intl.NumberFormat` with `unit: "hertz"` throws a RangeError, which
 * took the Tuner tab down in every release from 2.0.0 to 2.1.1. „Hz" reads the
 * same in both languages; the number keeps the locale's own decimal mark.
 */
export function formatHertz(value: number, locale = activeLocale()): string {
  return `${numberFormat({ maximumFractionDigits: 1 }, locale).format(value)} Hz`;
}
