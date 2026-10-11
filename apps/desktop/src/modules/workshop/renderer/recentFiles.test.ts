import { afterEach, describe, expect, it, vi } from "vitest";

import { memoryStorage } from "../../../renderer/src/testStorage.js";
import {
  RECENT_MAX,
  forgetRecentFiles,
  readRecentFiles,
  recentStorageKey,
  rememberRecentFile,
} from "./recentFiles.js";

/**
 * The recently-opened list: paths only, most recent first, and total against
 * anything a hand-edited storage could hold.
 *
 * The in-memory `Storage` is the renderer's own test helper (`testStorage.ts`),
 * which is the same one `filePrefs.test.ts` installs: this module reads
 * `localStorage` directly, exactly as the device preferences do.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubStorage(seed: Readonly<Record<string, string>> = {}): Storage {
  const storage = memoryStorage(seed);
  vi.stubGlobal("localStorage", storage);
  return storage;
}

const PROFILE = "profile-1";
const KEY = recentStorageKey(PROFILE);

describe("readRecentFiles", () => {
  it("answers nothing when the key is absent or the storage refuses", () => {
    stubStorage();
    expect(readRecentFiles(PROFILE)).toEqual([]);
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("refused");
      },
    });
    expect(readRecentFiles(PROFILE)).toEqual([]);
  });

  it("drops what it does not understand rather than failing on it", () => {
    stubStorage({ [KEY]: "{ not json" });
    expect(readRecentFiles(PROFILE)).toEqual([]);
    stubStorage({ [KEY]: JSON.stringify({ path: "/a.stl" }) });
    expect(readRecentFiles(PROFILE)).toEqual([]);
    stubStorage({
      [KEY]: JSON.stringify([
        { path: "/good.stl", name: "good.stl", target: "model", at: "2026-10-10T09:00:00.000Z" },
        { path: "/nameless.stl", target: "model", at: "2026-10-10T09:00:00.000Z" },
        { name: "pathless.stl", target: "model", at: "2026-10-10T09:00:00.000Z" },
        { path: "/no-instant.stl", name: "no-instant.stl", target: "model" },
        { path: "/no-target.stl", name: "no-target.stl", at: "2026-10-10T09:00:00.000Z" },
        { path: "/bad-target.stl", name: "bad-target.stl", target: "board", at: "x" },
        "a string",
      ]),
    });
    // The last entry survives: "board" IS one of the three targets, and the
    // instant is opaque to this module - it is a sort key, not a parsed date.
    expect(readRecentFiles(PROFILE)).toEqual([
      { path: "/good.stl", name: "good.stl", target: "model", at: "2026-10-10T09:00:00.000Z" },
      { path: "/bad-target.stl", name: "bad-target.stl", target: "board", at: "x" },
    ]);
  });
});

describe("rememberRecentFile", () => {
  it("keeps the newest eight, most recent first", () => {
    stubStorage();
    for (let index = 0; index < 10; index += 1) {
      rememberRecentFile(
        PROFILE,
        { path: `/model-${index}.stl`, name: `model-${index}.stl`, target: "model" },
        `2026-10-10T0${index}:00:00.000Z`,
      );
    }
    const files = readRecentFiles(PROFILE);
    expect(files.length).toBe(RECENT_MAX);
    expect(files[0]?.name).toBe("model-9.stl");
    expect(files.at(-1)?.name).toBe("model-2.stl");
  });

  it("promotes a file that was opened again rather than listing it twice", () => {
    stubStorage();
    rememberRecentFile(PROFILE, { path: "/a.stl", name: "a.stl", target: "model" }, "T08");
    rememberRecentFile(PROFILE, { path: "/b.gcode", name: "b.gcode", target: "toolpath" }, "T09");
    rememberRecentFile(PROFILE, { path: "/a.stl", name: "a.stl", target: "model" }, "T10");

    expect(readRecentFiles(PROFILE)).toEqual([
      { path: "/a.stl", name: "a.stl", target: "model", at: "T10" },
      { path: "/b.gcode", name: "b.gcode", target: "toolpath", at: "T09" },
    ]);
  });

  it("writes one profile's key, and touches neither the machine's other keys nor another profile's list", () => {
    const storage = stubStorage({ "nexus.theme": "dan" });
    rememberRecentFile(PROFILE, { path: "/a.stl", name: "a.stl", target: "model" }, "T08");
    expect(storage.getItem("nexus.theme")).toBe("dan");
    expect(storage.getItem(KEY)?.startsWith("[")).toBe(true);
    expect(readRecentFiles("another-profile")).toEqual([]);
  });
});

describe("forgetRecentFiles", () => {
  it("removes the key outright", () => {
    const storage = stubStorage();
    rememberRecentFile(PROFILE, { path: "/a.stl", name: "a.stl", target: "model" }, "T08");
    forgetRecentFiles(PROFILE);
    expect(storage.getItem(KEY)).toBeNull();
    expect(readRecentFiles(PROFILE)).toEqual([]);
  });

  it("leaves another profile's list alone", () => {
    const storage = stubStorage();
    rememberRecentFile(PROFILE, { path: "/a.stl", name: "a.stl", target: "model" }, "T08");
    rememberRecentFile("other", { path: "/b.stl", name: "b.stl", target: "model" }, "T08");
    forgetRecentFiles(PROFILE);
    expect(readRecentFiles("other").map((file) => file.name)).toEqual(["b.stl"]);
    expect(storage.length).toBe(1);
  });
});
