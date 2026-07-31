import type Database from "better-sqlite3-multiple-ciphers";
import { DashboardSetNotFoundError, DashboardSetValidationError } from "../errors.js";
import { uuidv7 } from "../ids.js";
import { placeBetween, TASK_ORDER_GAP } from "../tasks/taskListStore.js";
import { DEFAULT_BACKGROUND_DIM } from "./dashboardSettingsStore.js";

type DatabaseHandle = Database.Database;

/** Longest set name after trimming — the `task_lists` bound, for its reason: a name is a label, not a body. */
export const MAX_DASHBOARD_SET_NAME_LENGTH = 100;

/** Accepts a full ISO-8601 date-time — the same shape every other store's `now` takes. */
const ISO_8601_DATETIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})?$/;

/** One named dashboard („tabla“) as the store returns it. The DEFAULT board is deliberately not among these — it is the absence of a row (ADR-055). */
export interface DashboardSet {
  id: string;
  profileId: string;
  name: string;
  /** Sparse sort key within the profile's boards; may be negative. */
  position: number;
  createdAt: string;
  updatedAt: string;
}

interface SetRow {
  id: string;
  profile_id: string;
  name: string;
  position: number;
  created_at: string;
  updated_at: string;
}

const SET_COLUMNS = "id, profile_id, name, position, created_at, updated_at";

/**
 * One profile's NAMED dashboards (DASH-008 / ADR-055, migration 043), over
 * prepared, parameterized statements (SEC-API-03; every value is bound, never
 * interpolated). Constructed one per profile and reused, like every other store
 * here, and every statement is scoped by `profile_id`.
 *
 * **The default board is not this store's to manage.** `set_id NULL` IS the
 * default dashboard — named „Početna“ in copy only — so `list` answers only the
 * named rows, nothing here can rename or delete the default, and a profile
 * that never made a board costs no row at all.
 *
 * **`delete` takes the board's widget rows with it.** A placement is
 * arrangement, not content (ADR-055): the rows a board holds describe only how
 * ITS cards were laid out, and keeping them would leave orphans no surface can
 * reach. The same transaction clears `active_set_id` when it pointed at the
 * deleted board, so the profile falls back to „Početna“ rather than to a
 * pointer at nothing.
 *
 * **`setActive` is the one write that touches `dashboard_settings`** — the
 * choice is a per-profile singleton beside the background, and it upserts on
 * `DashboardSettingsStore`'s own arrangement, supplying that store's defaults
 * on first insert and touching nothing but `active_set_id` on conflict, so a
 * background the user already chose survives the switch.
 *
 * **Ordering** is the sparse gap-1024 `position` idiom of `taskListStore`,
 * read and written through `placeBetween` — the identical arithmetic
 * `DashboardWidgetStore` uses one table over, for the identical reason.
 */
export class DashboardSetStore {
  private readonly selectSets: Database.Statement;
  private readonly selectSetById: Database.Statement;
  private readonly selectPosition: Database.Statement;
  private readonly selectMaxPosition: Database.Statement;
  private readonly selectScopeIds: Database.Statement;
  private readonly selectActiveSetId: Database.Statement;
  private readonly insertSet: Database.Statement;
  private readonly updateName: Database.Statement;
  private readonly updatePlacement: Database.Statement;
  private readonly updatePosition: Database.Statement;
  private readonly deleteSetRow: Database.Statement;
  private readonly deleteSetWidgets: Database.Statement;
  private readonly clearActiveSet: Database.Statement;
  private readonly upsertActiveSet: Database.Statement;

  constructor(
    private readonly db: DatabaseHandle,
    private readonly profileId: string,
  ) {
    // `id` breaks a position tie, so the order is total even for rows a
    // hand-made archive gave the same sort key — `DashboardWidgetStore`'s rule.
    this.selectSets = db.prepare(
      `SELECT ${SET_COLUMNS} FROM dashboard_sets WHERE profile_id = ? ORDER BY position, id`,
    );
    this.selectSetById = db.prepare(
      `SELECT ${SET_COLUMNS} FROM dashboard_sets WHERE id = ? AND profile_id = ?`,
    );
    this.selectPosition = db.prepare(
      `SELECT position FROM dashboard_sets WHERE id = ? AND profile_id = ?`,
    );
    this.selectMaxPosition = db.prepare(
      `SELECT max(position) AS maxPosition FROM dashboard_sets WHERE profile_id = ?`,
    );
    this.selectScopeIds = db.prepare(
      `SELECT id FROM dashboard_sets WHERE profile_id = ? ORDER BY position, id`,
    );
    this.selectActiveSetId = db.prepare(
      `SELECT active_set_id AS activeSetId FROM dashboard_settings WHERE profile_id = ?`,
    );
    this.insertSet = db.prepare(
      `INSERT INTO dashboard_sets (id, profile_id, name, position, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    this.updateName = db.prepare(
      `UPDATE dashboard_sets SET name = ?, updated_at = ? WHERE id = ? AND profile_id = ?`,
    );
    this.updatePlacement = db.prepare(
      `UPDATE dashboard_sets SET position = ?, updated_at = ? WHERE id = ? AND profile_id = ?`,
    );
    // A renumber re-spaces boards the user did not touch, so it deliberately
    // leaves their `updated_at` alone — `TaskListStore`'s rule, verbatim.
    this.updatePosition = db.prepare(
      `UPDATE dashboard_sets SET position = ? WHERE id = ? AND profile_id = ?`,
    );
    this.deleteSetRow = db.prepare(
      `DELETE FROM dashboard_sets WHERE id = ? AND profile_id = ?`,
    );
    this.deleteSetWidgets = db.prepare(
      `DELETE FROM dashboard_widgets WHERE profile_id = ? AND set_id = ?`,
    );
    this.clearActiveSet = db.prepare(
      `UPDATE dashboard_settings SET active_set_id = NULL, updated_at = ?
       WHERE profile_id = ? AND active_set_id = ?`,
    );
    // First insert supplies `DashboardSettingsStore`'s own defaults for the
    // background columns; on conflict nothing but the choice itself moves, so
    // a background and dim the profile already picked survive untouched.
    this.upsertActiveSet = db.prepare(
      `INSERT INTO dashboard_settings
         (profile_id, background_hash, background_mime, background_size_bytes,
          background_dim, active_set_id, created_at, updated_at)
       VALUES (?, NULL, NULL, NULL, ?, ?, ?, ?)
       ON CONFLICT (profile_id) DO UPDATE SET
         active_set_id = excluded.active_set_id,
         updated_at = excluded.updated_at`,
    );
  }

  /** This profile's named boards, in board order. Never contains — and never needs — the default one. */
  list(): DashboardSet[] {
    return (this.selectSets.all(this.profileId) as SetRow[]).map(toSet);
  }

  /** The board the profile is currently looking at, or null for „Početna“. One choice per profile (ADR-055's recorded limit), not per device. */
  activeSetId(): string | null {
    const row = this.selectActiveSetId.get(this.profileId) as
      | { activeSetId: string | null }
      | undefined;
    return row?.activeSetId ?? null;
  }

  /** Creates a named board at the end of the board order and returns it. Its layout starts EMPTY, which per set means the default arrangement. */
  create(name: string, now: string): DashboardSet {
    const validNow = validateDateTime(now);
    const validName = validateName(name);
    return this.db.transaction((): DashboardSet => {
      const max = (this.selectMaxPosition.get(this.profileId) as { maxPosition: number | null })
        .maxPosition;
      const position = max === null ? TASK_ORDER_GAP : max + TASK_ORDER_GAP;
      const id = uuidv7();
      this.insertSet.run(id, this.profileId, validName, position, validNow, validNow);
      return this.requireSet(id);
    })();
  }

  /** Renames one board. The default board is not renamable by construction: it has no id to pass here. */
  rename(setId: string, name: string, now: string): DashboardSet {
    const validNow = validateDateTime(now);
    const validName = validateName(name);
    this.requireSet(setId);
    this.updateName.run(validName, validNow, setId, this.profileId);
    return this.requireSet(setId);
  }

  /**
   * Deletes one board, its widget rows with it (they are arrangement, not
   * content), and — in the same transaction — clears `active_set_id` when it
   * pointed here, so the profile falls back to „Početna“.
   */
  delete(setId: string, now: string): void {
    const validNow = validateDateTime(now);
    this.db.transaction((): void => {
      this.requireSet(setId);
      this.deleteSetWidgets.run(this.profileId, setId);
      this.clearActiveSet.run(validNow, this.profileId, setId);
      this.deleteSetRow.run(setId, this.profileId);
    })();
  }

  /**
   * Re-orders one board among the profile's boards. `beforeId`/`afterId` are
   * the boards it lands BETWEEN, either null at an end — the pair API
   * `TaskListStore.moveList` established. Returns the resulting board order.
   */
  reorder(
    setId: string,
    beforeId: string | null,
    afterId: string | null,
    now: string,
  ): DashboardSet[] {
    const validNow = validateDateTime(now);
    if (beforeId === setId || afterId === setId) {
      throw new DashboardSetValidationError("A dashboard set cannot be ordered against itself.");
    }
    return this.db.transaction((): DashboardSet[] => {
      this.requireSet(setId);
      const position = placeBetween(
        (siblingId) => this.requirePosition(siblingId),
        () => {
          const ids = this.selectScopeIds.all(this.profileId) as { id: string }[];
          ids.forEach((row, index) => {
            this.updatePosition.run((index + 1) * TASK_ORDER_GAP, row.id, this.profileId);
          });
        },
        beforeId,
        afterId,
      );
      if (position === null) {
        throw new DashboardSetValidationError(
          '"beforeId" and "afterId" do not describe a gap among this profile\'s dashboard sets.',
        );
      }
      this.updatePlacement.run(position, validNow, setId, this.profileId);
      return this.list();
    })();
  }

  /**
   * Writes which board the profile is looking at — null for „Početna“ — and
   * returns it. A non-null id must name this profile's own board; the row it
   * lands on is `dashboard_settings`' per-profile singleton, created here with
   * that store's defaults when the profile never touched a setting.
   */
  setActive(setId: string | null, now: string): string | null {
    const validNow = validateDateTime(now);
    return this.db.transaction((): string | null => {
      if (setId !== null) this.requireSet(setId);
      this.upsertActiveSet.run(
        this.profileId,
        DEFAULT_BACKGROUND_DIM,
        setId,
        validNow,
        validNow,
      );
      return setId;
    })();
  }

  // ---------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------

  /** Reads one board of this profile or throws — the gate every set reference goes through. */
  private requireSet(setId: string): DashboardSet {
    const row = this.selectSetById.get(setId, this.profileId) as SetRow | undefined;
    if (!row) {
      throw new DashboardSetNotFoundError(`No dashboard set "${setId}" in this profile.`);
    }
    return toSet(row);
  }

  private requirePosition(setId: string): number {
    const row = this.selectPosition.get(setId, this.profileId) as
      | { position: number }
      | undefined;
    if (!row) {
      throw new DashboardSetNotFoundError(`No dashboard set "${setId}" in this profile.`);
    }
    return row.position;
  }
}

function toSet(row: SetRow): DashboardSet {
  return {
    id: row.id,
    profileId: row.profile_id,
    name: row.name,
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function validateName(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_DASHBOARD_SET_NAME_LENGTH) {
    throw new DashboardSetValidationError(
      `"name" must be 1..${MAX_DASHBOARD_SET_NAME_LENGTH} characters after trimming.`,
    );
  }
  return trimmed;
}

function validateDateTime(value: string): string {
  if (!ISO_8601_DATETIME.test(value)) {
    throw new DashboardSetValidationError('"now" must be an ISO-8601 date-time.');
  }
  return value;
}
