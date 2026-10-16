import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readTexturePacks } from "./packs.js";
import type { AstronomyPacksView } from "../shared/ipc.js";

const view = { textures: null } as unknown as AstronomyPacksView;

describe("readTexturePacks", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("answers ready with the pack view when the read succeeds", async () => {
    await expect(readTexturePacks(async () => view)).resolves.toEqual({ status: "ready", data: view });
  });

  it("answers failed, and does not throw, when the read rejects", async () => {
    await expect(
      readTexturePacks(async () => {
        throw new Error("disk");
      }),
    ).resolves.toEqual({ status: "failed" });
    expect(console.error).toHaveBeenCalledOnce();
  });
});
