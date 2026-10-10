import type { Migration } from "./migrations.js";

/**
 * Migration 74 â€” the CAR module's storage (stage 1: the core, no UI).
 *
 * Eight tables, and the shape of the module is in the first one.
 *
 * **The eighth table is `car_settings`, and it arrived with stage 2** (the
 * module kit), by `ALTER`-free extension of this file rather than a migration of
 * its own, because 074 is UNRELEASED: no shipped build has ever stamped
 * `user_version` 74, so extending it in place reaches every database that will
 * ever have it and invents no history. What it holds is the module's one
 * preference, and it is a PROFILE row rather than a device one for
 * `timers_settings`' own reason: main reads it to decide when to remind, and it
 * therefore travels in the profile's archive.
 *
 * The two columns are `whatIsDue`'s thresholds, and the bounds below are the
 * domain's rather than a policy: a "due soon" window is days and distance, and
 * the distance bound is `MAX_INTERVAL_KM` -- the same ceiling an interval uses,
 * so no threshold can be set that no interval could ever exceed.
 *
 * **Neither this row nor the seven content tables join `RESTORE_WIPE_TABLES`,
 * and that is the opposite of what the stage-1 note further down expected.** The
 * note predicted stage 2 would move them there; stage 2 landed the module on the
 * KIT instead, and the kit's rule is the other one, stated in
 * `ModuleContext.importData`: `main/restore.ts` calls `restoreModuleData`
 * immediately after the replace, and every adopted module replaces its OWN rows
 * there, in one transaction, with one the archive does not name resetting what it
 * owns. The wipe list stays tied to `@nexus/sync`'s collection map, which sync's
 * hold freezes. That stale paragraph is left where it stands rather than edited,
 * because the file it sits in is a migration other runs read; this is the record.
 *
 * **A `vehicles` row is the anchor of everything else, and it carries the two
 * choices the rest of the module reads off it:** `fuel_type` (which decides
 * whether a fill is litres or kWh) and `distance_unit` (which unit every
 * odometer, interval and consumption figure in this vehicle's history is counted
 * in). Both are per VEHICLE rather than per profile, because a car bought in
 * miles keeps reading miles however the app is configured.
 *
 * **`archived_at` and `deleted_at` are two INDEPENDENT nullable timestamps**,
 * migration 055's arrangement applied to cars and for the same reason. They
 * answer different questions â€” â€ždo I still own it" and â€žis this row still here"
 * â€” and a sold car is not a deleted one: PRD 22 says a sold vehicle is archived
 * WITH its whole history, which is exactly what a delete would take away. A
 * single status column would have to invent a precedence between them.
 *
 * **Every child table is scoped THROUGH its vehicle and carries no `profile_id`
 * of its own** (`habit_entries`' arrangement, migration 055), which is what
 * makes â€ža write naming another profile's vehicle" unrepresentable rather than
 * merely refused: every statement in `CarStore` resolves the vehicle in this
 * profile before it touches a child row.
 *
 * **`odometer_readings.segment` is what makes an odometer replacement
 * expressible.** Readings must not decrease over time, and a replaced odometer
 * is the one legitimate reason for a number that does â€” so the replacement
 * starts a NEW segment (`CarStore.addReading` with `startsNewSegment`), and
 * nothing downstream ever subtracts across a boundary. There is no
 * `UNIQUE (vehicle_id, reading_date)`: two readings on one day is two honest
 * entries (a morning and an evening), unlike a habit's one tick per day.
 *
 * **`service_intervals` is unique per (vehicle, category)** and must carry at
 * least one of the two numbers, because an interval with neither is a row that
 * could never say anything. The CHECK says so rather than a store method
 * remembering to.
 *
 * **Money is an INTEGER in minor units, with its currency, exactly as FIN
 * defines it** (migration 051): `cost_minor` and `currency` are a PAIR, and the
 * CHECK states the pair so a half-priced row is unrepresentable. Fuel is the
 * same money from the other end: `price_per_unit_minor` or `total_minor`, either
 * or both, with the currency beside them, and the third of the three is derived
 * (`fuelCostMinor`) rather than stored twice.
 *
 * **`quantity` is REAL, deliberately.** A litre is not a thing this module
 * counts in halves of; 42,35 L is an ordinary fill, so the column keeps the
 * fraction that FIN's money columns refuse for money's own reasons.
 *
 * **`service_attachments` is `task_attachments` applied to a receipt**
 * (migration 024), table for table: one index row per file, the bytes
 * content-addressed in the encrypted blob store `main` owns. `sha256` is
 * indexed and NOT scoped by profile, because the blob store's reference count
 * must see every row that names a hash before anything is deleted.
 *
 * **`faults.service_id` points at the service that fixed it**, which makes
 * `service_entries` a referenced parent: any later column on it must land by
 * `ALTER TABLE â€¦ ADD COLUMN` and never by a table rebuild, because a rebuild's
 * `DROP TABLE` fires this `ON DELETE SET NULL` (and `service_attachments`'
 * `ON DELETE CASCADE`) inside a transaction where `PRAGMA foreign_keys` is a
 * no-op (ADR-042, migration 054's hazard).
 *
 * **Nothing here is journalled, and that is the state of the world rather than
 * an oversight.** Sync is on hold permanently; migration 063's trigger set is
 * frozen at the collections that existed then, and a new module's tables are not
 * added to it (its own doc says a new collection would get its triggers in a new
 * migration, on the day sync resumes). So there is no `_sync_ai/_au/_ad` trigger
 * on any table below, and `@nexus/db`'s `collectionGuard.test.ts` is unaffected:
 * it holds `@nexus/sync`'s map against `RESTORE_WIPE_TABLES`, and neither list
 * names a CAR table. The module's archive half (`CarStore.exportData` /
 * `importData`) is plugged into the profile archive in stage 2, which is also
 * when these tables join `RESTORE_WIPE_TABLES` â€” adding them there without the
 * refill would make a restore DESTROY car data, which is why this migration
 * leaves that list alone and `restoreStore.test.ts`'s exemption list carries a
 * CAR entry with this reasoning.
 *
 * **Indexes, four of them, each earned.** `vehicles_profile_active` serves the
 * only vehicle read there is. `odometer_readings_vehicle_day`,
 * `service_entries_vehicle_day` and `fuel_entries_vehicle_day` each serve
 * exactly one list query, in the order that query asks for. `service_intervals`
 * needs none beyond its uniqueness: three rows per vehicle is not a table that
 * wants an index of its own, and the unique one already serves the read.
 */
export const migration074: Migration = {
  version: 74,
  up(db) {
    db.exec(`
      CREATE TABLE vehicles (
        id            TEXT PRIMARY KEY,
        profile_id    TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        name          TEXT NOT NULL CHECK (length(name) > 0 AND length(name) <= 60),
        make          TEXT NOT NULL CHECK (length(make) > 0 AND length(make) <= 60),
        model         TEXT NOT NULL CHECK (length(model) > 0 AND length(model) <= 60),
        -- The lower bound is the first automobile (1886); the upper one is the
        -- store's, because only the store is handed the clock to compare with.
        year          INTEGER NOT NULL CHECK (typeof(year) = 'integer' AND year >= 1886),
        plate         TEXT CHECK (plate IS NULL OR length(plate) <= 20),
        -- ISO 3779: seventeen characters of an alphabet with no I, O or Q.
        -- NOT GLOB with a negated class means "no character outside this class
        -- anywhere", which is how a seventeen-character alphabet is stated in
        -- one clause. The store is still what NAMES the refusal the user reads.
        vin           TEXT CHECK (vin IS NULL OR
                         (length(vin) = 17 AND vin NOT GLOB '*[^A-HJ-NPR-Z0-9]*')),
        fuel_type     TEXT NOT NULL CHECK (fuel_type IN
                        ('petrol', 'diesel', 'lpg', 'cng', 'hybrid', 'electric', 'other')),
        distance_unit TEXT NOT NULL CHECK (distance_unit IN ('km', 'mi')),
        notes         TEXT,
        archived_at   TEXT,
        created_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL,
        deleted_at    TEXT
      );

      CREATE INDEX vehicles_profile_active
        ON vehicles (profile_id, name, id)
        WHERE deleted_at IS NULL;

      CREATE TABLE odometer_readings (
        id           TEXT PRIMARY KEY,
        vehicle_id   TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
        reading_date TEXT NOT NULL,
        reading      INTEGER NOT NULL
                       CHECK (typeof(reading) = 'integer' AND reading >= 0 AND reading <= 10000000),
        -- 1 for the odometer the car left the factory with; each replacement
        -- opens the next one. Readings never decrease within a segment.
        segment      INTEGER NOT NULL CHECK (typeof(segment) = 'integer' AND segment >= 1),
        created_at   TEXT NOT NULL,
        updated_at   TEXT NOT NULL
      );

      CREATE INDEX odometer_readings_vehicle_day
        ON odometer_readings (vehicle_id, reading_date, id);

      CREATE TABLE service_entries (
        id           TEXT PRIMARY KEY,
        vehicle_id   TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
        service_date TEXT NOT NULL,
        odometer     INTEGER
                       CHECK (odometer IS NULL OR
                              (typeof(odometer) = 'integer' AND odometer >= 0 AND odometer <= 10000000)),
        category     TEXT NOT NULL CHECK (category IN
                       ('oil', 'filters', 'tyres', 'brakes', 'battery', 'timing-belt',
                        'inspection', 'registration', 'repair', 'other')),
        description  TEXT NOT NULL CHECK (length(description) > 0 AND length(description) <= 500),
        cost_minor   INTEGER
                       CHECK (cost_minor IS NULL OR (typeof(cost_minor) = 'integer' AND cost_minor > 0)),
        currency     TEXT
                       CHECK (currency IS NULL OR
                              (length(currency) = 3 AND currency = upper(currency))),
        workshop     TEXT CHECK (workshop IS NULL OR length(workshop) <= 120),
        parts        TEXT CHECK (parts IS NULL OR length(parts) <= 500),
        created_at   TEXT NOT NULL,
        updated_at   TEXT NOT NULL,
        deleted_at   TEXT,
        -- A price without its currency is a number nobody can read, and a
        -- currency without a price is a label on nothing.
        CHECK ((cost_minor IS NULL) = (currency IS NULL))
      );

      CREATE INDEX service_entries_vehicle_day
        ON service_entries (vehicle_id, service_date, id);

      CREATE TABLE service_intervals (
        id           TEXT PRIMARY KEY,
        vehicle_id   TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
        category     TEXT NOT NULL CHECK (category IN
                       ('oil', 'filters', 'tyres', 'brakes', 'battery', 'timing-belt',
                        'inspection', 'registration', 'repair', 'other')),
        every_km     INTEGER
                       CHECK (every_km IS NULL OR
                              (typeof(every_km) = 'integer' AND every_km > 0 AND every_km <= 1000000)),
        every_months INTEGER
                       CHECK (every_months IS NULL OR
                              (typeof(every_months) = 'integer' AND
                               every_months > 0 AND every_months <= 600)),
        created_at   TEXT NOT NULL,
        updated_at   TEXT NOT NULL,
        -- One interval per category per vehicle, and an interval that names
        -- neither a distance nor a period would be a row that says nothing.
        CHECK (every_km IS NOT NULL OR every_months IS NOT NULL)
      );

      CREATE UNIQUE INDEX service_intervals_vehicle_category
        ON service_intervals (vehicle_id, category);

      CREATE TABLE fuel_entries (
        id                   TEXT PRIMARY KEY,
        vehicle_id           TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
        fuel_date            TEXT NOT NULL,
        odometer             INTEGER
                               CHECK (odometer IS NULL OR
                                      (typeof(odometer) = 'integer' AND
                                       odometer >= 0 AND odometer <= 10000000)),
        quantity             REAL NOT NULL CHECK (quantity > 0 AND quantity <= 500),
        full_tank            INTEGER NOT NULL CHECK (full_tank IN (0, 1)),
        price_per_unit_minor INTEGER
                               CHECK (price_per_unit_minor IS NULL OR
                                      (typeof(price_per_unit_minor) = 'integer' AND
                                       price_per_unit_minor > 0)),
        total_minor          INTEGER
                               CHECK (total_minor IS NULL OR
                                      (typeof(total_minor) = 'integer' AND total_minor > 0)),
        currency             TEXT
                               CHECK (currency IS NULL OR
                                      (length(currency) = 3 AND currency = upper(currency))),
        created_at           TEXT NOT NULL,
        updated_at           TEXT NOT NULL,
        deleted_at           TEXT,
        -- The price is one fact in two possible spellings: all three columns
        -- are null together, or the currency is there with at least one of the
        -- two numbers. The missing number is DERIVED for reading by
        -- CarStore/fuelCostMinor, never stored a second time where the two
        -- could disagree.
        CHECK ((price_per_unit_minor IS NULL AND total_minor IS NULL) = (currency IS NULL))
      );

      CREATE INDEX fuel_entries_vehicle_day
        ON fuel_entries (vehicle_id, fuel_date, id);

      CREATE TABLE faults (
        id         TEXT PRIMARY KEY,
        vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
        fault_date TEXT NOT NULL,
        symptom    TEXT NOT NULL CHECK (length(symptom) > 0 AND length(symptom) <= 300),
        status     TEXT NOT NULL CHECK (status IN ('open', 'fixed')),
        fix_notes  TEXT CHECK (fix_notes IS NULL OR length(fix_notes) <= 2000),
        -- The service that fixed it, when there was one. SET NULL rather than
        -- CASCADE: deleting a service entry must not delete the fault, whose
        -- whole point is that it happened.
        service_id TEXT REFERENCES service_entries(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
      );

      CREATE INDEX faults_vehicle_day ON faults (vehicle_id, fault_date, id);
      CREATE INDEX faults_service ON faults (service_id);

      CREATE TABLE service_attachments (
        id         TEXT PRIMARY KEY,
        service_id TEXT NOT NULL REFERENCES service_entries(id) ON DELETE CASCADE,
        file_name  TEXT NOT NULL,
        mime       TEXT NOT NULL,
        size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
        sha256     TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX service_attachments_service ON service_attachments (service_id);
      -- Deliberately NOT scoped by profile: the blob store is content-addressed
      -- across the whole database, so a reference count has to see every row.
      CREATE INDEX service_attachments_sha ON service_attachments (sha256);

      CREATE TABLE car_settings (
        profile_id        TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
        -- Days ahead that counts as "due soon". One year at most, because a
        -- window longer than the interval it is judging would call every
        -- interval soon.
        due_soon_days     INTEGER NOT NULL
                            CHECK (typeof(due_soon_days) = 'integer'
                                   AND due_soon_days >= 1 AND due_soon_days <= 365),
        -- The same bound service_intervals.every_km carries, so a threshold
        -- can always be exceeded by some interval this schema allows.
        due_soon_distance INTEGER NOT NULL
                            CHECK (typeof(due_soon_distance) = 'integer'
                                   AND due_soon_distance >= 1
                                   AND due_soon_distance <= 1000000),
        updated_at        TEXT NOT NULL
      );
    `);
  },
};
