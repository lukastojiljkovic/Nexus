/**
 * PANTRY's arithmetic: when a thing actually expires, what is running out, and
 * what was thrown away.
 *
 * Three decisions run through the file.
 *
 * - **The expiry a person acts on is the EARLIER of two rules.** The date
 *   printed on the packet, and the day it was opened plus the „use within N
 *   days“ the packet also states. An unopened yoghurt is good until its printed
 *   date; the same yoghurt opened on Monday is finished on Thursday, and a
 *   surface that showed only the printed date would be telling somebody to eat
 *   something it should not. `effectiveExpiry` answers which rule won, so a
 *   screen can say WHY rather than printing a date that disagrees with the box.
 *
 * - **Status is derived on every read and never stored.** „Istice uskoro“ is a
 *   fact about today, and a stored verdict is wrong tomorrow — the
 *   `DocumentStore.deriveStatus` arrangement, restated for a pantry. The whole
 *   ladder is the caller's: the threshold is a parameter, because stage 2 reuses
 *   the document-expiry reminder ladder and this module has no business fixing a
 *   number the settings screen decides.
 *
 * - **„Low“ is independent of the expiry verdict.** An item can be low and
 *   perfectly in date, or full and expiring tomorrow, and collapsing the two
 *   into one word would make the shopping list and the expiry list disagree
 *   about the same row. They travel in one object and are answered separately.
 *
 * Nothing here reads a clock, a DOM or a `node:` module: every day comes in as a
 * bare `YYYY-MM-DD` from the caller, and every date calculation runs in UTC,
 * because the app's day keys are zone-less wall-clock strings and parsing them
 * with local-time `Date` semantics would be one day off for half the world
 * (`calendarGrid.ts`'s own rule).
 *
 * The two lists are read straight off the rows a caller hands over — no second
 * query, no lookup table — which is also why the item shape below is structural:
 * `@nexus/db`'s `PantryItem` satisfies it without adapting anything.
 */

import { isValidDayKey, dayKeyToUtcMs, shiftDayKey } from "../calendar/calendarGrid.js";
import type { DayKey } from "../calendar/calendarGrid.js";
import {
  PANTRY_CATEGORIES,
  isPantryCategory,
  type PantryCategory,
  type PantryLogReason,
  type PantryUnit,
} from "./pantryItem.js";

const MS_PER_DAY = 86_400_000;

/**
 * Serbian Latin ordering for the shopping list, on CLAUDE.md's house rule:
 * plain `"sr"` mis-tailors š/č/ć/đ, and SQLite's BINARY collation would put
 * „Šećer“ after „So“. Sorted HERE rather than deferred to the renderer for FIN's
 * reason — a store or an engine that hands back an order nobody fixes is a bug
 * waiting for the next slice to inherit.
 */
const PANTRY_COLLATOR = new Intl.Collator(["sr-Latn", "sr"]);

/** The caller got its own input wrong — a reference day or a period that is not two real days. */
export class PantryInputError extends Error {}

/**
 * The item fields the two lists and the status read. `@nexus/db`'s `PantryItem`
 * carries these and more, and satisfies this without adapting.
 */
export interface PantryStockItem {
  readonly id: string;
  readonly locationId: string | null;
  readonly name: string;
  readonly quantity: number;
  readonly unit: PantryUnit;
  readonly minQuantity: number | null;
  readonly expiryDate: string | null;
  readonly openedDate: string | null;
  readonly useWithinDays: number | null;
  /** When the user finished with this item, or null while it is current. An archived item is never „low“. */
  readonly archivedAt: string | null;
}

/** Which of the two rules produced an effective expiry. */
export type PantryExpirySource = "printed" | "opened";

export interface PantryEffectiveExpiry {
  readonly date: DayKey;
  readonly source: PantryExpirySource;
}

/** `none` is an item that carries no date at all — a fact, not a missing answer. */
export type PantryExpiryStatus = "expired" | "soon" | "ok" | "none";

export interface PantryStockStatus {
  readonly expiry: PantryExpiryStatus;
  /** The earlier of the two rules, or null when neither rule can produce a day. */
  readonly effectiveExpiry: PantryEffectiveExpiry | null;
  /** Whole days from the reference day to the effective expiry — negative once past it, 0 on the day itself. Null with no date. */
  readonly daysUntilExpiry: number | null;
  /** Below `minQuantity`, on its own axis — see the file header. */
  readonly low: boolean;
}

/** A location as the shopping list needs it: an id and the name to print. */
export interface PantryLocationRef {
  readonly id: string;
  readonly name: string;
}

export interface PantryShoppingLine {
  readonly itemId: string;
  readonly name: string;
  readonly unit: PantryUnit;
  readonly quantity: number;
  readonly minQuantity: number;
  /** What has to be bought to reach the minimum: `minQuantity - quantity`, always above zero. */
  readonly needed: number;
}

export interface PantryShoppingGroup {
  /** The location's id, or null for the items no live location holds. */
  readonly locationId: string | null;
  readonly locationName: string | null;
  readonly lines: readonly PantryShoppingLine[];
}

/** One log row as the waste report reads it — `@nexus/db`'s `PantryLogEntry` carries these and the id. */
export interface PantryWasteEntry {
  readonly itemId: string;
  /** The instant the change was stamped; its DATE PART is the day it counts for. */
  readonly changedAt: string;
  readonly delta: number;
  readonly reason: PantryLogReason;
}

export interface PantryWasteItem {
  readonly id: string;
  readonly category: PantryCategory;
}

export interface PantryWasteInput {
  readonly entries: readonly PantryWasteEntry[];
  readonly items: readonly PantryWasteItem[];
  /** The first day of the period, inclusive. */
  readonly from: DayKey;
  /** The last day of the period, inclusive. */
  readonly to: DayKey;
}

export interface PantryWasteRow {
  readonly category: PantryCategory;
  /** How much of this category was logged as thrown away in the period, as a positive quantity. */
  readonly quantity: number;
}

/**
 * The earlier of the printed expiry and „opened + use-within“, or null when
 * neither rule can produce a day.
 *
 * **A tie answers the PRINTED date.** When both rules land on the same day they
 * agree about the day and differ only about which label to show, and the date
 * the product itself carries is the one a person can check against the box.
 *
 * A date that is not a real calendar day is treated as NO date rather than as an
 * alarm: this function's input is a stored field that was validated on the way
 * in, so a value that is not a day is corruption, and the safe reading of
 * corrupt data on a food-safety screen is „nothing known“ — reporting a raw
 * string as „expired“ would be inventing a fact.
 */
export function effectiveExpiry(
  item: Pick<PantryStockItem, "expiryDate" | "openedDate" | "useWithinDays">,
): PantryEffectiveExpiry | null {
  const printed = isDay(item.expiryDate) ? item.expiryDate : null;
  const opened =
    isDay(item.openedDate) && item.useWithinDays !== null && Number.isSafeInteger(item.useWithinDays)
      ? shiftDayKey(item.openedDate, item.useWithinDays)
      : null;

  if (printed === null && opened === null) return null;
  if (opened === null) return { date: printed as DayKey, source: "printed" };
  if (printed === null || opened < printed) return { date: opened, source: "opened" };
  return { date: printed, source: "printed" };
}

/**
 * What this item is, today: its expiry verdict, the effective date behind it,
 * and — on its own axis — whether it is below its minimum.
 *
 * Boundaries, spelled out because they are the whole content of the function:
 * the day AFTER the expiry is `expired`; the expiry day itself is inside the
 * ladder and so `soon`; a day exactly `soonDays` away is `soon` and the day
 * after that is `ok`. That is `deriveStatus`'s rule exactly, so a pantry item
 * and a document warn on the same days.
 *
 * `today` and `soonDays` are the CALLER's own inputs — main stamps the clock and
 * the settings screen owns the ladder — so a reference day that is not a real
 * day, or a threshold that is not a whole number of days, is thrown rather than
 * answered. A silent „none“ there would hide an item from the very screen that
 * exists to warn about it.
 */
export function stockStatus(item: PantryStockItem, today: DayKey, soonDays: number): PantryStockStatus {
  if (!isValidDayKey(today)) {
    throw new PantryInputError(`"today" must be a real bare date (YYYY-MM-DD), got "${String(today)}".`);
  }
  if (!Number.isSafeInteger(soonDays) || soonDays < 0) {
    throw new PantryInputError(`"soonDays" must be a non-negative whole number of days, got ${String(soonDays)}.`);
  }

  const effective = effectiveExpiry(item);
  const low = item.minQuantity !== null && item.quantity < item.minQuantity;
  if (effective === null) {
    return { expiry: "none", effectiveExpiry: null, daysUntilExpiry: null, low };
  }

  const daysUntilExpiry = Math.round(
    (dayKeyToUtcMs(effective.date) - dayKeyToUtcMs(today)) / MS_PER_DAY,
  );
  const expiry: PantryExpiryStatus =
    daysUntilExpiry < 0 ? "expired" : daysUntilExpiry <= soonDays ? "soon" : "ok";
  return { expiry, effectiveExpiry: effective, daysUntilExpiry, low };
}

/**
 * What has to be bought, grouped by location.
 *
 * What is on the list: a live item whose quantity is BELOW its minimum. Exactly
 * at the minimum is not below it, an item with no minimum is never low, and an
 * ARCHIVED one is not on a shopping list at all — „gotov sam s ovim“ is a
 * statement about buying more of it, and leaving archived rows in would put
 * things the user has finished with back into their basket.
 *
 * Ordering: groups by the Serbian Latin collator over the location's name, with
 * the unassigned group LAST rather than first — a shelf is where you are going,
 * and „somewhere“ is what is left over. Lines within a group are collated by
 * item name, the same order the pantry list itself is read in. The locations'
 * own user order (the rank a store keeps) is deliberately not this list's
 * order: the brief asks for a collated list, and a shopping list that reshuffles
 * itself every time somebody drags a shelf around would be the wrong kind of
 * alive.
 *
 * An item whose `locationId` names nothing in `locations` is treated as
 * unassigned. A store's own reads cannot produce that (removing a location while
 * items sit in it is refused there), so it is a defensive reading rather than a
 * case to design for.
 */
export function shoppingList(
  items: readonly PantryStockItem[],
  locations: readonly PantryLocationRef[],
): PantryShoppingGroup[] {
  const namesById = new Map(locations.map((location) => [location.id, location.name]));
  const groups = new Map<string | null, PantryShoppingLine[]>();

  for (const item of items) {
    if (item.archivedAt !== null) continue;
    const minimum = item.minQuantity;
    if (minimum === null || item.quantity >= minimum) continue;
    const key = item.locationId !== null && namesById.has(item.locationId) ? item.locationId : null;
    const lines = groups.get(key) ?? [];
    lines.push({
      itemId: item.id,
      name: item.name,
      unit: item.unit,
      quantity: item.quantity,
      minQuantity: minimum,
      needed: minimum - item.quantity,
    });
    groups.set(key, lines);
  }

  return [...groups]
    .map(([locationId, lines]) => ({
      locationId,
      locationName: locationId === null ? null : (namesById.get(locationId) ?? null),
      lines: lines.sort(
        (left, right) =>
          PANTRY_COLLATOR.compare(left.name, right.name) || left.itemId.localeCompare(right.itemId),
      ),
    }))
    .sort((left, right) => {
      if (left.locationName === null && right.locationName === null) {
        return (left.locationId ?? "").localeCompare(right.locationId ?? "");
      }
      if (left.locationName === null) return 1;
      if (right.locationName === null) return -1;
      return PANTRY_COLLATOR.compare(left.locationName, right.locationName);
    });
}

/**
 * What was thrown away, per category, over an inclusive period.
 *
 * Only `expired` rows count. `used` is dinner and `bought` is a full shelf; the
 * one reason that means „this went in the bin“ is this one, which is why the
 * module enforces that an expired row carries a negative delta — so each row
 * contributes `-delta`, a positive quantity, and the report never has to guess a
 * sign.
 *
 * The day a row counts for is the DATE PART of `changedAt` in its own string,
 * exactly as `DocumentStore.deriveStatus` reads a date: no timezone conversion,
 * because the instant was stamped by the caller and converting it here would
 * move a late-evening change into another day for half the world.
 *
 * A category with nothing thrown away in the period is ABSENT rather than
 * present with a zero — `weeklyVolume`'s rule, and the caller drawing a chart
 * knows whether it wants to print „nothing wasted“ or „nothing recorded“.
 * Rows naming an item the caller did not hand over contribute nothing, which is
 * how a log that outlived a deleted item stops being counted.
 */
export function wasteReport(input: PantryWasteInput): PantryWasteRow[] {
  const { from, to } = input;
  if (!isValidDayKey(from) || !isValidDayKey(to)) {
    throw new PantryInputError(`"from" and "to" must be real bare dates (YYYY-MM-DD).`);
  }
  if (from > to) throw new PantryInputError(`"from" must not be after "to".`);

  const categoryById = new Map(
    input.items
      .filter((item) => isPantryCategory(item.category))
      .map((item) => [item.id, item.category] as const),
  );
  const totals = new Map<PantryCategory, number>();

  for (const entry of input.entries) {
    if (entry.reason !== "expired") continue;
    const day = entry.changedAt.slice(0, 10);
    if (!isValidDayKey(day) || day < from || day > to) continue;
    const category = categoryById.get(entry.itemId);
    if (category === undefined) continue;
    totals.set(category, (totals.get(category) ?? 0) - entry.delta);
  }

  return PANTRY_CATEGORIES.filter((category) => (totals.get(category) ?? 0) !== 0).map(
    (category) => ({ category, quantity: totals.get(category) as number }),
  );
}

/** A stored field is a day only when it is really one — see `effectiveExpiry`. */
function isDay(value: string | null): value is DayKey {
  return value !== null && isValidDayKey(value);
}
