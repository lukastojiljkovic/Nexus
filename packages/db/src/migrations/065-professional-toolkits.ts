import type { Migration } from "./migrations.js";

/**
 * Migration 65 — „Programerske alatke" becomes „Stručne alatke", and the
 * developer drawer becomes one toolkit inside it.
 *
 * WHAT CHANGED ABOVE THIS LAYER. Until now there were two tool drawers and the
 * second one was a module called `devtools`: forty-eight instruments for reading
 * bit patterns, switched on by the one questionnaire answer that said
 * „programer". Generalising that to every profession the app serves could have
 * been done by registering twenty-two more modules, and that would have been
 * wrong in the sidebar (twenty-three rows for a person with one job) and wrong
 * in the contract (a tool would belong to exactly one profession, so the colour
 * converter a designer and a programmer both live in would have had to exist
 * twice). Instead there is ONE professional module, `pro`, and a tool declares
 * the `packs` it serves — so sharing is a longer array rather than a mechanism.
 *
 * WHAT THAT MEANS FOR A DATABASE THAT ALREADY EXISTS. Two facts, and this
 * migration is both of them:
 *
 *  1. The module id changed, so a stored `feature_flags` row saying `devtools`
 *     names a module that is no longer registered. Left alone it would be inert
 *     — `resolveEnabled` walks the registry, so an unknown row is simply never
 *     read — and „inert" is precisely the failure to avoid: the user's answer
 *     would still be in the file, still true, and silently ignored. Somebody who
 *     switched the drawer on would open the app and find it gone.
 *
 *  2. A pack is a per-profile fact of its own (`pack:<id>` — see
 *     `packFlagKey`), and the forty-eight tools now hang off `pack:softver`.
 *     Moving the module row without minting the pack row would give that user an
 *     enabled module whose every tool is filtered out: a drawer that opens on an
 *     empty list, which is worse than either state it came from.
 *
 * So the two writes are one migration and neither is optional. The pack row
 * inherits the module row's value rather than being forced to `true`, which
 * matters for the profiles that carry an explicit `false` — every business
 * profile does (`businessProfileFlags` writes one row per unlocked module), and
 * so does every personal profile that finished the questionnaire, since a first
 * run writes every selectable module out explicitly. Those users said no to the
 * developer drawer; a migration that answered yes on their behalf would be this
 * codebase's own „an unset field ships the toolchain's answer" defect wearing a
 * different hat.
 *
 * **Nothing is deleted and nothing is created for a profile that never had a
 * row.** A profile with no `devtools` row never turned the drawer on, and the
 * absence is already the right answer under the new rules too: a module falls
 * through to `defaultEnabled` (false), and an absent pack row means off, always
 * — there is no such thing as a pack that is on by default, because every pack
 * is an answer to a question about the person.
 *
 * **`ON CONFLICT DO NOTHING`, not `DO UPDATE`.** A `pack:softver` row can only
 * pre-exist if this migration has already run on this file, and in that case the
 * row is the user's current answer — possibly one they changed since. Overwriting
 * it with the module's value would silently undo a choice made after the upgrade.
 */
export const migration065: Migration = {
  version: 65,
  up(db) {
    // Order is load-bearing: the UPDATE first, so the SELECT below reads exactly
    // the rows that used to say `devtools` and nothing else. Doing it the other
    // way round would need the old id in one statement and the new one in the
    // next, which is the same thing said twice and drifts the first time
    // somebody edits one line.
    db.exec(`
      UPDATE feature_flags SET module_id = 'pro' WHERE module_id = 'devtools';

      INSERT INTO feature_flags (profile_id, module_id, enabled, updated_at)
        SELECT profile_id, 'pack:softver', enabled, updated_at
          FROM feature_flags
         WHERE module_id = 'pro'
      ON CONFLICT (profile_id, module_id) DO NOTHING;
    `);
  },
};
