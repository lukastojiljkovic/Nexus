import { isValidDayKey } from "@nexus/core";
import type { PantryStockStatus } from "@nexus/core";
import {
  collator,
  dateTimeFormat,
  decimalSeparator,
  decimalSeparators,
  numberFormat,
} from "../../../renderer/src/intl.js";
import { dayUnit, fill } from "../../../renderer/src/strings.js";
import type { PantryItemView, PantryLocationView } from "../shared/ipc.js";
import { copy } from "./copy.js";

/**
 * The pantry page's pure half: everything the page decides that is not "draw a
 * row".
 *
 * **Why these are here and not in the component.** Each one is a rule with an
 * answer worth pinning - which items are urgent and in what order, how a
 * quantity reads in the interface's language, how a bare day key becomes a date
 * - and a rule that lives inside a render pass can only be checked by looking at
 * a screen. `pantryPage.test.ts` computes each expectation by hand.
 *
 * **Every number, date and noun form goes through `Intl`, in the ACTIVE
 * locale.** `intl.ts` is the renderer's one door to it, and its factories are
 * asked at use time rather than captured at module scope, so a language switch
 * moves these strings with the rest of the interface. The noun beside a count is
 * `strings.ts`'s `dayUnit`, which asks `Intl.PluralRules` - Serbian's 1 / 21
 * against its 5 / 11 is the whole reason that function exists.
 *
 * Nothing here reads a clock: the day the verdicts belong to is stamped by MAIN
 * and arrives on the view, so the page and the reminder cannot disagree about
 * which day "istice danas" is.
 */

/** The two forms of a counted day, as a copy table carries them. */
export interface DayWords {
  readonly day: string;
  readonly days: string;
}

/** A quantity as it is read: the locale's number, a space, and the unit's own name. */
export function formatQuantity(value: number, unitName: string): string {
  return `${numberFormat({ maximumFractionDigits: 3 }).format(value)} ${unitName}`;
}

/**
 * A quantity inside a counted sentence — "Fali 1,5 l", "Short by 2 pcs".
 *
 * `countedPhrase` is the WRONG tool for the same job one line up: its noun is a
 * counted day ("dana", "days"), and a shelf measures litres. So the number goes
 * through the same `Intl` formatter and the unit's own name is slotted in.
 */
export function quantityPhrase(template: string, quantity: number, unitName: string): string {
  return fill(template, {
    count: numberFormat({ maximumFractionDigits: 3 }).format(quantity),
    unit: unitName,
  });
}

/**
 * A bare day key as a date.
 *
 * The key is zone-less, so it is built at UTC midnight and FORMATTED in UTC:
 * letting a formatter read it in local time would move "2026-06-01" into May for
 * anybody west of Greenwich, which is the one thing a day key exists to avoid. A
 * value that is not a real calendar day ("2026-13-01", which `Date.UTC` would
 * happily roll into January) is returned as it stands rather than thrown on -
 * the `formatExamDate` rule: a screen in front of a person never shows an
 * exception.
 */
export function formatDay(dayKey: string): string {
  if (!isValidDayKey(dayKey)) return dayKey;
  const at = Date.UTC(
    Number(dayKey.slice(0, 4)),
    Number(dayKey.slice(5, 7)) - 1,
    Number(dayKey.slice(8, 10)),
  );
  return dateTimeFormat({
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(at);
}

/**
 * A quantity typed into a field, or null.
 *
 * The decimal mark of ANY locale this build serves is accepted, because a
 * prefilled value may have been written under either - `decimalSeparators` is
 * derived from `Intl` for exactly this. Up to three fraction digits: a pantry
 * measures half a litre and a quarter of a kilo, and a fourth digit is a
 * keystroke nobody makes on purpose.
 */
export function parseQuantityInput(text: string): number | null {
  const separators = decimalSeparators()
    .map((separator) => separator.replace(/[\\\]^-]/g, "\\$&"))
    .join("");
  const match = new RegExp(`^(\\d+)(?:[${separators}](\\d{1,3}))?$`).exec(text.trim());
  if (match === null) return null;
  const [, whole = "", fraction] = match;
  const value = Number(fraction === undefined ? whole : `${whole}.${fraction}`);
  return Number.isFinite(value) ? value : null;
}

/** A quantity as a field holds it - the active locale's decimal mark, no grouping. */
export function quantityInputValue(value: number): string {
  return String(value).replace(".", decimalSeparator());
}

/**
 * One counted sentence, filled.
 *
 * `template` is the copy table's own `{count} {unit}` sentence and the noun is
 * `dayUnit`'s choice, which is what lets "Isteklo pre 2 dana" and "Expired 2
 * days ago" be one call with two templates rather than two code paths.
 */
export function countedPhrase(template: string, count: number, words: DayWords): string {
  return fill(template, { count, unit: dayUnit(count, words.day, words.days) });
}

/** The words one expiry verdict needs, as a copy table carries them. */
export interface ExpiryWords extends DayWords {
  readonly today: string;
  readonly soon: string;
  readonly past: string;
  readonly ok: string;
  readonly none: string;
}

/**
 * Those words, gathered from the live table at USE time.
 *
 * Every leaf is named rather than spread, and that is `check:copy`'s rule
 * answering the question "is this sentence read": a spread hands the subtree
 * over without naming anything, so the gate cannot tell a table that IS read
 * from one that ships and is never drawn. One function, used by the page and by
 * the dashboard card, is also what keeps the two surfaces from gathering the
 * same words twice and drifting apart.
 */
export function expiryWords(): ExpiryWords {
  return {
    day: copy.common.day,
    days: copy.common.days,
    today: copy.expiring.today,
    soon: copy.expiring.soon,
    past: copy.expiring.past,
    ok: copy.expiring.ok,
    none: copy.expiring.none,
  };
}

/**
 * What an item's expiry verdict SAYS, in the interface's language.
 *
 * The ladder is `@nexus/core`'s and this function only names it: the day after
 * the expiry is "Isteklo", the expiry day itself is "Istice danas", every day
 * inside the window is "Istice za N dana", and the first day past the window is
 * "U roku". An item that carries no date at all says so.
 */
export function expiryLabel(status: PantryStockStatus, words: ExpiryWords): string {
  const days = status.daysUntilExpiry;
  if (status.expiry === "none" || days === null) return words.none;
  if (days < 0) return countedPhrase(words.past, -days, words);
  if (days === 0) return words.today;
  return status.expiry === "soon" ? countedPhrase(words.soon, days, words) : words.ok;
}

/** Which chip an expiry verdict wears. Colour never carries it alone: the chip always carries these words too. */
export function expiryChipVariant(status: PantryStockStatus): "danger" | "accent" | "neutral" {
  if (status.expiry === "expired") return "danger";
  if (status.expiry === "soon") return "accent";
  return "neutral";
}

/**
 * The items worth a place in the expiring list, most urgent first: everything
 * already past its date, then everything inside the window, each group ordered
 * by how many days are left.
 *
 * **An archived item is never urgent.** Archiving says "I am done with this" —
 * the thing may well have been thrown away, and a shelf that kept announcing it
 * would be the app arguing with the user about their own kitchen. It is the same
 * rule the shopping list keeps (`shoppingList` leaves archived rows out), for the
 * same reason, and `main/register.ts`'s reminder keeps it too.
 *
 * The tie-break is the Serbian Latin collator on the name, so two items of the
 * same age read in the order the pantry list itself reads in - the order
 * `@nexus/core`'s own collated reads use.
 */
export function urgentItems(items: readonly PantryItemView[]): PantryItemView[] {
  const compare = collator();
  return items
    .filter(
      (item) =>
        item.archivedAt === null &&
        (item.status.expiry === "expired" || item.status.expiry === "soon"),
    )
    .sort(
      (left, right) =>
        (left.status.daysUntilExpiry ?? 0) - (right.status.daysUntilExpiry ?? 0) ||
        compare.compare(left.name, right.name) ||
        left.id.localeCompare(right.id),
    );
}

/** One shelf and the items standing on it. `locationId: null` is the group no shelf names. */
export interface PantryItemGroup {
  readonly locationId: string | null;
  readonly items: readonly PantryItemView[];
}

/**
 * The stock list, grouped by shelf in the USER's own order, with the items no
 * shelf names LAST rather than first.
 *
 * The order within a group is the store's (sr-Latn, by name) and is left alone;
 * what this adds is the grouping. A location id that names nothing - which a
 * store cannot produce, since removing a shelf that still holds items is refused
 * there - falls into the unassigned group rather than disappearing from the
 * screen, which is the defensive reading `shoppingList` takes for the same case.
 */
export function groupItemsByLocation(
  items: readonly PantryItemView[],
  locations: readonly PantryLocationView[],
): PantryItemGroup[] {
  const known = new Set(locations.map((location) => location.id));
  const groups: PantryItemGroup[] = [];
  for (const location of locations) {
    const held = items.filter((item) => item.locationId === location.id);
    if (held.length > 0) groups.push({ locationId: location.id, items: held });
  }
  const loose = items.filter((item) => item.locationId === null || !known.has(item.locationId));
  if (loose.length > 0) groups.push({ locationId: null, items: loose });
  return groups;
}

/**
 * The stock list in the order the page draws it: current items first, archived
 * ones after them.
 *
 * Archiving is not deleting (migration 075), so an archived item is still a row
 * with a name - it simply is not something the user is shopping for. Splitting
 * them here is what lets the page draw one disclosure under the list rather than
 * a `muted` flag on rows that mean two different things.
 */
export function splitArchived(items: readonly PantryItemView[]): {
  current: PantryItemView[];
  archived: PantryItemView[];
} {
  return {
    current: items.filter((item) => item.archivedAt === null),
    archived: items.filter((item) => item.archivedAt !== null),
  };
}
