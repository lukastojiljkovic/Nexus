import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  CardStore,
  DeckStore,
  NexusDatabase,
  NoteOrgStore,
  NoteStore,
  NoteTemplateStore,
  SubjectStore,
  TaskListStore,
  TaskStore,
  openDatabase,
  uuidv7,
} from "@nexus/db";
import { mergeNoteState } from "@nexus/core";
import type { ConfirmRequest, SearchKind, Tool, ToolContext } from "@nexus/core";
import type { SearchResult } from "../../../shared/ipc.js";
import { noteTools } from "./notes.js";

/**
 * The NOTE tools over a real database.
 *
 * A note's body is a CRDT, so the assertions here are about the TEXT a merge
 * derives from the document the tool wrote — the exact string `mergeNoteState`
 * produces, which is also what the search index carries. The append case is the
 * one worth reading twice: it is the only write in this registry that has to
 * splice new blocks into a document that already has some.
 */

const NOW_MS = new Date(2026, 9, 10, 9, 0, 0).getTime();
const NOW_ISO = new Date(NOW_MS).toISOString();

let dir: string;
let db: NexusDatabase;
let profileId: string;
let hits: readonly SearchResult[] = [];
let searched: { profileId: string; query: string; limit: number }[] = [];

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-tool-notes-"));
  db = openDatabase({ path: join(dir, "profile.db") });
});

afterAll(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  profileId = uuidv7();
  hits = [];
  searched = [];
  db.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(profileId, "personal", "Test", NOW_ISO);
});

function store(): NoteStore {
  return new NoteStore(db.raw, profileId);
}

function tools(): readonly Tool[] {
  return noteTools({
    profileDb: (id, open) => open(db.raw, id),
    now: () => NOW_MS,
    search: (id, query, limit) => {
      searched.push({ profileId: id, query, limit });
      return Promise.resolve(hits);
    },
  });
}

function toolOf(name: string): Tool {
  const found = tools().find((entry) => entry.name === name);
  if (found === undefined) throw new Error(`Test setup: no tool "${name}".`);
  return found;
}

function contextFor(locale: "sr" | "en", allow: boolean): {
  readonly context: ToolContext;
  readonly confirms: ConfirmRequest[];
} {
  const confirms: ConfirmRequest[] = [];
  return {
    confirms,
    context: {
      profileId,
      locale,
      signal: new AbortController().signal,
      confirm: (request) => {
        confirms.push(request);
        return Promise.resolve(allow);
      },
    },
  };
}

/** The note's text as the app derives it: exactly what `notes.read` answers with, read straight from the store here. */
function plaintext(id: string): string {
  const read = store().readForCompaction(id);
  return mergeNoteState(
    read.snapshot,
    read.updates.map((update) => update.bytes),
  ).plaintext;
}

function searchHit(kind: SearchKind, id: string, title: string, snippet = ""): SearchResult {
  return {
    kind,
    entityId: id,
    parentId: null,
    title,
    titleRanges: [],
    snippet,
    snippetRanges: [],
    contextDate: null,
    updatedAt: NOW_ISO,
    fromAttachment: false,
  };
}

describe("notes.create", () => {
  it("asks, then writes a searchable note whose title is its first block", async () => {
    const recorder = contextFor("en", true);
    const result = await toolOf("notes.create").run(
      { title: "Naslov", text: "Prvi pasus" },
      recorder.context,
    );

    expect(recorder.confirms).toEqual([
      { tool: "notes.create", summary: "Create the note “Naslov”", effect: "write" },
    ]);
    const notes = store().list();
    expect(notes).toHaveLength(1);
    const note = notes[0];
    if (note === undefined) throw new Error("no note was written");
    expect(note.title).toBe("Naslov");
    expect(plaintext(note.id)).toBe("Naslov\nPrvi pasus");
    expect(store().storedPlaintext(note.id)).toBe("Naslov\nPrvi pasus");
    expect(result).toEqual({
      ok: true,
      content: `Created note “Naslov” (${note.id}).`,
      citations: [
        { kind: "note", id: note.id, title: "Naslov", location: { module: "notes", item: note.id } },
      ],
      navigateTo: { module: "notes", item: note.id },
    });
  });

  it("keeps Markdown structure, one line per block", async () => {
    const recorder = contextFor("en", true);
    await toolOf("notes.create").run(
      { title: "Kupovina", text: "## Spisak\n\n- mleko\n- hleb" },
      recorder.context,
    );
    const note = store().list()[0];
    if (note === undefined) throw new Error("no note was written");
    expect(plaintext(note.id)).toBe("Kupovina\nSpisak\nmleko\nhleb");
  });

  it("writes nothing when the user declines", async () => {
    const recorder = contextFor("sr", false);
    const result = await toolOf("notes.create").run(
      { title: "Naslov", text: "Prvi pasus" },
      recorder.context,
    );
    expect(recorder.confirms[0]?.summary).toBe("Napravi belešku „Naslov“");
    expect(result).toEqual({ ok: false, content: "The user declined." });
    expect(store().list()).toEqual([]);
  });
});

describe("notes.append", () => {
  it("adds to the end of a note and leaves what was there alone", async () => {
    const creator = contextFor("en", true);
    await toolOf("notes.create").run({ title: "Naslov", text: "Prvi pasus" }, creator.context);
    const note = store().list()[0];
    if (note === undefined) throw new Error("no note was written");

    const recorder = contextFor("en", true);
    const result = await toolOf("notes.append").run(
      { id: note.id, text: "Drugi pasus" },
      recorder.context,
    );

    expect(recorder.confirms).toEqual([
      { tool: "notes.append", summary: "Append to the note “Naslov”", effect: "write" },
    ]);
    expect(result.ok).toBe(true);
    expect(plaintext(note.id)).toBe("Naslov\nPrvi pasus\nDrugi pasus");
  });

  it("carries formatting across the append, not just the text", async () => {
    const creator = contextFor("en", true);
    await toolOf("notes.create").run({ title: "Naslov", text: "Prvi pasus" }, creator.context);
    const note = store().list()[0];
    if (note === undefined) throw new Error("no note was written");

    await toolOf("notes.append").run(
      { id: note.id, text: "**važno**" },
      contextFor("en", true).context,
    );

    // The appended run keeps its mark, which is the half a text-only assertion
    // cannot see: `cloneNode` copies a run's delta attributes into the target
    // document, and a run that lost them would read identically as plaintext.
    const read = store().readForCompaction(note.id);
    const doc = new Y.Doc();
    try {
      if (read.snapshot !== null) Y.applyUpdate(doc, read.snapshot);
      for (const update of read.updates) Y.applyUpdate(doc, update.bytes);
      const children = doc.getXmlFragment("default").toArray();
      const last = children.at(-1);
      if (!(last instanceof Y.XmlElement)) throw new Error("the note's last block is not an element");
      expect(last.nodeName).toBe("paragraph");
      const runs = last.toArray().filter((node): node is Y.XmlText => node instanceof Y.XmlText);
      const delta = runs.flatMap(
        (run) => run.toDelta() as { insert?: unknown; attributes?: Record<string, unknown> }[],
      );
      expect(delta).toHaveLength(1);
      expect(delta[0]?.insert).toBe("važno");
      expect(delta[0]?.attributes?.["bold"]).toBe(true);
    } finally {
      doc.destroy();
    }
  });

  it("changes nothing when the user declines", async () => {
    const creator = contextFor("en", true);
    await toolOf("notes.create").run({ title: "Naslov", text: "Prvi pasus" }, creator.context);
    const note = store().list()[0];
    if (note === undefined) throw new Error("no note was written");

    const result = await toolOf("notes.append").run(
      { id: note.id, text: "Drugi pasus" },
      contextFor("en", false).context,
    );
    expect(result).toEqual({ ok: false, content: "The user declined." });
    expect(plaintext(note.id)).toBe("Naslov\nPrvi pasus");
  });
});

describe("notes.read", () => {
  it("answers with the text, and says when it had to cut it", async () => {
    /** 250 characters: long enough that a 200-character cap really bites. */
    const long = "a".repeat(250);
    const creator = contextFor("en", true);
    await toolOf("notes.create").run(
      { title: "Naslov", text: long },
      creator.context,
    );
    const note = store().list()[0];
    if (note === undefined) throw new Error("no note was written");

    const full = await toolOf("notes.read").run({ id: note.id }, contextFor("en", true).context);
    expect(full).toEqual({
      ok: true,
      content: `# Naslov (${note.id})\nNaslov\n${long}`,
      citations: [
        { kind: "note", id: note.id, title: "Naslov", location: { module: "notes", item: note.id } },
      ],
    });

    const cut = await toolOf("notes.read").run(
      { id: note.id, maxChars: 200 },
      contextFor("en", true).context,
    );
    expect(cut.content).toBe(
      `# Naslov (${note.id})\n${`Naslov\n${long}`.slice(0, 200)}\n… the text was cut to 200 characters.`,
    );
  });

  it("says so when the note has no text yet", async () => {
    const created = store().create(NOW_ISO);
    const result = await toolOf("notes.read").run(
      { id: created.id },
      contextFor("sr", true).context,
    );
    expect(result.ok).toBe(true);
    expect(result.content).toBe("Ta beleška još nema teksta.");
  });

  it("refuses an id this profile does not have", async () => {
    const result = await toolOf("notes.read").run(
      { id: uuidv7() },
      contextFor("en", true).context,
    );
    expect(result.ok).toBe(false);
    expect(result.content).toContain("No active note has the id");
  });
});

describe("notes.search", () => {
  it("asks the app's search for a wider net and keeps the note hits", async () => {
    hits = [
      searchHit("task", "t1", "Kupiti vodu"),
      searchHit("note", "n1", "Voda u ishrani", "pijem dosta vode"),
      searchHit("note", "n2", "Bilješke"),
    ];
    const result = await toolOf("notes.search").run(
      { query: "voda", limit: 2 },
      contextFor("en", true).context,
    );

    expect(searched).toEqual([{ profileId, query: "voda", limit: 6 }]);
    expect(result.content).toBe(
      ["Notes (2) for “voda”:", "- n1 Voda u ishrani — pijem dosta vode", "- n2 Bilješke"].join("\n"),
    );
    expect(result.citations?.map((citation) => citation.id)).toEqual(["n1", "n2"]);
  });

  it("says so when no note matched", async () => {
    hits = [searchHit("task", "t1", "Kupiti vodu")];
    const result = await toolOf("notes.search").run(
      { query: "voda" },
      contextFor("sr", true).context,
    );
    expect(result).toEqual({ ok: true, content: "Nema beleški koje odgovaraju upitu „voda“." });
  });

  it("refuses an empty query before it asks the search anything", async () => {
    const result = await toolOf("notes.search").run(
      { query: "   " },
      contextFor("en", true).context,
    );
    expect(result).toEqual({ ok: false, content: 'Failed: "query" must be a non-empty string.' });
    expect(searched).toEqual([]);
  });
});

/** Writes a note through the tool and returns its id, so each test starts from a real note. */
async function createNote(title: string, body?: string): Promise<string> {
  const known = new Set(store().list().map((note) => note.id));
  await toolOf("notes.create").run(body === undefined ? { title } : { title, text: body }, contextFor("en", true).context);
  const created = store().list().find((note) => !known.has(note.id));
  if (created === undefined) throw new Error("no note was written");
  return created.id;
}

/** Runs a tool with a confirmation answer, in English unless told otherwise. */
function run(name: string, args: Record<string, unknown>, allow = true, locale: "sr" | "en" = "en") {
  return toolOf(name).run(args, contextFor(locale, allow).context);
}

/** Every stored byte of a note, so a test can say the note did not change at all. */
function bytesOf(id: string): string {
  const read = store().readForCompaction(id);
  return JSON.stringify([read.snapshot === null ? null : [...read.snapshot], read.updates.map((update) => [...update.bytes])]);
}

describe("notes.update", () => {
  it("replaces the body, keeps the title, and keeps the search text current", async () => {
    const id = await createNote("Naslov", "Stari tekst");
    const recorder = contextFor("en", true);
    const result = await toolOf("notes.update").run({ id, body: "Nov tekst" }, recorder.context);

    expect(recorder.confirms).toEqual([
      { tool: "notes.update", summary: "Change the note “Naslov”: replace its whole text", effect: "write" },
    ]);
    expect(result).toEqual({
      ok: true,
      content: "Done: Change the note “Naslov”: replace its whole text.",
      navigateTo: { module: "notes", item: id },
    });
    expect(plaintext(id)).toBe("Naslov\nNov tekst");
    expect(store().storedPlaintext(id)).toBe("Naslov\nNov tekst");
  });

  it("renames a note by rewriting its first block, the one its title is read from", async () => {
    const id = await createNote("Stari", "Telo");
    await run("notes.update", { id, title: "Novi" });
    expect(store().load(id).title).toBe("Novi");
    expect(plaintext(id)).toBe("Novi\nTelo");
  });

  it("keeps the current version in the history before a change when asked", async () => {
    const id = await createNote("Naslov", "Stari tekst");
    // An append inside the ten-minute window adds no checkpoint of its own, so the
    // text below is in the history only if `capture` put it there.
    await run("notes.append", { id, text: "Dodato" });
    await run("notes.update", { id, body: "Nov tekst", capture: true });
    const texts = store().listVersions(id).map((version) =>
      mergeNoteState(store().loadVersion(id, version.coveredSeq), []).plaintext,
    );
    expect(texts).toContain("Naslov\nStari tekst\nDodato");
  });

  it("pins a note by its title", async () => {
    const source = await createNote("Izvor", "Početak");
    await run("notes.update", { id: "Izvor", pinned: true });

    expect(store().list().find((note) => note.id === source)?.pinned).toBe(true);
  });

  it("refuses links: a note's links come from its text", async () => {
    const source = await createNote("Izvor", "Početak");
    const result = await run("notes.update", { id: source, links: [] });
    expect(result.ok).toBe(false);
  });

  it("refuses a title that more than one note has, and lists their ids", async () => {
    await createNote("Dup");
    await createNote("Dup");
    const result = await run("notes.update", { id: "Dup", pinned: true });
    expect(result.ok).toBe(false);
    expect(result.content).toMatch(/^Failed: More than one note is called “Dup” \(.+, .+\)\. Use its id\.$/);
  });

  it("refuses a note the profile does not have, by id or by title", async () => {
    const result = await run("notes.update", { id: "Nema ovakve", pinned: true });
    expect(result.content).toBe("Failed: No active note has the id or title “Nema ovakve”.");
  });

  it("refuses a call that changes nothing, before it asks", async () => {
    const id = await createNote("Naslov", "Tekst");
    const recorder = contextFor("en", true);
    const result = await toolOf("notes.update").run({ id }, recorder.context);
    expect(result).toEqual({ ok: false, content: "Failed: There is nothing to change." });
    expect(recorder.confirms).toEqual([]);
  });

  it("writes nothing when the user declines", async () => {
    const id = await createNote("Naslov", "Stari tekst");
    const before = bytesOf(id);
    const result = await run("notes.update", { id, body: "Nov tekst", pinned: true }, false, "sr");
    expect(result).toEqual({ ok: false, content: "The user declined." });
    expect(bytesOf(id)).toBe(before);
    expect(store().list().find((note) => note.id === id)?.pinned).toBe(false);
  });
});

describe("notes.read and links", () => {
  it("names the notes a note links to in its text, and the notes that link to it", async () => {
    const target = await createNote("Cilj", "Kraj");
    const source = await createNote("Izvor", "Početak");
    // A wiki-link is a `noteLink` node in the document; the editor writes one, and
    // the store's link table (which backlinks read) is filled from it at flush time.
    const doc = new Y.Doc();
    const read = store().readForCompaction(source);
    if (read.snapshot !== null) Y.applyUpdate(doc, read.snapshot);
    for (const update of read.updates) Y.applyUpdate(doc, update.bytes);
    const fragment = doc.getXmlFragment("default");
    const before = Y.encodeStateVector(doc);
    const link = new Y.XmlElement("noteLink");
    link.setAttribute("noteId", target);
    fragment.insert(fragment.length, [link]);
    store().appendUpdate(source, Y.encodeStateAsUpdate(doc, before), "Izvor", NOW_ISO);
    doc.destroy();
    store().setOutboundLinks(source, [target]);

    const from = await run("notes.read", { id: source });
    expect(from.content).toContain("Links to: Cilj.");
    const into = await run("notes.read", { id: target });
    expect(into.content).toContain("Linked from: Izvor.");
  });
});

describe("notes.delete and notes.restore", () => {
  it("moves a note to the trash, and brings it back", async () => {
    const id = await createNote("Naslov", "Tekst");
    await run("notes.delete", { id });
    expect(store().list()).toEqual([]);

    const result = await run("notes.restore", { id });
    expect(result).toEqual({
      ok: true,
      content: `Done: Restore the note (${id}) from the trash.`,
      navigateTo: { module: "notes", item: id },
    });
    expect(plaintext(id)).toBe("Naslov\nTekst");
  });

  it("asks about the note's flashcards, and deletes them only when asked", async () => {
    const id = await createNote("Naslov", "Tekst");
    const deck = await createDeckFor(id);
    const recorder = contextFor("en", true);
    await toolOf("notes.delete").run({ id, cards: "delete" }, recorder.context);

    expect(recorder.confirms[0]?.summary).toBe("Delete the note “Naslov” and its flashcards (1)");
    expect(new CardStore(db.raw, profileId).countCardsOfNote(id)).toBe(0);

    await run("notes.restore", { id });
    expect(new CardStore(db.raw, profileId).countCardsOfNote(id)).toBe(1);
    expect(store().list().find((note) => note.id === id)?.cardDeckId).toBe(deck);
  });

  it("keeps the flashcards by default, and unmaps the note from its deck", async () => {
    const id = await createNote("Naslov", "Tekst");
    const deck = await createDeckFor(id);
    const recorder = contextFor("en", true);
    await toolOf("notes.delete").run({ id }, recorder.context);

    expect(recorder.confirms[0]?.summary).toBe("Delete the note “Naslov”; keep its flashcards (1)");
    expect(new CardStore(db.raw, profileId).listByDeck(deck)).toHaveLength(1);
    await run("notes.restore", { id });
    expect(store().list().find((note) => note.id === id)?.cardDeckId).toBeNull();
  });
});

describe("notes.duplicate", () => {
  it("makes a copy with the same text, and opens the copy", async () => {
    const id = await createNote("Original", "Tekst");
    const result = await run("notes.duplicate", { id });
    const copy = store().list().find((note) => note.id !== id);
    if (copy === undefined) throw new Error("no copy was made");

    expect(result.navigateTo).toEqual({ module: "notes", item: copy.id });
    expect(plaintext(copy.id)).toContain("Tekst");
    expect(plaintext(id)).toBe("Original\nTekst");
  });
});

/** A subject and a deck with one flashcard made from the note, so a delete has cards to settle. */
async function createDeckFor(noteId: string): Promise<string> {
  const subject = new SubjectStore(db.raw, profileId).create({ name: "Matematika" });
  const deck = new DeckStore(db.raw, profileId).create({ subjectId: subject.id, name: "Ispit" });
  new CardStore(db.raw, profileId).syncFromNote(
    noteId,
    deck.id,
    [{ key: "k1", front: "Pitanje", back: "Odgovor", kind: "basic", clozeText: null, clozeOrdinal: null }],
    NOW_ISO,
  );
  new NoteStore(db.raw, profileId).setCardDeck(noteId, deck.id, NOW_ISO);
  return deck.id;
}

describe("notes.folders and notes.folder", () => {
  it("creates a folder, files a note in it, and says so", async () => {
    const id = await createNote("Naslov", "Tekst");
    const created = await run("notes.folder", { action: "create", name: "Škola" });
    expect(created.content).toBe("Done: Create the folder “Škola”.");
    const folder = new NoteOrgStore(db.raw, profileId).listFolders()[0];
    if (folder === undefined) throw new Error("no folder was made");

    const filed = await run("notes.folder", { action: "assign", note: id, folder: "skola" });
    expect(filed.navigateTo).toEqual({ module: "notes", item: id });
    expect(store().list().find((note) => note.id === id)?.folderId).toBe(folder.id);
  });

  it("refuses to move a folder into its own descendant", async () => {
    await run("notes.folder", { action: "create", name: "Roditelj" });
    await run("notes.folder", { action: "create", name: "Dete", parent: "Roditelj" });
    const result = await run("notes.folder", { action: "move", folder: "Roditelj", parent: "Dete" });
    expect(result.ok).toBe(false);
    expect(result.content).toContain("descendant");
  });

  it("names the folders that exist when it does not know the one asked for", async () => {
    await run("notes.folder", { action: "create", name: "Škola" });
    const result = await run("notes.folder", { action: "rename", folder: "Nema", name: "Novo" });
    expect(result.content).toBe("Failed: No folder named “Nema”. Known: Škola.");
  });

  it("sets the default place for new notes, and clears it", async () => {
    await run("notes.folder", { action: "create", name: "Brzo" });
    await run("notes.folder", { action: "set-capture", folder: "Brzo" });
    const folderOf = (): { isCaptureDefault: boolean } | undefined =>
      new NoteOrgStore(db.raw, profileId).listFolders()[0];
    expect(folderOf()?.isCaptureDefault).toBe(true);

    await run("notes.folder", { action: "set-capture" });
    expect(folderOf()?.isCaptureDefault).toBe(false);
  });
});

describe("notes.tags and notes.tag", () => {
  it("adds a tag that does not exist yet by creating it, and removing it leaves the tag", async () => {
    const id = await createNote("Naslov", "Tekst");
    const recorder = contextFor("en", true);
    await toolOf("notes.tag").run({ action: "attach", note: id, tag: "Hitno" }, recorder.context);
    expect(recorder.confirms[0]?.summary).toBe("Add the tag “Hitno” (a new tag) to the note “Naslov”");

    const orgs = new NoteOrgStore(db.raw, profileId);
    expect(orgs.listTagLinks().map((link) => link.noteId)).toEqual([id]);

    await run("notes.tag", { action: "detach", note: id, tag: "hitno" });
    expect(orgs.listTagLinks()).toEqual([]);
    expect(orgs.listTags().map((tag) => tag.name)).toEqual(["Hitno"]);
  });

  it("refuses to create a tag whose name is taken", async () => {
    await run("notes.tag", { action: "create", tag: "Hitno" });
    const result = await run("notes.tag", { action: "create", tag: "hitno" });
    expect(result).toEqual({ ok: false, content: "Failed: The tag “hitno” already exists." });
  });
});

describe("notes.categories and notes.category", () => {
  it("creates a category, puts a note in it, and refuses a second category with the same name", async () => {
    const id = await createNote("Naslov", "Tekst");
    await run("notes.category", { action: "create", name: "Sastanak" });
    const assigned = await run("notes.category", { action: "assign", note: id, category: "Sastanak" });
    expect(assigned.navigateTo).toEqual({ module: "notes", item: id });
    expect(store().list().find((note) => note.id === id)?.categoryId).not.toBeNull();

    const duplicate = await run("notes.category", { action: "create", name: "Sastanak" });
    expect(duplicate.ok).toBe(false);
  });
});

describe("notes.versions", () => {
  it("lists a note's versions, and reads the text one of them had", async () => {
    const id = await createNote("Naslov", "Stari tekst");
    const listed = await run("notes.versions", { id });
    expect(listed.content?.startsWith("Versions (")).toBe(true);

    const seq = store().listVersions(id)[0]?.coveredSeq;
    if (seq === undefined) throw new Error("no version was kept");
    const read = await run("notes.versions", { id, coveredSeq: seq });
    expect(read.content).toBe(`# Naslov (${seq})\nNaslov\nStari tekst`);
  });

  it("refuses a version the note does not have", async () => {
    const id = await createNote("Naslov", "Tekst");
    const result = await run("notes.versions", { id, coveredSeq: 999 });
    expect(result).toEqual({ ok: false, content: "Failed: That note has no version 999." });
  });
});

describe("notes.templates", () => {
  it("lists the templates the profile has, and says when it has none", async () => {
    expect((await run("notes.templates", {})).content).toBe("There are no note templates.");
    new NoteTemplateStore(db.raw, profileId).save("Sastanak", JSON.stringify({ type: "doc", content: [] }), NOW_ISO);
    expect((await run("notes.templates", {})).content).toContain("Sastanak");
  });
});

describe("notes.checklist", () => {
  beforeEach(() => {
    new TaskListStore(db.raw, profileId).ensureInbox(NOW_ISO);
  });

  it("makes one task per checklist item and leaves the note byte-identical", async () => {
    const id = await createNote("Kupovina", "- [ ] mleko\n- [x] hleb");
    const before = bytesOf(id);
    const recorder = contextFor("en", true);
    const result = await toolOf("notes.checklist").run({ id }, recorder.context);

    expect(recorder.confirms[0]?.summary).toBe(
      "Turn the checklist of the note “Kupovina” (2 items) into tasks in the list “Inbox”",
    );
    expect(result).toEqual({
      ok: true,
      content: "Tasks created: 2; empty items skipped: 0.",
      navigateTo: { module: "tasks" },
    });
    expect(new TaskStore(db.raw, profileId).listActive().map((task) => task.title)).toEqual(["mleko", "hleb"]);
    expect(bytesOf(id)).toBe(before);
  });

  it("refuses a note with no checklist, rather than reporting success", async () => {
    const id = await createNote("Bez liste", "Samo tekst");
    const result = await run("notes.checklist", { id });
    expect(result).toEqual({ ok: false, content: "Failed: That note has no checklist items to turn into tasks." });
    expect(new TaskStore(db.raw, profileId).listActive()).toEqual([]);
  });
});

describe("notes.flashcards", () => {
  it("sends a note's flashcards to a deck, and names the deck when the note is read", async () => {
    const subject = new SubjectStore(db.raw, profileId).create({ name: "Matematika" });
    const deck = new DeckStore(db.raw, profileId).create({ subjectId: subject.id, name: "Ispit" });
    const id = await createNote("Naslov", "Tekst");

    const result = await run("notes.flashcards", { id, deck: "ispit" });
    expect(result.content).toBe("Done: Send the flashcards of the note “Naslov” to the deck “Ispit”.");
    expect(store().list().find((note) => note.id === id)?.cardDeckId).toBe(deck.id);

    const read = await run("notes.read", { id });
    expect(read.content).toContain("Flashcards: 0, deck “Ispit”.");
  });
});
