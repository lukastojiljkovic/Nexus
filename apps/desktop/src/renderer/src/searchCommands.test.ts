import { foldSearchText, SMART_LIST_IDS } from "@nexus/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildSearchCommands,
  matchCommands,
  REBUILD_COMMAND_ID,
  type SearchCommand,
  type SearchCommandsContext,
} from "./searchCommands.js";
import { strings } from "./strings.js";

/**
 * The palette's command registry is pure apart from ONE call — the rebuild
 * command's own `run`, which reaches for `window.nexus`. That call sits inside
 * a closure, not at module scope, so the module imports cleanly under node and
 * only the rebuild tests need a `window` stub.
 *
 * Serbian copy is asserted through `strings.ts` rather than re-spelled, which
 * also pins the `dayUnit` number agreement in the rebuild's result message.
 */

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const ALL_MODULES = ["dashboard", "tasks", "calendar", "settings", "notes", "study"] as const;

/** Stands in for `App.tsx`'s own id -> display name lookup; the registry takes it as given. */
const MODULE_NAMES: Readonly<Record<string, string>> = {
  dashboard: "Početna",
  tasks: "Zadaci",
  calendar: "Kalendar",
  settings: "Podešavanja",
  notes: "Beleške",
  study: "Učenje",
};

interface Recorder {
  navigated: string[];
  created: string[];
  smartLists: string[];
  themeToggles: number;
  locks: number;
  shortcutsOpens: number;
  rebuildMessages: string[];
}

function makeContext(enabledModuleIds: readonly string[] = ALL_MODULES): {
  context: SearchCommandsContext;
  recorder: Recorder;
} {
  const recorder: Recorder = {
    navigated: [],
    created: [],
    smartLists: [],
    themeToggles: 0,
    locks: 0,
    shortcutsOpens: 0,
    rebuildMessages: [],
  };
  const context: SearchCommandsContext = {
    profileId: "profile-1",
    enabledModuleIds,
    moduleName: (id) => MODULE_NAMES[id] ?? id,
    onNavigate: (moduleId) => recorder.navigated.push(moduleId),
    onCreate: (moduleId) => recorder.created.push(moduleId),
    onOpenSmartList: (listId) => recorder.smartLists.push(listId),
    onToggleTheme: () => {
      recorder.themeToggles += 1;
    },
    onLock: () => {
      recorder.locks += 1;
    },
    onOpenShortcuts: () => {
      recorder.shortcutsOpens += 1;
    },
    onRebuildComplete: (message) => recorder.rebuildMessages.push(message),
  };
  return { context, recorder };
}

function byId(commands: readonly SearchCommand[], id: string): SearchCommand {
  const command = commands.find((candidate) => candidate.id === id);
  if (!command) throw new Error(`Test setup: no command "${id}".`);
  return command;
}

describe("buildSearchCommands", () => {
  it("builds one goto per enabled module in the given order, then the creates, the task views, then the shell actions", () => {
    const { context } = makeContext();
    expect(buildSearchCommands(context).map((command) => command.id)).toEqual([
      "goto-dashboard",
      "goto-tasks",
      "goto-calendar",
      "goto-settings",
      "goto-notes",
      "goto-study",
      "create-tasks",
      "create-calendar",
      "create-notes",
      "tasks-smart-danas",
      "tasks-smart-sledecih7",
      "tasks-smart-hitno",
      "tasks-smart-kasni",
      "tasks-smart-zavrseno",
      "toggle-theme",
      "lock",
      "shortcuts",
      REBUILD_COMMAND_ID,
    ]);
  });

  // ADR-049: one command per view, in SMART_LIST_IDS' own order, labelled with
  // the very names the rail draws — a palette row and a rail row must not spell
  // the same view two ways.
  it("labels each task view with the module prefix and the rail's own name", () => {
    const { context } = makeContext(["tasks"]);
    const commands = buildSearchCommands(context);
    for (const listId of SMART_LIST_IDS) {
      expect(byId(commands, `tasks-smart-${listId}`).label).toBe(
        `${strings.search.commands.smartListPrefix}${strings.tasks.smart.names[listId]}`,
      );
    }
  });

  it("omits the task views when TASK is disabled, and routes each one that is drawn", () => {
    const { context: withoutTasks } = makeContext(["notes"]);
    expect(buildSearchCommands(withoutTasks).map((command) => command.id)).not.toContain(
      "tasks-smart-danas",
    );

    const { context, recorder } = makeContext();
    const commands = buildSearchCommands(context);
    for (const listId of SMART_LIST_IDS) byId(commands, `tasks-smart-${listId}`).run();
    expect(recorder.smartLists).toEqual([...SMART_LIST_IDS]);
  });

  it("labels a goto with the shell's own module name, behind the shared prefix", () => {
    const { context } = makeContext(["tasks"]);
    expect(byId(buildSearchCommands(context), "goto-tasks").label).toBe(
      `${strings.search.commands.goToPrefix}Zadaci`,
    );
  });

  it("omits a quick-create whose module is disabled — a command must never lead to a dead end", () => {
    const { context } = makeContext(["dashboard", "notes"]);
    const ids = buildSearchCommands(context).map((command) => command.id);
    expect(ids).toContain("create-notes");
    expect(ids).not.toContain("create-tasks");
    expect(ids).not.toContain("create-calendar");
    // The four shell actions never depend on a module.
    expect(ids.slice(-4)).toEqual(["toggle-theme", "lock", "shortcuts", REBUILD_COMMAND_ID]);
  });

  it("still builds the shell actions when every module is disabled", () => {
    const { context } = makeContext([]);
    expect(buildSearchCommands(context).map((command) => command.id)).toEqual([
      "toggle-theme",
      "lock",
      "shortcuts",
      REBUILD_COMMAND_ID,
    ]);
  });

  it("routes each run to its own shell callback", () => {
    const { context, recorder } = makeContext();
    const commands = buildSearchCommands(context);

    byId(commands, "goto-study").run();
    byId(commands, "create-calendar").run();
    byId(commands, "toggle-theme").run();
    byId(commands, "lock").run();

    expect(recorder.navigated).toEqual(["study"]);
    expect(recorder.created).toEqual(["calendar"]);
    expect(recorder.themeToggles).toBe(1);
    expect(recorder.locks).toBe(1);
  });

  it("gives the theme toggle the two theme names as keywords, so folded search finds it", () => {
    const { context } = makeContext();
    const toggle = byId(buildSearchCommands(context), "toggle-theme");
    expect(toggle.label).toBe(strings.app.themeToggle);
    expect(toggle.keywords).toEqual([strings.app.themeDan, strings.app.themeNoc]);
  });
});

describe("the rebuild command", () => {
  /** Installs the one IPC method the registry reaches for. The result is a factory so the promise is never created before a handler exists for it. */
  function stubRebuild(result: () => Promise<number>) {
    const rebuildSearchIndex = vi.fn(result);
    vi.stubGlobal("window", { nexus: { rebuildSearchIndex } });
    return rebuildSearchIndex;
  }

  it("calls the IPC method with the context's profile id", async () => {
    const { context, recorder } = makeContext();
    const rebuildSearchIndex = stubRebuild(() => Promise.resolve(3));

    byId(buildSearchCommands(context), REBUILD_COMMAND_ID).run();

    await vi.waitFor(() => expect(recorder.rebuildMessages).toHaveLength(1));
    expect(rebuildSearchIndex).toHaveBeenCalledWith("profile-1");
  });

  it("reports the count with Serbian number agreement", async () => {
    const c = strings.search.commands;
    const cases: readonly (readonly [number, string])[] = [
      [0, c.rebuildRecordsUnitMany],
      [1, c.rebuildRecordsUnitOne],
      [5, c.rebuildRecordsUnitMany],
      [11, c.rebuildRecordsUnitMany],
      [21, c.rebuildRecordsUnitOne],
    ];
    for (const [count, unit] of cases) {
      const { context, recorder } = makeContext();
      stubRebuild(() => Promise.resolve(count));
      byId(buildSearchCommands(context), REBUILD_COMMAND_ID).run();
      await vi.waitFor(() => expect(recorder.rebuildMessages).toHaveLength(1));
      expect(recorder.rebuildMessages[0]).toBe(`${c.rebuildDonePrefix} ${count} ${unit}`);
    }
  });

  it("reports the error copy — never throws — when the IPC call rejects", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { context, recorder } = makeContext();
    stubRebuild(() => Promise.reject(new Error("boom")));

    expect(() => byId(buildSearchCommands(context), REBUILD_COMMAND_ID).run()).not.toThrow();

    await vi.waitFor(() => expect(recorder.rebuildMessages).toHaveLength(1));
    expect(recorder.rebuildMessages[0]).toBe(strings.search.commands.rebuildError);
    expect(consoleError).toHaveBeenCalledTimes(1);
  });
});

describe("matchCommands", () => {
  const commands = buildSearchCommands(makeContext().context);

  /** Ids only — these assertions are about which commands survive; `buildSearchCommands` already pins the order. */
  function idsFor(...terms: readonly string[]): string[] {
    return matchCommands(commands, terms).map((command) => command.id);
  }

  it("keeps every command when nothing has been typed (a bare '>')", () => {
    expect(matchCommands(commands, [])).toHaveLength(commands.length);
  });

  it("matches a folded prefix of any word in the label or the keywords", () => {
    // Every task view's label opens with the module name, so „zada“ reaches
    // them too — which is the point of prefixing them with it.
    expect(idsFor("zada")).toEqual([
      "goto-tasks",
      "create-tasks",
      ...SMART_LIST_IDS.map((listId) => `tasks-smart-${listId}`),
    ]);
    expect(idsFor("dodaj")).toEqual(["create-tasks", "create-calendar", "create-notes"]);
  });

  it("narrows to one task view once its own name is typed, diacritics or not", () => {
    expect(idsFor("zadaci", "sledecih")).toEqual(["tasks-smart-sledecih7"]);
    expect(idsFor("kasni")).toEqual(["tasks-smart-kasni"]);
  });

  it("matches through the Serbian folding — 'noc' finds the Noć keyword", () => {
    expect(foldSearchText(strings.app.themeNoc)).toBe("noc");
    expect(idsFor("noc")).toEqual(["toggle-theme"]);
  });

  it("requires EVERY term to match, so extra terms narrow the list", () => {
    expect(idsFor("dodaj", "beleska")).toEqual(["create-notes"]);
    expect(idsFor("dodaj", "termin")).toEqual(["create-calendar"]);
  });

  it("returns nothing when a term matches no command", () => {
    expect(idsFor("qqqq")).toEqual([]);
    expect(idsFor("dodaj", "qqqq")).toEqual([]);
  });

  it("matches on a prefix only, never in the middle of a word", () => {
    expect(idsFor("odaj")).toEqual([]);
  });
});
