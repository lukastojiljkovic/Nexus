import type { Migration } from "./migrations.js";

/**
 * Migration 76 — the COOKBOOK module's storage. Three tables, and — as with 055,
 * 058 and 060 — every decision the module turns on is written into the schema
 * rather than left to a store to remember.
 *
 * **The nutrition food table is NOT here, and neither is a second one.** An
 * ingredient line may point at a food the Fitness log already knows about, and
 * that food lives where it always did: the catalogue ships as JSON inside
 * `@nexus/core`, and the profile's own entries are `fit_foods` (migration 058).
 * So `cookbook_ingredients.food_ref` is TEXT with no foreign key, carrying
 * `catalogue:<id>` or `user:<uuid>` — the same grammar `fit_meal_items.food_ref`
 * uses, read and written through the same `parseFoodRef`/`foodRefText` pair in
 * `@nexus/core`. A cookbook with its own copy of that table would be a second
 * answer to „what does 100 g of this carry", and the two would drift.
 *
 * **`grams_per_unit` is where a volume becomes a mass, and it is the AUTHOR's
 * number.** „2 kašike maslinovog ulja" cannot be weighed without knowing what a
 * tablespoon of that oil weighs, and this module holds no density table — a
 * density is a number nobody publishes for „mamin ajvar", and a guessed one
 * would be a calorie count the user believes. What a recipe's author DID weigh
 * is a fact, so it is a field: the grams one unit of THIS line weighs. The
 * schema refuses it without a `food_ref` — a weight with nothing to weigh into
 * is a number no reader would ever use — and the store refuses a unit the
 * vocabulary does not carry (see the column comment).
 *
 * **`quantity_max` is a range's upper end, and the two CHECKs make the illegal
 * shapes unrepresentable.** „2–3 kašike" is a range; „kašika" is an amount
 * nobody stated, and giving it an upper end would make 0–3 look like a range
 * whose lower end is a real zero. So `quantity_max` may not exist without
 * `quantity`, and may not be below it.
 *
 * **`position` is an index into the list, not a rank — deliberately.** Migration
 * 062 converted every scope the user can DRAG among siblings to a fractional
 * `rank`, and explicitly left `fit_routine_items` and `fit_workout_sets` alone:
 * those are a FIELD of their parent, replaced whole, so there are never two
 * independent writers to merge and a rank would express nothing the array's own
 * order does not already say. A recipe's ingredients and steps are that case one
 * module over — the editor holds the whole list and saves it whole, which is what
 * `CookbookStore` does — and the store derives `position` from the array order
 * rather than accepting it from a caller.
 *
 * **No licence columns without a source, and no source without its licence.**
 * `source` has exactly two values, and the four paired CHECKs tie the five
 * licence columns to `imported`: an own recipe carries none of them, an imported
 * one carries all five. `CookbookStore.update` reaches neither `source` nor any
 * licence column, which is what makes „an edited imported recipe keeps its
 * attribution" a property of the statement set rather than of a caller's
 * discipline.
 *
 * **The photo is an attachment INDEX row stored as four columns, and its bytes
 * are never in SQLite.** They sit content-addressed on disk
 * (`<userData>/attachments/<sha256[0:2]>/<sha256>`), owned by main's blob store,
 * exactly as `note_attachments` (migration 013) and `dashboard_settings`'
 * background (migration 030) already do. A recipe carries ONE photo, so this is
 * the dashboard's arrangement — four columns on the row rather than a child
 * table — and `cookbook_recipes_photo` is the reverse lookup main's garbage
 * collection needs: „which rows still reference this hash". Deliberately NOT
 * partial on `deleted_at`, because a soft-deleted recipe still references its
 * blob, exactly as `dashboard_settings_background` is not partial either.
 *
 * **No journaling triggers, and not yet in `RESTORE_WIPE_TABLES`.** Migration 063
 * wrote the change journal's triggers for the collections that existed then, and
 * sync is on hold permanently: these tables declare nothing to the journal, and
 * adding them to it later is a new migration on the day sync resumes. That also
 * keeps this file from depending on a map in `@nexus/sync` that it must not read
 * (migration 063's own rule). The restore list is deliberately left alone too,
 * and for a SEQUENCING reason that expires: `ProfileData` carries no cookbook
 * field yet, so `RestoreStore` has nothing to write these tables back from, and
 * wiping them now would make every restore delete the user's recipes. The day
 * stage 2 plugs `RecipeStore.exportData`/`importData` into the archive, these
 * three tables join `RESTORE_WIPE_TABLES` and `@nexus/sync`'s collection map in
 * the same change.
 *
 * **Plain `CREATE TABLE`, and both child tables are referenced by nothing.**
 * `cookbook_ingredients` and `cookbook_steps` point at `cookbook_recipes` with
 * `ON DELETE CASCADE`, which makes `cookbook_recipes` a referenced parent from
 * the moment this migration runs — so ADR-042's hazard applies: a later column on
 * it must land by `ALTER TABLE … ADD COLUMN` and never by a table rebuild,
 * because `DROP TABLE`'s implicit DELETE fires every `ON DELETE` action pointing
 * at it while `PRAGMA foreign_keys` is a no-op inside the migration transaction.
 * A rebuild would silently take every ingredient and step with it.
 *
 * **`raw_text` is what the author WROTE, kept beside the parse.** Stage 2's
 * ingredient field runs the line a user types through `parseIngredientLine`
 * (the module's own parser, added with stage 1) and stores the fields it
 * answers; the parse is lossy by design — „2–3 kašike" is a quantity, a range
 * and `tbsp` from then on — so the raw line would otherwise be gone the moment
 * a recipe was saved, and the author's own spelling with it. The column is
 * `NOT NULL DEFAULT ''` because a line may legitimately have been written by a
 * pack or an archive that carries only the structured fields, and an empty
 * string is the honest answer for „nobody typed one".
 *
 * **Two more tables arrived with the module's screens (stage 2).**
 * `cookbook_settings` is the module's one preference — which units a scaled
 * quantity is written in — and it is a PROFILE row rather than a device one for
 * `timers_settings`' reason: main reads it and it travels in the archive.
 * `cookbook_food_matches` is the user's own link from an ingredient NAME to a
 * food in an installed dataset pack („mleveno meso is this"), remembered per
 * name so the second recipe that calls for it needs no second answer. It stores
 * the food reference as TEXT in `food_ref`'s own grammar rather than as a foreign
 * key, deliberately: the food lives in a signed content pack outside the
 * database (ADR-091), so there is no table to point at — and a match whose pack
 * was uninstalled must be able to stay, reading as „unknown food" rather than
 * being deleted by a cascade nobody asked for.
 *
 * **Three indexes, each earned.** `cookbook_recipes_profile_active` covers the
 * only recipe read there is — „this profile's live recipes, by title" — the shape
 * `habits_profile_active` already has. `cookbook_recipes_photo` is the blob
 * reverse lookup above. `cookbook_ingredients_recipe` and
 * `cookbook_steps_recipe` cover the two child reads, which are always „this
 * recipe's lines, in order" — the join that scopes a child to its profile runs
 * through `recipe_id`, and the position is the second half of the same index.
 */
export const migration076: Migration = {
  version: 76,
  up(db) {
    db.exec(`
      CREATE TABLE cookbook_recipes (
        id                  TEXT PRIMARY KEY,
        profile_id          TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        title               TEXT NOT NULL CHECK (length(title) > 0 AND length(title) <= 120),
        description         TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 2000),
        -- Free text: „srpska", „italijanska", „bliskoistočna". A closed list here
        -- would refuse the first cuisine anybody's grandmother cooked.
        cuisine             TEXT NOT NULL DEFAULT '' CHECK (length(cuisine) <= 60),
        course              TEXT NOT NULL
                              CHECK (course IN ('breakfast', 'starter', 'soup', 'main', 'side',
                                                'salad', 'dessert', 'baking', 'drink', 'preserve',
                                                'other')),
        -- INTEGER and not REAL, and the typeof CHECK is not decoration: SQLite
        -- stores 2.5 quite happily in an INTEGER column, and half a serving is a
        -- number every scaling read would then have to decide about (the FIN
        -- lesson, migration 051).
        servings            INTEGER NOT NULL
                              CHECK (typeof(servings) = 'integer' AND servings >= 1
                                     AND servings <= 100),
        -- Both optional and independent: a salad has no cook time and a marinade
        -- has no prep. NULL is „not stated", never zero minutes.
        prep_minutes        INTEGER
                              CHECK (prep_minutes IS NULL
                                     OR (typeof(prep_minutes) = 'integer' AND prep_minutes > 0
                                         AND prep_minutes <= 10080)),
        cook_minutes        INTEGER
                              CHECK (cook_minutes IS NULL
                                     OR (typeof(cook_minutes) = 'integer' AND cook_minutes > 0
                                         AND cook_minutes <= 10080)),
        -- A JSON array of names, the tracked_documents.reminder_offsets
        -- arrangement (migration 004): nothing ever queries one tag, tags are
        -- read with their recipe and written with it, and a tag table would add
        -- a join to every list for a field no read ever filters on.
        tags_json           TEXT NOT NULL DEFAULT '[]',
        rating              INTEGER
                              CHECK (rating IS NULL
                                     OR (typeof(rating) = 'integer' AND rating BETWEEN 1 AND 10)),
        notes               TEXT NOT NULL DEFAULT '' CHECK (length(notes) <= 8000),
        favourite           INTEGER NOT NULL DEFAULT 0 CHECK (favourite IN (0, 1)),
        source              TEXT NOT NULL CHECK (source IN ('own', 'imported')),
        licence_title       TEXT
                              CHECK (licence_title IS NULL
                                     OR (length(licence_title) > 0 AND length(licence_title) <= 200)),
        licence_author      TEXT
                              CHECK (licence_author IS NULL
                                     OR (length(licence_author) > 0 AND length(licence_author) <= 200)),
        licence_url         TEXT
                              CHECK (licence_url IS NULL
                                     OR (length(licence_url) > 0 AND length(licence_url) <= 500)),
        -- An SPDX idstring or 'public-domain'; the SHAPE is checked here and the
        -- grammar is @nexus/core's isRecipeLicenceId, which the store runs.
        licence_id          TEXT
                              CHECK (licence_id IS NULL
                                     OR (length(licence_id) > 0 AND length(licence_id) <= 64)),
        licence_attribution TEXT
                              CHECK (licence_attribution IS NULL
                                     OR (length(licence_attribution) > 0
                                         AND length(licence_attribution) <= 500)),
        -- The photo index row (see the file doc). All four travel together or
        -- none does, which is what makes „a hash with no mime" unrepresentable.
        photo_file_name     TEXT
                              CHECK (photo_file_name IS NULL
                                     OR (length(photo_file_name) > 0
                                         AND length(photo_file_name) <= 255)),
        photo_mime          TEXT
                              CHECK (photo_mime IS NULL
                                     OR (length(photo_mime) > 0 AND length(photo_mime) <= 100)),
        photo_size_bytes    INTEGER CHECK (photo_size_bytes IS NULL OR photo_size_bytes > 0),
        photo_sha256        TEXT
                              CHECK (photo_sha256 IS NULL OR length(photo_sha256) = 64),
        created_at          TEXT NOT NULL,
        updated_at          TEXT NOT NULL,
        deleted_at          TEXT,
        -- An own recipe has no licence to carry and an imported one has all
        -- five; a partial attribution is the state this pair of statements
        -- exists to make unwritable.
        CHECK ((source = 'own') = (licence_id IS NULL)),
        CHECK ((licence_id IS NULL) = (licence_title IS NULL)),
        CHECK ((licence_id IS NULL) = (licence_author IS NULL)),
        CHECK ((licence_id IS NULL) = (licence_url IS NULL)),
        CHECK ((licence_id IS NULL) = (licence_attribution IS NULL)),
        CHECK ((photo_sha256 IS NULL) = (photo_mime IS NULL)),
        CHECK ((photo_sha256 IS NULL) = (photo_size_bytes IS NULL)),
        CHECK ((photo_sha256 IS NULL) = (photo_file_name IS NULL))
      );

      -- The only recipe read there is: "this profile's live recipes, by title".
      CREATE INDEX cookbook_recipes_profile_active
        ON cookbook_recipes (profile_id, title, id)
        WHERE deleted_at IS NULL;

      -- The blob store's reverse lookup, deliberately NOT partial: a
      -- soft-deleted recipe still references its photo's bytes.
      CREATE INDEX cookbook_recipes_photo ON cookbook_recipes (photo_sha256);

      CREATE TABLE cookbook_ingredients (
        id              TEXT PRIMARY KEY,
        recipe_id       TEXT NOT NULL REFERENCES cookbook_recipes(id) ON DELETE CASCADE,
        -- An index into the recipe's own array, derived from the array's order
        -- and never sent by a caller (see the file doc).
        position        INTEGER NOT NULL
                          CHECK (typeof(position) = 'integer' AND position >= 0),
        group_heading   TEXT
                          CHECK (group_heading IS NULL
                                 OR (length(group_heading) > 0 AND length(group_heading) <= 60)),
        -- The line as the author wrote it. Empty for a row that arrived
        -- structured (a pack, an archive written before this column existed).
        raw_text        TEXT NOT NULL DEFAULT '' CHECK (length(raw_text) <= 500),
        quantity        REAL CHECK (quantity IS NULL OR quantity > 0),
        quantity_max    REAL CHECK (quantity_max IS NULL OR quantity_max > 0),
        -- The unit vocabulary is @nexus/core's INGREDIENT_UNITS, and it is
        -- deliberately NOT closed here: the note palette's rule one module over
        -- (migration 011) is that a vocabulary which can grow belongs in the
        -- store, so growing it is a code change rather than a migration plus a
        -- code change that can disagree.
        unit            TEXT
                          CHECK (unit IS NULL OR (length(unit) > 0 AND length(unit) <= 24)),
        name            TEXT NOT NULL CHECK (length(name) > 0 AND length(name) <= 120),
        preparation     TEXT
                          CHECK (preparation IS NULL
                                 OR (length(preparation) > 0 AND length(preparation) <= 120)),
        food_ref        TEXT CHECK (food_ref IS NULL OR length(food_ref) <= 80),
        grams_per_unit  REAL CHECK (grams_per_unit IS NULL OR grams_per_unit > 0),
        created_at      TEXT NOT NULL,
        updated_at      TEXT NOT NULL,
        -- „2–3" is a range; „kašika" is an amount nobody stated, and an upper
        -- end on it would turn 0–3 into a range whose lower end is a real zero.
        CHECK (quantity_max IS NULL OR quantity IS NOT NULL),
        CHECK (quantity_max IS NULL OR quantity_max >= quantity),
        -- A weight of one unit with nothing to weigh into is a number no reader
        -- would ever use, the „unit without target" refusal one module over
        -- (migration 055).
        CHECK (grams_per_unit IS NULL OR food_ref IS NOT NULL)
      );

      -- Both child reads: one recipe's lines, in their stored order.
      CREATE INDEX cookbook_ingredients_recipe
        ON cookbook_ingredients (recipe_id, position);

      CREATE TABLE cookbook_steps (
        id            TEXT PRIMARY KEY,
        recipe_id     TEXT NOT NULL REFERENCES cookbook_recipes(id) ON DELETE CASCADE,
        position      INTEGER NOT NULL
                        CHECK (typeof(position) = 'integer' AND position >= 0),
        text          TEXT NOT NULL CHECK (length(text) > 0 AND length(text) <= 2000),
        -- Whole minutes, and bounded at a day: „staviti u rernu 30 minuta" is a
        -- timer, and a timer nobody will ever watch for longer than a day is a
        -- number somebody typed into the wrong field.
        timer_minutes INTEGER
                        CHECK (timer_minutes IS NULL
                               OR (typeof(timer_minutes) = 'integer' AND timer_minutes > 0
                                   AND timer_minutes <= 1440)),
        created_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL
      );

      CREATE INDEX cookbook_steps_recipe ON cookbook_steps (recipe_id, position);

      -- The module's one preference. No row means the store's own default
      -- ("metric"), so a profile that never opened the settings card reads one.
      CREATE TABLE cookbook_settings (
        profile_id    TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
        unit_system   TEXT NOT NULL CHECK (unit_system IN ('metric', 'kitchen')),
        updated_at    TEXT NOT NULL
      );

      -- The user's own ingredient-name -> food link, remembered per NAME (see
      -- the file doc). Keyed by the folded name so „Mleveno meso" and „mleveno
      -- meso" are one answer; the display spelling the user first used is kept
      -- beside it.
      CREATE TABLE cookbook_food_matches (
        profile_id      TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        name_key        TEXT NOT NULL CHECK (length(name_key) > 0 AND length(name_key) <= 120),
        name            TEXT NOT NULL CHECK (length(name) > 0 AND length(name) <= 120),
        food_ref        TEXT NOT NULL CHECK (length(food_ref) > 0 AND length(food_ref) <= 80),
        food_name       TEXT NOT NULL CHECK (length(food_name) > 0 AND length(food_name) <= 120),
        grams_per_unit  REAL CHECK (grams_per_unit IS NULL
                                    OR (grams_per_unit > 0 AND grams_per_unit <= 10000)),
        created_at      TEXT NOT NULL,
        updated_at      TEXT NOT NULL,
        PRIMARY KEY (profile_id, name_key)
      );
    `);
  },
};
