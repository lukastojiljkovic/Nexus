# ADR-075 — The DOC module page: „Datoteke" (no migration, no interchange change)

**Status:** accepted (2026-08-01) · **Owner:** supervisor · **Completes:** the
slice [ADR-064](064-file-preview.md) named and deferred — „the DOC module PAGE
(browse-everything) is a later slice; this ADR is the capability."

## 1. Why a page at all

The app stores attachments in three places, each with its own surface:
`note_attachments` (013), `task_attachments` (024), `subject_attachments`
(035). Previewing them is done — tier 0 in a house dialog, tier 1 (PDF) in a
hardened dedicated window. What is missing is *finding* them: a file attached
three weeks ago is reachable only if you remember which note or task carries
it. Search does not close this — attachment file names ride their owner row's
indexed body, so searching a filename finds **the note**, which is right for
search and useless for „where did I put that PDF".

## 2. A union read, not a fourth table

`AttachmentIndexStore` unions the three tables into one discriminated row shape
(attachment id, owner kind/id/title, file name, mime, size, `created_at`,
hash). It is a *read*: no table, no migration, no new write path, nothing to
keep in sync — which is the point. A materialised file index would be a fourth
copy of facts that already exist three places, and the first module that
forgets to write it makes the page lie.

**Never dedupe by blob hash.** The same PDF attached to a note and to a task is
two attachments, with two owners and possibly two names; collapsing them hides
a real attachment from the one surface whose entire job is to show every one.
(The blob store *does* dedupe on disk — that is storage, and it is
reference-counted; this is inventory.)

Each of the three tables is asked what „deleted" means on its own terms — the
owner may be soft-deleted, the attachment may be, and they are not the same
question — and each answer is pinned by a test. Results are ordered newest-first
with the id as a total tiebreak, bounded at the search page's own 500-row browse
cap, and truncation is reported as an „N+" floor. A silent cut on a page that
claims to show everything is the one failure this surface cannot afford.

**PRIV is excluded by construction** — the union simply never names the sealed
tables. That is the module's central invariant (no projection views, no derived
surface), and it is pinned by a test rather than by a filter.

## 3. Reuse, not reinvention

The page adds exactly one channel, `doc:list-attachments`. Preview
(`doc:preview`, `doc:read-text`, the previewable-mime predicate), external open
with its tmp-open discipline, the `nx-blob://` image URLs, and the palette's
own navigate-to-a-result mechanism are all called **as they are**. A second
predicate for „can this be previewed" or a second navigation contract would be
two places to disagree.

The mime→family mapping (`slika` / `pdf` / `tekst` / `ostalo`) is a small pure
helper in `@nexus/core` beside the existing mime predicates, so the store's
filter and the page's chips cannot drift apart.

## 4. No delete here, deliberately

An attachment's removal belongs to the surface that owns it, where its undo
already lives. A fourth delete path would need a fourth undo, and a browse
surface is the worst place to make an irreversible-feeling decision about
something you are looking at out of context. „Idi na…" is the answer: it takes
you to the note/task/subject, where deleting is one click and already
reversible.

## 5. The module's slots

- **No `searchIndexers`** — filenames already ride the owner row's indexed
  body. Recorded at the manifest so nobody adds a second index.
- **No dashboard widget** in v1.
- **A `SettingsPanel`**, through [ADR-071](071-module-settings-contract.md)'s
  contract: one `choice` („Podrazumevani prikaz": Lista / Mreža,
  `storage: "device"`). This is the contract's intended use and its second real
  consumer — the panel is composed from the manifest, never hand-written into
  `SettingsPage.tsx`.

## 6. The page itself

Filter bar (owner-kind chips AND mime-family chips AND a folded Serbian text
query over filename *and* owner title, all composing); two presentations —
dense **lista** and thumbnail **mreža**, images through the existing
`nx-blob://` URL; per-row „Pregledaj" (only for previewable mimes), „Otvori",
„Idi na…". A summary line stating the count and total size **of the filtered
set** — derived, never asserted — and two distinct empty states, because „you
have no files" and „nothing matches these filters" are different situations and
one sentence for both is a lie about one of them. Loading and failure follow the
dashboard widgets' isolated skeleton + retry, not a page-wide gate.

## 7. Consequences

- Zero migrations, zero interchange change, zero dependencies; one channel, one
  store, one page, one core helper.
- DOC becomes a real module in the gallery, so it can be switched off by a user
  who never attaches anything.
- The excluded formats stay excluded (DOCX/XLSX/PPTX sniff as
  `application/zip`; a dependency-free renderer would be a product, not a
  feature) and keep external-open only.
