/**
 * The LIBRARY module: what is on the shelf, and putting a title on it.
 *
 * **The store is the app's own.** `LibraryStore` (migration 072) is what the
 * module's page calls, and both tools here go through it: `listItems()` returns
 * the live works already in the app's one order (the sr-Latn collation the store
 * sorts by), and `createItem` is the very call the page's own add form makes. No
 * second reader of `library_items` exists behind this file.
 *
 * **Where the words come from.** The kinds and the statuses are `@nexus/core`'s
 * `LIBRARY_KINDS`/`LIBRARY_STATUSES`, and the labels beside them are the page's
 * own words („Knjiga", „U toku"), restated here because the page's copy table is
 * part of the renderer's bundle and main cannot read it. A tool that answered
 * „in progress" in Serbian while the page says „U toku" would be inventing a
 * second vocabulary for one screen.
 *
 * **The search is the app's folding rule.** `foldSearchText` is the one folding
 * table in this repository, so „cuprija" finds „Na Drini ćuprija" here exactly
 * as it does in the palette. A second match that only found what was typed with
 * the right accents would be a worse answer than no search at all.
 *
 * **Why a write settles for opening the module.** `AppLocation` names a module
 * and an item, and a kit module's page is handed a profile id and nothing else
 * (`shared/moduleApi.ts`), so a row id in `navigateTo` would be a promise no
 * surface keeps. The tool therefore opens the module and leaves the new row's id
 * in the text, where the model can read it.
 */

import { LibraryStore, type LibraryItemWithCover } from "@nexus/db";
import {
  LIBRARY_KINDS,
  LIBRARY_MAX_CREATOR_LENGTH,
  LIBRARY_MAX_CREATORS,
  LIBRARY_MAX_SUMMARY_LENGTH,
  LIBRARY_MAX_TAG_LENGTH,
  LIBRARY_MAX_TAGS,
  LIBRARY_MAX_TITLE_LENGTH,
  LIBRARY_MAX_YEAR,
  LIBRARY_MIN_YEAR,
  LIBRARY_STATUSES,
  foldSearchText,
  type AssistantLocale,
  type LibraryKind,
  type LibraryStatus,
  type Tool,
} from "@nexus/core";
import {
  asArgs,
  asEnum,
  asOptionalCount,
  asOptionalEnum,
  asOptionalText,
  asOptionalTextList,
  asText,
} from "./args.js";
import {
  assertLive,
  confirmOrDecline,
  guard,
  okResult,
  phrase,
  text,
  type AssistantPhrase,
  type ProfileDb,
} from "./support.js";

export interface LibraryToolDeps {
  /** See `ToolDeps.profileDb`. */
  readonly profileDb: ProfileDb;
  /** Main's wall clock, stamped into the row a write creates. */
  readonly now: () => number;
}

/** How many works one read answers with when the model names no cap, and the ceiling it may ask for. */
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
/** The longest query the shelf's own search box takes, so a model cannot ask a wider question than a person can. */
const MAX_QUERY_CHARS = 200;

/**
 * The three kinds and four statuses as the page names them.
 *
 * The ratings bounds are read from the constants rather than restated, and the
 * two label tables cover EVERY member of their union: a status added to core
 * without a word here is a compile error, which is the only way this file can be
 * made to keep the page's vocabulary.
 */
const KIND_WORDS: Readonly<Record<LibraryKind, { readonly sr: string; readonly en: string }>> = {
  book: { sr: "Knjiga", en: "Book" },
  film: { sr: "Film", en: "Film" },
  series: { sr: "Serija", en: "Series" },
};

const STATUS_WORDS: Readonly<Record<LibraryStatus, { readonly sr: string; readonly en: string }>> = {
  planned: { sr: "Želim", en: "Wanted" },
  "in-progress": { sr: "U toku", en: "In progress" },
  done: { sr: "Završeno", en: "Finished" },
  dropped: { sr: "Napušteno", en: "Dropped" },
};

const SHELF_HEADING: AssistantPhrase<[count: number]> = {
  sr: (count) => `Na polici (${count}):`,
  en: (count) => `On the shelf (${count}):`,
};

const SHELF_EMPTY: { readonly sr: string; readonly en: string } = {
  sr: "Biblioteka je prazna.",
  en: "The library is empty.",
};

const SHELF_NONE: AssistantPhrase<[query: string]> = {
  sr: (query) => `Nijedan naslov ne odgovara pretrazi „${query}“.`,
  en: (query) => `No title matches the search “${query}”.`,
};

/** Says how many rows the cap left out, so a cut list is never read as the whole shelf. */
const SHELF_MORE: AssistantPhrase<[count: number]> = {
  sr: (count) => `…i još ${count}.`,
  en: (count) => `…and ${count} more.`,
};

const RATING_WORD: AssistantPhrase<[rating: number]> = {
  sr: (rating) => `ocena ${rating}/10`,
  en: (rating) => `rated ${rating}/10`,
};

const PAGES_WORD: AssistantPhrase<[read: number, total: number]> = {
  sr: (read, total) => `${read}/${total} str.`,
  en: (read, total) => `${read}/${total} p.`,
};

const PAGES_ONLY: AssistantPhrase<[read: number]> = {
  sr: (read) => `${read} str.`,
  en: (read) => `${read} p.`,
};

const SEASON_EPISODE: AssistantPhrase<[season: string, episode: string]> = {
  sr: (season, episode) => `S${season}E${episode}`,
  en: (season, episode) => `S${season}E${episode}`,
};

const ADD_SUMMARY: AssistantPhrase<[title: string, kind: string]> = {
  sr: (title, kind) => `Dodaj „${title}“ u biblioteku (${kind})`,
  en: (title, kind) => `Add “${title}” to the library (${kind})`,
};

const ADDED: AssistantPhrase<[title: string, id: string]> = {
  sr: (title, id) => `Dodato u biblioteku: „${title}“ (${id}).`,
  en: (title, id) => `Added to the library: “${title}” (${id}).`,
};

export function libraryTools(deps: LibraryToolDeps): readonly Tool[] {
  const shelf: Tool = {
    name: "library.shelf",
    description: {
      sr: "Čita biblioteku: šta je na listi želja, šta je u toku i šta je završeno, uz autore, godinu, ocenu i napredak. Koristi ga kada korisnik pita šta čita ili gleda, šta je završio ili šta mu je na listi.",
      en: "Reads the library: what is on the wish list, what is in progress and what is finished, with creators, year, rating and progress. Use it when the user asks what they are reading or watching, what they have finished, or what is on their list.",
    },
    parameters: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: [...LIBRARY_STATUSES],
          description: 'One status only: "planned", "in-progress", "done" or "dropped".',
        },
        kind: {
          type: "string",
          enum: [...LIBRARY_KINDS],
          description: 'One kind only: "book", "film" or "series".',
        },
        query: {
          type: "string",
          minLength: 1,
          maxLength: MAX_QUERY_CHARS,
          description: "A word from the title, a creator or a tag. Accents do not matter.",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: MAX_LIMIT,
          description: `How many works to list. Defaults to ${String(DEFAULT_LIMIT)}.`,
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
        const status = asOptionalEnum(args.status, "status", LIBRARY_STATUSES);
        const kind = asOptionalEnum(args.kind, "kind", LIBRARY_KINDS);
        const query = asOptionalText(args.query, "query", MAX_QUERY_CHARS);
        const limit = asOptionalCount(args.limit, "limit", 1, MAX_LIMIT) ?? DEFAULT_LIMIT;

        const items = deps.profileDb(context.profileId, (db, id) =>
          new LibraryStore(db, id).listItems(),
        );
        const matching = items.filter(
          (item) =>
            (status === undefined || item.status === status) &&
            (kind === undefined || item.kind === kind) &&
            (query === undefined || matches(item, query)),
        );
        if (matching.length === 0) {
          return okResult(
            query === undefined
              ? text(context.locale, SHELF_EMPTY)
              : phrase(context.locale, SHELF_NONE, query),
          );
        }
        const shown = matching.slice(0, limit);
        const lines = [
          phrase(context.locale, SHELF_HEADING, matching.length),
          ...shown.map((item) => itemLine(context.locale, item)),
        ];
        if (matching.length > shown.length) {
          lines.push(phrase(context.locale, SHELF_MORE, matching.length - shown.length));
        }
        return okResult(lines.join("\n"));
      }),
  };

  const add: Tool = {
    name: "library.add",
    description: {
      sr: "Dodaje naslov u biblioteku: knjigu, film ili seriju, sa autorima, godinom i oznakama. Novi naslov je uvek na listi želja dok se ne zabeleži čitanje. Koristi ga kada korisnik kaže da želi da zapamti nešto što će čitati ili gledati.",
      en: "Adds a title to the library: a book, a film or a series, with its creators, year and tags. A new title is always on the wish list until a reading is recorded. Use it when the user says they want to remember something they will read or watch.",
    },
    parameters: {
      type: "object",
      properties: {
        title: {
          type: "string",
          minLength: 1,
          maxLength: LIBRARY_MAX_TITLE_LENGTH,
          description: "The work's title, as the user said it.",
        },
        kind: {
          type: "string",
          enum: [...LIBRARY_KINDS],
          description: '"book", "film" or "series".',
        },
        creators: {
          type: "array",
          maxItems: LIBRARY_MAX_CREATORS,
          items: { type: "string", minLength: 1, maxLength: LIBRARY_MAX_CREATOR_LENGTH },
          description: "Authors, directors or creators, in the order the user gave them.",
        },
        year: {
          type: "integer",
          minimum: LIBRARY_MIN_YEAR,
          maximum: LIBRARY_MAX_YEAR,
          description: "The year of the edition or the release, when the user named one.",
        },
        summary: {
          type: "string",
          maxLength: LIBRARY_MAX_SUMMARY_LENGTH,
          description: "A short note about the work, in the user's words. Not a review.",
        },
        tags: {
          type: "array",
          maxItems: LIBRARY_MAX_TAGS,
          items: { type: "string", minLength: 1, maxLength: LIBRARY_MAX_TAG_LENGTH },
          description: "Tags, as the user said them.",
        },
      },
      required: ["title", "kind"],
      additionalProperties: false,
    },
    effect: "write",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const title = asText(args.title, "title", LIBRARY_MAX_TITLE_LENGTH);
        const kind = asEnum(args.kind, "kind", LIBRARY_KINDS);
        const creators = asOptionalTextList(
          args.creators,
          "creators",
          LIBRARY_MAX_CREATORS,
          LIBRARY_MAX_CREATOR_LENGTH,
        );
        const tags = asOptionalTextList(args.tags, "tags", LIBRARY_MAX_TAGS, LIBRARY_MAX_TAG_LENGTH);
        const year = asOptionalCount(args.year, "year", LIBRARY_MIN_YEAR, LIBRARY_MAX_YEAR);
        const summary = asOptionalText(args.summary, "summary", LIBRARY_MAX_SUMMARY_LENGTH);

        const declined = await confirmOrDecline(
          context,
          "library.add",
          "write",
          phrase(context.locale, ADD_SUMMARY, title, text(context.locale, KIND_WORDS[kind])),
        );
        if (declined !== null) return declined;

        const created = deps.profileDb(context.profileId, (db, id) =>
          new LibraryStore(db, id).createItem(
            {
              kind,
              title,
              ...(creators === undefined ? {} : { creators }),
              ...(year === undefined ? {} : { year }),
              ...(tags === undefined ? {} : { tags }),
              ...(summary === undefined ? {} : { summary }),
            },
            new Date(deps.now()).toISOString(),
          ),
        );
        return okResult(phrase(context.locale, ADDED, created.title, created.id), {
          navigateTo: { module: "library" },
        });
      }),
  };

  return [shelf, add];
}

/** One work as a line: what it is, where it stands, and the facts the user wrote down. */
function itemLine(locale: AssistantLocale, item: LibraryItemWithCover): string {
  const parts = [
    text(locale, KIND_WORDS[item.kind]),
    text(locale, STATUS_WORDS[item.status]),
  ];
  if (item.year !== null) parts.push(String(item.year));
  if (item.creators.length > 0) parts.push(item.creators.join(", "));
  if (item.rating !== null) parts.push(phrase(locale, RATING_WORD, item.rating));
  const progress = progressText(locale, item);
  if (progress !== null) parts.push(progress);
  if (item.tags.length > 0) parts.push(item.tags.join(", "));
  return `- ${item.title} (${parts.join(", ")})`;
}

/**
 * A book's pages or a series' place, and nothing at all when the user has
 * written neither down — a zero would be a reading nobody recorded.
 */
function progressText(locale: AssistantLocale, item: LibraryItemWithCover): string | null {
  const read = item.pagesRead;
  const total = item.pagesTotal;
  if (read !== null && total !== null) return phrase(locale, PAGES_WORD, read, total);
  if (read !== null) return phrase(locale, PAGES_ONLY, read);
  if (item.season !== null || item.episode !== null) {
    return phrase(
      locale,
      SEASON_EPISODE,
      item.season === null ? "?" : String(item.season),
      item.episode === null ? "?" : String(item.episode),
    );
  }
  return null;
}

/** The folded match the app's own search uses: a word from the title, a creator or a tag. */
function matches(item: LibraryItemWithCover, query: string): boolean {
  const needle = foldSearchText(query.trim());
  if (needle.length === 0) return false;
  if (foldSearchText(item.title).includes(needle)) return true;
  if (foldSearchText(item.originalTitle ?? "").includes(needle)) return true;
  if (item.creators.some((creator) => foldSearchText(creator).includes(needle))) return true;
  return item.tags.some((tag) => foldSearchText(tag).includes(needle));
}

