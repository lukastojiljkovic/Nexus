import type { InstalledPackView, PackText } from "../../shared/ipc.js";
import { collator, numberFormat } from "./intl.js";
import type { Locale } from "./strings.js";

/**
 * The Packs card's three pieces of presentation arithmetic, kept out of the
 * component so they can be tested without a DOM — `fileRows.ts`'s arrangement
 * for DOC's one formatter, applied to the three things this surface must not
 * get wrong: which language a pack's title is read in, the order the list is
 * drawn in, and how large a pack reads.
 */

/**
 * The pack's own copy, in the language being served.
 *
 * A PICK and never a fallback: a manifest carries both languages or it is
 * refused (`manifest.ts`), so there is no case in which one is missing and the
 * other has to stand in. A fallback here would hide a manifest that should have
 * been refused.
 */
export function packText(text: PackText, locale: Locale): string {
  return locale === "en" ? text.en : text.sr;
}

/**
 * Installed packs by their title in the active language, ties broken by id.
 *
 * The id is the tie-breaker rather than the version because two packs with the
 * same title are two different packs, and drawing them in id order is at least
 * stable across a language switch.
 */
export function sortPacksByTitle(
  packs: readonly InstalledPackView[],
  locale: Locale,
): InstalledPackView[] {
  const { compare } = collator({ sensitivity: "base" }, locale);
  return [...packs].sort(
    (left, right) =>
      compare(packText(left.title, locale), packText(right.title, locale)) ||
      compare(left.id, right.id),
  );
}

/** The units a pack's size is read in, smallest first. */
const SIZE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

/**
 * A pack's size, in the units a person reads sizes in.
 *
 * `fileRows.formatFileSize` stops at MB because it formats one attachment or
 * one screenful of them; a pack is measured in gigabytes, so this one keeps
 * going. One decimal past the first unit, and no more: a nineteenth-gigabyte
 * pack is „18,4 GB", which is what a user can check against the folder. The
 * number follows the ACTIVE locale through `intl.ts`, like every other number
 * this app prints.
 */
export function formatPackSize(bytes: number): string {
  const oneDecimal = numberFormat({ maximumFractionDigits: 1 });
  if (bytes < 1024) return `${String(bytes)} B`;
  let value = bytes / 1024;
  let unit = 1;
  while (value >= 1024 && unit < SIZE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${oneDecimal.format(value)} ${SIZE_UNITS[unit] ?? "B"}`;
}
