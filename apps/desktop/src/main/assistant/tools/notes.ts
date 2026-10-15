/**
 * The NOTE module: find one, read it, write, organise, and recover one.
 *
 * **A note is a CRDT, and main writes it the way main already does.** A note's
 * body is a Yjs document (`NoteStore` keeps opaque blobs, ADR-012), and the app
 * never writes one by hand: `markdownImport.ts` parses Markdown into the block
 * tree `@nexus/core`'s `buildNoteUpdate` turns into a single Yjs update, appends
 * it through `NoteStore.appendUpdate`, and folds it with `compactNow` — the same
 * `main/notes.ts` fold every keystroke flush schedules — which is what writes
 * the searchable plaintext and the first version-history checkpoint. Every body
 * write below goes through exactly that path, so a note the assistant wrote is
 * indistinguishable from one somebody typed: search finds it, history has it,
 * the editor opens it.
 *
 * **Body writes rewrite the document inside one transaction, against the
 * store's own state.** `rewriteBody` replays the note's merged state into a
 * scratch document, lets an edit change it (append, replace the whole body, or
 * replace the title block), and encodes the difference against the state vector
 * it started from — an ordinary incremental update, which is what `appendUpdate`
 * was built for. Whole-body replacement is `@nexus/core`'s `replaceNoteContent`,
 * the same rewrite version restore performs; the Markdown→Yjs mapping is never
 * restated here.
 *
 * **Every organiser the page has is reached through the same store method the
 * IPC channel calls.** Folders, tags, categories, templates, flashcards, pins,
 * versions, deletion and restore, and the checklist-to-tasks action: each
 * tool calls the store (or the main-process helper the channel calls) by name,
 * so a rule about where a folder may move or what a delete does to its cards
 * lives in exactly one place. Links are read, never written: the page derives
 * a note's link table from the `noteLink` nodes in its document at every save,
 * so a link set beside the text would be dropped by the next one.
 *
 * **Never, by design.** The private vault („Privatno") is a separate store over
 * sealed tables, and none of these tools opens it: `notes.search` reads the
 * global search index (migration 017 builds it from `notes` alone), and every
 * other tool reads through `NoteStore`. A note the vault holds is therefore
 * "not found", not "private" — the descriptions say so out loud, because a model
 * that believes it can read the vault is worse than one that knows it cannot.
 * Attachments are never offered either: attaching needs main's native picker,
 * and the bytes cross only inside main (SEC-FILE-02), so a model cannot name a
 * file. Note templates cannot be saved from here: a template is an editor
 * document (JSON), which only the page's template pane produces.
 */

import * as Y from "yjs";
import type Database from "better-sqlite3-multiple-ciphers";
import {
  CardStore,
  DeckStore,
  MAX_NOTE_UPDATE_BYTES,
  NOTE_FOLDER_VIEWS,
  NoteAttachmentStore,
  NoteOrgStore,
  NoteStore,
  NoteTemplateStore,
  TaskListStore,
  TaskStore,
} from "@nexus/db";
import type { NoteMeta } from "@nexus/db";
import {
  MAX_ID_LENGTH,
  buildNoteUpdate,
  collectNoteLinkIds,
  foldSearchText,
  mergeNoteState,
  parseMarkdownNote,
  replaceNoteContent,
} from "@nexus/core";
import type { MarkdownBlock } from "@nexus/core";
import type { AppLocation, AssistantLocale, Citation, Tool, ToolContext, ToolResult } from "@nexus/core";
import type { SearchResult } from "../../../shared/ipc.js";
import { captureNoteVersion, compactNow } from "../../notes.js";
import { checklistToTasks, countNoteChecklistItems } from "../../noteChecklistTasks.js";
import { duplicateNote } from "../../noteDuplicate.js";
import {
  asArgs,
  asEnum,
  asOptionalBoolean,
  asOptionalCount,
  asOptionalEnum,
  asOptionalText,
  asText,
} from "./args.js";
import {
  assertLive,
  clampText,
  confirmOrDecline,
  guard,
  okResult,
  phrase,
  text,
  type AssistantPhrase,
  type ProfileDb,
} from "./support.js";

export interface NoteToolDeps {
  readonly profileDb: ProfileDb;
  readonly now: () => number;
  /** The app's own global search — the index migration 017 keeps current, restricted to note hits below. */
  readonly search: (
    profileId: string,
    query: string,
    limit: number,
  ) => Promise<readonly SearchResult[]>;
}

/** `notes.title`'s own cap, mirrored from `deriveTitle` so a title this tool accepts is one the editor would derive. */
const MAX_TITLE_CHARS = 200;

/** A folder, tag, category, deck or template name, as the user says it. */
const MAX_NAME_CHARS = 200;

/** How much of one note a single read hands the model, and the most it may ask for. */
const DEFAULT_READ_CHARS = 4_000;
const MAX_READ_CHARS = 20_000;

/** How much text one write may carry. Well under `MAX_NOTE_UPDATE_BYTES` once encoded, which is still checked below. */
const MAX_BODY_CHARS = 20_000;

/** How many results a note search answers with when the model names no cap. */
const DEFAULT_SEARCH_LIMIT = 8;
const MAX_SEARCH_LIMIT = 20;

/** How many mixed hits the global search is asked for per wanted note hit: the index ranks across every kind, so a query is answered from a wider net than the notes it will yield. */
const SEARCH_OVERFETCH = 3;

const FOLDER_ACTIONS = [
  "create",
  "rename",
  "move",
  "delete",
  "set-template",
  "set-capture",
  "set-view",
  "assign",
] as const;
const TAG_ACTIONS = ["attach", "detach", "create", "rename", "delete"] as const;
const CATEGORY_ACTIONS = ["create", "rename", "delete", "assign"] as const;
/** What a note's delete does to the flashcards it generated, as the page offers it. */
const CARD_MODES = ["keep", "delete"] as const;

/** The few words a model may name a note's flashcards' deck by, for the phrases below. */
const VIEW_WORDS: Record<(typeof NOTE_FOLDER_VIEWS)[number], { sr: string; en: string }> = {
  list: { sr: "lista", en: "list" },
  cards: { sr: "kartice", en: "cards" },
};

/**
 * What a store-backed name is called in a sentence, in both languages. The
 * Serbian forms are the genitive singular (for „nema …") and the genitive plural
 * (for „ima više …").
 */
const NOUN = {
  note: { en: "note", sr: { gen: "beleške", genPlural: "beleški" } },
  folder: { en: "folder", sr: { gen: "fascikle", genPlural: "fascikli" } },
  tag: { en: "tag", sr: { gen: "oznake", genPlural: "oznaka" } },
  category: { en: "category", sr: { gen: "kategorije", genPlural: "kategorija" } },
  deck: { en: "deck", sr: { gen: "špila", genPlural: "špilova" } },
  template: { en: "template", sr: { gen: "šablona", genPlural: "šablona" } },
  list: { en: "list", sr: { gen: "liste", genPlural: "lista" } },
} as const;

type Noun = (typeof NOUN)[keyof typeof NOUN];

const NAME_NOT_FOUND: AssistantPhrase<[noun: Noun, wanted: string, known: string]> = {
  sr: (noun, wanted, known) => `Nema ${noun.sr.gen} „${wanted}“. Postoje: ${known}.`,
  en: (noun, wanted, known) => `No ${noun.en} named “${wanted}”. Known: ${known}.`,
};

const NAME_AMBIGUOUS: AssistantPhrase<[noun: Noun, wanted: string, ids: string]> = {
  sr: (noun, wanted, ids) => `Ima više ${noun.sr.genPlural} „${wanted}“ (${ids}). Navedi id.`,
  en: (noun, wanted, ids) => `More than one ${noun.en} is called “${wanted}” (${ids}). Use its id.`,
};

const NONE_LISTED: { sr: string; en: string } = {
  sr: "nijedna",
  en: "none",
};

const NOTE_NOT_FOUND: AssistantPhrase<[id: string]> = {
  sr: (id) => `Ne postoji aktivna beleška sa id-jem ili naslovom „${id}“.`,
  en: (id) => `No active note has the id or title “${id}”.`,
};

/** A note nobody has written into yet has no title either, so this sentence names none. */
const EMPTY_NOTE: { sr: string; en: string } = {
  sr: "Ta beleška još nema teksta.",
  en: "That note has no text yet.",
};

const TRUNCATED_BODY: AssistantPhrase<[chars: number]> = {
  sr: (chars) => `… tekst je skraćen na ${chars} znakova.`,
  en: (chars) => `… the text was cut to ${chars} characters.`,
};

const NOTES_HEADING: AssistantPhrase<[count: number, query: string]> = {
  sr: (count, query) => `Beleške (${count}) za „${query}“:`,
  en: (count, query) => `Notes (${count}) for “${query}”:`,
};

const NO_NOTES: AssistantPhrase<[query: string]> = {
  sr: (query) => `Nema beleški koje odgovaraju upitu „${query}“.`,
  en: (query) => `No notes match “${query}”.`,
};

const NO_FOLDERS: { sr: string; en: string } = {
  sr: "Nema fascikli.",
  en: "There are no folders.",
};

const NO_TAGS: { sr: string; en: string } = {
  sr: "Nema oznaka.",
  en: "There are no tags.",
};

const NO_CATEGORIES: { sr: string; en: string } = {
  sr: "Nema kategorija.",
  en: "There are no categories.",
};

const NO_TEMPLATES: { sr: string; en: string } = {
  sr: "Nema šablona beleški.",
  en: "There are no note templates.",
};

const NO_LIST: { sr: string; en: string } = {
  sr: "Nema liste zadataka u koju bi zadaci mogli da idu.",
  en: "There is no task list for the tasks to go into.",
};

const TAG_EXISTS: AssistantPhrase<[name: string]> = {
  sr: (name) => `Oznaka „${name}“ već postoji.`,
  en: (name) => `The tag “${name}” already exists.`,
};

const LINKS_TO: AssistantPhrase<[titles: string]> = {
  sr: (titles) => `Veze ka: ${titles}.`,
  en: (titles) => `Links to: ${titles}.`,
};

const LINKED_FROM: AssistantPhrase<[titles: string]> = {
  sr: (titles) => `Veze iz: ${titles}.`,
  en: (titles) => `Linked from: ${titles}.`,
};

const FLASHCARDS_LINE: AssistantPhrase<[count: number, deck: string | null]> = {
  sr: (count, deck) =>
    deck === null
      ? `Kartice za učenje: ${count}, bez špila.`
      : `Kartice za učenje: ${count}, špil „${deck}“.`,
  en: (count, deck) =>
    deck === null ? `Flashcards: ${count}, no deck.` : `Flashcards: ${count}, deck “${deck}”.`,
};

const CREATE_SUMMARY: AssistantPhrase<[title: string]> = {
  sr: (title) => `Napravi belešku „${title}“`,
  en: (title) => `Create the note “${title}”`,
};

const APPEND_SUMMARY: AssistantPhrase<[title: string]> = {
  sr: (title) => `Dodaj tekst u belešku „${title}“`,
  en: (title) => `Append to the note “${title}”`,
};

/** Neither write has anything to store — a refusal rather than an empty note or a no-op append. */
const NOTHING_TO_WRITE: { sr: string; en: string } = {
  sr: "Nema teksta za upis.",
  en: "There is no text to write.",
};

const WRITTEN: {
  readonly created: AssistantPhrase<[title: string, id: string]>;
  readonly appended: AssistantPhrase<[title: string, id: string]>;
} = {
  created: {
    sr: (title, id) => `Napravljena beleška „${title}“ (${id}).`,
    en: (title, id) => `Created note “${title}” (${id}).`,
  },
  appended: {
    sr: (title, id) => `Tekst je dodat u belešku „${title}“ (${id}).`,
    en: (title, id) => `Appended to note “${title}” (${id}).`,
  },
};

/** What a successful organiser or recovery write answers with: the sentence that said what it would do, now done. */
const DONE: AssistantPhrase<[summary: string]> = {
  sr: (summary) => `Izvršeno: ${summary}.`,
  en: (summary) => `Done: ${summary}.`,
};

const NOTHING_TO_CHANGE: { sr: string; en: string } = {
  sr: "Nema šta da se promeni.",
  en: "There is nothing to change.",
};

const UPDATE_SUMMARY: AssistantPhrase<[title: string, changes: string]> = {
  sr: (title, changes) => `Izmeni belešku „${title}“: ${changes}`,
  en: (title, changes) => `Change the note “${title}”: ${changes}`,
};

const CHANGE: {
  readonly body: { sr: string; en: string };
  readonly rename: AssistantPhrase<[title: string]>;
  readonly pin: { sr: string; en: string };
  readonly unpin: { sr: string; en: string };
  readonly capture: { sr: string; en: string };
} = {
  body: { sr: "zameni ceo tekst", en: "replace its whole text" },
  rename: {
    sr: (title) => `preimenuj je u „${title}“`,
    en: (title) => `rename it to “${title}”`,
  },
  pin: { sr: "zakači je na vrh liste", en: "pin it to the top of the list" },
  unpin: { sr: "skini je sa vrha liste", en: "unpin it" },
  capture: {
    sr: "sačuvaj trenutnu verziju u istoriji",
    en: "keep the current version in its history",
  },
};

const DELETE_NOTE: AssistantPhrase<[title: string]> = {
  sr: (title) => `Obriši belešku „${title}“.`,
  en: (title) => `Delete the note “${title}”.`,
};

const DELETE_WITH_CARDS: AssistantPhrase<[title: string, cards: number]> = {
  sr: (title, cards) => `Obriši belešku „${title}“ i njene kartice za učenje (${cards})`,
  en: (title, cards) => `Delete the note “${title}” and its flashcards (${cards})`,
};

const KEEP_CARDS: AssistantPhrase<[title: string, cards: number]> = {
  sr: (title, cards) => `Obriši belešku „${title}“; zadrži njene kartice za učenje (${cards})`,
  en: (title, cards) => `Delete the note “${title}”; keep its flashcards (${cards})`,
};

const RESTORE_SUMMARY: AssistantPhrase<[id: string]> = {
  sr: (id) => `Vrati belešku (${id}) iz otpada`,
  en: (id) => `Restore the note (${id}) from the trash`,
};

const DUPLICATE_SUMMARY: AssistantPhrase<[title: string]> = {
  sr: (title) => `Napravi kopiju beleške „${title}“`,
  en: (title) => `Make a copy of the note “${title}”`,
};

const DUPLICATED: AssistantPhrase<[title: string, id: string]> = {
  sr: (title, id) => `Napravljena kopija „${title}“ (${id}).`,
  en: (title, id) => `Made a copy “${title}” (${id}).`,
};

const TOO_LARGE: { sr: string; en: string } = {
  sr: "Beleška je prevelika da bi se duplirala.",
  en: "The note is too large to duplicate.",
};

const FOLDER_LINE: AssistantPhrase<[id: string, name: string, parent: string | null]> = {
  sr: (id, name, parent) => `- ${id} ${name}${parent === null ? "" : ` (u: ${parent})`}`,
  en: (id, name, parent) => `- ${id} ${name}${parent === null ? "" : ` (in: ${parent})`}`,
};

const CREATE_FOLDER: AssistantPhrase<[name: string, parent: string | null]> = {
  sr: (name, parent) =>
    parent === null
      ? `Napravi fasciklu „${name}“`
      : `Napravi fasciklu „${name}“ u „${parent}“`,
  en: (name, parent) =>
    parent === null
      ? `Create the folder “${name}”`
      : `Create the folder “${name}” in “${parent}”`,
};

const RENAME_FOLDER: AssistantPhrase<[name: string, to: string]> = {
  sr: (name, to) => `Preimenuj fasciklu „${name}“ u „${to}“`,
  en: (name, to) => `Rename the folder “${name}” to “${to}”`,
};

const MOVE_FOLDER: AssistantPhrase<[name: string, parent: string | null]> = {
  sr: (name, parent) =>
    parent === null
      ? `Premesti fasciklu „${name}“ na najviši nivo`
      : `Premesti fasciklu „${name}“ u „${parent}“`,
  en: (name, parent) =>
    parent === null
      ? `Move the folder “${name}” to the top level`
      : `Move the folder “${name}” into “${parent}”`,
};

const DELETE_FOLDER: AssistantPhrase<[name: string]> = {
  sr: (name) => `Obriši fasciklu „${name}“; njene beleške ostaju`,
  en: (name) => `Delete the folder “${name}”; its notes stay`,
};

const FOLDER_TEMPLATE: AssistantPhrase<[name: string, template: string | null]> = {
  sr: (name, template) =>
    template === null
      ? `Fascikla „${name}“: nove beleške počinju bez šablona`
      : `Fascikla „${name}“: nove beleške počinju šablonom „${template}“`,
  en: (name, template) =>
    template === null
      ? `The folder “${name}”: new notes start with no template`
      : `The folder “${name}”: new notes start from the template “${template}”`,
};

const FOLDER_CAPTURE: AssistantPhrase<[name: string | null]> = {
  sr: (name) =>
    name === null
      ? "Nijedna fascikla nije podrazumevano mesto za nove beleške"
      : `Fascikla „${name}“ postaje podrazumevano mesto za nove beleške`,
  en: (name) =>
    name === null
      ? "No folder is the default place for new notes"
      : `Make the folder “${name}” the default place for new notes`,
};

const FOLDER_VIEW: AssistantPhrase<[name: string, view: string]> = {
  sr: (name, view) => `Fascikla „${name}“ se prikazuje kao ${view}`,
  en: (name, view) => `The folder “${name}” is shown as ${view}`,
};

const ASSIGN_FOLDER: AssistantPhrase<[title: string, folder: string | null]> = {
  sr: (title, folder) =>
    folder === null
      ? `Izbaci belešku „${title}“ iz fascikle`
      : `Premesti belešku „${title}“ u fasciklu „${folder}“`,
  en: (title, folder) =>
    folder === null
      ? `Take the note “${title}” out of its folder`
      : `Move the note “${title}” into the folder “${folder}”`,
};

const CREATE_TAG: AssistantPhrase<[name: string]> = {
  sr: (name) => `Napravi oznaku „${name}“`,
  en: (name) => `Create the tag “${name}”`,
};

const RENAME_TAG: AssistantPhrase<[name: string, to: string]> = {
  sr: (name, to) => `Preimenuj oznaku „${name}“ u „${to}“`,
  en: (name, to) => `Rename the tag “${name}” to “${to}”`,
};

const DELETE_TAG: AssistantPhrase<[name: string]> = {
  sr: (name) => `Obriši oznaku „${name}“`,
  en: (name) => `Delete the tag “${name}”`,
};

const ATTACH_TAG: AssistantPhrase<[tag: string, title: string, isNew: boolean]> = {
  sr: (tag, title, isNew) =>
    `Dodaj oznaku „${tag}“${isNew ? " (nova oznaka)" : ""} na belešku „${title}“`,
  en: (tag, title, isNew) =>
    `Add the tag “${tag}”${isNew ? " (a new tag)" : ""} to the note “${title}”`,
};

const DETACH_TAG: AssistantPhrase<[tag: string, title: string]> = {
  sr: (tag, title) => `Skini oznaku „${tag}“ sa beleške „${title}“`,
  en: (tag, title) => `Remove the tag “${tag}” from the note “${title}”`,
};

const CREATE_CATEGORY: AssistantPhrase<[name: string]> = {
  sr: (name) => `Napravi kategoriju „${name}“`,
  en: (name) => `Create the category “${name}”`,
};

const RENAME_CATEGORY: AssistantPhrase<[name: string, to: string]> = {
  sr: (name, to) => `Preimenuj kategoriju „${name}“ u „${to}“`,
  en: (name, to) => `Rename the category “${name}” to “${to}”`,
};

const DELETE_CATEGORY: AssistantPhrase<[name: string]> = {
  sr: (name) => `Obriši kategoriju „${name}“`,
  en: (name) => `Delete the category “${name}”`,
};

const ASSIGN_CATEGORY: AssistantPhrase<[title: string, category: string | null]> = {
  sr: (title, category) =>
    category === null
      ? `Skini kategoriju sa beleške „${title}“`
      : `Stavi belešku „${title}“ u kategoriju „${category}“`,
  en: (title, category) =>
    category === null
      ? `Remove the category from the note “${title}”`
      : `Put the note “${title}” in the category “${category}”`,
};

const VERSIONS_HEADING: AssistantPhrase<[count: number]> = {
  sr: (count) => `Verzije (${count}):`,
  en: (count) => `Versions (${count}):`,
};

const NO_VERSIONS: { sr: string; en: string } = {
  sr: "Ta beleška nema sačuvanih verzija.",
  en: "That note has no saved versions.",
};

const VERSION_NOT_FOUND: AssistantPhrase<[seq: number]> = {
  sr: (seq) => `Ta beleška nema verziju ${seq}.`,
  en: (seq) => `That note has no version ${seq}.`,
};

const CHECKLIST_EMPTY: { sr: string; en: string } = {
  sr: "Ta beleška nema stavki liste koje bi postale zadaci.",
  en: "That note has no checklist items to turn into tasks.",
};

const CHECKLIST_SUMMARY: AssistantPhrase<[title: string, items: number, list: string]> = {
  sr: (title, items, list) =>
    `Pretvori listu beleške „${title}“ (${items} stavki) u zadatke u listi „${list}“`,
  en: (title, items, list) =>
    `Turn the checklist of the note “${title}” (${items} items) into tasks in the list “${list}”`,
};

const CHECKLIST_DONE: AssistantPhrase<[created: number, skipped: number]> = {
  sr: (created, skipped) =>
    `Napravljeno zadataka: ${created}; preskočeno praznih stavki: ${skipped}.`,
  en: (created, skipped) => `Tasks created: ${created}; empty items skipped: ${skipped}.`,
};

const CARD_DECK_SET: AssistantPhrase<[title: string, deck: string]> = {
  sr: (title, deck) => `Pošalji kartice beleške „${title}“ u špil „${deck}“`,
  en: (title, deck) => `Send the flashcards of the note “${title}” to the deck “${deck}”`,
};

const CARD_DECK_CLEAR: AssistantPhrase<[title: string]> = {
  sr: (title) => `Prekini slanje kartica beleške „${title}“ u špil`,
  en: (title) => `Stop sending the flashcards of the note “${title}” to a deck`,
};

export function noteTools(deps: NoteToolDeps): readonly Tool[] {
  const open = (profileId: string): NoteStores =>
    deps.profileDb(profileId, (db, id) => openStores(db, id));

  const search: Tool = {
    name: "notes.search",
    description: {
      sr: "Pretražuje beleške preko indeksa globalne pretrage. Koristi ga da nađeš belešku pre nego što je pročitaš ili izmeniš. Privatne beleške („Privatno“) nisu dostupne ovom alatu.",
      en: "Searches notes through the app's global search index. Use it to find a note before reading or changing it. Private-vault notes („Privatno“) are not reachable from this tool.",
    },
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", minLength: 1, maxLength: 200, description: "What to look for." },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: MAX_SEARCH_LIMIT,
          description: `How many notes to answer with. Defaults to ${DEFAULT_SEARCH_LIMIT}.`,
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
    effect: "read",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const query = asText(args.query, "query", 200);
        const limit = asOptionalCount(args.limit, "limit", 1, MAX_SEARCH_LIMIT) ?? DEFAULT_SEARCH_LIMIT;

        const hits = await deps.search(context.profileId, query, limit * SEARCH_OVERFETCH);
        const notes = hits.filter((hit) => hit.kind === "note").slice(0, limit);
        if (notes.length === 0) {
          return okResult(phrase(context.locale, NO_NOTES, query));
        }
        return okResult(
          [
            phrase(context.locale, NOTES_HEADING, notes.length, query),
            ...notes.map((hit) => noteLine(hit)),
          ].join("\n"),
          { citations: notes.map(noteCitation) },
        );
      }),
  };

  const read: Tool = {
    name: "notes.read",
    description: {
      sr: "Čita tekst jedne beleške, zajedno sa vezama, karticama za učenje i špilom. Vraća samo tekst, bez formatiranja, i skraćuje ga na traženu dužinu. Koristi ga kada korisnik traži da pročitaš ili sažmeš belešku.",
      en: "Reads one note's text, with its links, flashcards and deck. It answers with plain text only and cuts the text to the requested length. Use it when the user asks you to read or summarise a note.",
    },
    parameters: {
      type: "object",
      properties: {
        id: noteReference(),
        maxChars: {
          type: "integer",
          minimum: 200,
          maximum: MAX_READ_CHARS,
          description: `How much text to answer with. Defaults to ${DEFAULT_READ_CHARS}.`,
        },
      },
      required: ["id"],
      additionalProperties: false,
    },
    effect: "read",
    run: (rawArgs, context) =>
      guard(context, () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const maxChars =
          asOptionalCount(args.maxChars, "maxChars", 200, MAX_READ_CHARS) ?? DEFAULT_READ_CHARS;
        const s = open(context.profileId);
        const note = requireNote(s.notes, asText(args.id, "id", MAX_ID_LENGTH), context.locale);
        const body = plaintextOf(s.notes, note.id);
        const lines: string[] = [];
        if (body.trim().length === 0) {
          lines.push(text(context.locale, EMPTY_NOTE));
        } else {
          const clamped = clampText(body, maxChars);
          lines.push(`# ${note.title} (${note.id})`, clamped.text);
          if (clamped.truncated) lines.push(phrase(context.locale, TRUNCATED_BODY, maxChars));
        }
        lines.push(...relationLines(s, note, context.locale));
        return okResult(lines.join("\n"), { citations: [noteCitationOf(note.id, note.title)] });
      }),
  };

  const create: Tool = {
    name: "notes.create",
    description: {
      sr: "Pravi novu belešku sa naslovom i tekstom. Tekst može biti običan ili Markdown (naslovi, liste, citati). Koristi ga kada korisnik traži da zapišeš nešto novo.",
      en: "Creates a new note with a title and a body. The body may be plain text or Markdown (headings, lists, quotes). Use it when the user asks you to write something new down.",
    },
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", minLength: 1, maxLength: MAX_TITLE_CHARS, description: "The note's title — its first line." },
        text: { type: "string", maxLength: MAX_BODY_CHARS, description: "The note's body. Plain text or Markdown." },
      },
      required: ["title"],
      additionalProperties: false,
    },
    effect: "write",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const title = asText(args.title, "title", MAX_TITLE_CHARS);
        const body = asOptionalText(args.text, "text", MAX_BODY_CHARS);

        // The title is the note's first block (`deriveTitle`), so it travels as
        // the leading H1 rather than as a column the first edit would erase.
        const markdown = body === undefined ? `# ${title}` : `# ${title}\n\n${body}`;
        const parsed = parseMarkdownNote(markdown, title);
        const blocks = parsed.blocks;
        if (blocks.length === 0) throw new Error(text(context.locale, NOTHING_TO_WRITE));
        const update = buildNoteUpdate(blocks);
        if (update.byteLength > MAX_NOTE_UPDATE_BYTES) {
          throw new Error(
            `A note update must not exceed ${MAX_NOTE_UPDATE_BYTES} bytes.`,
          );
        }

        const declined = await confirmOrDecline(
          context,
          "notes.create",
          "write",
          phrase(context.locale, CREATE_SUMMARY, parsed.title),
        );
        if (declined !== null) return declined;

        const createdAt = new Date(deps.now()).toISOString();
        const created = deps.profileDb(context.profileId, (db, profileId) =>
          db.transaction(() => {
            const store = new NoteStore(db, profileId);
            const note = store.create(createdAt);
            store.appendUpdate(note.id, update, parsed.title, createdAt);
            // Not `compactIfNeeded`: one update never reaches the threshold, and a
            // note that is not in the search index until somebody edits it is a
            // note nobody can find (`markdownImport.ts` writes its imports the
            // same way, for the same reason).
            compactNow(store, note.id);
            return note;
          })(),
        );
        return okResult(
          phrase(context.locale, WRITTEN.created, parsed.title, created.id),
          {
            citations: [noteCitationOf(created.id, parsed.title)],
            navigateTo: { module: "notes", item: created.id },
          },
        );
      }),
  };

  const append: Tool = {
    name: "notes.append",
    description: {
      sr: "Dodaje tekst na kraj postojeće beleške, ne dirajući ono što je već u njoj. Koristi ga kada korisnik traži da nešto dopišeš u belešku koju već ima; prvo pozovi notes.search da dobiješ id.",
      en: "Appends text to the end of an existing note, leaving what is already there untouched. Use it when the user asks you to add something to a note they already have; call notes.search first for the id.",
    },
    parameters: {
      type: "object",
      properties: {
        id: noteReference(),
        text: { type: "string", minLength: 1, maxLength: MAX_BODY_CHARS, description: "The text to add. Plain text or Markdown." },
      },
      required: ["id", "text"],
      additionalProperties: false,
    },
    effect: "write",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const body = asText(args.text, "text", MAX_BODY_CHARS);
        const store = open(context.profileId).notes;
        const note = requireNote(store, asText(args.id, "id", MAX_ID_LENGTH), context.locale);

        // The fallback title is deliberately empty: `parseMarkdownNote` would
        // otherwise MATERIALIZE it as a leading `# ` heading, which in the middle
        // of a note is a second title rather than a paragraph.
        const blocks = parseMarkdownNote(body, "").blocks;
        if (blocks.length === 0) {
          throw new Error(text(context.locale, NOTHING_TO_WRITE));
        }
        const update = appendBlocks(store, note.id, blocks);
        if (update.byteLength > MAX_NOTE_UPDATE_BYTES) {
          throw new Error(`A note update must not exceed ${MAX_NOTE_UPDATE_BYTES} bytes.`);
        }

        const declined = await confirmOrDecline(
          context,
          "notes.append",
          "write",
          phrase(context.locale, APPEND_SUMMARY, note.title),
        );
        if (declined !== null) return declined;

        const now = new Date(deps.now()).toISOString();
        deps.profileDb(context.profileId, (db, profileId) => {
          const live = new NoteStore(db, profileId);
          live.appendUpdate(note.id, update, note.title, now);
          compactNow(live, note.id);
        });
        return okResult(phrase(context.locale, WRITTEN.appended, note.title, note.id), {
          citations: [noteCitationOf(note.id, note.title)],
        });
      }),
  };

  const update: Tool = {
    name: "notes.update",
    description: {
      sr: "Menja postojeću belešku: zamenjuje ceo tekst, menja naslov ili je kači na vrh liste, i čuva trenutnu verziju pre izmene. Za dodavanje na kraj koristi notes.append. Pre vraćanja stare verzije pozovi capture: true.",
      en: "Changes a note: replaces its whole text, renames it, or pins it. Use capture: true to keep the current version first. To add text at the end use notes.append; to restore an old version, read it with notes.versions and pass its text as body.",
    },
    parameters: {
      type: "object",
      properties: {
        id: noteReference(),
        title: { type: "string", minLength: 1, maxLength: MAX_TITLE_CHARS, description: "A new title." },
        body: { type: "string", minLength: 1, maxLength: MAX_BODY_CHARS, description: "The new text, replacing all of the note's text below its title. Plain text or Markdown." },
        pinned: { type: "boolean", description: "true to pin the note to the top of the list, false to unpin it." },
        capture: { type: "boolean", description: "true to keep the note's current version in its history before the change." },
      },
      required: ["id"],
      additionalProperties: false,
    },
    effect: "write",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const s = open(context.profileId);
        const note = requireNote(s.notes, asText(args.id, "id", MAX_ID_LENGTH), context.locale);
        const title = asOptionalText(args.title, "title", MAX_TITLE_CHARS);
        const body = asOptionalText(args.body, "body", MAX_BODY_CHARS);
        const pinned = asOptionalBoolean(args.pinned, "pinned");
        const capture = asOptionalBoolean(args.capture, "capture");
        if (title === undefined && body === undefined && pinned === undefined && capture !== true) {
          throw new Error(text(context.locale, NOTHING_TO_CHANGE));
        }

        // A body replaces the whole document, its title block included; a title
        // alone rewrites just the first block, which is what `deriveTitle` reads.
        const finalTitle = title ?? note.title;
        const parsed = body === undefined && title === undefined
          ? null
          : parseMarkdownNote(body === undefined ? `# ${finalTitle}` : `# ${finalTitle}\n\n${body}`, finalTitle);
        const bodyUpdate = parsed === null
          ? null
          : rewriteBody(s.notes, note.id, (base) => {
              const blocks = buildNoteUpdate(parsed.blocks);
              if (body === undefined) replaceFirstBlock(base, blocks);
              else replaceNoteContent(base, blocks);
            });
        if (bodyUpdate !== null && bodyUpdate.byteLength > MAX_NOTE_UPDATE_BYTES) {
          throw new Error(`A note update must not exceed ${MAX_NOTE_UPDATE_BYTES} bytes.`);
        }

        const changes: string[] = [];
        if (body !== undefined) changes.push(text(context.locale, CHANGE.body));
        if (title !== undefined) changes.push(phrase(context.locale, CHANGE.rename, title));
        if (pinned !== undefined) changes.push(text(context.locale, pinned ? CHANGE.pin : CHANGE.unpin));
        if (capture === true) changes.push(text(context.locale, CHANGE.capture));

        return runPlan(context, "notes.update", {
          summary: phrase(context.locale, UPDATE_SUMMARY, note.title, changes.join("; ")),
          apply: () => {
            const now = new Date(deps.now()).toISOString();
            s.db.transaction(() => {
              if (capture === true) captureNoteVersion(s.notes, note.id);
              if (bodyUpdate !== null && parsed !== null) {
                s.notes.appendUpdate(note.id, bodyUpdate, parsed.title, now);
                compactNow(s.notes, note.id);
              }
              if (pinned !== undefined) s.notes.setPinned(note.id, pinned);
            })();
            return { text: phrase(context.locale, DONE, phrase(context.locale, UPDATE_SUMMARY, note.title, changes.join("; "))), navigateTo: { module: "notes", item: note.id } };
          },
        });
      }),
  };

  const remove: Tool = {
    name: "notes.delete",
    description: {
      sr: "Premešta belešku u otpad. Ako beleška ima kartice za učenje, `cards: keep` ih zadržava, a `cards: delete` briše zajedno sa njom. Koristi ga kada korisnik traži da obriše belešku.",
      en: "Moves a note to the trash. If the note has flashcards, `cards: keep` keeps them, and `cards: delete` deletes them with it. Use it when the user asks you to delete a note.",
    },
    parameters: {
      type: "object",
      properties: {
        id: noteReference(),
        cards: { type: "string", enum: [...CARD_MODES], description: "What happens to the note's flashcards. Defaults to keep." },
      },
      required: ["id"],
      additionalProperties: false,
    },
    effect: "write",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const s = open(context.profileId);
        const note = requireNote(s.notes, asText(args.id, "id", MAX_ID_LENGTH), context.locale);
        const mode = asOptionalEnum(args.cards, "cards", CARD_MODES) ?? "keep";
        const cards = s.cards.countCardsOfNote(note.id);
        const summary =
          cards === 0
            ? phrase(context.locale, DELETE_NOTE, note.title)
            : phrase(context.locale, mode === "delete" ? DELETE_WITH_CARDS : KEEP_CARDS, note.title, cards);
        return runPlan(context, "notes.delete", {
          summary,
          apply: () => {
            const now = new Date(deps.now()).toISOString();
            s.db.transaction(() => {
              if (mode === "delete") {
                s.cards.deleteCardsOfNote(note.id, now);
              } else if (s.cards.detachCardsFromNote(note.id) > 0) {
                s.notes.setCardDeck(note.id, null, now);
              }
              s.notes.softDelete(note.id, now);
            })();
            return { text: phrase(context.locale, DONE, summary) };
          },
        });
      }),
  };

  const restore: Tool = {
    name: "notes.restore",
    description: {
      sr: "Vraća belešku iz otpada, zajedno sa karticama koje su obrisane zajedno sa njom. Traži id, jer otpad nema pretragu.",
      en: "Brings a note back from the trash, with the flashcards that were deleted along with it. It needs the id, because the trash has no search.",
    },
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", minLength: 1, maxLength: MAX_ID_LENGTH, description: "The id of the deleted note." },
      },
      required: ["id"],
      additionalProperties: false,
    },
    effect: "write",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const id = asText(asArgs(rawArgs).id, "id", MAX_ID_LENGTH);
        const s = open(context.profileId);
        return runPlan(context, "notes.restore", {
          summary: phrase(context.locale, RESTORE_SUMMARY, id),
          apply: () => {
            s.db.transaction(() => {
              const deletedAt = s.notes.restore(id, new Date(deps.now()).toISOString());
              s.cards.restoreCardsOfNote(id, deletedAt);
            })();
            return { text: phrase(context.locale, DONE, phrase(context.locale, RESTORE_SUMMARY, id)), navigateTo: { module: "notes", item: id } };
          },
        });
      }),
  };

  const duplicate: Tool = {
    name: "notes.duplicate",
    description: {
      sr: "Pravi kopiju beleške sa njenim tekstom, fasciklom, kategorijom i oznakama. Pin, istorija verzija i veza sa špilom se ne kopiraju.",
      en: "Makes a copy of a note, with its text, folder, category and tags. The pin, the version history and the deck link are not copied.",
    },
    parameters: {
      type: "object",
      properties: { id: noteReference() },
      required: ["id"],
      additionalProperties: false,
    },
    effect: "write",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const s = open(context.profileId);
        const note = requireNote(s.notes, asText(asArgs(rawArgs).id, "id", MAX_ID_LENGTH), context.locale);
        return runPlan(context, "notes.duplicate", {
          summary: phrase(context.locale, DUPLICATE_SUMMARY, note.title),
          apply: () => {
            const result = duplicateNote(
              {
                notes: s.notes,
                org: s.org,
                attachments: s.attachments,
                runInTransaction: (write) => s.db.transaction(write)(),
              },
              note.id,
              new Date(deps.now()).toISOString(),
            );
            if (!result.ok) throw new Error(text(context.locale, TOO_LARGE));
            return {
              text: phrase(context.locale, DUPLICATED, result.note.title, result.note.id),
              navigateTo: { module: "notes", item: result.note.id },
            };
          },
        });
      }),
  };

  const folders: Tool = {
    name: "notes.folders",
    description: {
      sr: "Izlistava fascikle beleški i fasciklu u kojoj je svaka. Koristi ga pre notes.folder da dobiješ ime ili id fascikle.",
      en: "Lists the note folders and the folder each one sits in. Use it before notes.folder to get a folder's name or id.",
    },
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
    effect: "read",
    run: (_rawArgs, context) =>
      guard(context, () => {
        assertLive(context);
        const list = open(context.profileId).org.listFolders();
        if (list.length === 0) return okResult(text(context.locale, NO_FOLDERS));
        const names = new Map(list.map((entry) => [entry.id, entry.name]));
        return okResult(
          list
            .map((entry) =>
              phrase(context.locale, FOLDER_LINE, entry.id, entry.name, entry.parentId === null ? null : (names.get(entry.parentId) ?? null)),
            )
            .join("\n"),
        );
      }),
  };

  const folder: Tool = {
    name: "notes.folder",
    description: {
      sr: "Radi sa fasciklama beleški: pravi, preimenuje, premešta, briše, bira šablon ili podrazumevano mesto za nove beleške i način prikaza, i stavlja belešku u fasciklu (action: assign). Brisanje fascikle ostavlja njene beleške.",
      en: "Works on note folders: create, rename, move, delete, set the template or the default place for new notes, set the view, and file a note in a folder (action: assign). Deleting a folder keeps its notes.",
    },
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: [...FOLDER_ACTIONS], description: "What to do." },
        folder: { type: "string", minLength: 1, maxLength: MAX_NAME_CHARS, description: "The folder, by id or name. Not needed for create." },
        name: { type: "string", minLength: 1, maxLength: MAX_NAME_CHARS, description: "The new folder's name (create), or its new name (rename)." },
        parent: { type: "string", minLength: 1, maxLength: MAX_NAME_CHARS, description: "The folder it sits in, by id or name (create, move). Leave out for the top level." },
        template: { type: "string", minLength: 1, maxLength: MAX_NAME_CHARS, description: "The note template, by id or name (set-template). Leave out to clear it." },
        view: { type: "string", enum: [...NOTE_FOLDER_VIEWS], description: "How the folder's notes are shown (set-view): list or cards." },
        note: noteReference(),
      },
      required: ["action"],
      additionalProperties: false,
    },
    effect: "write",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const action = asEnum(args.action, "action", FOLDER_ACTIONS);
        const s = open(context.profileId);
        const known = s.org.listFolders();
        const named = (field: string, value: string | undefined): NoteFolderLike => {
          if (value === undefined) throw new Error(`"${field}" is needed for this action.`);
          return resolveNamed(known, value, NOUN.folder, context.locale);
        };
        const now = new Date(deps.now()).toISOString();
        const parentRef = asOptionalText(args.parent, "parent", MAX_NAME_CHARS);
        const parentFolder = parentRef === undefined ? null : resolveNamed(known, parentRef, NOUN.folder, context.locale);

        switch (action) {
          case "create": {
            const name = asText(args.name, "name", MAX_NAME_CHARS);
            return runPlan(context, "notes.folder", {
              summary: phrase(context.locale, CREATE_FOLDER, name, parentFolder?.name ?? null),
              apply: () => {
                s.org.createFolder({ parentId: parentFolder?.id ?? null, name, color: null }, now);
                return { text: phrase(context.locale, DONE, phrase(context.locale, CREATE_FOLDER, name, parentFolder?.name ?? null)) };
              },
            });
          }
          case "rename": {
            const target = named("folder", asOptionalText(args.folder, "folder", MAX_NAME_CHARS));
            const name = asText(args.name, "name", MAX_NAME_CHARS);
            return runPlan(context, "notes.folder", {
              summary: phrase(context.locale, RENAME_FOLDER, target.name, name),
              apply: () => {
                s.org.updateFolder(target.id, { name }, now);
                return { text: phrase(context.locale, DONE, phrase(context.locale, RENAME_FOLDER, target.name, name)) };
              },
            });
          }
          case "move": {
            const target = named("folder", asOptionalText(args.folder, "folder", MAX_NAME_CHARS));
            return runPlan(context, "notes.folder", {
              summary: phrase(context.locale, MOVE_FOLDER, target.name, parentFolder?.name ?? null),
              apply: () => {
                s.org.moveFolder(target.id, parentFolder?.id ?? null, now);
                return { text: phrase(context.locale, DONE, phrase(context.locale, MOVE_FOLDER, target.name, parentFolder?.name ?? null)) };
              },
            });
          }
          case "delete": {
            const target = named("folder", asOptionalText(args.folder, "folder", MAX_NAME_CHARS));
            return runPlan(context, "notes.folder", {
              summary: phrase(context.locale, DELETE_FOLDER, target.name),
              apply: () => {
                s.org.deleteFolder(target.id, now);
                return { text: phrase(context.locale, DONE, phrase(context.locale, DELETE_FOLDER, target.name)) };
              },
            });
          }
          case "set-template": {
            const target = named("folder", asOptionalText(args.folder, "folder", MAX_NAME_CHARS));
            const templateRef = asOptionalText(args.template, "template", MAX_NAME_CHARS);
            const template = templateRef === undefined ? null : resolveNamed(s.templates.list(), templateRef, NOUN.template, context.locale);
            return runPlan(context, "notes.folder", {
              summary: phrase(context.locale, FOLDER_TEMPLATE, target.name, template?.name ?? null),
              apply: () => {
                s.org.setDefaultTemplate(target.id, template?.id ?? null, now);
                return { text: phrase(context.locale, DONE, phrase(context.locale, FOLDER_TEMPLATE, target.name, template?.name ?? null)) };
              },
            });
          }
          case "set-capture": {
            const folderRef = asOptionalText(args.folder, "folder", MAX_NAME_CHARS);
            const target = folderRef === undefined ? null : named("folder", folderRef);
            return runPlan(context, "notes.folder", {
              summary: phrase(context.locale, FOLDER_CAPTURE, target?.name ?? null),
              apply: () => {
                s.org.setCaptureDefault(target?.id ?? null, now);
                return { text: phrase(context.locale, DONE, phrase(context.locale, FOLDER_CAPTURE, target?.name ?? null)) };
              },
            });
          }
          case "set-view": {
            const target = named("folder", asOptionalText(args.folder, "folder", MAX_NAME_CHARS));
            const view = asEnum(args.view, "view", NOTE_FOLDER_VIEWS);
            const viewWord = VIEW_WORDS[view][context.locale];
            const summary = phrase(context.locale, FOLDER_VIEW, target.name, viewWord);
            return runPlan(context, "notes.folder", {
              summary,
              apply: () => {
                s.org.setFolderView(target.id, view, now);
                return { text: phrase(context.locale, DONE, summary) };
              },
            });
          }
          case "assign": {
            const note = requireNote(s.notes, asText(args.note, "note", MAX_ID_LENGTH), context.locale);
            const folderRef = asOptionalText(args.folder, "folder", MAX_NAME_CHARS);
            const target = folderRef === undefined ? null : named("folder", folderRef);
            return runPlan(context, "notes.folder", {
              summary: phrase(context.locale, ASSIGN_FOLDER, note.title, target?.name ?? null),
              apply: () => {
                s.notes.setFolder(note.id, target?.id ?? null);
                return {
                  text: phrase(context.locale, DONE, phrase(context.locale, ASSIGN_FOLDER, note.title, target?.name ?? null)),
                  navigateTo: { module: "notes", item: note.id },
                };
              },
            });
          }
        }
      }),
  };

  const tags: Tool = {
    name: "notes.tags",
    description: {
      sr: "Izlistava oznake beleški. Koristi ga pre notes.tag da dobiješ ime oznake.",
      en: "Lists the note tags. Use it before notes.tag to get a tag's name.",
    },
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
    effect: "read",
    run: (_rawArgs, context) =>
      guard(context, () => {
        assertLive(context);
        const list = open(context.profileId).org.listTags();
        if (list.length === 0) return okResult(text(context.locale, NO_TAGS));
        return okResult(list.map((entry) => `- ${entry.id} ${entry.name}`).join("\n"));
      }),
  };

  const tag: Tool = {
    name: "notes.tag",
    description: {
      sr: "Dodaje oznaku belešci (ako oznaka ne postoji, pravi je), skida oznaku, pravi, preimenuje ili briše oznaku. Skidanje oznake ostavlja belešku. Ime oznake može biti id ili naziv.",
      en: "Adds a tag to a note (creating the tag if it does not exist), removes a tag from a note, or creates, renames or deletes a tag. Removing a tag from a note leaves the note. A tag is named by its id or its name.",
    },
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: [...TAG_ACTIONS], description: "What to do." },
        note: noteReference(),
        tag: { type: "string", minLength: 1, maxLength: MAX_NAME_CHARS, description: "The tag, by id or name. For create, the new tag's name." },
        name: { type: "string", minLength: 1, maxLength: MAX_NAME_CHARS, description: "The new name (rename)." },
      },
      required: ["action"],
      additionalProperties: false,
    },
    effect: "write",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const action = asEnum(args.action, "action", TAG_ACTIONS);
        const s = open(context.profileId);
        const now = new Date(deps.now()).toISOString();
        const tagRef = asOptionalText(args.tag, "tag", MAX_NAME_CHARS);
        const existing = s.org.listTags();
        const requireTag = (): { id: string; name: string } => {
          if (tagRef === undefined) throw new Error('"tag" is needed for this action.');
          return resolveNamed(existing, tagRef, NOUN.tag, context.locale);
        };
        const noteOf = (): NoteMeta => requireNote(s.notes, asText(args.note, "note", MAX_ID_LENGTH), context.locale);

        switch (action) {
          case "attach": {
            const note = noteOf();
            const name = asText(args.tag, "tag", MAX_NAME_CHARS);
            const found = namedMatches(existing, name)[0];
            const summary = phrase(context.locale, ATTACH_TAG, found?.name ?? name, note.title, found === undefined);
            return runPlan(context, "notes.tag", {
              summary,
              apply: () => {
                s.db.transaction(() => {
                  const tagId = found?.id ?? s.org.createTag(name, now).id;
                  s.org.attachTag(note.id, tagId);
                })();
                return { text: phrase(context.locale, DONE, summary), navigateTo: { module: "notes", item: note.id } };
              },
            });
          }
          case "detach": {
            const note = noteOf();
            const found = requireTag();
            const summary = phrase(context.locale, DETACH_TAG, found.name, note.title);
            return runPlan(context, "notes.tag", {
              summary,
              apply: () => {
                s.org.detachTag(note.id, found.id);
                return { text: phrase(context.locale, DONE, summary), navigateTo: { module: "notes", item: note.id } };
              },
            });
          }
          case "create": {
            const name = asText(args.tag, "tag", MAX_NAME_CHARS);
            if (namedMatches(existing, name).length > 0) {
              throw new Error(phrase(context.locale, TAG_EXISTS, name));
            }
            return runPlan(context, "notes.tag", {
              summary: phrase(context.locale, CREATE_TAG, name),
              apply: () => {
                s.org.createTag(name, now);
                return { text: phrase(context.locale, DONE, phrase(context.locale, CREATE_TAG, name)) };
              },
            });
          }
          case "rename": {
            const found = requireTag();
            const name = asText(args.name, "name", MAX_NAME_CHARS);
            return runPlan(context, "notes.tag", {
              summary: phrase(context.locale, RENAME_TAG, found.name, name),
              apply: () => {
                s.org.renameTag(found.id, name);
                return { text: phrase(context.locale, DONE, phrase(context.locale, RENAME_TAG, found.name, name)) };
              },
            });
          }
          case "delete": {
            const found = requireTag();
            return runPlan(context, "notes.tag", {
              summary: phrase(context.locale, DELETE_TAG, found.name),
              apply: () => {
                s.org.deleteTag(found.id);
                return { text: phrase(context.locale, DONE, phrase(context.locale, DELETE_TAG, found.name)) };
              },
            });
          }
        }
      }),
  };

  const categories: Tool = {
    name: "notes.categories",
    description: {
      sr: "Izlistava kategorije beleški (vrsta beleške, na primer sastanak). Koristi ga pre notes.category da dobiješ naziv kategorije.",
      en: "Lists the note categories (the kind of note, such as a meeting). Use it before notes.category to get a category's name.",
    },
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
    effect: "read",
    run: (_rawArgs, context) =>
      guard(context, () => {
        assertLive(context);
        const list = open(context.profileId).org.listCategories();
        if (list.length === 0) return okResult(text(context.locale, NO_CATEGORIES));
        return okResult(list.map((entry) => `- ${entry.id} ${entry.name}`).join("\n"));
      }),
  };

  const category: Tool = {
    name: "notes.category",
    description: {
      sr: "Pravi, preimenuje ili briše kategoriju beleški, ili stavlja belešku u kategoriju (bez category uklanja kategoriju). Kategorija ima jedinstven naziv: postojeći naziv se odbija.",
      en: "Creates, renames or deletes a note category, or puts a note in one (leave category out to remove the note's category). A category name is unique: a name that already exists is refused.",
    },
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: [...CATEGORY_ACTIONS], description: "What to do." },
        note: noteReference(),
        category: { type: "string", minLength: 1, maxLength: MAX_NAME_CHARS, description: "The category, by id or name (rename, delete, assign)." },
        name: { type: "string", minLength: 1, maxLength: MAX_NAME_CHARS, description: "The new category's name (create), or its new name (rename)." },
      },
      required: ["action"],
      additionalProperties: false,
    },
    effect: "write",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const action = asEnum(args.action, "action", CATEGORY_ACTIONS);
        const s = open(context.profileId);
        const now = new Date(deps.now()).toISOString();
        const categoryRef = asOptionalText(args.category, "category", MAX_NAME_CHARS);
        const known = s.org.listCategories();
        const requireCategory = (): { id: string; name: string } => {
          if (categoryRef === undefined) throw new Error('"category" is needed for this action.');
          return resolveNamed(known, categoryRef, NOUN.category, context.locale);
        };

        switch (action) {
          case "create": {
            const name = asText(args.name, "name", MAX_NAME_CHARS);
            return runPlan(context, "notes.category", {
              summary: phrase(context.locale, CREATE_CATEGORY, name),
              apply: () => {
                s.org.createCategory({ name, color: null }, now);
                return { text: phrase(context.locale, DONE, phrase(context.locale, CREATE_CATEGORY, name)) };
              },
            });
          }
          case "rename": {
            const found = requireCategory();
            const name = asText(args.name, "name", MAX_NAME_CHARS);
            return runPlan(context, "notes.category", {
              summary: phrase(context.locale, RENAME_CATEGORY, found.name, name),
              apply: () => {
                s.org.updateCategory(found.id, { name }, now);
                return { text: phrase(context.locale, DONE, phrase(context.locale, RENAME_CATEGORY, found.name, name)) };
              },
            });
          }
          case "delete": {
            const found = requireCategory();
            return runPlan(context, "notes.category", {
              summary: phrase(context.locale, DELETE_CATEGORY, found.name),
              apply: () => {
                s.org.deleteCategory(found.id);
                return { text: phrase(context.locale, DONE, phrase(context.locale, DELETE_CATEGORY, found.name)) };
              },
            });
          }
          case "assign": {
            const note = requireNote(s.notes, asText(args.note, "note", MAX_ID_LENGTH), context.locale);
            const found = categoryRef === undefined ? null : requireCategory();
            return runPlan(context, "notes.category", {
              summary: phrase(context.locale, ASSIGN_CATEGORY, note.title, found?.name ?? null),
              apply: () => {
                s.notes.setCategory(note.id, found?.id ?? null);
                return {
                  text: phrase(context.locale, DONE, phrase(context.locale, ASSIGN_CATEGORY, note.title, found?.name ?? null)),
                  navigateTo: { module: "notes", item: note.id },
                };
              },
            });
          }
        }
      }),
  };

  const versions: Tool = {
    name: "notes.versions",
    description: {
      sr: "Izlistava sačuvane verzije beleške, ili čita tekst jedne verzije kada se zada coveredSeq. Da vratiš staru verziju, pročitaj je ovde pa pozovi notes.update sa tim tekstom i capture: true.",
      en: "Lists a note's saved versions, or reads the text of one version when coveredSeq is given. To restore an old version, read it here, then call notes.update with that text and capture: true.",
    },
    parameters: {
      type: "object",
      properties: {
        id: noteReference(),
        coveredSeq: { type: "integer", minimum: 1, description: "The version to read, as the list reports it. Leave out to list them." },
      },
      required: ["id"],
      additionalProperties: false,
    },
    effect: "read",
    run: (rawArgs, context) =>
      guard(context, () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const store = open(context.profileId).notes;
        const note = requireNote(store, asText(args.id, "id", MAX_ID_LENGTH), context.locale);
        const list = store.listVersions(note.id);
        const seq = asOptionalCount(args.coveredSeq, "coveredSeq", 1, Number.MAX_SAFE_INTEGER);
        if (seq === undefined) {
          if (list.length === 0) return okResult(text(context.locale, NO_VERSIONS));
          return okResult(
            [
              phrase(context.locale, VERSIONS_HEADING, list.length),
              ...list.map((version) => `- ${version.coveredSeq} ${version.createdAt} ${version.title}`),
            ].join("\n"),
          );
        }
        if (!list.some((version) => version.coveredSeq === seq)) {
          throw new Error(phrase(context.locale, VERSION_NOT_FOUND, seq));
        }
        const snapshot = store.loadVersion(note.id, seq);
        const body = mergeNoteState(snapshot, []).plaintext;
        const clamped = clampText(body, DEFAULT_READ_CHARS);
        const lines = [`# ${note.title} (${seq})`, clamped.text];
        if (clamped.truncated) lines.push(phrase(context.locale, TRUNCATED_BODY, DEFAULT_READ_CHARS));
        return okResult(lines.join("\n"), { citations: [noteCitationOf(note.id, note.title)] });
      }),
  };

  const templates: Tool = {
    name: "notes.templates",
    description: {
      sr: "Izlistava šablone beleški. Koristi ga pre notes.folder (set-template) da dobiješ naziv šablona.",
      en: "Lists the note templates. Use it before notes.folder (set-template) to get a template's name.",
    },
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
    effect: "read",
    run: (_rawArgs, context) =>
      guard(context, () => {
        assertLive(context);
        const list = open(context.profileId).templates.list();
        if (list.length === 0) return okResult(text(context.locale, NO_TEMPLATES));
        return okResult(list.map((entry) => `- ${entry.id} ${entry.name}`).join("\n"));
      }),
  };

  const checklist: Tool = {
    name: "notes.checklist",
    description: {
      sr: "Pretvara listu zadataka (stavke sa poljem za štikliranje) iz beleške u zadatke na listi zadataka. Beleška se ne menja. Bez liste zadaci idu u Inbox.",
      en: "Turns a note's checklist items into tasks in a task list. The note itself does not change. Without a list the tasks go to the Inbox.",
    },
    parameters: {
      type: "object",
      properties: {
        id: noteReference(),
        list: { type: "string", minLength: 1, maxLength: MAX_NAME_CHARS, description: "The task list, by id or name. Leave out for the Inbox." },
      },
      required: ["id"],
      additionalProperties: false,
    },
    effect: "write",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const s = open(context.profileId);
        const note = requireNote(s.notes, asText(args.id, "id", MAX_ID_LENGTH), context.locale);
        const items = countNoteChecklistItems(s.notes, note.id);
        if (items === 0) throw new Error(text(context.locale, CHECKLIST_EMPTY));
        const listRef = asOptionalText(args.list, "list", MAX_NAME_CHARS);
        const lists = s.lists.listActive();
        const target = listRef === undefined ? lists.find((entry) => entry.isInbox) : resolveNamed(lists, listRef, NOUN.list, context.locale);
        if (target === undefined) throw new Error(text(context.locale, NO_LIST));
        return runPlan(context, "notes.checklist", {
          summary: phrase(context.locale, CHECKLIST_SUMMARY, note.title, items, target.name),
          apply: () => {
            const result = checklistToTasks(
              {
                notes: s.notes,
                tasks: s.tasks,
                lists: s.lists,
                runInTransaction: (write) => s.db.transaction(write)(),
              },
              note.id,
              target.id,
            );
            return {
              text: phrase(context.locale, CHECKLIST_DONE, result.created, result.skipped),
              navigateTo: { module: "tasks" },
            };
          },
        });
      }),
  };

  const flashcards: Tool = {
    name: "notes.flashcards",
    description: {
      sr: "Određuje u koji špil idu kartice za učenje iz beleške (bez deck: kartice se prekidaju). Špil se zadaje id-jem ili nazivom.",
      en: "Sets the deck the flashcards made from a note go to (leave deck out to stop sending them to a deck). The deck is named by id or name.",
    },
    parameters: {
      type: "object",
      properties: {
        id: noteReference(),
        deck: { type: "string", minLength: 1, maxLength: MAX_NAME_CHARS, description: "The deck, by id or name. Leave out to stop." },
      },
      required: ["id"],
      additionalProperties: false,
    },
    effect: "write",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const s = open(context.profileId);
        const note = requireNote(s.notes, asText(args.id, "id", MAX_ID_LENGTH), context.locale);
        const deckRef = asOptionalText(args.deck, "deck", MAX_NAME_CHARS);
        const deck = deckRef === undefined ? null : resolveNamed(s.decks.listActive(), deckRef, NOUN.deck, context.locale);
        const summary = deck === null
          ? phrase(context.locale, CARD_DECK_CLEAR, note.title)
          : phrase(context.locale, CARD_DECK_SET, note.title, deck.name);
        return runPlan(context, "notes.flashcards", {
          summary,
          apply: () => {
            s.notes.setCardDeck(note.id, deck?.id ?? null, new Date(deps.now()).toISOString());
            return { text: phrase(context.locale, DONE, summary), navigateTo: { module: "notes", item: note.id } };
          },
        });
      }),
  };

  return [
    search,
    read,
    create,
    append,
    update,
    remove,
    restore,
    duplicate,
    folders,
    folder,
    tags,
    tag,
    categories,
    category,
    versions,
    templates,
    checklist,
    flashcards,
  ];
}

/** The stores one call works through, all on the session's own connection. */
type NoteStores = ReturnType<typeof openStores>;

/** A folder or template as the planners need it: its id for the write, its name for the sentence. */
type NoteFolderLike = { readonly id: string; readonly name: string };

/** What a planned write does and says: its confirmation line, and the apply step that runs once the user agrees. */
interface Plan {
  readonly summary: string;
  readonly apply: () => { readonly text: string; readonly navigateTo?: AppLocation };
}

function openStores(db: Database.Database, profileId: string) {
  return {
    db,
    notes: new NoteStore(db, profileId),
    org: new NoteOrgStore(db, profileId),
    cards: new CardStore(db, profileId),
    decks: new DeckStore(db, profileId),
    templates: new NoteTemplateStore(db, profileId),
    lists: new TaskListStore(db, profileId),
    tasks: new TaskStore(db, profileId),
    attachments: new NoteAttachmentStore(db, profileId),
  };
}

/**
 * Asks once, then applies a planned write. A refusal changes nothing, and the
 * apply step is only reached through the user's yes.
 */
async function runPlan(context: ToolContext, tool: string, plan: Plan): Promise<ToolResult> {
  const declined = await confirmOrDecline(context, tool, "write", plan.summary);
  if (declined !== null) return declined;
  const outcome = plan.apply();
  return okResult(outcome.text, outcome.navigateTo === undefined ? {} : { navigateTo: outcome.navigateTo });
}

/** The schema of a note argument: its id, or its exact title. */
function noteReference(): { type: "string"; minLength: number; maxLength: number; description: string } {
  return {
    type: "string",
    minLength: 1,
    maxLength: MAX_ID_LENGTH,
    description: "The note: its id as notes.search reports it, or its exact title.",
  };
}

/** Folds two names for comparison: case, diacritics and surrounding space do not count. */
function sameName(left: string, right: string): boolean {
  return foldSearchText(left.trim()) === foldSearchText(right.trim());
}

/** The items a reference names: the one with that id, or every one with that name. */
function namedMatches<T extends { readonly id: string; readonly name: string }>(
  items: readonly T[],
  wanted: string,
): T[] {
  const byId = items.filter((item) => item.id === wanted);
  return byId.length > 0 ? byId : items.filter((item) => sameName(item.name, wanted));
}

/**
 * The one item a reference names, or a refusal that lists the names that exist
 * (so the model can correct itself) or the candidates' ids (so it can pick one).
 */
function resolveNamed<T extends { readonly id: string; readonly name: string }>(
  items: readonly T[],
  wanted: string,
  noun: Noun,
  locale: AssistantLocale,
): T {
  const matches = namedMatches(items, wanted);
  const [first] = matches;
  if (first === undefined) {
    const known = items.map((item) => item.name).join(", ") || text(locale, NONE_LISTED);
    throw new Error(phrase(locale, NAME_NOT_FOUND, noun, wanted, known));
  }
  if (matches.length > 1) {
    throw new Error(phrase(locale, NAME_AMBIGUOUS, noun, wanted, matches.map((item) => item.id).join(", ")));
  }
  return first;
}

/**
 * The one note a reference names, or a refusal.
 *
 * Read from the active notes of this profile, so an id belonging to another
 * profile, to a soft-deleted note or to nothing at all is one answer. A title
 * is accepted when no note has that id, and an ambiguous title is refused with
 * the ids it could be.
 */
function requireNote(store: NoteStore, wanted: string, locale: AssistantLocale): NoteMeta {
  const notes = store.list();
  const byId = notes.find((note) => note.id === wanted);
  if (byId !== undefined) return byId;
  const matches = notes.filter((note) => sameName(note.title, wanted));
  const [first] = matches;
  if (first === undefined) throw new Error(phrase(locale, NOTE_NOT_FOUND, wanted));
  if (matches.length > 1) {
    throw new Error(phrase(locale, NAME_AMBIGUOUS, NOUN.note, wanted, matches.map((note) => note.id).join(", ")));
  }
  return first;
}

/**
 * Rewrites a note's body through `edit` and returns the one incremental Yjs
 * update that says what changed.
 *
 * The document is rebuilt from the note's own merged state, so the difference is
 * against exactly what the store holds, and both state vectors belong to the
 * same history. The scratch document is released even when the edit throws.
 */
function rewriteBody(store: NoteStore, id: string, edit: (doc: Y.Doc) => void): Uint8Array {
  const read = store.readForCompaction(id);
  const base = new Y.Doc();
  try {
    if (read.snapshot !== null) Y.applyUpdate(base, read.snapshot);
    for (const update of read.updates) Y.applyUpdate(base, update.bytes);
    const before = Y.encodeStateVector(base);
    edit(base);
    return Y.encodeStateAsUpdate(base, before);
  } finally {
    base.destroy();
  }
}

/** One incremental Yjs update that appends `blocks` to the end of a note's body (see `cloneNode`). */
function appendBlocks(store: NoteStore, id: string, blocks: readonly MarkdownBlock[]): Uint8Array {
  return rewriteBody(store, id, (base) => {
    const source = new Y.Doc();
    try {
      Y.applyUpdate(source, buildNoteUpdate(blocks));
      const fragment = base.getXmlFragment("default");
      const copied = source.getXmlFragment("default").toArray().flatMap((node) => cloneNode(node));
      fragment.insert(fragment.length, copied);
    } finally {
      source.destroy();
    }
  });
}

/**
 * Replaces a note's first block — its title, as `deriveTitle` reads it — with
 * the blocks of a title-only Markdown document. Everything after it is kept.
 */
function replaceFirstBlock(base: Y.Doc, titleUpdate: Uint8Array): void {
  const source = new Y.Doc();
  try {
    Y.applyUpdate(source, titleUpdate);
    const fragment = base.getXmlFragment("default");
    if (fragment.length > 0) fragment.delete(0, 1);
    fragment.insert(0, source.getXmlFragment("default").toArray().flatMap((node) => cloneNode(node)));
  } finally {
    source.destroy();
  }
}

/**
 * The note's text as it stands, derived from the stored document.
 *
 * Merged rather than read from `note_snapshots.plaintext`, because that column
 * only catches up at the next compaction (`main/notes.ts`'s idle debounce) — and
 * a note edited a moment ago must not read as its older self. `mergeNoteState`
 * is the same fold the compaction itself performs.
 */
function plaintextOf(store: NoteStore, id: string): string {
  const read = store.readForCompaction(id);
  return mergeNoteState(
    read.snapshot,
    read.updates.map((update) => update.bytes),
  ).plaintext;
}

/**
 * What a note links to and what links to it, and its flashcards, as the lines
 * a read adds after the text. Nothing is added for a note with none of them.
 */
function relationLines(s: NoteStores, note: NoteMeta, locale: AssistantLocale): string[] {
  const doc = new Y.Doc();
  let linkIds: string[];
  try {
    const read = s.notes.readForCompaction(note.id);
    if (read.snapshot !== null) Y.applyUpdate(doc, read.snapshot);
    for (const update of read.updates) Y.applyUpdate(doc, update.bytes);
    linkIds = collectNoteLinkIds(doc);
  } finally {
    doc.destroy();
  }
  const titles = new Map(s.notes.list().map((entry) => [entry.id, entry.title]));
  const outbound = linkIds.flatMap((id) => titles.get(id) ?? []);
  const inbound = s.notes.listBacklinks(note.id).map((entry) => entry.title);
  const cards = s.cards.countCardsOfNote(note.id);
  const deck = note.cardDeckId === null ? null : (s.decks.listActive().find((entry) => entry.id === note.cardDeckId)?.name ?? null);

  const lines: string[] = [];
  if (outbound.length > 0) lines.push(phrase(locale, LINKS_TO, outbound.join(", ")));
  if (inbound.length > 0) lines.push(phrase(locale, LINKED_FROM, inbound.join(", ")));
  if (cards > 0 || deck !== null) lines.push(phrase(locale, FLASHCARDS_LINE, cards, deck));
  return lines;
}

/**
 * Copies one Yjs XML node into another document.
 *
 * A generic structural copy, and deliberately not a Markdown mapping: the block
 * shapes come from `@nexus/core`'s `buildNoteUpdate`, which is the same function
 * every other note in the app was built by, and all this does is MOVE the result
 * into a document that already has content.
 *
 * Two details are load-bearing. A text run's marks are read off `toDelta()` and
 * re-applied as the new run's attributes — `XmlText.insert` inherits any
 * attribute the call does not mention, so each run is written into its OWN
 * `XmlText`, where there is no active formatting to inherit. And a node's
 * attributes are copied verbatim: the editor stores `level`/`start` as numbers
 * and `checked`/`collapsed` as booleans behind a string-typed API
 * (`markdownImport.ts`'s `setAttribute`), so reading them back and writing them
 * out unchanged keeps whatever the source document meant.
 *
 * An `XmlHook` carries no content and is dropped rather than guessed at; nothing
 * a note document is built from uses one.
 */
function cloneNode(
  node: Y.XmlElement | Y.XmlText | Y.XmlHook,
): readonly (Y.XmlElement | Y.XmlText)[] {
  if (node instanceof Y.XmlText) {
    // One `Y.XmlText` per delta segment: a text run may carry several (bold,
    // then plain), and each new run goes into a type of its own so there is no
    // active formatting for it to inherit — see the note on `XmlText.insert`
    // above. Sibling runs are exactly what the editor itself produces.
    const runs: Y.XmlText[] = [];
    for (const op of node.toDelta() as { insert?: unknown; attributes?: Record<string, unknown> }[]) {
      if (typeof op.insert !== "string" || op.insert.length === 0) continue;
      const run = new Y.XmlText();
      run.insert(0, op.insert, op.attributes ?? {});
      runs.push(run);
    }
    return runs;
  }
  if (!(node instanceof Y.XmlElement)) return [];

  const copy = new Y.XmlElement(node.nodeName);
  for (const [key, value] of Object.entries(node.getAttributes())) {
    // `getAttributes` types every value as optional; a key that holds nothing is
    // a key the source document does not carry.
    if (value === undefined) continue;
    copy.setAttribute(key, value);
  }
  const children = node.toArray().flatMap((child) => cloneNode(child));
  if (children.length > 0) copy.insert(0, children);
  return [copy];
}

/** One note hit as a line: the id the follow-up read or append needs, then the title and the matching snippet. */
function noteLine(hit: SearchResult): string {
  const snippet = hit.snippet.trim().replace(/\s+/g, " ");
  return snippet.length === 0
    ? `- ${hit.entityId} ${hit.title}`
    : `- ${hit.entityId} ${hit.title} — ${snippet}`;
}

/** A note the answer drew on, so the page can open what the assistant read. */
function noteCitation(hit: SearchResult): Citation {
  return noteCitationOf(hit.entityId, hit.title);
}

function noteCitationOf(id: string, title: string): Citation {
  return { kind: "note", id, title, location: { module: "notes", item: id } };
}
