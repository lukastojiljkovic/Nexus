# ADR-069 — Attachment CONTENT in the search index, for the formats that need no dependency (SRCH-008, migration 048)

**Status:** accepted (2026-07-31) · **Owner:** supervisor · **Unblocks:** the
SRCH-008 clause recorded since ADR-021 as "filenames are indexed, the bytes
inside are not — that needs per-format text extraction, which is the same work
File Preview needs and should be designed with it."

## 1. Why now: the preview built the extraction

ADR-064 shipped exactly the extraction this clause was waiting for, for exactly
the formats that need no dependency: `sniff.ts`'s bounded UTF-8 heuristic
returning `text/plain`, and `docPreview.ts`'s `isTextPreviewAttachment` /
`decodePreviewText` behind a 1 MiB cap. The PDF/DOCX half is still not
buildable — their text needs a library, and this repo adds none — so the honest
move is to ship the half that exists and say plainly that the other half is
out, rather than approximate it by scraping bytes. **A partial, wrong
extraction is worse than an honest absence**: it produces hits that cannot be
explained and misses that cannot be predicted.

## 2. Where the extraction happens, and why it cannot be a trigger

Attachment bytes live **encrypted on disk, outside the database**. No SQL
trigger can reach them. So the split is:

- **main extracts, once, on the add path** — the one moment the app already
  holds both the blob key and the bytes;
- **SQL sees only a stored column**, which then rides the owning row's indexed
  body exactly the way `file_name` already does.

Migration **048** therefore does what migration 025 did for filenames: adds the
column, then swaps the projection view and re-scopes the triggers, keeping 025's
`AFTER UPDATE OF <column>` narrowing so unrelated writes do not re-project.
Eligibility is the preview's own rule reused verbatim — text/plain or markdown,
within the existing 1 MiB cap — because a second threshold is a second thing to
keep in sync. An ineligible attachment simply has no indexed content; that is a
correct answer, and nothing in the UI claims otherwise.

## 3. The backfill is a main-side pass, not a migration step

Existing attachments have no extracted text and the migration cannot produce it
(same reason as above). So a bounded pass runs after unlock over eligible rows
that still have none: never blocking the unlock, idempotent, safe to interrupt
(a crash leaves rows the next pass picks up), and marking a row whose blob is
missing or will not decode as *attempted* rather than retrying it forever.
Per-row failures are logged and skipped — housekeeping may not fail the
operation that triggered it, the same rule ADR-066's sweep runs under.

## 4. PRIV is not an exception here, and that is structural

Private notes are invisible to FTS **by construction** — their sealed tables
deliberately get no projection views (ADR-057), and ADR-066 gave them a separate
in-memory index that lives and dies with the unlock. This feature must not
become the one place that reaches into them. Private attachments are therefore
never indexed here, and the private index is not fed from this path.

## 5. Consequences

- Migration 048; interchange bump only if the extracted text is chosen to
  travel. The tension is real either way and gets argued in the code: the text
  is *derived* from bytes that already travel, so carrying it is redundant
  weight that can go stale — but not carrying it means a restored profile's
  attachment contents are unsearchable until the backfill runs, so whichever is
  chosen, the restore must end consistent and restored rows must be reachable
  by the backfill.
- A result that matched on attachment content says so, in the existing
  result-row idiom — a search hit that cannot explain itself is the kind of
  magic this app does not do.
- **Still out, by name:** PDF, DOCX and XLSX content. Revisit only if the
  no-dependency rule is ever relaxed for a vetted extractor.
