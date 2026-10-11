import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NexusDatabase, TaskListStore, TaskStore, openDatabase, uuidv7 } from "@nexus/db";
import type { Tool, ToolEffect, ToolRegistry, WebService } from "@nexus/core";
import { createModuleRegistry } from "../../../shared/modules.js";
import { createToolRegistry, type ToolDeps } from "./index.js";

/**
 * The registry itself: the properties that are about the SET of tools rather
 * than about any one of them, plus one call through the assembled thing so the
 * wiring is not merely type-correct.
 *
 * A model addresses a tool by name and reads its schema as the whole of what it
 * may send, so the four rules below are the ones a mistake here would break
 * silently: a name that is not `area.verb`, two tools with one name, a
 * description with one language missing, and a schema that is not closed.
 */

const NOW_MS = new Date(2026, 9, 10, 9, 0, 0).getTime();
const NOW_ISO = new Date(NOW_MS).toISOString();
const PROFILE_ID = "0192f0f0-0000-7000-8000-000000000000";

let dir: string;
let db: NexusDatabase;
let profileId: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-tool-registry-"));
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
  new TaskListStore(db.raw, profileId).ensureInbox(NOW_ISO);
});

/** A web service stand-in: one tool, of the shape the real one declares. */
function webServiceWith(tools: readonly Tool[]): WebService {
  return { tools: () => tools };
}

const WEB_TOOL: Tool = {
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
};

function registryWith(web: WebService | null = null): ToolRegistry {
  const deps: ToolDeps = {
    profileDb: (id, open) => open(db.raw, id),
    now: () => NOW_MS,
    search: () => Promise.resolve([]),
    packs: { list: () => Promise.resolve([]) },
    timers: {
      startCountdown: () => {
        throw new Error("Test setup: timers.start was not expected here.");
      },
      listCountdowns: () => [],
    },
    modules: createModuleRegistry(),
    web,
  };
  return createToolRegistry(deps);
}

const EFFECTS: readonly ToolEffect[] = ["read", "write", "navigate", "network"];

describe("createToolRegistry", () => {
  it("declares every area's tools, each named area.verb", () => {
    const tools = registryWith().tools({ web: false });
    // 19 before wave 2, plus the eighteen the wave-1 kit modules added
    // (library 2, pantry 2, car 2, cookbook 2, culture 2, recorder, reader,
    // wiki, maps, calculator, lab 2, miniapps).
    expect(tools).toHaveLength(37);
    for (const tool of tools) {
      expect(tool.name).toMatch(/^[a-z][a-z0-9]*\.[a-z][a-z0-9]*$/);
      expect(EFFECTS).toContain(tool.effect);
    }
    expect(new Set(tools.map((tool) => tool.name)).size).toBe(tools.length);
  });

  it("gives every tool a description in both languages, and both say something", () => {
    for (const tool of registryWith().tools({ web: false })) {
      expect(tool.description.sr.trim().length).toBeGreaterThan(0);
      expect(tool.description.en.trim().length).toBeGreaterThan(0);
      // Two languages, not one sentence pasted twice: a description that reads
      // identically in Serbian and English is one nobody translated.
      expect(tool.description.sr).not.toBe(tool.description.en);
    }
  });

  it("hands the model a closed, tight schema for every tool", () => {
    for (const tool of registryWith().tools({ web: false })) {
      const schema = tool.parameters as Record<string, unknown>;
      expect(schema["type"]).toBe("object");
      expect(schema["additionalProperties"]).toBe(false);
      const properties = schema["properties"] as Record<string, Record<string, unknown>>;
      const required = schema["required"] as readonly string[];
      expect(Array.isArray(required)).toBe(true);
      for (const name of required) {
        expect(Object.keys(properties)).toContain(name);
      }
      for (const [name, property] of Object.entries(properties)) {
        // Every property states a type (or an enum, which is a type with its
        // vocabulary spelled out) — a schema a model can only guess from is the
        // failure this assertion exists for.
        expect(property["type"] ?? property["enum"], `"${tool.name}".${name}`).toBeDefined();
        if (Array.isArray(property["enum"])) {
          expect((property["enum"] as readonly unknown[]).length).toBeGreaterThan(1);
        }
        if (property["type"] === "string" && required.includes(name)) {
          // A required string the model may send must say how long it may be —
          // or be a closed vocabulary, which is the tighter statement of the
          // same thing: a kind that must be one of four words cannot be an
          // unbounded text field.
          expect(
            property["maxLength"] ??
              property["pattern"] ??
              (Array.isArray(property["enum"]) ? property["enum"] : undefined),
            `"${tool.name}".${name}`,
          ).toBeDefined();
        }
      }
    }
  });

  it("adds the web tools only when web search is on AND this build has the service", () => {
    const withWeb = registryWith(webServiceWith([WEB_TOOL]));
    const off = withWeb.tools({ web: false });
    const on = withWeb.tools({ web: true });
    expect(off.map((tool) => tool.name)).not.toContain("web.search");
    expect(on.map((tool) => tool.name)).toContain("web.search");
    expect(on).toHaveLength(off.length + 1);

    // A build with no web service answers with the app's own tools rather than
    // throwing: an assistant that cannot search the web is still an assistant.
    expect(registryWith(null).tools({ web: true })).toHaveLength(off.length);
  });

  it("refuses two tools with one name, and a name that is not area.verb", () => {
    const duplicate = registryWith(webServiceWith([{ ...WEB_TOOL, name: "tasks.create" }]));
    expect(() => duplicate.tools({ web: true })).toThrowError(
      'Assistant tool "tasks.create" is declared twice.',
    );

    const misspelled = registryWith(webServiceWith([{ ...WEB_TOOL, name: "web:search" }]));
    expect(() => misspelled.tools({ web: true })).toThrowError(
      'Assistant tool "web:search" is not named area.verb in lower case.',
    );
  });

  it("runs a tool through the assembled registry against the real database", async () => {
    const registry = registryWith();
    const create = registry.tools({ web: false }).find((tool) => tool.name === "tasks.create");
    if (create === undefined) throw new Error('Test setup: no tool "tasks.create".');

    const result = await create.run(
      { title: "Kupiti vodu" },
      {
        profileId,
        locale: "en",
        signal: new AbortController().signal,
        confirm: () => Promise.resolve(true),
      },
    );

    expect(result.ok).toBe(true);
    expect(new TaskStore(db.raw, profileId).listActive().map((task) => task.title)).toEqual([
      "Kupiti vodu",
    ]);
  });

  it("keeps a profile's tools apart: a store write lands under the caller's own profile", async () => {
    const registry = registryWith();
    const other = uuidv7();
    db.raw
      .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
      .run(other, "personal", "Other", NOW_ISO);
    new TaskListStore(db.raw, other).ensureInbox(NOW_ISO);

    const list = registry.tools({ web: false }).find((tool) => tool.name === "tasks.list");
    if (list === undefined) throw new Error('Test setup: no tool "tasks.list".');
    const result = await list.run(
      {},
      {
        profileId: PROFILE_ID,
        locale: "en",
        signal: new AbortController().signal,
        confirm: () => Promise.resolve(true),
      },
    );
    expect(result).toEqual({ ok: true, content: "This profile has no tasks." });
    expect(new TaskStore(db.raw, other).listActive()).toEqual([]);
  });
});
