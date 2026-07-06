import type Database from "better-sqlite3-multiple-ciphers";
import { DocumentNotFoundError, DocumentValidationError } from "../errors.js";
import { uuidv7 } from "../ids.js";

type DatabaseHandle = Database.Database;

/** Closed document-type domain (migration 004 CHECK); `custom` is the catch-all (CAL-004). */
export type DocumentType =
  | "licna_karta"
  | "pasos"
  | "vozacka"
  | "registracija"
  | "kartica"
  | "polisa"
  | "custom";

/** Derived expiry state: on time, inside the reminder window, or already expired. */
export type DocumentStatus = "ok" | "uskoro" | "istekao";

/** Document types in the order the UI offers them; the last is the free-form catch-all. */
export const DOCUMENT_TYPES: readonly DocumentType[] = [
  "licna_karta",
  "pasos",
  "vozacka",
  "registracija",
  "kartica",
  "polisa",
  "custom",
];

/**
 * Per-type default reminder ladders — day-counts before expiry, applied when a
 * document is created without explicit offsets (OQ#1). Founder-confirmed for
 * lična karta / pasoš (90/30/7), registracija (30/14/3) and kartica (30/7); the
 * remaining types use sensible defaults. Ladders are per-document editable.
 */
export const DEFAULT_REMINDER_LADDERS: Record<DocumentType, readonly number[]> = {
  licna_karta: [90, 30, 7],
  pasos: [90, 30, 7],
  vozacka: [90, 30, 7],
  registracija: [30, 14, 3],
  kartica: [30, 7],
  polisa: [30, 7],
  custom: [30, 7],
};

/**
 * A tracked document as the store returns it: camelCase keys plus two DERIVED
 * fields — `status` and `daysUntilExpiry` — computed at read time from the expiry
 * date and the ladder (never stored, so nothing drifts as the clock moves).
 */
export interface TrackedDocument {
  id: string;
  profileId: string;
  docType: DocumentType;
  label: string;
  expiryDate: string;
  reminderOffsets: number[];
  notes: string | null;
  status: DocumentStatus;
  daysUntilExpiry: number;
  createdAt: string;
  updatedAt: string;
}

/** A single renewal record — the expiry that was replaced and when (CAL-004 history). */
export interface DocumentRenewal {
  id: string;
  documentId: string;
  previousExpiry: string;
  renewedAt: string;
}

/** Fields accepted when creating a document; `reminderOffsets` defaults from the type's ladder. */
export interface CreateDocumentInput {
  docType: DocumentType;
  label: string;
  expiryDate: string;
  reminderOffsets?: number[];
  notes?: string | null;
}

/**
 * A partial patch of a document's own fields. An omitted key is left untouched; an
 * explicit `null` clears `notes`. Soft delete/restore and renewal have their own
 * methods.
 */
export interface UpdateDocumentFields {
  docType?: DocumentType;
  label?: string;
  expiryDate?: string;
  reminderOffsets?: number[];
  notes?: string | null;
}

interface DocumentRow {
  id: string;
  profile_id: string;
  doc_type: DocumentType;
  label: string;
  expiry_date: string;
  reminder_offsets: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

interface RenewalRow {
  id: string;
  document_id: string;
  previous_expiry: string;
  renewed_at: string;
}

const COLUMNS =
  "id, profile_id, doc_type, label, expiry_date, reminder_offsets, notes, created_at, updated_at";

const MS_PER_DAY = 86_400_000;

/** Accepts ISO-8601 date ('2026-07-08') or date-time, optionally zoned (PRD §7). */
const ISO_8601 =
  /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})?)?$/;

/**
 * Derives expiry state from date-only UTC midnights: `daysUntilExpiry` is the
 * whole-day gap between today and the expiry date (both reduced to UTC midnight,
 * so wall-clock time and time zone never shift the count). A past date is
 * 'istekao'; a date within the ladder's widest offset is 'uskoro'; otherwise 'ok'.
 */
export function deriveStatus(
  expiryDate: string,
  reminderOffsets: readonly number[],
  now: Date,
): { status: DocumentStatus; daysUntilExpiry: number } {
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const daysUntilExpiry = Math.round((dateOnlyUtcMillis(expiryDate) - todayUtc) / MS_PER_DAY);
  const threshold = Math.max(0, ...reminderOffsets);
  const status: DocumentStatus =
    daysUntilExpiry < 0 ? "istekao" : daysUntilExpiry <= threshold ? "uskoro" : "ok";
  return { status, daysUntilExpiry };
}

/**
 * Document persistence for a single profile, over prepared, parameterized
 * statements (SEC-API-03; every value is bound, never interpolated). Mirrors
 * `EventStore`: construct one per profile, reuse it. Inputs are revalidated here
 * because the renderer is untrusted (SEC-EL-02), and every statement is scoped by
 * `profile_id` so one profile's documents are invisible to another's store.
 */
export class DocumentStore {
  private readonly insert: Database.Statement;
  private readonly selectActive: Database.Statement;
  private readonly selectActiveById: Database.Statement;
  private readonly updateFields: Database.Statement;
  private readonly markDeleted: Database.Statement;
  private readonly markRestored: Database.Statement;
  private readonly insertRenewal: Database.Statement;
  private readonly selectRenewals: Database.Statement;

  constructor(
    private readonly db: DatabaseHandle,
    private readonly profileId: string,
  ) {
    this.insert = db.prepare(
      `INSERT INTO tracked_documents
         (id, profile_id, doc_type, label, expiry_date, reminder_offsets,
          notes, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    );
    this.selectActive = db.prepare(
      `SELECT ${COLUMNS} FROM tracked_documents
       WHERE profile_id = ? AND deleted_at IS NULL
       ORDER BY expiry_date, id`,
    );
    this.selectActiveById = db.prepare(
      `SELECT ${COLUMNS} FROM tracked_documents
       WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.updateFields = db.prepare(
      `UPDATE tracked_documents
         SET doc_type = ?, label = ?, expiry_date = ?, reminder_offsets = ?,
             notes = ?, updated_at = ?
       WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.markDeleted = db.prepare(
      `UPDATE tracked_documents SET deleted_at = ?, updated_at = ?
       WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.markRestored = db.prepare(
      `UPDATE tracked_documents SET deleted_at = NULL, updated_at = ?
       WHERE id = ? AND profile_id = ? AND deleted_at IS NOT NULL`,
    );
    this.insertRenewal = db.prepare(
      `INSERT INTO document_renewals (id, document_id, previous_expiry, renewed_at)
       VALUES (?, ?, ?, ?)`,
    );
    this.selectRenewals = db.prepare(
      `SELECT id, document_id, previous_expiry, renewed_at FROM document_renewals
       WHERE document_id = ?
       ORDER BY renewed_at, id`,
    );
  }

  /** Active documents for this profile by soonest expiry, each with derived status. */
  listActive(): TrackedDocument[] {
    const now = new Date();
    const rows = this.selectActive.all(this.profileId) as DocumentRow[];
    return rows.map((row) => toDocument(row, now));
  }

  /** Inserts a document, defaulting the ladder from its type, and returns the stored row (CAL-004). */
  create(input: CreateDocumentInput): TrackedDocument {
    const docType = validateDocType(input.docType);
    const label = validateLabel(input.label);
    const expiryDate = validateExpiryDate(input.expiryDate);
    const reminderOffsets =
      input.reminderOffsets !== undefined
        ? validateReminderOffsets(input.reminderOffsets)
        : [...DEFAULT_REMINDER_LADDERS[docType]];
    const notes = normalizeOptional(input.notes);
    const now = new Date();
    const nowIso = now.toISOString();
    const id = uuidv7();

    this.insert.run(
      id, this.profileId, docType, label, expiryDate,
      JSON.stringify(reminderOffsets), notes, nowIso, nowIso,
    );

    const { status, daysUntilExpiry } = deriveStatus(expiryDate, reminderOffsets, now);
    return {
      id, profileId: this.profileId, docType, label, expiryDate, reminderOffsets,
      notes, status, daysUntilExpiry, createdAt: nowIso, updatedAt: nowIso,
    };
  }

  /** Applies a partial field patch to an active document (CAL-004 editing). */
  update(id: string, fields: UpdateDocumentFields): TrackedDocument {
    const current = this.requireActive(id);
    return this.writeFields(current, {
      docType: fields.docType !== undefined ? validateDocType(fields.docType) : current.docType,
      label: fields.label !== undefined ? validateLabel(fields.label) : current.label,
      expiryDate:
        fields.expiryDate !== undefined
          ? validateExpiryDate(fields.expiryDate)
          : current.expiryDate,
      reminderOffsets:
        fields.reminderOffsets !== undefined
          ? validateReminderOffsets(fields.reminderOffsets)
          : current.reminderOffsets,
      notes: fields.notes !== undefined ? normalizeOptional(fields.notes) : current.notes,
    });
  }

  /** Soft-deletes an active document (reversible via `restore`). */
  softDelete(id: string): void {
    const now = new Date().toISOString();
    const { changes } = this.markDeleted.run(now, now, id, this.profileId);
    if (changes === 0) {
      throw new DocumentNotFoundError(`No active document "${id}" to delete in this profile.`);
    }
  }

  /** Restores a soft-deleted document (undo of a delete). */
  restore(id: string): void {
    const now = new Date().toISOString();
    const { changes } = this.markRestored.run(now, id, this.profileId);
    if (changes === 0) {
      throw new DocumentNotFoundError(`No deleted document "${id}" to restore in this profile.`);
    }
  }

  /**
   * Renews a document: appends a `document_renewals` row holding the OLD expiry,
   * then moves `expiry_date` forward to the validated new date (CAL-004). The
   * ladder and every other field are preserved.
   */
  renew(id: string, newExpiryDate: string): TrackedDocument {
    const current = this.requireActive(id);
    const expiryDate = validateExpiryDate(newExpiryDate);
    const now = new Date();
    const nowIso = now.toISOString();

    // History append + expiry move are one unit: never a renewal row without its
    // matching expiry change, or the reverse.
    this.db.transaction(() => {
      this.insertRenewal.run(uuidv7(), current.id, current.expiryDate, nowIso);
      this.updateFields.run(
        current.docType, current.label, expiryDate,
        JSON.stringify(current.reminderOffsets), current.notes,
        nowIso, current.id, this.profileId,
      );
    })();

    const { status, daysUntilExpiry } = deriveStatus(expiryDate, current.reminderOffsets, now);
    return { ...current, expiryDate, status, daysUntilExpiry, updatedAt: nowIso };
  }

  /** Renewal history for one active document in this profile, oldest first. */
  listRenewals(id: string): DocumentRenewal[] {
    this.requireActive(id); // enforces scope + existence before exposing the log
    const rows = this.selectRenewals.all(id) as RenewalRow[];
    return rows.map(toRenewal);
  }

  /** Reads an active document in this profile or throws — enforces scope + existence. */
  private requireActive(id: string): TrackedDocument {
    const row = this.selectActiveById.get(id, this.profileId) as DocumentRow | undefined;
    if (!row) {
      throw new DocumentNotFoundError(`No active document "${id}" in this profile.`);
    }
    return toDocument(row, new Date());
  }

  /**
   * Writes a fully-resolved field set and returns the merged document with its
   * status re-derived against the new expiry/ladder — the single place the
   * `tracked_documents` UPDATE and the derivation stay in step.
   */
  private writeFields(current: TrackedDocument, next: Required<UpdateDocumentFields>): TrackedDocument {
    const now = new Date();
    const nowIso = now.toISOString();

    this.updateFields.run(
      next.docType, next.label, next.expiryDate, JSON.stringify(next.reminderOffsets),
      next.notes, nowIso, current.id, this.profileId,
    );

    const { status, daysUntilExpiry } = deriveStatus(next.expiryDate, next.reminderOffsets, now);
    return { ...current, ...next, status, daysUntilExpiry, updatedAt: nowIso };
  }
}

/** Reduces an ISO date/date-time to its UTC-midnight millisecond value (date part only). */
function dateOnlyUtcMillis(value: string): number {
  const iso = value.slice(0, 10);
  return Date.UTC(
    Number(iso.slice(0, 4)),
    Number(iso.slice(5, 7)) - 1,
    Number(iso.slice(8, 10)),
  );
}

function toDocument(row: DocumentRow, now: Date): TrackedDocument {
  const reminderOffsets = JSON.parse(row.reminder_offsets) as number[];
  const { status, daysUntilExpiry } = deriveStatus(row.expiry_date, reminderOffsets, now);
  return {
    id: row.id,
    profileId: row.profile_id,
    docType: row.doc_type,
    label: row.label,
    expiryDate: row.expiry_date,
    reminderOffsets,
    notes: row.notes,
    status,
    daysUntilExpiry,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toRenewal(row: RenewalRow): DocumentRenewal {
  return {
    id: row.id,
    documentId: row.document_id,
    previousExpiry: row.previous_expiry,
    renewedAt: row.renewed_at,
  };
}

function validateDocType(value: DocumentType): DocumentType {
  if (!(DOCUMENT_TYPES as readonly string[]).includes(value)) {
    throw new DocumentValidationError(`"${value}" is not a known document type.`);
  }
  return value;
}

function validateLabel(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new DocumentValidationError("Document label must not be empty.");
  }
  return trimmed;
}

function validateExpiryDate(value: string): string {
  if (!ISO_8601.test(value)) {
    throw new DocumentValidationError('"expiryDate" must be an ISO-8601 date.');
  }
  return value;
}

/** Reminder offsets must be an array of finite, non-negative integer day-counts. */
function validateReminderOffsets(value: number[]): number[] {
  if (!Array.isArray(value)) {
    throw new DocumentValidationError("reminderOffsets must be an array of day-counts.");
  }
  for (const offset of value) {
    if (typeof offset !== "number" || !Number.isInteger(offset) || offset < 0) {
      throw new DocumentValidationError(
        "reminderOffsets must contain only integers greater than or equal to 0.",
      );
    }
  }
  return [...value];
}

/** Normalizes an optional string: absent/empty/whitespace-only collapses to null. */
function normalizeOptional(value: string | null | undefined): string | null {
  if (value === undefined || value === null || value.trim().length === 0) return null;
  return value;
}
