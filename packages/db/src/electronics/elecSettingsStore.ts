import type Database from "better-sqlite3-multiple-ciphers";
import { RUNNER_PROFILES } from "@nexus/core";
import type { RunnerProfileId } from "@nexus/core";
import { ElecSettingsValidationError } from "../errors.js";
import { isDateTime } from "../finance/money.js";

type DatabaseHandle = Database.Database;

/** Bounds what a distribution's name may occupy — SEC-EL-02's cap on what a row can ever hold, not a format check. */
export const MAX_RUNNER_DISTRO_LENGTH = 128;

/**
 * This profile's runner settings, defaults already applied — what `get`
 * answers and what every mutation returns.
 *
 * There is no `createdAt`/`updatedAt` here, on `BackupSettings`' terms: the two
 * timestamps are the row's bookkeeping, and nothing that reads these settings
 * has ever wanted them.
 */
export interface ElecSettings {
  /** Whether Nexus may spawn a process on this machine. OFF until a user turns it on, once, deliberately (migration 069's default). */
  enabled: boolean;
  /** Which of the three profiles the user last chose — `@nexus/core`'s closed table, never a name this store made up — or null while they have not chosen one. */
  choice: RunnerProfileId | null;
  /** The WSL distribution, verbatim as the probe spelled it, or null for every other choice and until one is picked. */
  distro: string | null;
  /** When the user agreed to let Nexus spawn a process here, or null while they never have. */
  consentedAt: string | null;
}

/**
 * A partial change to those settings — the shape the two write channels carry
 * (`elec:runner-enable` and `elec:runner-choice`).
 *
 * Three states per field, `UpdateCircuitPartFields`' arrangement: absent leaves
 * the stored value alone, a value replaces it, and `null` CLEARS it — which is
 * why the two nullable fields say `| null` beside `?` rather than relying on
 * `undefined` for both jobs. An `undefined` that meant „clear“ as well would
 * make „leave it alone“ unsayable.
 */
export interface ElecSettingsChanges {
  enabled?: boolean;
  choice?: RunnerProfileId | null;
  distro?: string | null;
  consentedAt?: string | null;
}

interface SettingsRow {
  runner_enabled: number;
  runner_choice: string | null;
  runner_distro: string | null;
  consented_at: string | null;
}

/**
 * The per-profile runner settings (ADR-085 E6), over prepared, parameterized
 * statements (SEC-API-03; every value is bound, never interpolated). Constructed
 * one per profile and reused, like every other store here.
 *
 * `get` is a get-or-default read that never writes — `backup_settings`'
 * arrangement (migration 044 / `BackupSettingsStore.get`): a profile that never
 * turned the runner on costs no row, and the defaults live in one place. The
 * default that matters is `enabled: false`, and it is the product decision the
 * whole feature hangs on: the app spawns nothing until a user says so.
 *
 * `update` refuses the three states migration 069's CHECKs also refuse, because
 * a CHECK is what holds when a row arrives from outside the store and a store's
 * caller is untrusted (SEC-EL-02). Two of them are worth knowing before calling
 * it:
 *
 * - **Turning the runner OFF must clear `choice` and `distro` in the same
 *   write.** A remembered choice on a runner that is off is a choice the user
 *   cannot see, so the pair is unrepresentable rather than merely discouraged —
 *   disabling is not „keep the choice warm“, it is turning the thing off.
 * - **`distro` may only be set beside `choice: "wsl"`.** A distribution belongs
 *   to the WSL choice and to no other, and a name stored without the profile
 *   that makes it meaningful is a value nothing can act on.
 *
 * The three profiles are NOT written down again here. `RUNNER_PROFILES` is
 * `@nexus/core`'s closed table — the renderer's panel, `buildCommand` and
 * migration 069's CHECK domain all read that one — and a second copy in a store
 * is exactly how a closed table stops being closed.
 */
export class ElecSettingsStore {
  private readonly selectSettings: Database.Statement;
  private readonly upsertSettings: Database.Statement;

  constructor(
    db: DatabaseHandle,
    private readonly profileId: string,
  ) {
    this.selectSettings = db.prepare(
      `SELECT runner_enabled, runner_choice, runner_distro, consented_at
         FROM elec_settings
        WHERE profile_id = ?`,
    );
    this.upsertSettings = db.prepare(
      `INSERT INTO elec_settings
         (profile_id, runner_enabled, runner_choice, runner_distro, consented_at,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (profile_id) DO UPDATE SET
         runner_enabled = excluded.runner_enabled,
         runner_choice = excluded.runner_choice,
         runner_distro = excluded.runner_distro,
         consented_at = excluded.consented_at,
         updated_at = excluded.updated_at`,
    );
  }

  /** This profile's settings: the runner OFF, no choice, no distribution, no consent recorded. Never writes. */
  get(): ElecSettings {
    const row = this.selectSettings.get(this.profileId) as SettingsRow | undefined;
    if (row === undefined) {
      return { enabled: false, choice: null, distro: null, consentedAt: null };
    }
    return {
      enabled: row.runner_enabled === 1,
      // Cast on the way OUT, `toPart`'s rotation exactly: the column CHECK is
      // what makes it one of the three, and a widened `string` here would
      // spread „it is only a name“ to every reader of stored settings.
      choice: row.runner_choice as RunnerProfileId | null,
      distro: row.runner_distro,
      consentedAt: row.consented_at,
    };
  }

  /**
   * Merges `changes` over what is stored, validates the merged row, and writes
   * it — creating the row on the first write and stamping `updated_at` with
   * `now`. `now` is supplied by the caller and validated here: main stamps the
   * clock, the renderer never does.
   *
   * The VALIDATION IS OF THE MERGED STATE rather than of the fields given,
   * which is the difference between this store and a setter per column: „the
   * runner is enabled and nobody ever consented“ is a property of the row, not
   * of any one field, and a partial update is exactly how a caller could
   * otherwise reach it one harmless-looking field at a time.
   */
  update(changes: ElecSettingsChanges, now: string): ElecSettings {
    const validNow = validateDateTime(now);
    const current = this.get();
    // Three states on the two nullable fields, so `??` is the wrong operator
    // there — `UpdateCircuitPartFields`' reason restated: it cannot tell
    // „leave it alone“ from „clear it“, and both have to be sayable.
    const next: ElecSettings = {
      enabled: changes.enabled ?? current.enabled,
      choice: changes.choice === undefined ? current.choice : changes.choice,
      distro: changes.distro === undefined ? current.distro : changes.distro,
      consentedAt:
        changes.consentedAt === undefined ? current.consentedAt : changes.consentedAt,
    };
    refuse(next);
    return this.write(next, validNow);
  }

  /** One upsert for every mutation above: writes the whole merged row, `created_at` only on first insert. */
  private write(settings: ElecSettings, now: string): ElecSettings {
    this.upsertSettings.run(
      this.profileId,
      settings.enabled ? 1 : 0,
      settings.choice,
      settings.distro,
      settings.consentedAt,
      now,
      now,
    );
    return settings;
  }
}

/**
 * The rules migration 069's CHECKs state, restated so a refusal is a named
 * error rather than a bare constraint failure: the two closed domains, then the
 * three cross-field ones, in the order they are written there. The field shapes
 * come first because a rule about the CHOICE has nothing useful to say about a
 * choice that is not one of the three.
 *
 * **{@link MAX_RUNNER_DISTRO_LENGTH} has no CHECK beside it, and that is the one
 * rule here the schema does not also state.** The CHECKs exist for the row that
 * arrives from outside the store — that is `refuse`'s own premise — and this
 * column has no such route: `elec_settings` is not carried by an export archive,
 * is not in the restore's wipe list, carries no sync journal trigger and is
 * reached by no IPC channel, so the store is its only writer. Adding the cap to
 * 069 would have meant editing a migration whose version is already recorded,
 * which does not re-run and would therefore protect nothing on any database that
 * had it — the asymmetry is deliberate rather than missed.
 */
function refuse(settings: ElecSettings): void {
  if (typeof settings.enabled !== "boolean") {
    throw new ElecSettingsValidationError(`"enabled" must be a boolean.`);
  }
  if (settings.choice !== null && !RUNNER_PROFILES.includes(settings.choice)) {
    throw new ElecSettingsValidationError(
      `"choice" must be null or one of: ${RUNNER_PROFILES.join(", ")}.`,
    );
  }
  if (
    settings.distro !== null &&
    (typeof settings.distro !== "string" ||
      settings.distro.length === 0 ||
      settings.distro.length > MAX_RUNNER_DISTRO_LENGTH)
  ) {
    throw new ElecSettingsValidationError(
      `"distro" must be a non-empty string of at most ${MAX_RUNNER_DISTRO_LENGTH} characters.`,
    );
  }
  if (settings.consentedAt !== null && !isDateTime(settings.consentedAt)) {
    throw new ElecSettingsValidationError(`"consentedAt" must be an ISO-8601 date-time.`);
  }

  // The three cross-field rules — migration 069's own CHECKs, in their order.
  if (settings.choice !== null && !settings.enabled) {
    throw new ElecSettingsValidationError(
      "A choice cannot be remembered while the runner is off — turn it on first, or clear the choice in the same write.",
    );
  }
  if (settings.distro !== null && settings.choice !== "wsl") {
    throw new ElecSettingsValidationError(
      `A distribution belongs to the WSL choice and to no other; "choice" is ${
        settings.choice === null ? "null" : `"${settings.choice}"`
      }.`,
    );
  }
  if (settings.enabled && settings.consentedAt === null) {
    throw new ElecSettingsValidationError(
      "The runner cannot be enabled before the user has consented to it.",
    );
  }
}

function validateDateTime(value: string): string {
  if (!isDateTime(value)) {
    throw new ElecSettingsValidationError(`"now" must be an ISO-8601 date-time.`);
  }
  return value;
}
