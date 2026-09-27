import { toolDrawer } from "@nexus/core";
import { describe, expect, it } from "vitest";

import { PRO_TOOL_GROUPS } from "../../shared/modules.js";
import { PRO_SURFACE_FILES } from "./proToolSurfaces.js";

/**
 * The professional drawer's surfaces are fetched a file at a time, so which
 * tools a file holds has to be known before the file is — and it is read from
 * the registrations (`PRO_TOOL_GROUPS`), not from the file. That is a claim
 * about the file, and this is where it is checked: every file is loaded, and
 * must export exactly the surfaces its registrations name. A surface written
 * into a file without a registration would be a tool nobody can reach; a
 * registration whose file has no surface would be a row that opens onto a
 * thrown error the first time anybody clicks it.
 */
/**
 * One test per file, with a budget of its own. Loading a surface file is a COLD
 * transform of a toolkit's whole source, and all of them in one test took 3.5 s
 * alone and over the default 5 s inside the full parallel suite — a timeout
 * that says nothing about the files. Split, a slow file is a slow file by name
 * (the first pays for the imports they share), and the budget is stated rather
 * than inherited.
 */
const LOAD_BUDGET_MS = 20_000;

describe("the professional surface files", () => {
  it.each(PRO_SURFACE_FILES.map((file) => [file.file, file] as const))(
    "%s exports exactly the tools its registrations say it holds",
    async (_name, file) => {
      const surfaces = await file.load();
      expect(Object.keys(surfaces).sort()).toEqual(file.tools.map((tool) => tool.id).sort());
    },
    LOAD_BUDGET_MS,
  );

  it("cover every professional registration once, and nothing else", () => {
    const filed = PRO_SURFACE_FILES.flatMap((file) => file.tools.map((tool) => tool.id));
    // Once: the developer toolkit is split by `category`, and a tool filed under
    // two categories' files would be drawn by whichever loaded first.
    expect(new Set(filed).size).toBe(filed.length);
    // Every one: a developer tool whose category names no file here would be
    // dropped by the split without a word.
    const registered = Object.values(PRO_TOOL_GROUPS)
      .flat()
      .map((tool) => tool.id);
    expect([...filed].sort()).toEqual([...registered].sort());
  });

  it("file only professional tools", () => {
    for (const file of PRO_SURFACE_FILES) {
      for (const tool of file.tools) expect(toolDrawer(tool), tool.id).toBe("professional");
    }
  });
});
