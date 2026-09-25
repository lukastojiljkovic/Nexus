# ADR-045 — Dashboard edit mode, widget instances, and the widget contract made real

**Status:** accepted · 2026-07-31 · **migration 032 reserved · interchange 1.11.0 reserved**
**Drives:** the DASH remainder (STATUS §4): edit mode, widget gallery,
arrangeable layout — and it closes `widgets.ts:33`'s open data-query item with
a decided answer. Multiple named dashboards (DASH-008) are deliberately
deferred; see Consequences.

## Decision

### 1. A layout is an ORDERED LIST, not a coordinate space

The arrangement is `[{ instanceId, widgetId, size, config }]` in order; the
grid renders it by flowing items into a fixed **6-column** authored grid where
the size presets map to spans — **S = 2, M = 3, L = 6** (PRD 02 OQ#1: presets
over free resize; `WidgetSize` already says S/M/L). Rows are auto-height,
`align-items: start`, exactly today's visual rhythm. Because layout is a list,
PRD §7's "single-column reflow with order preserved" is free (the same list,
one column), and NO two-dimensional reflow drag has to exist: reordering is
1-D — the same shape as every reorder in the app.

### 2. Storage: `dashboard_widgets` rows, per profile (migration 032)

`(profile_id REFERENCES profiles, instance_id TEXT PK, widget_id TEXT — NOT
an FK, a code constant per the 028 argument, size CHECK ('S','M','L'),
position sparse INTEGER — the gap-1024 idiom, config TEXT NULL — JSON,
opaque until a widget declares a schema, created_at/updated_at)`. The store's
`listLayout` is **get-or-default**: no rows means the seeded default
arrangement (today's five cards, in today's order and sizes) computed in
code, and the first edit writes real rows — the `ntf_settings`/
`dashboard_settings` pattern, no seeding migration. `config` exists now
because per-instance configuration (DASH-004) is the reason instances exist;
v1 writes null. Unknown `widget_id` (downgrade) and widgets of a disabled
module render nothing but their rows are KEPT — hidden, never deleted
(DASH-002; the `readStoredSources` precedent). Interchange **1.11.0** adds
the `dashboard-widget` record type (no era flag; required
`ExportArchiveInput` member; parser twin validates size/position/config-JSON;
foreign import mints instance ids and skips nothing — an arrangement is
profile data). Too-new fixtures move to 1.12.0.

### 3. The widget contract becomes real; the data question gets its answer

Manifests finally populate `widgets:`; `ModuleRegistry` gains a
widget-aware lookup (`widgetsOf(moduleId)` / `findWidget(key)`), and the
stable key is **`moduleId:widgetId`**. The six current surfaces register as:
`calendar:danas` (documented cross-module read of tasks — it gates on either
module today and keeps doing so), `tasks:predstojeće`, `calendar:isticanja`,
`study:ispiti`, `study:učenje` — ids in code are ASCII slugs; titles stay
strings-keys. The greeting/date header stays fixed chrome, not a widget
(DASH-009's day strip is a later widget).

**Data-query decision (`widgets.ts:33` closed):** a widget's data mechanism
IS its component — each widget owns its `window.nexus` reads behind a
per-widget fetch boundary. The declared-query DSL over one channel is
REJECTED for now, with the reasoning recorded: a DSL needs a validator the
contract explicitly does not bundle, typed named queries degenerate into
per-widget endpoints anyway, and at personal-corpus scale the PRD's budget is
not threatened by direct reads. When a widget genuinely needs capped or
aggregated data, it gets a purpose-built MAIN-side endpoint (the
`studyStats` precedent), not a query language. What the contract therefore
carries is what is real: `id`, `title`, `sizes`, `deepLink`, optional
`configSchema` for later.

### 4. Per-widget loading and failure (the PRD §7 debt, paid now)

The page's single all-or-nothing `Promise.all` gate is replaced by
per-widget boundaries: each widget fetches its own data, shows its own quiet
skeleton, and on failure renders an isolated error card with „Pokušaj
ponovo" — never a blank dashboard, never one slow module blocking four
healthy widgets. The ADR-041 background/scrim layers and their DOM-order
stacking are untouched; any drag ghost uses the `cal__grid-event--dragging`
z-index precedent.

### 5. Edit mode: menus first, drag as convenience

„Uredi" in the dashboard header enters edit mode; „Gotovo" leaves it. In
edit mode every card grows a quiet header strip with a ⋯ menu — „Pomeri
gore/Pomeri dole" (1-D, `stepNeighbours`, end-of-scope disabled never
dropped), „Veličina: S/M/L" (current one checked), „Ukloni" — which is
keyboard parity BY CONSTRUCTION (PRD §8), plus mouse drag-to-reorder using
the tasks-list HTML5 DnD mechanism and the house drop recipe (accent
border + soft background, outline variant where a border would shift; no
glow). No resize handles — size is a menu choice. „Dodaj vidžet" opens a
dialog (the recur-dialog recipe) listing ENABLED modules' registered widgets
grouped by module; v1 widgets are single-instance (an already-placed one
shows disabled with „već dodat"), while the schema supports instances for
the day a widget declares otherwise. Serbian copy in `strings.ts`.

## Consequences

- **DASH-008 (multiple named dashboards) deferred, cheaply:** a future
  `dashboards` table plus a `dashboard_id` column on `dashboard_widgets` is
  one additive migration then; nothing in this layout needs re-keying now,
  and the sidebar keeps drawing modules only.
- The first grid primitives enter the system as page CSS (6 columns, spans),
  not tokens — a breakpoint/grid token family is its own future decision.
- ONB's seed mapping (DASH-007) later replaces the in-code default
  arrangement; the get-or-default seam is exactly where it will plug in.
- Slices: **045-a** — db + contracts: migration 032, `DashboardWidgetStore`
  (TDD), interchange 1.11.0 end to end, registry widget lookup, manifests
  populated; **045-b** — renderer: per-widget boundaries, edit mode, the
  gallery dialog, seeding default, strings/css. Sequential; b consumes a's
  shapes.
