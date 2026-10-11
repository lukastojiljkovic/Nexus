import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { LibraryStore, NexusDatabase, openDatabase, uuidv7 } from "@nexus/db";
import type { ConfirmRequest, Tool, ToolContext } from "@nexus/core";
import { libraryTools } from "./library.js";

/**
 * The LIBRARY tools over a real database.
 *
 * What this suite pins is the answer, not the wiring: the shelf's line names the
 * work's own facts in the page's own words, the query folds like the palette
 * does, and an add asks first and writes exactly one row through the store the
 * page itself calls.
 */

const NOW_MS = new Date(2026, 9, 10, 9, 0, 0).getTime();
const NOW_ISO = new Date(NOW_MS).toISOString();

let dir: string;
let db: NexusDatabase;
let profileId: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-tool-library-"));
  db = openDatabase({ path: join(dir, "profile.db") });
});

afterAll(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  profileId = uuidv7();
  db.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(profileId, "personal", "Test", NOW_ISO);
});

function store(): LibraryStore {
  return new LibraryStore(db.raw, profileId);
}

function tools(): readonly Tool[] {
  return libraryTools({ profileDb: (id, open) => open(db.raw, id), now: () => NOW_MS });
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

describe("library.shelf", () => {
  it("reads a work with the facts the user wrote down", async () => {
    const book = store().createItem(
      { kind: "book", title: "Na Drini ćuprija", creators: ["Ivo Andrić"], year: 1945 },
      NOW_ISO,
    );
    store().updateItem(book.id, { rating: 9, pagesRead: 120, pagesTotal: 300 }, NOW_ISO);

    const result = await toolOf("library.shelf").run({}, contextFor("sr", true).context);
    expect(result).toEqual({
      ok: true,
      content: [
        "Na polici (1):",
        "- Na Drini ćuprija (Knjiga, Želim, 1945, Ivo Andrić, ocena 9/10, 120/300 str.)",
      ].join("\n"),
    });
  });

  it("filters by status and folds the query, so an unaccented word still finds the title", async () => {
    store().createItem({ kind: "film", title: "Đuveč", status: "done" }, NOW_ISO);
    store().createItem({ kind: "book", title: "Na Drini ćuprija" }, NOW_ISO);

    const byStatus = await toolOf("library.shelf").run(
      { status: "done" },
      contextFor("en", true).context,
    );
    expect(byStatus.content).toBe(
      ["On the shelf (1):", "- Đuveč (Film, Finished)"].join("\n"),
    );

    const byQuery = await toolOf("library.shelf").run(
      { query: "cuprija" },
      contextFor("en", true).context,
    );
    expect(byQuery.content).toBe(
      ["On the shelf (1):", "- Na Drini ćuprija (Book, Wanted)"].join("\n"),
    );
  });

  it("says the shelf is empty, and says which query matched nothing", async () => {
    const empty = await toolOf("library.shelf").run({}, contextFor("sr", true).context);
    expect(empty).toEqual({ ok: true, content: "Biblioteka je prazna." });

    store().createItem({ kind: "book", title: "Zločin i kazna" }, NOW_ISO);
    const none = await toolOf("library.shelf").run(
      { query: "more" },
      contextFor("sr", true).context,
    );
    expect(none).toEqual({
      ok: true,
      content: "Nijedan naslov ne odgovara pretrazi „more“.",
    });
  });
});

describe("library.add", () => {
  it("asks in the user's language, then writes one row", async () => {
    const recorder = contextFor("sr", true);
    const result = await toolOf("library.add").run(
      { title: "Sjajno društvo", kind: "series", creators: ["Autor"], year: 2014 },
      recorder.context,
    );

    expect(recorder.confirms).toEqual([
      {
        tool: "library.add",
        summary: "Dodaj „Sjajno društvo“ u biblioteku (Serija)",
        effect: "write",
      },
    ]);
    const rows = store().listItems();
    expect(rows).toHaveLength(1);
    const created = rows[0];
    if (created === undefined) throw new Error("no row was written");
    expect(created).toMatchObject({
      title: "Sjajno društvo",
      kind: "series",
      status: "planned",
      creators: ["Autor"],
      year: 2014,
    });
    expect(result).toEqual({
      ok: true,
      content: `Dodato u biblioteku: „Sjajno društvo“ (${created.id}).`,
      navigateTo: { module: "library" },
    });
  });

  it("writes nothing when the user declines", async () => {
    const result = await toolOf("library.add").run(
      { title: "Ne želim ovo", kind: "book" },
      contextFor("en", false).context,
    );
    expect(result).toEqual({ ok: false, content: "The user declined." });
    expect(store().listItems()).toEqual([]);
  });

  it("refuses a kind no store has", async () => {
    const result = await toolOf("library.add").run(
      { title: "Neka knjiga", kind: "comic" },
      contextFor("en", true).context,
    );
    expect(result.ok).toBe(false);
    expect(result.content).toBe('Failed: "kind" must be one of: book, film, series.');
    expect(store().listItems()).toEqual([]);
  });
});
