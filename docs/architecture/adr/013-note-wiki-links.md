# ADR-013 — NOTE Wiki-Links & Backlinks

**Status:** accepted · 2026-07-17 (Claude, within delegated technical
leadership; no new founder decision needed — NOTE-004 is fully specified in
PRD 09 and this ADR only fixes the mechanism).
**Drives:** NOTE-004 (wiki-links with autocomplete, backlinks panel, rename
updates link titles), future SRCH (link graph is queryable), future CANV
(NOTE-007 "visualize on canvas" reads the same graph).

## Context

NOTE-004 requires links between notes with three properties: autocomplete
insertion, a backlinks panel, and — the constraining one — **renaming a note
must update every link's displayed title**. Documents are Yjs CRDTs (ADR-012):
rewriting *other* notes' documents on a rename would mean fanning writes
across documents (merge churn, versioning noise, and a future sync hazard).
The renderer edits documents; main owns the DB (SEC-EL).

## Decision

### The document stores identity, not presentation

A wiki-link is an **inline atom node `noteLink` whose only durable attribute
is the target note's `id`**. The displayed title is resolved at render time
from the live note list (a React NodeView). Renaming a note therefore updates
every link's label *by construction* — nothing rewrites any document, ever.
(The node MAY carry a `label` snapshot attribute purely as a fallback for a
target the renderer can't resolve yet; it is presentation cache, never truth.)

### The link index is a derived table, reported by the renderer

- New table **`note_links`** (`source_note_id`, `target_note_id`, PK pair,
  both FK → `notes(id) ON DELETE CASCADE`, index on the target side) —
  migration 012. Backlinks = one indexed query.
- The **renderer extracts the outbound id set from the document at flush time**
  and reports it over a dedicated channel (`notes:set-links`, replace-set
  semantics in one transaction). This is the same trust model as the
  renderer-derived `title` that `notes:append-update` has carried since a1:
  the renderer authors its own content; main validates structure (array cap
  500, string shape), the store validates semantics (drops self-links,
  unknown ids, cross-profile ids — scope-checked against `notes.profile_id`).
  Worst case a hostile renderer corrupts its own profile's link index — the
  same blast radius as authoring note content itself.
- **Soft-deleted targets keep their link rows** (undo/restore heals the graph
  for free); backlink *queries* join active notes only. Hard deletes cascade.
- `setOutboundLinks` does **not** bump `updated_at` — the content edit that
  produced the links already did.
- Rejected alternative: main-side extraction by merging the full Yjs state on
  every append. Correct but pays a full-document merge per debounce tick and
  drags document-shape knowledge (node names/attrs) into main; the compaction
  path stays the only main-side merge consumer.

### Editor surface

`[[` opens an autocomplete (the slash-menu suggestion pattern: portal panel,
keyboard-routed, no tippy/floating-ui) over the profile's **active** notes,
excluding the current note (no self-links — the store drops them anyway).
Selecting inserts the `noteLink` atom + a space. Clicking a link chip
navigates to the target note (a page-provided callback). The **backlinks
panel** is a quiet section in the editor pane ("Povratne veze", count +
title rows, click navigates) fetched via `notes:backlinks` on load and after
flushes.

## Consequences

- Rename-updates-titles costs zero writes; it falls out of identity-only
  storage.
- The plaintext derived by `mergeNoteState` (SRCH substrate) does not yet
  contain link titles (atom nodes carry no text). If in-note search must match
  link labels, the SRCH slice extends the plaintext walk to resolve
  `noteLink` ids — recorded there, not here.
- IMEX: `note_links` rows are pure derived state; export can regenerate or
  include them as a table mirror — decided in the NOTE↔IMEX slice.
- Slices: **004-a** data + IPC (migration 012, `NoteStore.setOutboundLinks`/
  `listBacklinks`, two channels), **004-b** editor UI (suggestion, NodeView,
  flush extraction, backlinks panel, navigation).
