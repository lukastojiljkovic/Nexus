import type { Migration } from "./migrations.js";

/**
 * Migration 32 — the dashboard's widget layout (DASH-002 / ADR-045). One row per
 * placed widget, per profile: which widget, at which size, in which order.
 *
 * A layout is an ORDERED LIST, not a grid of coordinates (ADR-045 section 1):
 * `position` says where a widget sits in the sequence and `size` says how wide
 * it is, and the renderer flows that sequence into a six-column grid. There is
 * no row/column pair here on purpose — a stored (x, y) would have to be
 * re-solved every time the window resized or a widget above it changed size,
 * and the two would drift apart the first time one of them was written without
 * the other.
 *
 * **`widget_id` is deliberately NOT a foreign key.** It names a widget a MODULE
 * publishes in its manifest (`WidgetContract`, `@nexus/core`) — a code constant
 * compiled into the build, in no table at all — which is precisely the argument
 * migration 028 made for `note_folders.default_template_id` naming a built-in
 * template. A row whose widget id this build does not recognise, or whose module
 * is switched off, is KEPT: the layout is the user's, and a widget that
 * disappears because a flag was toggled must come back when it is toggled again.
 * Filtering what actually renders is the renderer's job, never the schema's.
 *
 * `instance_id` rather than `widget_id` as the primary key, because the same
 * widget may be placed twice — two calendars at different sizes is a layout, not
 * a mistake — so the identity of a PLACEMENT is its own.
 *
 * `position` is the sparse gap-1024 idiom of migration 022 (`TASK_ORDER_GAP`):
 * a move between two neighbours is the midpoint of their positions, one UPDATE,
 * with a whole-scope renumber only when the gap has genuinely run out. Not
 * UNIQUE, and never assumed contiguous — it is a relative sort key, and
 * `DashboardWidgetStore` breaks a tie by `instance_id` so the order is total
 * whatever the column holds.
 *
 * **Superseded by migration 062**, which replaced this column with a
 * fractional `rank` TEXT: an integer gap can run out, and the whole-scope
 * renumber that recovered from it is a mass UPDATE that a two-device merge
 * cannot tell apart from an intentional reordering. Everything above is
 * what this migration DID; none of it is the shape on disk today.
 *
 * `config` is per-widget JSON, nullable, and OPAQUE to this table: no widget
 * publishes a config schema yet (`WidgetContract.configSchema` is optional), so
 * nothing here — and nothing in the store — interprets it. What the interchange
 * parser does check is that a non-null value is parseable JSON, because an
 * archive is the one way text could reach this column having passed nobody's
 * writer.
 *
 * The `size` CHECK mirrors `WidgetSize` in `@nexus/core`'s widget contract, for
 * the reason every CHECK in this directory exists: it is what holds when a row
 * arrives through a restore rather than through the store.
 *
 * `dashboard_widgets_profile_position` covers the only read there is — one
 * profile's layout in order.
 */
export const migration032: Migration = {
  version: 32,
  up(db) {
    db.exec(`
      CREATE TABLE dashboard_widgets (
        profile_id  TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        instance_id TEXT PRIMARY KEY,
        widget_id   TEXT NOT NULL,
        size        TEXT NOT NULL CHECK (size IN ('S', 'M', 'L')),
        position    INTEGER NOT NULL,
        config      TEXT,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      );
      CREATE INDEX dashboard_widgets_profile_position
        ON dashboard_widgets (profile_id, position);
    `);
  },
};
