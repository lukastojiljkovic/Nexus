import type Database from "better-sqlite3-multiple-ciphers";

import { DatabaseError } from "../errors.js";
import { isDateTime } from "../finance/money.js";
import { uuidv7 } from "../ids.js";

export const GALLERY_EXPORT_VERSION = 1;
export const MAX_GALLERY_TITLE_LENGTH = 200;
export const MAX_GALLERY_NOTES_LENGTH = 4_000;
export const MAX_GALLERY_TAGS = 20;
export const MAX_GALLERY_TAG_LENGTH = 40;

export class GalleryValidationError extends DatabaseError {}
export class GalleryNotFoundError extends DatabaseError {}

export interface GalleryItem {
  readonly id: string;
  readonly profileId: string;
  readonly title: string;
  readonly notes: string;
  readonly tags: readonly string[];
  readonly fileName: string;
  readonly mime: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly thumbnailMime: string;
  readonly thumbnailSha256: string;
  readonly thumbnailSizeBytes: number;
  readonly width: number;
  readonly height: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateGalleryItemInput {
  readonly title: string;
  readonly notes?: string;
  readonly tags?: readonly string[];
  readonly fileName: string;
  readonly mime: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly thumbnailMime: string;
  readonly thumbnailSha256: string;
  readonly thumbnailSizeBytes: number;
  readonly width: number;
  readonly height: number;
}

export interface UpdateGalleryItemFields {
  readonly title?: string;
  readonly notes?: string;
  readonly tags?: readonly string[];
}

export interface GalleryExport {
  readonly version: typeof GALLERY_EXPORT_VERSION;
  readonly items: readonly Omit<GalleryItem, "profileId">[];
}

interface Row {
  id: string;
  profile_id: string;
  title: string;
  notes: string;
  tags_json: string;
  file_name: string;
  mime: string;
  size_bytes: number;
  sha256: string;
  thumbnail_mime: string;
  thumbnail_sha256: string;
  thumbnail_size_bytes: number;
  width: number;
  height: number;
  created_at: string;
  updated_at: string;
}

const COLUMNS =
  "id, profile_id, title, notes, tags_json, file_name, mime, size_bytes, sha256, thumbnail_mime, thumbnail_sha256, thumbnail_size_bytes, width, height, created_at, updated_at";
const SHA256 = /^[0-9a-f]{64}$/;
const MIME = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/;
const IMAGE_MIME = /^image\/(?:png|jpeg|webp|gif)$/;

function text(value: unknown, field: string, max: number): string {
  if (typeof value !== "string") throw new GalleryValidationError(`"${field}" must be a string.`);
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > max) {
    throw new GalleryValidationError(`"${field}" must be 1-${String(max)} characters.`);
  }
  return trimmed;
}

function optionalText(value: unknown, field: string, max: number): string {
  if (typeof value !== "string" || value.length > max) {
    throw new GalleryValidationError(`"${field}" must be a string of at most ${String(max)} characters.`);
  }
  return value.trim();
}

function mediaType(value: unknown, field: string): string {
  const parsed = text(value, field, 100);
  if (!MIME.test(parsed) || !IMAGE_MIME.test(parsed)) {
    throw new GalleryValidationError(`"${field}" is not a supported image media type.`);
  }
  return parsed;
}

function digest(value: unknown, field: string): string {
  const parsed = text(value, field, 64);
  if (!SHA256.test(parsed)) throw new GalleryValidationError(`"${field}" is not a SHA-256 digest.`);
  return parsed;
}

function positive(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new GalleryValidationError(`"${field}" must be a positive whole number.`);
  }
  return value;
}

function tags(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > MAX_GALLERY_TAGS) {
    throw new GalleryValidationError(`"tags" must hold at most ${String(MAX_GALLERY_TAGS)} names.`);
  }
  const seen = new Set<string>();
  const result: string[] = [];
  for (const [index, raw] of value.entries()) {
    const tag = text(raw, `tags[${index}]`, MAX_GALLERY_TAG_LENGTH);
    const folded = tag.toLocaleLowerCase("sr-Latn");
    if (seen.has(folded)) continue;
    seen.add(folded);
    result.push(tag);
  }
  return result;
}

function instant(value: string): string {
  if (!isDateTime(value)) throw new GalleryValidationError('"now" must be an ISO-8601 date-time.');
  return value;
}

function rowOf(row: Row): GalleryItem {
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.tags_json);
  } catch {
    throw new GalleryValidationError(`Gallery item "${row.id}" carries invalid tags.`);
  }
  return {
    id: row.id,
    profileId: row.profile_id,
    title: row.title,
    notes: row.notes,
    tags: tags(parsed),
    fileName: row.file_name,
    mime: row.mime,
    sizeBytes: row.size_bytes,
    sha256: row.sha256,
    thumbnailMime: row.thumbnail_mime,
    thumbnailSha256: row.thumbnail_sha256,
    thumbnailSizeBytes: row.thumbnail_size_bytes,
    width: row.width,
    height: row.height,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class GalleryStore {
  constructor(
    private readonly db: Database.Database,
    private readonly profileId: string,
  ) {}

  listActive(): GalleryItem[] {
    const rows = this.db
      .prepare(`SELECT ${COLUMNS} FROM gallery_items WHERE profile_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC, id`)
      .all(this.profileId) as Row[];
    return rows.map(rowOf);
  }

  create(input: CreateGalleryItemInput, now: string): GalleryItem {
    const stamp = instant(now);
    const title = text(input.title, "title", MAX_GALLERY_TITLE_LENGTH);
    const notes = optionalText(input.notes ?? "", "notes", MAX_GALLERY_NOTES_LENGTH);
    const tagList = tags(input.tags ?? []);
    const fileName = text(input.fileName, "fileName", 255);
    if (!IMAGE_MIME.test(input.mime)) {
      throw new GalleryValidationError('"mime" is not a supported image media type.');
    }
    if (!SHA256.test(input.sha256)) throw new GalleryValidationError('"sha256" is not a SHA-256 digest.');
    if (input.thumbnailMime !== "image/png") {
      throw new GalleryValidationError('"thumbnailMime" must be image/png.');
    }
    if (!SHA256.test(input.thumbnailSha256)) {
      throw new GalleryValidationError('"thumbnailSha256" is not a SHA-256 digest.');
    }
    const id = uuidv7();
    this.db
      .prepare(
        `INSERT INTO gallery_items (${COLUMNS})
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        this.profileId,
        title,
        notes,
        JSON.stringify(tagList),
        fileName,
        input.mime,
        positive(input.sizeBytes, "sizeBytes"),
        input.sha256,
        input.thumbnailMime,
        input.thumbnailSha256,
        positive(input.thumbnailSizeBytes, "thumbnailSizeBytes"),
        positive(input.width, "width"),
        positive(input.height, "height"),
        stamp,
        stamp,
      );
    return this.get(id);
  }

  get(id: string): GalleryItem {
    const row = this.db
      .prepare(`SELECT ${COLUMNS} FROM gallery_items WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`)
      .get(id, this.profileId) as Row | undefined;
    if (row === undefined) throw new GalleryNotFoundError(`No gallery item "${id}" in this profile.`);
    return rowOf(row);
  }

  update(id: string, fields: UpdateGalleryItemFields, now: string): GalleryItem {
    const current = this.get(id);
    const title = fields.title === undefined ? current.title : text(fields.title, "title", MAX_GALLERY_TITLE_LENGTH);
    const notes =
      fields.notes === undefined ? current.notes : optionalText(fields.notes, "notes", MAX_GALLERY_NOTES_LENGTH);
    const tagList = fields.tags === undefined ? current.tags : tags(fields.tags);
    this.db
      .prepare(
        `UPDATE gallery_items SET title = ?, notes = ?, tags_json = ?, updated_at = ?
          WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
      )
      .run(title, notes, JSON.stringify(tagList), instant(now), id, this.profileId);
    return this.get(id);
  }

  remove(id: string, now: string): GalleryItem {
    const current = this.get(id);
    this.db
      .prepare(`UPDATE gallery_items SET deleted_at = ?, updated_at = ? WHERE id = ? AND profile_id = ?`)
      .run(instant(now), instant(now), id, this.profileId);
    return current;
  }

  refCount(sha256: string): number {
    const row = this.db
      .prepare(
        `SELECT coalesce(sum(
           CASE WHEN sha256 = ? THEN 1 ELSE 0 END +
           CASE WHEN thumbnail_sha256 = ? THEN 1 ELSE 0 END
         ), 0) AS n
         FROM gallery_items WHERE deleted_at IS NULL`,
      )
      .get(sha256, sha256) as { n: number };
    return row.n;
  }

  mimeForHash(sha256: string): string | null {
    const row = this.db
      .prepare(
        `SELECT CASE
           WHEN sha256 = ? THEN mime
           ELSE thumbnail_mime
         END AS mime
         FROM gallery_items
         WHERE deleted_at IS NULL AND (sha256 = ? OR thumbnail_sha256 = ?)
         LIMIT 1`,
      )
      .get(sha256, sha256, sha256) as { mime: string } | undefined;
    return row?.mime ?? null;
  }

  exportData(): GalleryExport {
    return {
      version: GALLERY_EXPORT_VERSION,
      items: this.listActive().map(({ profileId: _, ...item }) => item),
    };
  }

  importData(value: unknown): number {
    const parsed = parseGalleryExport(value);
    this.db.transaction(() => {
      this.db.prepare(`DELETE FROM gallery_items WHERE profile_id = ?`).run(this.profileId);
      const insert = this.db.prepare(
        `INSERT INTO gallery_items (${COLUMNS})
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const item of parsed.items) {
        insert.run(
          item.id,
          this.profileId,
          item.title,
          item.notes,
          JSON.stringify(item.tags),
          item.fileName,
          item.mime,
          item.sizeBytes,
          item.sha256,
          item.thumbnailMime,
          item.thumbnailSha256,
          item.thumbnailSizeBytes,
          item.width,
          item.height,
          item.createdAt,
          item.updatedAt,
        );
      }
    })();
    return parsed.items.length;
  }
}

export function parseGalleryExport(value: unknown): GalleryExport {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new GalleryValidationError("A gallery export must be an object.");
  }
  const record = value as Record<string, unknown>;
  if (record["version"] !== GALLERY_EXPORT_VERSION || !Array.isArray(record["items"])) {
    throw new GalleryValidationError(`A gallery export must carry version ${String(GALLERY_EXPORT_VERSION)} and items.`);
  }
  const keys = new Set([
    "id", "title", "notes", "tags", "fileName", "mime", "sizeBytes", "sha256",
    "thumbnailMime", "thumbnailSha256", "thumbnailSizeBytes", "width", "height", "createdAt", "updatedAt",
  ]);
  const ids = new Set<string>();
  const items = record["items"].map((raw, index) => {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      throw new GalleryValidationError(`items[${String(index)}] must be an object.`);
    }
    const row = raw as Record<string, unknown>;
    const own = Object.keys(row);
    if (own.some((key) => !keys.has(key)) || [...keys].some((key) => !own.includes(key))) {
      throw new GalleryValidationError(`items[${String(index)}] has the wrong fields.`);
    }
    const id = text(row["id"], `items[${String(index)}].id`, 200);
    if (ids.has(id)) throw new GalleryValidationError(`The gallery export carries "${id}" twice.`);
    ids.add(id);
    return {
      id,
      title: text(row["title"], `items[${String(index)}].title`, MAX_GALLERY_TITLE_LENGTH),
      notes: optionalText(row["notes"], `items[${String(index)}].notes`, MAX_GALLERY_NOTES_LENGTH),
      tags: tags(row["tags"]),
      fileName: text(row["fileName"], `items[${String(index)}].fileName`, 255),
      mime: mediaType(row["mime"], `items[${String(index)}].mime`),
      sizeBytes: positive(row["sizeBytes"], `items[${String(index)}].sizeBytes`),
      sha256: digest(row["sha256"], `items[${String(index)}].sha256`),
      thumbnailMime: mediaType(row["thumbnailMime"], `items[${String(index)}].thumbnailMime`),
      thumbnailSha256: digest(
        row["thumbnailSha256"],
        `items[${String(index)}].thumbnailSha256`,
      ),
      thumbnailSizeBytes: positive(
        row["thumbnailSizeBytes"],
        `items[${String(index)}].thumbnailSizeBytes`,
      ),
      width: positive(row["width"], `items[${String(index)}].width`),
      height: positive(row["height"], `items[${String(index)}].height`),
      createdAt: instant(text(row["createdAt"], `items[${String(index)}].createdAt`, 40)),
      updatedAt: instant(text(row["updatedAt"], `items[${String(index)}].updatedAt`, 40)),
    };
  });
  return { version: GALLERY_EXPORT_VERSION, items };
}
