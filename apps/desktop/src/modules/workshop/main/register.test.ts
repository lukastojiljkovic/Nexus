import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GERBER_MAX_BYTES, parseStl } from "@nexus/core";
import { ModuleHost, type ModulePlatform } from "../../../main/moduleIpc.js";
import type { WorkshopResult } from "../shared/ipc.js";
import { WORKSHOP_MAX_BATCH_FILES } from "../shared/workshopFiles.js";
import { dialogFilterName } from "./dialogCopy.js";
import { WORKSHOP_NAME_MAX_LENGTH } from "./filesPure.js";
import { register, type WorkshopPicker } from "./register.js";

/**
 * The WORKSHOP module through the kit (ADR-090).
 *
 * **What these tests can prove, and how.** This module's one Electron-shaped
 * fact is the native dialog, so `register` takes its picker as a parameter: the
 * tests hand it a picker that answers paths they wrote in a temporary folder,
 * and everything downstream - the bounded read, the caps, the per-file refusals,
 * the Gerber conversion through the real library - runs exactly as it does in
 * the app. The database is a platform function that THROWS, which is the one
 * assertion no fake can fake: this module reads no store, so a handler that ever
 * reached for one would fail here.
 *
 * **Nothing here opens a window.** A path that comes back from the picker is a
 * path in `%TEMP%`, which is what a dialog would have produced anyway.
 */

const TRUSTED = { trusted: true };

/** A single triangle with a hand-checkable area: base 10, height 10, so 50 square millimetres. */
const TRIANGLE_STL = [
  "solid triangle",
  "  facet normal 0 0 1",
  "    outer loop",
  "      vertex 0 0 0",
  "      vertex 10 0 0",
  "      vertex 0 10 0",
  "    endloop",
  "  endfacet",
  "endsolid triangle",
  "",
].join("\n");

/**
 * Two 1 mm pads on one millimetre pitch, in the 2.4 format the slicers of the
 * trade write: the library measures 3 mm by 1 mm for it, which is what the test
 * asserts rather than a number copied out of a report.
 */
const TOP_COPPER = [
  "G04 the smoke test's board*",
  "%FSLAX24Y24*%",
  "%MOMM*%",
  "%ADD10C,1.000*%",
  "G01*",
  "D10*",
  "X010000Y010000D03*",
  "X030000Y010000D03*",
  "M02*",
  "",
].join("\n");

/** Two holes on the same pitch, as Excellon writes them. */
const DRILL = [
  "M48",
  ";DRILL file {nexus test}",
  "FMAT,2",
  "METRIC",
  "T1C0.800",
  "%",
  "G90",
  "G05",
  "T1",
  "X1.000Y1.000",
  "X3.000Y1.000",
  "T0",
  "M30",
  "",
].join("\n");

let dir: string;

interface Harness {
  readonly host: ModuleHost;
  /** What the fake picker will answer next: paths, or `null` for a cancelled dialog. */
  answer: readonly string[] | null;
}

function harness(): Harness {
  const platform: ModulePlatform = {
    assertTrustedSender: (event) => {
      if (event !== TRUSTED) throw new Error("Nexus: that message did not come from this app.");
    },
    database: () => {
      throw new Error("The workshop viewers must never open the database.");
    },
    notify: () => undefined,
    schedule: () => () => undefined,
    now: () => Date.parse("2026-10-10T09:00:00.000Z"),
  };
  const state: Harness = { host: new ModuleHost(platform), answer: null };
  const picker: WorkshopPicker = async () => state.answer;
  register(state.host, picker);
  return state;
}

async function call<T>(host: ModuleHost, channel: string, payload: unknown): Promise<T> {
  return (await host.dispatch(channel, TRUSTED, payload)) as T;
}

function write(name: string, contents: string): string {
  const path = join(dir, name);
  writeFileSync(path, contents, "utf8");
  return path;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-workshop-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("the workshop handler surface", () => {
  it("registers exactly the ops its contract declares", () => {
    const { host } = harness();
    // Five, and the order is the registration order: the two viewers' ops, then
    // the three the PDF and image tools call (ADR-107's merge of the fragment in
    // `shared/workshopFiles.ts`). A verbatim list, because a channel this module
    // DID register and a channel it did not are the two states that matter here.
    expect(host.channels()).toEqual([
      "workshop:open",
      "workshop:reopen",
      "workshop:pickFiles",
      "workshop:saveFile",
      "workshop:saveBatch",
    ]);
  });

  it("refuses a payload the wire should never carry, before any file is read", async () => {
    const state = harness();

    await expect(call(state.host, "workshop:open", { target: "everything" })).rejects.toThrow(
      /no target "everything"/,
    );
    await expect(call(state.host, "workshop:open", { target: "" })).rejects.toThrow(
      /must be a non-empty string/,
    );
    await expect(call(state.host, "workshop:open", { target: 7 })).rejects.toThrow(
      /must be a non-empty string/,
    );
    await expect(
      call(state.host, "workshop:reopen", { target: "model", path: "" }),
    ).rejects.toThrow(/must be a non-empty string/);
    await expect(
      call(state.host, "workshop:reopen", { target: "model", path: `/${"x".repeat(5000)}` }),
    ).rejects.toThrow(/must not exceed 4096 characters/);
  });

  it("answers a cancelled dialog with nothing at all rather than a failure", async () => {
    const state = harness();
    state.answer = null;
    expect(await call<WorkshopResult>(state.host, "workshop:open", { target: "model" })).toEqual({
      canceled: true,
      files: [],
      refused: [],
    });
  });

  it("hands a model's bytes to the page, and the core reader turns them into geometry", async () => {
    const state = harness();
    state.answer = [write("triangle.stl", TRIANGLE_STL)];

    const result = await call<WorkshopResult>(state.host, "workshop:open", { target: "model" });

    expect(result.canceled).toBe(false);
    expect(result.refused).toEqual([]);
    const [file] = result.files;
    expect(file?.kind).toBe("model");
    expect(file?.name).toBe("triangle.stl");
    if (file?.kind !== "model") throw new Error("expected a model");
    // The bytes are the file, whole, and the reader in `@nexus/core` reads them:
    // a triangle of base 10 and height 10 is 50 square millimetres.
    expect(new TextDecoder().decode(file.bytes)).toBe(TRIANGLE_STL);
    expect(parseStl(file.bytes).area).toBe(50);
  });

  it("converts a board's layers, classifying each one and measuring the board", async () => {
    const state = harness();
    state.answer = [write("top.gtl", TOP_COPPER), write("holes.drl", DRILL)];

    const result = await call<WorkshopResult>(state.host, "workshop:open", { target: "board" });

    expect(result.refused).toEqual([]);
    const copper = result.files[0];
    const drill = result.files[1];
    expect(copper?.kind).toBe("board");
    expect(drill?.kind).toBe("board");
    if (copper?.kind !== "board" || drill?.kind !== "board") throw new Error("expected a board");
    expect(copper.role).toBe("copper-top");
    expect(drill.role).toBe("drill");
    // Two 1 mm pads on a 2 mm pitch: the library measures 3 mm across and 1 mm
    // down, and the layer's own box is where its geometry starts.
    expect(copper.widthMm).toBe(3);
    expect(copper.heightMm).toBe(1);
    expect(copper.originXmm).toBe(0.5);
    expect(copper.originYmm).toBe(0.5);
    expect(copper.svg.startsWith("<svg")).toBe(true);
    // The drill layer spans the two hole centres, 2 mm apart.
    expect(drill.widthMm).toBeCloseTo(2.8, 6);
    expect(drill.svg.length).toBeGreaterThan(0);
  });

  it("refuses a file that is too large, a directory, and a path that is not there", async () => {
    const state = harness();
    const oversized = join(dir, "huge.gbr");
    writeFileSync(oversized, "");
    // Sparse: the cap is measured from the handle's own stat before any byte is
    // read, so the file only has to BE that long on disk.
    truncateSync(oversized, GERBER_MAX_BYTES + 1);
    const directory = join(dir, "a-folder");
    mkdirSync(directory);
    state.answer = [oversized, directory, join(dir, "gone.gbr")];

    const result = await call<WorkshopResult>(state.host, "workshop:open", { target: "board" });

    expect(result.files).toEqual([]);
    expect(result.refused.map((entry) => entry.problem)).toEqual([
      "too-large",
      "not-a-file",
      "unreadable",
    ]);
    expect(result.refused.map((entry) => entry.name)).toEqual([
      "huge.gbr",
      "a-folder",
      "gone.gbr",
    ]);
  });

  it("refuses a board of more layers than it draws, once rather than seventeen times", async () => {
    const state = harness();
    const layer = write("layer.gtl", TOP_COPPER);
    state.answer = Array.from({ length: 17 }, () => layer);

    const result = await call<WorkshopResult>(state.host, "workshop:open", { target: "board" });

    expect(result).toEqual({
      canceled: false,
      files: [],
      refused: [],
      problem: "too-many-files",
    });
  });

  it("re-reads a path it handed out in this session, and refuses one it did not", async () => {
    const state = harness();
    const path = write("triangle.stl", TRIANGLE_STL);
    state.answer = [path];
    await call(state.host, "workshop:open", { target: "model" });

    const again = await call<WorkshopResult>(state.host, "workshop:reopen", {
      target: "model",
      path,
    });
    expect(again.files.map((file) => file.name)).toEqual(["triangle.stl"]);

    // A path the renderer made up - or one from a previous run of the app - is
    // not a file this process may read.
    const invented = await call<WorkshopResult>(state.host, "workshop:reopen", {
      target: "model",
      path: join(dir, "elsewhere.stl"),
    });
    expect(invented.files).toEqual([]);
    expect(invented.refused).toEqual([
      { name: "elsewhere.stl", problem: "not-in-this-session" },
    ]);
  });

  it("forgets the session's paths when the session ends", async () => {
    const state = harness();
    const path = write("triangle.stl", TRIANGLE_STL);
    state.answer = [path];
    await call(state.host, "workshop:open", { target: "model" });

    state.host.sessionEnd();

    const after = await call<WorkshopResult>(state.host, "workshop:reopen", {
      target: "model",
      path,
    });
    expect(after.refused).toEqual([{ name: "triangle.stl", problem: "not-in-this-session" }]);
  });

  it("puts nothing in the profile's archive, because a viewer stores nothing", () => {
    const { host } = harness();
    expect(host.collectExports(["profile-1"])).toEqual([]);
  });
});

/**
 * The tool sets' three channels (ADR-107's wiring).
 *
 * What can be proved here is the BOUNDARY, which is the half a hostile renderer
 * meets: every payload below is refused by the handler's own validators, before
 * a dialog is opened or a file is touched — which also runs under Vitest, where
 * this process has no Electron at all. The dialog and the write themselves are
 * `files.ts`'s, and they run in the app.
 */
describe("the PDF and image tools' file channels", () => {
  it("refuses a pick kind this module does not offer, before any dialog is opened", async () => {
    const { host } = harness();
    // The refusal names the field, which is also the evidence that the channel
    // EXISTS: an unregistered one answers "No module answers channel".
    await expect(call(host, "workshop:pickFiles", { kind: "exe" })).rejects.toThrow(
      /"kind" must be "pdf" or "image"/,
    );
    await expect(call(host, "workshop:pickFiles", { kind: 7 })).rejects.toThrow(/must be a string/);
  });

  it("refuses bytes that are not a real, non-empty Uint8Array", async () => {
    const { host } = harness();
    for (const bytes of [undefined, "UERG", { 0: 37, byteLength: 1 }, new Uint8Array(0)]) {
      await expect(
        call(host, "workshop:saveFile", { suggestedName: "report.pdf", bytes }),
      ).rejects.toThrow(/"bytes" must be a non-empty Uint8Array/);
    }
  });

  it("refuses a name that is not a string, and one longer than a name may be", async () => {
    const { host } = harness();
    await expect(
      call(host, "workshop:saveFile", { suggestedName: 7, bytes: new Uint8Array([1]) }),
    ).rejects.toThrow(/"suggestedName" must be a string/);
    await expect(
      call(host, "workshop:saveFile", {
        suggestedName: "a".repeat(WORKSHOP_NAME_MAX_LENGTH + 1),
        bytes: new Uint8Array([1]),
      }),
    ).rejects.toThrow(
      new RegExp(`"suggestedName" must not exceed ${String(WORKSHOP_NAME_MAX_LENGTH)} characters`),
    );
  });

  it("refuses a batch over its file count, from the count alone", async () => {
    const { host } = harness();
    // `null` members on purpose: the count is what is refused, so the handler
    // must not have looked INSIDE the list to say so — and a test that had to
    // build twenty real files to prove a count would be a test nobody runs.
    const tooMany = new Array<null>(WORKSHOP_MAX_BATCH_FILES + 1).fill(null);
    await expect(call(host, "workshop:saveBatch", { files: tooMany })).rejects.toThrow(
      new RegExp(`must not hold more than ${String(WORKSHOP_MAX_BATCH_FILES)} files`),
    );
    await expect(call(host, "workshop:saveBatch", { files: [] })).rejects.toThrow(
      /must not be empty/,
    );
    await expect(call(host, "workshop:saveBatch", { files: "x" })).rejects.toThrow(
      /must be an array/,
    );
  });
});

describe("the dialog's own word", () => {
  it("names each filter in both languages, and they are not the same word", () => {
    expect(dialogFilterName("model", "sr")).toBe("STL model");
    expect(dialogFilterName("model", "en")).toBe("STL model");
    expect(dialogFilterName("toolpath", "sr")).toBe("G-kod");
    expect(dialogFilterName("toolpath", "en")).toBe("G-code");
    expect(dialogFilterName("board", "sr")).toBe("Gerber i Excellon");
    expect(dialogFilterName("board", "en")).toBe("Gerber and Excellon");
  });
});
