import type Database from "better-sqlite3-multiple-ciphers";
import { isBuiltinNoteTemplateId } from "@nexus/core";
import {
  NoteCategoryNotFoundError,
  NoteCategoryValidationError,
  NoteFolderNotFoundError,
  NoteFolderValidationError,
  NoteNotFoundError,
  NoteTagNotFoundError,
  NoteTagValidationError,
} from "../errors.js";
import { uuidv7 } from "../ids.js";

type DatabaseHandle = Database.Database;

/** Closed folder-colour domain; the UI maps each key onto a design token (NOTE organization). */
export type NoteFolderColor =
  | "zlato"
  | "bronza"
  | "maslina"
  | "suma"
  | "zad"
  | "ruza"
  | "bordo"
  | "grafit";

/**
 * Closed per-folder view domain (migration 039's CHECK) — the two shapes the
 * note list pane can draw, in toggle order.
 *
 * Deliberately NARROWER than `TASK_LIST_VIEWS`: a board needs a select field to
 * make columns from and a calendar needs a date to place rows on, and a note
 * carries neither — its only dates are `createdAt`/`updatedAt`, which are when
 * it was touched, not when it is due. Two shapes that both work beat four of
 * which two would be empty.
 */
export const NOTE_FOLDER_VIEWS = ["list", "cards"] as const;
export type NoteFolderView = (typeof NOTE_FOLDER_VIEWS)[number];

/** Folder colours in the order the UI offers them (NOTE organization). */
export const NOTE_FOLDER_COLORS: readonly NoteFolderColor[] = [
  "zlato",
  "bronza",
  "maslina",
  "suma",
  "zad",
  "ruza",
  "bordo",
  "grafit",
];

/** A note folder as the store returns it: camelCase keys, `parentId` null at the root. */
export interface NoteFolder {
  id: string;
  profileId: string;
  parentId: string | null;
  name: string;
  color: NoteFolderColor | null;
  /**
   * The template a note created in this folder opens with (ADR-036), or null.
   * A built-in template's constant id or a `note_templates` row's id —
   * validated against the union of the two at SET time, never re-checked on
   * read, so a template deleted since leaves a DANGLING id here on purpose (see
   * `setDefaultTemplate`).
   */
  defaultTemplateId: string | null;
  /** Whether a context-free "Nova beleška" files into this folder. At most one folder per profile carries it. */
  isCaptureDefault: boolean;
  /** The shape the note list opens in while this folder is selected (NOTE-002, migration 039). `"list"` for every folder that predates the feature. */
  defaultView: NoteFolderView;
  createdAt: string;
  updatedAt: string;
}

/** A note tag as the store returns it — a per-profile label, unique by (profile, name). */
export interface NoteTag {
  id: string;
  profileId: string;
  name: string;
  createdAt: string;
}

/** One note-tag attachment. */
export interface NoteTagLink {
  noteId: string;
  tagId: string;
}

/**
 * A note category as the store returns it (NOTE-002, migration 049) — a
 * per-profile row, unique by name, FLAT: it has no `parentId`, and never will.
 *
 * `color` is the SAME closed domain a folder's is (`NoteFolderColor`), reused
 * rather than respelled: the app has exactly one swatch palette, and a second
 * eight-value list of the same eight values is a list that can drift.
 */
export interface NoteCategory {
  id: string;
  profileId: string;
  name: string;
  color: NoteFolderColor | null;
  createdAt: string;
  updatedAt: string;
}

interface NoteFolderRow {
  id: string;
  profile_id: string;
  parent_id: string | null;
  name: string;
  color: string | null;
  default_template_id: string | null;
  is_capture_default: number;
  default_view: string;
  created_at: string;
  updated_at: string;
}

interface NoteTagRow {
  id: string;
  profile_id: string;
  name: string;
  created_at: string;
}

interface NoteTagLinkRow {
  note_id: string;
  tag_id: string;
}

interface NoteCategoryRow {
  id: string;
  profile_id: string;
  name: string;
  color: string | null;
  created_at: string;
  updated_at: string;
}

const FOLDER_COLUMNS =
  "id, profile_id, parent_id, name, color, default_template_id, is_capture_default, " +
  "default_view, created_at, updated_at";
const TAG_COLUMNS = "id, profile_id, name, created_at";
const CATEGORY_COLUMNS = "id, profile_id, name, color, created_at, updated_at";

const MAX_FOLDER_NAME_LENGTH = 100;
const MAX_TAG_NAME_LENGTH = 50;
/**
 * A category names a KIND — „sastanak", „dnevnik", „recept" — so it is a short
 * word, and it is drawn as a chip on a note row rather than as a heading. The
 * tag cap, not the folder's 100: the two rows that carry a unique per-profile
 * name are the two that are chips.
 */
const MAX_CATEGORY_NAME_LENGTH = 50;

/** Accepts a full ISO-8601 date-time (the `now` every mutating method takes) — mirrors noteStore.ts. */
const ISO_8601_DATETIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})?$/;

/**
 * Persistence for the NOTE module's organization layer (ADR-012 / NOTE-002):
 * nested folders, per-profile tags, the note-tag many-to-many join, and flat
 * per-profile categories. Mirrors
 * `NoteStore`: construct one per profile, reuse it, over prepared, parameterized
 * statements (SEC-API-03), every value bound, never interpolated. Inputs are
 * revalidated here because the renderer is untrusted (SEC-EL-02), and every
 * statement is scoped by `profile_id` — child rows (a note's tag links, a
 * folder's children) are reached through their already-scoped parent, so one
 * profile's organization is invisible to a store scoped to another.
 *
 * **The three axes, and why they are three.** NOTE-002 names folders, tags and
 * a category, and they only earn their keep while they stay distinguishable:
 *
 * - a **folder** is WHERE a note lives — exactly one per note, hierarchical, a
 *   place. `note_folders` + `notes.folder_id`.
 * - a **tag** is WHAT A NOTE IS ABOUT — many per note, flat, a subject.
 *   `note_tags` + the `note_tag_links` join.
 * - a **category** is WHAT KIND OF THING the note is — exactly one per note,
 *   optional, flat: sastanak, ideja, dnevnik, recept. It is the note's TYPE,
 *   not its topic and not its location. `note_categories` + `notes.category_id`.
 *
 * That last definition is written down here because the pressure is always to
 * "simplify" a category into a tag, and the answer is that a note has exactly
 * one kind and arbitrarily many subjects — a cardinality difference, not a
 * naming one. The pressure in the other direction is to give categories a
 * `parent_id`, and the answer is that a hierarchy of places is a folder tree
 * and the module already has one. Neither table is the other one spelled
 * differently, and the moment either becomes so, one of them should be deleted
 * rather than kept as a synonym.
 *
 * `deleteFolder` promotes its children (subfolders and notes) to its own parent
 * before removing the row, rather than relying on the schema's CASCADE — the
 * schema cascades because a folder can also be deleted at the SQL level
 * directly (e.g. by a future admin tool), but the store's own delete path must
 * never silently orphan a subtree the user can still see. `createTag` is
 * get-or-create: tag names are unique per profile, and re-tagging with an
 * existing name is a normal, non-erroring path for the UI's tag input.
 *
 * A folder also carries three preferences, each with its own setter because
 * each has its own invariant: `setDefaultTemplate` (ADR-036, migration 028)
 * validates an id against a union no foreign key could express,
 * `setCaptureDefault` maintains a per-profile singleton, and `setFolderView`
 * (NOTE-002, migration 039) narrows to a closed set the schema also CHECKs.
 * None belongs in `updateFolder`'s partial-patch shape, which exists for the two
 * fields a rename/recolour form edits together.
 *
 * The category methods take `updateCategory`'s partial-patch shape from the
 * folder side and their name rule from the tag side, which is exactly where each
 * belongs: a category is renamed and recoloured by the same organizer row a
 * folder is, and its name is unique per profile the way a tag's is. The one
 * place it copies NEITHER sibling is `createCategory`, which REFUSES a taken
 * name rather than getting-or-creating like `createTag` — see its own comment.
 */
export class NoteOrgStore {
  private readonly insertFolder: Database.Statement;
  private readonly selectFolders: Database.Statement;
  private readonly selectFolderById: Database.Statement;
  private readonly updateFolderFields: Database.Statement;
  private readonly updateFolderParent: Database.Statement;
  private readonly updateFolderTemplate: Database.Statement;
  private readonly updateFolderView: Database.Statement;
  private readonly selectTemplateById: Database.Statement;
  private readonly clearCaptureDefault: Database.Statement;
  private readonly setCaptureDefaultRow: Database.Statement;
  private readonly selectFolderAncestor: Database.Statement;
  private readonly promoteChildFolders: Database.Statement;
  private readonly promoteNotes: Database.Statement;
  private readonly deleteFolderRow: Database.Statement;

  private readonly insertTag: Database.Statement;
  private readonly selectTags: Database.Statement;
  private readonly selectTagById: Database.Statement;
  private readonly selectTagByName: Database.Statement;
  private readonly selectTagNameCollision: Database.Statement;
  private readonly updateTagName: Database.Statement;
  private readonly deleteTagRow: Database.Statement;

  private readonly insertCategory: Database.Statement;
  private readonly selectCategories: Database.Statement;
  private readonly selectCategoryById: Database.Statement;
  private readonly selectCategoryNameCollision: Database.Statement;
  private readonly updateCategoryFields: Database.Statement;
  private readonly deleteCategoryRow: Database.Statement;

  private readonly selectActiveNoteById: Database.Statement;
  private readonly selectTagLinks: Database.Statement;
  private readonly insertTagLink: Database.Statement;
  private readonly deleteTagLink: Database.Statement;

  constructor(
    private readonly db: DatabaseHandle,
    private readonly profileId: string,
  ) {
    this.insertFolder = db.prepare(
      `INSERT INTO note_folders (id, profile_id, parent_id, name, color, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    this.selectFolders = db.prepare(
      `SELECT ${FOLDER_COLUMNS} FROM note_folders WHERE profile_id = ? ORDER BY name`,
    );
    this.selectFolderById = db.prepare(
      `SELECT ${FOLDER_COLUMNS} FROM note_folders WHERE id = ? AND profile_id = ?`,
    );
    this.updateFolderFields = db.prepare(
      `UPDATE note_folders SET name = ?, color = ?, updated_at = ?
       WHERE id = ? AND profile_id = ?`,
    );
    this.updateFolderParent = db.prepare(
      `UPDATE note_folders SET parent_id = ?, updated_at = ?
       WHERE id = ? AND profile_id = ?`,
    );
    // Walks the new parent's ancestor chain (including itself); a cycle exists
    // iff the moving folder's id shows up in that chain.
    this.selectFolderAncestor = db.prepare(
      `WITH RECURSIVE anc(fid) AS (
         SELECT ?
         UNION ALL
         SELECT f.parent_id FROM note_folders f JOIN anc ON f.id = anc.fid
         WHERE f.parent_id IS NOT NULL
       )
       SELECT 1 FROM anc WHERE fid = ?`,
    );
    this.updateFolderTemplate = db.prepare(
      `UPDATE note_folders SET default_template_id = ?, updated_at = ?
       WHERE id = ? AND profile_id = ?`,
    );
    this.updateFolderView = db.prepare(
      `UPDATE note_folders SET default_view = ?, updated_at = ?
       WHERE id = ? AND profile_id = ?`,
    );
    this.selectTemplateById = db.prepare(
      `SELECT id FROM note_templates WHERE id = ? AND profile_id = ?`,
    );
    // Scoped by profile, so clearing one profile's mark never touches another's.
    this.clearCaptureDefault = db.prepare(
      `UPDATE note_folders SET is_capture_default = 0, updated_at = ?
       WHERE profile_id = ? AND is_capture_default = 1`,
    );
    this.setCaptureDefaultRow = db.prepare(
      `UPDATE note_folders SET is_capture_default = 1, updated_at = ?
       WHERE id = ? AND profile_id = ?`,
    );
    this.promoteChildFolders = db.prepare(
      `UPDATE note_folders SET parent_id = ?, updated_at = ?
       WHERE parent_id = ? AND profile_id = ?`,
    );
    // Promotion is organizational — a note's `updated_at` is deliberately left alone.
    this.promoteNotes = db.prepare(
      `UPDATE notes SET folder_id = ? WHERE folder_id = ? AND profile_id = ?`,
    );
    this.deleteFolderRow = db.prepare(
      `DELETE FROM note_folders WHERE id = ? AND profile_id = ?`,
    );

    this.insertTag = db.prepare(
      `INSERT INTO note_tags (id, profile_id, name, created_at) VALUES (?, ?, ?, ?)`,
    );
    this.selectTags = db.prepare(
      `SELECT ${TAG_COLUMNS} FROM note_tags WHERE profile_id = ? ORDER BY name`,
    );
    this.selectTagById = db.prepare(
      `SELECT ${TAG_COLUMNS} FROM note_tags WHERE id = ? AND profile_id = ?`,
    );
    this.selectTagByName = db.prepare(
      `SELECT ${TAG_COLUMNS} FROM note_tags WHERE profile_id = ? AND name = ?`,
    );
    this.selectTagNameCollision = db.prepare(
      `SELECT id FROM note_tags WHERE profile_id = ? AND name = ? AND id != ?`,
    );
    this.updateTagName = db.prepare(
      `UPDATE note_tags SET name = ? WHERE id = ? AND profile_id = ?`,
    );
    this.deleteTagRow = db.prepare(`DELETE FROM note_tags WHERE id = ? AND profile_id = ?`);

    this.insertCategory = db.prepare(
      `INSERT INTO note_categories (id, profile_id, name, color, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    this.selectCategories = db.prepare(
      `SELECT ${CATEGORY_COLUMNS} FROM note_categories WHERE profile_id = ? ORDER BY name`,
    );
    this.selectCategoryById = db.prepare(
      `SELECT ${CATEGORY_COLUMNS} FROM note_categories WHERE id = ? AND profile_id = ?`,
    );
    // `id != ?` so a rename to the row's OWN name is not a collision. A create
    // passes an id no row can hold, which is what lets both paths share it.
    this.selectCategoryNameCollision = db.prepare(
      `SELECT id FROM note_categories WHERE profile_id = ? AND name = ? AND id != ?`,
    );
    this.updateCategoryFields = db.prepare(
      `UPDATE note_categories SET name = ?, color = ?, updated_at = ?
       WHERE id = ? AND profile_id = ?`,
    );
    // Migration 049's `ON DELETE SET NULL` uncategorizes this category's notes;
    // nothing here has to promote them, because a flat table has nowhere to
    // promote to (see the migration's own comment).
    this.deleteCategoryRow = db.prepare(
      `DELETE FROM note_categories WHERE id = ? AND profile_id = ?`,
    );

    this.selectActiveNoteById = db.prepare(
      `SELECT id FROM notes WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.selectTagLinks = db.prepare(
      `SELECT ntl.note_id, ntl.tag_id
       FROM note_tag_links ntl
       JOIN notes n ON n.id = ntl.note_id
       WHERE n.profile_id = ? AND n.deleted_at IS NULL
       ORDER BY ntl.note_id, ntl.tag_id`,
    );
    this.insertTagLink = db.prepare(
      `INSERT INTO note_tag_links (note_id, tag_id) VALUES (?, ?) ON CONFLICT DO NOTHING`,
    );
    this.deleteTagLink = db.prepare(
      `DELETE FROM note_tag_links
       WHERE note_id = ? AND tag_id = ? AND note_id IN (SELECT id FROM notes WHERE profile_id = ?)`,
    );
  }

  // ---------------------------------------------------------------------
  // Folders
  // ---------------------------------------------------------------------

  /** This profile's folders, alphabetical by name (the tree is flattened; the UI nests by `parentId`). */
  listFolders(): NoteFolder[] {
    const rows = this.selectFolders.all(this.profileId) as NoteFolderRow[];
    return rows.map(toNoteFolder);
  }

  /** Creates a folder, trimming its name and validating its colour against the closed palette. */
  createFolder(
    input: { parentId: string | null; name: string; color: NoteFolderColor | null },
    now: string,
  ): NoteFolder {
    const validNow = validateDateTime(now, "now", NoteFolderValidationError);
    const name = validateFolderName(input.name);
    const color = validateFolderColor(input.color);
    if (input.parentId !== null) {
      this.requireFolder(input.parentId);
    }

    const id = uuidv7();
    this.insertFolder.run(id, this.profileId, input.parentId, name, color, validNow, validNow);

    return {
      id,
      profileId: this.profileId,
      parentId: input.parentId,
      name,
      color,
      // Every preference is set afterwards, never at create time: a folder is
      // named before it is configured, and the capture mark in particular is a
      // per-profile singleton that a create must not silently take from another
      // folder. The view is the column's own default (migration 039) rather
      // than a value this insert writes — one declaration of "a folder opens as
      // a list", in the schema, where a restore also reads it.
      defaultTemplateId: null,
      isCaptureDefault: false,
      defaultView: "list",
      createdAt: validNow,
      updatedAt: validNow,
    };
  }

  /**
   * Applies a partial patch to a folder's own `name`/`color`. An omitted key is
   * left untouched; an explicit `color: null` clears the colour — presence is
   * checked with `in`, never `??`, so the two cases are distinguishable.
   */
  updateFolder(
    id: string,
    fields: { name?: string; color?: NoteFolderColor | null },
    now: string,
  ): void {
    const validNow = validateDateTime(now, "now", NoteFolderValidationError);
    const existing = this.requireFolder(id);

    const newName = "name" in fields ? validateFolderName(fields.name) : existing.name;
    const newColor = "color" in fields ? validateFolderColor(fields.color) : existing.color;

    this.updateFolderFields.run(newName, newColor, validNow, id, this.profileId);
  }

  /**
   * Reparents a folder, rejecting a move that would make it its own ancestor
   * (a cycle) — including moving it directly into itself.
   */
  moveFolder(id: string, newParentId: string | null, now: string): void {
    const validNow = validateDateTime(now, "now", NoteFolderValidationError);
    this.requireFolder(id);

    if (newParentId !== null) {
      this.requireFolder(newParentId);
      if (newParentId === id) {
        throw new NoteFolderValidationError("A folder cannot be moved into itself.");
      }
      const cycle = this.selectFolderAncestor.get(newParentId, id);
      if (cycle) {
        throw new NoteFolderValidationError("A folder cannot be moved into its own descendant.");
      }
    }

    this.updateFolderParent.run(newParentId, validNow, id, this.profileId);
  }

  /**
   * Points a folder at the template its new notes open with, or clears it with
   * `null` (ADR-036).
   *
   * The candidate is validated against the UNION of the two things a template
   * can be: a built-in (a code constant with no row anywhere —
   * `isBuiltinNoteTemplateId`, imported rather than respelled, so the two lists
   * cannot drift) and one of THIS profile's `note_templates` rows. That union is
   * why migration 028 declares no foreign key; the check has to live here
   * instead, and it happens exactly once, at SET time.
   *
   * Nothing re-validates the id on the way out, and nothing prunes it when a
   * template is deleted. A dangling id is therefore normal and deliberate: the
   * apply path reads it as "no template", because a folder that refused to
   * create a note — over a preference — would be a far worse failure than one
   * that quietly creates a blank one.
   */
  setDefaultTemplate(folderId: string, templateId: string | null, now: string): void {
    const validNow = validateDateTime(now, "now", NoteFolderValidationError);
    this.requireFolder(folderId);

    if (templateId !== null) {
      const known =
        isBuiltinNoteTemplateId(templateId) ||
        this.selectTemplateById.get(templateId, this.profileId) !== undefined;
      if (!known) {
        throw new NoteFolderValidationError(
          `"${templateId}" is neither a built-in template nor a template in this profile.`,
        );
      }
    }

    this.updateFolderTemplate.run(templateId, validNow, folderId, this.profileId);
  }

  /**
   * Moves this profile's quick-capture mark onto one folder, or clears it
   * entirely with `null` (ADR-036).
   *
   * The mark is a per-profile singleton, so the clear and the set are one
   * transaction — and in that order, because migration 028's partial unique
   * index would reject a second claimant if the set ran first. Re-marking the
   * folder that already holds it is therefore idempotent rather than a
   * constraint violation: its own row is cleared and set again.
   */
  setCaptureDefault(folderId: string | null, now: string): void {
    const validNow = validateDateTime(now, "now", NoteFolderValidationError);
    if (folderId !== null) this.requireFolder(folderId);

    this.db.transaction(() => {
      this.clearCaptureDefault.run(validNow, this.profileId);
      if (folderId !== null) this.setCaptureDefaultRow.run(validNow, folderId, this.profileId);
    })();
  }

  /**
   * Sets the shape the note list opens in while this folder is selected
   * (NOTE-002, migration 039) — `"list"` rows or a `"cards"` grid.
   *
   * A folder's view is PROFILE content, not a device setting: it travels with
   * the folder through an export and a restore, because the answer ("this is a
   * folder of recipes, show me cards") is a property of what is filed there, not
   * of the machine reading it. The root — "Sve beleške" and "Bez fascikle", the
   * two selections with no row — is the deliberate exception and lives in
   * `notePrefs.ts` beside the other note device preferences; it has no row to
   * hang a column on, and adding a table for one enum about a place in the UI
   * would be schema for something the profile does not contain.
   *
   * The set is checked here as well as by the schema's CHECK: a caller gets a
   * named `NoteFolderValidationError` naming the field, rather than a raw SQLite
   * constraint failure surfacing from inside a transaction.
   */
  setFolderView(folderId: string, view: NoteFolderView, now: string): void {
    const validNow = validateDateTime(now, "now", NoteFolderValidationError);
    const validView = validateFolderView(view);
    this.requireFolder(folderId);

    this.updateFolderView.run(validView, validNow, folderId, this.profileId);
  }

  /**
   * Deletes a folder, first promoting its child folders and its notes to its
   * own parent (one transaction) — so a delete never loses a subtree to the
   * schema's CASCADE/SET NULL. Promotion is organizational: notes keep their
   * `updated_at`.
   */
  deleteFolder(id: string, now: string): void {
    const validNow = validateDateTime(now, "now", NoteFolderValidationError);
    const existing = this.requireFolder(id);
    const parentId = existing.parent_id;

    this.db.transaction(() => {
      this.promoteChildFolders.run(parentId, validNow, id, this.profileId);
      this.promoteNotes.run(parentId, id, this.profileId);
      this.deleteFolderRow.run(id, this.profileId);
    })();
  }

  // ---------------------------------------------------------------------
  // Tags
  // ---------------------------------------------------------------------

  /** This profile's tags, alphabetical by name. */
  listTags(): NoteTag[] {
    const rows = this.selectTags.all(this.profileId) as NoteTagRow[];
    return rows.map(toNoteTag);
  }

  /** Get-or-create by trimmed name: an existing tag with the same name is returned, never duplicated. */
  createTag(name: string, now: string): NoteTag {
    const validNow = validateDateTime(now, "now", NoteTagValidationError);
    const trimmed = validateTagName(name);

    const existing = this.selectTagByName.get(this.profileId, trimmed) as NoteTagRow | undefined;
    if (existing) {
      return toNoteTag(existing);
    }

    const id = uuidv7();
    this.insertTag.run(id, this.profileId, trimmed, validNow);
    return { id, profileId: this.profileId, name: trimmed, createdAt: validNow };
  }

  /** Renames a tag; renaming to its own current name is a no-op, not a collision. */
  renameTag(id: string, name: string): void {
    const trimmed = validateTagName(name);
    this.requireTag(id);

    const collision = this.selectTagNameCollision.get(this.profileId, trimmed, id);
    if (collision) {
      throw new NoteTagValidationError(`A tag named "${trimmed}" already exists in this profile.`);
    }

    this.updateTagName.run(trimmed, id, this.profileId);
  }

  /** Deletes a tag; its links are pruned by the schema's CASCADE. */
  deleteTag(id: string): void {
    this.requireTag(id);
    this.deleteTagRow.run(id, this.profileId);
  }

  // ---------------------------------------------------------------------
  // Categories (NOTE-002 / migration 049)
  // ---------------------------------------------------------------------

  /** This profile's categories, alphabetical by name — the whole read there is (the table is flat). */
  listCategories(): NoteCategory[] {
    const rows = this.selectCategories.all(this.profileId) as NoteCategoryRow[];
    return rows.map(toNoteCategory);
  }

  /**
   * Creates a category, trimming its name and validating its colour against the
   * folder palette.
   *
   * REFUSES a name this profile already holds, rather than returning the
   * existing row the way `createTag` does — the two paths are get-or-create for
   * a reason that does not apply here. `createTag` backs a free-text tag input
   * where re-typing an existing name obviously means "that one"; a category is
   * only ever made from the organizer's explicit „Nova kategorija" form, where
   * silently handing back somebody else's row would show the user no new row and
   * no error, which reads as a bug. Refusing also matches `renameTag`, which has
   * always rejected a collision — the same rule, at the only other place the
   * name is chosen.
   */
  createCategory(input: { name: string; color: NoteFolderColor | null }, now: string): NoteCategory {
    const validNow = validateDateTime(now, "now", NoteCategoryValidationError);
    const name = validateCategoryName(input.name);
    const color = validateCategoryColor(input.color);
    this.requireCategoryNameFree(name, "");

    const id = uuidv7();
    this.insertCategory.run(id, this.profileId, name, color, validNow, validNow);
    return { id, profileId: this.profileId, name, color, createdAt: validNow, updatedAt: validNow };
  }

  /**
   * Applies a partial patch to a category's `name`/`color` — `updateFolder`'s
   * shape, for the reason that method's own comment gives: a rename and a
   * recolour are what one organizer form edits together. An omitted key is left
   * untouched; an explicit `color: null` clears the colour, so presence is
   * checked with `in`, never `??`.
   */
  updateCategory(
    id: string,
    fields: { name?: string; color?: NoteFolderColor | null },
    now: string,
  ): void {
    const validNow = validateDateTime(now, "now", NoteCategoryValidationError);
    const existing = this.requireCategory(id);

    const newName = "name" in fields ? validateCategoryName(fields.name) : existing.name;
    const newColor = "color" in fields ? validateCategoryColor(fields.color) : existing.color;
    this.requireCategoryNameFree(newName, id);

    this.updateCategoryFields.run(newName, newColor, validNow, id, this.profileId);
  }

  /**
   * Deletes a category. Its notes are NOT deleted — migration 049's `ON DELETE
   * SET NULL` leaves each of them standing and uncategorized, which is the
   * whole of what "this kind no longer exists" should mean.
   */
  deleteCategory(id: string): void {
    this.requireCategory(id);
    this.deleteCategoryRow.run(id, this.profileId);
  }

  // ---------------------------------------------------------------------
  // Tag links
  // ---------------------------------------------------------------------

  /** Every note-tag attachment in this profile, excluding soft-deleted notes. */
  listTagLinks(): NoteTagLink[] {
    const rows = this.selectTagLinks.all(this.profileId) as NoteTagLinkRow[];
    return rows.map((row) => ({ noteId: row.note_id, tagId: row.tag_id }));
  }

  /** Attaches a tag to an active note; attaching an already-attached tag is a no-op. */
  attachTag(noteId: string, tagId: string): void {
    this.requireActiveNote(noteId);
    this.requireTag(tagId);
    this.insertTagLink.run(noteId, tagId);
  }

  /** Detaches a tag from a note; silent (never throws) whether or not the link existed. */
  detachTag(noteId: string, tagId: string): void {
    this.deleteTagLink.run(noteId, tagId, this.profileId);
  }

  // ---------------------------------------------------------------------
  // Guards
  // ---------------------------------------------------------------------

  /** Reads a folder in this profile or throws — the gate every folder reference goes through. */
  private requireFolder(id: string): NoteFolderRow {
    const row = this.selectFolderById.get(id, this.profileId) as NoteFolderRow | undefined;
    if (!row) {
      throw new NoteFolderNotFoundError(`No folder "${id}" in this profile.`);
    }
    return row;
  }

  /** Reads a tag in this profile or throws — the gate every tag reference goes through. */
  private requireTag(id: string): NoteTagRow {
    const row = this.selectTagById.get(id, this.profileId) as NoteTagRow | undefined;
    if (!row) {
      throw new NoteTagNotFoundError(`No tag "${id}" in this profile.`);
    }
    return row;
  }

  /** Reads a category in this profile or throws — the gate every category reference goes through. */
  private requireCategory(id: string): NoteCategoryRow {
    const row = this.selectCategoryById.get(id, this.profileId) as NoteCategoryRow | undefined;
    if (!row) {
      throw new NoteCategoryNotFoundError(`No category "${id}" in this profile.`);
    }
    return row;
  }

  /**
   * Refuses a name another category of this profile already holds — migration
   * 049's `UNIQUE (profile_id, name)` restated so a collision surfaces as a
   * named domain error instead of a raw SQLite constraint failure. `exceptId`
   * is the row being renamed (`""` on a create, an id no row can hold), which
   * is what makes renaming a category to its own current name a no-op.
   */
  private requireCategoryNameFree(name: string, exceptId: string): void {
    if (this.selectCategoryNameCollision.get(this.profileId, name, exceptId)) {
      throw new NoteCategoryValidationError(
        `A category named "${name}" already exists in this profile.`,
      );
    }
  }

  /** Confirms an active note exists in this profile or throws. */
  private requireActiveNote(id: string): void {
    const row = this.selectActiveNoteById.get(id, this.profileId);
    if (!row) {
      throw new NoteNotFoundError(`No active note "${id}" in this profile.`);
    }
  }
}

function toNoteFolder(row: NoteFolderRow): NoteFolder {
  return {
    id: row.id,
    profileId: row.profile_id,
    parentId: row.parent_id,
    name: row.name,
    color: row.color as NoteFolderColor | null,
    defaultTemplateId: row.default_template_id,
    isCaptureDefault: row.is_capture_default === 1,
    // The CHECK is the guarantee: migration 039 admits nothing else into the
    // column, so no re-narrowing on the way out.
    defaultView: row.default_view as NoteFolderView,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toNoteTag(row: NoteTagRow): NoteTag {
  return {
    id: row.id,
    profileId: row.profile_id,
    name: row.name,
    createdAt: row.created_at,
  };
}

function validateFolderName(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new NoteFolderValidationError("A folder name must not be empty.");
  }
  if (trimmed.length > MAX_FOLDER_NAME_LENGTH) {
    throw new NoteFolderValidationError(
      `A folder name must not exceed ${MAX_FOLDER_NAME_LENGTH} characters after trimming.`,
    );
  }
  return trimmed;
}

function validateFolderColor(value: NoteFolderColor | null): NoteFolderColor | null {
  if (value === null) return null;
  if (!(NOTE_FOLDER_COLORS as readonly string[]).includes(value)) {
    throw new NoteFolderValidationError(`"${value}" is not a known folder colour.`);
  }
  return value;
}

function validateFolderView(value: NoteFolderView): NoteFolderView {
  if (!(NOTE_FOLDER_VIEWS as readonly string[]).includes(value)) {
    throw new NoteFolderValidationError(`"${String(value)}" is not a known folder view.`);
  }
  return value;
}

function toNoteCategory(row: NoteCategoryRow): NoteCategory {
  return {
    id: row.id,
    profileId: row.profile_id,
    name: row.name,
    color: row.color as NoteFolderColor | null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function validateCategoryName(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new NoteCategoryValidationError("A category name must not be empty.");
  }
  if (trimmed.length > MAX_CATEGORY_NAME_LENGTH) {
    throw new NoteCategoryValidationError(
      `A category name must not exceed ${MAX_CATEGORY_NAME_LENGTH} characters after trimming.`,
    );
  }
  return trimmed;
}

/** The folder palette, checked against the folder's own list — one palette, one source (see `NoteCategory.color`). */
function validateCategoryColor(value: NoteFolderColor | null): NoteFolderColor | null {
  if (value === null) return null;
  if (!(NOTE_FOLDER_COLORS as readonly string[]).includes(value)) {
    throw new NoteCategoryValidationError(`"${value}" is not a known category colour.`);
  }
  return value;
}

function validateTagName(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new NoteTagValidationError("A tag name must not be empty.");
  }
  if (trimmed.length > MAX_TAG_NAME_LENGTH) {
    throw new NoteTagValidationError(
      `A tag name must not exceed ${MAX_TAG_NAME_LENGTH} characters after trimming.`,
    );
  }
  return trimmed;
}

/** Validates `now` against the shared ISO-8601 pattern, throwing the caller's own error type. */
function validateDateTime<E extends Error>(
  value: string,
  field: string,
  ErrorCtor: new (message: string) => E,
): string {
  if (!ISO_8601_DATETIME.test(value)) {
    throw new ErrorCtor(`"${field}" must be an ISO-8601 date-time.`);
  }
  return value;
}
