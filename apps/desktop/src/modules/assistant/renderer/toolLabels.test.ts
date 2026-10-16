import { describe, expect, it } from "vitest";
import type { Tool, WebService } from "@nexus/core";
import { createToolRegistry, type ToolDeps } from "../../../main/assistant/tools/index.js";
import { createModuleRegistry } from "../../../shared/modules.js";
import { DEFAULT_SHELL_VISIBILITY } from "../../../shared/moduleVisibility.js";
import { en } from "./copy.en.js";
import { sr } from "./copy.sr.js";

/**
 * EVERY TOOL NAME THE PAGE CAN DRAW, IN BOTH LANGUAGES.
 *
 * A stored thread holds the tool's own name - `tasks.create`, which is what the
 * model called and what the registry answers to - and the page draws a label
 * instead, so that somebody reading their own receipt does not have to learn the
 * registry first. A name the map does not know falls back to the raw name, which
 * is a worse line rather than a missing one, and THIS is what keeps that
 * fallback for the tools that do not exist: the list below is the registry's
 * own, built the way `tools/index.test.ts` builds it, so a tool added to
 * `main/assistant/tools/` fails here instead of appearing as `area.verb` on a
 * screen.
 */

/** One web tool, of the shape the real service declares (`tools/index.test.ts` fakes the same way). */
function webTool(name: string): Tool {
  return {
    name,
    description: { sr: "Traži na vebu.", en: "Searches the web." },
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
    effect: "network",
    run: () => Promise.resolve({ ok: true, content: "" }),
  };
}

/** A web service stand-in carrying the two names the real one declares (`main/assistant/web/index.ts`). */
function webService(): WebService {
  return { tools: () => [webTool("web.search"), webTool("web.read")] };
}

/** The names the registry declares. The deps are never reached: nothing here runs a tool. */
function toolNames(): readonly string[] {
  const deps: ToolDeps = {
    profileDb: () => {
      throw new Error("Test setup: no tool was run here.");
    },
    now: () => 0,
    search: () => Promise.resolve([]),
    packs: { list: () => Promise.resolve([]) },
    tools: { installed: () => [], pack: () => null, session: () => Promise.reject(new Error("no pack")) },
    timers: {
      startCountdown: () => {
        throw new Error("Test setup: no tool was run here.");
      },
      listCountdowns: () => [],
    },
    modules: createModuleRegistry(),
    visibility: () => DEFAULT_SHELL_VISIBILITY,
    userData: () => "",
    appVersion: () => "",
    web: webService(),
  };
  return createToolRegistry(deps)
    .tools({ web: true })
    .map((tool) => tool.name);
}

describe("the assistant's tool labels", () => {
  it("names every tool the registry declares, in both languages", () => {
    const srLabels: Readonly<Record<string, string>> = sr.thread.tools.labels;
    const enLabels: Readonly<Record<string, string>> = en.thread.tools.labels;
    for (const name of toolNames()) {
      expect(srLabels[name], `sr: ${name}`).toBeTruthy();
      expect(enLabels[name], `en: ${name}`).toBeTruthy();
    }
  });

  it("carries no label for a tool the registry does not have", () => {
    expect(Object.keys(sr.thread.tools.labels).sort()).toEqual([...toolNames()].sort());
  });
});
