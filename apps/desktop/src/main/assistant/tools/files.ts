/**
 * The files the user attached (DOC, „Datoteke"): every attachment on a note, a
 * task or a subject, as one list the user can ask about by name.
 *
 * **It reads the page's own index.** `AttachmentIndexStore` is the read the
 * files page makes, so the answer and the page cannot disagree about what is
 * attached. A private note keeps its files sealed inside its envelope, in no
 * table the index reads, so this tool cannot list one; that is structural, not a
 * filter.
 *
 * **Nothing is opened or removed here.** The page can preview and save a copy,
 * but those are native windows and dialogs the assistant does not drive. A file
 * is removed on the surface that owns it, where its undo lives, so `files.open`
 * takes the user to that owner rather than to a row of the files page.
 */

import { foldSearchText, mimeFamily, MIME_FAMILIES, type AssistantLocale, type Tool } from "@nexus/core";
import { AttachmentIndexStore, type AttachmentIndexEntry, type AttachmentOwnerKind } from "@nexus/db";
import { asArgs, asOptionalEnum, asOptionalText, asText } from "./args.js";
import {
  assertLive,
  formatBytes,
  formatDay,
  guard,
  okResult,
  phrase,
  failResult,
  quote,
  text,
  type AssistantPhrase,
  type ProfileDb,
} from "./support.js";

export interface FileToolDeps {
  readonly profileDb: ProfileDb;
}

/** How many rows one answer lists. The totals above them count every match, so the cut loses no number. */
const LISTED_ROWS = 25;

/** The page's owner kinds, in the words a user would say them. */
const OWNER_WORDS: Record<AttachmentOwnerKind, { sr: string; en: string }> = {
  note: { sr: "beleška", en: "note" },
  task: { sr: "zadatak", en: "task" },
  subject: { sr: "predmet", en: "subject" },
};

/** The module each owner kind lives in: where its own page shows the file and removes it. */
const OWNER_MODULE: Record<AttachmentOwnerKind, string> = {
  note: "notes",
  task: "tasks",
  subject: "study",
};

/** The four MIME families, as the page names them (`MIME_FAMILIES` in core). */
const FAMILY_WORDS: Record<(typeof MIME_FAMILIES)[number], { sr: string; en: string }> = {
  slika: { sr: "slika", en: "image" },
  pdf: { sr: "PDF", en: "PDF" },
  tekst: { sr: "tekst", en: "text" },
  ostalo: { sr: "ostalo", en: "other" },
};

const NONE_MATCH: { sr: string; en: string } = {
  sr: "Nijedna datoteka ne odgovara ovom izboru.",
  en: "No file matches this selection.",
};

const LIST_HEADING: AssistantPhrase<[total: string, families: string]> = {
  sr: (total, families) => `Datoteke (${total}: ${families}):`,
  en: (total, families) => `Files (${total}: ${families}):`,
};

const LIST_CUT: AssistantPhrase<[shown: number]> = {
  sr: (shown) => `Prikazano je prvih ${shown}; ostale su na stranici Datoteke.`,
  en: (shown) => `The first ${shown} are listed; the rest are on the Files page.`,
};

const OPEN_OWNER: AssistantPhrase<[file: string, owner: string]> = {
  sr: (file, owner) => `Datoteka ${quote("sr", file)} je priložena uz: ${owner}.`,
  en: (file, owner) => `The file ${quote("en", file)} is attached to: ${owner}.`,
};

const NO_FILE: AssistantPhrase<[name: string]> = {
  sr: (name) => `nema datoteke ${quote("sr", name)}.`,
  en: (name) => `there is no file ${quote("en", name)}.`,
};

const AMBIGUOUS_FILE: AssistantPhrase<[name: string, matches: string]> = {
  sr: (name, matches) => `više datoteka liči na ${quote("sr", name)}: ${matches}. Navedi tačan identifikator.`,
  en: (name, matches) => `more than one file matches ${quote("en", name)}: ${matches}. Name the exact id.`,
};

export function fileTools(deps: FileToolDeps): readonly Tool[] {
  const list: Tool = {
    name: "files.list",
    description: {
      sr: "Izlistava datoteke priložene uz beleške, zadatke i predmete, po nazivu ili vrsti. Koristi ga kada korisnik pita gde je neka datoteka ili koje ima PDF-ova, slika ili tekstova.",
      en: "Lists the files attached to notes, tasks and subjects, by name or kind. Use it when the user asks where a file is, or which PDFs, images or texts they have.",
    },
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", maxLength: 200, description: "Part of the file name or the owner's title." },
        owner: { type: "string", enum: ["note", "task", "subject"] },
        family: { type: "string", enum: [...MIME_FAMILIES] },
      },
      required: [],
      additionalProperties: false,
    },
    effect: "read",
    run: (rawArgs, context) =>
      guard(context, () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const page = deps.profileDb(context.profileId, (db, profileId) =>
          new AttachmentIndexStore(db, profileId).list({
            query: asOptionalText(args.query, "query", 200) ?? null,
            ownerKind: asOptionalEnum(args.owner, "owner", ["note", "task", "subject"] as const) ?? null,
            family: asOptionalEnum(args.family, "family", MIME_FAMILIES) ?? null,
          }),
        );
        if (page.entries.length === 0) return okResult(text(context.locale, NONE_MATCH));
        const total = page.truncated ? `${page.entries.length}+` : String(page.entries.length);
        const lines = [
          phrase(context.locale, LIST_HEADING, total, familyCounts(context.locale, page.entries)),
          ...page.entries.slice(0, LISTED_ROWS).map((entry) => fileLine(context.locale, entry)),
        ];
        if (page.entries.length > LISTED_ROWS) {
          lines.push(phrase(context.locale, LIST_CUT, LISTED_ROWS));
        }
        return okResult(lines.join("\n"));
      }),
  };

  const open: Tool = {
    name: "files.open",
    description: {
      sr: "Pokazuje belešku, zadatak ili predmet kome je datoteka priložena, po nazivu ili identifikatoru datoteke. Koristi ga kada korisnik traži da vidi gde je datoteka ili da je ukloni sa tog mesta.",
      en: "Shows the note, task or subject a file is attached to, by file name or id. Use it when the user asks where a file belongs or wants to remove it from there.",
    },
    parameters: {
      type: "object",
      properties: { file: { type: "string", maxLength: 200, description: "File id or file name." } },
      required: ["file"],
      additionalProperties: false,
    },
    effect: "read",
    run: (rawArgs, context) =>
      guard(context, () => {
        assertLive(context);
        const name = asText(asArgs(rawArgs).file, "file", 200);
        const entries = deps.profileDb(context.profileId, (db, profileId) =>
          new AttachmentIndexStore(db, profileId).list().entries,
        );
        const picked = pickFile(entries, name, context.locale);
        if ("failure" in picked) return failResult(context.locale, picked.failure);
        const entry = picked.row;
        // The owner's page reveals the row by id. The subject page reveals nothing from an
        // id (`App.tsx`'s `compiledInReveal`), so the app opens the module there.
        return okResult(phrase(context.locale, OPEN_OWNER, entry.fileName, ownerName(context.locale, entry)), {
          navigateTo: { module: OWNER_MODULE[entry.ownerKind], item: entry.ownerId },
        });
      }),
  };

  return [list, open];
}

/** `slika 3, PDF 2, tekst 1, ostalo 0` — the family totals of the rows the answer holds. */
function familyCounts(locale: AssistantLocale, entries: readonly AttachmentIndexEntry[]): string {
  return MIME_FAMILIES.map((family) => {
    const count = entries.filter((entry) => mimeFamily(entry.mime) === family).length;
    return `${text(locale, FAMILY_WORDS[family])} ${count}`;
  }).join(", ");
}

/** One file: its name, its kind and size, and the note, task or subject it hangs off. */
function fileLine(locale: AssistantLocale, entry: AttachmentIndexEntry): string {
  const parts = [
    text(locale, FAMILY_WORDS[mimeFamily(entry.mime)]),
    formatBytes(locale, entry.sizeBytes),
    ownerName(locale, entry),
    formatDay(locale, entry.createdAt.slice(0, 10)),
  ];
  return `- ${entry.id} ${entry.fileName} [${parts.join(", ")}]`;
}

/** The owner as a sentence names it: its kind, and its title when it has one (an untitled note has none to invent). */
function ownerName(locale: AssistantLocale, entry: AttachmentIndexEntry): string {
  const owner = text(locale, OWNER_WORDS[entry.ownerKind]);
  return entry.ownerTitle === "" ? owner : `${owner} ${quote(locale, entry.ownerTitle)}`;
}

/**
 * The one file a name stands for: an exact id first, then the file name, both
 * ignoring case and diacritics. An ambiguous name is refused with the candidates,
 * a missing one by name; a tool never guesses which file was meant.
 */
function pickFile(
  entries: readonly AttachmentIndexEntry[],
  name: string,
  locale: AssistantLocale,
): { row: AttachmentIndexEntry } | { failure: string } {
  const exact = entries.find((entry) => entry.id === name);
  if (exact !== undefined) return { row: exact };
  const folded = foldSearchText(name);
  const matches = entries.filter((entry) => foldSearchText(entry.fileName) === folded);
  const [only] = matches;
  if (matches.length === 1 && only !== undefined) return { row: only };
  if (matches.length === 0) return { failure: phrase(locale, NO_FILE, name) };
  const ids = matches.map((entry) => entry.id).join(", ");
  return { failure: phrase(locale, AMBIGUOUS_FILE, name, ids) };
}
