/**
 * The READER module: where each book was left, and what is bookmarked in it.
 *
 * **The store is the app's own.** `ReaderStore` (migration 084) keeps one
 * position per pack and the bookmarks the user set, and both reads here are its
 * own two methods — a reader that had a second opinion about "where I stopped"
 * would drop the user somewhere else than the page's „Nastavi" does.
 *
 * **The packs are named from the Packs service, and a missing one is said out
 * loud.** A position names a pack id; the title a person reads comes from the
 * installed-pack list, so a book that has since been removed is reported as
 * removed rather than as an id nobody recognises. That is the honest half of
 * the answer: the row survived the pack, and only the user can decide what to do
 * about it.
 *
 * **What this tool does not do is search a book.** Full-text search inside a
 * pack runs in main over an index it builds, and the assistant's own knowledge
 * base already answers with pack passages and their citations — a second search
 * here would be a worse copy of the one the turn already has.
 */

import { ReaderStore, type ReaderBookmark, type ReaderPosition } from "@nexus/db";
import type { AssistantLocale, Tool } from "@nexus/core";
import { asArgs, asOptionalCount } from "./args.js";
import type { PacksLookup } from "./packs.js";
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

export interface ReaderToolDeps {
  /** See `ToolDeps.profileDb`. */
  readonly profileDb: ProfileDb;
  /** The Packs service, for the title behind a pack id. */
  readonly packs: PacksLookup;
}

/** How many rows each half of the answer may carry when the model names no cap, and the ceiling it may ask for. */
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 40;

const POSITIONS_HEADING: AssistantPhrase<[count: number]> = {
  sr: (count) => `Nastavi sa čitanjem (${count}):`,
  en: (count) => `Continue reading (${count}):`,
};

const BOOKMARKS_HEADING: AssistantPhrase<[count: number]> = {
  sr: (count) => `Obeleživači (${count}):`,
  en: (count) => `Bookmarks (${count}):`,
};

const NOTHING_OPEN: { readonly sr: string; readonly en: string } = {
  sr: "Nijedna knjiga nije otvorena, pa nema gde da se nastavi.",
  en: "No book has been opened, so there is nothing to continue.",
};

const NO_BOOKMARKS: { readonly sr: string; readonly en: string } = {
  sr: "Nema obeleživača.",
  en: "There are no bookmarks.",
};

const MORE: AssistantPhrase<[count: number]> = {
  sr: (count) => `…i još ${count}.`,
  en: (count) => `…and ${count} more.`,
};

const LAST_READ: AssistantPhrase<[day: string]> = {
  sr: (day) => `poslednji put ${day}`,
  en: (day) => `last read ${day}`,
};

const NO_NOTE: { readonly sr: string; readonly en: string } = {
  sr: "bez beleške",
  en: "no note",
};

export function readerTools(deps: ReaderToolDeps): readonly Tool[] {
  const progress: Tool = {
    name: "reader.progress",
    description: {
      sr: "Kaže gde je korisnik stao sa čitanjem u svakoj instaliranoj knjizi i koji su obeleživači postavljeni. Koristi ga kada korisnik pita gde je stao, šta trenutno čita ili šta je obeležio.",
      en: "Says where the user stopped reading in each installed book, and which bookmarks are set. Use it when the user asks where they stopped, what they are reading, or what they bookmarked.",
    },
    parameters: {
      type: "object",
      properties: {
        limit: {
          type: "integer",
          minimum: 1,
          maximum: MAX_LIMIT,
          description: `How many positions and how many bookmarks to list. Defaults to ${String(DEFAULT_LIMIT)}.`,
        },
      },
      required: [],
      additionalProperties: false,
    },
    effect: "read",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const limit = asOptionalCount(args.limit, "limit", 1, MAX_LIMIT) ?? DEFAULT_LIMIT;

        const read = deps.profileDb(context.profileId, (db, id) => {
          const store = new ReaderStore(db, id);
          return { positions: store.listPositions(), bookmarks: store.listBookmarks() };
        });
        const packs = await deps.packs.list();
        const titles = new Map(packs.map((pack) => [pack.id, pack.title]));

        const lines: string[] = [];
        if (read.positions.length === 0) {
          lines.push(text(context.locale, NOTHING_OPEN));
        } else {
          const shown = read.positions.slice(0, limit);
          lines.push(phrase(context.locale, POSITIONS_HEADING, read.positions.length));
          lines.push(
            ...shown.map((position) =>
              positionLine(context.locale, position, packTitle(titles, position.packId, context.locale)),
            ),
          );
          if (read.positions.length > shown.length) {
            lines.push(phrase(context.locale, MORE, read.positions.length - shown.length));
          }
        }

        if (read.bookmarks.length === 0) {
          lines.push(text(context.locale, NO_BOOKMARKS));
        } else {
          const shown = read.bookmarks.slice(0, limit);
          lines.push(phrase(context.locale, BOOKMARKS_HEADING, read.bookmarks.length));
          lines.push(
            ...shown.map((bookmark) =>
              bookmarkLine(context.locale, bookmark, packTitle(titles, bookmark.packId, context.locale)),
            ),
          );
          if (read.bookmarks.length > shown.length) {
            lines.push(phrase(context.locale, MORE, read.bookmarks.length - shown.length));
          }
        }
        return okResult(lines.join("\n"));
      }),
  };

  return [progress];
}

/** Where one book was left: its title, the article, and the day it was last read. */
function positionLine(locale: AssistantLocale, position: ReaderPosition, title: string): string {
  const day = position.updatedAt.slice(0, 10);
  const when = /^\d{4}-\d{2}-\d{2}$/.test(day)
    ? ` (${phrase(locale, LAST_READ, formatDayInSentence(locale, day))})`
    : "";
  return `- ${title}: ${position.articlePath}${when}`;
}

/** One bookmark: its book, the article and the note beside it, or that there is none. */
function bookmarkLine(locale: AssistantLocale, bookmark: ReaderBookmark, title: string): string {
  const note = bookmark.note.trim();
  return `- ${title}: ${bookmark.articlePath} — ${note.length === 0 ? text(locale, NO_NOTE) : note}`;
}

/**
 * The installed pack's title, or the id it is known by when the pack is gone.
 *
 * The fallback is the id rather than a sentence about a missing pack: the id is
 * what the row itself carries, so a user who removed a book still recognises
 * which one this is about.
 */
function packTitle(
  titles: ReadonlyMap<string, { readonly sr: string; readonly en: string }>,
  packId: string,
  locale: AssistantLocale,
): string {
  const title = titles.get(packId);
  return title === undefined ? packId : text(locale, title);
}
