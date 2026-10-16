import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, uuidv7, type NexusDatabase } from "@nexus/db";
import type { AssistantLocale, Tool, ToolContext } from "@nexus/core";
import { fileTools } from "./files.js";

/**
 * The FILES tools: a read of the attachment index and a navigation to a file's
 * owner, against a real migrated database.
 *
 * The index is the page's own union of the three attachment tables, so these
 * cases pin what the page would show: one row per attachment (a file on two
 * owners is two rows), the family totals, a deleted owner's files gone, and a
 * name that cannot pick one file refused rather than guessed.
 */

const NOW_ISO = "2026-10-10T09:00:00.000Z";

let dir: string;
let db: NexusDatabase;
let profileId: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-tool-files-"));
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

function insertNote(title: string, deleted = false): string {
  const id = uuidv7();
  db.raw
    .prepare(
      "INSERT INTO notes (id, profile_id, title, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(id, profileId, title, NOW_ISO, NOW_ISO, deleted ? NOW_ISO : null);
  return id;
}

function insertTask(title: string): string {
  const id = uuidv7();
  db.raw
    .prepare("INSERT INTO tasks (id, profile_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
    .run(id, profileId, title, NOW_ISO, NOW_ISO);
  return id;
}

function attach(
  table: "note_attachments" | "task_attachments",
  column: "note_id" | "task_id",
  ownerId: string,
  fileName: string,
  mime: string,
  createdAt: string,
): string {
  const id = uuidv7();
  db.raw
    .prepare(
      `INSERT INTO ${table} (id, ${column}, file_name, mime, size_bytes, sha256, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, ownerId, fileName, mime, 1_500_000, "a".repeat(64), createdAt);
  return id;
}

function context(locale: AssistantLocale): ToolContext {
  return {
    profileId,
    locale,
    signal: new AbortController().signal,
    confirm: () => Promise.resolve(false),
  };
}

function toolNamed(name: string): Tool {
  const found = fileTools({ profileDb: (id, open) => open(db.raw, id) }).find(
    (entry) => entry.name === name,
  );
  if (found === undefined) throw new Error(`Test setup: no tool "${name}".`);
  return found;
}

/** A small library: a note with a PDF and an image, a task with a text file, and a deleted note's PDF. */
function seedLibrary(): { noteId: string; taskId: string } {
  const noteId = insertNote("Ugovor o zakupu");
  const taskId = insertTask("Plaćanje računa");
  attach("note_attachments", "note_id", noteId, "ugovor.pdf", "application/pdf", "2026-10-01T10:00:00.000Z");
  attach("note_attachments", "note_id", noteId, "skica.png", "image/png", "2026-10-02T10:00:00.000Z");
  attach("task_attachments", "task_id", taskId, "racun.txt", "text/plain", "2026-10-03T10:00:00.000Z");
  attach(
    "note_attachments",
    "note_id",
    insertNote("Stara beleška", true),
    "arhiva.pdf",
    "application/pdf",
    "2026-10-04T10:00:00.000Z",
  );
  return { noteId, taskId };
}

describe("files.list", () => {
  it("lists the live attachments newest first, with the family totals of the answer", async () => {
    seedLibrary();
    const result = await toolNamed("files.list").run({}, context("en"));
    expect(result.ok).toBe(true);
    const lines = result.content.split("\n");
    expect(lines[0]).toBe("Files (3: image 1, PDF 1, text 1, other 0):");
    expect(lines[1]).toContain("racun.txt");
    expect(lines[2]).toContain("skica.png");
    expect(lines[3]).toContain("ugovor.pdf");
    expect(result.content).not.toContain("arhiva.pdf");
  });

  it("narrows by family and by a folded query", async () => {
    seedLibrary();
    const pdfs = await toolNamed("files.list").run({ family: "pdf" }, context("sr"));
    expect(pdfs.content.split("\n")[0]).toBe("Datoteke (1: slika 0, PDF 1, tekst 0, ostalo 0):");
    expect(pdfs.content).toContain("ugovor.pdf");

    const byOwner = await toolNamed("files.list").run({ query: "PLACANJE" }, context("sr"));
    expect(byOwner.content).toContain("racun.txt");
    expect(byOwner.content).not.toContain("ugovor.pdf");
  });

  it("says so when nothing matches", async () => {
    const result = await toolNamed("files.list").run({ owner: "subject" }, context("en"));
    expect(result).toEqual({ ok: true, content: "No file matches this selection." });
  });

  it("refuses an unknown family with the schema's message", async () => {
    await expect(toolNamed("files.list").run({ family: "video" }, context("en"))).resolves.toEqual({
      ok: false,
      content: expect.stringContaining("Failed:"),
    });
  });
});

describe("files.open", () => {
  it("names the owner of a file by its name and navigates to that owner", async () => {
    const { noteId } = seedLibrary();
    const result = await toolNamed("files.open").run({ file: "ugovor.pdf" }, context("en"));
    expect(result).toEqual({
      ok: true,
      content: "The file “ugovor.pdf” is attached to: note “Ugovor o zakupu”.",
      navigateTo: { module: "notes", item: noteId },
    });
  });

  it("navigates to a task owner by the file's id", async () => {
    const { taskId } = seedLibrary();
    const listed = await toolNamed("files.list").run({ query: "racun" }, context("en"));
    const fileId = listed.content.split("\n")[1]?.slice(2).split(" ")[0] ?? "";
    const result = await toolNamed("files.open").run({ file: fileId }, context("en"));
    expect(result.navigateTo).toEqual({ module: "tasks", item: taskId });
  });

  it("refuses a name that is no file, and a name more than one file carries", async () => {
    seedLibrary();
    const missing = await toolNamed("files.open").run({ file: "nepostojeci.pdf" }, context("sr"));
    expect(missing).toEqual({ ok: false, content: "Neuspešno: nema datoteke „nepostojeci.pdf“." });

    const noteId = insertNote("Drugi ugovor");
    attach("note_attachments", "note_id", noteId, "ugovor.pdf", "application/pdf", "2026-10-05T10:00:00.000Z");
    const ambiguous = await toolNamed("files.open").run({ file: "ugovor.pdf" }, context("en"));
    expect(ambiguous.ok).toBe(false);
    expect(ambiguous.content).toContain("more than one file matches “ugovor.pdf”");
  });
});
