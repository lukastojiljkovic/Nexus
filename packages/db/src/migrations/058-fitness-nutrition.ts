import type { Migration } from "./migrations.js";

/**
 * The FIT module's nutrition storage (FIT slice a). Three tables, and — as with
 * migration 055 — every decision the module turns on is written into the schema
 * rather than left to a store to remember.
 *
 * **There is NO table for the catalogue, and that is the module's first
 * decision.** Several hundred Serbian and generic foods with sourced values ship
 * INSIDE the app, as JSON in `@nexus/core` (`fitness/data/catalogue.json`).
 * Seeding them here would put app data where user data lives: every profile
 * would carry an identical copy, every export archive would ship it, and a
 * restore would faithfully reproduce the app's own dataset as though somebody
 * had typed it. „Datoteke" already refused the same temptation one module over —
 * `attachmentIndexStore.ts` reads across three tables rather than materialising
 * a fourth. `fit_foods` below is therefore ONLY what the user added themselves,
 * which is a designed part of the product rather than a gap in the catalogue.
 *
 * **There is NO `fit_meals` table either, and that is the second.** A meal is a
 * `(meal_date, slot)` GROUPING of items, not a row. A container table would buy
 * nothing and cost an empty-meal state: a „ručak" with no items is invisible on
 * every screen, so nothing could show it, nobody could delete it, and the app
 * would accumulate rows whose only effect is to be swept up by a job somebody
 * has to write. The grouping is free; the container is not.
 *
 * **A logged item SNAPSHOTS the seven per-100 g values it was logged with**, and
 * this is the third. The catalogue ships with the app, so its values change when
 * the app updates — a log that silently rewrote yesterday's calories on an
 * upgrade would be a lying log, and the streak-like thing a food diary is FOR is
 * exactly the history it would be rewriting. The snapshot also makes the
 * database independent of `@nexus/core`'s dataset: the caller resolves a food and
 * hands the store the numbers, so nothing here ever reads app-shipped data.
 *
 * `food_ref` is text with NO foreign key, deliberately, and it is what makes the
 * snapshot complete rather than merely defensive. It carries `catalogue:<id>`
 * or `user:<uuid>` — the first names a row that is not a row at all (see above),
 * and the second may be SOFT-DELETED while the log stays true, because a meal
 * eaten is a fact about a day rather than a reference into a food list. `label`
 * is NOT NULL beside it for the same reason: the item must be readable with no
 * food to resolve at all.
 *
 * Values are REAL here, unlike HABIT's integers (migration 055) — and the
 * contrast is worth stating, since the FIN lesson about `typeof(x) = 'integer'`
 * is one table over. „Pola čaše" is not a thing a habit records; 87.5 g of
 * pileće belo meso is exactly what a food diary records, and 0.72 g of
 * carbohydrate per 100 g is what the source publishes. So the CHECKs here bound
 * the SIGN rather than the type: every nutrient is `>= 0`, and `grams` is
 * strictly `> 0` because an item weighing nothing is the absence of an item.
 *
 * `fit_targets` is one row per profile with FOUR NULLABLE goals, the
 * `calendar_settings` arrangement (migration 042): a user who has set only a
 * calorie goal has three nulls, and NULL is „no goal" while 0 would be „a goal
 * of zero" — different claims, and the schema keeps them apart so the store and
 * the page cannot quietly conflate them.
 *
 * **Plain `CREATE TABLE`, and neither of the first two tables is a referenced
 * parent.** `fit_meal_items` points at `fit_foods` only through `food_ref` text,
 * which is not a foreign key — so ADR-042's rebuild hazard (a `DROP TABLE`'s
 * implicit DELETE firing every `ON DELETE` action, with `PRAGMA foreign_keys` a
 * no-op inside the migration transaction) does not arise for either. A later
 * column on any of the three may still land by `ALTER TABLE … ADD COLUMN`, which
 * is the cheaper move regardless.
 *
 * **Two indexes, both earned.** `fit_foods_profile_active` covers the only food
 * read there is — „this profile's live foods, by name" — the shape
 * `habits_profile_active` already has. `fit_meal_items_profile_day` covers BOTH
 * meal reads: one day's items, and a range's, since a range is a `meal_date`
 * scan behind the same profile prefix. No index on `slot`: no read ever asks for
 * „every ručak" without a day or a range in hand, and the grouping by slot
 * happens over rows a day has already narrowed to a handful.
 */
export const migration058: Migration = {
  version: 58,
  up(db) {
    db.exec(`
      CREATE TABLE fit_foods (
        id            TEXT PRIMARY KEY,
        profile_id    TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        name          TEXT NOT NULL CHECK (length(name) > 0 AND length(name) <= 80),
        category      TEXT NOT NULL CHECK (length(category) > 0),
        kcal          REAL NOT NULL CHECK (kcal >= 0),
        protein       REAL NOT NULL CHECK (protein >= 0),
        carbs         REAL NOT NULL CHECK (carbs >= 0),
        fat           REAL NOT NULL CHECK (fat >= 0),
        fiber         REAL NOT NULL CHECK (fiber >= 0),
        sugar         REAL NOT NULL CHECK (sugar >= 0),
        sodium_mg     REAL NOT NULL CHECK (sodium_mg >= 0),
        -- The household measures, as the catalogue's own JSON spells them:
        -- [{"label":"1 kašika","grams":13.5}]. A column rather than a table
        -- because nothing ever queries a serving — it is read with its food and
        -- written with its food, which is what a JSON column is for.
        servings_json TEXT NOT NULL,
        notes         TEXT NOT NULL,
        created_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL,
        deleted_at    TEXT
      );

      -- The only food read there is: "this profile's live foods, by name".
      CREATE INDEX fit_foods_profile_active
        ON fit_foods (profile_id, name, id)
        WHERE deleted_at IS NULL;

      CREATE TABLE fit_meal_items (
        id         TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        meal_date  TEXT NOT NULL,
        -- The five slots a Serbian day is eaten in, closed here rather than in a
        -- store: the page draws one section per slot, so a sixth value would be
        -- a row with nowhere to be shown.
        slot       TEXT NOT NULL
                     CHECK (slot IN ('dorucak', 'uzina1', 'rucak', 'uzina2', 'vecera')),
        -- 'catalogue:<id>' or 'user:<uuid>'. No foreign key, by design — see the
        -- file doc: the first names app-shipped data that is not a table, and
        -- the second may be soft-deleted while this row stays true.
        food_ref   TEXT NOT NULL CHECK (length(food_ref) > 0),
        -- The food's name AT THE MOMENT IT WAS LOGGED, so the item reads
        -- correctly with nothing to resolve food_ref against.
        label      TEXT NOT NULL CHECK (length(label) > 0),
        grams      REAL NOT NULL CHECK (grams > 0),
        -- The snapshot: what 100 g of that food carried when this was logged.
        kcal       REAL NOT NULL CHECK (kcal >= 0),
        protein    REAL NOT NULL CHECK (protein >= 0),
        carbs      REAL NOT NULL CHECK (carbs >= 0),
        fat        REAL NOT NULL CHECK (fat >= 0),
        fiber      REAL NOT NULL CHECK (fiber >= 0),
        sugar      REAL NOT NULL CHECK (sugar >= 0),
        sodium_mg  REAL NOT NULL CHECK (sodium_mg >= 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
      );

      -- Both meal reads at once: one day's items, and a range's — a range is the
      -- same profile prefix with a wider span on the second column. created_at
      -- rather than id decides the order within a day: uuidv7 puts a MILLISECOND
      -- timestamp in its high bits and CSPRNG bytes below it, so two items
      -- logged inside the same millisecond sort randomly against each other,
      -- while created_at is the instant the caller actually stamped. id still
      -- closes the index, which is what makes the order TOTAL when two rows
      -- share an instant.
      CREATE INDEX fit_meal_items_profile_day
        ON fit_meal_items (profile_id, meal_date, created_at, id)
        WHERE deleted_at IS NULL;

      CREATE TABLE fit_targets (
        profile_id TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
        -- All four nullable and independent: a user may set only a calorie goal,
        -- and NULL is "no goal" while 0 would be "a goal of zero". The two are
        -- different claims and nothing here collapses them.
        kcal       REAL CHECK (kcal IS NULL OR kcal >= 0),
        protein_g  REAL CHECK (protein_g IS NULL OR protein_g >= 0),
        carbs_g    REAL CHECK (carbs_g IS NULL OR carbs_g >= 0),
        fat_g      REAL CHECK (fat_g IS NULL OR fat_g >= 0),
        updated_at TEXT NOT NULL
      );
    `);
  },
};
