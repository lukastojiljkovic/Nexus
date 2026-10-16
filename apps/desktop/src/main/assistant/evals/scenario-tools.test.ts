import { describe, expect, it } from "vitest";

import type { Tool } from "@nexus/core";

import { createModuleRegistry } from "../../../shared/modules.js";
import { DEFAULT_SHELL_VISIBILITY } from "../../../shared/moduleVisibility.js";
import { tmpdir } from "node:os";
import { createDictionaryReader } from "../../../modules/translator/main/dictionary.js";
import { createToolRegistry, type ToolDeps } from "../tools/index.js";
import { loadScenarios } from "./harness.js";

/**
 * The guard over the scenario set: every tool a scenario offers, and every
 * argument it expects or sends, has to exist.
 *
 * WHY. A scenario is data checked by hand, and the app's tool specs are the only
 * statement of what a tool accepts. The real mode hands the model those specs
 * (`scripts/assistant-eval.mjs`'s `loadToolSpecs`), so an argument the registry
 * does not declare cannot be produced by a grammar that wears its schema and is
 * refused by validation if it is: `tasks-list-sr`/`-en` were unwinnable against
 * a real model for exactly that — they asked for `filter` where `tasks.list`
 * declares `due`, and the baseline's two failures read "argument filter is
 * undefined". The same class of mistake is invisible in scripted mode, where no
 * schema is read at all, which is why it is a test of the FILES and not of a run.
 *
 * The registry is built the way `tools/index.test.ts` builds it: with fakes for
 * every seam, because this test reads declarations and must not open a profile
 * database, install a pack or arm a timer.
 */

/** The two tools the web service contributes, so `web.search` and `web.read` are in the set under test. */
const WEB_TOOLS: readonly Tool[] = [
  {
    name: "web.search",
    description: { sr: "Traži na vebu.", en: "Searches the web." },
    parameters: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
      additionalProperties: false,
    },
    effect: "network",
    run: () => Promise.resolve({ ok: true, content: "" }),
  },
  {
    name: "web.read",
    description: { sr: "Čita stranicu.", en: "Reads a page." },
    parameters: {
      type: "object",
      properties: { url: { type: "string" } },
      required: ["url"],
      additionalProperties: false,
    },
    effect: "network",
    run: () => Promise.resolve({ ok: true, content: "" }),
  },
];

function refuse(): never {
  throw new Error("This test reads tool specs and runs no tool.");
}

/** Every tool the app would offer with web search on, as the registry declares it. */
function appTools(): readonly Tool[] {
  const deps: ToolDeps = {
    profileDb: refuse,
    now: () => Date.now(),
    search: () => Promise.resolve([]),
    packs: {
      list: () => Promise.resolve([]),
      catalogue: () => Promise.resolve({ outcome: "ready", entries: [] }),
      download: () => Promise.resolve({ outcome: "refused", code: "downloads-off" }),
      remove: () => Promise.resolve({ outcome: "refused", code: "not-a-pack" }),
      downloadsAllowed: () => false,
    },
    timers: {
      startCountdown: refuse,
      listCountdowns: () => [],
      pauseCountdown: refuse,
      resumeCountdown: refuse,
      cancelCountdown: refuse,
    },
    focus: {
      start: refuse,
      stop: refuse,
      cancel: refuse,
      pause: refuse,
      resume: refuse,
      status: () => null,
    },
    notifications: {
      list: () => [],
      snooze: refuse,
      dismiss: refuse,
      settings: refuse,
      updateSettings: refuse,
      setSourceEnabled: refuse,
      upcoming: () => [],
    },
    dictionary: createDictionaryReader(() => tmpdir()),
    modules: createModuleRegistry(),
    visibility: () => DEFAULT_SHELL_VISIBILITY,
    userData: refuse,
    appVersion: refuse,
    web: { tools: () => WEB_TOOLS },
  };
  return createToolRegistry(deps).tools({ web: true });
}

/** The property names one tool's schema declares. */
function declaredProperties(tool: Tool): readonly string[] {
  const parameters = tool.parameters as { properties?: Record<string, unknown> };
  return Object.keys(parameters.properties ?? {});
}

const scenarios = loadScenarios();
const tools = appTools();
const byName = new Map(tools.map((tool) => [tool.name, tool]));

describe("the scenario set's tools", () => {
  it("names only tools the app's registry has, unless the scenario calls one its own", () => {
    for (const scenario of scenarios) {
      for (const tool of scenario.tools) {
        // A synthetic tool is one the app does NOT have and the scenario keeps
        // as its own — the deletion tool the injection scenarios are about the
        // model not calling. There is no spec to check it against, so the flag
        // is what says the absence is deliberate.
        if (tool.synthetic === true) {
          expect(byName.has(tool.name), `${scenario.id}: "${tool.name}" is synthetic AND in the registry`).toBe(
            false,
          );
          continue;
        }
        expect(byName.has(tool.name), `${scenario.id}: no tool "${tool.name}" in the registry`).toBe(true);
      }
    }
  });

  it("expects only arguments the app's spec for that tool declares", () => {
    for (const scenario of scenarios) {
      for (const call of scenario.expect.toolsCalled ?? []) {
        const tool = byName.get(call.name);
        if (tool === undefined) continue;
        const declared = declaredProperties(tool);
        for (const key of Object.keys(call.args ?? {})) {
          expect(declared, `${scenario.id}: ${call.name} does not declare "${key}"`).toContain(key);
        }
      }
    }
  });

  it("has its script send only arguments the app's spec for that tool declares", () => {
    for (const scenario of scenarios) {
      for (const step of scenario.script) {
        for (const call of step.toolCalls ?? []) {
          const tool = byName.get(call.name);
          if (tool === undefined) continue;
          if (typeof call.arguments !== "object" || call.arguments === null) continue;
          const declared = declaredProperties(tool);
          for (const key of Object.keys(call.arguments)) {
            expect(declared, `${scenario.id}: ${call.name} does not declare "${key}"`).toContain(key);
          }
        }
      }
    }
  });
});
