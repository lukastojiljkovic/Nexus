import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BackupSettingsStore,
  BackupSettingsValidationError,
  DEFAULT_BACKUP_KEEP_LAST,
  MAX_BACKUP_KEEP_LAST,
  MIN_BACKUP_KEEP_LAST,
  NexusDatabase,
  openDatabase,
} from "../index.js";

let dir: string;
let db: NexusDatabase;

const NOW = "2026-07-30T10:00:00.000Z";
const LATER = "2026-07-30T11:00:00.000Z";
const FOLDER = "C:\\Users\\luka\\Backups";
const WRAPPED = '{"v":1,"nonce":"abc","ciphertext":"def"}';

const DEFAULTS = {
  enabled: false,
  cadence: "daily",
  folderPath: null,
  passphraseWrapped: null,
  keepLast: DEFAULT_BACKUP_KEEP_LAST,
  lastRunAt: null,
  lastStatus: null,
  lastError: null,
} as const;

function createProfile(name: string): string {
  const id = `profile-${name}`;
  db.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(id, "personal", name, NOW);
  return id;
}

/** A store over a freshly created profile — the shape every test below starts from. */
function createStore(name = "a"): BackupSettingsStore {
  return new BackupSettingsStore(db.raw, createProfile(name));
}

/** A store whose profile already has a folder and a wrapped passphrase — what enabling requires. */
function createConfiguredStore(name = "a"): BackupSettingsStore {
  const store = createStore(name);
  store.setFolderPath(FOLDER, NOW);
  store.setPassphraseWrapped(WRAPPED, NOW);
  return store;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-backup-"));
  db = openDatabase({ path: join(dir, "backup.db") });
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("BackupSettingsStore.get", () => {
  it("answers with defaults — disabled, daily, keep 5, nothing configured — while no row exists", () => {
    expect(createStore().get()).toEqual(DEFAULTS);
  });

  it("never writes a row just by being read", () => {
    createStore().get();
    const { n } = db.raw.prepare("SELECT count(*) AS n FROM backup_settings").get() as {
      n: number;
    };
    expect(n).toBe(0);
  });
});

describe("BackupSettingsStore.setFolderPath", () => {
  it("creates the row on first write and returns the resolved settings", () => {
    const store = createStore();
    const settings = store.setFolderPath(FOLDER, NOW);
    expect(settings).toEqual({ ...DEFAULTS, folderPath: FOLDER });
    expect(store.get()).toEqual(settings);
  });

  it("replaces a previously chosen folder, leaving everything else alone", () => {
    const store = createConfiguredStore();
    const settings = store.setFolderPath("D:\\Kopije", LATER);
    expect(settings.folderPath).toBe("D:\\Kopije");
    expect(settings.passphraseWrapped).toBe(WRAPPED);
  });

  it("refuses an empty or oversized path", () => {
    const store = createStore();
    expect(() => store.setFolderPath("", NOW)).toThrow(BackupSettingsValidationError);
    expect(() => store.setFolderPath("x".repeat(1025), NOW)).toThrow(
      BackupSettingsValidationError,
    );
  });

  it("refuses a malformed now", () => {
    expect(() => createStore().setFolderPath(FOLDER, "yesterday")).toThrow(
      BackupSettingsValidationError,
    );
  });
});

describe("BackupSettingsStore.setPassphraseWrapped", () => {
  it("stores the wrap and reports it back", () => {
    const store = createStore();
    const settings = store.setPassphraseWrapped(WRAPPED, NOW);
    expect(settings).toEqual({ ...DEFAULTS, passphraseWrapped: WRAPPED });
  });

  it("replaces an existing wrap — future runs use the new passphrase", () => {
    const store = createConfiguredStore();
    const next = '{"v":1,"nonce":"zzz","ciphertext":"yyy"}';
    expect(store.setPassphraseWrapped(next, LATER).passphraseWrapped).toBe(next);
  });

  it("refuses an empty or oversized wrap", () => {
    const store = createStore();
    expect(() => store.setPassphraseWrapped("", NOW)).toThrow(BackupSettingsValidationError);
    expect(() => store.setPassphraseWrapped("x".repeat(8193), NOW)).toThrow(
      BackupSettingsValidationError,
    );
  });
});

describe("BackupSettingsStore.setSchedule", () => {
  it("enables a configured profile and records cadence and keep-last", () => {
    const store = createConfiguredStore();
    const settings = store.setSchedule({ enabled: true, cadence: "weekly", keepLast: 10 }, LATER);
    expect(settings.enabled).toBe(true);
    expect(settings.cadence).toBe("weekly");
    expect(settings.keepLast).toBe(10);
  });

  it("refuses to enable while no folder is chosen", () => {
    const store = createStore();
    store.setPassphraseWrapped(WRAPPED, NOW);
    expect(() =>
      store.setSchedule({ enabled: true, cadence: "daily", keepLast: 5 }, LATER),
    ).toThrow(BackupSettingsValidationError);
  });

  it("refuses to enable while no passphrase is set", () => {
    const store = createStore();
    store.setFolderPath(FOLDER, NOW);
    expect(() =>
      store.setSchedule({ enabled: true, cadence: "daily", keepLast: 5 }, LATER),
    ).toThrow(BackupSettingsValidationError);
  });

  it("disables regardless of configuration, keeping the choices for a later re-enable", () => {
    const store = createConfiguredStore();
    store.setSchedule({ enabled: true, cadence: "weekly", keepLast: 10 }, LATER);
    const settings = store.setSchedule({ enabled: false, cadence: "weekly", keepLast: 10 }, LATER);
    expect(settings.enabled).toBe(false);
    expect(settings.cadence).toBe("weekly");
    expect(settings.folderPath).toBe(FOLDER);
  });

  it("accepts the whole keep-last range and refuses anything outside or fractional", () => {
    const store = createConfiguredStore();
    for (const keepLast of [MIN_BACKUP_KEEP_LAST, MAX_BACKUP_KEEP_LAST]) {
      expect(store.setSchedule({ enabled: false, cadence: "daily", keepLast }, LATER).keepLast).toBe(
        keepLast,
      );
    }
    for (const keepLast of [MIN_BACKUP_KEEP_LAST - 1, MAX_BACKUP_KEEP_LAST + 1, 4.5]) {
      expect(() => store.setSchedule({ enabled: false, cadence: "daily", keepLast }, LATER)).toThrow(
        BackupSettingsValidationError,
      );
    }
  });

  it("refuses an unknown cadence", () => {
    const store = createConfiguredStore();
    expect(() =>
      store.setSchedule({ enabled: false, cadence: "hourly" as never, keepLast: 5 }, LATER),
    ).toThrow(BackupSettingsValidationError);
  });
});

describe("BackupSettingsStore.recordRun", () => {
  it("records a successful run, clearing any earlier error", () => {
    const store = createConfiguredStore();
    store.recordRun(NOW, "failed", "folder-unreachable");
    const settings = store.recordRun(LATER, "ok", null);
    expect(settings.lastRunAt).toBe(LATER);
    expect(settings.lastStatus).toBe("ok");
    expect(settings.lastError).toBeNull();
  });

  it("records a failed run with its named error", () => {
    const store = createConfiguredStore();
    const settings = store.recordRun(NOW, "failed", "folder-unreachable");
    expect(settings.lastRunAt).toBe(NOW);
    expect(settings.lastStatus).toBe("failed");
    expect(settings.lastError).toBe("folder-unreachable");
  });

  it("requires an error exactly when the run failed", () => {
    const store = createConfiguredStore();
    expect(() => store.recordRun(NOW, "ok", "x")).toThrow(BackupSettingsValidationError);
    expect(() => store.recordRun(NOW, "failed", null)).toThrow(BackupSettingsValidationError);
    expect(() => store.recordRun(NOW, "failed", "")).toThrow(BackupSettingsValidationError);
  });

  it("refuses an unknown status and a malformed timestamp", () => {
    const store = createConfiguredStore();
    expect(() => store.recordRun(NOW, "done" as never, null)).toThrow(
      BackupSettingsValidationError,
    );
    expect(() => store.recordRun("yesterday", "ok", null)).toThrow(BackupSettingsValidationError);
  });
});

describe("profile scoping", () => {
  it("keeps two profiles' settings apart", () => {
    const first = createConfiguredStore("a");
    const second = createStore("b");
    first.setSchedule({ enabled: true, cadence: "weekly", keepLast: 10 }, LATER);
    expect(second.get()).toEqual(DEFAULTS);
  });
});
