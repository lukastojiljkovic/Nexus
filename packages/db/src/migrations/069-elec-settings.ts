import type { Migration } from "./migrations.js";

/**
 * Migration 69 — the electronics runner's per-machine settings (ADR-085 E6).
 * One row per profile, created on first write; `ElecSettingsStore.get` answers
 * with defaults while the row is absent, exactly as `backup_settings`
 * (migration 044) and `dashboard_settings` (migration 030) do — a profile that
 * never turned the runner on costs no row.
 *
 * **The default IS the feature.** `runner_enabled` starts at 0, and 0 means
 * Nexus spawns nothing: the external runner is the one thing in this app that
 * starts a process on the user's own machine, and it does so only after a person
 * said yes to it, once, deliberately. The rest of the row records that yes —
 * `consented_at` is when they gave it, `runner_choice` is which of the three
 * profiles they picked, and `runner_distro` is a distribution a probe listed,
 * kept VERBATIM because it is the name `wsl.exe -d` will be asked for.
 *
 * **Deliberately device-local**, on `backup_settings`' terms and then some:
 * every column here describes THIS computer. A distribution exists on this
 * machine or it does not, and `consented_at` is one person agreeing to have a
 * process started here — carried to another machine by an archive or by sync it
 * would be somebody else's consent, and a desktop that never produced one would
 * be running builds because another one did. So the table belongs to neither the
 * export archive nor `RESTORE_WIPE_TABLES` — the classification the exemption
 * ledger in `restoreStore.test.ts` exists to record — and it deliberately
 * carries no sync journal trigger: migration 063's journal is for user content,
 * and this is a fact about the machine.
 *
 * The CHECKs mirror rules `ElecSettingsStore` also enforces, in the same order
 * (a CHECK is what holds when a row arrives from outside the store): the choice
 * domain is closed, a choice cannot be remembered on a runner that is off, a
 * distribution belongs to the WSL choice and to no other, and — the one this
 * whole feature exists to make impossible — **enabled without a recorded
 * consent**. DEV-007's mitigation is not a disabled toggle in the renderer,
 * where a renderer is never the gate (SEC-EL-02); it is a row that cannot exist.
 *
 * The `IS` in the second CHECK is not a slip for `=`. `runner_choice = 'wsl'`
 * evaluates to NULL when no choice is remembered, and a CHECK that evaluates to
 * NULL PASSES, so the `=` form would admit the one row it is written to refuse:
 * a distribution remembered while the runner remembers no profile at all.
 */
export const migration069: Migration = {
  version: 69,
  up(db) {
    db.exec(`
      CREATE TABLE elec_settings (
        profile_id     TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,

        -- OFF until a user turns it on. Nothing in this app spawns a process
        -- before this column says it may.
        runner_enabled INTEGER NOT NULL DEFAULT 0 CHECK (runner_enabled IN (0, 1)),
        -- NULL is „no profile chosen yet“, which the CHECK below keeps distinct
        -- from „one chosen, on a runner that is off“ — that pair is refused, so
        -- the two states can never be confused for each other.
        runner_choice  TEXT CHECK (runner_choice IN ('native', 'wsl', 'docker')),
        -- The distribution's name exactly as the probe spelled it. NULL for
        -- every other choice, and for a WSL choice whose distro is not picked.
        runner_distro  TEXT,
        -- When the user agreed to let Nexus spawn a process here, or NULL while
        -- they never have.
        consented_at   TEXT,

        created_at     TEXT NOT NULL,
        updated_at     TEXT NOT NULL,

        -- A remembered choice on a runner that is off is a choice the user
        -- cannot see.
        CHECK (runner_choice IS NULL OR runner_enabled = 1),
        -- A distribution belongs to the WSL choice and to no other.
        CHECK (runner_distro IS NULL OR runner_choice IS 'wsl'),
        -- Enabled with no consent recorded: exactly the state the whole feature
        -- is designed to make impossible.
        CHECK (runner_enabled = 0 OR consented_at IS NOT NULL)
      );
    `);
  },
};
