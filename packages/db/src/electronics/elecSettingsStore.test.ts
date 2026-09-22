import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ElecSettingsStore,
  ElecSettingsValidationError,
  MAX_RUNNER_DISTRO_LENGTH,
  NexusDatabase,
  openDatabase,
} from "../index.js";

let dir: string;
let db: NexusDatabase;

const NOW = "2026-09-22T10:00:00.000Z";
const LATER = "2026-09-22T11:00:00.000Z";
const DISTRO = "Ubuntu-22.04";

const DEFAULTS = {
  enabled: false,
  choice: null,
  distro: null,
  consentedAt: null,
} as const;

function createProfile(name: string): string {
  const id = `profile-${name}`;
  db.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(id, "personal", name, NOW);
  return id;
}

/** A store over a freshly created profile — the shape every test below starts from. */
function createStore(name = "a"): ElecSettingsStore {
  return new ElecSettingsStore(db.raw, createProfile(name));
}

/** A store whose profile has consented and turned the runner ON — what choosing a profile requires. */
function createEnabledStore(name = "a"): ElecSettingsStore {
  const store = createStore(name);
  store.update({ enabled: true, consentedAt: NOW }, NOW);
  return store;
}

/** How many rows the table holds for anyone at all — one, or a second the upsert failed to prevent. */
function rowCount(): number {
  const { n } = db.raw.prepare("SELECT count(*) AS n FROM elec_settings").get() as { n: number };
  return n;
}

/**
 * Writes a row WITHOUT the store — the half of every rule the CHECK has to hold
 * on its own, since a store is not the only way a row can arrive (a restore, a
 * future import, a repair script). Left uncaught so the caller's `toThrow`
 * asserts on SQLite's own refusal.
 */
function insertRow(
  profileId: string,
  row: {
    enabled: number;
    choice: string | null;
    distro: string | null;
    consentedAt: string | null;
  },
): void {
  db.raw
    .prepare(
      `INSERT INTO elec_settings
         (profile_id, runner_enabled, runner_choice, runner_distro, consented_at,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(profileId, row.enabled, row.choice, row.distro, row.consentedAt, NOW, NOW);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-elec-settings-"));
  db = openDatabase({ path: join(dir, "elec-settings.db") });
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("ElecSettingsStore.get", () => {
  it("answers with defaults — the runner OFF, nothing else recorded — while no row exists", () => {
    expect(createStore().get()).toEqual(DEFAULTS);
  });

  it("never writes a row just by being read", () => {
    createStore().get();
    expect(rowCount()).toBe(0);
  });
});

describe("ElecSettingsStore.update", () => {
  it("creates the row on the first write and returns the resolved settings", () => {
    const store = createStore();
    const settings = store.update({ enabled: true, consentedAt: NOW }, NOW);
    expect(settings).toEqual({ ...DEFAULTS, enabled: true, consentedAt: NOW });
    expect(store.get()).toEqual(settings);
    expect(rowCount()).toBe(1);
  });

  it("updates that one row rather than adding a second, and leaves `created_at` alone", () => {
    const profileId = createProfile("a");
    const store = new ElecSettingsStore(db.raw, profileId);
    store.update({ enabled: true, consentedAt: NOW }, NOW);
    const settings = store.update({ choice: "wsl", distro: DISTRO }, LATER);

    expect(settings).toEqual({
      enabled: true,
      choice: "wsl",
      distro: DISTRO,
      consentedAt: NOW,
    });
    expect(rowCount()).toBe(1);
    const { created_at, updated_at } = db.raw
      .prepare("SELECT created_at, updated_at FROM elec_settings WHERE profile_id = ?")
      .get(profileId) as { created_at: string; updated_at: string };
    expect({ created_at, updated_at }).toEqual({ created_at: NOW, updated_at: LATER });
  });

  it("leaves a field alone when the change is absent, and CLEARS it when the change is null", () => {
    const store = createEnabledStore();
    store.update({ choice: "wsl", distro: DISTRO }, LATER);

    expect(store.update({}, LATER).distro).toBe(DISTRO);
    const cleared = store.update({ distro: null }, LATER);
    expect(cleared.distro).toBeNull();
    expect(cleared.choice).toBe("wsl");
  });

  it("refuses an unknown profile id — the foreign key, not a row nobody owns", () => {
    const store = new ElecSettingsStore(db.raw, "no-such-profile");
    expect(store.get()).toEqual(DEFAULTS);
    expect(() => store.update({ enabled: false }, NOW)).toThrow(/FOREIGN KEY constraint failed/);
    expect(rowCount()).toBe(0);
  });

  it("refuses a malformed now, a malformed consent stamp and an unknown choice", () => {
    const store = createStore();
    expect(() => store.update({ enabled: false }, "yesterday")).toThrow(
      ElecSettingsValidationError,
    );
    expect(() => store.update({ consentedAt: "yesterday" }, NOW)).toThrow(
      ElecSettingsValidationError,
    );
    expect(() => store.update({ choice: "podman" as never }, NOW)).toThrow(
      ElecSettingsValidationError,
    );
  });

  it("refuses a non-boolean enabled — the column's own 0/1 domain, named first", () => {
    expect(() => createStore().update({ enabled: 2 as never }, NOW)).toThrow(
      ElecSettingsValidationError,
    );
  });

  it("refuses an empty or oversized distribution", () => {
    const store = createEnabledStore();
    store.update({ choice: "wsl" }, NOW);
    expect(() => store.update({ distro: "" }, NOW)).toThrow(ElecSettingsValidationError);
    expect(() => store.update({ distro: "x".repeat(MAX_RUNNER_DISTRO_LENGTH + 1) }, NOW)).toThrow(
      ElecSettingsValidationError,
    );
  });
});

describe("the consent rule", () => {
  it("refuses to enable the runner before the user has consented", () => {
    expect(() => createStore().update({ enabled: true }, NOW)).toThrow(
      ElecSettingsValidationError,
    );
  });

  it("enables it once the consent is recorded in the same write", () => {
    const store = createStore();
    expect(store.update({ enabled: true, consentedAt: NOW }, NOW).enabled).toBe(true);
  });

  it("lets the consent stand when the runner is turned off again — the record is not the switch", () => {
    const store = createEnabledStore();
    const settings = store.update({ enabled: false }, LATER);
    expect(settings.enabled).toBe(false);
    expect(settings.consentedAt).toBe(NOW);
  });
});

describe("the choice rules", () => {
  it("refuses a choice on a runner that is off — a choice the user cannot see", () => {
    const store = createStore();
    expect(() => store.update({ choice: "native" }, NOW)).toThrow(ElecSettingsValidationError);
  });

  it("accepts a choice once the runner is on, and remembers which one", () => {
    const store = createEnabledStore();
    expect(store.update({ choice: "docker" }, LATER).choice).toBe("docker");
  });

  it("insists that turning the runner off takes the choice with it", () => {
    const store = createEnabledStore();
    store.update({ choice: "wsl", distro: DISTRO }, LATER);
    expect(() => store.update({ enabled: false }, LATER)).toThrow(ElecSettingsValidationError);
    const settings = store.update({ enabled: false, choice: null, distro: null }, LATER);
    expect(settings).toEqual({ enabled: false, choice: null, distro: null, consentedAt: NOW });
  });

  it("refuses a distribution beside a choice that is not wsl", () => {
    const store = createEnabledStore();
    store.update({ choice: "docker" }, LATER);
    expect(() => store.update({ distro: DISTRO }, LATER)).toThrow(ElecSettingsValidationError);
  });

  it("refuses a distribution while the choice is cleared", () => {
    const store = createEnabledStore();
    expect(() => store.update({ distro: DISTRO }, LATER)).toThrow(ElecSettingsValidationError);
  });

  it("keeps the distribution beside the wsl choice, verbatim as the probe spelled it", () => {
    const store = createEnabledStore();
    const settings = store.update({ choice: "wsl", distro: DISTRO }, LATER);
    expect(settings.distro).toBe(DISTRO);
  });
});

describe("the CHECKs, driven without the store", () => {
  it("accepts the one row that is legal — so the refusals below are not refusals of everything", () => {
    insertRow(createProfile("a"), {
      enabled: 1,
      choice: "wsl",
      distro: DISTRO,
      consentedAt: NOW,
    });
    expect(rowCount()).toBe(1);
  });

  it("refuses enabled with no consent on record", () => {
    const profileId = createProfile("a");
    expect(() =>
      insertRow(profileId, { enabled: 1, choice: null, distro: null, consentedAt: null }),
    ).toThrow(/CHECK constraint failed/);
    expect(rowCount()).toBe(0);
  });

  it("refuses a runner_enabled outside 0 and 1", () => {
    const profileId = createProfile("a");
    expect(() =>
      insertRow(profileId, { enabled: 2, choice: null, distro: null, consentedAt: NOW }),
    ).toThrow(/CHECK constraint failed/);
  });

  it("refuses a choice remembered on a runner that is off", () => {
    const profileId = createProfile("a");
    expect(() =>
      insertRow(profileId, { enabled: 0, choice: "native", distro: null, consentedAt: NOW }),
    ).toThrow(/CHECK constraint failed/);
  });

  it("refuses a distribution beside a choice that is not wsl", () => {
    const profileId = createProfile("a");
    expect(() =>
      insertRow(profileId, { enabled: 1, choice: "docker", distro: DISTRO, consentedAt: NOW }),
    ).toThrow(/CHECK constraint failed/);
  });

  it("refuses a distribution while NO choice is remembered — the `=` hole", () => {
    // `runner_choice = 'wsl'` is NULL here rather than false, and a CHECK that
    // evaluates to NULL passes; the migration writes `IS` for this row alone.
    const profileId = createProfile("a");
    expect(() =>
      insertRow(profileId, { enabled: 0, choice: null, distro: DISTRO, consentedAt: NOW }),
    ).toThrow(/CHECK constraint failed/);
  });

  it("refuses an unknown profile — the foreign key, not a row nobody owns", () => {
    expect(() =>
      insertRow("no-such-profile", {
        enabled: 1,
        choice: "wsl",
        distro: DISTRO,
        consentedAt: NOW,
      }),
    ).toThrow(/FOREIGN KEY constraint failed/);
  });
});

describe("profile scoping", () => {
  it("keeps two profiles' settings apart", () => {
    const first = createEnabledStore("a");
    const second = createStore("b");
    first.update({ choice: "wsl", distro: DISTRO }, LATER);
    expect(second.get()).toEqual(DEFAULTS);
    expect(rowCount()).toBe(1);
  });
});
