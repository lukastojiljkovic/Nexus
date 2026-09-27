import type { Migration } from "./migrations.js";

/**
 * Migration 70 — the tenth search kind: a circuit (ELEC).
 *
 * The workbench shipped its own search-free life for as long as it has existed,
 * and `docs/STATUS.md` recorded the reason rather than a defect: „It has no
 * `SearchKind`, so circuits are not reachable from Ctrl+K — that needs a
 * migration and a backfill, not a component." This is that migration.
 *
 * It follows migration 017's shape exactly and for 017's reasons (read that
 * file's class comment): ONE projection view read by both the triggers and the
 * backfill, so „what a live edit indexes" and „what a fresh migration backfills"
 * cannot drift apart; and the AI/AU/AD triple, whose AU is delete-then-reinsert
 * so a soft delete, an undelete and an ordinary rename are one code path.
 *
 * **Why migration 017 is the only template and this is the only kind added this
 * way since.** Migrations 025 and 048 are VIEW SWAPS — they re-pointed a
 * projection for a kind 017 had already created, and neither minted one. The
 * circuit is the first new kind in fifty-three migrations, which is why the
 * checklist is written out here rather than assumed: `SEARCH_KINDS` (the union
 * and the array), `SEARCH_KIND_PREFIXES`, `KIND_PRIOR`, the owning module's
 * `searchIndexers` entry in `apps/desktop/src/shared/modules.ts`,
 * `SEARCH_SOURCE_VIEWS` and this file — six places. The owner used to be a
 * `Record<SearchKind, …>` in the main process, which the compiler checked; since
 * 2026-09-26 it is the manifest, and a desktop test checks it instead (every
 * kind, exactly one owner). The places neither of those checks are named in
 * `searchStore.ts` and `App.tsx` beside themselves.
 *
 * **What the projection carries.** A circuit's `name` is its title and its
 * `notes` is its body — those are the only two pieces of text a circuit owns,
 * and they are the two the workbench shows. Three deliberate choices:
 *
 *  - **`parent_id` is NULL.** A circuit is the top of its own little tree
 *    (parts and wires hang off IT), and nothing deep-links through it. The
 *    kind's own page does not need a parent to resolve a result.
 *  - **`context_date` is NULL.** A circuit has no due date, no start time and
 *    no exam — `updated_at` is the only date it has, and the store's sort
 *    already reads that column for every kind.
 *  - **`body` is `notes`, capped at 8000** — the per-entry body cap 017
 *    applies to every kind, `substr(..., 1, 8000)`, with the SAME expression in
 *    `body_folded`, because the folded column is what the FTS index actually
 *    matches on and the two must cap at the same place.
 *
 * The parts and wires are deliberately NOT indexed: a result is one row the
 * user can open, and fourteen resistors are not fourteen results — they are one
 * circuit, which is already the row. Component labels are also not searchable
 * text here for the same reason (and because the catalogue's own names are the
 * app's vocabulary rather than the user's data).
 *
 * **The backfill is not optional and is not a fresh-install concern.** Every
 * existing circuit predates this migration, and without the `INSERT ... SELECT`
 * at the bottom, a user who upgrades would find their own circuits missing from
 * search until they happened to rename each one — the triggers only fire on a
 * WRITE. This is the one-statement backfill 017 ends with, over this kind's
 * view.
 */
export const migration070: Migration = {
  version: 70,
  up(db) {
    db.exec(`
      CREATE VIEW search_source_circuit AS
        SELECT
          'circuit'                                 AS kind,
          id                                         AS entity_id,
          profile_id                                 AS profile_id,
          NULL                                       AS parent_id,
          name                                       AS title,
          substr(coalesce(notes, ''), 1, 8000)       AS body,
          nx_fold(name)                              AS title_folded,
          nx_fold(substr(coalesce(notes, ''), 1, 8000)) AS body_folded,
          NULL                                       AS context_date,
          updated_at                                 AS updated_at
        FROM circuits
        WHERE deleted_at IS NULL;

      CREATE TRIGGER circuits_search_ai AFTER INSERT ON circuits BEGIN
        INSERT INTO search_entries (kind, entity_id, profile_id, parent_id, title, body, title_folded, body_folded, context_date, updated_at)
          SELECT kind, entity_id, profile_id, parent_id, title, body, title_folded, body_folded, context_date, updated_at
          FROM search_source_circuit WHERE entity_id = new.id;
      END;
      CREATE TRIGGER circuits_search_au AFTER UPDATE ON circuits BEGIN
        DELETE FROM search_entries WHERE kind = 'circuit' AND entity_id = old.id;
        INSERT INTO search_entries (kind, entity_id, profile_id, parent_id, title, body, title_folded, body_folded, context_date, updated_at)
          SELECT kind, entity_id, profile_id, parent_id, title, body, title_folded, body_folded, context_date, updated_at
          FROM search_source_circuit WHERE entity_id = new.id;
      END;
      CREATE TRIGGER circuits_search_ad AFTER DELETE ON circuits BEGIN
        DELETE FROM search_entries WHERE kind = 'circuit' AND entity_id = old.id;
      END;

      INSERT INTO search_entries (kind, entity_id, profile_id, parent_id, title, body, title_folded, body_folded, context_date, updated_at)
        SELECT kind, entity_id, profile_id, parent_id, title, body, title_folded, body_folded, context_date, updated_at
        FROM search_source_circuit;
    `);
  },
};
