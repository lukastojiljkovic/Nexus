/**
 * The WIKI module („Reference"): what was read recently, and what was kept.
 *
 * **The store is the app's own.** `WikiStore` (migration 086) keeps the two
 * things the module's page shows in its „Skorije čitano" section — a visit log
 * and the bookmarks — and this tool reads exactly those. The ZIM files
 * themselves are not the profile's: they are packs this machine has, served
 * through `nx-zim://`, and reading one is the page's job.
 *
 * **Searching inside a reference is not this tool.** Whatever the knowledge base
 * already indexes comes back to the turn as a passage with a citation, and a
 * second search over the same files would be a worse copy of it.
 */

import { WikiStore, type WikiBookmark, type WikiHistoryEntry } from "@nexus/db";
import type { AssistantLocale, Tool } from "@nexus/core";
import { asArgs, asOptionalCount } from "./args.js";
import {
  assertLive,
  formatDayInSentence,
  guard,
  okResult,
  phrase,
  text,
  type AssistantPhrase,
  type ProfileDb,
} from "./support.js";

export interface WikiToolDeps {
  /** See `ToolDeps.profileDb`. */
  readonly profileDb: ProfileDb;
}

/** How many rows each half of the answer may carry when the model names no cap, and the ceiling it may ask for. */
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 40;

const HISTORY_HEADING: AssistantPhrase<[count: number]> = {
  sr: (count) => `Skorije čitano (${count}):`,
  en: (count) => `Recently read (${count}):`,
};

const BOOKMARKS_HEADING: AssistantPhrase<[count: number]> = {
  sr: (count) => `Obeleženo (${count}):`,
  en: (count) => `Kept (${count}):`,
};

const NO_HISTORY: { readonly sr: string; readonly en: string } = {
  sr: "Još ništa nije čitano iz referenci.",
  en: "Nothing has been read from the reference library yet.",
};

const NO_BOOKMARKS: { readonly sr: string; readonly en: string } = {
  sr: "Ništa nije obeleženo.",
  en: "Nothing is kept.",
};

const MORE: AssistantPhrase<[count: number]> = {
  sr: (count) => `…i još ${count}.`,
  en: (count) => `…and ${count} more.`,
};

const VISITED: AssistantPhrase<[day: string]> = {
  sr: (day) => `čitano ${day}`,
  en: (day) => `read ${day}`,
};

const KEPT: AssistantPhrase<[day: string]> = {
  sr: (day) => `sačuvano ${day}`,
  en: (day) => `kept ${day}`,
};

export function wikiTools(deps: WikiToolDeps): readonly Tool[] {
  const recent: Tool = {
    name: "wiki.recent",
    description: {
      sr: "Izlistava šta je skoro čitano iz referenci i šta je obeleženo. Koristi ga kada korisnik pita šta je čitao u vikipediji ili rečnicima na ovom računaru, ili šta je sačuvao za kasnije.",
      en: "Lists what was recently read from the reference library and what is kept. Use it when the user asks what they read in the offline Wikipedia or the dictionaries on this machine, or what they saved for later.",
    },
    parameters: {
      type: "object",
      properties: {
        limit: {
          type: "integer",
          minimum: 1,
          maximum: MAX_LIMIT,
          description: `How many rows each list may hold. Defaults to ${String(DEFAULT_LIMIT)}.`,
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
        const limit = asOptionalCount(args.limit, "limit", 1, MAX_LIMIT) ?? DEFAULT_LIMIT;
        const read = deps.profileDb(context.profileId, (db, id) => {
          const store = new WikiStore(db, id);
          return { history: store.history(), bookmarks: store.bookmarks() };
        });

        const lines: string[] = [];
        if (read.history.length === 0) {
          lines.push(text(context.locale, NO_HISTORY));
        } else {
          const shown = read.history.slice(0, limit);
          lines.push(phrase(context.locale, HISTORY_HEADING, read.history.length));
          lines.push(...shown.map((entry) => historyLine(context.locale, entry)));
          if (read.history.length > shown.length) {
            lines.push(phrase(context.locale, MORE, read.history.length - shown.length));
          }
        }
        if (read.bookmarks.length === 0) {
          lines.push(text(context.locale, NO_BOOKMARKS));
        } else {
          const shown = read.bookmarks.slice(0, limit);
          lines.push(phrase(context.locale, BOOKMARKS_HEADING, read.bookmarks.length));
          lines.push(...shown.map((entry) => bookmarkLine(context.locale, entry)));
          if (read.bookmarks.length > shown.length) {
            lines.push(phrase(context.locale, MORE, read.bookmarks.length - shown.length));
          }
        }
        return okResult(lines.join("\n"));
      }),
  };

  return [recent];
}

/** One visit: the page's own title, the article it is, and the day it was read. */
function historyLine(locale: AssistantLocale, entry: WikiHistoryEntry): string {
  const day = entry.visitedAt.slice(0, 10);
  const when = /^\d{4}-\d{2}-\d{2}$/.test(day)
    ? ` (${phrase(locale, VISITED, formatDayInSentence(locale, day))})`
    : "";
  return `- ${entry.title} — ${entry.zimPath}${when}`;
}

/** One kept place: the same two facts, and the day it was kept instead. */
function bookmarkLine(locale: AssistantLocale, entry: WikiBookmark): string {
  const day = entry.createdAt.slice(0, 10);
  const when = /^\d{4}-\d{2}-\d{2}$/.test(day)
    ? ` (${phrase(locale, KEPT, formatDayInSentence(locale, day))})`
    : "";
  return `- ${entry.title} — ${entry.zimPath}${when}`;
}
