import { describe, expect, it } from "vitest";
import type { Tool, ToolContext } from "@nexus/core";
import { workshopTools } from "./workshop.js";

/**
 * The WORKSHOP tool. It opens a page on a named view and touches no file, so what
 * the tests pin is the action the page receives and the refusals a model reads.
 */

function tool(): Tool {
  const found = workshopTools().find((entry) => entry.name === "workshop.open");
  if (found === undefined) throw new Error("workshop.open is not declared");
  return found;
}

function context(locale: "sr" | "en", asked: string[] = []): ToolContext {
  return {
    profileId: "profile",
    locale,
    signal: new AbortController().signal,
    confirm: ({ summary }) => {
      asked.push(summary);
      return Promise.resolve(true);
    },
  };
}

describe("workshop.open", () => {
  it("is a navigation that offers exactly the five tools by name", () => {
    expect(tool().effect).toBe("navigate");
    expect(tool().parameters).toMatchObject({
      required: ["tool"],
      properties: { tool: { enum: ["model", "toolpath", "board", "pdf", "images"] } },
    });
  });

  it("opens the Workshop on the named tool, with the page's own action", async () => {
    const result = await tool().run({ tool: "pdf" }, context("sr"));
    expect(result.ok).toBe(true);
    expect(result.navigateTo).toEqual({
      module: "workshop",
      action: { name: "open-tool", payload: { tool: "pdf" } },
    });
    expect(result.content).toContain("PDF alati");
  });

  it("says the file is picked on the page and never read by the assistant", async () => {
    const result = await tool().run({ tool: "board" }, context("en"));
    expect(result.content).toContain("Gerber board");
    expect(result.content).toContain("the assistant does not read it");
  });

  it("refuses a tool it does not have, and names the ones it has", async () => {
    const result = await tool().run({ tool: "dwg" }, context("en"));
    expect(result.ok).toBe(false);
    expect(result.content).toContain("model, toolpath, board, pdf, images");
    expect(result.navigateTo).toBeUndefined();
  });

  it("refuses a call that names no tool", async () => {
    const result = await tool().run({}, context("sr"));
    expect(result.ok).toBe(false);
    expect(result.navigateTo).toBeUndefined();
  });

  it("asks nothing, because it changes no data", async () => {
    const asked: string[] = [];
    await tool().run({ tool: "images" }, context("en", asked));
    expect(asked).toEqual([]);
  });
});
