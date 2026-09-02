import type { Migration } from "./migrations.js";

/**
 * Migration 68 — the machine a circuit is the electronics of (ADR-085 E4c).
 *
 * **A TABLE rather than ten columns on `circuits`, and the reason is the one
 * invariant that matters here: a chassis is all nine numbers or it is none of
 * them.** As columns, „half a chassis" is a legal row — a body length with no
 * wheel radius — and every reader downstream would have to decide what that
 * means, which is how a NULL becomes a default becomes a fabricated dimension
 * in a file a simulator treats as fact. As a row in its own table it is simply
 * absent or complete, and SQLite enforces that with `NOT NULL` rather than with
 * a nine-way CHECK nobody would read.
 *
 * It is also the answer that ages better. Ten columns on `circuits` are ten
 * columns every query against that table carries forever, for a feature most
 * circuits never use: a breadboard is not a robot, and the overwhelming
 * majority of rows would hold ten NULLs.
 *
 * **The units are the ones the user typed** — centimetres and grams. Storing SI
 * would mean converting in both directions through a form and stating a bound
 * in a unit nobody entered; the single conversion to metres and kilograms
 * happens in the generator, where it is a fact about the URDF format. The
 * CHECKs are therefore written in centimetres too, and say what they mean.
 *
 * **Zero is refused as firmly as a negative**, which is the one bound worth
 * spelling out here: a body 0 cm long is a link with no extent and an inertia
 * of zero, and Gazebo does not refuse it — it simulates a machine that cannot
 * be pushed. A silent wrong answer is worse than a rejected row.
 *
 * `mount` on a part is the other half. It is a NAME (`front`, `top`) rather
 * than three coordinates so that a sensor's origin stays derived from the body
 * the user already dimensioned — the form never grows three fields per sensor.
 * Which parts may carry one is a catalogue question and cannot be asked in SQL,
 * so it stays where `component_id`'s validity already lives: in the store and
 * in `circuitProblems`.
 */
export const migration068: Migration = {
  version: 68,
  up(db) {
    db.exec(`
      CREATE TABLE circuit_chassis (
        -- One machine per circuit, so the circuit's own id IS the key. Deleting
        -- the circuit takes the machine with it.
        circuit_id     TEXT PRIMARY KEY REFERENCES circuits(id) ON DELETE CASCADE,
        shape          TEXT NOT NULL CHECK (shape IN ('diff-rover', 'four-wheel-rover')),

        -- Centimetres. Every one is required: the whole point of this table is
        -- that a partial chassis cannot be written.
        body_length_cm  REAL NOT NULL CHECK (body_length_cm  > 0 AND body_length_cm  <= 500),
        body_width_cm   REAL NOT NULL CHECK (body_width_cm   > 0 AND body_width_cm   <= 500),
        body_height_cm  REAL NOT NULL CHECK (body_height_cm  > 0 AND body_height_cm  <= 500),
        wheel_radius_cm REAL NOT NULL CHECK (wheel_radius_cm > 0 AND wheel_radius_cm <= 500),
        wheel_width_cm  REAL NOT NULL CHECK (wheel_width_cm  > 0 AND wheel_width_cm  <= 500),
        wheel_track_cm  REAL NOT NULL CHECK (wheel_track_cm  > 0 AND wheel_track_cm  <= 500),
        wheel_base_cm   REAL NOT NULL CHECK (wheel_base_cm   > 0 AND wheel_base_cm   <= 500),

        -- Grams.
        body_mass_g    REAL NOT NULL CHECK (body_mass_g  > 0 AND body_mass_g  <= 100000),
        wheel_mass_g   REAL NOT NULL CHECK (wheel_mass_g > 0 AND wheel_mass_g <= 100000),

        created_at     TEXT NOT NULL,
        updated_at     TEXT NOT NULL,
        deleted_at     TEXT,

        -- The one cross-field rule SQL CAN state, and the one a person gets
        -- wrong: wheels centred closer together than they are wide overlap each
        -- other through the middle of the robot. Equality is refused too —
        -- wheels exactly touching grind rather than drive. Last in the list
        -- because a TABLE constraint must follow every column definition.
        CHECK (wheel_track_cm > wheel_width_cm)
      );

      -- Where a sensor sits on the machine. NULL is the ordinary case and means
      -- „not on the robot" — a resistor has no mounting face, and a ranger the
      -- user has not placed is one the description lists rather than guesses at.
      ALTER TABLE circuit_parts ADD COLUMN mount TEXT
        CHECK (mount IS NULL OR mount IN ('front', 'rear', 'left', 'right', 'top'));
    `);

    // The journal triggers, migration 063's shape and migration 067's wording
    // one table over. The one difference is the OBJECT ID: every other child of
    // `circuits` is journalled under its own `id`, and this table has none —
    // `circuit_id` is the whole primary key, so it is both the row's identity
    // and the join that finds the profile. `SYNC_MAP` says the same thing in
    // `identity: ["circuit_id"]`, and `collectionGuard.test.ts` fails if the
    // two ever disagree.
    const guard = `(SELECT value FROM meta WHERE key = 'sync_journal_enabled') = '1'`;
    const via = (row: "new" | "old"): string =>
      `INSERT OR IGNORE INTO sync_journal (profile_id, collection, object_id)
          SELECT p.profile_id, 'circuit_chassis', ${row}.circuit_id
            FROM circuits p WHERE p.id = ${row}.circuit_id;`;

    db.exec(`
      CREATE TRIGGER circuit_chassis_sync_ai AFTER INSERT ON circuit_chassis WHEN ${guard} BEGIN
        ${via("new")}
      END;
      CREATE TRIGGER circuit_chassis_sync_au AFTER UPDATE ON circuit_chassis WHEN ${guard} BEGIN
        ${via("new")}
      END;
      CREATE TRIGGER circuit_chassis_sync_ad AFTER DELETE ON circuit_chassis WHEN ${guard} BEGIN
        ${via("old")}
      END;
    `);

    // And the parent's BEFORE DELETE, which SQLite gives no way to extend: a
    // trigger can only be replaced whole. Migration 067 wrote this one so that a
    // circuit destroyed for real would still leave tombstones for its parts and
    // its wires — once the circuit row is gone there is no `profile_id` anywhere
    // on the path, so a child's own AFTER DELETE selects nothing and journals
    // nothing. The machine cascades exactly the same way, so it needs exactly
    // the same rescue, and a new table added under an existing parent is the
    // shape that makes this easy to miss.
    db.exec(`
      DROP TRIGGER circuits_sync_bd;
      CREATE TRIGGER circuits_sync_bd BEFORE DELETE ON circuits WHEN ${guard} BEGIN
        INSERT OR IGNORE INTO sync_journal (profile_id, collection, object_id)
          SELECT old.profile_id, 'circuit_parts', id
            FROM circuit_parts WHERE circuit_id = old.id;
        INSERT OR IGNORE INTO sync_journal (profile_id, collection, object_id)
          SELECT old.profile_id, 'circuit_wires', id
            FROM circuit_wires WHERE circuit_id = old.id;
        INSERT OR IGNORE INTO sync_journal (profile_id, collection, object_id)
          SELECT old.profile_id, 'circuit_chassis', circuit_id
            FROM circuit_chassis WHERE circuit_id = old.id;
      END;
    `);
  },
};
