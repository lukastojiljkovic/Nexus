/**
 * The PANTRY module: what is about to go off, and putting something on the
 * shelf.
 *
 * **Nothing here decides what "soon" means.** The expiry verdict comes from
 * `@nexus/core`'s `stockStatus` over the item the store returned, with the two
 * inputs that function asks its CALLER for: today's day, which is main's clock,
 * and the window, which is the profile's own setting (`PantryStore.settings()`)
 * unless the model asked for a different one. That is the same pair the module's
 * page hands it, so a tool answer and the page cannot disagree about whether an
 * item expires this week.
 *
 * **The rule that produced a date is stated, not hidden.** An item can expire
 * from the date printed on it or from the day it was opened plus the "use
 * within" the user wrote down, and `effectiveExpiry` answers the earlier of the
 * two. The line therefore names the effective day, which is the only one that
 * matters, and leaves the store's other fields to the page that draws them.
 *
 * **A write resolves a shelf by name.** The user says "in the fridge", the page
 * says „Frižider", and the store takes an id — so the name is matched folded
 * against the profile's own locations, and a name nothing matches is a refusal
 * that lists the shelves that exist rather than a new one created behind the
 * user's back.
 */

import {
  MAX_PANTRY_EXPIRY_WINDOW_DAYS,
  PantryStore,
  type PantryItem,
  type PantryLocation,
} from "@nexus/db";
import {
  MAX_PANTRY_NAME_LENGTH,
  MAX_PANTRY_QUANTITY,
  MAX_PANTRY_USE_WITHIN_DAYS,
  PANTRY_CATEGORIES,
  PANTRY_UNITS,
  foldSearchText,
  stockStatus,
  type AssistantLocale,
  type PantryCategory,
  type PantryUnit,
  type Tool,
} from "@nexus/core";
import {
  asArgs,
  asEnum,
  asNumber,
  asOptionalCount,
  asOptionalDay,
  asOptionalEnum,
  asOptionalNumber,
  asOptionalText,
  asText,
} from "./args.js";
import {
  assertLive,
  confirmOrDecline,
  formatNumber,
  guard,
  localDay,
  okResult,
  phrase,
  text,
  type AssistantPhrase,
  type ProfileDb,
} from "./support.js";

export interface PantryToolDeps {
  /** See `ToolDeps.profileDb`. */
  readonly profileDb: ProfileDb;
  /** Main's wall clock: the "today" every expiry verdict is measured from, and the stamp a write carries. */
  readonly now: () => number;
}

/** How many items one read answers with when the model names no cap, and the ceiling it may ask for. */
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

/** The six units as the page names them, paired with the character the copy guarantees: every unit here is one or two characters. */
const UNIT_WORDS: Readonly<Record<PantryUnit, { readonly sr: string; readonly en: string }>> = {
  pcs: { sr: "kom", en: "pcs" },
  g: { sr: "g", en: "g" },
  kg: { sr: "kg", en: "kg" },
  ml: { sr: "ml", en: "ml" },
  l: { sr: "l", en: "l" },
  pack: { sr: "pakovanje", en: "pack" },
};

const CATEGORY_WORDS: Readonly<
  Record<PantryCategory, { readonly sr: string; readonly en: string }>
> = {
  food: { sr: "Hrana", en: "Food" },
  medicine: { sr: "Lekovi", en: "Medicine" },
  hygiene: { sr: "Higijena", en: "Hygiene" },
  emergency: { sr: "Za nepredviđeno", en: "Emergency" },
  other: { sr: "Ostalo", en: "Other" },
};

const EXPIRING_HEADING: AssistantPhrase<[count: number]> = {
  sr: (count) => `Ističe (${count}):`,
  en: (count) => `Expiring (${count}):`,
};

/** The window the answer used, said out loud: "expiring soon" is a different list at seven days and at thirty. */
const EXPIRING_WINDOW: AssistantPhrase<[days: string]> = {
  sr: (days) => `U narednih ${days}.`,
  en: (days) => `Within the next ${days}.`,
};

const EXPIRING_EMPTY: AssistantPhrase<[days: string]> = {
  sr: (days) => `Ništa ne ističe u narednih ${days}.`,
  en: (days) => `Nothing expires within the next ${days}.`,
};

const EXPIRING_MORE: AssistantPhrase<[count: number]> = {
  sr: (count) => `…i još ${count}.`,
  en: (count) => `…and ${count} more.`,
};

const EXPIRES_TODAY: { readonly sr: string; readonly en: string } = {
  sr: "ističe danas",
  en: "expires today",
};

const EXPIRES_IN: AssistantPhrase<[days: string]> = {
  sr: (days) => `ističe za ${days}`,
  en: (days) => `expires in ${days}`,
};

const EXPIRED_AGO: AssistantPhrase<[days: string]> = {
  sr: (days) => `isteklo pre ${days}`,
  en: (days) => `expired ${days} ago`,
};

const DAY_ONE: { readonly sr: string; readonly en: string } = { sr: "dan", en: "day" };
const DAY_MANY: { readonly sr: string; readonly en: string } = { sr: "dana", en: "days" };

const LOWS: AssistantPhrase<[quantity: string]> = {
  sr: (quantity) => `malo, fali ${quantity}`,
  en: (quantity) => `low, short by ${quantity}`,
};

const IN_LOCATION: AssistantPhrase<[name: string]> = {
  sr: (name) => `u „${name}“`,
  en: (name) => `in “${name}”`,
};

/**
 * The confirmation names the kind as well as the amount, because the kind is
 * the one field the model may have left out: an item added without one is food,
 * and the summary is where that decision becomes visible before anything is
 * written.
 */
const ADD_SUMMARY: AssistantPhrase<[name: string, quantity: string, category: string]> = {
  sr: (name, quantity, category) => `Dodaj „${name}“ u ostavu, ${quantity} (${category})`,
  en: (name, quantity, category) => `Add “${name}” to the pantry, ${quantity} (${category})`,
};

const ADDED: AssistantPhrase<[name: string, id: string]> = {
  sr: (name, id) => `Dodato u ostavu: „${name}“ (${id}).`,
  en: (name, id) => `Added to the pantry: “${name}” (${id}).`,
};

const UNKNOWN_LOCATION: AssistantPhrase<[name: string, known: string]> = {
  sr: (name, known) => `Nema mesta „${name}“ u ostavi. Postojeća mesta: ${known}.`,
  en: (name, known) => `No place “${name}” in the pantry. The places that exist: ${known}.`,
};

const NO_LOCATIONS: { readonly sr: string; readonly en: string } = {
  sr: "U ostavi još nema sačuvanih mesta; dodaj namirnicu bez mesta ili prvo napravi mesto u ostavi.",
  en: "The pantry has no saved places yet; add the item without one, or make a place in the pantry first.",
};

export function pantryTools(deps: PantryToolDeps): readonly Tool[] {
  const expiring: Tool = {
    name: "pantry.expiring",
    description: {
      sr: "Izlistava namirnice kojima ističe rok — one koje su već istekle i one koje ističu u zadatom broju dana. Koristi ga kada korisnik pita šta mu ističe ove nedelje ili šta treba pre da potroši.",
      en: "Lists the items whose expiry is near — the ones already expired and the ones expiring within the given number of days. Use it when the user asks what expires this week or what should be used first.",
    },
    parameters: {
      type: "object",
      properties: {
        days: {
          type: "integer",
          minimum: 0,
          maximum: MAX_PANTRY_EXPIRY_WINDOW_DAYS,
          description:
            "How many days ahead to look. Left out, the profile's own window is used.",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: MAX_LIMIT,
          description: `How many items to list. Defaults to ${String(DEFAULT_LIMIT)}.`,
        },
      },
      required: [],
      additionalProperties: false,
    },
    effect: "read",
    run: (rawArgs, context) =>
      guard(context, () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const asked = asOptionalCount(args.days, "days", 0, MAX_PANTRY_EXPIRY_WINDOW_DAYS);
        const limit = asOptionalCount(args.limit, "limit", 1, MAX_LIMIT) ?? DEFAULT_LIMIT;
        const today = localDay(deps.now());

        const read = deps.profileDb(context.profileId, (db, id) => {
          const store = new PantryStore(db, id);
          return {
            items: store.listItems(),
            locations: store.listLocations(),
            window: store.settings().expiryWindowDays,
          };
        });
        const days = asked ?? read.window;
        const soon: ExpiringEntry[] = [];
        for (const item of read.items) {
          const status = stockStatus(item, today, days);
          // `expired` and `soon` both carry a day; the guard is what makes the
          // day a number rather than a maybe, and an item with no date at all is
          // `none` and never reaches this list.
          if (status.daysUntilExpiry === null) continue;
          if (status.expiry !== "expired" && status.expiry !== "soon") continue;
          soon.push({ item, daysUntilExpiry: status.daysUntilExpiry, low: status.low });
        }
        // The most urgent first: everything already expired, longest past at the
        // top, then the nearest date. `stockStatus` answers whole days, so this
        // is the core engine's own arithmetic and not a second opinion.
        soon.sort(
          (left, right) =>
            left.daysUntilExpiry - right.daysUntilExpiry ||
            left.item.name.localeCompare(right.item.name),
        );

        if (soon.length === 0) {
          return okResult(phrase(context.locale, EXPIRING_EMPTY, daysText(context.locale, days)));
        }
        const shown = soon.slice(0, limit);
        const names = new Map(read.locations.map((location) => [location.id, location.name]));
        const lines = [
          phrase(context.locale, EXPIRING_HEADING, soon.length),
          phrase(context.locale, EXPIRING_WINDOW, daysText(context.locale, days)),
          ...shown.map((entry) => expiringLine(context.locale, entry, names)),
        ];
        if (soon.length > shown.length) {
          lines.push(phrase(context.locale, EXPIRING_MORE, soon.length - shown.length));
        }
        return okResult(lines.join("\n"));
      }),
  };

  const add: Tool = {
    name: "pantry.add",
    description: {
      sr: "Dodaje namirnicu u ostavu: naziv, količinu i jedinicu, uz vrstu, rok trajanja i mesto gde stoji. Koristi ga kada korisnik kaže da je nešto kupio ili doneo kući i želi da to ostane zapisano.",
      en: "Adds an item to the pantry: a name, a quantity and a unit, with its kind, its expiry date and where it sits. Use it when the user says they bought or brought something home and want it written down.",
    },
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", minLength: 1, maxLength: MAX_PANTRY_NAME_LENGTH, description: "What it is, as the user called it." },
        quantity: {
          type: "number",
          minimum: 0,
          maximum: MAX_PANTRY_QUANTITY,
          description: "How much is there, in the unit below (1.5 is allowed).",
        },
        unit: {
          type: "string",
          enum: [...PANTRY_UNITS],
          description: `One of: ${PANTRY_UNITS.join(", ")}.`,
        },
        category: {
          type: "string",
          enum: [...PANTRY_CATEGORIES],
          description: `One of: ${PANTRY_CATEGORIES.join(", ")}. Left out, it is food.`,
        },
        expiry: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "The printed expiry date, YYYY-MM-DD." },
        location: { type: "string", maxLength: 80, description: "The shelf it sits on, by the name the pantry already uses." },
        minQuantity: {
          type: "number",
          minimum: 0,
          maximum: MAX_PANTRY_QUANTITY,
          description: "Below this the item goes onto the shopping list by itself.",
        },
        opened: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "The day it was opened, YYYY-MM-DD." },
        useWithinDays: {
          type: "integer",
          minimum: 1,
          maximum: MAX_PANTRY_USE_WITHIN_DAYS,
          description: "How many days it keeps after opening. Needs \"opened\".",
        },
      },
      required: ["name", "quantity", "unit"],
      additionalProperties: false,
    },
    effect: "write",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const name = asText(args.name, "name", MAX_PANTRY_NAME_LENGTH);
        const quantity = asNumber(args.quantity, "quantity", 0, MAX_PANTRY_QUANTITY);
        const unit = asEnum(args.unit, "unit", PANTRY_UNITS);
        const category = asOptionalEnum(args.category, "category", PANTRY_CATEGORIES) ?? "food";
        const expiry = asOptionalDay(args.expiry, "expiry");
        const locationName = asOptionalText(args.location, "location", 80);
        const minQuantity = asOptionalNumber(args.minQuantity, "minQuantity", 0, MAX_PANTRY_QUANTITY);
        const opened = asOptionalDay(args.opened, "opened");
        const useWithinDays =
          args.useWithinDays === undefined
            ? undefined
            : asOptionalCount(args.useWithinDays, "useWithinDays", 1, MAX_PANTRY_USE_WITHIN_DAYS);
        // The two belong together in the store's own validation, so they are
        // refused here as a pair rather than left to the row's CHECK.
        if (useWithinDays !== undefined && opened === undefined) {
          throw new Error('"useWithinDays" needs an "opened" day beside it.');
        }

        const declined = await confirmOrDecline(
          context,
          "pantry.add",
          "write",
          phrase(
            context.locale,
            ADD_SUMMARY,
            name,
            quantityText(context.locale, quantity, unit),
            text(context.locale, CATEGORY_WORDS[category]),
          ),
        );
        if (declined !== null) return declined;

        const created = deps.profileDb(context.profileId, (db, id) => {
          const store = new PantryStore(db, id);
          const location = locationName === undefined ? null : resolveLocation(store.listLocations(), locationName, context.locale);
          return store.createItem(
            {
              name,
              quantity,
              unit,
              category,
              locationId: location,
              ...(expiry === undefined ? {} : { expiryDate: expiry }),
              ...(opened === undefined ? {} : { openedDate: opened }),
              ...(useWithinDays === undefined ? {} : { useWithinDays }),
              ...(minQuantity === undefined ? {} : { minQuantity }),
            },
            new Date(deps.now()).toISOString(),
          );
        });
        return okResult(phrase(context.locale, ADDED, created.name, created.id), {
          navigateTo: { module: "pantry" },
        });
      }),
  };

  return [expiring, add];
}

interface ExpiringEntry {
  readonly item: PantryItem;
  readonly daysUntilExpiry: number;
  readonly low: boolean;
}

/** One item: what it is, how much of it, where it sits, and the day that put it on this list. */
function expiringLine(
  locale: AssistantLocale,
  entry: ExpiringEntry,
  locations: ReadonlyMap<string, string>,
): string {
  const { item, daysUntilExpiry, low } = entry;
  const parts = [quantityText(locale, item.quantity, item.unit)];
  if (item.locationId !== null) {
    const place = locations.get(item.locationId);
    if (place !== undefined) parts.push(phrase(locale, IN_LOCATION, place));
  }
  parts.push(expiryText(locale, daysUntilExpiry));
  if (low) {
    parts.push(
      phrase(locale, LOWS, quantityText(locale, (item.minQuantity ?? 0) - item.quantity, item.unit)),
    );
  }
  return `- ${item.name}: ${parts.join(", ")}`;
}

/** The day an item goes off, as a person says it: today, in N days, or N days ago. */
function expiryText(locale: AssistantLocale, daysUntilExpiry: number): string {
  if (daysUntilExpiry === 0) return text(locale, EXPIRES_TODAY);
  if (daysUntilExpiry > 0) return phrase(locale, EXPIRES_IN, daysText(locale, daysUntilExpiry));
  return phrase(locale, EXPIRED_AGO, daysText(locale, -daysUntilExpiry));
}

/** „1 dan" / „5 dana", and the English half of each. */
function daysText(locale: AssistantLocale, days: number): string {
  return `${String(days)} ${text(locale, days === 1 ? DAY_ONE : DAY_MANY)}`;
}

/** A quantity with its unit, the way the pantry page writes one. */
function quantityText(locale: AssistantLocale, quantity: number, unit: PantryUnit): string {
  return `${formatNumber(locale, quantity)} ${text(locale, UNIT_WORDS[unit])}`;
}

/** The shelf id behind a name the user said, or a refusal naming the shelves that do exist. */
function resolveLocation(
  locations: readonly PantryLocation[],
  name: string,
  locale: AssistantLocale,
): string {
  if (locations.length === 0) throw new Error(text(locale, NO_LOCATIONS));
  const needle = foldSearchText(name.trim());
  const match = locations.find((location) => foldSearchText(location.name) === needle);
  if (match === undefined) {
    throw new Error(
      phrase(
        locale,
        UNKNOWN_LOCATION,
        name,
        locations.map((location) => location.name).join(", "),
      ),
    );
  }
  return match.id;
}

