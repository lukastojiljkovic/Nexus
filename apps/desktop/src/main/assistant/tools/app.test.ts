import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NexusDatabase, SearchHistoryStore, openDatabase, uuidv7 } from "@nexus/db";
import type { SearchKind, Tool, ToolContext } from "@nexus/core";
import type { SearchResult } from "../../../shared/ipc.js";
import { createModuleRegistry } from "../../../shared/modules.js";
import { DEFAULT_SHELL_VISIBILITY } from "../../../shared/moduleVisibility.js";
import type { AssistantTurnEventView } from "../../../modules/assistant/shared/ipc.js";
import { turnLocations } from "../../../modules/assistant/renderer/turnLocations.js";
import { appTools, type AppToolDeps } from "./app.js";

/**
 * The APP tools: navigation, the global search, and the search's own history
 * and index.
 *
 * `app.open` and `app.search` reach nothing but the registry and the pipeline
 * they are handed, so they run against stand-ins. The search-history and index
 * tools write to the profile's database, so they run over a real one, as the
 * other tool suites do.
 *
 * The registry under test is the app's OWN (`createModuleRegistry`), because the
 * module ids are the thing this tool must not invent.
 */

const NOW_MS = new Date(2026, 9, 10, 9, 0, 0).getTime();
const NOW_ISO = new Date(NOW_MS).toISOString();

let dir: string;
let db: NexusDatabase;
let profileId: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-tool-app-"));
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

function searchHit(
  kind: SearchKind,
  id: string,
  title: string,
  options: { snippet?: string; parentId?: string } = {},
): SearchResult {
  return {
    kind,
    entityId: id,
    parentId: options.parentId ?? null,
    title,
    titleRanges: [],
    snippet: options.snippet ?? "",
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

/** The deps a test does not care about: an empty search, the app's own registry, nothing hidden. */
function depsWith(overrides: Partial<AppToolDeps> = {}): AppToolDeps {
  return {
    modules: createModuleRegistry(),
    search: recorderFor([]).search,
    profileDb: (id, open) => open(db.raw, id),
    visibility: () => DEFAULT_SHELL_VISIBILITY,
    ...overrides,
  };
}

/** A context whose confirmation answers `answer` and remembers each summary it was asked. */
function context(
  locale: "sr" | "en" = "en",
  answer = true,
): ToolContext & { readonly asked: string[] } {
  const asked: string[] = [];
  return {
    profileId,
    locale,
    signal: new AbortController().signal,
    asked,
    confirm: (request) => {
      asked.push(request.summary);
      return Promise.resolve(answer);
    },
  };
}

function toolNamed(tools: readonly Tool[], name: string): Tool {
  const found = tools.find((entry) => entry.name === name);
  if (found === undefined) throw new Error(`Test setup: no tool "${name}".`);
  return found;
}

function historyOf(): string[] {
  return new SearchHistoryStore(db.raw, profileId).list().map((entry) => entry.query);
}

describe("app.modules", () => {
  it("lists the registry's own ids, each with its name and description in the active locale", async () => {
    const registry = createModuleRegistry();
    const tools = appTools(depsWith({ modules: registry }));

    const sr = await toolNamed(tools, "app.modules").run({}, context("sr"));
    expect(sr.ok).toBe(true);
    const [heading, ...lines] = sr.content.split("\n");
    expect(heading).toBe(`Moduli (${registry.all().length}):`);
    expect(lines).toHaveLength(registry.all().length);
    // Every module carries a name and a description, the compiled-in ones too.
    for (const line of lines) expect(line).toMatch(/^- \S+ \([^)]+\): .+ — .+$/);
    expect(sr.content).toContain("- timers (plan): Tajmeri —");
    expect(sr.content).toContain("- tasks (plan): Zadaci — Zadaci sa listom i tablom");

    const en = await toolNamed(tools, "app.modules").run({}, context("en"));
    expect(en.content).toContain("- timers (plan): Timers —");
    expect(en.content).toContain("- finance (");
    expect(en.content).toContain("): Finance — ");
  });

  it("names the modules the device hides, and only those", async () => {
    const tools = appTools(
      depsWith({ visibility: () => ({ ...DEFAULT_SHELL_VISIBILITY, hidden: ["finance"] }) }),
    );
    const result = await toolNamed(tools, "app.modules").run({}, context("en"));
    expect(result.content).toMatch(/^- finance \([^)]*hidden on this device\): Finance — /m);
    expect(result.content).not.toMatch(/^- tasks \([^)]*hidden/m);
  });
});

describe("app.open", () => {
  const tools = appTools(depsWith());

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

  it("says so when the module is hidden on this device, and still opens it", async () => {
    const hidden = appTools(
      depsWith({ visibility: () => ({ ...DEFAULT_SHELL_VISIBILITY, hidden: ["finance"] }) }),
    );
    const result = await toolNamed(hidden, "app.open").run({ module: "finance" }, context("en"));
    expect(result).toEqual({
      ok: true,
      content:
        "Opened module “finance”. On this device this module is hidden from the module menu.",
      navigateTo: { module: "finance" },
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

  it("names the place the page's helper turns it into, so the app moves where the answer says", async () => {
    const opened = await toolNamed(tools, "app.open").run(
      { module: "settings", settings: "notifications" },
      context(),
    );
    const event: AssistantTurnEventView = {
      type: "tool-result",
      callId: "call_1",
      result: opened,
    };
    expect(turnLocations([event])).toEqual([{ module: "settings", settings: "notifications" }]);
  });
});

describe("app.search", () => {
  it("runs the pipeline it was handed and prints what it answered", async () => {
    const recorder = recorderFor([
      searchHit("task", "t1", "Kupiti vodu", { snippet: "ostatak teksta" }),
      searchHit("note", "n1", "Beleške sa faksa"),
    ]);
    const tools = appTools(depsWith({ search: recorder.search }));

    const result = await toolNamed(tools, "app.search").run({ query: "voda" }, context("sr"));

    expect(recorder.calls).toEqual([{ profileId, query: "voda", limit: 8 }]);
    expect(result.content).toBe(
      ["Rezultati (2) za „voda“:", "- task t1: Kupiti vodu — ostatak teksta", "- note n1: Beleške sa faksa"].join(
        "\n",
      ),
    );
  });

  it("answers each hit a page can reveal with a citation that opens it", async () => {
    const recorder = recorderFor([
      searchHit("task", "t1", "Kupiti vodu"),
      searchHit("event", "e1", "Lekar"),
      searchHit("note", "n1", "Beleške sa faksa"),
      searchHit("attachment", "a1", "Sken.pdf", { parentId: "n1" }),
    ]);
    const tools = appTools(depsWith({ search: recorder.search }));

    const result = await toolNamed(tools, "app.search").run({ query: "sken" }, context("sr"));

    expect(result.citations).toEqual([
      { kind: "task", id: "t1", title: "Kupiti vodu", location: { module: "tasks", item: "t1" } },
      { kind: "event", id: "e1", title: "Lekar", location: { module: "calendar", item: "e1" } },
      { kind: "note", id: "n1", title: "Beleške sa faksa", location: { module: "notes", item: "n1" } },
      { kind: "file", id: "a1", title: "Sken.pdf", location: { module: "notes", item: "n1" } },
    ]);
  });

  it("answers no citation for a kind no page reveals by an id alone", async () => {
    const recorder = recorderFor([
      searchHit("document", "d1", "Lična karta"),
      searchHit("subject", "p1", "Matematika"),
      searchHit("attachment", "a2", "Orphan.pdf"),
    ]);
    const tools = appTools(depsWith({ search: recorder.search }));

    const result = await toolNamed(tools, "app.search").run({ query: "karta" }, context());

    expect(result.citations).toEqual([]);
    expect(result.content).toContain("- document d1: Lična karta");
  });

  it("passes search operators through unchanged, for the pipeline to narrow", async () => {
    const recorder = recorderFor([]);
    const tools = appTools(depsWith({ search: recorder.search }));
    await toolNamed(tools, "app.search").run({ query: "#posao rok:danas" }, context());
    expect(recorder.calls[0]?.query).toBe("#posao rok:danas");
  });

  it("passes the model's own limit through, and says so when nothing matched", async () => {
    const recorder = recorderFor([]);
    const tools = appTools(depsWith({ search: recorder.search }));
    const result = await toolNamed(tools, "app.search").run(
      { query: "ništa", limit: 3 },
      context("sr"),
    );
    expect(recorder.calls[0]?.limit).toBe(3);
    expect(result).toEqual({ ok: true, content: "Nema rezultata za „ništa“." });
  });

  it("refuses a result cap outside the schema's range", async () => {
    const tools = appTools(depsWith());
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
  /** The ids wave 1 added, each a folder with a manifest: the test fails if one of them stops being openable. */
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
    const tools = appTools(depsWith({ modules: registry }));
    for (const id of WAVE1) {
      expect(registry.get(id), id).toBeDefined();
      const result = await toolNamed(tools, "app.open").run({ module: id }, context());
      expect(result.navigateTo, id).toEqual({ module: id });
    }
  });
});

describe("search.history", () => {
  it("lists the remembered queries, newest first, through the profile's own database", async () => {
    const history = new SearchHistoryStore(db.raw, profileId);
    history.record("voda", NOW_ISO);
    history.record("zadaci", new Date(NOW_MS + 60_000).toISOString());
    const tools = appTools(depsWith());

    const result = await toolNamed(tools, "search.history").run({}, context("sr"));

    expect(result).toEqual({
      ok: true,
      content: ["Zapamćene pretrage (2), najnovija prva:", "- zadaci", "- voda"].join("\n"),
    });
  });

  it("says so when nothing is remembered", async () => {
    const tools = appTools(depsWith());
    const result = await toolNamed(tools, "search.history").run({}, context("sr"));
    expect(result).toEqual({ ok: true, content: "Nema zapamćenih pretraga." });
  });
});

describe("search.forget", () => {
  it("asks first, then removes exactly the named search and nothing else", async () => {
    new SearchHistoryStore(db.raw, profileId).record("voda", NOW_ISO);
    new SearchHistoryStore(db.raw, profileId).record("zadaci", NOW_ISO);
    const tools = appTools(depsWith());
    const ask = context("sr");

    const result = await toolNamed(tools, "search.forget").run({ query: "Voda" }, ask);

    expect(ask.asked).toEqual(["Zaboraviću pretragu „voda“."]);
    expect(result).toEqual({ ok: true, content: "Pretraga „voda“ je zaboravljena." });
    expect(historyOf()).toEqual(["zadaci"]);
  });

  it("writes nothing when the user declines", async () => {
    new SearchHistoryStore(db.raw, profileId).record("voda", NOW_ISO);
    const tools = appTools(depsWith());

    const result = await toolNamed(tools, "search.forget").run(
      { query: "voda" },
      context("sr", false),
    );

    expect(result).toEqual({ ok: false, content: "The user declined." });
    expect(historyOf()).toEqual(["voda"]);
  });

  it("refuses arguments outside the schema", async () => {
    const tools = appTools(depsWith());
    const result = await toolNamed(tools, "search.forget").run({}, context());
    expect(result.ok).toBe(false);
    expect(result.content.startsWith("Failed:")).toBe(true);
  });

  it("refuses a search the history does not hold, and names it", async () => {
    const tools = appTools(depsWith());
    const ask = context("sr");
    const result = await toolNamed(tools, "search.forget").run({ query: "nepostojeće" }, ask);
    expect(result).toEqual({
      ok: false,
      content: "Neuspešno: Pretraga „nepostojeće“ nije u istoriji.",
    });
    expect(ask.asked).toEqual([]);
  });

  it("refuses an ambiguous name and removes neither entry", async () => {
    const history = new SearchHistoryStore(db.raw, profileId);
    history.record("voda", NOW_ISO);
    history.record("Voda", NOW_ISO);
    const tools = appTools(depsWith());
    const ask = context("en");

    const result = await toolNamed(tools, "search.forget").run({ query: "VODA" }, ask);

    expect(result.ok).toBe(false);
    expect(result.content).toBe(
      "Failed: More than one search matches “VODA”: „Voda“, „voda“. Name the exact one.",
    );
    expect(ask.asked).toEqual([]);
    expect(historyOf()).toHaveLength(2);
  });
});

describe("search.rebuild", () => {
  it("asks before it rebuilds, and reports the rebuild", async () => {
    const tools = appTools(depsWith());
    const ask = context("en");

    const result = await toolNamed(tools, "search.rebuild").run({}, ask);

    expect(ask.asked).toEqual(["I will rebuild the search index for the whole app."]);
    expect(result).toEqual({ ok: true, content: "The search index was rebuilt." });
  });

  it("does not rebuild when the user declines", async () => {
    const tools = appTools(depsWith());
    const result = await toolNamed(tools, "search.rebuild").run({}, context("en", false));
    expect(result).toEqual({ ok: false, content: "The user declined." });
  });
});
