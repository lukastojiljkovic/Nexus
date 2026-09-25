# PRD 09 — Notes (NOTE)

**Status:** draft 2026-07-05. Inputs: raw-spec §7, offline-sync research
(Yjs documents from day one), canvas research (note-mirror cards),
study-hub research (inline flashcards), design-system (views engine).

## 1. Purpose

The knowledge layer: rich notes for every life category (posao, učenje,
zabava, igre, finansije, putovanja, ideje, recepti, projekti, random), with
structure (folders, tags), attachments, and search — designed from day one
as collaborative-ready documents (CRDT) and as the source for canvas
visualization and study flashcards.

## 2. User stories

- As a note-taker, I want rich text with markdown shortcuts, so that writing
  is fast and formatting invisible.
- As an organizer, I want folders, categories, and tags, so that hundreds of
  notes stay navigable.
- As a student, I want flashcards created inline while writing notes, so
  that studying starts where knowledge lives.
- As a visual thinker, I want a note to become cards on a canvas, so that I
  can see its structure spatially.

## 3. User experience & flows

Three-pane layout: folder tree + tag filters / note list (list or cards view)
/ editor. Editor: block-based rich text with full markdown shortcut syntax
(`#` headings, lists, checkboxes, tables, code blocks with highlighting,
quotes, callouts), slash-menu for blocks, drag-drop attachments (preview via
DOC pipeline), wiki-links `[[naslov]]` between notes with backlinks panel.
Cards created inline per study-hub research: `::` for Q&A, `{{cloze}}`.
Note actions: pin, move, tag, share (→ SHARE, cloud), "Vizuelizuj na canvas"
(→ CANV note-mirror generation), export (md/PDF).

## 4. Functional requirements

- **NOTE-001 (M)** Notes shall be block-based rich-text documents stored as
  CRDT documents (offline-sync research §3) with full markdown shortcut
  input and markdown export fidelity for standard blocks.
- **NOTE-002 (M)** Structure: folder hierarchy (unlimited depth), category
  (one of the raw-spec §7 set, extensible), tags (many), pinning; per-folder
  default view (list/cards via views engine).
- **NOTE-003 (M)** Attachments: any file via blob store with inline preview
  (images/PDF inline; others as preview chips via DOC); size caps per
  SEC-FILE-02.
- **NOTE-004 (M)** Wiki-links between notes with autocomplete and a
  backlinks panel; renaming a note updates link titles.
- **NOTE-005 (M)** Full-text search within notes (SRCH provides global;
  in-note find/replace local), including tag/category/folder filters.
- **NOTE-006 (M)** Inline flashcard creation: `::` (front == back) and
  `{{…}}` cloze markers create STUDY cards linked to the note and subject
  (mapping UI on first use); editing the note text updates the card.
- **NOTE-007 (M)** "Vizuelizuj na canvas": generate a board of note-mirror
  cards per heading/section with wiki-links as arrows (canvas research §4);
  the result stays live-linked.
- **NOTE-008 (M)** Version history per note (CRDT snapshots): browse and
  restore prior versions; restore creates a new version (never destructive).
- **NOTE-009 (M)** Note templates (sastanak, recept, dnevnik, predmet...)
  with user-defined templates; profession packs may add templates.
- **NOTE-010 (S)** Duplicate, merge notes; move blocks between notes with
  drag.
- **NOTE-011 (S)** Callout/toggle blocks; table of contents block for long
  notes.
- **NOTE-012 (C)** Graf-view of wiki-linked notes (raw-spec 2026-07-05 idea,
  optional view via views engine).

## 5. Options & settings

Default category/folder for quick captures routed to notes; editor width;
markdown-shortcut toggles; default new-note template per folder.

## 6. Integrations

STUDY (inline cards, NOTE-006; notes attachable to subjects); CANV
(note-mirror cards, NOTE-007); SHARE (share note read-only v1); DOC
(attachment previews); SRCH (indexing contract); IMEX (markdown import/
export; Notion/Obsidian import prompts); TASK (checkbox blocks are visual
only — converting a checklist into real tasks is an explicit action);
Quick capture (text captures can be triaged into notes).

## 7. Edge cases & error states

- Concurrent edits on two devices offline → CRDT merge (character-level);
  attachments referenced by both merge trivially (content-addressed).
- Huge notes (10k+ blocks) → editor virtualization; performance budget:
  open < 500 ms at p95 reference size.
- Broken wiki-link (target deleted) → visible broken-link style; backlink
  cleanup on delete with undo window.
- Markdown import of exotic syntax → best-effort with import report.
- A note whose flashcards have review history, deleted → cards orphaned?
  No: explicit choice (delete cards / keep as standalone deck), history
  never silently lost.
- Template applied over existing content → insert, never replace.

## 8. Acceptance criteria (key)

- Typing a full markdown document with shortcuts only (no mouse, no slash
  menu) renders correct blocks; export → re-import round-trip preserves
  structure.
- Two offline devices editing the same paragraph converge without data loss
  when both sync.
- `::` in a note creates a reviewable card in STUDY linked back to the note;
  editing the answer text in the note changes the card.
- "Vizuelizuj na canvas" on a 5-heading note yields a board with 5 mirrored
  cards and arrows for its 3 wiki-links; editing a card edits the note.
- Version history restores a note to a state from N edits ago.

## 9. Open questions

1. ~~Categories model.~~ **Decided (founder 2026-07-05): category = colored
   label on folders; no third taxonomy.**
2. Block-level comments (needed for collaboration later) — schema now,
   UI post-v1?
3. Default editor: block-based confirmed? (All research says yes; confirm
   with design prototype feel.)

## 10. Future extensions

Real-time co-editing (SHARE post-v1, CRDT-ready); AI summarization/cleanup
(AI module); OCR of image attachments into searchable text; publish note as
web page (cloud).
