import type Database from "better-sqlite3-multiple-ciphers";
import { rankAfter, rankSequence } from "@nexus/core";
import {
  DashboardSetNotFoundError,
  DashboardWidgetNotFoundError,
  DashboardWidgetValidationError,
} from "../errors.js";
import { uuidv7 } from "../ids.js";
import { placeBetween } from "../tasks/taskListStore.js";

type DatabaseHandle = Database.Database;

/** The closed size domain (migration 032's CHECK) — mirrors `WidgetSize` in `@nexus/core`'s widget contract. */
export const DASHBOARD_WIDGET_SIZES = ["S", "M", "L"] as const;
export type DashboardWidgetSize = (typeof DASHBOARD_WIDGET_SIZES)[number];

/**
 * A widget id as a manifest publishes it, qualified by its module:
 * `moduleId:widgetId`, both ASCII kebab slugs. The store checks the SHAPE and
 * nothing more — which widgets exist is `ModuleRegistry`'s catalogue, compiled
 * into the build, and a layout must be able to hold a placement whose module
 * this build does not carry (see the class comment).
 */
const WIDGET_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*:[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Accepts a full ISO-8601 date-time — the same shape every other store's `now` takes. */
const ISO_8601_DATETIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})?$/;

/**
 * The arrangement a board that has never been edited shows (ADR-045 section 2):
 * today's five cards, in today's DOM order, each at the medium preset. Computed
 * in code rather than seeded by a migration, for the reason
 * `DashboardSettingsStore`'s defaults are: a board that never touched its
 * layout costs no row, and the default lives in ONE place instead of being
 * copied into every board at creation — so changing it later reaches every
 * board that never overrode it, which a seed could not do. Since ADR-055 this
 * holds PER SET: an empty named set shows this arrangement exactly as the
 * default (NULL) set always has.
 *
 * The ids are the `moduleId:widgetId` slugs the five owning manifests publish
 * (`apps/desktop/src/renderer/src/modules.ts`); ASCII, because an id is a key,
 * not a label — the Serbian names live in `strings.ts` behind
 * `WidgetContract.title`.
 */
export const DEFAULT_DASHBOARD_LAYOUT: readonly {
  widgetId: string;
  size: DashboardWidgetSize;
}[] = [
  { widgetId: "calendar:danas", size: "M" },
  { widgetId: "tasks:predstojece", size: "M" },
  { widgetId: "calendar:isticanja", size: "M" },
  { widgetId: "study:ispiti", size: "M" },
  { widgetId: "study:ucenje", size: "M" },
];

/**
 * One entry of a resolved layout, in the order it is drawn. Deliberately WITHOUT
 * `rank` and without timestamps: the array's own order IS the rank (ADR-045
 * section 1), and the entries of a default arrangement have no row and
 * therefore no honest moment to report. `listAll` is what carries the full rows,
 * for the exporter.
 */
export interface DashboardWidgetInstance {
  /** This PLACEMENT's identity — the same widget may be placed more than once. */
  instanceId: string;
  /** `moduleId:widgetId`, the id a module's manifest publishes. */
  widgetId: string;
  size: DashboardWidgetSize;
  /**
   * Per-widget JSON text, or null (= the widget's own defaults). Written by
   * `setConfig`; opaque HERE beyond being a JSON object — the contract that
   * gives its keys meaning lives with the module manifests (ADR-059).
   */
  config: string | null;
}

/** One stored row, whole — what the archive carries and what a restore reproduces. */
export interface DashboardWidget extends DashboardWidgetInstance {
  profileId: string;
  /** The named board this placement belongs to (ADR-055), or null for the default one. */
  setId: string | null;
  /**
   * Fractional sort key within the board's layout (`@nexus/core`'s `rankBetween`
   * order). Stored and compared as TEXT under SQLite's default BINARY collation,
   * which is exactly rank order — see the constructor's `ORDER BY` clauses.
   */
  rank: string;
  createdAt: string;
  updatedAt: string;
}

interface WidgetRow {
  profile_id: string;
  instance_id: string;
  widget_id: string;
  size: DashboardWidgetSize;
  set_id: string | null;
  rank: string;
  config: string | null;
  created_at: string;
  updated_at: string;
}

const WIDGET_COLUMNS =
  "profile_id, instance_id, widget_id, size, set_id, rank, config, created_at, updated_at";

/**
 * The instance id a DEFAULT arrangement's entry is handed out under, and the
 * very id materialization then writes it as.
 *
 * Deterministic on purpose, and this is the hinge of the whole get-or-default
 * arrangement: `listLayout` hands the renderer five entries for a board that
 * has no rows, and the renderer then names one of them in `setSize`/`move`/
 * `remove`. If materialization minted fresh ids, that first edit would name a
 * placement nothing had ever written — so the default's ids must be the ones the
 * rows get.
 *
 * Scoped by profile because `instance_id` is the table's PRIMARY KEY, which is
 * global — and, since ADR-055, by SET: every board materializes the same five
 * entries, so two boards of one profile would otherwise collide on the first
 * id. The NULL set keeps the pre-ADR-055 spelling exactly, so a default row a
 * profile materialized before named boards existed is still the row its layout
 * names today. The two spellings can never meet: the set-scoped id carries one
 * more `:`-segment than the default-set one, and a minted id (`uuidv7`) looks
 * like neither.
 */
function defaultInstanceId(profileId: string, setId: string | null, widgetId: string): string {
  return setId === null
    ? `default:${profileId}:${widgetId}`
    : `default:${profileId}:${setId}:${widgetId}`;
}

/**
 * The dashboard's widget layouts for one profile (DASH-002 / ADR-045, migration
 * 032; named boards per DASH-008 / ADR-055, migration 043), over prepared,
 * parameterized statements (SEC-API-03; every value is bound, never
 * interpolated). Constructed one per profile and reused, like every other store
 * here, and every statement is scoped by `profile_id`.
 *
 * **Every read and write is additionally scoped by `set_id`, where NULL is the
 * default board** („Početna“, ADR-055): each method takes the board it operates
 * on, `set_id IS ?` is the bound-null spelling of that scope, and a non-null
 * scope is gated through `requireSetScope` so a board another profile owns — or
 * one that does not exist — is a `DashboardSetNotFoundError`, never a layout of
 * nothing. One board's placements are invisible to a call scoped to another,
 * including as `move` neighbours.
 *
 * **Get-or-default, materialized on first write — PER BOARD.** `listLayout`
 * answers with `DEFAULT_DASHBOARD_LAYOUT` while the board has no rows — the
 * `DashboardSettingsStore` / `ntf_settings` arrangement, one step further along:
 * the first MUTATION writes that whole default out as real rows and then applies
 * the change to them. Materializing the whole thing rather than just the edited
 * entry is the point: a user who resizes one card must not lose the other four,
 * and a table holding a single row would say "this board's layout is one
 * widget", which is not what they did.
 *
 * A consequence worth stating out loud, because it is a product behaviour and
 * not a bug: no rows IS the default, so removing a board's LAST widget puts the
 * default arrangement back rather than leaving an empty board. An empty layout
 * is not a state this table can express, and "remove everything" is therefore
 * also how a user resets — on the default board and on every named one alike
 * (ADR-055's "reset stays free").
 *
 * **Nothing here knows which widgets exist.** A row whose `widgetId` no manifest
 * publishes — a module dropped from the build, or one the user switched off — is
 * stored, listed and reordered exactly like any other. Deciding what actually
 * renders is the renderer's job (ADR-045 slice b): a layout is the user's, and a
 * placement must survive a flag being toggled off and come back when it is
 * toggled on again. What the store DOES check is the id's shape, so a value that
 * could never name a widget at all is refused at the door.
 *
 * **Ordering** is the fractional `rank` idiom of `taskListStore` — the same
 * `@nexus/core` arithmetic (`placeBetween`/`rankAfter`/`rankSequence`), one
 * scope per (profile, board). SQLite's `max()` and `ORDER BY` over this TEXT
 * column use BINARY comparison, which is exactly rank order by construction —
 * that is the whole reason ranks are comparable strings rather than integers.
 * There is no renumber: a rank always has room between two neighbours, so a
 * move writes exactly the row that moved (migration 062). Two copies of
 * "where does this row go" could only ever drift apart, so there is one.
 */
export class DashboardWidgetStore {
  private readonly selectLayout: Database.Statement;
  private readonly selectAll: Database.Statement;
  private readonly countWidgets: Database.Statement;
  private readonly selectMaxRank: Database.Statement;
  private readonly selectRank: Database.Statement;
  private readonly selectSetId: Database.Statement;
  private readonly insertWidget: Database.Statement;
  private readonly updateSize: Database.Statement;
  private readonly updateConfig: Database.Statement;
  private readonly updatePlacement: Database.Statement;
  private readonly deleteWidget: Database.Statement;

  constructor(
    private readonly db: DatabaseHandle,
    private readonly profileId: string,
  ) {
    // `instance_id` breaks a rank tie, so the order is total even for rows a
    // hand-made archive gave the same sort key. `set_id IS ?` rather than
    // `= ?`, because NULL — the default board — is a value this scope must be
    // able to bind.
    this.selectLayout = db.prepare(
      `SELECT ${WIDGET_COLUMNS} FROM dashboard_widgets
       WHERE profile_id = ? AND set_id IS ? ORDER BY rank, instance_id`,
    );
    // The whole profile, boards and all, for the exporter — ordered by board
    // first so one archive lists each board's rows together, in layout order.
    this.selectAll = db.prepare(
      `SELECT ${WIDGET_COLUMNS} FROM dashboard_widgets
       WHERE profile_id = ? ORDER BY set_id, rank, instance_id`,
    );
    this.countWidgets = db.prepare(
      `SELECT count(*) AS n FROM dashboard_widgets WHERE profile_id = ? AND set_id IS ?`,
    );
    // BINARY `max()` over a rank column IS rank order — the same reason the
    // `ORDER BY` clauses above need no collation of their own.
    this.selectMaxRank = db.prepare(
      `SELECT max(rank) AS maxRank FROM dashboard_widgets
       WHERE profile_id = ? AND set_id IS ?`,
    );
    this.selectRank = db.prepare(
      `SELECT rank FROM dashboard_widgets
       WHERE instance_id = ? AND profile_id = ? AND set_id IS ?`,
    );
    this.selectSetId = db.prepare(
      `SELECT id FROM dashboard_sets WHERE id = ? AND profile_id = ?`,
    );
    this.insertWidget = db.prepare(
      `INSERT INTO dashboard_widgets
         (profile_id, instance_id, widget_id, size, set_id, rank, config, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this.updateSize = db.prepare(
      `UPDATE dashboard_widgets SET size = ?, updated_at = ?
       WHERE instance_id = ? AND profile_id = ? AND set_id IS ?`,
    );
    this.updateConfig = db.prepare(
      `UPDATE dashboard_widgets SET config = ?, updated_at = ?
       WHERE instance_id = ? AND profile_id = ? AND set_id IS ?`,
    );
    this.updatePlacement = db.prepare(
      `UPDATE dashboard_widgets SET rank = ?, updated_at = ?
       WHERE instance_id = ? AND profile_id = ? AND set_id IS ?`,
    );
    this.deleteWidget = db.prepare(
      `DELETE FROM dashboard_widgets WHERE instance_id = ? AND profile_id = ? AND set_id IS ?`,
    );
  }

  /** One board's layout in draw order — the default arrangement while it has no rows. Never writes. */
  listLayout(setId: string | null): DashboardWidgetInstance[] {
    const scope = this.requireSetScope(setId);
    const rows = this.selectRows(scope);
    if (rows.length === 0) {
      return DEFAULT_DASHBOARD_LAYOUT.map((entry) => ({
        instanceId: defaultInstanceId(this.profileId, scope, entry.widgetId),
        widgetId: entry.widgetId,
        size: entry.size,
        config: null,
      }));
    }
    return rows.map(toInstance);
  }

  /**
   * The STORED rows of the WHOLE profile — every board's, each row naming its
   * board — EMPTY for every board still on the default arrangement. That
   * emptiness is the honest thing for an archive to carry: a board that never
   * arranged itself has nothing to reproduce, and a restore reading zero rows
   * leaves the target on the default, which is exactly where the source was.
   */
  listAll(): DashboardWidget[] {
    return (this.selectAll.all(this.profileId) as WidgetRow[]).map(toWidget);
  }

  /** Places a widget at the end of one board's layout (ADR-045). Returns that board's resulting layout. */
  add(
    setId: string | null,
    widgetId: string,
    size: DashboardWidgetSize,
    now: string,
  ): DashboardWidgetInstance[] {
    const validNow = validateDateTime(now);
    const validWidgetId = validateWidgetId(widgetId);
    const validSize = validateSize(size);

    return this.db.transaction((): DashboardWidgetInstance[] => {
      const scope = this.requireSetScope(setId);
      this.materializeDefault(scope, validNow);
      const rank = rankAfter(this.maxRank(scope));
      this.insertWidget.run(
        this.profileId,
        uuidv7(),
        validWidgetId,
        validSize,
        scope,
        rank,
        null,
        validNow,
        validNow,
      );
      return this.listLayout(scope);
    })();
  }

  /**
   * Removes one placement from its board. Removing the LAST one leaves the
   * board back on the default arrangement — see the class comment: no rows IS
   * the default, per board.
   */
  remove(setId: string | null, instanceId: string, now: string): DashboardWidgetInstance[] {
    const validNow = validateDateTime(now);
    return this.db.transaction((): DashboardWidgetInstance[] => {
      const scope = this.requireSetScope(setId);
      this.materializeDefault(scope, validNow);
      this.requirePlacement(scope, instanceId);
      this.deleteWidget.run(instanceId, this.profileId, scope);
      return this.listLayout(scope);
    })();
  }

  /** Changes one placement's size preset, leaving its rank alone. */
  setSize(
    setId: string | null,
    instanceId: string,
    size: DashboardWidgetSize,
    now: string,
  ): DashboardWidgetInstance[] {
    const validNow = validateDateTime(now);
    const validSize = validateSize(size);
    return this.db.transaction((): DashboardWidgetInstance[] => {
      const scope = this.requireSetScope(setId);
      this.materializeDefault(scope, validNow);
      this.requirePlacement(scope, instanceId);
      this.updateSize.run(validSize, validNow, instanceId, this.profileId, scope);
      return this.listLayout(scope);
    })();
  }

  /**
   * Writes one placement's config — JSON text a widget's own contract gives
   * meaning to (DASH-004 / ADR-059), or NULL to clear it back to the widget's
   * defaults. The store checks the SHAPE and nothing more (a JSON object, the
   * posture `listAll`'s archive reader has always demanded of this column);
   * which keys a widget accepts is its contract's declaration, revalidated in
   * main against `shared/modules.ts` — the catalogue this store deliberately
   * does not hold.
   */
  setConfig(
    setId: string | null,
    instanceId: string,
    config: string | null,
    now: string,
  ): DashboardWidgetInstance[] {
    const validNow = validateDateTime(now);
    const validConfig = validateConfigText(config);
    return this.db.transaction((): DashboardWidgetInstance[] => {
      const scope = this.requireSetScope(setId);
      this.materializeDefault(scope, validNow);
      this.requirePlacement(scope, instanceId);
      this.updateConfig.run(validConfig, validNow, instanceId, this.profileId, scope);
      return this.listLayout(scope);
    })();
  }

  /**
   * Re-orders a placement within its board's layout. `beforeId`/`afterId` are
   * the placements it lands BETWEEN, either null at an end of the layout — the
   * pair API `TaskListStore.moveList` established, so a drag-and-drop caller
   * states its intent in terms of what it can see rather than an index it would
   * have to keep in step. Neighbours resolve within the SAME board only.
   */
  move(
    setId: string | null,
    instanceId: string,
    beforeId: string | null,
    afterId: string | null,
    now: string,
  ): DashboardWidgetInstance[] {
    const validNow = validateDateTime(now);
    if (beforeId === instanceId || afterId === instanceId) {
      throw new DashboardWidgetValidationError("A widget cannot be ordered against itself.");
    }

    // One transaction, because a materialization and the move it makes room
    // for are one edit: a failed move must never leave a board freshly
    // materialized for a placement that was never actually reordered.
    return this.db.transaction((): DashboardWidgetInstance[] => {
      const scope = this.requireSetScope(setId);
      this.materializeDefault(scope, validNow);
      this.requirePlacement(scope, instanceId);
      const rank = this.placeInLayout(scope, beforeId, afterId);
      this.updatePlacement.run(rank, validNow, instanceId, this.profileId, scope);
      return this.listLayout(scope);
    })();
  }

  // ---------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------

  /**
   * The gate every board scope goes through (ADR-055): NULL — the default
   * board — always passes, because it is not a row and cannot be missing; a
   * non-null id must name THIS profile's own set. Returns the scope so callers
   * read as "resolve once, use everywhere".
   */
  private requireSetScope(setId: string | null): string | null {
    if (setId === null) return null;
    const row = this.selectSetId.get(setId, this.profileId) as { id: string } | undefined;
    if (!row) {
      throw new DashboardSetNotFoundError(`No dashboard set "${setId}" in this profile.`);
    }
    return setId;
  }

  /**
   * Writes `DEFAULT_DASHBOARD_LAYOUT` out as real rows when — and only when —
   * this board has none. Every mutation calls it first, so an edit always
   * lands on a complete layout rather than on the one entry it touched.
   * Ranked with `rankSequence`, not a run of `rankAfter` calls: this IS a
   * fresh scope getting its first layout in one shot — precisely the case
   * `rankSequence` exists for — rather than a scope built up by successive
   * appends, which would only coincidentally land on the same ranks.
   */
  private materializeDefault(setId: string | null, now: string): void {
    if (this.count(setId) > 0) return;
    const ranks = rankSequence(DEFAULT_DASHBOARD_LAYOUT.length);
    DEFAULT_DASHBOARD_LAYOUT.forEach((entry, index) => {
      this.insertWidget.run(
        this.profileId,
        defaultInstanceId(this.profileId, setId, entry.widgetId),
        entry.widgetId,
        entry.size,
        setId,
        ranks[index]!,
        null,
        now,
        now,
      );
    });
  }

  /**
   * The rank a placement takes between two of its own board's neighbours.
   * `placeBetween` always finds room — fractional ranks have no gap to run
   * out of — so `null` back means only that the pair itself is not a gap (the
   * same row twice, or given the wrong way round), which this store reports
   * as its own validation error rather than a bug.
   */
  private placeInLayout(
    setId: string | null,
    beforeId: string | null,
    afterId: string | null,
  ): string {
    const rank = placeBetween(
      (siblingId) => this.requirePlacement(setId, siblingId),
      beforeId,
      afterId,
    );
    if (rank === null) {
      throw new DashboardWidgetValidationError(
        '"beforeId" and "afterId" do not describe a gap in this layout.',
      );
    }
    return rank;
  }

  /** Reads a placement's rank in this profile's board or throws — the gate every instance reference goes through. */
  private requirePlacement(setId: string | null, instanceId: string): string {
    const row = this.selectRank.get(instanceId, this.profileId, setId) as
      | { rank: string }
      | undefined;
    if (!row) {
      throw new DashboardWidgetNotFoundError(
        `No dashboard widget "${instanceId}" in this profile's set.`,
      );
    }
    return row.rank;
  }

  private selectRows(setId: string | null): WidgetRow[] {
    return this.selectLayout.all(this.profileId, setId) as WidgetRow[];
  }

  private count(setId: string | null): number {
    return (this.countWidgets.get(this.profileId, setId) as { n: number }).n;
  }

  private maxRank(setId: string | null): string | null {
    return (this.selectMaxRank.get(this.profileId, setId) as { maxRank: string | null }).maxRank;
  }
}

function toInstance(row: WidgetRow): DashboardWidgetInstance {
  return {
    instanceId: row.instance_id,
    widgetId: row.widget_id,
    size: row.size,
    config: row.config,
  };
}

function toWidget(row: WidgetRow): DashboardWidget {
  return {
    ...toInstance(row),
    profileId: row.profile_id,
    setId: row.set_id,
    rank: row.rank,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function validateWidgetId(value: string): string {
  if (!WIDGET_ID_PATTERN.test(value)) {
    throw new DashboardWidgetValidationError(
      `"${value}" is not a "moduleId:widgetId" widget id.`,
    );
  }
  return value;
}

function validateSize(value: DashboardWidgetSize): DashboardWidgetSize {
  if (!(DASHBOARD_WIDGET_SIZES as readonly string[]).includes(value)) {
    throw new DashboardWidgetValidationError(`Unknown widget size "${String(value)}".`);
  }
  return value;
}

/**
 * A config column value: NULL, or text holding a JSON OBJECT — the same rule
 * the interchange parser applies to this column, one notch tighter (an object,
 * not just any JSON) because every writer since ADR-059 produces one. WHAT the
 * object may say is the widget contract's business, not this store's.
 */
function validateConfigText(value: string | null): string | null {
  if (value === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new DashboardWidgetValidationError('"config" must be JSON text.');
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new DashboardWidgetValidationError('"config" must hold a JSON object.');
  }
  return value;
}

function validateDateTime(value: string): string {
  if (!ISO_8601_DATETIME.test(value)) {
    throw new DashboardWidgetValidationError('"now" must be an ISO-8601 date-time.');
  }
  return value;
}
