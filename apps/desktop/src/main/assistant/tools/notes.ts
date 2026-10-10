/**
 * The NOTE module: find one, read it, write a new one, add to an existing one.
 *
 * **A note is a CRDT, and main writes it the way main already does.** A note's
 * body is a Yjs document (`NoteStore` keeps opaque blobs, ADR-012), and the app
 * never writes one by hand: `markdownImport.ts` parses Markdown into the block
 * tree `@nexus/core`'s `buildNoteUpdate` turns into a single Yjs update, appends
 * it through `NoteStore.appendUpdate`, and folds it with `compactNow` — the same
 * `main/notes.ts` fold every keystroke flush schedules — which is what writes
 * the searchable plaintext and the first version-history checkpoint. Both writes
 * below go through exactly that path, so a note the assistant wrote is
 * indistinguishable from one somebody typed: search finds it, history has it,
 * the editor opens it.
 *
 * **Appending needs a seam the app does not have, and this file carries the
 * smallest one that works.** `buildNoteUpdate` builds a WHOLE document from
 * scratch, and applying such an update to a document that already has content
 * inserts the new blocks at the START — Yjs resolves their position from
 * origins that say „the fragment is empty". So `appendBlocks` replays the note's
 * own merged state into a scratch document, copies the parsed blocks into the
 * END of its fragment, and encodes the difference against the state vector it
 * started from — an ordinary incremental update, which is what
 * `appendUpdate` was built for. The copy is a generic Yjs XML clone (see
 * `cloneNode`); the Markdown→Yjs mapping itself is never restated, so the
 * shapes the editor sees are still the ones `buildNoteUpdate` produces.
 *
 * **The private vault is not reachable from here, by construction.**
 * „Privatno" is a separate store over separate sealed tables (`PrivateNoteStore`
 * and `priv`'s envelope, unlocked by a credential of its own), and none of these
 * four tools opens it: `notes.search` reads the profile's global search index
 * (which migration 017 builds from `notes` alone) and reads/creates through
 * `NoteStore`. That is why the descriptions say so out loud — a model that
 * believes it can read the vault is worse than one that knows it cannot.
 */

import * as Y from "yjs";
import { MAX_NOTE_UPDATE_BYTES, NoteStore } from "@nexus/db";
import { MAX_ID_LENGTH, buildNoteUpdate, mergeNoteState, parseMarkdownNote } from "@nexus/core";
import type { MarkdownBlock } from "@nexus/core";
import type { AssistantLocale, Citation, Tool } from "@nexus/core";
import type { SearchResult } from "../../../shared/ipc.js";
import { compactNow } from "../../notes.js";
import {
  asArgs,
  asIdentifier,
  asOptionalCount,
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

const NOTES_HEADING: AssistantPhrase<[count: number, query: string]> = {
  sr: (count, query) => `Beleške (${count}) za „${query}“:`,
  en: (count, query) => `Notes (${count}) for “${query}”:`,
};

const NO_NOTES: AssistantPhrase<[query: string]> = {
  sr: (query) => `Nema beleški koje odgovaraju upitu „${query}“.`,
  en: (query) => `No notes match “${query}”.`,
};

const NOTE_NOT_FOUND: AssistantPhrase<[id: string]> = {
  sr: (id) => `Ne postoji aktivna beleška sa id-jem „${id}“.`,
  en: (id) => `No active note has the id “${id}”.`,
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

export function noteTools(deps: NoteToolDeps): readonly Tool[] {
  function noteStore(profileId: string): NoteStore {
    return deps.profileDb(profileId, (db, id) => new NoteStore(db, id));
  }

  const search: Tool = {
    name: "notes.search",
    description: {
      sr: "Pretražuje beleške preko indeksa globalne pretrage. Koristi ga da nađeš belešku pre nego što je pročitaš ili dopuniš. Privatna beleške („Privatno“) nisu dostupne ovom alatu.",
      en: "Searches notes through the app's global search index. Use it to find a note before reading or appending to it. Private-vault notes („Privatno“) are not reachable from this tool.",
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
      sr: "Čita tekst jedne beleške. Vraća samo tekst, bez formatiranja, i skraćuje ga na traženu dužinu. Koristi ga kada korisnik traži da pročitaš ili sažmeš belešku.",
      en: "Reads one note's text. It answers with plain text only and cuts it to the requested length. Use it when the user asks you to read or summarise a note.",
    },
    parameters: {
      type: "object",
      properties: {
        id: {
          type: "string",
          minLength: 1,
          maxLength: MAX_ID_LENGTH,
          description: "The note id, as notes.search reports it.",
        },
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
        const id = asIdentifier(args.id, "id");
        const maxChars =
          asOptionalCount(args.maxChars, "maxChars", 200, MAX_READ_CHARS) ?? DEFAULT_READ_CHARS;
        const store = noteStore(context.profileId);
        const note = requireNote(store, id, context.locale);
        const body = plaintextOf(store, id);
        if (body.trim().length === 0) {
          return okResult(text(context.locale, EMPTY_NOTE), {
            citations: [noteCitationOf(id, note.title)],
          });
        }
        const clamped = clampText(body, maxChars);
        const content = [`# ${note.title} (${id})`, clamped.text];
        if (clamped.truncated) {
          content.push(phrase(context.locale, TRUNCATED_BODY, maxChars));
        }
        return okResult(content.join("\n"), { citations: [noteCitationOf(id, note.title)] });
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
        id: {
          type: "string",
          minLength: 1,
          maxLength: MAX_ID_LENGTH,
          description: "The note id, as notes.search reports it.",
        },
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
        const id = asIdentifier(args.id, "id");
        const body = asText(args.text, "text", MAX_BODY_CHARS);
        const store = noteStore(context.profileId);
        const note = requireNote(store, id, context.locale);

        // The fallback title is deliberately empty: `parseMarkdownNote` would
        // otherwise MATERIALIZE it as a leading `# ` heading, which in the middle
        // of a note is a second title rather than a paragraph.
        const blocks = parseMarkdownNote(body, "").blocks;
        if (blocks.length === 0) {
          throw new Error(text(context.locale, NOTHING_TO_WRITE));
        }
        const update = appendBlocks(store, id, blocks);
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
          live.appendUpdate(id, update, note.title, now);
          compactNow(live, id);
        });
        return okResult(phrase(context.locale, WRITTEN.appended, note.title, id), {
          citations: [noteCitationOf(id, note.title)],
        });
      }),
  };

  return [search, read, create, append];
}

/**
 * The one note an argument names, or a refusal.
 *
 * Read through `NoteStore.load`, so an id belonging to another profile, to a
 * soft-deleted note or to nothing at all becomes one answer — and so the title
 * in the confirmation sentence is a fact read before the user is asked, not
 * after.
 */
function requireNote(store: NoteStore, id: string, locale: AssistantLocale): { title: string } {
  try {
    return { title: store.load(id).title };
  } catch {
    throw new Error(phrase(locale, NOTE_NOT_FOUND, id));
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
 * One incremental Yjs update that appends `blocks` to the end of a note's body.
 *
 * The document is rebuilt from the note's own merged state, so the diff is
 * against exactly what the store holds; the new blocks are copied into the
 * fragment's end (see `cloneNode`); and the difference between the two state
 * vectors is what `appendUpdate` receives. Both documents are throwaway, and
 * both are released even when the copy throws.
 */
function appendBlocks(store: NoteStore, id: string, blocks: readonly MarkdownBlock[]): Uint8Array {
  const read = store.readForCompaction(id);
  const base = new Y.Doc();
  const source = new Y.Doc();
  try {
    if (read.snapshot !== null) Y.applyUpdate(base, read.snapshot);
    for (const update of read.updates) Y.applyUpdate(base, update.bytes);
    const before = Y.encodeStateVector(base);

    Y.applyUpdate(source, buildNoteUpdate(blocks));
    const fragment = base.getXmlFragment("default");
    const copied = source.getXmlFragment("default").toArray().flatMap((node) => cloneNode(node));
    fragment.insert(fragment.length, copied);
    return Y.encodeStateAsUpdate(base, before);
  } finally {
    base.destroy();
    source.destroy();
  }
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
