# ADR-059 — Per-widget configuration (DASH-004; no migration, no interchange change)

**Status:** accepted (2026-07-31) · **Owner:** supervisor · **Implements:**
DASH-004 (M): "period where applicable; source filters, e.g. which task
lists; size presets". Size presets shipped with ADR-045; this ADR ships the
other two.

## 1. Storage: the column that has been waiting

`dashboard_widgets.config` (migration 032) is opaque JSON, carried verbatim
through the interchange since 1.11.0 — an older reader passes it through
untouched, so giving it MEANING costs no version bump and no migration.
Discipline: **strict-write, lenient-read** (the `view_config` precedent from
ADR-050) — the writer validates every field into its closed domain; the
reader drops unknown keys and falls back per-field to the default, and the
DEFAULT IS TODAY'S BEHAVIOUR, so absent config ≡ the widget as it ships now.

## 2. Contract: declarative fields, one generic form

`WidgetContract` (shared/modules.ts) gains optional `configFields` — a small
closed vocabulary the ⋯ menu can render generically:

- `{ kind: "count", key, min, max, default }` — row cap.
- `{ kind: "choice", key, options: [{id, labelKey}], default }` — closed enum.
- `{ kind: "taskLists", key }` — multi-select over the profile's live task
  lists (empty selection = all lists, the default; a selected list that no
  longer exists is dropped on read, never an error).

One generic „Podesi…" popover in the widget's ⋯ EDIT-MODE menu renders the
declared fields (house popover, token-only, labels from strings). No
per-widget bespoke forms — a widget whose needs outgrow the vocabulary earns
a vocabulary extension, not a special case.

## 3. What each widget declares (v1 — each default is today's behaviour)

- `tasks:predstojece` — `count` (3..10, def 5) · `period` choice: danas /
  sledećih 7 dana (def: the widget's current window) · `taskLists` filter.
- `tasks:hitno-kasni` — `count` only (its period IS its identity).
- `calendar:danas` — `count` (the day strip's row cap); period is its name.
- `calendar:isticanja` — `horizon` choice 30/60/90 days (def: current).
- `notes:nedavno` — `count`.
- `study:ispiti` — `horizon` choice 30/60/90 (def: current).
- `study:ucenje` — nothing yet (declares no fields; the menu shows no
  „Podesi…" — the affordance appears only where a choice exists).

## 4. Wire and plumbing

A `dashboard:set-widget-config { instanceId, config }` channel (validated:
the payload is re-validated field-by-field in main against the SAME contract
declaration — shared/modules.ts is importable from main since ADR-058 slice
c moved it); the store writes the JSON. Widget bodies read config through
one shared `parseWidgetConfig(contract, raw)` (core-pure, TDD) so every
widget's fallback discipline is identical. Default-instance materialization
(first edit) already covers config writes on default rows.

## 5. Consequences

- Zero migration, zero interchange. Foreign import continues not to import
  dashboards at all (founder #22) — nothing new travels.
- `config` on the wire stays opaque; only the two ends assign it meaning.
- The gallery description can mention configurability; the visual pass:
  the „Podesi…" popover in both themes.
