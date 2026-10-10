import type Database from "better-sqlite3-multiple-ciphers";
import { DatabaseError } from "../errors.js";
import { uuidv7 } from "../ids.js";
import { isDateTime } from "../finance/money.js";

type DatabaseHandle = Database.Database;

/**
 * The eight colours a pin may wear: the accent swatches `packages/tokens`
 * publishes as `--nx-swatch-*`.
 *
 * The list is here rather than in the page because it is a STORED value - the
 * migration's CHECK names the same eight - and because the wiring that keeps
 * the two in step is a compile error rather than a review: the CHECK's list and
 * this one are read side by side by `mapsStore.test.ts`, which inserts every
 * colour and refuses a ninth.
 */
export const PIN_COLORS = [
  "zlato",
  "bronza",
  "maslina",
  "suma",
  "zad",
  "ruza",
  "bordo",
  "grafit",
] as const;

export type PinColor = (typeof PIN_COLORS)[number];

/** A pin's title is a label on a map, not a sentence. */
export const MAX_PIN_TITLE_LENGTH = 120;
/** The note is the one place a person writes prose about a place. */
export const MAX_PIN_NOTE_LENGTH = 2000;
/**
 * How many pins one profile may hold.
 *
 * A bound on untrusted input rather than a limit anybody meets: a pin is a
 * deliberate act - somebody opened a dialog and typed a title - and two
 * thousand of them is far past any real map while being far below anything that
 * would make a list unpleasant to draw. It is enforced at the store because
 * that is the only place every write passes through.
 */
export const MAX_MAPS_PINS = 2000;

/** Thrown when a pin write is refused at the store boundary. */
export class MapsValidationError extends DatabaseError {}

/** Thrown when an operation names a pin that is not a row of THIS profile. */
export class MapsPinNotFoundError extends DatabaseError {}

/** One dropped pin: what a person marked, and how it should look on the map. */
export interface MapsPin {
  id: string;
  profileId: string;
  title: string;
  /** The note, or `null` - an empty note is stored as nothing rather than as an empty string. */
  note: string | null;
  lat: number;
  lon: number;
  color: PinColor;
  createdAt: string;
  updatedAt: string;
}

/**
 * Serbian Latin ordering for the pin list, on `TimersStore`'s terms: plain
 * `"sr"` mis-tailors š/č/ć/ž, and SQLite's BINARY collation would put „Šabac"
 * after „Sombor".
 */
const MAPS_COLLATOR = new Intl.Collator(["sr-Latn", "sr"]);

interface PinRow {
  id: string;
  profile_id: string;
  title: string;
  note: string | null;
  lat: number;
  lon: number;
  color: string;
  created_at: string;
  updated_at: string;
}

function pinFromRow(row: PinRow): MapsPin {
  return {
    id: row.id,
    profileId: row.profile_id,
    title: row.title,
    note: row.note,
    lat: row.lat,
    lon: row.lon,
    color: asPinColor(row.color),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * MAPS' storage (migration 87): the pins of one profile.
 *
 * **What is NOT here is the map itself.** The tiles, the style and the place
 * index live in the installed pack, which is not this profile's data and not in
 * this database (ADR-091 §5); the one position this module holds outside these
 * rows is where the machine currently is, which main keeps in memory because a
 * GPS fix is a fact about now rather than about a profile.
 *
 * **Every rule a validator cannot see is here.** That the title is trimmed and
 * non-empty, that a note of only spaces is no note, that a coordinate is a
 * finite number inside the world, that the colour is one of the eight, and that
 * a profile cannot grow past `MAX_MAPS_PINS`. main re-validates the wire
 * (SEC-EL-02); this store is the second answer, and the migration's CHECKs are
 * the third, which is what makes an impossible row unreachable rather than
 * merely unwritten.
 */
export class MapsStore {
  constructor(
    private readonly db: DatabaseHandle,
    private readonly profileId: string,
  ) {}

  /** Every pin of this profile, by title in the Serbian collator's order. */
  listPins(): MapsPin[] {
    const rows = this.db
      .prepare(
        `SELECT id, profile_id, title, note, lat, lon, color, created_at, updated_at
           FROM maps_pins
          WHERE profile_id = ?`,
      )
      .all(this.profileId) as PinRow[];
    return rows.map(pinFromRow).sort((left, right) => {
      const byTitle = MAPS_COLLATOR.compare(left.title, right.title);
      return byTitle !== 0 ? byTitle : left.id.localeCompare(right.id);
    });
  }

  /** How many pins this profile holds, without reading them. */
  countPins(): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS count FROM maps_pins WHERE profile_id = ?")
      .get(this.profileId) as { count: number };
    return row.count;
  }

  /** One pin, or `null` when this profile does not hold it. */
  pin(id: string): MapsPin | null {
    const row = this.db
      .prepare(
        `SELECT id, profile_id, title, note, lat, lon, color, created_at, updated_at
           FROM maps_pins
          WHERE id = ? AND profile_id = ?`,
      )
      .get(id, this.profileId) as PinRow | undefined;
    return row === undefined ? null : pinFromRow(row);
  }

  createPin(
    input: { title: string; note: string; lat: number; lon: number; color: PinColor },
    now: string,
  ): MapsPin {
    if (this.countPins() >= MAX_MAPS_PINS) {
      throw new MapsValidationError(
        `This profile already holds ${MAX_MAPS_PINS} pins, which is as many as one map keeps.`,
      );
    }
    const title = this.validTitle(input.title);
    const note = this.validNote(input.note);
    const stamp = this.validInstant(now);
    const id = uuidv7();
    this.db
      .prepare(
        `INSERT INTO maps_pins
           (id, profile_id, title, note, lat, lon, color, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        this.profileId,
        title,
        note,
        this.validLatitude(input.lat),
        this.validLongitude(input.lon),
        this.validColor(input.color),
        stamp,
        stamp,
      );
    return this.requirePin(id);
  }

  /**
   * Edits what a pin SAYS - its title, its note, its colour.
   *
   * Deliberately not where it is. A pin's position is what the user clicked on
   * the map, and moving one by typing is not a thing this module offers: the
   * answer to "I put it in the wrong place" is to drop it again, which leaves
   * the first mark where the user actually clicked rather than silently
   * relocating a note about a place they are no longer looking at.
   */
  updatePin(
    id: string,
    changes: { title: string; note: string; color: PinColor },
    now: string,
  ): MapsPin {
    const title = this.validTitle(changes.title);
    const note = this.validNote(changes.note);
    const color = this.validColor(changes.color);
    const stamp = this.validInstant(now);
    const result = this.db
      .prepare(
        `UPDATE maps_pins
            SET title = ?, note = ?, color = ?, updated_at = ?
          WHERE id = ? AND profile_id = ?`,
      )
      .run(title, note, color, stamp, id, this.profileId);
    if (result.changes === 0) throw new MapsPinNotFoundError(`No pin "${id}".`);
    return this.requirePin(id);
  }

  removePin(id: string): void {
    const result = this.db
      .prepare("DELETE FROM maps_pins WHERE id = ? AND profile_id = ?")
      .run(id, this.profileId);
    if (result.changes === 0) throw new MapsPinNotFoundError(`No pin "${id}".`);
  }

  /**
   * Replaces this profile's pins with one archive payload (ADR-090 §imex).
   *
   * **Why one transaction.** A restore replaces a profile whole, and a pin list
   * half-written - the delete committed, the fourth insert refused - would be a
   * map that lost somebody's marks to a refusal about one of them. The rows are
   * re-minted rather than restored by id, exactly as the timers presets are: the
   * id is this database's key, the archive carries what the user authored, and
   * the keys are made here.
   *
   * Rows arrive already validated by the module's own `parse`, and every bound
   * is checked again below, because a transaction that is going to roll back is
   * a better answer than a row that violates a CHECK.
   */
  replaceFromArchive(
    pins: readonly {
      readonly title: string;
      readonly note: string;
      readonly lat: number;
      readonly lon: number;
      readonly color: PinColor;
    }[],
    now: string,
  ): void {
    const stamp = this.validInstant(now);
    if (pins.length > MAX_MAPS_PINS) {
      throw new MapsValidationError(`At most ${MAX_MAPS_PINS} pins may be restored.`);
    }
    const rows = pins.map((pin) => ({
      id: uuidv7(),
      title: this.validTitle(pin.title),
      note: this.validNote(pin.note),
      lat: this.validLatitude(pin.lat),
      lon: this.validLongitude(pin.lon),
      color: this.validColor(pin.color),
    }));
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM maps_pins WHERE profile_id = ?").run(this.profileId);
      const insert = this.db.prepare(
        `INSERT INTO maps_pins
           (id, profile_id, title, note, lat, lon, color, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const row of rows) {
        insert.run(
          row.id,
          this.profileId,
          row.title,
          row.note,
          row.lat,
          row.lon,
          row.color,
          stamp,
          stamp,
        );
      }
    })();
  }

  // --- Internals ------------------------------------------------------------

  private requirePin(id: string): MapsPin {
    const pin = this.pin(id);
    if (pin === null) throw new MapsPinNotFoundError(`No pin "${id}".`);
    return pin;
  }

  private validTitle(raw: string): string {
    const title = raw.trim();
    if (title.length === 0 || title.length > MAX_PIN_TITLE_LENGTH) {
      throw new MapsValidationError(`A title must be 1..${MAX_PIN_TITLE_LENGTH} characters.`);
    }
    return title;
  }

  /** A note of nothing but spaces is no note: stored as `null`, which is what the column means. */
  private validNote(raw: string): string | null {
    const note = raw.trim();
    if (note.length === 0) return null;
    if (note.length > MAX_PIN_NOTE_LENGTH) {
      throw new MapsValidationError(`A note may be at most ${MAX_PIN_NOTE_LENGTH} characters.`);
    }
    return note;
  }

  private validLatitude(value: number): number {
    if (!Number.isFinite(value) || value < -90 || value > 90) {
      throw new MapsValidationError("A latitude must be a number between -90 and 90.");
    }
    return value;
  }

  private validLongitude(value: number): number {
    if (!Number.isFinite(value) || value < -180 || value > 180) {
      throw new MapsValidationError("A longitude must be a number between -180 and 180.");
    }
    return value;
  }

  private validColor(value: string): PinColor {
    if (!(PIN_COLORS as readonly string[]).includes(value)) {
      throw new MapsValidationError(`"${value}" is not a pin colour this build knows.`);
    }
    return value as PinColor;
  }

  private validInstant(value: string): string {
    if (!isDateTime(value)) throw new MapsValidationError(`"${value}" is not an instant.`);
    return value;
  }
}

/** A colour read back out of the database: the CHECK already refused anything else, and this is the type's own door. */
function asPinColor(value: string): PinColor {
  return value as PinColor;
}
