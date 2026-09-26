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
describe("the professional surface files", () => {
  it("each export exactly the tools their registrations say they hold", async () => {
    for (const file of PRO_SURFACE_FILES) {
      const surfaces = await file.load();
      expect(Object.keys(surfaces).sort(), file.file).toEqual(
        file.tools.map((tool) => tool.id).sort(),
      );
    }
  });

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
