import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ModuleHost, type ModulePlatform } from "../../../main/moduleIpc.js";
import { createModuleTools, type ModuleToolsAccess } from "../../../main/moduleTools.js";
import { makeKey } from "../../../main/packs/fixtures.js";
import { fixtureScript, installedToolPack } from "../../../main/tools/fixtures.js";
import { TOOL_LIMITS } from "../../../main/tools/run.js";
import { provideDrawingsPlatform, type DrawingsPlatform, type PickDrawing, type PrintView } from "./platform.js";
import { register } from "./register.js";

/**
 * The DRAWINGS module through the kit (ADR-090): its two ops, what main answers
 * for each shape a file can be, and the DWG path end to end.
 *
 * **The platform is a fake, and the seam is real.** `pickFile` and `printView`
 * are the two things that need Electron, so the test installs what they would
 * have answered and everything between the wire and `openDwg` runs for real:
 * the bounded read of a DXF, the mapping of the platform's outcomes, and the
 * three endings of the DWG path.
 *
 * **The converter is the real one, over a real pack.** `converterFor` builds a
 * `DwgTool` out of the kit's tool capability and `main/tools/dwg.ts`, so a case
 * that works proves the composition and not a stub of it: the pack folder is
 * installed and signed like any other (with a throwaway key), the entry is a hard
 * link to this Node, and the program it runs is `tools/fixtures/fake-dwg2dxf.mts`
 * — never LibreDWG.
 *
 * **No database.** This module stores nothing, so `database()` throws: a handler
 * that reached for a profile's database would fail here rather than in a build
 * that happens to have one.
 */

const TRUSTED = { trusted: true };
const UNTRUSTED = { trusted: false };

let work: string;
let picked: PickDrawing;
let printed: PrintView;
/** The tool access this case runs with: nothing installed, unless the case says otherwise. */
let tools: ModuleToolsAccess;

afterEach(() => {
  rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "nexus-drawings-module-"));
  picked = { status: "cancelled" };
  printed = { status: "cancelled" };
  tools = noTools();
});

function harness(): ModuleHost {
  const platform: DrawingsPlatform = {
    pickFile: () => Promise.resolve(picked),
    printView: () => Promise.resolve(printed),
  };
  provideDrawingsPlatform(platform);

  const host = new ModuleHost({
    assertTrustedSender: (event) => {
      if (event !== TRUSTED) throw new Error("Nexus: that message did not come from this app.");
    },
    database: () => {
      throw new Error("Nexus: the drawings module must not open a database.");
    },
    notify: () => undefined,
    schedule: () => () => undefined,
    now: () => Date.parse("2026-10-10T10:00:00.000Z"),
    tools,
  } satisfies ModulePlatform);
  register(host);
  return host;
}

async function call(host: ModuleHost, channel: string, payload: unknown): Promise<unknown> {
  return await host.dispatch(channel, TRUSTED, payload);
}

/** A machine with nothing installed: a `.dwg` is then a pack this app cannot run. */
function noTools(): ModuleToolsAccess {
  return {
    installed: () => [],
    pack: () => null,
    session: () => Promise.reject(new Error("No tool pack is installed on this machine.")),
  };
}

/** A machine with the LibreDWG pack installed, over the fixture converter. */
function libredwgInstalled(): ModuleToolsAccess {
  const key = makeKey();
  installedToolPack({
    userData: work,
    key,
    id: "libredwg",
    version: "0.14.8601",
    protocol: "stdio",
    args: [fixtureScript("fake-dwg2dxf.mts")],
  });
  return createModuleTools({
    userData: () => work,
    publicKeyPem: key.publicKeyPem,
    tempRoot: work,
    limits: { ...TOOL_LIMITS, timeoutMs: 30_000 },
  });
}

/** One file on disk, as the native picker would have answered for it. */
function fileWith(name: string, contents: string): PickDrawing {
  const path = join(work, name);
  writeFileSync(path, contents);
  return {
    status: "picked",
    name,
    kind: name.toLowerCase().endsWith(".dwg") ? "dwg" : "dxf",
    path,
  };
}

describe("the drawings handler surface", () => {
  it("registers exactly the ops its contract declares", () => {
    expect(harness().channels()).toEqual(["drawings:open", "drawings:print"]);
  });

  it("opens a chosen DXF: the bytes come back with the file's own name", async () => {
    const host = harness();
    const bytes = "0\nSECTION\n";
    picked = fileWith("plan.dxf", bytes);

    await expect(call(host, "drawings:open", {})).resolves.toEqual({
      outcome: "drawing",
      name: "plan.dxf",
      bytes: Buffer.from(bytes, "utf8"),
      tool: null,
    });
  });

  it("refuses an empty DXF by name, before the parser ever sees it", async () => {
    const host = harness();
    picked = fileWith("empty.dxf", "");
    await expect(call(host, "drawings:open", {})).resolves.toEqual({
      outcome: "refused",
      code: "empty",
    });
  });

  it("answers a DWG with the pack that reads it when no pack is installed", async () => {
    const host = harness();
    picked = fileWith("plan.dwg", "AC1027 with twelve bytes");

    await expect(call(host, "drawings:open", {})).resolves.toEqual({
      outcome: "needs-pack",
      pack: "libredwg",
      catalogue: "settings:packs",
    });
  });

  it("converts a DWG through the installed pack, and credits it", async () => {
    tools = libredwgInstalled();
    const host = harness();
    picked = fileWith("plan.dwg", "AC1027 with twelve bytes");

    const answer = (await call(host, "drawings:open", {})) as {
      outcome: string;
      name: string;
      bytes: Uint8Array;
      tool: { id: string; licence: { spdx: string }; source: { name: string } } | null;
    };
    expect(answer.outcome).toBe("drawing");
    expect(answer.name).toBe("plan.dwg");
    // The fixture writes the INPUT's length into the drawing it produces, so the
    // bytes that came back identify the run: 24 bytes of the string above.
    expect(Buffer.from(answer.bytes).toString("utf8")).toContain("999\nbytes 24\n");
    // ADR-094 §5: the licence and the source travel with the conversion, read
    // from the pack's own signed manifest.
    expect(answer.tool).toMatchObject({
      id: "libredwg",
      licence: { spdx: "GPL-3.0-or-later" },
      source: { name: "Nexus tests" },
    });
    // MEASURED: 1.1 s on this machine — the entry's 92 MB hash, the handshake of
    // Node as the converter, and the conversion. The budget is CI's margin on a
    // machine three times slower than this one.
  }, 30_000);

  it("reports a conversion the converter could not do, with its exit and its own first line", async () => {
    tools = libredwgInstalled();
    const host = harness();
    // The fixture's failure shape, copied from the real tool: a diagnostic on
    // stderr, a non-zero exit code and no file.
    picked = fileWith("broken.dwg", "BROKEN header");

    await expect(call(host, "drawings:open", {})).resolves.toEqual({
      outcome: "conversion-failed",
      name: "broken.dwg",
      failure: { code: "conversion-failed", exitCode: 1, reason: "READ ERROR 0x1" },
    });
  }, 30_000);

  it("passes every refusal through as data, by its own code", async () => {
    const host = harness();
    for (const code of ["too-large", "unreadable", "not-a-file", "unknown-format", "empty"] as const) {
      picked = { status: "refused", code };
      await expect(call(host, "drawings:open", {})).resolves.toEqual({ outcome: "refused", code });
    }
  });

  it("answers a cancelled picker with nothing opened", async () => {
    const host = harness();
    picked = { status: "cancelled" };
    await expect(call(host, "drawings:open", {})).resolves.toEqual({ outcome: "cancelled" });
  });

  it("answers a print by where the PDF went, or by why it did not", async () => {
    const host = harness();

    printed = { status: "saved", path: "C:/crtezi/plan.pdf" };
    await expect(call(host, "drawings:print", {})).resolves.toEqual({
      outcome: "saved",
      path: "C:/crtezi/plan.pdf",
    });

    printed = { status: "cancelled" };
    await expect(call(host, "drawings:print", {})).resolves.toEqual({ outcome: "cancelled" });

    printed = { status: "refused", code: "no-window" };
    await expect(call(host, "drawings:print", {})).resolves.toEqual({
      outcome: "refused",
      code: "no-window",
    });
  });
});

describe("what the handlers refuse", () => {
  it("refuses a payload that is not an object, on both channels", async () => {
    const host = harness();
    // Both ops take nothing, so the wire's own object check is the whole
    // validation - and it is still run, because "takes nothing" and "takes
    // anything" must not look the same from inside a handler.
    for (const channel of ["drawings:open", "drawings:print"]) {
      await expect(call(host, channel, null)).rejects.toThrow(/expected an object/);
      await expect(call(host, channel, [])).rejects.toThrow(/expected an object/);
      await expect(call(host, channel, "plan.dxf")).rejects.toThrow(/expected an object/);
    }
  });

  it("refuses a message that did not come from this app", async () => {
    const host = harness();
    await expect(host.dispatch("drawings:open", UNTRUSTED, {})).rejects.toThrow(
      /did not come from this app/,
    );
  });

  it("answers no channel this module did not declare", async () => {
    const host = harness();
    await expect(host.dispatch("drawings:convert", TRUSTED, {})).rejects.toThrow(
      /No module answers channel/,
    );
  });
});
