import type Database from "better-sqlite3-multiple-ciphers";
import {
  CANVAS_REF_KINDS,
  MAX_CANVAS_SCENE_LENGTH,
  emptyCanvasScene,
  parseCanvasScene,
  serializeCanvasScene,
} from "@nexus/core";
import type { CanvasRef, CanvasRefKind } from "@nexus/core";
import { CanvasBoardNotFoundError, CanvasValidationError } from "../errors.js";
import { uuidv7 } from "../ids.js";
import { isDateTime } from "../finance/money.js";

type DatabaseHandle = Database.Database;

/** Migration 059's own CHECK, restated so an over-long name is a named refusal rather than a raw constraint failure. */
export const MAX_CANVAS_BOARD_NAME_LENGTH = 60;

/**
 * The most references one `resolveRefs` call may name.
 *
 * `MAX_TASK_BULK_IDS`/`MAX_NOTE_LINKS`' number, taken deliberately rather than
 * invented: this is the same shape of input those two bound — a list of ids an
 * untrusted caller puts into one `IN (…)` run — and a board with five hundred
 * Nexus objects pinned to it is far past anything a person draws. It is headroom
 * with a ceiling, not a limit anybody meets.
 *
 * Refused past the cap rather than truncated: a card silently missing from a
 * board reads as „the object is gone", which is the one thing this read exists
 * to say honestly.
 */
export const MAX_CANVAS_REF_BATCH = 500;

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

/**
 * What one card on a board needs in order to draw itself.
 *
 * A UNION on `missing` rather than a record with nullable fields: „the thing
 * this card points at is gone" is a state the card must render, not a blank it
 * can fall through, and a discriminated shape is what makes a caller say so.
 * There is no third arm — a reference either names a live row of this profile or
 * it does not.
 */
export type CanvasRefCard =
  | {
      kind: CanvasRefKind;
      id: string;
      missing: false;
      /** The row's own `title` column, verbatim — a note that was never named carries the empty string it really has. */
      title: string;
      /**
       * The one contextual line that module's own rows already carry, and no
       * summary of our own: migration 017's `context_date` per kind — a task's
       * `due_date`, an event's `start_at`, and nothing for a note, which has no
       * second fact its list rows show. Raw column text; formatting it into
       * Serbian is the renderer's job, as everywhere else.
       */
      detail: string | null;
    }
  | { kind: CanvasRefKind; id: string; missing: true };

/** One resolved row, in the uniform shape the three per-kind statements project into. */
interface CanvasRefRow {
  id: string;
  title: string;
  detail: string | null;
}

const COLUMNS = "id, profile_id, name, created_at, updated_at";
const SCENE_COLUMNS = `${COLUMNS}, scene`;

/**
 * The three reads a card can need, one per kind — each naming its own table's
 * title column and its own `context_date` (migration 017's choice, restated so
 * the card and the search row agree on what a task's or an event's second line
 * is). `?` placeholders are appended by `refStatementFor`; no VALUE is ever
 * built into this text.
 *
 * **`notes` is the only note table there is, and that is the private-notes
 * gate.** Migration 045 (PRIV / ADR-057) keeps a private note in `private_notes`
 * — sealed bytes, no title column, no FTS row, no search projection — and gives
 * it no row in `notes` at all. So this statement CANNOT reach one: there is no
 * flag to honour and no join to omit, because there is nothing in cleartext to
 * read (SEC-ZK-05). A `note` reference naming a private note's id therefore
 * resolves MISSING, exactly as it should, and this resolver never becomes a
 * second way into the private section. `canvasStore.test.ts` pins that.
 */
const REF_SELECTS: Readonly<Record<CanvasRefKind, string>> = {
  note: "SELECT id, title, NULL AS detail FROM notes",
  task: "SELECT id, title, due_date AS detail FROM tasks",
  event: "SELECT id, title, start_at AS detail FROM events",
};

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
 * **`resolveRefs` is the one read that leaves this module's table** (CANV slice
 * b2): a card on a board points at a note, a task or an event, and drawing it
 * needs that row's title. It is still a CanvasStore method rather than three
 * calls the page makes for itself, because „what are the objects on this board"
 * is one question with one answer — one read per KIND, never one per card — and
 * because the private-notes gate it stands on (see `REF_SELECTS`) belongs
 * somewhere a reader will find it.
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
  /**
   * The card reads, prepared lazily and cached by `kind` and PLACEHOLDER COUNT —
   * `SearchStore`'s arrangement, for its reason: the SQL text depends only on how
   * many `?` the `IN (…)` needs, never on which ids are bound into it, so each
   * distinct shape is prepared once and reused for the life of the store.
   */
  private readonly refStatements = new Map<string, Database.Statement>();

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

  /**
   * What a batch of on-board references currently point at — ONE read per kind,
   * never one per card.
   *
   * **Every reference asked about gets an answer, in the order it was asked**,
   * duplicates included: a board draws its cards from this list positionally, so
   * a resolver that compacted its output would silently reassign cards to each
   * other's elements. A reference whose row is gone — deleted, soft-deleted, or
   * another profile's — comes back `missing` rather than dropped, because „ovaj
   * objekat više ne postoji" is a thing a card has to be able to say.
   *
   * **Nothing here is a new read path.** The three statements are the same
   * profile-scoped, `deleted_at IS NULL` reads their own modules use, and the
   * `IN (…)` is a run of generated `?` — the ids themselves are bound
   * (SEC-API-03). Private notes are unreachable by construction; see
   * `REF_SELECTS`' own comment for why that is a property of the schema rather
   * than a check made here.
   */
  resolveRefs(refs: readonly CanvasRef[]): CanvasRefCard[] {
    if (refs.length > MAX_CANVAS_REF_BATCH) {
      throw new CanvasValidationError(
        `"refs" must name at most ${MAX_CANVAS_REF_BATCH} references; this call names ${refs.length}.`,
      );
    }

    // Grouped and deduplicated first: a board may carry the same object on
    // several cards, and asking the database for it once is the whole point of a
    // batch read.
    const idsByKind = new Map<CanvasRefKind, Set<string>>();
    for (const ref of refs) {
      if (!CANVAS_REF_KINDS.includes(ref.kind)) {
        throw new CanvasValidationError(`"refs" carries an unknown kind "${String(ref.kind)}".`);
      }
      const ids = idsByKind.get(ref.kind) ?? new Set<string>();
      ids.add(ref.id);
      idsByKind.set(ref.kind, ids);
    }

    const found = new Map<string, CanvasRefRow>();
    for (const [kind, ids] of idsByKind) {
      const bound = [...ids];
      const rows = this.refStatementFor(kind, bound.length).all(
        this.profileId,
        ...bound,
      ) as CanvasRefRow[];
      for (const row of rows) {
        found.set(`${kind}:${row.id}`, row);
      }
    }

    return refs.map((ref) => {
      const row = found.get(`${ref.kind}:${ref.id}`);
      if (row === undefined) return { kind: ref.kind, id: ref.id, missing: true };
      return { kind: ref.kind, id: ref.id, missing: false, title: row.title, detail: row.detail };
    });
  }

  /**
   * One kind's card read for one `IN (…)` width. The COUNT is interpolated and
   * comes from an array length `resolveRefs` has already bounded; the kind
   * indexes a code-level constant map. Neither is caller text, and every id
   * below is bound (SEC-API-03).
   *
   * The cache cannot grow without limit — its keys are three kinds by widths
   * `1..MAX_CANVAS_REF_BATCH` — and in practice holds one entry per kind: a
   * board's card count is stable between edits, so the same width is asked for
   * over and over.
   */
  private refStatementFor(kind: CanvasRefKind, count: number): Database.Statement {
    const key = `${kind}:${count}`;
    const cached = this.refStatements.get(key);
    if (cached) return cached;
    const statement = this.db.prepare(
      `${REF_SELECTS[kind]}
       WHERE profile_id = ? AND deleted_at IS NULL
         AND id IN (${Array(count).fill("?").join(", ")})`,
    );
    this.refStatements.set(key, statement);
    return statement;
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
