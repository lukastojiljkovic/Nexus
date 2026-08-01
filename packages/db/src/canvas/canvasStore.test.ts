import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MAX_CANVAS_SCENE_LENGTH,
  emptyCanvasScene,
  serializeCanvasScene,
} from "@nexus/core";
import type { CanvasRef } from "@nexus/core";
import {
  CanvasBoardNotFoundError,
  CanvasStore,
  CanvasValidationError,
  EventStore,
  MAX_CANVAS_REF_BATCH,
  NexusDatabase,
  NoteStore,
  PrivateNoteStore,
  TaskListStore,
  TaskStore,
  openDatabase,
  uuidv7,
} from "../index.js";

const NOW = "2026-06-01T08:00:00.000Z";
const LATER = "2026-06-02T09:00:00.000Z";

const EMPTY = serializeCanvasScene(emptyCanvasScene());

/** A scene with something on it — the shape `serializeAsJSON` writes, minus the parts nothing here reads. */
function drawn(id = "el-1"): string {
  return serializeCanvasScene({
    type: "excalidraw",
    version: 2,
    source: "nexus",
    elements: [{ id, type: "rectangle", x: 10, y: 20 }],
    appState: { gridSize: 20 },
    files: {},
  });
}

let dir: string;
let db: NexusDatabase;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-canvas-"));
  db = openDatabase({ path: join(dir, "canvas.db") });
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function createProfile(): string {
  const id = uuidv7();
  db.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(id, "personal", "P", NOW);
  return id;
}

function store(profileId = createProfile()): CanvasStore {
  return new CanvasStore(db.raw, profileId);
}

describe("CanvasStore.create", () => {
  it("stores a board and returns the row, its scene canonical", () => {
    const boards = store();
    const board = boards.create({ name: "Šema baze" }, NOW);
    expect(board).toEqual({
      id: expect.any(String),
      profileId: expect.any(String),
      name: "Šema baze",
      scene: EMPTY,
      createdAt: NOW,
      updatedAt: NOW,
    });
  });

  it("defaults an absent scene to an empty one — a new board is the ordinary case", () => {
    expect(store().create({ name: "Tabla" }, NOW).scene).toBe(EMPTY);
  });

  it("accepts a scene it is given, and re-serialises it canonically", () => {
    const boards = store();
    // The same document with its keys in a different order: what comes back is
    // the canonical text, so the column and every later read agree byte for byte.
    const shuffled = JSON.stringify({
      files: {},
      appState: { gridSize: 20 },
      elements: [{ id: "el-1", type: "rectangle", x: 10, y: 20 }],
      source: "nexus",
      version: 2,
      type: "excalidraw",
    });
    expect(boards.create({ name: "Tabla", scene: shuffled }, NOW).scene).toBe(drawn());
  });

  it("trims the name and refuses an empty or over-long one", () => {
    const boards = store();
    expect(boards.create({ name: "  Tabla  " }, NOW).name).toBe("Tabla");
    expect(() => boards.create({ name: "   " }, NOW)).toThrow(CanvasValidationError);
    expect(() => boards.create({ name: "T".repeat(61) }, NOW)).toThrow(CanvasValidationError);
  });

  it("refuses a scene that is not a scene document", () => {
    const boards = store();
    expect(() => boards.create({ name: "Tabla", scene: "not json" }, NOW)).toThrow(
      CanvasValidationError,
    );
    expect(() =>
      boards.create({ name: "Tabla", scene: JSON.stringify({ hello: "world" }) }, NOW),
    ).toThrow(CanvasValidationError);
  });

  it("refuses a scene past the size ceiling, naming its length", () => {
    const boards = store();
    const oversized = "x".repeat(MAX_CANVAS_SCENE_LENGTH + 1);
    expect(() => boards.create({ name: "Tabla", scene: oversized }, NOW)).toThrow(
      /at most .* characters/,
    );
  });

  it("refuses a `now` that is not an instant", () => {
    expect(() => store().create({ name: "Tabla" }, "2026-06-01")).toThrow(CanvasValidationError);
  });
});

describe("CanvasStore.listActive", () => {
  it("answers this profile's live boards in sr-Latn order, WITHOUT their drawings", () => {
    const boards = store();
    boards.create({ name: "Zidne table", scene: drawn() }, NOW);
    boards.create({ name: "Šema baze" }, NOW);
    boards.create({ name: "Arhitektura" }, NOW);
    const listed = boards.listActive();
    expect(listed.map((board) => board.name)).toEqual(["Arhitektura", "Šema baze", "Zidne table"]);
    // The drawing is not on this shape at all — see the store's own comment.
    expect(listed.every((board) => !("scene" in board))).toBe(true);
  });

  it("never reaches another profile's boards", () => {
    const mine = store();
    const theirs = store();
    mine.create({ name: "Moja" }, NOW);
    theirs.create({ name: "Tuđa" }, NOW);
    expect(mine.listActive().map((board) => board.name)).toEqual(["Moja"]);
    expect(theirs.listActive().map((board) => board.name)).toEqual(["Tuđa"]);
  });

  it("leaves a soft-deleted board out", () => {
    const boards = store();
    const board = boards.create({ name: "Tabla" }, NOW);
    boards.softDelete(board.id, LATER);
    expect(boards.listActive()).toEqual([]);
  });
});

describe("CanvasStore.listActiveWithScenes", () => {
  it("answers the same list WITH every drawing, in the same order", () => {
    const boards = store();
    boards.create({ name: "Zidne table", scene: drawn("b") }, NOW);
    boards.create({ name: "Arhitektura", scene: drawn("a") }, NOW);
    expect(boards.listActiveWithScenes().map((board) => [board.name, board.scene])).toEqual([
      ["Arhitektura", drawn("a")],
      ["Zidne table", drawn("b")],
    ]);
  });
});

describe("CanvasStore.readScene", () => {
  it("answers one live board and its drawing", () => {
    const boards = store();
    const board = boards.create({ name: "Tabla", scene: drawn() }, NOW);
    expect(boards.readScene(board.id)).toEqual({
      id: board.id,
      profileId: board.profileId,
      name: "Tabla",
      scene: drawn(),
      createdAt: NOW,
      updatedAt: NOW,
    });
  });

  it("refuses an unknown id, a deleted board and another profile's board alike", () => {
    const mine = store();
    const theirs = store();
    const gone = mine.create({ name: "Obrisana" }, NOW);
    mine.softDelete(gone.id, LATER);
    const foreign = theirs.create({ name: "Tuđa" }, NOW);

    expect(() => mine.readScene("nema-me")).toThrow(CanvasBoardNotFoundError);
    expect(() => mine.readScene(gone.id)).toThrow(CanvasBoardNotFoundError);
    expect(() => mine.readScene(foreign.id)).toThrow(CanvasBoardNotFoundError);
  });

  /**
   * The one refusal that is about corruption rather than input: this store writes
   * nothing but canonical text, so a document that will not parse is a damaged
   * file — and reading it back as an empty board would silently replace somebody's
   * drawing with a blank page.
   */
  it("throws naming the row when a stored scene will not parse, rather than reading it as empty", () => {
    const boards = store();
    const board = boards.create({ name: "Tabla", scene: drawn() }, NOW);
    db.raw.prepare("UPDATE canvas_boards SET scene = ? WHERE id = ?").run("{oštećeno", board.id);
    expect(() => boards.readScene(board.id)).toThrow(new RegExp(board.id));
    expect(() => boards.listActiveWithScenes()).toThrow(CanvasValidationError);
  });
});

describe("CanvasStore.saveScene", () => {
  it("replaces the drawing and stamps the moment, answering the METADATA", () => {
    const boards = store();
    const board = boards.create({ name: "Tabla" }, NOW);
    const saved = boards.saveScene(board.id, drawn(), LATER);
    expect(saved).toEqual({
      id: board.id,
      profileId: board.profileId,
      name: "Tabla",
      createdAt: NOW,
      updatedAt: LATER,
    });
    expect(boards.readScene(board.id).scene).toBe(drawn());
  });

  it("cannot rename — the autosave writes the drawing and nothing else", () => {
    const boards = store();
    const board = boards.create({ name: "Tabla" }, NOW);
    boards.saveScene(board.id, drawn(), LATER);
    expect(boards.listActive().map((row) => row.name)).toEqual(["Tabla"]);
  });

  it("refuses a bad scene, a deleted board and another profile's board", () => {
    const mine = store();
    const theirs = store();
    const board = mine.create({ name: "Tabla" }, NOW);
    const foreign = theirs.create({ name: "Tuđa" }, NOW);

    expect(() => mine.saveScene(board.id, "not json", LATER)).toThrow(CanvasValidationError);
    expect(() => mine.saveScene(foreign.id, drawn(), LATER)).toThrow(CanvasBoardNotFoundError);
    mine.softDelete(board.id, LATER);
    expect(() => mine.saveScene(board.id, drawn(), LATER)).toThrow(CanvasBoardNotFoundError);
  });

  /** The refusal comes BEFORE the write, so a rejected scene leaves the stored one exactly as it was. */
  it("leaves the stored drawing untouched when it refuses", () => {
    const boards = store();
    const board = boards.create({ name: "Tabla", scene: drawn() }, NOW);
    expect(() => boards.saveScene(board.id, "{}", LATER)).toThrow(CanvasValidationError);
    expect(boards.readScene(board.id).scene).toBe(drawn());
  });
});

describe("CanvasStore.rename", () => {
  it("renames a live board, trimming, and cannot touch the drawing", () => {
    const boards = store();
    const board = boards.create({ name: "Tabla", scene: drawn() }, NOW);
    expect(boards.rename(board.id, "  Šema baze  ", LATER)).toEqual({
      id: board.id,
      profileId: board.profileId,
      name: "Šema baze",
      createdAt: NOW,
      updatedAt: LATER,
    });
    expect(boards.readScene(board.id).scene).toBe(drawn());
  });

  it("refuses an empty name, an unknown id and another profile's board", () => {
    const mine = store();
    const theirs = store();
    const board = mine.create({ name: "Tabla" }, NOW);
    const foreign = theirs.create({ name: "Tuđa" }, NOW);

    expect(() => mine.rename(board.id, "  ", LATER)).toThrow(CanvasValidationError);
    expect(() => mine.rename("nema-me", "Nova", LATER)).toThrow(CanvasBoardNotFoundError);
    expect(() => mine.rename(foreign.id, "Nova", LATER)).toThrow(CanvasBoardNotFoundError);
  });

  it("lets two boards share a name — a board is identified by its id (migration 059)", () => {
    const boards = store();
    boards.create({ name: "Baza" }, NOW);
    const second = boards.create({ name: "Šema" }, NOW);
    expect(() => boards.rename(second.id, "Baza", LATER)).not.toThrow();
    expect(boards.listActive().map((row) => row.name)).toEqual(["Baza", "Baza"]);
  });
});

describe("CanvasStore.softDelete / restore", () => {
  it("brings a board back with the drawing it had when it went", () => {
    const boards = store();
    const board = boards.create({ name: "Tabla", scene: drawn() }, NOW);
    boards.softDelete(board.id, LATER);
    expect(boards.listActive()).toEqual([]);
    boards.restore(board.id, LATER);
    expect(boards.readScene(board.id).scene).toBe(drawn());
  });

  it("refuses a second delete, a restore of a live board, and anything outside this profile", () => {
    const mine = store();
    const theirs = store();
    const board = mine.create({ name: "Tabla" }, NOW);
    const foreign = theirs.create({ name: "Tuđa" }, NOW);

    expect(() => mine.restore(board.id, LATER)).toThrow(CanvasBoardNotFoundError);
    mine.softDelete(board.id, LATER);
    expect(() => mine.softDelete(board.id, LATER)).toThrow(CanvasBoardNotFoundError);
    expect(() => mine.softDelete(foreign.id, LATER)).toThrow(CanvasBoardNotFoundError);
    expect(() => mine.restore(foreign.id, LATER)).toThrow(CanvasBoardNotFoundError);
  });
});

/**
 * The batch read a board's cards are drawn from. Everything here is about two
 * things: that a reference which cannot be answered says so rather than
 * vanishing, and that this read is not a way to see anything it should not.
 */
describe("CanvasStore.resolveRefs", () => {
  /** A profile with the three kinds of row a card can point at, plus the stores that made them. */
  function scope(): {
    profileId: string;
    boards: CanvasStore;
    noteId: string;
    taskId: string;
    eventId: string;
  } {
    const profileId = createProfile();
    new TaskListStore(db.raw, profileId).ensureInbox(NOW);

    const notes = new NoteStore(db.raw, profileId);
    const note = notes.create(NOW);
    notes.appendUpdate(note.id, new Uint8Array([1, 2, 3]), "Beleška o šemi", NOW);

    const task = new TaskStore(db.raw, profileId).create({
      title: "Završiti šemu",
      dueDate: "2026-06-10",
    });
    const event = new EventStore(db.raw, profileId).create({
      title: "Sastanak",
      startAt: "2026-06-11T10:00:00.000Z",
    });

    return {
      profileId,
      boards: new CanvasStore(db.raw, profileId),
      noteId: note.id,
      taskId: task.id,
      eventId: event.id,
    };
  }

  it("answers every reference with the title and the module's own context line", () => {
    const { boards, noteId, taskId, eventId } = scope();
    expect(
      boards.resolveRefs([
        { kind: "note", id: noteId },
        { kind: "task", id: taskId },
        { kind: "event", id: eventId },
      ]),
    ).toEqual([
      { kind: "note", id: noteId, missing: false, title: "Beleška o šemi", detail: null },
      { kind: "task", id: taskId, missing: false, title: "Završiti šemu", detail: "2026-06-10" },
      {
        kind: "event",
        id: eventId,
        missing: false,
        title: "Sastanak",
        detail: "2026-06-11T10:00:00.000Z",
      },
    ]);
  });

  it("answers in the caller's order, whatever order the tables were read in", () => {
    const { boards, noteId, taskId, eventId } = scope();
    const asked: CanvasRef[] = [
      { kind: "event", id: eventId },
      { kind: "note", id: noteId },
      { kind: "task", id: taskId },
    ];
    expect(boards.resolveRefs(asked).map((card) => [card.kind, card.id])).toEqual(
      asked.map((ref) => [ref.kind, ref.id]),
    );
  });

  it("answers a reference asked for twice twice — a board may carry the same card more than once", () => {
    const { boards, noteId } = scope();
    const cards = boards.resolveRefs([
      { kind: "note", id: noteId },
      { kind: "note", id: noteId },
    ]);
    expect(cards).toHaveLength(2);
    expect(cards[0]).toEqual(cards[1]);
  });

  it("answers nothing for nothing, without touching the database", () => {
    expect(scope().boards.resolveRefs([])).toEqual([]);
  });

  it("reports an id no row answers as MISSING rather than dropping it", () => {
    const { boards, noteId } = scope();
    const gone = uuidv7();
    expect(
      boards.resolveRefs([
        { kind: "note", id: gone },
        { kind: "note", id: noteId },
      ]),
    ).toEqual([
      { kind: "note", id: gone, missing: true },
      { kind: "note", id: noteId, missing: false, title: "Beleška o šemi", detail: null },
    ]);
  });

  it("reports a SOFT-DELETED row as missing, for all three kinds", () => {
    const { profileId, boards, noteId, taskId, eventId } = scope();
    new NoteStore(db.raw, profileId).softDelete(noteId, LATER);
    new TaskStore(db.raw, profileId).softDelete(taskId, LATER);
    new EventStore(db.raw, profileId).softDelete(eventId);

    expect(
      boards
        .resolveRefs([
          { kind: "note", id: noteId },
          { kind: "task", id: taskId },
          { kind: "event", id: eventId },
        ])
        .map((card) => card.missing),
    ).toEqual([true, true, true]);
  });

  it("reports another profile's row as missing — a reference is never a way across the boundary", () => {
    const theirs = scope();
    const mine = scope();
    expect(
      mine.boards.resolveRefs([
        { kind: "note", id: theirs.noteId },
        { kind: "task", id: theirs.taskId },
        { kind: "event", id: theirs.eventId },
      ]),
    ).toEqual([
      { kind: "note", id: theirs.noteId, missing: true },
      { kind: "task", id: theirs.taskId, missing: true },
      { kind: "event", id: theirs.eventId, missing: true },
    ]);
  });

  it("never crosses kinds: a task's id asked for as a note does not resolve", () => {
    const { boards, taskId } = scope();
    expect(boards.resolveRefs([{ kind: "note", id: taskId }])).toEqual([
      { kind: "note", id: taskId, missing: true },
    ]);
  });

  it("answers a task with no due date, and an all-day event, without inventing a line", () => {
    const profileId = createProfile();
    new TaskListStore(db.raw, profileId).ensureInbox(NOW);
    const task = new TaskStore(db.raw, profileId).create({ title: "Bez roka" });
    const cards = new CanvasStore(db.raw, profileId).resolveRefs([{ kind: "task", id: task.id }]);
    expect(cards).toEqual([
      { kind: "task", id: task.id, missing: false, title: "Bez roka", detail: null },
    ]);
  });

  it("refuses more references than one call may name, rather than truncating", () => {
    const { boards, noteId } = scope();
    const tooMany: CanvasRef[] = Array.from({ length: MAX_CANVAS_REF_BATCH + 1 }, () => ({
      kind: "note" as const,
      id: noteId,
    }));
    expect(() => boards.resolveRefs(tooMany)).toThrow(CanvasValidationError);
    expect(() => boards.resolveRefs(tooMany.slice(1))).not.toThrow();
  });

  it("refuses a kind outside the closed list", () => {
    const { boards, noteId } = scope();
    expect(() =>
      boards.resolveRefs([{ kind: "profile", id: noteId } as unknown as CanvasRef]),
    ).toThrow(CanvasValidationError);
  });

  /**
   * The most important test in this file. Migration 045 (PRIV / ADR-057) keeps a
   * private note in its OWN table, sealed: `private_notes` has no title column,
   * no FTS row and no projection into the search index, and a private note has
   * no row in `notes` at all. So a `note` reference naming one can only miss —
   * and that must stay true by construction, not by luck, because this resolver
   * would otherwise be a brand-new way to read a private note's title.
   */
  it("never resolves a private note — its title is not in this table, or in any queryable one", () => {
    const { profileId, boards, noteId } = scope();
    const privateId = uuidv7();
    new PrivateNoteStore(db.raw, profileId).writeSealed(
      privateId,
      new Uint8Array([1, 2, 3, 4]),
      NOW,
    );

    expect(
      boards.resolveRefs([
        { kind: "note", id: privateId },
        { kind: "task", id: privateId },
        { kind: "event", id: privateId },
        { kind: "note", id: noteId },
      ]),
    ).toEqual([
      { kind: "note", id: privateId, missing: true },
      { kind: "task", id: privateId, missing: true },
      { kind: "event", id: privateId, missing: true },
      { kind: "note", id: noteId, missing: false, title: "Beleška o šemi", detail: null },
    ]);

    // And the row really is there — the miss above is the gate, not an empty table.
    expect(new PrivateNoteStore(db.raw, profileId).list().map((meta) => meta.id)).toEqual([
      privateId,
    ]);
  });
});
