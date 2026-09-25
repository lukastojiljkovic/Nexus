# ADR-055 — Named dashboards (DASH-008; migration 043, interchange 1.21.0)

**Status:** accepted (2026-07-31) · **Owner:** supervisor · **Implements:**
DASH-008, per the founder's batch answer 7 ("idi ADR"). ADR-045 deferred this
cheaply on purpose; this ADR spends what was saved.

## 1. Model: sets over the existing rows, NULL = Početna

**Migration 043** adds `dashboard_sets` (id TEXT PK, profile_id REFERENCES
profiles ON DELETE CASCADE, name TEXT NOT NULL, position INTEGER NOT NULL,
created_at, updated_at) and `dashboard_widgets.set_id TEXT NULL REFERENCES
dashboard_sets(id)` via **ADD COLUMN** (child-table addition — NOT the 038
parent-rebuild case; record the reasoning at the migration site as 038's
counterexample). The active set lives on the `dashboard_settings` singleton:
`active_set_id TEXT NULL` (ADD COLUMN there too).

`set_id NULL` **is** the default dashboard — named **„Početna"** in copy only,
undeletable and un-renamable because it is not a row. Every existing profile
therefore already has its dashboard with zero data movement, and ADR-045's
whole get-or-default/first-edit-materialization machinery keeps working
untouched on the NULL set. A named set's layout uses the same rows filtered by
`set_id`; an EMPTY named set means the default widget arrangement (the ADR-045
rule, per set), so "reset this set" stays free.

## 2. Behaviour

- **Switcher**: typographic, in the dashboard header beside the greeting —
  the active set's name as quiet text, click opens the house popover listing
  Početna + named sets + („Nova tabla…" in edit mode only). Active nav
  discipline applies: gold text + weight for the active name, no pills, no
  glows.
- **Managing**: create/rename/delete live in EDIT MODE only (⋯ beside the
  switcher). Delete asks the house confirm and deletes the set's widget rows
  with it (they are arrangement, not content — nothing the user typed is
  lost); the active set falls back to Početna.
- **Widgets** keep their whole ADR-045 contract per set (spans, order, ⋯
  menus, gallery, drag). `moveNeighbours` and friends operate on the visible
  (= active-set) list exactly as they do today.
- **Store**: `DashboardWidgetStore` reads/writes scoped by `(profile_id,
  set_id)`; `dashboard_sets` gets its own small store (list/create/rename/
  delete/reorder — gap-1024 positions, the house ordering idiom). Wire:
  `dash:list-sets` / `dash:create-set` / `dash:rename-set` / `dash:delete-set`
  / `dash:set-active-set`, all per-field validated; the existing widget
  channels gain a validated optional `setId`.

## 3. Interchange 1.21.0

New record type `dashboard-set` + `ExportDashboardWidget` gains optional
`setId` (absent = Početna; era rule per ADR-028 §7 — pre-1.21 archives default
everything to the NULL set) + `dashboard_settings`' `activeSetId` rides the
existing settings row. **Foreign import: dashboards are not imported at all**
(founder answer 22, shipped separately) — sets inherit that posture wholesale;
the named-skip line already covers it. Too-new refusal fixtures → **1.22.0**.

## 4. Consequences / limits

- One active set per profile, not per device — a profile IS a person's space,
  and remembering the last-viewed set per device would put arrangement state
  in two stores. Recorded as a decision.
- No per-set background in v1: `dashboard_settings` (background, dim) stays
  profile-wide. A per-set background would move those columns onto the set row
  — its own small ADR if ever asked for.
- DASH-004 (per-widget config) stays orthogonal: `config` column already
  exists on the widget row and travels with it regardless of set.
