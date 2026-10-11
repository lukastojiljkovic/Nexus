import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { NexusDatabase, NoteStore, openDatabase, uuidv7 } from "@nexus/db";
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
