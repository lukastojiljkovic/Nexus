# PRD 11 — Canvas (CANV)

**Status:** draft 2026-07-05. Inputs: raw-spec §9, `docs/research/infinite-canvas.md`,
offline-sync research (Yjs object map, property-LWW), founder requirement:
Milanote-class, drawing included, auto-visualize notes.

## 1. Purpose

The visual thinking surface: infinite boards where notes, media, links, and
drawings arrange spatially. Nexus's canvas differentiates through offline
operation, version history, live note-mirror cards, and (post-v1) live
embeds of Nexus objects — an integrated visual layer, not a bolted-on
whiteboard.

## 2. User stories

- As a visual planner, I want an infinite board with cards, boxes, arrows,
  and drawing, so that I think spatially (Milanote reference).
- As a note-taker, I want my note visualized as a live board, so that
  structure becomes visible without duplicating content.
- As a researcher, I want images, PDFs, videos, and links as cards, so that
  source material lives on the board.
- As a collaborator (later), I want to share a board read-only, so that
  others see my plan.

## 3. User experience & flows

Boards list (cards view) → board editor: infinite pan/zoom canvas, left
toolbar (select, text, sticky, shape/box, arrow/connector, draw, media,
note-mirror), context toolbar on selection (color, font size, align,
z-order, group), minimap toggle, zoom controls with fit/100%. Drag-drop
files onto the board creates media cards (thumbnails via DOC pipeline; full
view on activation, sandboxed). Connectors snap to card anchors and stay
attached through moves. "Vizuelizuj" entry from NOTE (NOTE-007) generates a
board; mirrored cards show a link badge and open/edit the source note
in-place (popover editor).

## 4. Functional requirements

- **CANV-001 (M)** Infinite canvas with smooth pan/zoom (wheel, pinch,
  space-drag), 60 fps interaction within performance budget: 1,000 objects /
  200 media cards on reference hardware (canvas research §3; verified by
  spike per OQ#1).
- **CANV-002 (M)** Object types v1: text card, sticky note, shape (rect/
  ellipse/rounded), connector (line/arrow, anchored, optional label),
  freehand stroke, image card, file card (PDF/video/audio via DOC preview),
  link card (title/favicon; rich preview via SSRF-guarded fetch for cloud,
  client-side or plain for local accounts per SEC-API-04), note-mirror
  card, group/frame with title.
- **CANV-003 (M)** Editing: multi-select (marquee/shift), move/resize/
  rotate (strokes excluded from rotate v1), align/distribute, duplicate,
  copy-paste (including cross-board), z-order, color/style per design
  tokens, undo/redo unlimited within session.
- **CANV-004 (M)** Note-mirror cards: live two-way binding to a note or
  note section (glossary term); deleting the card never deletes the note;
  deleting the note marks the card broken with recovery options.
- **CANV-005 (M)** Auto-visualize (NOTE-007 counterpart): headings→cards,
  wiki-links→connectors, layout algorithm (tidy grid/tree); result is a
  normal editable board; regeneration offers merge or new board.
- **CANV-006 (M)** Boards are CRDT documents (Yjs object map; per-property
  LWW semantics per sync research); version history with browse/restore
  (snapshot-based, doubles as compaction).
- **CANV-007 (M)** Board organization: folders/tags shared taxonomy style
  with NOTE, board thumbnails, pin; boards indexed in SRCH by title + text
  content of cards.
- **CANV-008 (S)** Nested boards (board-link card) — Milanote model,
  flat-plus-links v1 per research OQ#3.
- **CANV-009 (S)** Export board as PNG/PDF (current viewport or fit-all).
- **CANV-010 (S)** Keyboard-first object creation (N sticky, T text, C
  connector…) and arrow-key nudging.
- **CANV-011 (C)** Live Nexus-object embeds (task list, countdown, deck
  stats as functional cards) — the differentiator, fast-follow after v1
  core (research OQ#6).
- **CANV-012 (C)** Templates (moodboard, projekat, brainstorm) incl.
  profession-pack boards.

## 5. Options & settings

Grid/snap toggle and size; default connector style; drawing pen presets;
minimap default; board background (subtle set, token-safe).

## 6. Integrations

NOTE (mirror cards, auto-visualize); DOC (media previews, thumbnails);
SHARE (read-only board sharing v1 scope); SRCH (indexing); IMEX (board
export; import from image dumps as media grid); FUN/embeds later
(CANV-011); design system (all styling tokenized — canvas must not become
a styling wild west).

## 7. Edge cases & error states

- Media file missing/corrupt blob → placeholder card with re-link action.
- Massive paste (100 images) → batch import with progress and layout grid.
- Concurrent offline edits: property-LWW per object; move vs move = last
  wins (harmless); delete vs edit = edit survives as conflict-visible
  object (sync research conflict rule).
- Deep zoom-out with thousands of objects → LOD rendering (text hidden
  below threshold per research; culling always on).
- Connector endpoints on deleted cards → dangling connector auto-removes
  with undo.
- Auto-visualize on a 200-heading note → cap with pagination/sections
  choice dialog.
- Broken mirror (note deleted) → card shows last snapshot + "restore note"
  / "convert to text card".

## 8. Acceptance criteria (key)

- 1,000-object board pans/zooms at 60 fps on reference hardware; 200 media
  cards lazy-load thumbnails without jank.
- Arrow between two cards survives both being moved/resized; label editable.
- Note with 5 headings + 3 wiki-links auto-visualizes correctly; editing a
  mirrored card's text updates the note and vice versa.
- Version history restores a board state from before a destructive session.
- Two devices editing offline converge: no lost objects, conflicts visible.
- Export PNG of fit-all matches on-screen rendering.

## 9. Open questions

1. Engine ADR (architecture): tldraw license vs Excalidraw-derived vs
   custom — requires the spikes defined in canvas research OQ#1.
2. Freehand ink model (simplification, pressure) — spike with the engine.
3. Board size hard cap (objects) before UX warning — set after spike.

## 10. Future extensions

Real-time multiplayer boards (SHARE post-v1; CRDT-ready); live embeds
(CANV-011) expansion; presentation mode (walk frames); stylus/pen support
depth on Android.
