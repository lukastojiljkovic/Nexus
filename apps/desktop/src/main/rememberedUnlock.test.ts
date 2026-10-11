import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { UNLOCK_SETTINGS, settingNeedsPasscode, type UnlockSetting } from "../shared/ipc.js";
import {
  asUnlockSetting,
  forgetRememberedKey,
  isUnlockSetting,
  isWrapFresh,
  readUnlockPolicy,
  rememberingProblem,
  storeUnlockPolicy,
  takeRememberedKey,
  type Keystore,
  type RememberedUnlockDeps,
} from "./rememberedUnlock.js";

/**
 * A keystore a test can be: a reversible prefix instead of DPAPI, a switch for
 * the two refusal branches, and a count of encryptions so „nothing was written"
 * is an observation rather than an absence of evidence.
 */
function fakeKeystore(options: { available?: boolean; backend?: string } = {}) {
  const state = { available: options.available ?? true, backend: options.backend ?? "unknown", encryptions: 0 };
  const keystore: Keystore = {
    isEncryptionAvailable: () => state.available,
    getSelectedStorageBackend: () => state.backend,
    encryptString: (plain) => {
      state.encryptions += 1;
      return Buffer.from(`wrap:${plain}`, "utf8");
    },
    decryptString: (encrypted) => {
      const text = encrypted.toString("utf8");
      if (!text.startsWith("wrap:")) throw new Error("not ours");
      return text.slice("wrap:".length);
    },
  };
  return { keystore, state };
}

/** A data key of the shape `openEncrypted` takes — 32 bytes, hex. */
const DATA_KEY = "a".repeat(64);

const dirs: string[] = [];
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "nexus-remembered-unlock-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function depsAt(instant: string, options: { available?: boolean; backend?: string } = {}) {
  const { keystore, state } = fakeKeystore(options);
  const deps: RememberedUnlockDeps = {
    keystore,
    platform: process.platform,
    now: () => new Date(instant),
  };
  return { deps, state };
}

describe("the setting", () => {
  it("carries exactly Luka's six choices, every-time first", () => {
    // The order is the UI's order, so it is asserted rather than assumed: the
    // row draws THIS array, and a member moved to the front would make the
    // default look like the strongest choice on the list.
    expect([...UNLOCK_SETTINGS]).toEqual(["every-time", "1h", "8h", "1d", "7d", "never"]);
  });

  it("validates a payload member and refuses everything else", () => {
    expect(asUnlockSetting("1h", "setting")).toBe("1h");
    expect(asUnlockSetting("never", "setting")).toBe("never");
    for (const bad of ["", "1H", "60", "always", 60, null, undefined, {}]) {
      expect(() => asUnlockSetting(bad, "setting")).toThrow(/setting must be one of/);
    }
    expect(isUnlockSetting("7d")).toBe(true);
    expect(isUnlockSetting("8h ")).toBe(false);
  });

  it("asks for the passcode for every choice weaker than the default, and not for the default", () => {
    expect(settingNeedsPasscode("every-time")).toBe(false);
    for (const setting of ["1h", "8h", "1d", "7d", "never"] as const) {
      expect(settingNeedsPasscode(setting)).toBe(true);
    }
  });
});

describe("the expiry, at every boundary", () => {
  const wrappedAt = new Date("2026-10-10T12:00:00.000Z");
  /** Minutes each member remembers for, hand-copied from the setting's own meaning rather than from the constant under test. */
  const MINUTES: Record<UnlockSetting, number | null> = {
    "every-time": 0,
    "1h": 60,
    "8h": 480,
    "1d": 1440,
    "7d": 10080,
    never: null,
  };

  for (const setting of UNLOCK_SETTINGS) {
    const minutes = MINUTES[setting];
    if (minutes === null) {
      it(`${setting} never expires`, () => {
        expect(isWrapFresh(setting, wrappedAt, new Date("2099-01-01T00:00:00.000Z"))).toBe(true);
      });
      continue;
    }
    if (minutes === 0) {
      it(`${setting} is never remembered at all`, () => {
        expect(isWrapFresh(setting, wrappedAt, wrappedAt)).toBe(false);
      });
      continue;
    }
    it(`${setting} is fresh one millisecond before its own duration, and not at it`, () => {
      const last = new Date(wrappedAt.getTime() + minutes * 60_000 - 1);
      const boundary = new Date(wrappedAt.getTime() + minutes * 60_000);
      expect(isWrapFresh(setting, wrappedAt, last)).toBe(true);
      expect(isWrapFresh(setting, wrappedAt, boundary)).toBe(false);
    });
  }
});

describe("the keystore question", () => {
  it("is null when the keystore encrypts", () => {
    const { deps } = depsAt("2026-10-10T12:00:00.000Z");
    expect(rememberingProblem(deps)).toBeNull();
  });

  it("names an unavailable keystore", () => {
    const { deps } = depsAt("2026-10-10T12:00:00.000Z", { available: false });
    expect(rememberingProblem(deps)).toBe("keystore");
  });

  it("names Linux's basic_text backend, which reports encryption as AVAILABLE", () => {
    const { keystore } = fakeKeystore({ available: true, backend: "basic_text" });
    const linux: RememberedUnlockDeps = {
      keystore,
      platform: "linux",
      now: () => new Date("2026-10-10T12:00:00.000Z"),
    };
    expect(rememberingProblem(linux)).toBe("plaintext-backend");
    // The same backend name on a platform that does not have that backend is
    // not a refusal: `getSelectedStorageBackend` is a Linux question, and
    // Windows' DPAPI is not made weaker by a string it never returns.
    const windows: RememberedUnlockDeps = { ...linux, platform: "win32" };
    expect(rememberingProblem(windows)).toBeNull();
  });
});

describe("the wrap's life cycle", () => {
  it("is written after an unlock, read at the next start, and deleted by every lock", () => {
    const dir = scratch();
    const { deps, state } = depsAt("2026-10-10T12:00:00.000Z");
    writeFileSync(join(dir, "nexus.db"), "");

    expect(storeUnlockPolicy(deps, dir, "1d", DATA_KEY)).toBe(true);
    expect(state.encryptions).toBe(1);
    // What is on disk is the KEYSTORE's bytes, never the key: the plain hex
    // string must not appear anywhere in the file.
    const stored = readFileSync(join(dir, "remembered-unlock.json"), "utf8");
    expect(stored).not.toContain(DATA_KEY);
    expect(JSON.parse(stored)).toMatchObject({
      version: 1,
      setting: "1d",
      wrap: { wrappedAt: "2026-10-10T12:00:00.000Z" },
    });

    // Nine minutes later, the same key opens without a prompt.
    const later = depsAt("2026-10-10T12:09:00.000Z").deps;
    expect(takeRememberedKey(later, dir)).toBe(DATA_KEY);

    // A lock the user asked for forgets the wrap AND keeps the choice.
    forgetRememberedKey(dir);
    expect(takeRememberedKey(later, dir)).toBeNull();
    expect(readUnlockPolicy(later, dir)).toMatchObject({ setting: "1d", available: true });
    expect(JSON.parse(readFileSync(join(dir, "remembered-unlock.json"), "utf8")).wrap).toBeNull();
  });

  it("keeps the wrap for a never-choice with no expiry at all", () => {
    const dir = scratch();
    storeUnlockPolicy(depsAt("2026-10-10T12:00:00.000Z").deps, dir, "never", DATA_KEY);
    expect(takeRememberedKey(depsAt("2036-10-10T12:00:00.000Z").deps, dir)).toBe(DATA_KEY);
  });

  it("forgets an expired wrap, and answers null for it", () => {
    const dir = scratch();
    storeUnlockPolicy(depsAt("2026-10-10T12:00:00.000Z").deps, dir, "1h", DATA_KEY);
    const after = depsAt("2026-10-10T13:00:00.000Z").deps;
    expect(takeRememberedKey(after, dir)).toBeNull();
    // Deleted, not merely ignored: a key sitting on disk past its window is a
    // key nobody can see in the UI.
    expect(JSON.parse(readFileSync(join(dir, "remembered-unlock.json"), "utf8")).wrap).toBeNull();
  });

  it("forgets a wrap this keystore cannot decrypt — the copied-profile case", () => {
    const dir = scratch();
    storeUnlockPolicy(depsAt("2026-10-10T12:00:00.000Z").deps, dir, "7d", DATA_KEY);
    const file = JSON.parse(readFileSync(join(dir, "remembered-unlock.json"), "utf8"));
    file.wrap.blob = Buffer.from("someone else's DPAPI blob", "utf8").toString("base64");
    writeFileSync(join(dir, "remembered-unlock.json"), JSON.stringify(file));
    expect(takeRememberedKey(depsAt("2026-10-10T12:05:00.000Z").deps, dir)).toBeNull();
    expect(JSON.parse(readFileSync(join(dir, "remembered-unlock.json"), "utf8")).wrap).toBeNull();
  });

  it("refuses to remember anything when the keystore is unavailable", () => {
    const dir = scratch();
    const { deps, state } = depsAt("2026-10-10T12:00:00.000Z", { available: false });
    expect(storeUnlockPolicy(deps, dir, "1d", DATA_KEY)).toBe(false);
    expect(state.encryptions).toBe(0);
    expect(takeRememberedKey(deps, dir)).toBeNull();
    expect(readUnlockPolicy(deps, dir)).toMatchObject({ available: false, reason: "keystore" });
  });

  it("refuses on Linux's basic_text backend without leaving a wrap behind", () => {
    const dir = scratch();
    const { keystore, state } = fakeKeystore({ available: true, backend: "basic_text" });
    const linux: RememberedUnlockDeps = {
      keystore,
      platform: "linux",
      now: () => new Date("2026-10-10T12:00:00.000Z"),
    };
    expect(storeUnlockPolicy(linux, dir, "1d", DATA_KEY)).toBe(false);
    expect(state.encryptions).toBe(0);
    expect(takeRememberedKey(linux, dir)).toBeNull();
    expect(readUnlockPolicy(linux, dir)).toMatchObject({
      available: false,
      reason: "plaintext-backend",
    });
  });

  it("keeps a choice made on a day the machine could honour it, and drops only the wrap", () => {
    const dir = scratch();
    storeUnlockPolicy(depsAt("2026-10-10T12:00:00.000Z").deps, dir, "1d", DATA_KEY);
    // The next launch has no keystore at all (a migrated profile folder, a
    // Linux session on the basic_text backend): the wrap must go, and the
    // policy must survive so the card can show what was chosen and why it is
    // not being honoured right now.
    const { deps } = depsAt("2026-10-11T12:00:00.000Z", { available: false });
    expect(storeUnlockPolicy(deps, dir, "1d", DATA_KEY)).toBe(false);
    expect(takeRememberedKey(deps, dir)).toBeNull();
    expect(readUnlockPolicy(deps, dir)).toMatchObject({ setting: "1d", available: false });
  });

  it("does not remember under the default, and says so in the file", () => {
    const dir = scratch();
    const { deps, state } = depsAt("2026-10-10T12:00:00.000Z");
    expect(storeUnlockPolicy(deps, dir, "every-time", DATA_KEY)).toBe(true);
    expect(state.encryptions).toBe(0);
    expect(takeRememberedKey(deps, dir)).toBeNull();
    expect(readUnlockPolicy(deps, dir).setting).toBe("every-time");
  });

  it("fails towards the passcode on a file that is not ours", () => {
    const dir = scratch();
    const { deps } = depsAt("2026-10-10T12:00:00.000Z");
    for (const garbage of ["", "not json", '{"version":2,"setting":"never"}', '{"setting":"1d","wrap":{"wrappedAt":"whenever","blob":"x"}}', "[]"]) {
      writeFileSync(join(dir, "remembered-unlock.json"), garbage);
      expect(takeRememberedKey(deps, dir)).toBeNull();
      expect(readUnlockPolicy(deps, dir)).toMatchObject({ setting: "every-time", available: true });
    }
  });

  it("refuses a wrap whose blob is not a 256-bit hex key, rather than failing the database open", () => {
    const dir = scratch();
    storeUnlockPolicy(depsAt("2026-10-10T12:00:00.000Z").deps, dir, "1d", DATA_KEY);
    const file = JSON.parse(readFileSync(join(dir, "remembered-unlock.json"), "utf8"));
    file.wrap.blob = Buffer.from("wrap:not-a-key", "utf8").toString("base64");
    writeFileSync(join(dir, "remembered-unlock.json"), JSON.stringify(file));
    expect(takeRememberedKey(depsAt("2026-10-10T12:01:00.000Z").deps, dir)).toBeNull();
    expect(JSON.parse(readFileSync(join(dir, "remembered-unlock.json"), "utf8")).wrap).toBeNull();
  });

  it("creates nothing for an account that never chose a setting", () => {
    const dir = scratch();
    const { deps } = depsAt("2026-10-10T12:00:00.000Z");
    expect(takeRememberedKey(deps, dir)).toBeNull();
    // `forgetRememberedKey` is called from `performLock`, which runs on every
    // lock of every account — including the many that never touched this
    // feature. An account that never chose a setting must not end up with a
    // file because it was locked.
    forgetRememberedKey(dir);
    expect(existsSync(join(dir, "remembered-unlock.json"))).toBe(false);
    expect(readUnlockPolicy(deps, dir).setting).toBe("every-time");
  });
});
