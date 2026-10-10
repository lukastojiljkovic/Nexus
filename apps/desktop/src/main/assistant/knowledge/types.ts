import type Database from "better-sqlite3-multiple-ciphers";
import type {
  AppLocation,
  AssistantLocale,
  Embedder,
  KnowledgeService,
  SourceKind,
} from "@nexus/core";

type DatabaseHandle = Database.Database;

/**
 * The knowledge base's own vocabulary: what a source yields, what one retrievable
 * passage is, and what the service is handed when it is created.
 *
 * The contract (`@nexus/core`'s `assistant/contract.ts`) fixes what the REST of
 * the assistant sees - `KnowledgeService`, `KnowledgeQuery`, `KnowledgeHit`,
 * `Citation`. Everything here is between the service and its sources, so it is
 * free to change with them, and nothing outside this folder may depend on it.
 */

/** Every kind of source the base indexes, in the order a status report should read them. */
export const KNOWLEDGE_KINDS: readonly SourceKind[] = [
  "app-manual",
  "note",
  "task",
  "event",
  "file",
  "pack",
  "wiki",
];

/**
 * One thing a source yields: the passage material AND the citation it will be
 * cited by.
 *
 * `text` is the whole document's text, not a chunk - chunking is the service's,
 * so every source produces the same shapes from the same rule and a source never
 * has to know what a chunk is. `marker` is the source's own change marker: the
 * service stores it, compares nothing, and only ever hands it back to the same
 * source.
 */
export interface IndexedDocument {
  readonly kind: SourceKind;
  /** The source's own identity for this document, unique within its kind and locale. */
  readonly id: string;
  /** The language the text is written in; `""` for a source that is not language-specific. */
  readonly locale: AssistantLocale | "";
  readonly title: string;
  readonly text: string;
  /**
   * Words to make the document findable by, folded into the searchable haystack
   * beside the passage and never shown. The app manual's front matter carries
   * them; a source without them omits the field.
   */
  readonly keywords?: readonly string[];
  readonly packId?: string;
  /** Set for a passage from a pack whose `notice` is `"safety"`. */
  readonly safety?: boolean;
  /** Where opening the citation takes the user, when the source knows a place. */
  readonly location?: AppLocation;
  readonly marker: string;
}

/** One passage, as the chunker cut it: the text and the heading path it sits under. */
export interface ChunkDraft {
  readonly text: string;
  /** `null` when the document has no headings at all. */
  readonly locator: string | null;
}

/**
 * What a pass must do with documents this source no longer yields.
 *
 * `entries` is the common case for the profile's own records: the rows are
 * projected into `search_entries` by migration 017's triggers, live-ness and
 * the private-vault exclusion are already decided there, and one anti-join
 * against that table is both cheaper and truer than any list this process could
 * build. `ids` is for a source whose liveness lives outside the database (the
 * bundled manual, the packs on disk, a wiki reader). `none` is for a source that
 * indexes nothing at all.
 */
export type SourcePrune =
  | { readonly mode: "entries"; readonly kinds: readonly SourceKind[] }
  | { readonly mode: "ids"; readonly kind: SourceKind; readonly ids: readonly string[] }
  | { readonly mode: "none" };

/** One source's answer to "what has changed since the marker I gave you". */
export interface SourceBatch {
  /** The documents to (re)index. Empty is the ordinary answer to "nothing changed". */
  readonly documents: readonly IndexedDocument[];
  /** The marker to store once this batch is committed. */
  readonly cursor: string;
  readonly prune: SourcePrune;
  /**
   * True when the source stopped at its own batch limit: the pass calls again
   * with the returned cursor before it prunes anything, because a prune is a
   * statement about the whole source and a half-walked source would make it
   * delete what the next page is about to re-index.
   */
  readonly more: boolean;
}

/**
 * One adapter over one kind of material.
 *
 * `collect` receives the marker it was last left with (or `null`) and answers
 * with changed documents plus the marker to store. It is allowed to answer with
 * everything every time - the callers write documents idempotently - so a source
 * whose change marker is a fingerprint rather than a timestamp stays simple.
 */
export interface KnowledgeSource {
  /** The cursor's key in the database, and the name a failure is reported under. */
  readonly name: string;
  readonly kinds: readonly SourceKind[];
  collect(cursor: string | null, signal: AbortSignal): Promise<SourceBatch>;
}

/** One article a wiki reader offers for a query, best first. */
export interface WikiTitle {
  /** The reader's own article path, handed back to `readArticle` unchanged. */
  readonly path: string;
  readonly title: string;
}

/**
 * The offline encyclopaedia, as the knowledge base uses it - the seam the ZIM
 * run's reader implements.
 *
 * Deliberately two calls and no enumeration. A whole Wikipedia is tens of
 * gigabytes and millions of articles: indexing it into a profile's database is
 * neither affordable nor useful, so the wiki is not indexed at rest at all. The
 * reader searches its own title index for what was asked, and the knowledge base
 * reads the LEAD SECTION of the few articles that came back - which is the part
 * that answers "what is this", and the part a passage-sized citation can carry.
 * The full article is never read into the index, and never into an answer.
 */
export interface WikiSource {
  searchTitles(query: string, limit: number, signal: AbortSignal): Promise<readonly WikiTitle[]>;
  /** The article's text, or `""` when the path is not there. */
  readArticle(path: string, signal: AbortSignal): Promise<string>;
}

/** Everything the service needs from main, and nothing it could reach on its own. */
export interface KnowledgeDeps {
  readonly profileId: string;
  /**
   * The profile's open, encrypted database. Main owns it; the service borrows it
   * and never opens, closes or copies it, and every statement it runs is scoped
   * by `profileId`.
   */
  readonly db: DatabaseHandle;
  /** `<userData>` - the packs directory lives under it (`packs/<id>/<version>/`). */
  readonly userData: string;
  /**
   * The pinned release key the installed packs' manifests are verified against.
   * `null` turns the packs source off rather than reading a pack nobody verified.
   */
  readonly packPublicKeyPem: string | null;
  /**
   * The embedding model in memory, or `null` when none is loaded. Called on
   * every pass and every search rather than cached: the runtime can load and
   * unload a model while this service lives, and full-text search must keep
   * working through all of it.
   */
  readonly embedder: () => Promise<Embedder | null>;
  /** The ZIM reader, once it exists. Absent means the wiki kind answers nothing. */
  readonly wiki?: WikiSource;
  /** The manual's pages. Defaults to the Markdown bundled into this build. */
  readonly manualPages?: readonly ManualPage[];
  /**
   * False once this profile's database has been locked or superseded - checked
   * before every batch, which is what makes a lock stop an indexing pass instead
   * of letting it write to a closed connection.
   */
  readonly isSessionLive?: () => boolean;
  /** False to leave the first pass to the caller. Defaults to true. */
  readonly autoIndex?: boolean;
}

/** One bundled manual page: its path inside the bundle, and its raw Markdown. */
export interface ManualPage {
  /** `assistant/manual/<locale>/<name>.md`, as the glob reported it. */
  readonly path: string;
  readonly text: string;
}

/**
 * The service, plus the one method the module needs to drive indexing itself.
 * Structurally a `KnowledgeService`, so the wiring can take it as one.
 */
export interface KnowledgeIndex extends KnowledgeService {
  /** One incremental pass over every source, batched and cancellable. */
  sync(signal: AbortSignal): Promise<void>;
}
