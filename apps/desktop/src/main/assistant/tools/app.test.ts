import { describe, expect, it } from "vitest";
import type { SearchKind, Tool, ToolContext } from "@nexus/core";
import type { SearchResult } from "../../../shared/ipc.js";
import { createModuleRegistry } from "../../../shared/modules.js";
import { appTools } from "./app.js";

/**
 * The APP tools: navigation and the global search.
 *
 * These two are the only tools in the registry that reach nothing in the
 * database — `app.open` answers a location and `app.search` calls the pipeline
 * it is handed — so what is worth pinning is exactly that: the ids the registry
 * really contains, the location a call produces, and what a refusal names.
 *
 * The registry under test is the app's OWN (`createModuleRegistry`), because the
 * module ids are the thing this tool must not invent: a kit module carries its
 * name and description in its manifest and a compiled-in one does not, and both
 * facts are visible here only against the real list.
 */

const PROFILE_ID = "0192f0f0-0000-7000-8000-000000000000";

function searchHit(kind: SearchKind, id: string, title: string, snippet = ""): SearchResult {
  return {
    kind,
    entityId: id,
    parentId: null,
    title,
    titleRanges: [],
    snippet,
    snippetRanges: [],
    contextDate: null,
    updatedAt: "2026-10-01T00:00:00.000Z",
    fromAttachment: false,
  };
}

interface SearchRecorder {
  readonly calls: { profileId: string; query: string; limit: number }[];
  search(profileId: string, query: string, limit: number): Promise<readonly SearchResult[]>;
}

function recorderFor(hits: readonly SearchResult[]): SearchRecorder {
  const calls: SearchRecorder["calls"] = [];
  return {
    calls,
    search: (profileId, query, limit) => {
      calls.push({ profileId, query, limit });
      return Promise.resolve(hits);
    },
  };
}

function context(locale: "sr" | "en" = "en"): ToolContext {
  return {
    profileId: PROFILE_ID,
    locale,
    signal: new AbortController().signal,
    confirm: () => Promise.resolve(true),
  };
}

function toolNamed(tools: readonly Tool[], name: string): Tool {
  const found = tools.find((entry) => entry.name === name);
  if (found === undefined) throw new Error(`Test setup: no tool "${name}".`);
  return found;
}

describe("app.modules", () => {
  it("lists the registry's own ids and names a kit module in the active locale", async () => {
    const registry = createModuleRegistry();
    const tools = appTools({ modules: registry, search: recorderFor([]).search });

    const sr = await toolNamed(tools, "app.modules").run({}, context("sr"));
    expect(sr.ok).toBe(true);
    expect(sr.content.split("\n")[0]).toBe(`Moduli (${registry.all().length}):`);
    expect(sr.content).toContain("- timers (plan): Tajmeri —");
    // A compiled-in module has no copy in main, and the tool says so rather than
    // inventing a name: the id and the group are what this process knows.
    expect(sr.content).toContain("- tasks (plan)");

    const en = await toolNamed(tools, "app.modules").run({}, context("en"));
    expect(en.content).toContain("- timers (plan): Timers —");
  });
});

describe("app.open", () => {
  const registry = createModuleRegistry();
  const tools = appTools({ modules: registry, search: recorderFor([]).search });

  it("answers the location, with only the parts that were named", async () => {
    expect(await toolNamed(tools, "app.open").run({ module: "tasks" }, context())).toEqual({
      ok: true,
      content: "Opened module “tasks”.",
      navigateTo: { module: "tasks" },
    });
    expect(
      await toolNamed(tools, "app.open").run(
        { module: "notes", item: "0192f0f0-0000-7000-8000-00000000abcd" },
        context(),
      ),
    ).toEqual({
      ok: true,
      content: "Opened module “notes”.",
      navigateTo: { module: "notes", item: "0192f0f0-0000-7000-8000-00000000abcd" },
    });
    expect(
      await toolNamed(tools, "app.open").run(
        { module: "settings", settings: "notifications" },
        context(),
      ),
    ).toEqual({
      ok: true,
      content: "Opened module “settings”.",
      navigateTo: { module: "settings", settings: "notifications" },
    });
  });

  it("refuses a module nobody registered, naming the ones that exist", async () => {
    const result = await toolNamed(tools, "app.open").run({ module: "nepostojeci" }, context());
    expect(result.ok).toBe(false);
    expect(result.content).toContain("Unknown module “nepostojeci”. Known modules: dashboard, tasks");
    expect(result.navigateTo).toBeUndefined();
  });

  it("refuses a settings key that is not a card key", async () => {
    const result = await toolNamed(tools, "app.open").run(
      { module: "settings", settings: "Profile Settings!" },
      context(),
    );
    expect(result.ok).toBe(false);
    expect(result.content).toBe(
      'Failed: "settings" must be a settings card key, e.g. "notifications".',
    );
  });
});

describe("app.search", () => {
  it("runs the pipeline it was handed and prints what it answered", async () => {
    const recorder = recorderFor([
      searchHit("task", "t1", "Kupiti vodu", "ostatak teksta"),
      searchHit("note", "n1", "Beleške sa faksa"),
    ]);
    const tools = appTools({ modules: createModuleRegistry(), search: recorder.search });

    const result = await toolNamed(tools, "app.search").run({ query: "voda" }, context("sr"));

    expect(recorder.calls).toEqual([{ profileId: PROFILE_ID, query: "voda", limit: 8 }]);
    expect(result.content).toBe(
      ["Rezultati (2) za „voda“:", "- task t1: Kupiti vodu — ostatak teksta", "- note n1: Beleške sa faksa"].join(
        "\n",
      ),
    );
  });

  it("passes the model's own limit through, and says so when nothing matched", async () => {
    const recorder = recorderFor([]);
    const tools = appTools({ modules: createModuleRegistry(), search: recorder.search });
    const result = await toolNamed(tools, "app.search").run(
      { query: "ništa", limit: 3 },
      context("sr"),
    );
    expect(recorder.calls[0]?.limit).toBe(3);
    expect(result).toEqual({ ok: true, content: "Nema rezultata za „ništa“." });
  });

  it("refuses a result cap outside the schema's range", async () => {
    const tools = appTools({ modules: createModuleRegistry(), search: recorderFor([]).search });
    const result = await toolNamed(tools, "app.search").run(
      { query: "voda", limit: 200 },
      context(),
    );
    expect(result.ok).toBe(false);
    expect(result.content).toBe(
      'Failed: "limit" must be a whole number between 1 and 20.',
    );
  });
});

describe("app.open and the wave-1 kit modules", () => {
  /**
   * The ids wave 1 added, each a folder with a manifest. They are in the
   * registry by being a folder, which is the kit's whole point — so this test
   * does not add a list to the app: it states the ids the run that built them is
   * responsible for, and fails if one of them stops being openable.
   *
   * A module's own SUB-VIEW („Na polici", „Program") is not addressable here:
   * `AppLocation` names a module and an item, and a kit page is handed a profile
   * id alone (`shared/moduleApi.ts`), so a view would be a target no surface
   * keeps. Opening the module is what reaches its views, and that is what is
   * pinned.
   */
  const WAVE1 = [
    "library",
    "culture",
    "car",
    "pantry",
    "cookbook",
    "recorder",
    "calculator",
    "signals",
    "miniapps",
    "arcade",
    "puzzles",
    "boards",
    "chess",
    "reader",
    "maps",
    "wiki",
    "scanner",
    "workshop",
    "drawings",
    "lab",
    "translator",
  ];

  it("opens every one of them, with no item and no settings card", async () => {
    const registry = createModuleRegistry();
    const tools = appTools({ modules: registry, search: recorderFor([]).search });
    for (const id of WAVE1) {
      expect(registry.get(id), id).toBeDefined();
      const result = await toolNamed(tools, "app.open").run({ module: id }, context());
      expect(result.navigateTo, id).toEqual({ module: id });
    }
  });
});
