import type Database from "better-sqlite3-multiple-ciphers";
import { validateCircuitHeader, validatePart, validateWire } from "@nexus/core";
import type { CircuitProblem, PartRotation, WireColour } from "@nexus/core";
import { CircuitNotFoundError, CircuitValidationError } from "../errors.js";
import { uuidv7 } from "../ids.js";
import { isDateTime } from "../finance/money.js";

type DatabaseHandle = Database.Database;

/**
 * Serbian Latin ordering for the circuit list, on `CANVAS_COLLATOR`'s terms:
 * plain `"sr"` mis-tailors š/č/ć/ž, and SQLite's BINARY collation would put
 * „Šema" after „Zvono".
 */
const ELEC_COLLATOR = new Intl.Collator(["sr-Latn", "sr"]);

/** One circuit's own row — what „koja kola imam" answers. */
export interface StoredCircuit {
  id: string;
  profileId: string;
  name: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

/** One component placed on a circuit's canvas. */
export interface StoredCircuitPart {
  id: string;
  circuitId: string;
  /** Into the app's catalogue, or into a component the user defined. Never resolved here. */
  componentId: string;
  label: string;
  x: number;
  y: number;
  rotation: PartRotation;
  /** Present only for a component that takes one. Absent, never null — see `toPart`. */
  value?: number;
  createdAt: string;
  updatedAt: string;
}

/** One wire between two pins. */
export interface StoredCircuitWire {
  id: string;
  circuitId: string;
  fromPartId: string;
  fromPinId: string;
  toPartId: string;
  toPinId: string;
  colour: WireColour;
  createdAt: string;
  updatedAt: string;
}

/** A circuit with everything on it — what opening one reads. */
export interface StoredCircuitDetail extends StoredCircuit {
  parts: StoredCircuitPart[];
  wires: StoredCircuitWire[];
}

/** What `addPart` is given: the row, minus everything the store decides. */
export interface NewCircuitPart {
  componentId: string;
  label: string;
  x: number;
  y: number;
  rotation: number;
  value?: number;
}

/**
 * A partial edit of a placed part.
 *
 * `value: null` CLEARS it, and that is why the field is nullable here while it
 * is merely optional on the row: in a partial update `undefined` already means
 * „leave it alone", so without a null there would be no way to say „this
 * resistor should not have a value after all".
 */
export interface UpdateCircuitPartFields {
  label?: string;
  x?: number;
  y?: number;
  rotation?: number;
  value?: number | null;
}

/** What `addWire` is given. */
export interface NewCircuitWire {
  from: { partId: string; pinId: string };
  to: { partId: string; pinId: string };
  colour: string;
}

interface CircuitRow {
  id: string;
  profile_id: string;
  name: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

interface PartRow {
  id: string;
  circuit_id: string;
  component_id: string;
  label: string;
  x: number;
  y: number;
  rotation: number;
  value: number | null;
  created_at: string;
  updated_at: string;
}

interface WireRow {
  id: string;
  circuit_id: string;
  from_part_id: string;
  from_pin_id: string;
  to_part_id: string;
  to_pin_id: string;
  colour: string;
  created_at: string;
  updated_at: string;
}

const CIRCUIT_COLUMNS = "id, profile_id, name, notes, created_at, updated_at";
const PART_COLUMNS =
  "id, circuit_id, component_id, label, x, y, rotation, value, created_at, updated_at";
const WIRE_COLUMNS =
  "id, circuit_id, from_part_id, from_pin_id, to_part_id, to_pin_id, colour, created_at, updated_at";

/**
 * A profile's circuits, their parts and their wires, over prepared,
 * parameterized statements (SEC-API-03). Construct one per profile and reuse it.
 *
 * **Every statement is scoped to this profile** — the two child tables through
 * their circuit, since neither carries a `profile_id` of its own (migration
 * 067's arrangement, `document_renewals`' exactly). A write naming another
 * profile's row is a `CircuitNotFoundError`, never a row.
 *
 * **The rules come from `@nexus/core`, not from here.** `validateCircuitHeader`,
 * `validatePart` and `validateWire` are the domain's storage gate; this store
 * builds the candidate row — with the id it just minted — and hands it to them,
 * so „what a part is" has exactly one definition and this file cannot drift from
 * the canvas that draws it. What is added on top is only what a row in isolation
 * cannot know:
 *
 * - **a wire's two parts must be live parts of the wire's own circuit.** SQL
 *   cannot say it — a CHECK cannot hold a sub-query — and migration 067 says so
 *   in as many words. It is the one invariant here that is not structural.
 * - **removing a part takes the wires touching it, from both ends.** SQLite's
 *   `ON DELETE CASCADE` fires on a hard delete and every delete here is soft, so
 *   a wire hanging off a removed part would be a row `circuitProblems` reports
 *   for ever and no screen can reach.
 *
 * **Deleting a circuit does NOT cascade to its parts.** The rows stay exactly
 * where they are, and `restore` brings the canvas back as it was — a soft delete
 * that emptied the circuit would restore a blank one, which is the worse of the
 * two failures. The reads simply join through the circuit, so nothing of a
 * deleted one is visible in the meantime.
 *
 * **The catalogue is not in this database.** A part carries a `componentId` and
 * this store never resolves it: the components ship as constants in
 * `@nexus/core`, and whether a part has the pins a wire names is a question
 * `circuitProblems` asks with the component in hand.
 *
 * **Parts and wires come back in `created_at, id` order, never `id` alone** —
 * migration 058's lesson, and this store had the bug before it had the comment.
 * A uuidv7 carries a MILLISECOND timestamp above CSPRNG bytes, so two rows
 * written inside the same millisecond sort randomly against each other; ordering
 * by `id` alone therefore looks like creation order and is not one. `created_at`
 * is the instant the caller stamped, and `id` closes the order so it is still
 * TOTAL when two rows share an instant — which is what an archive round trip
 * needs, since it compares the arrays element by element.
 *
 * `now` is supplied by the caller and validated here — main stamps the clock,
 * the renderer never does.
 */
export class ElectronicsStore {
  private readonly insertCircuit: Database.Statement;
  private readonly selectActive: Database.Statement;
  private readonly selectActiveById: Database.Statement;
  private readonly updateName: Database.Statement;
  private readonly updateNotes: Database.Statement;
  private readonly markDeleted: Database.Statement;
  private readonly markRestored: Database.Statement;

  private readonly insertPart: Database.Statement;
  private readonly selectParts: Database.Statement;
  private readonly selectPartById: Database.Statement;
  private readonly updatePartRow: Database.Statement;
  private readonly markPartDeleted: Database.Statement;

  private readonly insertWire: Database.Statement;
  private readonly selectWires: Database.Statement;
  private readonly selectWireById: Database.Statement;
  private readonly updateWireColour: Database.Statement;
  private readonly markWireDeleted: Database.Statement;
  private readonly selectWiresOfPart: Database.Statement;
  private readonly markWiresOfPartDeleted: Database.Statement;

  private readonly selectAllParts: Database.Statement;
  private readonly selectAllWires: Database.Statement;

  private readonly removePartTx: (id: string, now: string) => string[];

  constructor(
    db: DatabaseHandle,
    private readonly profileId: string,
  ) {
    this.insertCircuit = db.prepare(
      `INSERT INTO circuits (id, profile_id, name, notes, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL)`,
    );
    this.selectActive = db.prepare(
      `SELECT ${CIRCUIT_COLUMNS} FROM circuits WHERE profile_id = ? AND deleted_at IS NULL`,
    );
    this.selectActiveById = db.prepare(
      `SELECT ${CIRCUIT_COLUMNS} FROM circuits
       WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    // Renaming and re-noting are two statements rather than one `update`, on
    // `CanvasStore`'s terms: a rename must not be able to carry notes, and the
    // notes editor must not be able to rename the circuit.
    this.updateName = db.prepare(
      `UPDATE circuits SET name = ?, updated_at = ?
       WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.updateNotes = db.prepare(
      `UPDATE circuits SET notes = ?, updated_at = ?
       WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.markDeleted = db.prepare(
      `UPDATE circuits SET deleted_at = ?, updated_at = ?
       WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.markRestored = db.prepare(
      `UPDATE circuits SET deleted_at = NULL, updated_at = ?
       WHERE id = ? AND profile_id = ? AND deleted_at IS NOT NULL`,
    );

    this.insertPart = db.prepare(
      `INSERT INTO circuit_parts
         (id, circuit_id, component_id, label, x, y, rotation, value, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    );
    this.selectParts = db.prepare(
      `SELECT ${PART_COLUMNS} FROM circuit_parts
       WHERE circuit_id = ? AND deleted_at IS NULL ORDER BY created_at, id`,
    );
    // Every child read joins to `circuits` for the profile scope — the two
    // tables have no `profile_id` of their own, deliberately (migration 067).
    this.selectPartById = db.prepare(
      `SELECT p.id AS id, p.circuit_id AS circuit_id, p.component_id AS component_id,
              p.label AS label, p.x AS x, p.y AS y, p.rotation AS rotation, p.value AS value,
              p.created_at AS created_at, p.updated_at AS updated_at
         FROM circuit_parts p JOIN circuits c ON c.id = p.circuit_id
        WHERE p.id = ? AND c.profile_id = ? AND p.deleted_at IS NULL AND c.deleted_at IS NULL`,
    );
    this.updatePartRow = db.prepare(
      `UPDATE circuit_parts SET label = ?, x = ?, y = ?, rotation = ?, value = ?, updated_at = ?
       WHERE id = ? AND deleted_at IS NULL`,
    );
    this.markPartDeleted = db.prepare(
      `UPDATE circuit_parts SET deleted_at = ?, updated_at = ?
       WHERE id = ? AND deleted_at IS NULL`,
    );

    this.insertWire = db.prepare(
      `INSERT INTO circuit_wires
         (id, circuit_id, from_part_id, from_pin_id, to_part_id, to_pin_id, colour,
          created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    );
    this.selectWires = db.prepare(
      `SELECT ${WIRE_COLUMNS} FROM circuit_wires
       WHERE circuit_id = ? AND deleted_at IS NULL ORDER BY created_at, id`,
    );
    // Answers with the WHOLE row rather than just its id. It was written for
    // `removeWire`, which needs only „does this profile own a live wire with
    // this id" — and giving the recolour a second statement would have been a
    // second answer to the same scope question, which is how two scope checks
    // drift apart. One statement, one profile scope; the caller that wants
    // nothing but existence simply ignores the columns.
    this.selectWireById = db.prepare(
      `SELECT w.id AS id, w.circuit_id AS circuit_id,
              w.from_part_id AS from_part_id, w.from_pin_id AS from_pin_id,
              w.to_part_id AS to_part_id, w.to_pin_id AS to_pin_id, w.colour AS colour,
              w.created_at AS created_at, w.updated_at AS updated_at
         FROM circuit_wires w JOIN circuits c ON c.id = w.circuit_id
        WHERE w.id = ? AND c.profile_id = ? AND w.deleted_at IS NULL AND c.deleted_at IS NULL`,
    );
    // Colour is the only field of a wire that can be edited, and it gets a
    // statement of its own for `updateName`/`updateNotes`' reason: a recolour
    // must not be able to move an end. Re-routing a jumper is pulling it out and
    // running another — which is also what happens on the bench.
    this.updateWireColour = db.prepare(
      `UPDATE circuit_wires SET colour = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`,
    );
    this.markWireDeleted = db.prepare(
      `UPDATE circuit_wires SET deleted_at = ?, updated_at = ?
       WHERE id = ? AND deleted_at IS NULL`,
    );
    // Both ends, in one statement: a wire is looked up by whichever end the
    // part happens to be, which is why migration 067 indexes them separately.
    this.markWiresOfPartDeleted = db.prepare(
      `UPDATE circuit_wires SET deleted_at = ?, updated_at = ?
       WHERE deleted_at IS NULL AND (from_part_id = ? OR to_part_id = ?)`,
    );
    // The same predicate, asked before the update rather than after it. It has
    // to run BEFORE, and inside the same transaction: the caller is a canvas
    // that must erase those wires from the screen, and asking afterwards is
    // asking which wires are gone of a query that answers with the ones left.
    this.selectWiresOfPart = db.prepare(
      `SELECT id FROM circuit_wires
        WHERE deleted_at IS NULL AND (from_part_id = ? OR to_part_id = ?)`,
    );

    // The export reads: one statement per table for the whole profile, never
    // one per circuit. An N+1 over circuits is the obvious wrong shape when the
    // caller wants everything.
    this.selectAllParts = db.prepare(
      `SELECT p.id AS id, p.circuit_id AS circuit_id, p.component_id AS component_id,
              p.label AS label, p.x AS x, p.y AS y, p.rotation AS rotation, p.value AS value,
              p.created_at AS created_at, p.updated_at AS updated_at
         FROM circuit_parts p JOIN circuits c ON c.id = p.circuit_id
        WHERE c.profile_id = ? AND p.deleted_at IS NULL AND c.deleted_at IS NULL
        ORDER BY p.created_at, p.id`,
    );
    this.selectAllWires = db.prepare(
      `SELECT w.id AS id, w.circuit_id AS circuit_id, w.from_part_id AS from_part_id,
              w.from_pin_id AS from_pin_id, w.to_part_id AS to_part_id, w.to_pin_id AS to_pin_id,
              w.colour AS colour, w.created_at AS created_at, w.updated_at AS updated_at
         FROM circuit_wires w JOIN circuits c ON c.id = w.circuit_id
        WHERE c.profile_id = ? AND w.deleted_at IS NULL AND c.deleted_at IS NULL
        ORDER BY w.created_at, w.id`,
    );

    // The part and its wires go together or not at all: a crash between the two
    // statements would leave exactly the hanging wire this method exists to
    // prevent.
    this.removePartTx = db.transaction((id: string, now: string): string[] => {
      const wires = (this.selectWiresOfPart.all(id, id) as { id: string }[]).map(
        (row) => row.id,
      );
      this.markWiresOfPartDeleted.run(now, now, id, id);
      this.markPartDeleted.run(now, now, id);
      return wires;
    });
  }

  /** This profile's live circuits, sr-Latn alphabetical, without their contents. */
  listActive(): StoredCircuit[] {
    const rows = this.selectActive.all(this.profileId) as CircuitRow[];
    return rows.map(toCircuit).sort(byName);
  }

  /** One live circuit with every part and wire on it, or a `CircuitNotFoundError`. */
  read(id: string): StoredCircuitDetail {
    const circuit = this.requireCircuit(id);
    return {
      ...circuit,
      parts: (this.selectParts.all(id) as PartRow[]).map(toPart),
      wires: (this.selectWires.all(id) as WireRow[]).map(toWire),
    };
  }

  /**
   * Everything this profile has, in three reads — what an export gathers.
   *
   * Parents first, and it is not tidiness: a part's `circuit_id` and both of a
   * wire's ends are real foreign keys wherever these rows land next, so an
   * archive that carried them in any other order would be refused on the way
   * back in. Nothing of a soft-deleted circuit rides, its parts and wires
   * included — the alternative is an archive carrying children of a parent it
   * does not carry.
   */
  listAllForExport(): {
    circuits: StoredCircuit[];
    parts: StoredCircuitPart[];
    wires: StoredCircuitWire[];
  } {
    return {
      circuits: this.listActive(),
      parts: (this.selectAllParts.all(this.profileId) as PartRow[]).map(toPart),
      wires: (this.selectAllWires.all(this.profileId) as WireRow[]).map(toWire),
    };
  }

  /** Creates a circuit. Absent notes are empty ones — a new circuit is the ordinary case. */
  createCircuit(input: { name: string; notes?: string }, now: string): StoredCircuit {
    const validNow = validateNow(now);
    const id = uuidv7();
    const name = input.name.trim();
    const notes = input.notes ?? "";
    refuse(validateCircuitHeader({ id, name, notes }));

    this.insertCircuit.run(id, this.profileId, name, notes, validNow, validNow);
    return { id, profileId: this.profileId, name, notes, createdAt: validNow, updatedAt: validNow };
  }

  /** Renames a live circuit. Cannot touch the notes — see the two statements' own comment. */
  renameCircuit(id: string, name: string, now: string): StoredCircuit {
    const validNow = validateNow(now);
    const current = this.requireCircuit(id);
    const trimmed = name.trim();
    refuse(validateCircuitHeader({ ...current, name: trimmed }));

    this.updateName.run(trimmed, validNow, id, this.profileId);
    return { ...current, name: trimmed, updatedAt: validNow };
  }

  /** Replaces a live circuit's notes. Cannot rename it. */
  setNotes(id: string, notes: string, now: string): StoredCircuit {
    const validNow = validateNow(now);
    const current = this.requireCircuit(id);
    refuse(validateCircuitHeader({ ...current, notes }));

    this.updateNotes.run(notes, validNow, id, this.profileId);
    return { ...current, notes, updatedAt: validNow };
  }

  /** Soft-deletes a live circuit (reversible via `restore`). Its parts and wires stay where they are. */
  softDelete(id: string, now: string): void {
    const validNow = validateNow(now);
    const { changes } = this.markDeleted.run(validNow, validNow, id, this.profileId);
    if (changes === 0) {
      throw new CircuitNotFoundError(`No live circuit "${id}" to delete in this profile.`);
    }
  }

  /** Restores a soft-deleted circuit, with everything that was on it. */
  restore(id: string, now: string): void {
    const validNow = validateNow(now);
    const { changes } = this.markRestored.run(validNow, id, this.profileId);
    if (changes === 0) {
      throw new CircuitNotFoundError(`No deleted circuit "${id}" to restore in this profile.`);
    }
  }

  /** Places a component on a live circuit of this profile. */
  addPart(circuitId: string, input: NewCircuitPart, now: string): StoredCircuitPart {
    const validNow = validateNow(now);
    this.requireCircuit(circuitId);
    const id = uuidv7();
    const row: StoredCircuitPart = {
      id,
      circuitId,
      componentId: input.componentId,
      label: input.label,
      x: input.x,
      y: input.y,
      // Cast on the way IN and never trusted: `validatePart` below is what
      // decides whether this really is one of the four quarter turns, and the
      // caller is untrusted (SEC-EL-02).
      rotation: input.rotation as PartRotation,
      ...(input.value === undefined ? {} : { value: input.value }),
      createdAt: validNow,
      updatedAt: validNow,
    };
    refuse(validatePart(row));

    this.insertPart.run(
      id, circuitId, row.componentId, row.label, row.x, row.y, row.rotation,
      row.value ?? null, validNow, validNow,
    );
    return row;
  }

  /** Edits a placed part — its label, where it sits, how it is turned, what value it carries. */
  updatePart(id: string, fields: UpdateCircuitPartFields, now: string): StoredCircuitPart {
    const validNow = validateNow(now);
    const current = this.requirePart(id);
    // Three states, not two: absent leaves the value alone, `null` clears it,
    // a number replaces it. Built without spreading `current`, because a spread
    // would carry the old value across and „cleared" would then have to be
    // undone with a `delete`.
    const value = fields.value === undefined ? current.value : (fields.value ?? undefined);
    const edited = {
      id: current.id,
      circuitId: current.circuitId,
      componentId: current.componentId,
      label: fields.label ?? current.label,
      x: fields.x ?? current.x,
      y: fields.y ?? current.y,
      rotation: (fields.rotation ?? current.rotation) as PartRotation,
      createdAt: current.createdAt,
      updatedAt: validNow,
    };
    const next: StoredCircuitPart = value === undefined ? edited : { ...edited, value };
    refuse(validatePart(next));

    this.updatePartRow.run(
      next.label, next.x, next.y, next.rotation, next.value ?? null, validNow, id,
    );
    return next;
  }

  /**
   * Removes a placed part and every wire touching it, from either end, and
   * answers with the WIRE IDS that went with it.
   *
   * The answer is the point rather than a courtesy: the caller is a canvas
   * holding the document in memory, and „the part is gone" leaves it drawing
   * wires to nothing. Re-reading the whole circuit after every delete would
   * answer the same question at the cost of every part and wire on it.
   */
  removePart(id: string, now: string): string[] {
    const validNow = validateNow(now);
    this.requirePart(id);
    return this.removePartTx(id, validNow);
  }

  /**
   * Runs a wire between two pins of a live circuit.
   *
   * Both parts must be live parts OF THAT CIRCUIT — the invariant migration 067
   * cannot state, because a CHECK cannot hold a sub-query. A part on another
   * circuit is refused here rather than by the foreign key, which would accept
   * it: the key says „some part", not „a part of this circuit".
   */
  addWire(circuitId: string, input: NewCircuitWire, now: string): StoredCircuitWire {
    const validNow = validateNow(now);
    this.requireCircuit(circuitId);
    const id = uuidv7();
    refuse(
      validateWire({
        id,
        circuitId,
        from: input.from,
        to: input.to,
        colour: input.colour,
      }),
    );

    const parts = new Set(
      (this.selectParts.all(circuitId) as PartRow[]).map((row) => row.id),
    );
    for (const end of ["from", "to"] as const) {
      const partId = input[end].partId;
      if (!parts.has(partId)) {
        throw new CircuitValidationError(
          `"${end}.partId" must name a live part of circuit "${circuitId}"; "${partId}" is not one.`,
        );
      }
    }

    const row: StoredCircuitWire = {
      id,
      circuitId,
      fromPartId: input.from.partId,
      fromPinId: input.from.pinId,
      toPartId: input.to.partId,
      toPinId: input.to.pinId,
      colour: input.colour as WireColour,
      createdAt: validNow,
      updatedAt: validNow,
    };
    this.insertWire.run(
      id, circuitId, row.fromPartId, row.fromPinId, row.toPartId, row.toPinId, row.colour,
      validNow, validNow,
    );
    return row;
  }

  /**
   * Recolours a wire, and answers with the wire as it now stands.
   *
   * The colour is not decoration. A jumper's colour is how the trade says what
   * a wire carries — black is ground, red is supply — so it is the one thing
   * about a run that gets corrected after the run is made, and „delete it and
   * run another" is the wrong repair: a new wire is a new `id`, which to sync is
   * a different object and to the user is the same one.
   *
   * The whole merged row is re-validated rather than the colour alone, on
   * `updatePart`'s terms — the store asks the domain the same question about
   * every row it writes, whichever field the caller touched.
   */
  setWireColour(id: string, colour: string, now: string): StoredCircuitWire {
    const validNow = validateNow(now);
    const current = this.requireWire(id);
    const next: StoredCircuitWire = {
      ...current,
      colour: colour as WireColour,
      updatedAt: validNow,
    };
    refuse(
      validateWire({
        id: next.id,
        circuitId: next.circuitId,
        from: { partId: next.fromPartId, pinId: next.fromPinId },
        to: { partId: next.toPartId, pinId: next.toPinId },
        colour: next.colour,
      }),
    );

    this.updateWireColour.run(next.colour, validNow, id);
    return next;
  }

  /** Removes a wire. Both its parts stay exactly where they are. */
  removeWire(id: string, now: string): void {
    const validNow = validateNow(now);
    this.requireWire(id);
    this.markWireDeleted.run(validNow, validNow, id);
  }

  /** Reads a live circuit of this profile or throws — the scope check every write runs first. */
  private requireCircuit(id: string): StoredCircuit {
    const row = this.selectActiveById.get(id, this.profileId) as CircuitRow | undefined;
    if (!row) {
      throw new CircuitNotFoundError(`No live circuit "${id}" in this profile.`);
    }
    return toCircuit(row);
  }

  /** The same check one table down, through the part's own circuit. */
  private requirePart(id: string): StoredCircuitPart {
    const row = this.selectPartById.get(id, this.profileId) as PartRow | undefined;
    if (!row) {
      throw new CircuitNotFoundError(`No live circuit part "${id}" in this profile.`);
    }
    return toPart(row);
  }

  /** And once more for wires, through the wire's own circuit. */
  private requireWire(id: string): StoredCircuitWire {
    const row = this.selectWireById.get(id, this.profileId) as WireRow | undefined;
    if (!row) {
      throw new CircuitNotFoundError(`No live wire "${id}" in this profile.`);
    }
    return toWire(row);
  }
}

function toCircuit(row: CircuitRow): StoredCircuit {
  return {
    id: row.id,
    profileId: row.profile_id,
    name: row.name,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * The column is nullable; the row's field is OPTIONAL. A `value: null` on the
 * way out would be a third state — „has a value, and it is nothing" — that every
 * reader would then have to handle beside `undefined`.
 */
function toPart(row: PartRow): StoredCircuitPart {
  return {
    id: row.id,
    circuitId: row.circuit_id,
    componentId: row.component_id,
    label: row.label,
    x: row.x,
    y: row.y,
    rotation: row.rotation as PartRotation,
    ...(row.value === null ? {} : { value: row.value }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toWire(row: WireRow): StoredCircuitWire {
  return {
    id: row.id,
    circuitId: row.circuit_id,
    fromPartId: row.from_part_id,
    fromPinId: row.from_pin_id,
    toPartId: row.to_part_id,
    toPinId: row.to_pin_id,
    colour: row.colour as WireColour,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function byName(a: StoredCircuit, b: StoredCircuit): number {
  return ELEC_COLLATOR.compare(a.name, b.name) || a.id.localeCompare(b.id);
}

/**
 * Turns the domain's problem list into this store's named refusal, naming the
 * first field at fault.
 *
 * The whole list is not carried across: the caller is a screen that has to say
 * one sentence, and the domain's own `CircuitProblem[]` is what
 * `circuitProblems` is for when a caller wants all of them at once.
 */
function refuse(problems: readonly CircuitProblem[]): void {
  const first = problems[0];
  if (first === undefined) return;
  throw new CircuitValidationError(`"${first.field}" is not valid (${first.code}).`);
}

function validateNow(value: string): string {
  if (!isDateTime(value)) {
    throw new CircuitValidationError(`"now" must be an ISO-8601 date-time.`);
  }
  return value;
}
