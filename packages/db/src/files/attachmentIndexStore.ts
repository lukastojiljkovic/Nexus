import type Database from "better-sqlite3-multiple-ciphers";
import { MIME_FAMILIES, foldSearchText, type MimeFamily } from "@nexus/core";
import { AttachmentIndexValidationError } from "../errors.js";

type DatabaseHandle = Database.Database;

/**
 * Which of the three PUBLIC attachment tables an entry came from. The same
 * closed union `DocAttachmentModule` names on the wire, and closed for the same
 * reason: PRIV is sealed, so a fourth member here would be the first crack in
 * the one invariant that section rests on.
 */
export type AttachmentOwnerKind = "note" | "task" | "subject";

const OWNER_KINDS: readonly AttachmentOwnerKind[] = ["note", "task", "subject"];

/**
 * How many entries one read may answer with. 500, the search page's own browse
 * cap (`MAX_SEARCH_BROWSE_LIMIT`) rather than a second number: both are "this
 * is where a browse surface stops and says so out loud", and two answers to
 * that question would only mean two places to look it up.
 */
export const MAX_ATTACHMENT_INDEX_ENTRIES = 500;

/** Longest query this store will fold. A search box, not a document — past this the input is not a query anybody typed. */
export const MAX_ATTACHMENT_QUERY_LENGTH = 200;

/** One attachment as „Datoteke" reads it: the index row, plus the title of whatever carries it. */
export interface AttachmentIndexEntry {
  id: string;
  ownerKind: AttachmentOwnerKind;
  ownerId: string;
  /** The note's title, the task's title, or the subject's name — verbatim, empty string included (an untitled note has no title to invent). */
  ownerTitle: string;
  fileName: string;
  mime: string;
  sizeBytes: number;
  sha256: string;
  createdAt: string;
}

/** Every field optional and every combination legal; they compose as AND. */
export interface AttachmentIndexFilter {
  readonly ownerKind?: AttachmentOwnerKind | null;
  readonly family?: MimeFamily | null;
  /** Matched, Serbian-folded, against the file name AND the owner title. Blank means "no query". */
  readonly query?: string | null;
}

/** What one read answers: the entries, and whether the cap cut the set short. */
export interface AttachmentIndexPage {
  readonly entries: AttachmentIndexEntry[];
  /**
   * True when there were MORE matches than the cap. The caller must then state
   * its count as a floor („500+"), never as a total — the honest reporting the
   * search page's own truncation note already does.
   */
  readonly truncated: boolean;
}

interface AttachmentIndexRow {
  id: string;
  owner_kind: AttachmentOwnerKind;
  owner_id: string;
  owner_title: string;
  file_name: string;
  mime: string;
  size_bytes: number;
  sha256: string;
  created_at: string;
}

/**
 * The three attachment tables as one list, each branch scoped by its OWNER's
 * profile and live-ness. No `profile_id` column exists on any of the three
 * (migrations 013/024/035 all left it to the owner), so the join is what scopes
 * the read — the same arrangement each per-module store already relies on.
 *
 * The literal in `owner_kind` is what tells the branches apart downstream; it is
 * a code-level constant, like every table name around it, and no caller value is
 * ever spliced into this text.
 */
const UNION_SQL = `
  SELECT a.id AS id, 'note' AS owner_kind, n.id AS owner_id, n.title AS owner_title,
         a.file_name AS file_name, a.mime AS mime, a.size_bytes AS size_bytes,
         a.sha256 AS sha256, a.created_at AS created_at
    FROM note_attachments a
    JOIN notes n ON n.id = a.note_id
   WHERE n.profile_id = ? AND n.deleted_at IS NULL
   UNION ALL
  SELECT ta.id AS id, 'task' AS owner_kind, t.id AS owner_id, t.title AS owner_title,
         ta.file_name AS file_name, ta.mime AS mime, ta.size_bytes AS size_bytes,
         ta.sha256 AS sha256, ta.created_at AS created_at
    FROM task_attachments ta
    JOIN tasks t ON t.id = ta.task_id
   WHERE t.profile_id = ? AND t.deleted_at IS NULL
   UNION ALL
  SELECT sa.id AS id, 'subject' AS owner_kind, s.id AS owner_id, s.name AS owner_title,
         sa.file_name AS file_name, sa.mime AS mime, sa.size_bytes AS size_bytes,
         sa.sha256 AS sha256, sa.created_at AS created_at
    FROM subject_attachments sa
    JOIN subjects s ON s.id = sa.subject_id
   WHERE s.profile_id = ? AND s.deleted_at IS NULL
`;

/** The union's own aliases, re-selected by name from the outer query — the `COLUMNS` convention every attachment store keeps. */
const ENTRY_COLUMNS =
  "id, owner_kind, owner_id, owner_title, file_name, mime, size_bytes, sha256, created_at";

/**
 * `mimeFamily`'s four buckets, spelled in SQL. They must decide exactly what
 * that function decides — the store's own test pins the two against each other
 * over a corpus of mimes — because the page draws its chips from the helper and
 * the rows come from here, and a family that meant two things would show a
 * count the list below it does not match.
 *
 * SQL, not JS, because the cap has to be applied to the FILTERED set: a family
 * narrowed after the LIMIT would report "500+" for a list of three.
 */
const FAMILY_PREDICATES: Readonly<Record<MimeFamily, string>> = {
  slika: "mime LIKE 'image/%'",
  pdf: "mime = 'application/pdf'",
  tekst: "mime LIKE 'text/%'",
  ostalo:
    "mime NOT LIKE 'image/%' AND mime <> 'application/pdf' AND mime NOT LIKE 'text/%'",
};

/**
 * Read-only, profile-scoped access to every file the profile's PUBLIC surfaces
 * carry (DOC / „Datoteke") — the notes editor's Prilozi, the task form's
 * Prilozi, and STUDY's subject materials, as one list.
 *
 * It writes nothing and owns no table of its own: the three attachment stores
 * remain the only writers, which is why a file's removal still belongs to the
 * surface that owns it (where its undo already lives) and why this store
 * publishes no delete.
 *
 * **Two rules are load-bearing and neither is an optimization.**
 *
 * The union NEVER dedupes by `sha256`. One PDF attached to a note and to a task
 * is two attachments — two owners, possibly two names — and collapsing them
 * would hide a real attachment from the one surface whose whole job is to show
 * every one. The blob store is content-addressed underneath (they share a file
 * on disk); that is a fact about bytes, not about what the user attached.
 *
 * The union NEVER touches the private section. PRIV keeps no attachment table
 * at all (migration 045): a private note's files live sealed inside its
 * envelope, so there is nothing here to exclude by a filter — the exclusion is
 * structural, which is the strongest form it can take.
 *
 * What „deleted" means differs between the two halves of a row, and both are
 * handled above: an OWNER is soft-deleted (`deleted_at`, filtered by each branch
 * of the union, so a restored note brings its files back with it), while an
 * ATTACHMENT row has no soft delete anywhere — all three tables hard-delete it,
 * so a removed file is simply gone from this list too.
 */
export class AttachmentIndexStore {
  /** Cached by family — the SQL text differs only by a code-level predicate, exactly as `SearchStore` caches by kind COUNT. */
  private readonly statements = new Map<string, Database.Statement>();

  constructor(
    private readonly db: DatabaseHandle,
    private readonly profileId: string,
  ) {}

  /**
   * This profile's attachments, newest first, narrowed by whichever filters are
   * given. The `id` tiebreak is what makes the order TOTAL: three tables feed
   * this list and a `UNION ALL` promises nothing about how it emits rows, so
   * without it two files attached in the same second could swap places between
   * two reads of the same unchanged library.
   *
   * Bounded at `MAX_ATTACHMENT_INDEX_ENTRIES`; one row past the cap is read and
   * discarded, which is how `truncated` can be a fact rather than a guess.
   */
  list(filter: AttachmentIndexFilter = {}): AttachmentIndexPage {
    const ownerKind = validateOwnerKind(filter.ownerKind);
    const family = validateFamily(filter.family);
    const query = validateQuery(filter.query);

    const rows = this.statementFor(family).all(
      this.profileId,
      this.profileId,
      this.profileId,
      ownerKind,
      ownerKind,
      query,
      query,
      query,
      MAX_ATTACHMENT_INDEX_ENTRIES + 1,
    ) as AttachmentIndexRow[];

    const truncated = rows.length > MAX_ATTACHMENT_INDEX_ENTRIES;
    return {
      entries: (truncated ? rows.slice(0, MAX_ATTACHMENT_INDEX_ENTRIES) : rows).map(toEntry),
      truncated,
    };
  }

  private statementFor(family: MimeFamily | null): Database.Statement {
    const key = family ?? "";
    const cached = this.statements.get(key);
    if (cached) return cached;
    // The predicate is looked up in a code-level table by an already
    // allowlist-validated key (`validateFamily`), never built from input; the
    // owner kind and the folded query below stay bound as ordinary parameters.
    const familyClause = family === null ? "1 = 1" : FAMILY_PREDICATES[family];
    const statement = this.db.prepare(
      `SELECT ${ENTRY_COLUMNS} FROM (${UNION_SQL})
        WHERE (? IS NULL OR owner_kind = ?)
          AND ${familyClause}
          AND (? IS NULL OR instr(nx_fold(file_name), ?) > 0 OR instr(nx_fold(owner_title), ?) > 0)
        ORDER BY created_at DESC, id DESC
        LIMIT ?`,
    );
    this.statements.set(key, statement);
    return statement;
  }
}

function toEntry(row: AttachmentIndexRow): AttachmentIndexEntry {
  return {
    id: row.id,
    ownerKind: row.owner_kind,
    ownerId: row.owner_id,
    ownerTitle: row.owner_title,
    fileName: row.file_name,
    mime: row.mime,
    sizeBytes: row.size_bytes,
    sha256: row.sha256,
    createdAt: row.created_at,
  };
}

function validateOwnerKind(value: AttachmentOwnerKind | null | undefined): AttachmentOwnerKind | null {
  if (value === undefined || value === null) return null;
  if (!OWNER_KINDS.includes(value)) {
    throw new AttachmentIndexValidationError(`Unknown attachment owner kind "${String(value)}".`);
  }
  return value;
}

function validateFamily(value: MimeFamily | null | undefined): MimeFamily | null {
  if (value === undefined || value === null) return null;
  if (!(MIME_FAMILIES as readonly string[]).includes(value)) {
    throw new AttachmentIndexValidationError(`Unknown mime family "${String(value)}".`);
  }
  return value;
}

/**
 * The query as SQL will meet it: folded here so the comparison happens against
 * `nx_fold`'s output on the other side, and `null` for anything blank — an
 * empty search box is not a filter, and a bound empty string would match every
 * row through `instr` anyway, which is the same answer said less clearly.
 */
function validateQuery(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  if (value.length > MAX_ATTACHMENT_QUERY_LENGTH) {
    throw new AttachmentIndexValidationError(
      `A query must not exceed ${MAX_ATTACHMENT_QUERY_LENGTH} characters.`,
    );
  }
  const folded = foldSearchText(value.trim());
  return folded.length === 0 ? null : folded;
}
