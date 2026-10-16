import { describe, expect, it } from "vitest";
import type { Tool, ToolContext } from "@nexus/core";
import { scannerTools } from "./scanner.js";

/**
 * The SCANNER tool. It opens the page, optionally pointed at a source, and never
 * starts a device or reads an image: the tests pin the action it hands the page
 * and the refusals a model reads.
 */

function tool(): Tool {
  const found = scannerTools().find((entry) => entry.name === "scanner.open");
  if (found === undefined) throw new Error("scanner.open is not declared");
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

describe("scanner.open", () => {
  it("is a navigation whose source, when given, is file or camera", () => {
    expect(tool().effect).toBe("navigate");
    expect(tool().parameters).toMatchObject({
      required: [],
      properties: { source: { enum: ["file", "camera"] } },
    });
  });

  it("opens the Scanner with no action when no source is named", async () => {
    const result = await tool().run({}, context("sr"));
    expect(result.ok).toBe(true);
    expect(result.navigateTo).toEqual({ module: "scanner" });
    expect(result.content).toBe("Skener je otvoren.");
  });

  it("points the page at the file input, and says the person picks the image", async () => {
    const result = await tool().run({ source: "file" }, context("en"));
    expect(result.navigateTo).toEqual({
      module: "scanner",
      action: { name: "source", payload: { source: "file" } },
    });
    expect(result.content).toBe("The Scanner is open; the user picks the image on the page.");
  });

  it("points at the camera without starting it, and says the person starts it", async () => {
    const result = await tool().run({ source: "camera" }, context("sr"));
    expect(result.navigateTo).toEqual({
      module: "scanner",
      action: { name: "source", payload: { source: "camera" } },
    });
    expect(result.content).toContain("korisnik sam pokreće kameru");
  });

  it("refuses a source the page does not offer, and names the ones it does", async () => {
    const result = await tool().run({ source: "paste" }, context("en"));
    expect(result.ok).toBe(false);
    expect(result.content).toContain("file, camera");
    expect(result.navigateTo).toBeUndefined();
  });

  it("asks nothing, because it changes no data and starts no device", async () => {
    const asked: string[] = [];
    await tool().run({ source: "camera" }, context("en", asked));
    expect(asked).toEqual([]);
  });
});
