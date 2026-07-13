import type Database from "better-sqlite3-multiple-ciphers";
import {
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

interface NoteFolderRow {
  id: string;
  profile_id: string;
  parent_id: string | null;
  name: string;
  color: string | null;
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

const FOLDER_COLUMNS = "id, profile_id, parent_id, name, color, created_at, updated_at";
const TAG_COLUMNS = "id, profile_id, name, created_at";

const MAX_FOLDER_NAME_LENGTH = 100;
const MAX_TAG_NAME_LENGTH = 50;

/** Accepts a full ISO-8601 date-time (the `now` every mutating method takes) — mirrors noteStore.ts. */
const ISO_8601_DATETIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})?$/;

/**
 * Persistence for the NOTE module's organization layer (ADR-012 / NOTE-002):
 * nested folders, per-profile tags, and the note-tag many-to-many join. Mirrors
 * `NoteStore`: construct one per profile, reuse it, over prepared, parameterized
 * statements (SEC-API-03), every value bound, never interpolated. Inputs are
 * revalidated here because the renderer is untrusted (SEC-EL-02), and every
 * statement is scoped by `profile_id` — child rows (a note's tag links, a
 * folder's children) are reached through their already-scoped parent, so one
 * profile's organization is invisible to a store scoped to another.
 *
 * `deleteFolder` promotes its children (subfolders and notes) to its own parent
 * before removing the row, rather than relying on the schema's CASCADE — the
 * schema cascades because a folder can also be deleted at the SQL level
 * directly (e.g. by a future admin tool), but the store's own delete path must
 * never silently orphan a subtree the user can still see. `createTag` is
 * get-or-create: tag names are unique per profile, and re-tagging with an
 * existing name is a normal, non-erroring path for the UI's tag input.
 */
export class NoteOrgStore {
  private readonly insertFolder: Database.Statement;
  private readonly selectFolders: Database.Statement;
  private readonly selectFolderById: Database.Statement;
  private readonly updateFolderFields: Database.Statement;
  private readonly updateFolderParent: Database.Statement;
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
