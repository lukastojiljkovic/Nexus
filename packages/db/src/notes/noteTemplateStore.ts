import type Database from "better-sqlite3-multiple-ciphers";
import { NoteTemplateNotFoundError, NoteTemplateValidationError } from "../errors.js";
import { uuidv7 } from "../ids.js";

type DatabaseHandle = Database.Database;

/** A note template as the store returns it (ADR-016 / NOTE-009, slice 009-a). */
export interface NoteTemplate {
  id: string;
  profileId: string;
  name: string;
  /** A ProseMirror document, JSON-encoded (ADR-016) — never a Yjs snapshot; see the migration's doc comment. */
  content: string;
  createdAt: string;
  updatedAt: string;
}

interface NoteTemplateRow {
  id: string;
  profile_id: string;
  name: string;
  content: string;
  created_at: string;
  updated_at: string;
}

const COLUMNS = "id, profile_id, name, content, created_at, updated_at";

/**
 * The largest template document accepted, matching `MAX_NOTE_UPDATE_BYTES`
 * (the note-update wire cap): a template body is bounded the same way a
 * single appended edit is. Mirrored as `NOTE_TEMPLATE_MAX_BYTES` on the
 * desktop app's IPC contract for renderer pre-flight — the store re-checks
 * it regardless (SEC-EL-02).
 */
export const MAX_NOTE_TEMPLATE_BYTES = 262_144;

const MAX_TEMPLATE_NAME_LENGTH = 100;

/** Accepts a full ISO-8601 date-time (the `now` every mutating method takes) — mirrors noteStore.ts / noteOrgStore.ts / noteAttachmentStore.ts. */
const ISO_8601_DATETIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})?$/;

/**
 * Persistence for user-defined NOTE templates (ADR-016 / NOTE-009, slice
 * 009-a). Mirrors `NoteOrgStore`: construct one per profile, reuse it, over
 * prepared, parameterized statements (SEC-API-03; every value bound, never
 * interpolated), every statement scoped by `profile_id`. Inputs are
 * revalidated here because the renderer is untrusted (SEC-EL-02).
 *
 * `save` is an upsert on `(profile_id, name)` — the migration's UNIQUE index
 * — because naming IS the edit mechanism (ADR-016: there is no template
 * editor; a user edits a template by applying it, changing the note, and
 * saving under the same name, which replaces the stored content). The
 * select-then-write runs inside one `db.transaction(...)` so a concurrent
 * save under the same name can never slip between the lookup and the write.
 *
 * `rename`'s collision handling copies `NoteOrgStore.renameTag`'s exactly: a
 * `selectNameCollision` statement excludes the row's own id, so renaming a
 * template to its own current name is a no-op, never a collision, while
 * renaming onto another template's name surfaces as a domain
 * `NoteTemplateValidationError` rather than a raw UNIQUE driver error.
 *
 * Unlike `NoteStore`/`NoteAttachmentStore`, there is no soft delete here and
 * therefore no `requireActive`-style scoping through a parent note — a
 * template is its own root object, gated only by `profile_id` (see the
 * migration's doc comment for why templates carry no history worth
 * preserving).
 */
export class NoteTemplateStore {
  private readonly selectAll: Database.Statement;
  private readonly selectById: Database.Statement;
  private readonly selectByName: Database.Statement;
  private readonly insert: Database.Statement;
  private readonly updateContent: Database.Statement;
  private readonly selectNameCollision: Database.Statement;
  private readonly updateName: Database.Statement;
  private readonly deleteRow: Database.Statement;

  constructor(
    private readonly db: DatabaseHandle,
    private readonly profileId: string,
  ) {
    this.selectAll = db.prepare(
      `SELECT ${COLUMNS} FROM note_templates WHERE profile_id = ? ORDER BY name`,
    );
    this.selectById = db.prepare(
      `SELECT ${COLUMNS} FROM note_templates WHERE id = ? AND profile_id = ?`,
    );
    this.selectByName = db.prepare(
      `SELECT ${COLUMNS} FROM note_templates WHERE profile_id = ? AND name = ?`,
    );
    this.insert = db.prepare(
      `INSERT INTO note_templates (id, profile_id, name, content, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    this.updateContent = db.prepare(
      `UPDATE note_templates SET content = ?, updated_at = ? WHERE id = ? AND profile_id = ?`,
    );
    this.selectNameCollision = db.prepare(
      `SELECT id FROM note_templates WHERE profile_id = ? AND name = ? AND id != ?`,
    );
    this.updateName = db.prepare(
      `UPDATE note_templates SET name = ?, updated_at = ? WHERE id = ? AND profile_id = ?`,
    );
    this.deleteRow = db.prepare(`DELETE FROM note_templates WHERE id = ? AND profile_id = ?`);
  }

  /**
   * This profile's templates, alphabetical by `name` — SQLite's default
   * binary collation, which does not tailor Serbian Latin script correctly;
   * the renderer re-sorts with `Intl.Collator(["sr-Latn","sr"])`, the house
   * pattern every other alphabetical NOTE list (`NoteOrgStore.listFolders`,
   * `listTags`) already follows.
   */
  list(): NoteTemplate[] {
    const rows = this.selectAll.all(this.profileId) as NoteTemplateRow[];
    return rows.map(toNoteTemplate);
  }

  /**
   * Upserts on `(profile_id, name)`: an existing row with the trimmed name
   * keeps its `id`/`created_at` and takes the new `content`, bumping
   * `updated_at`; otherwise a new row is inserted with a fresh `uuidv7()`.
   * The lookup and the write happen inside one transaction so a concurrent
   * save under the same name can never race between them.
   */
  save(name: string, content: string, now: string): NoteTemplate {
    const validNow = validateDateTime(now, "now");
    const trimmedName = validateTemplateName(name);
    const validContent = validateTemplateContent(content);

    return this.db.transaction((): NoteTemplate => {
      const existing = this.selectByName.get(this.profileId, trimmedName) as
        | NoteTemplateRow
        | undefined;

      if (existing) {
        this.updateContent.run(validContent, validNow, existing.id, this.profileId);
        return {
          id: existing.id,
          profileId: this.profileId,
          name: trimmedName,
          content: validContent,
          createdAt: existing.created_at,
          updatedAt: validNow,
        };
      }

      const id = uuidv7();
      this.insert.run(id, this.profileId, trimmedName, validContent, validNow, validNow);
      return {
        id,
        profileId: this.profileId,
        name: trimmedName,
        content: validContent,
        createdAt: validNow,
        updatedAt: validNow,
      };
    })();
  }

  /** Renames a template; renaming to its own current name is a no-op, not a collision (the `renameTag` precedent). */
  rename(id: string, name: string, now: string): void {
    const validNow = validateDateTime(now, "now");
    const trimmedName = validateTemplateName(name);
    this.requireTemplate(id);

    const collision = this.selectNameCollision.get(this.profileId, trimmedName, id);
    if (collision) {
      throw new NoteTemplateValidationError(
        `A template named "${trimmedName}" already exists in this profile.`,
      );
    }

    this.updateName.run(trimmedName, validNow, id, this.profileId);
  }

  /** Hard-deletes a template — no soft delete (ADR-016: a template carries no history and nothing references it). */
  remove(id: string): void {
    this.requireTemplate(id);
    this.deleteRow.run(id, this.profileId);
  }

  /** Reads a template in this profile or throws — the gate every reference by id goes through. */
  private requireTemplate(id: string): NoteTemplateRow {
    const row = this.selectById.get(id, this.profileId) as NoteTemplateRow | undefined;
    if (!row) {
      throw new NoteTemplateNotFoundError(`No template "${id}" in this profile.`);
    }
    return row;
  }
}

function toNoteTemplate(row: NoteTemplateRow): NoteTemplate {
  return {
    id: row.id,
    profileId: row.profile_id,
    name: row.name,
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function validateTemplateName(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new NoteTemplateValidationError("A template name must not be empty.");
  }
  if (trimmed.length > MAX_TEMPLATE_NAME_LENGTH) {
    throw new NoteTemplateValidationError(
      `A template name must not exceed ${MAX_TEMPLATE_NAME_LENGTH} characters after trimming.`,
    );
  }
  return trimmed;
}

/**
 * A **semantic** re-validation of an otherwise opaque column (SEC-EL-02: the
 * renderer is untrusted) — not a schema check of the document's own blocks.
 * ProseMirror itself drops unknown nodes and marks on parse, which is what
 * keeps a template written by an older build openable rather than broken
 * when the editor's block set changes (ADR-016). Returns the original string
 * unchanged: the store persists exactly what it was given, it never
 * re-serializes.
 */
function validateTemplateContent(value: string): string {
  if (value.trim().length === 0) {
    throw new NoteTemplateValidationError("Template content must not be empty.");
  }
  if (Buffer.byteLength(value, "utf8") > MAX_NOTE_TEMPLATE_BYTES) {
    throw new NoteTemplateValidationError(
      `Template content must not exceed ${MAX_NOTE_TEMPLATE_BYTES} bytes.`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new NoteTemplateValidationError("Template content must be valid JSON.");
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed) ||
    (parsed as { type?: unknown }).type !== "doc"
  ) {
    throw new NoteTemplateValidationError(
      'Template content must be a ProseMirror document — an object with "type": "doc".',
    );
  }
  return value;
}

function validateDateTime(value: string, field: string): string {
  if (!ISO_8601_DATETIME.test(value)) {
    throw new NoteTemplateValidationError(`"${field}" must be an ISO-8601 date-time.`);
  }
  return value;
}
