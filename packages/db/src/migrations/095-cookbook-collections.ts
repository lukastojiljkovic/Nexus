import type { Migration } from "./migrations.js";

/**
 * Migration 95 — the COOKBOOK's collections: a shelf a recipe may sit on, and
 * the join that puts it there.
 *
 * **The question the tables answer.** A recipe lands on one flat list today, so
 * a preserving set shipped by a content pack has nowhere to go and the user's own
 * recipes have no way to be grouped by anything but a tag. A collection is a
 * NAMED SHELF that belongs to the profile, and a recipe may be on several at
 * once — which is why the membership is its own table rather than a column on
 * `cookbook_recipes`: one column can hold one shelf, and tags are the wrong
 * answer because a tag is a word the recipe carries rather than a thing the user
 * made, renamed and deleted.
 *
 * **`source_pack` is what makes a seeded shelf a one-off, and it is UNIQUE per
 * profile.** Content packs are installed whole but their recipes are copied one
 * at a time (`savePackRecipe`), so a pack's own collection has to be found by
 * every later copy of that pack's recipes rather than created again. The id of
 * the pack that seeded the shelf is stored on the row, and the partial unique
 * index below makes a second one unwritable — the same arrangement
 * `library_collections.suggested_id` (migration 072) uses for an adopted list,
 * with the pack id in place of a list id. It is partial on `source_pack IS NOT
 * NULL` because a user may perfectly well make two shelves of their own with the
 * same name; only a pack's own shelf is a thing there can be exactly one of.
 *
 * **Deleting a collection takes the membership and nothing else.** Both child
 * foreign keys CASCADE and neither of them points at the recipes: the membership
 * row goes when its collection goes, and `cookbook_recipes` is untouched — which
 * is the whole of the brief's „it removes only the shelf, never the recipes",
 * stated as a property of the schema rather than as a promise a store keeps.
 * `cookbook_collection_recipes` therefore reaches a profile through BOTH parents
 * and carries no `profile_id` of its own (migration 076's child arrangement), so
 * every read and every write resolves one of them in this profile first.
 *
 * **A soft-deleted recipe keeps its place.** `cookbook_recipes` is soft-deleted
 * (migration 076) and the membership is deliberately NOT, so restoring a recipe
 * returns it to the shelves it was on. The store filters membership reads by
 * `deleted_at IS NULL` instead, exactly as every other cooked read does.
 *
 * **No archive fields, and that is a sequencing statement with an expiry date.**
 * `CookbookExport` carries the recipes, the module's one preference and the
 * remembered ingredient links; it does not carry collections yet, and a restore
 * that replaces a profile whole would therefore drop them. Collections are added
 * to `exportData`/`importData` on the day the archive format moves, and until
 * then this is written down here rather than discovered by the first user who
 * restores a backup. The comment is a reason to keep the pair together, not an
 * exemption invented here.
 *
 * **No journal triggers**, for migration 076's own reason: sync is on hold
 * permanently and these tables declare nothing to the change journal.
 *
 * **Plain `CREATE TABLE`, and `cookbook_recipes` is already a referenced parent**
 * (migration 076's child tables), so ADR-042's hazard applies to it as it does
 * there: a later column on `cookbook_recipes` lands by `ALTER TABLE … ADD COLUMN`
 * and never by a table rebuild.
 */
export const migration095: Migration = {
  version: 95,
  up(db) {
    db.exec(`
      CREATE TABLE cookbook_collections (
        id            TEXT PRIMARY KEY,
        profile_id    TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        name          TEXT NOT NULL
                        CHECK (length(name) > 0 AND length(name) <= 60),
        -- The pack whose recipes seeded this shelf, or NULL for one the user
        -- made. The grammar is the pack id's own (PACK_LIMITS.idLength), so a
        -- row can only hold the id of a pack this build could have installed.
        source_pack   TEXT
                        CHECK (source_pack IS NULL
                               OR (length(source_pack) > 0 AND length(source_pack) <= 64)),
        created_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL
      );

      -- The shelf read is "this profile's collections, by name", the shape
      -- cookbook_recipes_profile_active has one table over.
      CREATE INDEX cookbook_collections_profile
        ON cookbook_collections (profile_id, name, id);

      -- One shelf per pack per profile, which is what makes a second copy of a
      -- pack's recipes find the first shelf rather than make another.
      CREATE UNIQUE INDEX cookbook_collections_source_pack
        ON cookbook_collections (profile_id, source_pack)
        WHERE source_pack IS NOT NULL;

      CREATE TABLE cookbook_collection_recipes (
        collection_id TEXT NOT NULL REFERENCES cookbook_collections(id) ON DELETE CASCADE,
        recipe_id     TEXT NOT NULL REFERENCES cookbook_recipes(id) ON DELETE CASCADE,
        created_at    TEXT NOT NULL,
        -- The pair IS the membership: a recipe on a shelf twice is not a state
        -- this module has a meaning for.
        PRIMARY KEY (collection_id, recipe_id)
      );

      -- The recipe's own shelves, which is the read the recipe's detail makes.
      CREATE INDEX cookbook_collection_recipes_recipe
        ON cookbook_collection_recipes (recipe_id, collection_id);
    `);
  },
};
