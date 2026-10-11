/**
 * The MAPS module: the pins the user dropped on the offline map.
 *
 * **The store is the app's own.** `MapsStore` (migration 085) keeps a profile's
 * pins — a title, a note, a colour and a point — and this tool reads them and
 * nothing else. The map itself (tiles, style, place labels) comes out of an
 * installed pack through `nx-pack://` and belongs to the page; a pin is the
 * user's own mark and is what survives replacing that pack.
 *
 * **Coordinates are printed, not described.** A pin's answer is its latitude and
 * longitude, through `Intl` so the decimal mark is the reader's own, because
 * those two numbers are what somebody types into a different device. A tool that
 * said "near the Danube" would be inventing a place it cannot know.
 */

import { MapsStore, type MapsPin } from "@nexus/db";
import { foldSearchText, type AssistantLocale, type Tool } from "@nexus/core";
import { asArgs, asOptionalCount, asOptionalText } from "./args.js";
import {
  assertLive,
  formatCoordinate,
  guard,
  okResult,
  phrase,
  text,
  type AssistantPhrase,
  type ProfileDb,
} from "./support.js";

export interface MapsToolDeps {
  /** See `ToolDeps.profileDb`. */
  readonly profileDb: ProfileDb;
}

/** How many pins one read answers with when the model names no cap, and the ceiling it may ask for. */
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
/** The longest search a person types, matching the pin dialog's own title bound. */
const MAX_QUERY_CHARS = 120;

const HEADING: AssistantPhrase<[count: number]> = {
  sr: (count) => `Tačke (${count}):`,
  en: (count) => `Pins (${count}):`,
};

const EMPTY: { readonly sr: string; readonly en: string } = {
  sr: "Nema tačaka na mapi.",
  en: "There are no pins on the map.",
};

const NONE: AssistantPhrase<[query: string]> = {
  sr: (query) => `Nijedna tačka ne odgovara pretrazi „${query}“.`,
  en: (query) => `No pin matches the search “${query}”.`,
};

const MORE: AssistantPhrase<[count: number]> = {
  sr: (count) => `…i još ${count}.`,
  en: (count) => `…and ${count} more.`,
};

export function mapsTools(deps: MapsToolDeps): readonly Tool[] {
  const pins: Tool = {
    name: "maps.pins",
    description: {
      sr: "Izlistava tačke koje je korisnik spustio na mapi, sa nazivom, beleškom i koordinatama. Koristi ga kada korisnik pita gde je nešto obeležio ili šta ima na mapi.",
      en: "Lists the pins the user dropped on the map, with their title, note and coordinates. Use it when the user asks where they marked something or what is on their map.",
    },
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          minLength: 1,
          maxLength: MAX_QUERY_CHARS,
          description: "A word from the pin's title or its note. Accents do not matter.",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: MAX_LIMIT,
          description: `How many pins to list. Defaults to ${String(DEFAULT_LIMIT)}.`,
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
        const query = asOptionalText(args.query, "query", MAX_QUERY_CHARS);
        const limit = asOptionalCount(args.limit, "limit", 1, MAX_LIMIT) ?? DEFAULT_LIMIT;

        const all = deps.profileDb(context.profileId, (db, id) => new MapsStore(db, id).listPins());
        const matching = all.filter((pin) => query === undefined || matches(pin, query));
        if (matching.length === 0) {
          return okResult(
            query === undefined ? text(context.locale, EMPTY) : phrase(context.locale, NONE, query),
          );
        }
        const shown = matching.slice(0, limit);
        const lines = [
          phrase(context.locale, HEADING, matching.length),
          ...shown.map((pin) => pinLine(context.locale, pin)),
        ];
        if (matching.length > shown.length) {
          lines.push(phrase(context.locale, MORE, matching.length - shown.length));
        }
        return okResult(lines.join("\n"));
      }),
  };

  return [pins];
}

/** One pin: its title, its point, and the note the user wrote beside it. */
function pinLine(locale: AssistantLocale, pin: MapsPin): string {
  const point = `${formatCoordinate(locale, pin.lat)}, ${formatCoordinate(locale, pin.lon)}`;
  const note = pin.note?.trim() ?? "";
  return note.length === 0 ? `- ${pin.title} (${point})` : `- ${pin.title} (${point}) — ${note}`;
}

/** The folded match the app's own search uses: a word from the title or the note. */
function matches(pin: MapsPin, query: string): boolean {
  const needle = foldSearchText(query.trim());
  if (needle.length === 0) return false;
  return (
    foldSearchText(pin.title).includes(needle) ||
    foldSearchText(pin.note ?? "").includes(needle)
  );
}
