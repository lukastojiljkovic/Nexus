import type Database from "better-sqlite3-multiple-ciphers";
import {
  MAX_CANVAS_SCENE_LENGTH,
  emptyCanvasScene,
  parseCanvasScene,
  serializeCanvasScene,
} from "@nexus/core";
import { CanvasBoardNotFoundError, CanvasValidationError } from "../errors.js";
import { uuidv7 } from "../ids.js";
import { isDateTime } from "../finance/money.js";

type DatabaseHandle = Database.Database;

/** Migration 059's own CHECK, restated so an over-long name is a named refusal rather than a raw constraint failure. */
export const MAX_CANVAS_BOARD_NAME_LENGTH = 60;

/**
 * Serbian Latin ordering for the board list, on `HABIT_COLLATOR`'s terms: plain
 * `"sr"` mis-tailors š/č/ć/ž, and SQLite's BINARY collation would put „Šema"
 * after „Zidne table". Sorted here rather than deferred to the renderer for the
 * same reason every other store sorts: a store that hands back an order nobody
 * fixes is a bug waiting for the next slice to inherit.
 */
const CANVAS_COLLATOR = new Intl.Collator(["sr-Latn", "sr"]);

/**
 * One board WITHOUT its drawing — what „koje table imam" answers.
 *
 * The scene is deliberately absent from this type rather than nullable: the list
 * read never selects the column (migration 059's own note), so a `scene` field
 * here would be a value this shape can never carry, and the day somebody made it
 * `string | null` the null would start meaning „empty board" somewhere.
 */
export interface CanvasBoard {
  id: string;
  profileId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

/** One board WITH its drawing — what an export gathers and what opening a board reads. */
export interface CanvasBoardWithScene extends CanvasBoard {
  /** Canonical `serializeCanvasScene` text; re-validated on the way out (see `readScene`). */
  scene: string;
}

interface CanvasBoardRow {
  id: string;
  profile_id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

interface CanvasBoardSceneRow extends CanvasBoardRow {
  scene: string;
}

const COLUMNS = "id, profile_id, name, created_at, updated_at";
const SCENE_COLUMNS = `${COLUMNS}, scene`;

/**
 * A profile's canvas boards, over prepared, parameterized statements
 * (SEC-API-03). Construct one per profile and reuse it.
 *
 * **Every statement is scoped by `profile_id`**, and every mutation additionally
 * by `deleted_at IS NULL` — the arrangement `HabitStore` uses, for the same
 * reason: a write naming another profile's board is a `CanvasBoardNotFoundError`,
 * never a row.
 *
 * **The drawing is read only when somebody asks for it.** `listActive` names the
 * metadata columns and never `scene`, so drawing the board list does not pull
 * every scene off disk; `readScene` and `listActiveWithScenes` are the two reads
 * that do, and the second exists only because an export gathers everything at
 * once (`gatherProfileData`) and an N+1 over boards would be the obvious wrong
 * shape.
 *
 * **The scene is re-validated on the way OUT as well as in.** This store writes
 * nothing but `serializeCanvasScene` output, so a document that fails to parse is
 * corruption — a hand-edited file, a bad restore — rather than input to coerce,
 * and reading it back as an empty board would silently replace somebody's diagram
 * with a blank page. It throws naming the row instead (`FinRecurringStore`'s own
 * posture, and `parseStoredSchedule`'s).
 *
 * `now` is supplied by the caller and validated here — main stamps the clock, the
 * renderer never does.
 */
export class CanvasStore {
  private readonly insert: Database.Statement;
  private readonly selectActive: Database.Statement;
  private readonly selectActiveWithScenes: Database.Statement;
  private readonly selectActiveById: Database.Statement;
  private readonly selectSceneById: Database.Statement;
  private readonly updateName: Database.Statement;
  private readonly updateScene: Database.Statement;
  private readonly markDeleted: Database.Statement;
  private readonly markRestored: Database.Statement;

  constructor(
    private readonly db: DatabaseHandle,
    private readonly profileId: string,
  ) {
    this.insert = db.prepare(
      `INSERT INTO canvas_boards (id, profile_id, name, scene, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL)`,
    );
    this.selectActive = db.prepare(
      `SELECT ${COLUMNS} FROM canvas_boards WHERE profile_id = ? AND deleted_at IS NULL`,
    );
    this.selectActiveWithScenes = db.prepare(
      `SELECT ${SCENE_COLUMNS} FROM canvas_boards WHERE profile_id = ? AND deleted_at IS NULL`,
    );
    this.selectActiveById = db.prepare(
      `SELECT ${COLUMNS} FROM canvas_boards
       WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.selectSceneById = db.prepare(
      `SELECT ${SCENE_COLUMNS} FROM canvas_boards
       WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    // Renaming and drawing are two statements rather than one `update`, and that
    // is the `fin-*:*`/`habits:*` rule applied to a column that is written every
    // few seconds: the autosave must not be able to rename a board, and a rename
    // must not be able to carry a scene. One `UPDATE … SET name = ?, scene = ?`
    // would make both possible from either caller.
    this.updateName = db.prepare(
      `UPDATE canvas_boards SET name = ?, updated_at = ?
       WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.updateScene = db.prepare(
      `UPDATE canvas_boards SET scene = ?, updated_at = ?
       WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.markDeleted = db.prepare(
      `UPDATE canvas_boards SET deleted_at = ?, updated_at = ?
       WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.markRestored = db.prepare(
      `UPDATE canvas_boards SET deleted_at = NULL, updated_at = ?
       WHERE id = ? AND profile_id = ? AND deleted_at IS NOT NULL`,
    );
  }

  /** This profile's live boards, sr-Latn alphabetical, WITHOUT their drawings. */
  listActive(): CanvasBoard[] {
    const rows = this.selectActive.all(this.profileId) as CanvasBoardRow[];
    return rows.map(toBoard).sort(byName);
  }

  /**
   * The same list WITH every drawing — what an export gathers in one read.
   * Deliberately not offered to the renderer: a page that wanted all the scenes
   * at once would be a page that draws several canvases, and it does not.
   */
  listActiveWithScenes(): CanvasBoardWithScene[] {
    const rows = this.selectActiveWithScenes.all(this.profileId) as CanvasBoardSceneRow[];
    return rows.map((row) => ({ ...toBoard(row), scene: readStoredScene(row.scene, row.id) })).sort(byName);
  }

  /**
   * Creates a board. An absent `scene` is an EMPTY one rather than an error: a
   * new board is the ordinary case and „napravi mi praznu tablu" must not require
   * the caller to construct a document it has no opinion about.
   */
  create(input: { name: string; scene?: string }, now: string): CanvasBoardWithScene {
    const validNow = validateNow(now);
    const name = validateName(input.name);
    const scene =
      input.scene === undefined
        ? serializeCanvasScene(emptyCanvasScene())
        : validateScene(input.scene);
    const id = uuidv7();

    this.insert.run(id, this.profileId, name, scene, validNow, validNow);
    return { id, profileId: this.profileId, name, scene, createdAt: validNow, updatedAt: validNow };
  }

  /** Renames a live board. Cannot touch the drawing — see the two statements' own comment. */
  rename(id: string, name: string, now: string): CanvasBoard {
    const validNow = validateNow(now);
    const validName = validateName(name);
    const current = this.requireBoard(id);
    this.updateName.run(validName, validNow, id, this.profileId);
    return { ...current, name: validName, updatedAt: validNow };
  }

  /**
   * Replaces a live board's drawing. Cannot touch the name.
   *
   * Returns the board's METADATA rather than the scene it was just handed: the
   * caller already has the document, and echoing several megabytes of it back
   * across an IPC boundary every few seconds is a cost with no reader.
   */
  saveScene(id: string, scene: string, now: string): CanvasBoard {
    const validNow = validateNow(now);
    const validScene = validateScene(scene);
    const current = this.requireBoard(id);
    this.updateScene.run(validScene, validNow, id, this.profileId);
    return { ...current, updatedAt: validNow };
  }

  /** One live board and its drawing, or a `CanvasBoardNotFoundError`. */
  readScene(id: string): CanvasBoardWithScene {
    const row = this.selectSceneById.get(id, this.profileId) as CanvasBoardSceneRow | undefined;
    if (!row) {
      throw new CanvasBoardNotFoundError(`No live canvas board "${id}" in this profile.`);
    }
    return { ...toBoard(row), scene: readStoredScene(row.scene, row.id) };
  }

  /** Soft-deletes a live board (reversible via `restore`). The drawing stays exactly where it is. */
  softDelete(id: string, now: string): void {
    const validNow = validateNow(now);
    const { changes } = this.markDeleted.run(validNow, validNow, id, this.profileId);
    if (changes === 0) {
      throw new CanvasBoardNotFoundError(`No live canvas board "${id}" to delete in this profile.`);
    }
  }

  /** Restores a soft-deleted board, with the drawing it had when it went. */
  restore(id: string, now: string): void {
    const validNow = validateNow(now);
    const { changes } = this.markRestored.run(validNow, id, this.profileId);
    if (changes === 0) {
      throw new CanvasBoardNotFoundError(
        `No deleted canvas board "${id}" to restore in this profile.`,
      );
    }
  }

  /** Reads a live board in this profile or throws — the scope check every mutation runs first. */
  private requireBoard(id: string): CanvasBoard {
    const row = this.selectActiveById.get(id, this.profileId) as CanvasBoardRow | undefined;
    if (!row) {
      throw new CanvasBoardNotFoundError(`No live canvas board "${id}" in this profile.`);
    }
    return toBoard(row);
  }
}

function toBoard(row: CanvasBoardRow): CanvasBoard {
  return {
    id: row.id,
    profileId: row.profile_id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function byName(a: CanvasBoard, b: CanvasBoard): number {
  return CANVAS_COLLATOR.compare(a.name, b.name) || a.id.localeCompare(b.id);
}

function validateName(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_CANVAS_BOARD_NAME_LENGTH) {
    throw new CanvasValidationError(
      `"name" must be 1-${MAX_CANVAS_BOARD_NAME_LENGTH} characters after trimming.`,
    );
  }
  return trimmed;
}

/**
 * Structural validation of a scene from an untrusted caller, through CANV's own
 * validator, returning the CANONICAL text — so the column and any later read
 * agree byte for byte on what the drawing is.
 *
 * The size ceiling is refused HERE rather than by a CHECK, deliberately
 * (migration 059's note): it exists so an embedded image can be refused with a
 * sentence the page can show, and a raw constraint failure inside a transaction
 * is exactly the illegible refusal the ceiling was added to avoid.
 */
function validateScene(value: string): string {
  if (value.length > MAX_CANVAS_SCENE_LENGTH) {
    throw new CanvasValidationError(
      `"scene" must be at most ${MAX_CANVAS_SCENE_LENGTH} characters; this one is ${value.length}.`,
    );
  }
  const scene = parseCanvasScene(value);
  if (scene === null) {
    throw new CanvasValidationError(`"scene" is not a valid canvas scene document.`);
  }
  return serializeCanvasScene(scene);
}

/** Reads the stored column back — see the class comment for why a bad document throws rather than reading as empty. */
function readStoredScene(text: string, id: string): string {
  const scene = parseCanvasScene(text);
  if (scene === null) {
    throw new CanvasValidationError(`Canvas board "${id}" carries a stored scene that is not valid.`);
  }
  return serializeCanvasScene(scene);
}

function validateNow(value: string): string {
  if (!isDateTime(value)) {
    throw new CanvasValidationError(`"now" must be an ISO-8601 date-time.`);
  }
  return value;
}
