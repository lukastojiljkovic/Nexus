# ADR-104 — The assistant's knowledge base (local RAG)

**Status:** accepted (2026-10-10) · **Owner:** founder

The assistant answers from what is on this machine. This ADR fixes how it finds
the passages it answers from: which material is indexed, where the index lives,
how a passage is cut, how a query is matched, and what a citation is. It owns
migration `090-assistant-knowledge.ts`, the tables in the profile's encrypted
database, and `createKnowledgeService` under
`apps/desktop/src/main/assistant/knowledge/`.

## 1. The finding

Four requirements met in one place.

1. **The assistant has to know things nobody will type into it.** A question
   ("what did I write about the garage last month?", "how do I turn a module
   off?") is answered by RETRIEVAL, not by a model's memory: the model was
   trained before this user's notes existed, and an offline model has no other
   source of truth.
2. **The material is the user's, so it is encrypted.** Notes, tasks, events and
   attachment text already live in the profile's SQLCipher database. An index
   over them that sat in a plaintext file would be a second, more readable copy
   of everything the encryption exists to protect.
3. **It has to work offline, and with no model loaded.** The user may never
   download an embedding model, and the model they did download can be unloaded
   while the app runs. Retrieval that only works with a vector model is
   retrieval that stops working.
4. **It must not be able to reach the network.** The knowledge base indexes what
   is installed locally. Nothing in it opens a socket; `check:egress` is green by
   construction, not by review.

## 2. The shape

`createKnowledgeService(deps): KnowledgeService` is the whole public surface: the
contract's `search`, `status` and `reindex`, plus `sync` (one incremental pass)
for the module that will drive it. Everything below is inside that folder.

**Four tables, in the profile's encrypted database** (migration
`090-assistant-knowledge.ts`):

| Table | What one row is |
| --- | --- |
| `knowledge_chunks` | one retrievable passage, with the fields its citation needs |
| `knowledge_fts` | a contentless FTS5 index over the folded haystack, addressed by chunk id |
| `knowledge_vectors` | one passage's embedding, with the model id and width that produced it |
| `knowledge_cursors` | the change marker of one source, stored opaquely |

The tables hold **derived** data and nothing else. There is no source of truth
in them: `reindex` empties the profile's rows and rebuilds them from the sources,
which is also why they carry no timestamps and why they are not in the export
archive. An index is a cache of what the databases already say.

Every row is scoped by `profile_id`, including its uniqueness rule
(`(profile_id, kind, source_id, locale, ordinal)`): one account's file holds
several profiles, and two profiles index the same manual page and the same pack
article.

## 3. The sources

Seven kinds, each an adapter that yields documents plus the change marker it was
left at. Adding a source means adding a file, not a second search path.

- **`app-manual`** — the Markdown pages the build inlines
  (`assistant/manual/<locale>/<page>.md`, through `import.meta.glob(..., { query:
  "?raw", eager: true })`). The front matter (`id`, `title`,
  `location: { module, settings? }`, `keywords`) is the citation: `location` is
  where opening the passage takes the user, which is the point of an assistant
  that explains the app from inside the app. The id carries the locale
  (`sr/podesavanja`) because the same page ships twice and `Citation` has no
  locale field. Keywords are folded into the searchable text beside the passage
  and never shown.
- **`note`, `task`, `event`** — the profile's own records, read through
  `search_entries`: the table migration 017's triggers maintain. This is
  deliberate and it is the most important decision in this ADR. That projection
  is already the single answer to "what does a note contribute to a search": it
  applies the 8 000-character per-entry cap, it is maintained by triggers rather
  than by any writer remembering, a soft delete removes a row the moment it
  happens, and a note's text is its latest COMPACTED plaintext (ADR-015). A
  second reader of `note_updates` here would be a second definition of what a
  note says, and the two would disagree exactly when it mattered.
- **`file`** — attachment text, from the `extracted_text` column main's own
  `attachmentText.ts` filled when the file was attached (SRCH-008). Reading the
  encrypted blob again on every pass would mean a second decoder or a second trip
  through the blob store for text that is already in the database; the
  eligibility rule is that module's, reused rather than restated.
- **`pack`** — every installed `content` pack's articles. The installed list
  comes from `packs/registry.ts`'s `readInstalled`, which re-verifies each
  manifest's signature against the pinned release key, so the assistant reads
  only packs the application itself trusts. `packPublicKeyPem === null` turns the
  source off rather than reading unverified content. The pack's `notice` becomes
  `Citation.safety` on every passage it produced (§7).
- **`wiki`** — the ZIM reader's seam, defined here and implemented by the ZIM
  run (`WikiSource`: `searchTitles`, `readArticle`). The wiki is **never indexed
  at rest**: a whole Wikipedia is tens of gigabytes and millions of articles, so
  the reader searches its own title index for what was asked and the knowledge
  base reads the LEAD of the few articles that came back — the part that answers
  "what is this", and the part a passage-sized citation can carry. The full
  article is never read into the index and never into an answer.

### The private vault

**Private notes are excluded, and by construction rather than by a filter.**
Migration 045's sealed tables feed no projection view at all, so there is no
`search_entries` row for a private note and therefore nothing for this service to
index, prune or accidentally retrieve. `service.test.ts` and `sources.test.ts`
both pin it. The knowledge base is not permitted to invent a second path to
content the rest of the application shows only behind its own credential.

## 4. Chunking

By heading and by paragraph, with a heading as a HARD boundary (a passage never
spans two sections, so its locator is true rather than approximate).

| Constant | Value | Why |
| --- | --- | --- |
| target | 320 tokens | every embedding model in the runtime's catalogue accepts at least 512; 320 leaves room for the title line and stays far above the ~100-token floor at which a passage stops carrying context |
| overlap | 64 tokens | a fifth of the target: a sentence straddling a boundary stays retrievable from both sides |
| maximum | 480 tokens | a ceiling, not a second target — a wall of text with no paragraph breaks (pasted, or an attachment) is split at it instead of producing a passage no embedder can take whole |

The size is an ESTIMATE: four characters per token (`CHARS_PER_TOKEN`), the usual
order of magnitude for BPE models on Latin-script text. There is no tokenizer
here and there cannot be one — the embedder's tokenizer belongs to the model
runtime, and an approximation that names itself is more honest than a second
tokenizer that would silently disagree with the model actually loaded. The
thresholds are constants so they can be retuned against real token counts.

Each passage carries its locator (its heading path), and the locator is part of
the searchable text: a section heading is a strong signal, and the chunker is
where the path is known.

## 5. Search

Three ranked lists, fused by reciprocal rank fusion.

1. **Full text, in the encrypted database.** SQLite FTS5 with the app's own
   analyzer: `unicode61 remove_diacritics 2` over text folded by `nx_fold`
   (ADR-021's `foldSearchText`, registered on the connection), the same two
   layers `search_fts` uses. A query is parsed by the app's own
   `parseSearchQuery`, so a folded index always meets a folded query halfway, and
   the terms are joined with **OR** (`knowledge/query.ts`) where the palette joins
   them with a space. The palette's AND is right for two or three words a user
   typed deliberately and wrong for a question: Serbian inflection alone means
   `iskljuciti` does not match a page that says `isključuje`, so an AND over a
   sentence returns nothing, and an assistant that finds nothing answers from the
   model's memory instead of the user's material. Recall comes from the
   expression, precision from bm25 and from the fusion - a passage sharing three
   terms still outranks one sharing a single term. Ranking is `bm25()`, ties
   broken by chunk id.
2. **Vectors.** The query is embedded by whichever `Embedder` is loaded, and the
   passage vectors are scanned by brute force with a true cosine (the contract
   normalises; computing the cosine anyway costs one square root per candidate
   and survives a model that quietly stops normalising). A passage at or below
   zero similarity is **not a candidate**: without that floor every row in the
   corpus arrives at some rank and fusion has no way to tell a passage that
   matched from one that merely existed.
3. **The wiki's live titles** (§3), in the reader's own order.

Fusion is RRF — `score(d) = Σ 1/(k + rank(d, list))`, ranks from 1, `k = 60` —
from Cormack, Clarke and Buettcher, "Reciprocal rank fusion outperforms Condorcet
and individual rank learning methods", SIGIR 2009,
<https://doi.org/10.1145/1571941.1572114>. Ranks and not scores, because bm25 is
negative and query-dependent, a cosine is −1..1, and a wiki reader has its own
order: normalising three numbers with three meanings invents a scale, and the
invention is invisible. Ties break by a stable key, never by the order the lists
happened to be concatenated in.

Two knobs, both stated: each list offers up to four times the requested `limit`
(never more than 200 rank positions) because fusion can only rank what it is
given, and one search returns at most 200 hits however many the caller asks for.
`kinds` narrows the result set; a kind this build does not index narrows to
nothing, never to everything.

**With no embedder loaded, the first list is the whole answer.** That is the
requirement, and it is why the embedder is asked for on every call instead of
being cached: the runtime can load and unload a model while this service lives.

## 6. Indexing

One pass per source, started unawaited, batched, and cancellable.

- **Batched, and it yields.** Documents are written one at a time, with the event
  loop handed back between them, so a pass over a large library never stalls
  main. `recordsSource` pages its read by keyset over `(updated_at, entity_id)` —
  not by timestamp alone, because a bulk import stamps thousands of rows in the
  same millisecond and a timestamp cursor would repeat or skip them.
- **Cancellable, and the lock stops it.** `isSessionLive` (the profile's lock or
  close) and the caller's `AbortSignal` are both checked before every batch; a
  stopped pass leaves its cursors where it got to and resumes from there.
- **Three shapes of change marker.** The records page by keyset; the file-backed
  sources (manual, packs, attachment text) carry a fingerprint of the whole set,
  asked before any file is read; the wiki carries a constant, because it indexes
  nothing.
- **Deletion is pruning, and it prunes against the database.** A records-backed
  kind is pruned with one anti-join against `search_entries` — so a deleted note
  disappears from the index for the same reason it disappeared from search — and
  a file-backed source prunes by the ids the source no longer yields. A prune
  runs only after a source has been walked to its end: a half-walked source would
  otherwise delete what the next page is about to re-index.
- **A failing source is not a failing pass.** A pack this build cannot read is
  logged and skipped; the user's notes are still indexed. Same contract as
  `backfillAttachmentText`: this is background housekeeping and there is no user
  action waiting on it to fail.
- **`status` reports progress** (passages indexed, sources that have not finished
  a pass in this process, the embedder's id) and **`reindex` drops the profile's
  rows and rebuilds them**, which is the one repair that cannot leave a passage
  behind that a cursor persuaded the service to skip.

**Passages, not documents, are embedded** — in batches of 16, skipping the whole
step when no model is loaded, and dropping vectors written by a different model
when a new one is first used: one model at a time is the runtime's own shape, and
the alternative is a second set of vectors nothing will ever compare against.

## 7. Safety, privacy and the traceability rule

**The user's data never leaves the profile's encrypted database.** Every row this
service writes is in a table of that database, scoped by profile id. Nothing is
written to a cache file, a temp file or the packs directory.

**A safety pack's passages carry the disclaimer.** When a passage comes from a
pack whose `notice` is `"safety"`, its `Citation.safety` is set, and an answer
that draws on it must carry the notice, in the language of the answer:

> Samo za informisanje. Nije zamena za stručnu pomoć. Proveri informacije. U
> hitnom slučaju pozovi 112.

> For reference only. Not a substitute for professional help. Check the
> information. In an emergency, call 112.

The flag is the knowledge base's half; the sentence belongs to the answer, and
the loop that composes the answer owns exactly one copy of it. A passage from a
safety pack is also cited by its own words: the assistant points at what the
pack says rather than paraphrasing a safety instruction as its own.

**Every passage is traceable.** A `Citation` carries the kind, the source's own
id, the title, the locator (heading path), the pack id where there is one, the
safety flag, and — for the manual — where in the app to open. Nothing is quoted
from a passage that cannot be pointed at.

## 8. The content pack's own manifest (layout v1)

`pack.json` (ADR-091) describes a pack's files and licence; it says nothing about
what is INSIDE a `content` pack — and it may not: format 1 refuses an unknown
field, so a `notice` added there would make every pack carrying it uninstallable.
So the notice a pack's articles need (§7) travels in the content layout's own
manifest, which `pack.json` covers by hash like every other content file. Layout
v1 is:

```
content.json
articles/<name>.md
```

`content.json`:

```json
{
  "format": 1,
  "notice": "safety",
  "articles": [
    { "path": "articles/sta-uciniti.md", "title": "Šta učiniti", "keywords": ["pomoć"] }
  ]
}
```

- `format` is the only one this build reads; an unknown one is refused, and the
  pack is SKIPPED rather than refused as a whole — it is already installed and
  verified, and a reader that refused to list its articles would take the content
  away from the assistant without taking it away from the user.
- `notice` is optional and `"safety"` is the only value v1 defines (§7).
- `articles` lists paths relative to the pack root; each must pass
  `packs/paths.ts`'s path rule, reused rather than restated, and must be a `.md`
  file under `articles/`.
- An unknown field at any level is refused, on `pack.json`'s terms.
- An article's own front matter (`title`, `keywords`) wins over the manifest's
  entry; the first heading and then the file name are the fallbacks, so an
  article still has a title if nobody wrote one.

## 9. What is not here, and why

- **A per-pack cache file.** The brief allows pack passages to live in a
  per-pack cache because they are not personal. They are in the encrypted
  database instead, because the alternative is O(log n) improvements in exchange
  for a second, unencrypted index and a second search path — full text over a
  pack's passages needs FTS5, which means either a SQLite file outside the
  database or a hand-written scorer. One search path, one storage rule, and the
  cost is that a pack's passages are re-derived per profile.
- **A vector index (HNSW or similar).** Brute force at 50 000 passages measures
  342 ms (§10); an index would add a dependency, a tuning parameter and a
  staleness bug to save three tenths of a second on the slowest search a profile
  can make.
- **A reranker or a cross-encoder.** Nothing in the catalogue is a reranker, and
  a second model to load is a second thing that must be downloaded before the
  assistant can answer.
- **Indexing a whole ZIM** (§3).
- **A second reader for note text.** §3's `search_entries` reasoning.
- **A note or task whose text is empty contributes no passage.** Its title is
  still findable in the app's own search; the knowledge base answers from what
  the user wrote.
- **Score normalisation instead of RRF** — §5.

## 10. The measurement

`perf.test.ts` seeds 50 000 passages of 384 dimensions (77 MB of Float32 blobs)
and measures the brute-force scan that a search runs. Measured on the maintainer's
machine on 2026-10-10, while the rest of this wave's worktrees were running:

**342 ms** for the scan (decoding every blob plus 19.2 million multiply-adds),
returning the 10 best. The test asserts a 10 000 ms bound, which fails a hang
rather than a busy CI machine, and the number above is what the design rests on.

## 11. Consequences

- `check:egress` is unaffected: nothing in this folder constructs a request.
- `check:english` sees no new copy: the only user-facing sentence the feature
  owns is the disclaimer in §7, and the answer that carries it is composed where
  the answer is composed.
- A restore does not wipe the knowledge tables (they are derived, and they are
  not in `@nexus/sync`'s collection map, which `collectionGuard.test.ts` holds
  equal to the wipe list). Stale rows heal themselves: the next pass prunes
  against `search_entries`, which the restore has just rewritten.
- The gallery and the screenshot harness see nothing new: nothing here is
  reachable from a page yet. The module that owns the chat surface calls
  `createKnowledgeService` and passes the same `Embedder` the model host gives
  it.
