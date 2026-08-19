import type { Migration } from "./migrations.js";

/**
 * Migration 67 — the Elektronika module's three tables.
 *
 * **What is NOT here is the point.** No component table. The catalogue is 153
 * constants in `@nexus/core` and it is versioned with the application, because
 * that is what it is: a fact about a part number. Written into SQLite, every
 * corrected datasheet would become a migration, every profile would carry a
 * drifting copy, and two synced devices could disagree about what a resistor is.
 * A part row keeps the component's ID and resolves it at read time —
 * `catalogueComponent` answering `undefined` for a build that no longer ships an
 * entry is the honest answer, and `circuitProblems` turns it into a placeholder
 * on the canvas rather than a circuit that will not open.
 *
 * **Three tables rather than one document column**, which is where this module
 * deliberately parts company with CANV next door. A canvas board stores
 * Excalidraw's JSON verbatim because Excalidraw owns that format and a schema of
 * ours would have to track seventy fields defined by somebody else's renderer.
 * Nothing owns this format but us, and a blob would cost three things at once: a
 * wire could not be a sync object, so two people editing opposite corners of one
 * circuit would collide over the whole of it; „every circuit using a BMP280"
 * would be a scan of every row rather than an index; and one bad coordinate
 * would take a circuit down instead of being one refused row.
 *
 * **A wire's ends are real foreign keys.** A dangling wire is then not something
 * the store has to remember to prevent — it cannot be written. The cost is that
 * a pulled wire can arrive before the part it names and be refused, which is
 * precisely the case the pull walk's two watermarks were built for (the part is
 * further down the same log), so it costs nothing that is not already paid.
 *
 * What SQL still cannot say is that a wire's two parts belong to the SAME
 * circuit as the wire — a CHECK cannot hold a sub-query. That one stays a store
 * rule, restated by `circuitProblems`, and it is the only invariant here that is
 * not structural.
 */
export const migration067: Migration = {
  version: 67,
  up(db) {
    db.exec(`
      CREATE TABLE circuits (
        id         TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        name       TEXT NOT NULL CHECK (length(name) > 0 AND length(name) <= 200),
        notes      TEXT NOT NULL DEFAULT '' CHECK (length(notes) <= 8000),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
      );

      -- The only circuit read there is: "this profile's live circuits, by name".
      CREATE INDEX circuits_profile_active
        ON circuits (profile_id, name, id)
        WHERE deleted_at IS NULL;

      CREATE TABLE circuit_parts (
        id           TEXT PRIMARY KEY,
        circuit_id   TEXT NOT NULL REFERENCES circuits(id) ON DELETE CASCADE,
        -- Into the catalogue, or into a component the user defined. Deliberately
        -- NOT a foreign key: there is no table to point at, and there must not
        -- be one.
        component_id TEXT NOT NULL CHECK (length(component_id) > 0),
        -- Empty is the ordinary case: the canvas falls back to the component's
        -- own name, which is what somebody who never renamed anything expects.
        label        TEXT NOT NULL DEFAULT '' CHECK (length(label) <= 120),
        x            REAL NOT NULL CHECK (x = x AND abs(x) <= 100000),
        y            REAL NOT NULL CHECK (y = y AND abs(y) <= 100000),
        rotation     INTEGER NOT NULL CHECK (rotation IN (0, 90, 180, 270)),
        -- The value the user chose, for a component that takes one. Whether it
        -- BELONGS is a catalogue question and cannot be asked here; that a
        -- stated one is positive can be.
        value        REAL CHECK (value IS NULL OR (value = value AND value > 0)),
        created_at   TEXT NOT NULL,
        updated_at   TEXT NOT NULL,
        deleted_at   TEXT
      );

      -- Opening a circuit reads every live part of it, and nothing else ever
      -- reads this table by anything but its circuit. „created_at“ rather than
      -- „id“ decides the order within a circuit, which is migration 058's lesson
      -- applied here: uuidv7 puts a MILLISECOND timestamp in its high bits and
      -- CSPRNG bytes below it, so two parts placed inside the same millisecond
      -- sort RANDOMLY against each other, while „created_at“ is the instant the
      -- caller actually stamped. „id“ still closes the index, which is what
      -- makes the order total when two rows share an instant.
      CREATE INDEX circuit_parts_circuit
        ON circuit_parts (circuit_id, created_at, id)
        WHERE deleted_at IS NULL;

      -- „Which of my circuits use a BMP280" — the question a blob could not
      -- answer without reading every circuit in the profile.
      CREATE INDEX circuit_parts_component
        ON circuit_parts (component_id, circuit_id)
        WHERE deleted_at IS NULL;

      CREATE TABLE circuit_wires (
        id           TEXT PRIMARY KEY,
        circuit_id   TEXT NOT NULL REFERENCES circuits(id) ON DELETE CASCADE,
        from_part_id TEXT NOT NULL REFERENCES circuit_parts(id) ON DELETE CASCADE,
        from_pin_id  TEXT NOT NULL CHECK (length(from_pin_id) > 0),
        to_part_id   TEXT NOT NULL REFERENCES circuit_parts(id) ON DELETE CASCADE,
        to_pin_id    TEXT NOT NULL CHECK (length(to_pin_id) > 0),
        -- The nine jumper colours, spelled as names. A CSS colour can never
        -- reach this column, which is what lets the canvas render it through a
        -- --nx-elec-wire-* token instead of painting a stored value.
        colour       TEXT NOT NULL CHECK (colour IN (
                       'red', 'black', 'yellow', 'green', 'blue',
                       'white', 'orange', 'brown', 'grey')),
        created_at   TEXT NOT NULL,
        updated_at   TEXT NOT NULL,
        deleted_at   TEXT
        -- There is DELIBERATELY no CHECK here forbidding a wire from a pin to
        -- itself, and the guard test is what settled it. Such a CHECK reads four
        -- columns that all travel as fields, so field-level LWW can merge two
        -- honest edits — one device moves the „from“ end, the other moves the
        -- „to“ end — into a row SQLite then refuses to write, and every table in
        -- „COLLECTION_COUPLED“ owes a repair for exactly that. The ones that
        -- have one earn it: a focus session that ended before it began is
        -- corrupt, and a transfer from an account to itself double-counts in
        -- every balance. A self-loop wire is neither — it draws as nothing and
        -- changes no electrical result. Paying for a merge repair to make a
        -- harmless row unrepresentable is the wrong trade, so the rule stays
        -- where it belongs on each side: „validateWire“ refuses to WRITE one,
        -- and „circuitProblems“ names one that arrived by merge.
      );

      -- The same order, for the same reason, one table over.
      CREATE INDEX circuit_wires_circuit
        ON circuit_wires (circuit_id, created_at, id)
        WHERE deleted_at IS NULL;

      -- Soft-deleting a part has to find the wires hanging off it, from both
      -- ends. Two indexes rather than one composite: a wire is looked up by
      -- whichever end the part happens to be.
      CREATE INDEX circuit_wires_from ON circuit_wires (from_part_id) WHERE deleted_at IS NULL;
      CREATE INDEX circuit_wires_to   ON circuit_wires (to_part_id)   WHERE deleted_at IS NULL;
    `);

    // The journal triggers, in the shape migration 063 generates for every other
    // collection. `circuits` carries its own `profile_id`; the two child tables
    // reach one through it, exactly as `document_renewals` reaches one through
    // `tracked_documents`.
    const guard = `(SELECT value FROM meta WHERE key = 'sync_journal_enabled') = '1'`;
    const own = (row: "new" | "old"): string =>
      `INSERT OR IGNORE INTO sync_journal (profile_id, collection, object_id)
          VALUES (${row}.profile_id, 'circuits', ${row}.id);`;
    const via = (table: string, row: "new" | "old"): string =>
      `INSERT OR IGNORE INTO sync_journal (profile_id, collection, object_id)
          SELECT p.profile_id, '${table}', ${row}.id
            FROM circuits p WHERE p.id = ${row}.circuit_id;`;

    db.exec(`
      CREATE TRIGGER circuits_sync_ai AFTER INSERT ON circuits WHEN ${guard} BEGIN
        ${own("new")}
      END;
      CREATE TRIGGER circuits_sync_au AFTER UPDATE ON circuits WHEN ${guard} BEGIN
        ${own("new")}
      END;
      CREATE TRIGGER circuits_sync_ad AFTER DELETE ON circuits WHEN ${guard} BEGIN
        ${own("old")}
      END;

      CREATE TRIGGER circuit_parts_sync_ai AFTER INSERT ON circuit_parts WHEN ${guard} BEGIN
        ${via("circuit_parts", "new")}
      END;
      CREATE TRIGGER circuit_parts_sync_au AFTER UPDATE ON circuit_parts WHEN ${guard} BEGIN
        ${via("circuit_parts", "new")}
      END;
      CREATE TRIGGER circuit_parts_sync_ad AFTER DELETE ON circuit_parts WHEN ${guard} BEGIN
        ${via("circuit_parts", "old")}
      END;

      CREATE TRIGGER circuit_wires_sync_ai AFTER INSERT ON circuit_wires WHEN ${guard} BEGIN
        ${via("circuit_wires", "new")}
      END;
      CREATE TRIGGER circuit_wires_sync_au AFTER UPDATE ON circuit_wires WHEN ${guard} BEGIN
        ${via("circuit_wires", "new")}
      END;
      CREATE TRIGGER circuit_wires_sync_ad AFTER DELETE ON circuit_wires WHEN ${guard} BEGIN
        ${via("circuit_wires", "old")}
      END;
    `);

    // BEFORE DELETE on the parent, for the reason 063's `cascadeTrigger` gives:
    // once the circuit row is gone there is no `profile_id` left anywhere on the
    // path, so the children's own AFTER DELETE triggers find nothing to select
    // and journal nothing. Their tombstones would never be pushed, and the other
    // device would keep parts of a circuit it had been told to forget.
    db.exec(`
      CREATE TRIGGER circuits_sync_bd BEFORE DELETE ON circuits WHEN ${guard} BEGIN
        INSERT OR IGNORE INTO sync_journal (profile_id, collection, object_id)
          SELECT old.profile_id, 'circuit_parts', id
            FROM circuit_parts WHERE circuit_id = old.id;
        INSERT OR IGNORE INTO sync_journal (profile_id, collection, object_id)
          SELECT old.profile_id, 'circuit_wires', id
            FROM circuit_wires WHERE circuit_id = old.id;
      END;
    `);
  },
};
