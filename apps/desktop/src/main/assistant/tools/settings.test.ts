import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NexusDatabase, NotificationStore, openDatabase, uuidv7 } from "@nexus/db";
import type { ConfirmRequest, Tool, ToolContext } from "@nexus/core";
import { createModuleRegistry } from "../../../shared/modules.js";
import { resolveShellVisibility, writeShellVisibility } from "../../visibility.js";
import { DEFAULT_SHELL_VISIBILITY } from "../../../shared/moduleVisibility.js";
import { settingsTools } from "./settings.js";

/**
 * The SETTINGS tools over a real database and a real `userData` folder.
 *
 * The device's appearance is not written from main at all: `set-preference`
 * answers with an action the Settings page applies, so its tests pin the
 * location and the refusals, and the page's own check (`parseDevicePreference`)
 * is pinned in `shared/devicePreferences.test.ts`.
 */

const NOW_MS = new Date(2026, 9, 15, 9, 0, 0).getTime();
const NOW_ISO = new Date(NOW_MS).toISOString();

let dir: string;
let userData: string;
let db: NexusDatabase;
let profileId: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-tool-settings-"));
  userData = join(dir, "userData");
  db = openDatabase({ path: join(dir, "profile.db") });
});

afterAll(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  profileId = uuidv7();
  db.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(profileId, "personal", "Test", NOW_ISO);
  writeShellVisibility(userData, DEFAULT_SHELL_VISIBILITY);
});

function tools(): readonly Tool[] {
  return settingsTools({
    profileDb: (id, open) => open(db.raw, id),
    now: () => NOW_MS,
    userData: () => userData,
    appVersion: () => "2.1.0-test",
    modules: createModuleRegistry(),
  });
}

function toolOf(name: string): Tool {
  const found = tools().find((entry) => entry.name === name);
  if (found === undefined) throw new Error(`Test setup: no tool "${name}".`);
  return found;
}

function contextFor(locale: "sr" | "en", allow: boolean): {
  readonly context: ToolContext;
  readonly confirms: ConfirmRequest[];
} {
  const confirms: ConfirmRequest[] = [];
  return {
    confirms,
    context: {
      profileId,
      locale,
      signal: new AbortController().signal,
      confirm: (request) => {
        confirms.push(request);
        return Promise.resolve(allow);
      },
    },
  };
}

function notifications(): NotificationStore {
  return new NotificationStore(db.raw, profileId);
}

describe("settings.read", () => {
  it("reports the notification settings, with the sources that are off", async () => {
    const { context } = contextFor("en", true);
    const result = await toolOf("settings.read").run({ section: "notifications" }, context);
    expect(result.ok).toBe(true);
    expect(result.content).toContain("Default snooze: 10m");
    expect(result.content).toContain("Off: none.");
  });

  it("reports the assistant's tier and web search, read-only", async () => {
    const { context, confirms } = contextFor("sr", true);
    const result = await toolOf("settings.read").run({ section: "assistant" }, context);
    expect(result.ok).toBe(true);
    expect(result.content).toContain("nivo „Ravnoteža“");
    expect(result.content).toContain("Pretraga weba: isključena.");
    expect(confirms).toHaveLength(0);
  });

  it("lists the modules this device shows and hides, from the device's own file", async () => {
    const { context } = contextFor("en", true);
    writeShellVisibility(userData, { ...DEFAULT_SHELL_VISIBILITY, hidden: ["tasks"] });
    const result = await toolOf("settings.read").run({ section: "modules" }, context);
    expect(result.ok).toBe(true);
    expect(resolveShellVisibility(userData).hidden).toEqual(["tasks"]);
    expect(result.content).toMatch(/Hidden modules: .*tasks/);
  });

  it("reports the app version", async () => {
    const { context } = contextFor("en", true);
    const result = await toolOf("settings.read").run({ section: "app" }, context);
    expect(result.content).toBe("Version: 2.1.0-test.");
  });

  it("refuses a section outside the list, with the schema's message", async () => {
    const { context } = contextFor("en", true);
    const result = await toolOf("settings.read").run({ section: "privacy" }, context);
    expect(result.ok).toBe(false);
    expect(result.content).toContain('"section" must be one of');
  });
});

describe("settings.reminders", () => {
  it("turns one source's reminders off and names it in the confirmation", async () => {
    const { context, confirms } = contextFor("en", true);
    const result = await toolOf("settings.reminders").run(
      { source: "habit", enabled: false },
      context,
    );
    expect(result.ok).toBe(true);
    expect(confirms[0]?.summary).toBe("Change notifications: turn reminders for “Habit” off.");
    expect(notifications().getSettings().enabledSources).not.toContain("habit");
    expect(result.navigateTo).toEqual({ module: "settings", settings: "notifications" });
  });

  it("writes nothing when the user declines", async () => {
    const { context } = contextFor("sr", false);
    const result = await toolOf("settings.reminders").run(
      { snoozeDefault: "1h" },
      context,
    );
    expect(result).toEqual({ ok: false, content: "The user declined." });
    expect(notifications().getSettings().snoozeDefault).toBe("10m");
  });

  it("sets the default snooze on its own", async () => {
    const { context } = contextFor("en", true);
    await toolOf("settings.reminders").run({ snoozeDefault: "tonight" }, context);
    expect(notifications().getSettings().snoozeDefault).toBe("tonight");
  });

  it("refuses a source without enabled, and a call that changes nothing", async () => {
    const { context } = contextFor("en", true);
    const tool = toolOf("settings.reminders");
    const half = await tool.run({ source: "task" }, context);
    expect(half.ok).toBe(false);
    expect(half.content).toContain("go together");
    const empty = await tool.run({}, context);
    expect(empty.ok).toBe(false);
    expect(empty.content).toContain("Name a notification source");
  });

  it("refuses the security source, which cannot be silenced", async () => {
    const { context, confirms } = contextFor("en", true);
    const result = await toolOf("settings.reminders").run(
      { source: "security", enabled: false },
      context,
    );
    expect(result.ok).toBe(false);
    expect(confirms).toHaveLength(0);
  });
});

describe("settings.model", () => {
  it("changes the default tier and says a hand-picked model is cleared", async () => {
    const { context, confirms } = contextFor("en", true);
    const result = await toolOf("settings.model").run({ tier: "speed" }, context);
    expect(result.ok).toBe(true);
    expect(confirms[0]?.summary).toBe("Change the assistant's model to the “Speed” tier");
    expect(result.navigateTo).toEqual({ module: "settings", settings: "assistant" });
  });

  it("writes nothing when the user declines", async () => {
    const { context } = contextFor("sr", false);
    const result = await toolOf("settings.model").run({ tier: "intelligence" }, context);
    expect(result).toEqual({ ok: false, content: "The user declined." });
  });

  it("refuses a tier outside the three", async () => {
    const { context } = contextFor("en", true);
    const result = await toolOf("settings.model").run({ tier: "turbo" }, context);
    expect(result.ok).toBe(false);
    expect(result.content).toContain('"tier" must be one of');
  });
});

describe("settings.module", () => {
  it("hides a module on this device and writes the file", async () => {
    const { context, confirms } = contextFor("en", true);
    const result = await toolOf("settings.module").run(
      { id: "tasks", visible: false },
      context,
    );
    expect(result.ok).toBe(true);
    expect(confirms[0]?.summary).toBe("Hide the module “tasks” on this device");
    expect(resolveShellVisibility(userData).hidden).toContain("tasks");
    expect(result.navigateTo).toEqual({ module: "settings", settings: "modules" });
  });

  it("writes nothing when the user declines", async () => {
    const { context } = contextFor("sr", false);
    const result = await toolOf("settings.module").run({ id: "tasks", visible: false }, context);
    expect(result).toEqual({ ok: false, content: "The user declined." });
    expect(resolveShellVisibility(userData).hidden).not.toContain("tasks");
  });

  it("refuses a locked module and names it", async () => {
    const { context, confirms } = contextFor("en", true);
    const result = await toolOf("settings.module").run(
      { id: "dashboard", visible: false },
      context,
    );
    expect(result.ok).toBe(false);
    expect(result.content).toContain("“dashboard” cannot be hidden or shown");
    expect(confirms).toHaveLength(0);
  });

  it("refuses an id the registry does not know", async () => {
    const { context } = contextFor("sr", true);
    const result = await toolOf("settings.module").run({ id: "nope", visible: true }, context);
    expect(result.ok).toBe(false);
    expect(result.content).toContain("Nepoznat modul „nope“");
  });

  it("refuses a visible flag that is not a boolean", async () => {
    const { context } = contextFor("en", true);
    const result = await toolOf("settings.module").run({ id: "tasks", visible: "no" }, context);
    expect(result.ok).toBe(false);
    expect(result.content).toContain('"visible" must be a boolean.');
  });
});

describe("settings.preference", () => {
  it("asks the Settings page to apply the change, on the card that holds it", async () => {
    const { context, confirms } = contextFor("en", true);
    const result = await toolOf("settings.preference").run(
      { key: "theme", value: "dan" },
      context,
    );
    expect(result.ok).toBe(true);
    expect(confirms[0]?.summary).toBe("Change the theme to “dan”");
    expect(result.navigateTo).toEqual({
      module: "settings",
      settings: "appearance",
      action: { name: "set-preference", payload: { key: "theme", value: "dan" } },
    });
  });

  it("sends auto-lock to the security card", async () => {
    const { context } = contextFor("sr", true);
    const result = await toolOf("settings.preference").run(
      { key: "auto-lock", value: "15" },
      context,
    );
    expect(result.navigateTo?.settings).toBe("security");
    expect(result.navigateTo?.action?.payload).toEqual({ key: "auto-lock", value: "15" });
  });

  it("writes no action when the user declines", async () => {
    const { context } = contextFor("sr", false);
    const result = await toolOf("settings.preference").run(
      { key: "clock", value: "12h" },
      context,
    );
    expect(result).toEqual({ ok: false, content: "The user declined." });
  });

  it("refuses a value that belongs to another key", async () => {
    const { context, confirms } = contextFor("en", true);
    const result = await toolOf("settings.preference").run(
      { key: "clock", value: "noc" },
      context,
    );
    expect(result.ok).toBe(false);
    expect(result.content).toContain("“clock” takes only: 24h, 12h.");
    expect(confirms).toHaveLength(0);
  });

  it("refuses a key the assistant may not change", async () => {
    const { context } = contextFor("en", true);
    const result = await toolOf("settings.preference").run(
      { key: "network", value: "online" },
      context,
    );
    expect(result.ok).toBe(false);
    expect(result.content).toContain('"key" must be one of');
  });
});

describe("settings.open", () => {
  it("opens the card for network mode without changing anything or asking", async () => {
    const { context, confirms } = contextFor("en", true);
    const result = await toolOf("settings.open").run({ card: "network" }, context);
    expect(result.ok).toBe(true);
    expect(result.content).toBe("Opened the “network” card. The user makes this change there.");
    expect(result.navigateTo).toEqual({ module: "settings", settings: "network" });
    expect(confirms).toHaveLength(0);
  });

  it("opens the assistant card for web search and refuses any other card", async () => {
    const { context } = contextFor("sr", true);
    const tool = toolOf("settings.open");
    const opened = await tool.run({ card: "assistant" }, context);
    expect(opened.navigateTo).toEqual({ module: "settings", settings: "assistant" });
    expect(opened.content).toContain("Promenu zadaje korisnik na toj kartici.");
    const other = await tool.run({ card: "appearance" }, context);
    expect(other.ok).toBe(false);
  });
});
