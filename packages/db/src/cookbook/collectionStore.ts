import type Database from "better-sqlite3-multiple-ciphers";
import { MAX_COLLECTION_NAME_LENGTH } from "@nexus/core";
import type { CookbookCollection } from "@nexus/core";
import { RecipeNotFoundError } from "../errors.js";
import { uuidv7 } from "../ids.js";
import { validateNow, validateText } from "./recipeStore.js";

type DatabaseHandle = Database.Database;

/** Serbian Latin ordering, the app's one collator spelling, as `RecipeStore` uses it. */
const COLLATOR = new Intl.Collator(["sr-Latn", "sr"]);

/** A shelf as the page reads it: the collection, and the ids of the live recipes on it. */
export interface CollectionWithRecipes extends CookbookCollection {
  readonly recipeIds: readonly string[];
}

interface CollectionRow {
  id: string;
  profile_id: string;
  name: string;
  source_pack: string | null;
  created_at: string;
  updated_at: string;
}

const COLLECTION_COLUMNS = "id, profile_id, name, source_pack, created_at, updated_at";

function toCollection(row: CollectionRow): CookbookCollection {
  return {
    id: row.id,
    profileId: row.profile_id,
    name: row.name,
    sourcePack: row.source_pack,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * The profile's collections (migration 095): named shelves a recipe may sit on,
 * over prepared, parameterized statements like `RecipeStore`, which it sits
 * beside. Construct one per profile and reuse it.
 *
 * **Every collection statement is scoped by `profile_id`, and the membership
 * table is scoped through BOTH parents.** `cookbook_collection_recipes` carries
 * no profile of its own, so a membership write first resolves its shelf and its
 * recipe in THIS profile, and a membership read joins both.
 *
 * **Deleting a shelf removes its memberships and nothing else.** The foreign keys
 * do that; `remove` states it in the method name rather than in a caller's care.
 */
export class CollectionStore {
  private readonly insertCollection: Database.Statement;
  private readonly selectCollections: Database.Statement;
  private readonly selectCollectionById: Database.Statement;
  private readonly selectSeededCollection: Database.Statement;
  private readonly renameCollection: Database.Statement;
  private readonly deleteCollection: Database.Statement;
  private readonly findLiveRecipe: Database.Statement;
  private readonly insertMembership: Database.Statement;
  private readonly deleteMembership: Database.Statement;
  private readonly selectMemberships: Database.Statement;

  constructor(
    private readonly db: DatabaseHandle,
    private readonly profileId: string,
  ) {
    this.insertCollection = db.prepare(
      `INSERT INTO cookbook_collections (id, profile_id, name, source_pack, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    this.selectCollections = db.prepare(
      `SELECT ${COLLECTION_COLUMNS} FROM cookbook_collections WHERE profile_id = ?`,
    );
    this.selectCollectionById = db.prepare(
      `SELECT ${COLLECTION_COLUMNS} FROM cookbook_collections WHERE id = ? AND profile_id = ?`,
    );
    this.selectSeededCollection = db.prepare(
      `SELECT ${COLLECTION_COLUMNS} FROM cookbook_collections
        WHERE profile_id = ? AND source_pack = ?`,
    );
    this.renameCollection = db.prepare(
      `UPDATE cookbook_collections SET name = ?, updated_at = ?
        WHERE id = ? AND profile_id = ?`,
    );
    this.deleteCollection = db.prepare(
      `DELETE FROM cookbook_collections WHERE id = ? AND profile_id = ?`,
    );
    this.findLiveRecipe = db.prepare(
      `SELECT 1 AS present FROM cookbook_recipes
        WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    // `OR IGNORE` because the pair IS the membership: putting a recipe on a shelf
    // it is already on changes nothing, and is not an error the page should see.
    this.insertMembership = db.prepare(
      `INSERT OR IGNORE INTO cookbook_collection_recipes (collection_id, recipe_id, created_at)
       VALUES (?, ?, ?)`,
    );
    this.deleteMembership = db.prepare(
      `DELETE FROM cookbook_collection_recipes WHERE collection_id = ? AND recipe_id = ?`,
    );
    // A soft-deleted recipe keeps its shelves (migration 095), so the read filters
    // the recipe's liveness here rather than the membership's existence.
    this.selectMemberships = db.prepare(
      `SELECT m.collection_id AS collection_id, m.recipe_id AS recipe_id
         FROM cookbook_collection_recipes m
         JOIN cookbook_collections c ON c.id = m.collection_id
         JOIN cookbook_recipes r ON r.id = m.recipe_id
        WHERE c.profile_id = ? AND r.profile_id = ? AND r.deleted_at IS NULL
        ORDER BY m.collection_id, m.recipe_id`,
    );
  }

  /** This profile's collections, by name, each with the ids of its live recipes. */
  list(): CollectionWithRecipes[] {
    const rows = this.selectCollections.all(this.profileId) as CollectionRow[];
    const members = new Map<string, string[]>();
    for (const row of this.selectMemberships.all(this.profileId, this.profileId) as {
      collection_id: string;
      recipe_id: string;
    }[]) {
      members.set(row.collection_id, [...(members.get(row.collection_id) ?? []), row.recipe_id]);
    }
    return rows
      .map((row) => ({ ...toCollection(row), recipeIds: members.get(row.id) ?? [] }))
      .sort(
        (left, right) =>
          COLLATOR.compare(left.name, right.name) || left.id.localeCompare(right.id),
      );
  }

  /** Makes a shelf the user asked for. Two shelves may share a name; that is the user's call. */
  create(name: string, now: string): CookbookCollection {
    const validNow = validateNow(now);
    const id = uuidv7();
    this.insertCollection.run(id, this.profileId, validateName(name), null, validNow, validNow);
    return this.requireCollection(id);
  }

  /**
   * Makes the shelf a content pack asked for, or returns the one it already has.
   *
   * Called once per copied pack recipe, so the lookup on `source_pack` is what
   * stops a second copy, or a re-install of the same pack, from making a second
   * shelf. The pack's name is only used by the call that creates the row: after
   * that the shelf is the user's, and a rename sticks.
   */
  seed(sourcePack: string, name: string, now: string): CookbookCollection {
    const existing = this.selectSeededCollection.get(this.profileId, sourcePack) as
      | CollectionRow
      | undefined;
    if (existing !== undefined) return toCollection(existing);
    const validNow = validateNow(now);
    const id = uuidv7();
    this.insertCollection.run(
      id,
      this.profileId,
      validateName(name),
      sourcePack,
      validNow,
      validNow,
    );
    return this.requireCollection(id);
  }

  /** Renames a shelf in this profile. */
  rename(id: string, name: string, now: string): CookbookCollection {
    const validNow = validateNow(now);
    const { changes } = this.renameCollection.run(
      validateName(name),
      validNow,
      id,
      this.profileId,
    );
    if (changes === 0) throw notFound(id);
    return this.requireCollection(id);
  }

  /** Deletes a shelf and the memberships it held. The recipes on it are untouched. */
  remove(id: string): void {
    const { changes } = this.deleteCollection.run(id, this.profileId);
    if (changes === 0) throw notFound(id);
  }

  /** Puts a live recipe on a shelf, or takes it off. Both ends must be in this profile. */
  setMember(collectionId: string, recipeId: string, member: boolean, now: string): void {
    const validNow = validateNow(now);
    this.requireCollection(collectionId);
    if (this.findLiveRecipe.get(recipeId, this.profileId) === undefined) {
      throw new RecipeNotFoundError(`No live recipe "${recipeId}" in this profile.`);
    }
    if (member) {
      this.insertMembership.run(collectionId, recipeId, validNow);
    } else {
      this.deleteMembership.run(collectionId, recipeId);
    }
  }

  private requireCollection(id: string): CookbookCollection {
    const row = this.selectCollectionById.get(id, this.profileId) as CollectionRow | undefined;
    if (row === undefined) throw notFound(id);
    return toCollection(row);
  }
}

function validateName(name: string): string {
  return validateText(name, "name", MAX_COLLECTION_NAME_LENGTH);
}

function notFound(id: string): RecipeNotFoundError {
  return new RecipeNotFoundError(`No collection "${id}" in this profile.`);
}
