import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  DashboardSetStore,
  DashboardSettingsStore,
  DashboardWidgetStore,
  NexusDatabase,
  openDatabase,
  uuidv7,
} from "@nexus/db";
import type { ConfirmRequest, Tool, ToolContext } from "@nexus/core";
import { createModuleRegistry } from "../../../shared/modules.js";
import { dashboardTools } from "./dashboard.js";
import { USER_DECLINED } from "./support.js";

/**
 * The DASHBOARD tools over a real database. The stores are the ones the IPC
 * handlers use, so a test that reads the layout back reads what the page reads.
 *
 * The default arrangement is the five cards of `DEFAULT_DASHBOARD_LAYOUT`; a board
 * with no rows shows exactly those, and the first write materializes them.
 */

const NOW_MS = new Date(2026, 9, 10, 9, 0, 0).getTime();
const NOW_ISO = new Date(NOW_MS).toISOString();

let dir: string;
let db: NexusDatabase;
let profileId: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-tool-dashboard-"));
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
});

function widgets(): DashboardWidgetStore {
  return new DashboardWidgetStore(db.raw, profileId);
}

function sets(): DashboardSetStore {
  return new DashboardSetStore(db.raw, profileId);
}

function settings(): DashboardSettingsStore {
  return new DashboardSettingsStore(db.raw, profileId);
}

function tools(): readonly Tool[] {
  return dashboardTools({
    profileDb: (id, open) => open(db.raw, id),
    now: () => NOW_MS,
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

/** The widget ids of one board's layout, in draw order. */
function layoutIds(setId: string | null): string[] {
  return widgets()
    .listLayout(setId)
    .map((placement) => placement.widgetId);
}

describe("dashboard.widgets", () => {
  it("reads the default arrangement for a board that was never edited", async () => {
    const { context } = contextFor("en", true);
    const result = await toolOf("dashboard.widgets").run({}, context);
    expect(result.ok).toBe(true);
    expect(result.content).toContain("Widgets on the “Home” board:");
    expect(result.content).toContain("calendar:danas");
    expect(result.content).toContain("“Today”");
    expect(result.navigateTo).toBeUndefined();
    // Reading never writes: the default board still has no rows.
    expect(widgets().listAll()).toHaveLength(0);
  });

  it("lists the widgets that can be added when asked for the catalogue", async () => {
    const { context } = contextFor("sr", true);
    const result = await toolOf("dashboard.widgets").run({ catalogue: true }, context);
    expect(result.content).toContain("Vidžeti koje korisnik može da doda:");
    expect(result.content).toContain("tasks:statistika");
  });

  it("refuses a board that does not exist, by name", async () => {
    const { context } = contextFor("en", true);
    const result = await toolOf("dashboard.widgets").run({ board: "Nope" }, context);
    expect(result.ok).toBe(false);
    expect(result.content).toContain('No board named “Nope”.');
  });
});

describe("dashboard.arrange", () => {
  it("adds a widget after confirmation, materializing the default first, and reveals the dashboard", async () => {
    const { context, confirms } = contextFor("en", true);
    const result = await toolOf("dashboard.arrange").run(
      { action: "add", widget: "Stats", size: "M" },
      context,
    );
    expect(result.ok).toBe(true);
    expect(confirms).toHaveLength(1);
    expect(confirms[0]?.summary).toContain("Add the “Stats” widget (M) to the “Home” board");
    expect(layoutIds(null)).toEqual([
      "calendar:danas",
      "tasks:predstojece",
      "calendar:isticanja",
      "study:ispiti",
      "study:ucenje",
      "tasks:statistika",
    ]);
    expect(result.navigateTo).toEqual({ module: "dashboard" });
  });

  it("writes nothing when the user declines", async () => {
    const { context } = contextFor("sr", false);
    const result = await toolOf("dashboard.arrange").run(
      { action: "add", widget: "tasks:statistika" },
      context,
    );
    expect(result).toEqual({ ok: false, content: USER_DECLINED });
    expect(widgets().listAll()).toHaveLength(0);
  });

  it("refuses an unknown widget by name, and an unsupported size", async () => {
    const unknown = await toolOf("dashboard.arrange").run(
      { action: "add", widget: "Nothing here" },
      contextFor("en", true).context,
    );
    expect(unknown.ok).toBe(false);
    expect(unknown.content).toContain('No widget named “Nothing here”.');

    const size = await toolOf("dashboard.arrange").run(
      { action: "add", widget: "tasks:statistika", size: "S" },
      contextFor("en", true).context,
    );
    expect(size.ok).toBe(false);
    expect(size.content).toContain("has no size S");
  });

  it("refuses a placement that is ambiguous, listing the ids it could be", async () => {
    const store = widgets();
    store.add(null, "tasks:statistika", "M", NOW_ISO);
    store.add(null, "tasks:statistika", "M", NOW_ISO);
    const result = await toolOf("dashboard.arrange").run(
      { action: "remove", instance: "Stats" },
      contextFor("en", true).context,
    );
    expect(result.ok).toBe(false);
    expect(result.content).toContain("More than one match for “Stats”");
  });

  it("removing the last widget of a board gives it back the default arrangement", async () => {
    const boardId = sets().create("Faks", NOW_ISO).id;
    // An add materializes the five default cards first, so the board is brought
    // down to one row by removing those.
    widgets().add(boardId, "tasks:statistika", "M", NOW_ISO);
    for (const placement of widgets().listLayout(boardId).slice(0, 5)) {
      widgets().remove(boardId, placement.instanceId, NOW_ISO);
    }
    const { context, confirms } = contextFor("en", true);
    const result = await toolOf("dashboard.arrange").run(
      { action: "remove", board: "Faks", instance: "Stats" },
      context,
    );
    expect(result.ok).toBe(true);
    expect(confirms[0]?.summary).toContain("the last widget");
    expect(widgets().listAll().filter((row) => row.setId === boardId)).toHaveLength(0);
    expect(layoutIds(boardId)).toHaveLength(5);
  });

  it("resizes a widget within its size presets", async () => {
    const { context } = contextFor("en", true);
    const result = await toolOf("dashboard.arrange").run(
      { action: "size", instance: "Today", size: "L" },
      context,
    );
    expect(result.ok).toBe(true);
    expect(widgets().listLayout(null)[0]?.size).toBe("L");
  });

  it("merges configuration into the widget's own settings, and refuses what the widget does not declare", async () => {
    const { context } = contextFor("en", true);
    const set = await toolOf("dashboard.arrange").run(
      { action: "config", instance: "Today", config: { count: 5 } },
      context,
    );
    expect(set.ok).toBe(true);
    expect(widgets().listLayout(null)[0]?.config).toBe('{"count":5}');

    const out = await toolOf("dashboard.arrange").run(
      { action: "config", instance: "Today", config: { count: 99 } },
      contextFor("en", true).context,
    );
    expect(out.ok).toBe(false);
    expect(out.content).toContain("does not accept those settings");

    const unknownKey = await toolOf("dashboard.arrange").run(
      { action: "config", instance: "Today", config: { colour: "red" } },
      contextFor("en", true).context,
    );
    expect(unknownKey.ok).toBe(false);
  });

  it("moves a widget to land just after another", async () => {
    const { context } = contextFor("en", true);
    const result = await toolOf("dashboard.arrange").run(
      { action: "move", instance: "Today", after: "Upcoming tasks" },
      context,
    );
    expect(result.ok).toBe(true);
    expect(layoutIds(null)).toEqual([
      "tasks:predstojece",
      "calendar:danas",
      "calendar:isticanja",
      "study:ispiti",
      "study:ucenje",
    ]);
  });

  it("refuses a move with both anchors, with neither, or against itself", async () => {
    const run = (args: Record<string, unknown>) =>
      toolOf("dashboard.arrange").run({ action: "move", instance: "Today", ...args }, contextFor("en", true).context);
    expect((await run({ before: "Urgent", after: "Stats" })).ok).toBe(false);
    expect((await run({})).ok).toBe(false);
    const self = await run({ after: "Today" });
    expect(self.ok).toBe(false);
    expect(self.content).toContain("cannot be placed against itself");
    expect(layoutIds(null)[0]).toBe("calendar:danas");
  });

  it("sets the background dim within its bounds, and refuses one outside them", async () => {
    const ok = await toolOf("dashboard.arrange").run(
      { action: "dim", dim: 60 },
      contextFor("en", true).context,
    );
    expect(ok.ok).toBe(true);
    expect(settings().get().backgroundDim).toBe(60);

    const outside = await toolOf("dashboard.arrange").run(
      { action: "dim", dim: 91 },
      contextFor("en", true).context,
    );
    expect(outside.ok).toBe(false);
    expect(settings().get().backgroundDim).toBe(60);
  });

  it("refuses an action that is not one of its six, and a missing field the action needs", async () => {
    const bad = await toolOf("dashboard.arrange").run({ action: "explode" }, contextFor("en", true).context);
    expect(bad.ok).toBe(false);
    const missing = await toolOf("dashboard.arrange").run({ action: "add" }, contextFor("en", true).context);
    expect(missing.content).toContain('The “add” action needs the “widget” field.');
  });
});

describe("dashboard.boards and dashboard.board", () => {
  it("lists the default board and the open one", async () => {
    const id = sets().create("Faks", NOW_ISO).id;
    sets().setActive(id, NOW_ISO);
    const result = await toolOf("dashboard.boards").run({}, contextFor("en", true).context);
    expect(result.content).toContain("Home · default");
    expect(result.content).toContain(`Faks · ${id} (open)`);
  });

  it("creates a board after confirmation, and refuses a name that is taken", async () => {
    const { context, confirms } = contextFor("sr", true);
    const created = await toolOf("dashboard.board").run({ action: "create", name: "Faks" }, context);
    expect(created.ok).toBe(true);
    expect(confirms[0]?.summary).toBe("Napravi tablu „Faks“");
    expect(sets().list().map((board) => board.name)).toEqual(["Faks"]);
    expect(created.navigateTo).toEqual({ module: "dashboard" });

    const again = await toolOf("dashboard.board").run(
      { action: "create", name: "faks" },
      contextFor("sr", true).context,
    );
    expect(again.ok).toBe(false);
    expect(again.content).toContain("već postoji");
    const home = await toolOf("dashboard.board").run(
      { action: "create", name: "Početna" },
      contextFor("sr", true).context,
    );
    expect(home.ok).toBe(false);
  });

  it("declines a creation and writes no board", async () => {
    const result = await toolOf("dashboard.board").run(
      { action: "create", name: "Faks" },
      contextFor("sr", false).context,
    );
    expect(result).toEqual({ ok: false, content: USER_DECLINED });
    expect(sets().list()).toHaveLength(0);
  });

  it("renames a named board, and refuses to change the default one", async () => {
    sets().create("Faks", NOW_ISO);
    const renamed = await toolOf("dashboard.board").run(
      { action: "rename", board: "Faks", name: "Fakultet" },
      contextFor("en", true).context,
    );
    expect(renamed.ok).toBe(true);
    expect(sets().list().map((board) => board.name)).toEqual(["Fakultet"]);

    const home = await toolOf("dashboard.board").run(
      { action: "rename", board: "Home", name: "Mine" },
      contextFor("en", true).context,
    );
    expect(home.ok).toBe(false);
    expect(home.content).toContain("cannot be changed or deleted");
  });

  it("deletes a board with its widgets, and falls back to the default when it was open", async () => {
    const id = sets().create("Faks", NOW_ISO).id;
    widgets().add(id, "tasks:statistika", "M", NOW_ISO);
    sets().setActive(id, NOW_ISO);
    const result = await toolOf("dashboard.board").run(
      { action: "delete", board: "Faks" },
      contextFor("en", true).context,
    );
    expect(result.ok).toBe(true);
    expect(result.content).toContain("Now showing “Home”.");
    expect(sets().list()).toHaveLength(0);
    expect(sets().activeSetId()).toBeNull();
    expect(widgets().listAll()).toHaveLength(0);
  });

  it("shows a named board, and the default by its name", async () => {
    const id = sets().create("Faks", NOW_ISO).id;
    const show = await toolOf("dashboard.board").run(
      { action: "activate", board: "Faks" },
      contextFor("en", true).context,
    );
    expect(show.ok).toBe(true);
    expect(sets().activeSetId()).toBe(id);

    const home = await toolOf("dashboard.board").run(
      { action: "activate", board: "Početna" },
      contextFor("en", true).context,
    );
    expect(home.ok).toBe(true);
    expect(sets().activeSetId()).toBeNull();
  });

  it("reorders boards before or after another", async () => {
    sets().create("A", NOW_ISO);
    sets().create("B", NOW_ISO);
    const result = await toolOf("dashboard.board").run(
      { action: "reorder", board: "B", before: "A" },
      contextFor("en", true).context,
    );
    expect(result.ok).toBe(true);
    expect(sets().list().map((board) => board.name)).toEqual(["B", "A"]);
  });

  it("refuses a board name that matches more than one board", async () => {
    sets().create("Faks", NOW_ISO);
    sets().create("Faks", NOW_ISO);
    const result = await toolOf("dashboard.board").run(
      { action: "delete", board: "Faks" },
      contextFor("en", true).context,
    );
    expect(result.ok).toBe(false);
    expect(result.content).toContain("More than one match for “Faks”");
    expect(sets().list()).toHaveLength(2);
  });
});
