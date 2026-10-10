import type Database from "better-sqlite3-multiple-ciphers";
import {
  MAX_ID_LENGTH,
  MAX_PANTRY_NAME_LENGTH,
  MAX_PANTRY_QUANTITY,
  isPantryUnit,
  isRank,
  rankAfter,
  validatePantryChange,
  validatePantryItem,
  validatePantryLocation,
} from "@nexus/core";
import type {
  PantryCategory,
  PantryItemFields,
  PantryLogReason,
  PantryProblem,
  PantryUnit,
} from "@nexus/core";
import { PantryNotFoundError, PantryValidationError } from "../errors.js";
import { isDateTime } from "../finance/money.js";
import { uuidv7 } from "../ids.js";
import { placeBetween } from "../tasks/taskListStore.js";

type DatabaseHandle = Database.Database;

/**
 * The version of `PantryStore.exportData`'s value, refused by `importData` when
 * anything else is presented. A plain integer inside the value rather than a
 * property of the package: this document travels into a profile archive, and the
 * only question the reader asks of it is whether it knows the shape.
 */
export const PANTRY_EXPORT_VERSION = 1;

/**
 * How many rows one collection of an imported value may carry. A household
 * pantry is hundreds of items rather than ten thousand, and this bound is what
 * stops a hand-made archive from making this store write a million rows in one
 * transaction; the archive reader's own file-size limits are the other half.
 */
export const MAX_PANTRY_EXPORT_ROWS = 10_000;

/** One location: a named place the user keeps things, in the order they put them in. */
export interface PantryLocation {
  id: string;
  profileId: string;
  name: string;
  /** A fractional rank (migration 062). Compared as a string; never a position. */
  rank: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * One item of stock — the `@nexus/core` field set plus the row's own identity.
 *
 * `archivedAt` and the soft delete are INDEPENDENT, migration 055's arrangement
 * one module over: an item the user has finished with is not one they deleted.
 * An archived item stays in `listItems`, carrying the moment it was archived,
 * and is skipped by the shopping list; the soft delete is what takes it away.
 */
export interface PantryItem extends PantryItemFields {
  id: string;
  profileId: string;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * One quantity move. No `profileId` and no `updatedAt`: a log row is scoped
 * through its item and is never rewritten, so `changedAt` is both when it was
 * written and the day the change counts for (`pantryStock.ts`'s waste report).
 */
export interface PantryLogEntry {
  id: string;
  itemId: string;
  changedAt: string;
  delta: number;
  reason: PantryLogReason;
}

export interface CreatePantryLocationInput {
  name: string;
}

export interface CreatePantryItemInput {
  name: string;
  category: PantryCategory;
  quantity: number;
  unit: PantryUnit;
  locationId?: string | null;
  minQuantity?: number | null;
  expiryDate?: string | null;
  openedDate?: string | null;
  useWithinDays?: number | null;
  notes?: string | null;
  barcode?: string | null;
  doseNote?: string | null;
}

/**
 * A partial patch of an item's own fields. An omitted key is left untouched; an
 * explicit `null` clears a nullable one.
 *
 * **`quantity` is deliberately absent.** A quantity moves through
 * `changeQuantity` and nowhere else, because that is the one path that writes
 * the log in the same transaction; a patch carrying one is REFUSED rather than
 * ignored, since a silently dropped number is a caller who believes it landed.
 */
export interface UpdatePantryItemFields {
  name?: string;
  category?: PantryCategory;
  locationId?: string | null;
  unit?: PantryUnit;
  minQuantity?: number | null;
  expiryDate?: string | null;
  openedDate?: string | null;
  useWithinDays?: number | null;
  notes?: string | null;
  barcode?: string | null;
  doseNote?: string | null;
}

/** One location as `exportData` carries it: everything but the profile it was copied from. */
export interface PantryExportLocation {
  id: string;
  name: string;
  rank: string;
  createdAt: string;
  updatedAt: string;
}

/** One item as `exportData` carries it. Archived items travel; soft-deleted ones do not. */
export interface PantryExportItem extends PantryItemFields {
  id: string;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** One quantity change as `exportData` carries it. */
export interface PantryExportLogEntry {
  id: string;
  itemId: string;
  changedAt: string;
  delta: number;
  reason: PantryLogReason;
}

/**
 * The pantry as ONE plain JSON value: `{ version: 1, locations, items, log }`.
 * Stage 2 hands this to the profile archive and back through `importData`.
 */
export interface PantryExport {
  version: number;
  locations: PantryExportLocation[];
  items: PantryExportItem[];
  log: PantryExportLogEntry[];
}

/**
 * The window "expires soon" ships with, and the answer a profile with no
 * settings row gives. A week is the period a household actually plans a meal
 * around, and it is the one number here written down once.
 */
export const DEFAULT_PANTRY_EXPIRY_WINDOW_DAYS = 7;

/** The longest window the settings row accepts: `MAX_PANTRY_USE_WITHIN_DAYS`' own bound, mirrored by migration 075's CHECK. */
export const MAX_PANTRY_EXPIRY_WINDOW_DAYS = 3_650;

/**
 * One line of the shopping list the USER wrote.
 *
 * The other half of that list is derived on every read (`@nexus/core`'s
 * `shoppingList`): "below its minimum" is a fact about today's shelf, and a
 * stored copy of it would be wrong the moment somebody buys the thing. What
 * cannot be derived is what the user typed in himself, so this is that, and
 * nothing else.
 */
export interface PantryShoppingLine {
  id: string;
  profileId: string;
  name: string;
  quantity: number;
  unit: PantryUnit;
  /**
   * The stock row ticking this line off restocks, or `null` for a line that is
   * only a reminder. The item is a LIVE row of this profile when the line is
   * written; the link survives the item's soft delete, because a line whose item
   * is gone is still something to buy.
   */
  itemId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AddPantryShoppingLineInput {
  name: string;
  quantity: number;
  unit: PantryUnit;
  itemId?: string | null;
}

/** The module's one stored preference. */
export interface PantrySettings {
  /** How many days ahead "expires soon" reaches. */
  expiryWindowDays: number;
}

interface LocationRow {
  id: string;
  profile_id: string;
  name: string;
  rank: string;
  created_at: string;
  updated_at: string;
}

interface ItemRow {
  id: string;
  profile_id: string;
  location_id: string | null;
  name: string;
  category: string;
  quantity: number;
  unit: string;
  min_quantity: number | null;
  expiry_date: string | null;
  opened_date: string | null;
  use_within_days: number | null;
  notes: string | null;
  barcode: string | null;
  dose_note: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

interface LogRow {
  id: string;
  item_id: string;
  changed_at: string;
  delta: number;
  reason: string;
}

interface ShoppingRow {
  id: string;
  profile_id: string;
  name: string;
  quantity: number;
  unit: string;
  item_id: string | null;
  created_at: string;
  updated_at: string;
}

const LOCATION_COLUMNS = "id, profile_id, name, rank, created_at, updated_at";

const ITEM_COLUMNS =
  "id, profile_id, location_id, name, category, quantity, unit, min_quantity, " +
  "expiry_date, opened_date, use_within_days, notes, barcode, dose_note, archived_at, " +
  "created_at, updated_at";

/** Qualified, because the log read joins the items table and both carry an `id`. */
const LOG_COLUMNS = "l.id, l.item_id, l.changed_at, l.delta, l.reason";

/**
 * Serbian Latin ordering for the pantry list, on `HabitStore`'s terms: plain
 * `"sr"` mis-tailors š/č/ć/đ, and SQLite's BINARY collation would put „Šećer“
 * after „So“. Sorted here rather than deferred to the renderer, because a store
 * that hands back an order nobody fixes is a bug waiting for the next slice to
 * inherit.
 */
const ITEM_COLLATOR = new Intl.Collator(["sr-Latn", "sr"]);

/**
 * The pantry of a single profile, over prepared, parameterized statements
 * (SEC-API-03; every value is bound, never interpolated). Construct one per
 * profile and reuse it.
 *
 * **The store is the second gate, not the first.** `@nexus/core`'s
 * `validatePantryItem`, `validatePantryLocation` and `validatePantryChange` hold
 * every rule about what a FIELD may be, and this file adds only what a validator
 * cannot see: that a `locationId` names a live location of THIS profile, that a
 * reorder's neighbours are live siblings, that a change does not drive the
 * quantity below zero, and that an import's references resolve. Renderer input
 * is untrusted (SEC-EL-02), so those rules are refused here rather than assumed
 * to have been checked on the way in.
 *
 * **A quantity and its log row are one transaction.** `changeQuantity` is the
 * only way a quantity moves, and it writes the item and the entry together —
 * `DocumentStore.renew`'s arrangement, and for its reason: half of this pair is
 * a history that lies about the shelf.
 *
 * **Reads hand back orders, not rows for somebody else to sort.** `listLocations`
 * answers in the user's own rank order; `listItems` collates by name;
 * `listLog` is oldest first. The log is ONE read for the whole profile, because
 * both the item's history and the waste report want it and a period is the
 * caller's question rather than the store's — `HabitStore.listAllEntries`'
 * lesson, restated.
 *
 * **`importData` REPLACES rather than merges.** It validates the whole value
 * before it writes anything, then empties this profile's pantry and writes what
 * the value carries, in one transaction. That makes the round trip idempotent,
 * which is what a profile restore needs, and it is what lets the refusal half be
 * a real promise: a value this store will not accept leaves the pantry exactly
 * as it was.
 *
 * `now` is supplied by the caller and validated here — main stamps the clock,
 * the renderer never does.
 */
export class PantryStore {
  private readonly selectLocations: Database.Statement;
  private readonly selectLocationById: Database.Statement;
  private readonly maxLocationRank: Database.Statement;
  private readonly insertLocation: Database.Statement;
  private readonly updateLocation: Database.Statement;
  private readonly updateLocationRank: Database.Statement;
  private readonly markLocationDeleted: Database.Statement;
  private readonly markLocationRestored: Database.Statement;
  private readonly countItemsInLocation: Database.Statement;
  private readonly selectItems: Database.Statement;
  private readonly selectItemById: Database.Statement;
  private readonly insertItem: Database.Statement;
  private readonly updateItemFields: Database.Statement;
  private readonly updateItemQuantity: Database.Statement;
  private readonly markItemDeleted: Database.Statement;
  private readonly markItemRestored: Database.Statement;
  private readonly markItemArchived: Database.Statement;
  private readonly markItemUnarchived: Database.Statement;
  private readonly insertLog: Database.Statement;
  private readonly selectLog: Database.Statement;
  private readonly deleteLogForProfile: Database.Statement;
  private readonly deleteItemsForProfile: Database.Statement;
  private readonly deleteLocationsForProfile: Database.Statement;
  private readonly findLocationOwner: Database.Statement;
  private readonly findItemOwner: Database.Statement;
  private readonly findLogOwner: Database.Statement;
  private readonly selectShoppingLines: Database.Statement;
  private readonly selectShoppingLineById: Database.Statement;
  private readonly insertShoppingLine: Database.Statement;
  private readonly deleteShoppingLine: Database.Statement;
  private readonly deleteShoppingLinesForProfile: Database.Statement;
  private readonly isLiveItem: Database.Statement;
  private readonly selectSettings: Database.Statement;
  private readonly upsertSettings: Database.Statement;
  private readonly deleteSettings: Database.Statement;

  constructor(
    private readonly db: DatabaseHandle,
    private readonly profileId: string,
  ) {
    this.selectLocations = db.prepare(
      `SELECT ${LOCATION_COLUMNS} FROM pantry_locations
        WHERE profile_id = ? AND deleted_at IS NULL
        ORDER BY rank, id`,
    );
    // The one gate every location mutation passes: live in THIS profile.
    this.selectLocationById = db.prepare(
      `SELECT ${LOCATION_COLUMNS} FROM pantry_locations
        WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.maxLocationRank = db.prepare(
      `SELECT max(rank) AS maxRank FROM pantry_locations
        WHERE profile_id = ? AND deleted_at IS NULL`,
    );
    this.insertLocation = db.prepare(
      `INSERT INTO pantry_locations (id, profile_id, name, rank, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL)`,
    );
    this.updateLocation = db.prepare(
      `UPDATE pantry_locations SET name = ?, updated_at = ?
        WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.updateLocationRank = db.prepare(
      `UPDATE pantry_locations SET rank = ?, updated_at = ?
        WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.markLocationDeleted = db.prepare(
      `UPDATE pantry_locations SET deleted_at = ?, updated_at = ?
        WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.markLocationRestored = db.prepare(
      `UPDATE pantry_locations SET deleted_at = NULL, updated_at = ?
        WHERE id = ? AND profile_id = ? AND deleted_at IS NOT NULL`,
    );
    this.countItemsInLocation = db.prepare(
      `SELECT count(*) AS items FROM pantry_items
        WHERE location_id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );

    this.selectItems = db.prepare(
      `SELECT ${ITEM_COLUMNS} FROM pantry_items
        WHERE profile_id = ? AND deleted_at IS NULL`,
    );
    // Deliberately not filtered on `archived_at`: archiving is a fact about
    // today's shopping list, never about whether the row is here (migration 055).
    this.selectItemById = db.prepare(
      `SELECT ${ITEM_COLUMNS} FROM pantry_items
        WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.insertItem = db.prepare(
      `INSERT INTO pantry_items
         (id, profile_id, location_id, name, category, quantity, unit, min_quantity,
          expiry_date, opened_date, use_within_days, notes, barcode, dose_note,
          archived_at, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    );
    this.updateItemFields = db.prepare(
      `UPDATE pantry_items
          SET location_id = ?, name = ?, category = ?, unit = ?, min_quantity = ?,
              expiry_date = ?, opened_date = ?, use_within_days = ?, notes = ?,
              barcode = ?, dose_note = ?, updated_at = ?
        WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    // The quantity half of `changeQuantity`, and the ONLY statement in this file
    // that writes that column.
    this.updateItemQuantity = db.prepare(
      `UPDATE pantry_items SET quantity = ?, updated_at = ?
        WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.markItemDeleted = db.prepare(
      `UPDATE pantry_items SET deleted_at = ?, updated_at = ?
        WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.markItemRestored = db.prepare(
      `UPDATE pantry_items SET deleted_at = NULL, updated_at = ?
        WHERE id = ? AND profile_id = ? AND deleted_at IS NOT NULL`,
    );
    this.markItemArchived = db.prepare(
      `UPDATE pantry_items SET archived_at = ?, updated_at = ?
        WHERE id = ? AND profile_id = ? AND deleted_at IS NULL AND archived_at IS NULL`,
    );
    this.markItemUnarchived = db.prepare(
      `UPDATE pantry_items SET archived_at = NULL, updated_at = ?
        WHERE id = ? AND profile_id = ? AND deleted_at IS NULL AND archived_at IS NOT NULL`,
    );

    this.insertLog = db.prepare(
      `INSERT INTO pantry_log (id, item_id, changed_at, delta, reason) VALUES (?, ?, ?, ?, ?)`,
    );
    // ONE query for every change of the profile's live items — an item's own
    // history is a filter over it, and the waste report's period is the caller's
    // question rather than a second read. The join is also the profile scope:
    // `pantry_log` has no `profile_id` of its own, and a soft-deleted item's rows
    // are as invisible here as the item is in `listItems`.
    this.selectLog = db.prepare(
      `SELECT ${LOG_COLUMNS} FROM pantry_log l
         JOIN pantry_items i ON i.id = l.item_id
        WHERE i.profile_id = ? AND i.deleted_at IS NULL
        ORDER BY l.changed_at, l.id`,
    );
    this.deleteLogForProfile = db.prepare(
      `DELETE FROM pantry_log WHERE item_id IN (SELECT id FROM pantry_items WHERE profile_id = ?)`,
    );
    this.deleteItemsForProfile = db.prepare(`DELETE FROM pantry_items WHERE profile_id = ?`);
    this.deleteLocationsForProfile = db.prepare(
      `DELETE FROM pantry_locations WHERE profile_id = ?`,
    );
    // The shopping list: this profile's own lines, and the one question the
    // restock asks about them -- "is the item this line names still live".
    this.selectShoppingLines = db.prepare(
      `SELECT id, profile_id, name, quantity, unit, item_id, created_at, updated_at
         FROM pantry_shopping
        WHERE profile_id = ?`,
    );
    this.selectShoppingLineById = db.prepare(
      `SELECT id, profile_id, name, quantity, unit, item_id, created_at, updated_at
         FROM pantry_shopping
        WHERE id = ? AND profile_id = ?`,
    );
    this.insertShoppingLine = db.prepare(
      `INSERT INTO pantry_shopping
         (id, profile_id, name, quantity, unit, item_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this.deleteShoppingLine = db.prepare(
      `DELETE FROM pantry_shopping WHERE id = ? AND profile_id = ?`,
    );
    this.deleteShoppingLinesForProfile = db.prepare(
      `DELETE FROM pantry_shopping WHERE profile_id = ?`,
    );
    // Deliberately NOT filtered on `archived_at`: an archived item is still a
    // row a line may restock -- "ne pitaj me više za ovo" is about the shopping
    // list, never about the shelf (migration 055's rule, one module over).
    this.isLiveItem = db.prepare(
      `SELECT 1 AS live FROM pantry_items
        WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.selectSettings = db.prepare(
      `SELECT expiry_window_days, updated_at FROM pantry_settings WHERE profile_id = ?`,
    );
    this.upsertSettings = db.prepare(
      `INSERT INTO pantry_settings (profile_id, expiry_window_days, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT (profile_id) DO UPDATE SET expiry_window_days = excluded.expiry_window_days,
                                              updated_at = excluded.updated_at`,
    );
    this.deleteSettings = db.prepare(`DELETE FROM pantry_settings WHERE profile_id = ?`);
    // „Does this id already exist, and under whom“ — the three reads behind
    // `refuseForeign`, and the whole of the cross-profile guard's work. The log
    // carries no `profile_id` of its own, so its owner comes through its item.
    this.findLocationOwner = db.prepare(`SELECT profile_id FROM pantry_locations WHERE id = ?`);
    this.findItemOwner = db.prepare(`SELECT profile_id FROM pantry_items WHERE id = ?`);
    this.findLogOwner = db.prepare(
      `SELECT i.profile_id FROM pantry_log l
         JOIN pantry_items i ON i.id = l.item_id
        WHERE l.id = ?`,
    );
  }

  /** This profile's live locations, in the user's own order. */
  listLocations(): PantryLocation[] {
    const rows = this.selectLocations.all(this.profileId) as LocationRow[];
    return rows.map((row) => toLocation(row));
  }

  /** Adds a shelf at the END of the user's order and returns the stored row. */
  createLocation(input: CreatePantryLocationInput, now: string): PantryLocation {
    const validNow = validateNow(now);
    const name = resolveLocationName(input);
    const id = uuidv7();
    const rank = rankAfter(this.maxRank());

    this.insertLocation.run(id, this.profileId, name, rank, validNow, validNow);
    return { id, profileId: this.profileId, name, rank, createdAt: validNow, updatedAt: validNow };
  }

  /** Renames a location. Its place in the user's order is untouched. */
  renameLocation(id: string, name: string, now: string): PantryLocation {
    const validNow = validateNow(now);
    const current = this.locationRow(id);
    const resolved = resolveLocationName({ name });

    this.updateLocation.run(resolved, validNow, id, this.profileId);
    return { ...toLocation(current), name: resolved, updatedAt: validNow };
  }

  /**
   * Moves a location between two neighbours named by their ids — either may be
   * null, for „to the start“ and „to the end“. A pair that does not describe a
   * gap (the same row twice, or the two given the wrong way round) is REFUSED
   * rather than appended: `rankBetween`'s own contract, and a silent append
   * would be a drag that landed somewhere the user did not drop it.
   */
  moveLocation(
    id: string,
    beforeId: string | null,
    afterId: string | null,
    now: string,
  ): PantryLocation {
    const validNow = validateNow(now);
    const current = this.locationRow(id);
    this.requireLocation(beforeId);
    this.requireLocation(afterId);

    const rank = placeBetween(
      (siblingId) => this.locationRow(siblingId).rank,
      beforeId,
      afterId,
    );
    if (rank === null) {
      throw new PantryValidationError(
        `"${String(beforeId)}" and "${String(afterId)}" do not describe a gap to place "${id}" in.`,
      );
    }

    this.updateLocationRank.run(rank, validNow, id, this.profileId);
    return { ...toLocation(current), rank, updatedAt: validNow };
  }

  /**
   * Soft-deletes an EMPTY location (reversible via `restoreLocation`). A
   * location that still holds live items is refused: nulling their shelf
   * silently would lose which cupboard the user meant, and cascading would take
   * the food with it. The user moves the items out, then removes the shelf.
   */
  softDeleteLocation(id: string, now: string): void {
    const validNow = validateNow(now);
    this.locationRow(id);
    const { items } = this.countItemsInLocation.get(id, this.profileId) as { items: number };
    if (items > 0) {
      throw new PantryValidationError(
        `Location "${id}" still holds ${items} item(s); move them before removing it.`,
      );
    }
    this.markLocationDeleted.run(validNow, validNow, id, this.profileId);
  }

  /** Restores a soft-deleted location, at the rank it had. */
  restoreLocation(id: string, now: string): void {
    const validNow = validateNow(now);
    const { changes } = this.markLocationRestored.run(validNow, id, this.profileId);
    if (changes === 0) {
      throw new PantryNotFoundError(`No deleted location "${id}" to restore in this profile.`);
    }
  }
  /** This profile's live items, sr-Latn alphabetical — ARCHIVED ONES INCLUDED, each carrying its own `archivedAt`. */
  listItems(): PantryItem[] {
    const rows = this.selectItems.all(this.profileId) as ItemRow[];
    return rows
      .map((row) => toItem(row))
      .sort(
        (left, right) =>
          ITEM_COLLATOR.compare(left.name, right.name) || left.id.localeCompare(right.id),
      );
  }

  /** Inserts an item and returns the stored row. Its quantity starts where the caller says. */
  createItem(input: CreatePantryItemInput, now: string): PantryItem {
    const validNow = validateNow(now);
    const fields = resolveItemFields(input, validNow.slice(0, 10));
    this.requireLocation(fields.locationId);

    const id = uuidv7();
    this.insertItem.run(
      id, this.profileId, fields.locationId, fields.name, fields.category, fields.quantity,
      fields.unit, fields.minQuantity, fields.expiryDate, fields.openedDate, fields.useWithinDays,
      fields.notes, fields.barcode, fields.doseNote, null, validNow, validNow,
    );
    return {
      id,
      profileId: this.profileId,
      ...fields,
      archivedAt: null,
      createdAt: validNow,
      updatedAt: validNow,
    };
  }

  /**
   * Applies a partial patch to an item that is still here. An ARCHIVED item is
   * edited on exactly these terms — archiving says „ne pitaj me više za ovo“,
   * never „ne diraj me“.
   *
   * A patch carrying `quantity` is refused; see `UpdatePantryItemFields`.
   */
  updateItem(id: string, fields: UpdatePantryItemFields, now: string): PantryItem {
    const validNow = validateNow(now);
    if (!isRecord(fields)) {
      throw new PantryValidationError("A pantry item patch must be an object.");
    }
    const patch: Record<string, unknown> = fields;
    if ("quantity" in patch) {
      throw new PantryValidationError(
        "A pantry item's quantity moves through changeQuantity, not updateItem.",
      );
    }

    const current = this.requireItem(id);
    const resolved = resolveItemFields(
      {
        locationId: nullable(patch, "locationId", current.locationId),
        name: patched(patch, "name", current.name),
        category: patched(patch, "category", current.category),
        quantity: current.quantity,
        unit: patched(patch, "unit", current.unit),
        minQuantity: nullable(patch, "minQuantity", current.minQuantity),
        expiryDate: nullable(patch, "expiryDate", current.expiryDate),
        openedDate: nullable(patch, "openedDate", current.openedDate),
        useWithinDays: nullable(patch, "useWithinDays", current.useWithinDays),
        notes: nullable(patch, "notes", current.notes),
        barcode: nullable(patch, "barcode", current.barcode),
        doseNote: nullable(patch, "doseNote", current.doseNote),
      },
      validNow.slice(0, 10),
    );
    if (resolved.locationId !== null && resolved.locationId !== current.locationId) {
      this.requireLocation(resolved.locationId);
    }

    this.updateItemFields.run(
      resolved.locationId, resolved.name, resolved.category, resolved.unit, resolved.minQuantity,
      resolved.expiryDate, resolved.openedDate, resolved.useWithinDays, resolved.notes,
      resolved.barcode, resolved.doseNote, validNow, id, this.profileId,
    );
    return { ...current, ...resolved, updatedAt: validNow };
  }

  /**
   * Moves the quantity by `delta` and records WHY, in ONE transaction: the item
   * and the log entry land together or not at all.
   *
   * The sign rule and the „a change is never zero“ rule come from
   * `validatePantryChange`; the two refusals this method adds are the ones about
   * the SHELF rather than about the patch — a change that would leave the
   * quantity below zero (an item that has run out is 0, not a debt) and one that
   * would drive it past `MAX_PANTRY_QUANTITY`.
   */
  changeQuantity(id: string, delta: number, reason: PantryLogReason, now: string): PantryItem {
    const validNow = validateNow(now);
    const problems = validatePantryChange({ delta, reason });
    if (problems.length > 0) {
      throw new PantryValidationError(describeProblems("Quantity change", problems));
    }

    const current = this.requireItem(id);
    const quantity = current.quantity + delta;
    if (quantity < 0) {
      throw new PantryValidationError(
        `A change of ${delta} would leave "${id}" at ${quantity}; a quantity is never negative.`,
      );
    }
    if (quantity > MAX_PANTRY_QUANTITY) {
      throw new PantryValidationError(
        `A change of ${delta} would leave "${id}" at ${quantity}, past the ${MAX_PANTRY_QUANTITY} ceiling.`,
      );
    }

    this.db.transaction(() => {
      this.updateItemQuantity.run(quantity, validNow, id, this.profileId);
      this.insertLog.run(uuidv7(), id, validNow, delta, reason);
    })();

    return { ...current, quantity, updatedAt: validNow };
  }

  /** Marks an item as one the user has finished with. It leaves the shopping list and keeps everything else. */
  archiveItem(id: string, now: string): void {
    const validNow = validateNow(now);
    const { changes } = this.markItemArchived.run(validNow, validNow, id, this.profileId);
    if (changes === 0) {
      throw new PantryNotFoundError(`No unarchived item "${id}" to archive in this profile.`);
    }
  }

  /** Puts an archived item back among the current ones. */
  unarchiveItem(id: string, now: string): void {
    const validNow = validateNow(now);
    const { changes } = this.markItemUnarchived.run(validNow, id, this.profileId);
    if (changes === 0) {
      throw new PantryNotFoundError(`No archived item "${id}" to unarchive in this profile.`);
    }
  }

  /**
   * Soft-deletes a live item (reversible via `restoreItem`). Its LOG is
   * UNTOUCHED: the changes really happened, and an undo has to bring them back
   * with the item, which is exactly why this is an UPDATE rather than a delete.
   */
  softDeleteItem(id: string, now: string): void {
    const validNow = validateNow(now);
    const { changes } = this.markItemDeleted.run(validNow, validNow, id, this.profileId);
    if (changes === 0) {
      throw new PantryNotFoundError(`No live item "${id}" to delete in this profile.`);
    }
  }

  /** Restores a soft-deleted item, with every change it ever had. */
  restoreItem(id: string, now: string): void {
    const validNow = validateNow(now);
    const { changes } = this.markItemRestored.run(validNow, id, this.profileId);
    if (changes === 0) {
      throw new PantryNotFoundError(`No deleted item "${id}" to restore in this profile.`);
    }
  }

  // --- The hand-written shopping list ---------------------------------------

  /**
   * This profile's hand-written lines, sr-Latn alphabetical -- the order the
   * shopping list is read in, and the same collator the pantry list uses.
   */
  listShoppingLines(): PantryShoppingLine[] {
    const rows = this.selectShoppingLines.all(this.profileId) as ShoppingRow[];
    return rows
      .map(toShoppingLine)
      .sort(
        (left, right) =>
          ITEM_COLLATOR.compare(left.name, right.name) || left.id.localeCompare(right.id),
      );
  }

  /**
   * Adds one line the user wrote himself.
   *
   * An `itemId` that names anything is checked HERE rather than at the wire, on
   * `requireLocation`'s exact terms: it must be a live item of THIS profile, and
   * a line pointing at somebody else's row would be a restock that lands in the
   * wrong pantry.
   */
  addShoppingLine(input: AddPantryShoppingLineInput, now: string): PantryShoppingLine {
    const validNow = validateNow(now);
    const fields = resolveShoppingLine(input);
    if (fields.itemId !== null) this.requireItem(fields.itemId);

    const id = uuidv7();
    this.insertShoppingLine.run(
      id, this.profileId, fields.name, fields.quantity, fields.unit, fields.itemId,
      validNow, validNow,
    );
    return {
      id,
      profileId: this.profileId,
      ...fields,
      createdAt: validNow,
      updatedAt: validNow,
    };
  }

  /**
   * Ticks one line off: the line goes, and -- when it names a stock item that is
   * still there -- the quantity it asked for comes back into stock in the SAME
   * transaction, recorded as a `bought` move so the log says where the number
   * came from.
   *
   * **Why this is one method rather than two calls from the module.** Half of
   * this pair is a shopping list that has an item on it and a shelf that does
   * not, or the reverse; `changeQuantity`'s own reasoning, one level up. Both
   * statements are inside one better-sqlite3 transaction, and the nested one
   * `changeQuantity` opens is a savepoint.
   *
   * **A line whose item is gone is still ticked.** A tick is a statement about
   * the list, and refusing it because the pantry changed underneath would leave
   * the user unable to get a line off their own list. So the restock is skipped
   * and nothing else is.
   */
  tickShoppingLine(id: string, now: string): void {
    const validNow = validateNow(now);
    const line = this.shoppingLineRow(id);
    this.db.transaction(() => {
      this.deleteShoppingLine.run(id, this.profileId);
      if (line.itemId === null) return;
      if (this.isLiveItem.get(line.itemId, this.profileId) === undefined) return;
      this.changeQuantity(line.itemId, line.quantity, "bought", validNow);
    })();
  }

  /** Drops one hand-written line without restocking anything -- "ne treba mi više". */
  removeShoppingLine(id: string): void {
    const { changes } = this.deleteShoppingLine.run(id, this.profileId);
    if (changes === 0) {
      throw new PantryNotFoundError(`No shopping line "${id}" in this profile.`);
    }
  }

  /**
   * Replaces every hand-written line with the ones an archive carried, in one
   * transaction and whole (ADR-090 imex). Ids are MINTED rather than restored,
   * on `TimersStore.replaceFromArchive`'s terms: a line's id is this database's
   * own key and no other profile holds it, so the archive carries what the user
   * typed and the keys are made here.
   *
   * The `itemId` links are NOT resolved here: they name rows the archive
   * carried, the module's own `parse` has already checked that (a link to an
   * item the archive does not carry is refused there), and `importData` has
   * written those items by the time the module applies this half.
   */
  replaceShoppingFromArchive(
    lines: readonly AddPantryShoppingLineInput[],
    now: string,
  ): void {
    const stamp = validateNow(now);
    const rows = lines.map((line) => resolveShoppingLine(line));
    this.db.transaction(() => {
      this.deleteShoppingLinesForProfile.run(this.profileId);
      for (const row of rows) {
        this.insertShoppingLine.run(
          uuidv7(), this.profileId, row.name, row.quantity, row.unit, row.itemId,
          stamp, stamp,
        );
      }
    })();
  }

  // --- The module's one preference ------------------------------------------

  /**
   * How many days ahead "expires soon" reaches, and with it the window main's
   * reminder uses. Absent means the shipped default, which is written down once,
   * in `DEFAULT_PANTRY_EXPIRY_WINDOW_DAYS` -- a module that restated the number
   * would be a second copy of it (`TimersStore.settings`' arrangement).
   */
  settings(): PantrySettings {
    const row = this.selectSettings.get(this.profileId) as
      | { expiry_window_days: number }
      | undefined;
    return {
      expiryWindowDays:
        row === undefined ? DEFAULT_PANTRY_EXPIRY_WINDOW_DAYS : row.expiry_window_days,
    };
  }

  /**
   * Writes the module's one preference. `null` DELETES the row rather than
   * writing a value: that is what an archive carrying no preference means, and
   * the profile then answers the default again, which is the one place it is
   * written down.
   */
  setExpiryWindow(days: number | null, now: string): PantrySettings {
    const stamp = validateNow(now);
    if (days === null) {
      this.deleteSettings.run(this.profileId);
      return this.settings();
    }
    this.upsertSettings.run(this.profileId, validateExpiryWindow(days), stamp);
    return this.settings();
  }

  /**
   * EVERY change of this profile's live items, oldest first. An item's own
   * history is a filter over it, and the waste report is `@nexus/core`'s
   * `wasteReport` over the same rows with a period. A soft-deleted item's
   * changes are excluded; an ARCHIVED item's are not, because what was thrown
   * away is not undone by having finished with the thing.
   */
  listLog(): PantryLogEntry[] {
    const rows = this.selectLog.all(this.profileId) as LogRow[];
    return rows.map((row) => toLogEntry(row));
  }

  /**
   * This profile's pantry as one versioned plain JSON value: live locations,
   * live items (archived ones included), and every change of those items.
   * Soft-deleted rows do not travel — a delete is a delete, and an undo is what
   * `restoreItem` is for.
   */
  exportData(): PantryExport {
    const locations = (this.selectLocations.all(this.profileId) as LocationRow[]).map(
      (row): PantryExportLocation => ({
        id: row.id,
        name: row.name,
        rank: row.rank,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }),
    );
    const items = (this.selectItems.all(this.profileId) as ItemRow[]).map(
      (row): PantryExportItem => {
        const item = toItem(row);
        return {
          id: item.id,
          locationId: item.locationId,
          name: item.name,
          category: item.category,
          quantity: item.quantity,
          unit: item.unit,
          minQuantity: item.minQuantity,
          expiryDate: item.expiryDate,
          openedDate: item.openedDate,
          useWithinDays: item.useWithinDays,
          notes: item.notes,
          barcode: item.barcode,
          doseNote: item.doseNote,
          archivedAt: item.archivedAt,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
        };
      },
    );
    const log = (this.selectLog.all(this.profileId) as LogRow[]).map(
      (row): PantryExportLogEntry => ({
        id: row.id,
        itemId: row.item_id,
        changedAt: row.changed_at,
        delta: row.delta,
        reason: toReason(row.reason),
      }),
    );
    return { version: PANTRY_EXPORT_VERSION, locations, items, log };
  }

  /**
   * Replaces this profile's pantry with the value's rows, after validating ALL
   * of it: nothing is written — and nothing is deleted — until every field, id,
   * rank, timestamp and cross-reference has passed, so a value this store will
   * not take leaves the pantry exactly as it stood.
   *
   * Rows keep their own ids and timestamps and are written under THIS store's
   * profile, which is what a profile restore needs: the archive came from
   * somewhere else, and the rest of that archive references these very ids.
   */
  importData(value: unknown): void {
    const payload = parsePantryExport(value);
    payload.locations.forEach((location, index) => {
      this.refuseForeign(location.id, `locations[${index}].id`, this.findLocationOwner);
    });
    payload.items.forEach((item, index) => {
      this.refuseForeign(item.id, `items[${index}].id`, this.findItemOwner);
    });
    payload.log.forEach((entry, index) => {
      this.refuseForeign(entry.id, `log[${index}].id`, this.findLogOwner);
    });

    this.db.transaction(() => {
      this.deleteLogForProfile.run(this.profileId);
      this.deleteItemsForProfile.run(this.profileId);
      this.deleteLocationsForProfile.run(this.profileId);
      for (const location of payload.locations) {
        this.insertLocation.run(
          location.id, this.profileId, location.name, location.rank,
          location.createdAt, location.updatedAt,
        );
      }
      for (const item of payload.items) {
        this.insertItem.run(
          item.id, this.profileId, item.locationId, item.name, item.category, item.quantity,
          item.unit, item.minQuantity, item.expiryDate, item.openedDate, item.useWithinDays,
          item.notes, item.barcode, item.doseNote, item.archivedAt, item.createdAt, item.updatedAt,
        );
      }
      for (const entry of payload.log) {
        this.insertLog.run(entry.id, entry.itemId, entry.changedAt, entry.delta, entry.reason);
      }
    })();
  }

  /** Reads a live item in this profile or throws — the scope check every item statement runs first. */
  private requireItem(id: string): PantryItem {
    const row = this.selectItemById.get(id, this.profileId) as ItemRow | undefined;
    if (!row) throw new PantryNotFoundError(`No live item "${id}" in this profile.`);
    return toItem(row);
  }

  /** Reads a live location in this profile or throws. `null` is „no location“ and passes. */
  private requireLocation(id: string | null): void {
    if (id === null) return;
    this.locationRow(id);
  }

  /** The row of a live location in this profile, or a throw. */
  private locationRow(id: string): LocationRow {
    const row = this.selectLocationById.get(id, this.profileId) as LocationRow | undefined;
    if (!row) throw new PantryNotFoundError(`No live location "${id}" in this profile.`);
    return row;
  }

  /** The row of one hand-written shopping line, or a throw. */
  private shoppingLineRow(id: string): PantryShoppingLine {
    const row = this.selectShoppingLineById.get(id, this.profileId) as ShoppingRow | undefined;
    if (!row) throw new PantryNotFoundError(`No shopping line "${id}" in this profile.`);
    return toShoppingLine(row);
  }

  /**
   * A row id is unique across the whole DATABASE rather than per profile, so an
   * archive naming an id this file already holds under another profile cannot be
   * written — and saying so here is a sentence rather than the raw `UNIQUE`
   * error the transaction would raise from inside itself. The same id under THIS
   * profile is the ordinary re-import, and the replace below deletes it.
   */
  private refuseForeign(id: string, field: string, find: Database.Statement): void {
    const row = find.get(id) as { profile_id: string } | undefined;
    if (row !== undefined && row.profile_id !== this.profileId) {
      throw new PantryValidationError(
        `"${field}" names "${id}", which this database already holds under another profile.`,
      );
    }
  }

  private maxRank(): string | null {
    const row = this.maxLocationRank.get(this.profileId) as { maxRank: string | null };
    return row.maxRank;
  }
}

function toLocation(row: LocationRow): PantryLocation {
  return {
    id: row.id,
    profileId: row.profile_id,
    name: row.name,
    rank: row.rank,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toItem(row: ItemRow): PantryItem {
  return {
    id: row.id,
    profileId: row.profile_id,
    locationId: row.location_id,
    name: row.name,
    category: row.category as PantryCategory,
    quantity: row.quantity,
    unit: row.unit as PantryUnit,
    minQuantity: row.min_quantity,
    expiryDate: row.expiry_date,
    openedDate: row.opened_date,
    useWithinDays: row.use_within_days,
    notes: row.notes,
    barcode: row.barcode,
    doseNote: row.dose_note,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toLogEntry(row: LogRow): PantryLogEntry {
  return {
    id: row.id,
    itemId: row.item_id,
    changedAt: row.changed_at,
    delta: row.delta,
    reason: toReason(row.reason),
  };
}

function toShoppingLine(row: ShoppingRow): PantryShoppingLine {
  return {
    id: row.id,
    profileId: row.profile_id,
    name: row.name,
    quantity: row.quantity,
    unit: row.unit as PantryUnit,
    itemId: row.item_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * A stored reason, refused when it is not one. This store writes only validated
 * reasons, so anything else is corruption (a hand-edited file, a bad restore)
 * rather than input to coerce — reading it as `correction` would silently turn
 * „bačeno“ into „ispravka“.
 */
function toReason(value: string): PantryLogReason {
  if (value !== "bought" && value !== "used" && value !== "expired" && value !== "correction") {
    throw new PantryValidationError(`A stored pantry change carries the unknown reason "${value}".`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The patch's own value when it names the key, the current one otherwise. */
function patched(patch: Record<string, unknown>, key: string, current: unknown): unknown {
  return key in patch ? patch[key] : current;
}

/** As `patched`, but an explicit `null` or `undefined` clears a nullable field. */
function nullable(patch: Record<string, unknown>, key: string, current: unknown): unknown {
  return patched(patch, key, current) ?? null;
}

/** Absent, empty and whitespace-only are the same absence. */
function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function resolveLocationName(input: unknown): string {
  const raw: Record<string, unknown> = isRecord(input) ? input : {};
  const problems = validatePantryLocation(raw);
  if (problems.length > 0) {
    throw new PantryValidationError(describeProblems("Pantry location", problems));
  }
  return (raw["name"] as string).trim();
}

/**
 * Validates a whole item through `@nexus/core`'s one gate and returns the
 * CANONICAL form: names and notes trimmed, absent text as `null`.
 *
 * The input is read as an untrusted record and the optional keys default to
 * `null`, so a caller that omitted them and a caller that sent `undefined` get
 * the same row — and a caller that sent the wrong KIND of thing is refused by
 * the validator rather than repaired by a coercion here.
 */
function resolveItemFields(input: unknown, today: string): PantryItemFields {
  const raw: Record<string, unknown> = isRecord(input) ? input : {};
  const candidate = {
    locationId: raw["locationId"] ?? null,
    name: raw["name"],
    category: raw["category"],
    quantity: raw["quantity"],
    unit: raw["unit"],
    minQuantity: raw["minQuantity"] ?? null,
    expiryDate: raw["expiryDate"] ?? null,
    openedDate: raw["openedDate"] ?? null,
    useWithinDays: raw["useWithinDays"] ?? null,
    notes: raw["notes"] ?? null,
    barcode: raw["barcode"] ?? null,
    doseNote: raw["doseNote"] ?? null,
  };

  const problems = validatePantryItem(candidate, today);
  if (problems.length > 0) {
    throw new PantryValidationError(describeProblems("Pantry item", problems));
  }

  // Each cast below is a narrowing the validator has just performed and the type
  // system cannot see. Nothing else in this file is entitled to assume it.
  return {
    locationId: candidate.locationId as string | null,
    name: (candidate.name as string).trim(),
    category: candidate.category as PantryCategory,
    quantity: candidate.quantity as number,
    unit: candidate.unit as PantryUnit,
    minQuantity: candidate.minQuantity as number | null,
    expiryDate: candidate.expiryDate as string | null,
    openedDate: candidate.openedDate as string | null,
    useWithinDays: candidate.useWithinDays as number | null,
    notes: normalizeText(candidate.notes),
    barcode: candidate.barcode as string | null,
    doseNote: normalizeText(candidate.doseNote),
  };
}

/**
 * Reads one exported location, or throws. Every field is re-validated: this
 * value came out of a file somebody may have edited, so „the store wrote it, so
 * it must be fine“ is precisely the assumption an importer may not make.
 */
function readExportLocation(value: unknown, index: number): PantryExportLocation {
  const where = `locations[${index}]`;
  const raw = asRow(value, where);
  const problems = validatePantryLocation(raw);
  if (problems.length > 0) throw new PantryValidationError(describeProblems(where, problems));

  const rank = raw["rank"];
  if (typeof rank !== "string" || !isRank(rank)) {
    throw new PantryValidationError(`${where}.rank is not a valid rank.`);
  }
  return {
    id: readId(raw["id"], `${where}.id`),
    name: (raw["name"] as string).trim(),
    rank,
    createdAt: readTimestamp(raw["createdAt"], `${where}.createdAt`),
    updatedAt: readTimestamp(raw["updatedAt"], `${where}.updatedAt`),
  };
}

/**
 * Reads one exported item, or throws.
 *
 * The „opening date in the future“ rule needs a reference day and an import has
 * no clock, so the reference is the row's OWN `updatedAt` date. That is not a
 * guess: this store stamps `openedDate` from the same `now` it stamps
 * `updatedAt` with, so a row the store wrote can never carry an opening date
 * after the day it was last written, and a value that does was assembled by
 * hand.
 */
function readExportItem(value: unknown, index: number): PantryExportItem {
  const where = `items[${index}]`;
  const raw = asRow(value, where);
  const updatedAt = readTimestamp(raw["updatedAt"], `${where}.updatedAt`);
  const createdAt = readTimestamp(raw["createdAt"], `${where}.createdAt`);

  const problems = validatePantryItem(raw, updatedAt.slice(0, 10));
  if (problems.length > 0) throw new PantryValidationError(describeProblems(where, problems));

  const archivedAt = raw["archivedAt"];
  const locationId = raw["locationId"];
  return {
    id: readId(raw["id"], `${where}.id`),
    locationId:
      locationId === null || locationId === undefined
        ? null
        : readId(locationId, `${where}.locationId`),
    name: (raw["name"] as string).trim(),
    category: raw["category"] as PantryCategory,
    quantity: raw["quantity"] as number,
    unit: raw["unit"] as PantryUnit,
    minQuantity: raw["minQuantity"] as number | null,
    expiryDate: raw["expiryDate"] as string | null,
    openedDate: raw["openedDate"] as string | null,
    useWithinDays: raw["useWithinDays"] as number | null,
    notes: normalizeText(raw["notes"]),
    barcode: raw["barcode"] as string | null,
    doseNote: normalizeText(raw["doseNote"]),
    archivedAt:
      archivedAt === null || archivedAt === undefined
        ? null
        : readTimestamp(archivedAt, `${where}.archivedAt`),
    createdAt,
    updatedAt,
  };
}

function readExportLogEntry(value: unknown, index: number): PantryExportLogEntry {
  const where = `log[${index}]`;
  const raw = asRow(value, where);
  const problems = validatePantryChange(raw);
  if (problems.length > 0) throw new PantryValidationError(describeProblems(where, problems));

  return {
    id: readId(raw["id"], `${where}.id`),
    itemId: readId(raw["itemId"], `${where}.itemId`),
    changedAt: readTimestamp(raw["changedAt"], `${where}.changedAt`),
    delta: raw["delta"] as number,
    reason: raw["reason"] as PantryLogReason,
  };
}

/**
 * The whole value, or a throw. Every row rule runs HERE, before `importData` has
 * touched a row, and the cross-references are checked last so that a dangling
 * reference is refused as the dangling reference it is rather than as a
 * foreign-key error from inside the transaction.
 */
/**
 * The whole value, or a throw. Exported because the module's own archive reader
 * (`main/imex.ts`) has to read this half of its payload at the PREVIEW, before
 * anything is written, and a second parser up there would be a second definition
 * of what a valid pantry export is.
 */
export function parsePantryExport(value: unknown): PantryExport {
  if (!isRecord(value)) throw new PantryValidationError("A pantry export must be an object.");
  const keys = Object.keys(value);
  const expected = ["version", "locations", "items", "log"];
  if (keys.length !== expected.length || !expected.every((key) => keys.includes(key))) {
    throw new PantryValidationError(
      "A pantry export carries exactly `version`, `locations`, `items` and `log`.",
    );
  }
  if (value["version"] !== PANTRY_EXPORT_VERSION) {
    throw new PantryValidationError(
      `Unsupported pantry export version ${JSON.stringify(value["version"])}; ` +
        `this build reads version ${PANTRY_EXPORT_VERSION}.`,
    );
  }

  const locations = readRows(value["locations"], "locations").map((row, index) =>
    readExportLocation(row, index),
  );
  const items = readRows(value["items"], "items").map((row, index) =>
    readExportItem(row, index),
  );
  const log = readRows(value["log"], "log").map((row, index) =>
    readExportLogEntry(row, index),
  );

  const locationIds = new Set(locations.map((location) => location.id));
  if (locationIds.size !== locations.length) {
    throw new PantryValidationError("A pantry export carries two locations with one id.");
  }
  const itemIds = new Set<string>();
  for (const item of items) {
    if (itemIds.has(item.id)) {
      throw new PantryValidationError(`A pantry export carries two items with the id "${item.id}".`);
    }
    if (item.locationId !== null && !locationIds.has(item.locationId)) {
      throw new PantryValidationError(
        `Item "${item.id}" names the location "${item.locationId}", which the export does not carry.`,
      );
    }
    itemIds.add(item.id);
  }
  const logIds = new Set<string>();
  for (const entry of log) {
    if (logIds.has(entry.id)) {
      throw new PantryValidationError(`A pantry export carries two changes with the id "${entry.id}".`);
    }
    if (!itemIds.has(entry.itemId)) {
      throw new PantryValidationError(
        `Change "${entry.id}" names the item "${entry.itemId}", which the export does not carry.`,
      );
    }
    logIds.add(entry.id);
  }

  return { version: PANTRY_EXPORT_VERSION, locations, items, log };
}

function readRows(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new PantryValidationError(`A pantry export's "${field}" must be an array.`);
  }
  if (value.length > MAX_PANTRY_EXPORT_ROWS) {
    throw new PantryValidationError(
      `A pantry export's "${field}" carries ${value.length} rows, past the ` +
        `${MAX_PANTRY_EXPORT_ROWS} this build accepts.`,
    );
  }
  return value;
}

function asRow(value: unknown, where: string): Record<string, unknown> {
  if (!isRecord(value)) throw new PantryValidationError(`${where} must be an object.`);
  return value;
}

/** An id out of an archive, bounded on `MAX_ID_LENGTH`'s terms — never merely „not empty“. */
function readId(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_ID_LENGTH) {
    throw new PantryValidationError(
      `"${field}" must be an id of at most ${MAX_ID_LENGTH} characters.`,
    );
  }
  return value;
}

function readTimestamp(value: unknown, field: string): string {
  if (typeof value !== "string" || !isDateTime(value)) {
    throw new PantryValidationError(`"${field}" must be an ISO-8601 date-time.`);
  }
  return value;
}

function describeProblems(subject: string, problems: readonly PantryProblem[]): string {
  const detail = problems.map((problem) => `"${problem.field}" (${problem.code})`).join(", ");
  return `${subject} is invalid: ${detail}.`;
}

function validateNow(value: string): string {
  if (!isDateTime(value)) {
    throw new PantryValidationError(`"now" must be an ISO-8601 date-time.`);
  }
  return value;
}

/**
 * Validates one hand-written shopping line and returns the CANONICAL form:
 * the name trimmed, an absent item link as `null`.
 *
 * The bounds are the schema's own (migration 075), so a value that could never
 * be stored is refused here with a sentence rather than by the CHECK. The unit
 * is `@nexus/core`'s list and the name is `MAX_PANTRY_NAME_LENGTH` -- the same
 * number the item's own name uses, because it is the same kind of thing.
 *
 * `itemId` is checked for SHAPE only; whether it names a live row is the
 * caller's question, because an archive's links resolve against the archive
 * while a form's resolve against this profile.
 */
function resolveShoppingLine(input: unknown): {
  name: string;
  quantity: number;
  unit: PantryUnit;
  itemId: string | null;
} {
  const raw: Record<string, unknown> = isRecord(input) ? input : {};
  const subject = "Pantry shopping line";

  const rawName = raw["name"];
  const name = typeof rawName === "string" ? rawName.trim() : "";
  if (name.length === 0 || name.length > MAX_PANTRY_NAME_LENGTH) {
    throw new PantryValidationError(
      `${subject} is invalid: "name" (${typeof rawName === "string" ? "range" : "shape"}).`,
    );
  }

  const quantity = raw["quantity"];
  if (
    typeof quantity !== "number" ||
    !Number.isFinite(quantity) ||
    quantity <= 0 ||
    quantity > MAX_PANTRY_QUANTITY
  ) {
    throw new PantryValidationError(
      `${subject} is invalid: "quantity" (${typeof quantity === "number" ? "range" : "shape"}).`,
    );
  }

  const unit = raw["unit"];
  if (!isPantryUnit(unit)) {
    throw new PantryValidationError(
      `${subject} is invalid: "unit" (${typeof unit === "string" ? "unit" : "shape"}).`,
    );
  }

  const itemId = raw["itemId"] ?? null;
  if (
    itemId !== null &&
    (typeof itemId !== "string" ||
      itemId !== itemId.trim() ||
      itemId.length === 0 ||
      itemId.length > MAX_ID_LENGTH)
  ) {
    throw new PantryValidationError(`${subject} is invalid: "itemId" (shape).`);
  }

  return { name, quantity, unit, itemId: itemId as string | null };
}

/** The window's own bound, mirrored from migration 075's CHECK so a bad number is a sentence rather than a constraint failure. */
function validateExpiryWindow(days: number): number {
  if (
    !Number.isSafeInteger(days) ||
    days < 1 ||
    days > MAX_PANTRY_EXPIRY_WINDOW_DAYS
  ) {
    throw new PantryValidationError(
      `An expiry window must be a whole number of days in 1..${MAX_PANTRY_EXPIRY_WINDOW_DAYS}.`,
    );
  }
  return days;
}
