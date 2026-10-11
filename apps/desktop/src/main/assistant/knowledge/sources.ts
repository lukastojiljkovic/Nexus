import { readFileSync } from "node:fs";
import { join } from "node:path";
import type Database from "better-sqlite3-multiple-ciphers";
import type { SourceKind } from "@nexus/core";
import { isTextIndexableAttachment } from "../../attachmentText.js";
import { isSafePackPath } from "../../packs/paths.js";
import { packVersionDir, readInstalled } from "../../packs/registry.js";
import type { RankedHit } from "./fusion.js";
import { bundledManualPages, manualDocument } from "./manual.js";
import { contentMarker, leadSection, parseMarkdownUnits, parsePage } from "./markup.js";
import type { IndexedDocument, KnowledgeSource, ManualPage, SourceBatch, WikiSource } from "./types.js";

type DatabaseHandle = Database.Database;

/**
 * The sources: one adapter per kind of material the assistant can retrieve from,
 * each answering "what has changed since the marker I gave you".
 *
 * **Every source is read-only, and every source reads something that already
 * exists.** Nothing here discovers content the rest of the application does not
 * show its own user: the profile's records come from `search_entries` - the table
 * migration 017's triggers maintain, which is where soft-deleted rows are already
 * gone and where the private vault is already absent, because its sealed tables
 * have no projection view at all. That is not a shortcut around re-writing the
 * liveness rules; it is the rule that there is exactly ONE statement of what a
 * note or a task contributes to a search, and the assistant reads it rather than
 * inventing a second one that could disagree.
 *
 * **Three shapes of change marker, and each says why.** The profile's records
 * page by `(updated_at, entity_id)`, because ISO timestamps tie - a bulk import
 * stamps a thousand rows in the same millisecond - and a keyset walk over the
 * pair is the only cursor that neither repeats nor skips one. The file-backed
 * sources (the manual, the packs, attachment text) carry a FINGERPRINT of the
 * whole set: they are small, they change by being replaced rather than by being
 * edited, and a fingerprint makes "has anything moved at all" a cheap question
 * asked before any file is read.
 *
 * **Text longer than one answer can cite is not all indexed.** A source caps
 * what one document contributes (`MAX_INDEXED_CHARS`); past that the head of the
 * document is what a passage can be drawn from, and the rest stays reachable
 * through the app's own search and preview.
 */

/** Rows one collect may read from `search_entries`; the pass calls again until a short batch arrives. */
export const RECORDS_BATCH_SIZE = 200;

/**
 * The most text one document contributes to the index.
 *
 * 200 000 characters is about fifty thousand tokens - far past anything an
 * answer can quote, and far past the point where the tail of a document is ever
 * retrieved by a passage-sized query. It exists so that one pasted megabyte
 * cannot make a single indexing pass hold that megabyte, four times over, on its
 * way to passages nothing would rank.
 */
export const MAX_INDEXED_CHARS = 200_000;

/** How many wiki titles one query reads the lead of. See `types.ts` on why a whole encyclopaedia is never indexed. */
export const WIKI_TITLE_LIMIT = 5;

/** How much of a wiki article's lead one passage carries. */
export const WIKI_LEAD_MAX_CHARS = 2_000;

function capText(text: string): string {
  return text.length > MAX_INDEXED_CHARS ? text.slice(0, MAX_INDEXED_CHARS) : text;
}

// --- the profile's own records ------------------------------------------------

interface RecordRow {
  entity_id: string;
  title: string;
  body: string;
  updated_at: string;
}

/**
 * A keyset cursor over `(updated_at, entity_id)`, stored opaquely by the service.
 *
 * The pair and not the timestamp alone, because a bulk import stamps thousands
 * of rows in one millisecond. The entity id is what makes the walk progress
 * there, and it is also why a row created AFTER the cursor is never behind it:
 * entity ids are UUIDv7, so a newer row in the same millisecond has a larger id.
 */
function keyset(updatedAt: string, entityId: string): string {
  return `${updatedAt}\u0000${entityId}`;
}

function parseKeyset(cursor: string | null): { updatedAt: string; entityId: string } | null {
  if (cursor === null) return null;
  const at = cursor.indexOf("\u0000");
  if (at <= 0) return null;
  return { updatedAt: cursor.slice(0, at), entityId: cursor.slice(at + 1) };
}

/**
 * One of the three kinds that live in `search_entries` - a note, a task, an
 * event - as a source.
 *
 * `search_source_note` is the whole reason a note's text is what it is: the
 * projection carries the note's latest COMPACTED plaintext (ADR-015), so a note
 * that has never been compacted contributes its title and no body. That is the
 * same trade the app's own search makes, and the reason to make it twice is the
 * same one: a second reader of the Yjs update log would be a second definition
 * of what a note says, and the two would disagree exactly when it mattered.
 */
export function recordsSource(
  db: DatabaseHandle,
  profileId: string,
  kind: Extract<SourceKind, "note" | "task" | "event">,
): KnowledgeSource {
  const first = db.prepare(
    `SELECT entity_id, title, body, updated_at FROM search_entries
     WHERE profile_id = ? AND kind = ?
     ORDER BY updated_at, entity_id
     LIMIT ?`,
  );
  const next = db.prepare(
    `SELECT entity_id, title, body, updated_at FROM search_entries
     WHERE profile_id = ? AND kind = ?
       AND (updated_at > ? OR (updated_at = ? AND entity_id > ?))
     ORDER BY updated_at, entity_id
     LIMIT ?`,
  );

  return {
    name: kind,
    kinds: [kind],
    collect(cursor): Promise<SourceBatch> {
      const keysetCursor = parseKeyset(cursor);
      const rows = (
        keysetCursor === null
          ? first.all(profileId, kind, RECORDS_BATCH_SIZE)
          : next.all(
              profileId,
              kind,
              keysetCursor.updatedAt,
              keysetCursor.updatedAt,
              keysetCursor.entityId,
              RECORDS_BATCH_SIZE,
            )
      ) as RecordRow[];

      const documents: IndexedDocument[] = [];
      let marker = cursor ?? "";
      for (const row of rows) {
        marker = keyset(row.updated_at, row.entity_id);
        if (row.body.trim() === "") continue;
        documents.push({
          kind,
          id: row.entity_id,
          locale: "",
          title: row.title,
          text: capText(row.body),
          marker,
        });
      }
      const more = rows.length === RECORDS_BATCH_SIZE;
      return Promise.resolve({
        documents,
        cursor: marker,
        // Pruning is the LAST thing a pass does for a kind: it asks the database
        // what still exists, which is a question whose answer is only settled
        // once every page of the walk has been read.
        prune: more ? { mode: "none" } : { mode: "entries", kinds: [kind] },
        more,
      });
    },
  };
}

// --- attachment text ----------------------------------------------------------

interface AttachmentRow {
  id: string;
  file_name: string;
  mime: string;
  size_bytes: number;
  text: string;
  parent_id: string;
  owner: "note" | "task";
}

const ATTACHMENT_DOCUMENTS = `
  SELECT a.id AS id, a.file_name AS file_name, a.mime AS mime, a.size_bytes AS size_bytes,
         a.extracted_text AS text, a.note_id AS parent_id, 'note' AS owner
  FROM note_attachments a JOIN notes n ON n.id = a.note_id
  WHERE n.profile_id = ? AND n.deleted_at IS NULL
    AND a.extracted_text IS NOT NULL AND a.extracted_text <> ''
  UNION ALL
  SELECT a.id AS id, a.file_name AS file_name, a.mime AS mime, a.size_bytes AS size_bytes,
         a.extracted_text AS text, a.task_id AS parent_id, 'task' AS owner
  FROM task_attachments a JOIN tasks t ON t.id = a.task_id
  WHERE t.profile_id = ? AND t.deleted_at IS NULL
    AND a.extracted_text IS NOT NULL AND a.extracted_text <> ''
  ORDER BY id`;

const ATTACHMENT_FINGERPRINT = `
  SELECT count(*) AS n, coalesce(sum(length(a.extracted_text)), 0) AS chars,
         coalesce(max(a.created_at), '') AS latest
  FROM note_attachments a JOIN notes n ON n.id = a.note_id
  WHERE n.profile_id = ? AND n.deleted_at IS NULL
    AND a.extracted_text IS NOT NULL AND a.extracted_text <> ''`;

const TASK_ATTACHMENT_FINGERPRINT = `
  SELECT count(*) AS n, coalesce(sum(length(a.extracted_text)), 0) AS chars,
         coalesce(max(a.created_at), '') AS latest
  FROM task_attachments a JOIN tasks t ON t.id = a.task_id
  WHERE t.profile_id = ? AND t.deleted_at IS NULL
    AND a.extracted_text IS NOT NULL AND a.extracted_text <> ''`;

/**
 * The text of attachments, as a source.
 *
 * The text is the one `main/attachmentText.ts` extracted - the same module that
 * decided the file was indexable in the first place, at the moment it was
 * attached or when the backfill reached it. Nothing is decoded here, which is
 * deliberate: reading the bytes again would mean either a second decoder or a
 * second trip through the encrypted blob store on every pass, for text that is
 * already sitting beside the file's name in the database.
 *
 * One document per attachment rather than one per parent record: a citation to a
 * file should open the file's owner with the file named, not claim the note said
 * what the PDF said.
 */
export function attachmentSource(db: DatabaseHandle, profileId: string): KnowledgeSource {
  const documents = db.prepare(ATTACHMENT_DOCUMENTS);
  const fingerprintNotes = db.prepare(ATTACHMENT_FINGERPRINT);
  const fingerprintTasks = db.prepare(TASK_ATTACHMENT_FINGERPRINT);

  const fingerprintOf = (): string => {
    const notes = fingerprintNotes.get(profileId) as { n: number; chars: number; latest: string };
    const tasks = fingerprintTasks.get(profileId) as { n: number; chars: number; latest: string };
    return contentMarker([
      `note:${String(notes.n)}:${String(notes.chars)}:${notes.latest}`,
      `task:${String(tasks.n)}:${String(tasks.chars)}:${tasks.latest}`,
    ]);
  };

  return {
    name: "file",
    kinds: ["file"],
    collect(cursor): Promise<SourceBatch> {
      const fingerprint = fingerprintOf();
      if (cursor === fingerprint) {
        return Promise.resolve({ documents: [], cursor: fingerprint, prune: { mode: "none" }, more: false });
      }
      const rows = documents.all(profileId, profileId) as AttachmentRow[];
      const indexed = rows
        // The eligibility rule is re-asked of the ROW rather than inferred from
        // the text's presence: `isTextIndexableAttachment` is the same rule
        // `attachmentText.ts` extracted under, and a row whose text was written
        // by an older build (or by a backfill that ran before this check) must
        // not enter the index just because a string sits there.
        .filter((row) => isTextIndexableAttachment(row.mime, row.file_name, row.size_bytes))
        .map((row) => ({
          kind: "file" as const,
          id: row.id,
          locale: "" as const,
          title: row.file_name,
          text: capText(row.text),
          location: { module: row.owner === "note" ? "notes" : "tasks", item: row.parent_id },
          marker: fingerprint,
        }));
      return Promise.resolve({
        documents: indexed,
        cursor: fingerprint,
        prune: { mode: "ids", kind: "file", ids: indexed.map((document) => document.id) },
        more: false,
      });
    },
  };
}

// --- the app manual -----------------------------------------------------------

/**
 * The bundled manual, as a source.
 *
 * The fingerprint is over the pages' own text, so an application update that
 * changed one page re-indexes the manual and a start on an unchanged build does
 * nothing at all. The documents' own ids already carry the locale
 * (`manual.ts`), so a Serbian page and its English twin are two documents with
 * two identities and neither replaces the other.
 */
export function manualSource(pages: readonly ManualPage[]): KnowledgeSource {
  return {
    name: "app-manual",
    kinds: ["app-manual"],
    collect(cursor): Promise<SourceBatch> {
      const fingerprint = contentMarker(pages.map((page) => `${page.path}\u0001${page.text}`));
      if (cursor === fingerprint) {
        return Promise.resolve({ documents: [], cursor: fingerprint, prune: { mode: "none" }, more: false });
      }
      const documents: IndexedDocument[] = [];
      for (const page of pages) {
        const document = manualDocument(page);
        if (document !== null) documents.push(document);
      }
      return Promise.resolve({
        documents,
        cursor: fingerprint,
        prune: { mode: "ids", kind: "app-manual", ids: documents.map((document) => document.id) },
        more: false,
      });
    },
  };
}

// --- content packs ------------------------------------------------------------

/** What a `content` pack's `content.json` says. See the ADR for the format's one version. */
interface ContentArticle {
  readonly path: string;
  readonly title?: string;
  readonly keywords?: readonly string[];
}

interface ContentManifest {
  readonly notice: "safety" | null;
  readonly articles: readonly ContentArticle[];
}

const CONTENT_MANIFEST_FILE = "content.json";
const CONTENT_FORMAT = 1;
const CONTENT_KEYS: readonly string[] = ["format", "notice", "articles"];
const ARTICLE_KEYS: readonly string[] = ["path", "title", "keywords"];

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/**
 * A content pack's manifest, or `null` when it is not one this build reads.
 *
 * Strict in exactly the way `packs/manifest.ts` is strict about `pack.json`, and
 * for the same reason: an unknown field is either a typo or a newer format's
 * field, and both are read worse than refused. The difference is the
 * consequence - a pack whose content manifest cannot be read is SKIPPED rather
 * than refused, because the pack has already been installed and verified, and a
 * reader that refused to list its articles would take the pack's content away
 * from the assistant without taking it away from the user.
 */
function parseContentManifest(value: unknown): ContentManifest | null {
  const record = asRecord(value);
  if (record === null) return null;
  for (const key of Object.keys(record)) {
    if (!CONTENT_KEYS.includes(key)) return null;
  }
  if (record["format"] !== CONTENT_FORMAT) return null;
  const notice = record["notice"];
  if (notice !== undefined && notice !== "safety") return null;

  const rawArticles = record["articles"];
  if (!Array.isArray(rawArticles)) return null;
  const articles: ContentArticle[] = [];
  for (const raw of rawArticles) {
    const article = asRecord(raw);
    if (article === null) return null;
    for (const key of Object.keys(article)) {
      if (!ARTICLE_KEYS.includes(key)) return null;
    }
    const path = article["path"];
    // The path rule is `packs/paths.ts`'s, reused rather than restated: a
    // content manifest names files the same way the pack manifest does, and two
    // readers that disagreed about what a path may be would be a way in.
    if (typeof path !== "string" || !isSafePackPath(path)) return null;
    if (!path.startsWith("articles/") || !path.endsWith(".md")) return null;
    const title = article["title"];
    if (title !== undefined && typeof title !== "string") return null;
    const keywords = article["keywords"];
    if (keywords !== undefined && (!Array.isArray(keywords) || keywords.some((word) => typeof word !== "string"))) {
      return null;
    }
    articles.push({
      path,
      ...(typeof title === "string" ? { title } : {}),
      ...(Array.isArray(keywords) ? { keywords: keywords as readonly string[] } : {}),
    });
  }
  return { notice: notice === "safety" ? "safety" : null, articles };
}

/** A file's text, or `null` when it is not there or cannot be read. */
function readTextFile(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

/**
 * Every installed `content` pack's articles, as a source.
 *
 * The installed pack list comes from `packs/registry.ts`'s own
 * `readInstalled`, which re-verifies each manifest's signature against the
 * pinned release key: the assistant indexes only packs the application itself
 * trusts, and it says so by asking the module that already knows, rather than by
 * walking the folder and trusting what it finds. `packPublicKeyPem === null`
 * (no key configured) turns the source off completely rather than reading
 * unverified content.
 */
export function packSource(input: {
  readonly userData: string;
  readonly publicKeyPem: string | null;
}): KnowledgeSource {
  return {
    name: "pack",
    kinds: ["pack"],
    collect(cursor): Promise<SourceBatch> {
      const { userData, publicKeyPem } = input;
      if (publicKeyPem === null) {
        return Promise.resolve({ documents: [], cursor: "", prune: { mode: "none" }, more: false });
      }
      const installed = readInstalled(userData, publicKeyPem).filter(
        (pack) => pack.manifest.kind === "content",
      );
      const fingerprint = contentMarker(
        installed.map((pack) => `${pack.manifest.id}@${pack.manifest.version}`),
      );
      if (cursor === fingerprint) {
        return Promise.resolve({ documents: [], cursor: fingerprint, prune: { mode: "none" }, more: false });
      }

      const documents: IndexedDocument[] = [];
      for (const pack of installed) {
        const { id, version } = pack.manifest;
        const dir = packVersionDir(userData, id, version);
        const manifestText = readTextFile(join(dir, CONTENT_MANIFEST_FILE));
        if (manifestText === null) continue;
        let manifest: ContentManifest | null;
        try {
          manifest = parseContentManifest(JSON.parse(manifestText));
        } catch {
          manifest = null;
        }
        if (manifest === null) {
          console.error(`Content pack "${id}" carries no content manifest this build reads; skipping it.`);
          continue;
        }
        for (const article of manifest.articles) {
          const text = readTextFile(join(dir, ...article.path.split("/")));
          if (text === null) continue;
          documents.push(
            packArticleDocument({
              packId: id,
              article,
              text,
              safety: manifest.notice === "safety",
              marker: fingerprint,
            }),
          );
        }
      }
      return Promise.resolve({
        documents,
        cursor: fingerprint,
        prune: { mode: "ids", kind: "pack", ids: documents.map((document) => document.id) },
        more: false,
      });
    },
  };
}

/** One article of one pack, as a document - its own front matter first, the manifest's entry second. */
function packArticleDocument(input: {
  readonly packId: string;
  readonly article: ContentArticle;
  readonly text: string;
  readonly safety: boolean;
  readonly marker: string;
}): IndexedDocument {
  const parsed = parsePage(input.text);
  const heading = parseMarkdownUnits(parsed.body)[0]?.headings[0];
  const stem = (input.article.path.split("/").pop() ?? input.article.path).replace(/\.md$/i, "");
  const title =
    parsed.frontMatter?.scalars.get("title") ?? input.article.title ?? heading ?? stem;
  const keywords = parsed.frontMatter?.lists.get("keywords") ?? input.article.keywords ?? [];
  const document: {
    kind: "pack";
    id: string;
    locale: "";
    title: string;
    text: string;
    keywords?: readonly string[];
    packId: string;
    safety?: boolean;
    marker: string;
  } = {
    kind: "pack",
    id: `${input.packId}/${input.article.path}`,
    locale: "",
    title,
    text: capText(parsed.body),
    packId: input.packId,
    marker: input.marker,
  };
  if (keywords.length > 0) document.keywords = keywords;
  if (input.safety) document.safety = true;
  return document;
}

// --- the wiki, live -----------------------------------------------------------

/**
 * The wiki as a source that indexes nothing.
 *
 * It is a source all the same, and not a special case in the pass: it has a name
 * and a cursor like the others, so the status report counts it and a reader that
 * stops answering is visible in the same place as everything else. What it never
 * does is write rows - `wikiHits` below reads the lead of what a query found,
 * within the one query that asked for it.
 */
export function wikiSource(): KnowledgeSource {
  return {
    name: "wiki",
    kinds: ["wiki"],
    collect(): Promise<SourceBatch> {
      return Promise.resolve({
        documents: [],
        // A constant: there is no indexed state to compare, and a cursor that
        // never changes is what keeps the source out of the pending count after
        // its first pass.
        cursor: "live",
        prune: { mode: "none" },
        more: false,
      });
    },
  };
}

/**
 * The wiki list for one query: the reader's best titles, each answered with the
 * lead of its article, in the reader's own order.
 *
 * The order is the ranking - there is no text search over wiki content, because
 * there is no wiki content in the index to search - so the list enters the fusion
 * as ranks, which is exactly what reciprocal rank fusion wants. An article the
 * reader lists but cannot read is skipped rather than cited as an empty passage.
 */
export async function wikiHits(
  wiki: WikiSource,
  text: string,
  signal: AbortSignal,
): Promise<RankedHit[]> {
  const titles = await wiki.searchTitles(text, WIKI_TITLE_LIMIT, signal);
  const hits: RankedHit[] = [];
  for (const title of titles) {
    if (signal.aborted) break;
    const article = await wiki.readArticle(title.path, signal);
    if (article.trim() === "") continue;
    const lead = leadSection(article, WIKI_LEAD_MAX_CHARS);
    // A lead that is empty because the article opens straight into a section:
    // the first paragraph is then the honest passage.
    const passage =
      lead !== ""
        ? lead
        : (parseMarkdownUnits(article)
            .map((unit) => unit.text)
            .join(" ")
            .slice(0, WIKI_LEAD_MAX_CHARS)
            .trim());
    if (passage === "") continue;
    hits.push({
      key: `w:${title.path}`,
      citation: { kind: "wiki", id: title.path, title: title.title, locator: "lead" },
      text: passage,
    });
  }
  return hits;
}

// --- assembly -----------------------------------------------------------------

export interface AssembledSources {
  readonly sources: readonly KnowledgeSource[];
  readonly wiki: WikiSource | null;
}

/**
 * Every source this build can index, in the order the status report reads them.
 *
 * The manual's pages come from the caller when it has some (a test, or a build
 * that inlined its own) and from the bundle otherwise, and the packs source is
 * simply absent when no release key is configured - a source that can only ever
 * answer "nothing" is not registered as one.
 */
export function createSources(input: {
  readonly db: DatabaseHandle;
  readonly profileId: string;
  readonly userData: string;
  readonly packPublicKeyPem: string | null;
  readonly wiki: WikiSource | null;
  readonly manualPages: readonly ManualPage[];
}): AssembledSources {
  const sources: KnowledgeSource[] = [
    manualSource(input.manualPages),
    recordsSource(input.db, input.profileId, "note"),
    recordsSource(input.db, input.profileId, "task"),
    recordsSource(input.db, input.profileId, "event"),
    attachmentSource(input.db, input.profileId),
  ];
  if (input.packPublicKeyPem !== null) {
    sources.push(packSource({ userData: input.userData, publicKeyPem: input.packPublicKeyPem }));
  }
  if (input.wiki !== null) sources.push(wikiSource());
  return { sources, wiki: input.wiki };
}

/** The default manual pages: what the build inlined. */
export function defaultManualPages(): readonly ManualPage[] {
  return bundledManualPages();
}
