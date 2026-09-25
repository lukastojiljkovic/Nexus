# Research: Infinite Canvas (Milanote-class visual boards)

**Domain:** infinite-canvas products, embeddable canvas engines, rendering
techniques, and note↔canvas integration patterns.
**Session:** 2026-07-04 (research phase 1, session 3).
**Nexus context:** Milanote-style canvas is a founder requirement (sticky
notes, boxes, arrows, connections, freehand draw, media embeds, zoom/pan);
ordinary notes must be auto-visualizable into a canvas; sharing is read-only
in v1; canvas documents sync as CRDTs (see `offline-sync.md` conclusion #3).

## 1. Conclusions

1. **Offline-first Milanote is a real market gap.** Milanote — the founder's
   reference product — is online-only (previously loaded boards are
   read-only offline), has a weak mobile companion app, no public API, and no
   version history ([Digital PM review](https://thedigitalprojectmanager.com/tools/milanote-review/),
   [Nuclino comparison](https://www.nuclino.com/solutions/milanote-vs-notion)).
   Nexus's offline-first core plus version history (a free consequence of
   CRDT snapshots) attacks its weakest points while matching its strength:
   the friendly freeform board for non-designers.
2. **The engine decision is a license decision as much as a technical one.**
   tldraw has the best embeddable React canvas SDK but a source-available
   license at ~$6,000/year for commercial embedding (100-day trial, hobby
   licenses exist); Excalidraw is MIT but built as a product first, SDK
   second, with a hand-drawn aesthetic
   ([tldraw vs Excalidraw 2026](https://www.toolpick.dev/blog/excalidraw-vs-tldraw-2026),
   [tldraw.dev](https://tldraw.dev/)). Realistic options for the ADR:
   (a) pay tldraw, (b) build on Excalidraw's MIT primitives and restyle,
   (c) custom canvas on a rendering library. Given Nexus needs deep
   integration (note cards, module embeds, Yjs sync) and a non-hand-drawn
   look, options (a) and (c) fit best — decide in architecture with a
   spike, not on paper.
3. **Performance is a solved problem if designed in from day one:** viewport
   culling, level-of-detail rendering (tldraw skips shadows above ~200
   visible objects, text below 0.15 zoom, handles below 0.2), spatial
   indexing for O(visible) queries, batched draws; demos hit 5,000+ cards at
   60fps with OffscreenCanvas workers
   ([tldraw viewport docs](https://tldraw.dev/features/composable-primitives/camera-and-viewport),
   [infinite canvas tutorial: culling](https://infinitecanvas.cc/example/culling),
   [worker-rendered canvas demo](https://github.com/awaisshah228/infinit-canvas)).
   These become explicit performance budgets in the CANV PRD.
4. **The note↔canvas bridge has two proven models — Nexus should combine
   them.** Heptabase: notes are atomic cards that can appear on multiple
   whiteboards *without duplication* (card library + maps)
   ([Heptabase review](https://toolstack.io/tools/heptabase),
   [Heptabase 1.0 wiki](https://wiki.heptabase.com/version-one)). AFFiNE:
   the same content switches between document mode and whiteboard mode
   ([Storyflow comparison](https://storyflow.so/blog/best-heptabase-alternatives-2026)).
   For Nexus: a canvas card can *mirror* a note (edits flow both ways,
   one source of truth) — that single primitive delivers the founder's
   "auto-visualize notes into canvas" requirement: the generator lays out
   mirrored cards (per heading/section), draws links as connections, and the
   result stays live, not a one-time export.
5. **Canvas objects merge like Figma, not like text.** Property-level LWW
   per object (position, size, color) is the correct conflict semantics for
   boards (see `offline-sync.md` conclusions #2–3); the Yjs doc holds an
   object map, not a text sequence. Freehand strokes are immutable objects —
   no merge problem at all.
6. **Media-heavy boards are the real performance enemy, not object count:**
   thumbnails render on the board, full assets load on demand from the blob
   store; embeds (PDF/video/audio) render as posters until activated —
   also the security boundary (`SEC-FILE-01`, `SEC-EL-04`): embedded
   content previews run sandboxed, and link-card previews go through the
   SSRF guard (`SEC-API-04`).

## 2. Landscape

| Product | Model | Strengths | Weaknesses (verified) |
| --- | --- | --- | --- |
| Milanote | Freeform boards + nested boards | Approachable for non-designers; drag-drop; templates; media cards | Online-only, weak mobile, no API, no version history |
| Heptabase | Card library + whiteboards ("maps") | Cards reusable across maps without duplication; PDF annotation; study focus | Niche, subscription; not a general organizer |
| AFFiNE | Doc ↔ canvas dual mode | Same content, two views; open source | Younger, less polished |
| Miro / FigJam | Team whiteboards | Realtime collab at scale; facilitation tools | Meeting-oriented; heavyweight for personal use |
| tldraw / Excalidraw | Embeddable engines | See conclusion #2 | License ($6k/yr) vs product-not-SDK (MIT) |

## 3. Expected feature checklist

**Table stakes** (from Milanote/FigJam patterns): sticky notes, text boxes,
shapes/boxes, frames/groups, images, link cards with previews, lines and
arrows with anchor points that stay attached, freehand drawing, infinite
pan/zoom (pinch, wheel, space-drag), multi-select + align/distribute,
duplicate, undo/redo, keyboard shortcuts, board templates, nested boards or
board links, export board as image/PDF.
**Differentiators for Nexus:** true offline; version history; note-mirror
cards (live two-way); embeds of *Nexus objects* (a task list, a countdown, a
flashcard deck as live cards — the all-in-one advantage no whiteboard tool
has); auto-visualization of an existing note into a board.

## 4. Offline-first implications

Canvas = Yjs document (object map) synced per `offline-sync.md`; media via
the content-addressed blob store with thumbnail tier; read-only shares render
from a published snapshot; version history from periodic CRDT snapshots
(also the compaction mechanism). Auto-visualize runs fully locally — no
server dependency.

## 5. Pitfalls

- **Mobile canvas as an afterthought** — Milanote's most-cited weakness.
  Android comes later (founder decision #9), but the object model must not
  assume mouse-only interactions (hit areas, gesture semantics).
- **Accessibility:** canvases are notoriously screen-reader-hostile; provide
  a list-view fallback of board contents (which also feeds global search
  indexing of canvas text).
- **Unbounded boards:** without LOD and culling budgets from v1, boards die
  at a few hundred media cards; retrofit is a rewrite.
- **Engine lock-in:** whichever engine is chosen, wrap it behind our own
  canvas API so the ADR is revisable (same isolation rule as the sync
  engine).
- **Link-card previews** are an SSRF and privacy surface — server-side
  fetching only through the `SEC-API-04` guard; local accounts fetch
  client-side or not at all.

## 6. Open questions → PRD (CANV) and architecture

1. Engine: tldraw (paid) vs Excalidraw-derived vs custom — needs a 1–2 week
   spike each on: restyling feasibility, Yjs integration, custom card types.
2. Note-mirror granularity: whole note as one card vs per-section cards —
   affects the auto-visualize algorithm's usefulness.
3. Nested boards (Milanote model) vs flat boards + links (simpler) for v1.
4. Auto-visualize v1 scope: headings→cards + wiki-links→arrows is cheap and
   already valuable; anything smarter (LLM layout) waits for the AI module.
5. Performance budgets to write into the PRD: target board size (e.g. 1,000
   objects / 200 media cards at 60fps pan on mid-range hardware) — confirm
   with the spike.
6. Live Nexus-object embeds (task list on a board): v1 or fast-follow?
   Scope cost is real but it's the differentiator.
