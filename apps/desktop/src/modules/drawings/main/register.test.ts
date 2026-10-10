import { beforeEach, describe, expect, it } from "vitest";
import { ModuleHost, type ModulePlatform } from "../../../main/moduleIpc.js";
import {
  provideDrawingsPlatform,
  type DrawingsPlatform,
  type PrintView,
  type ReadDrawing,
} from "./platform.js";
import { register } from "./register.js";

/**
 * The DRAWINGS module through the kit (ADR-090): its two ops, what main answers
 * for each shape a file can be, and the refusals.
 *
 * **The platform is a fake, and the seam is real.** `pickAndRead` and
 * `printView` are the two things that need Electron, so the test installs what
 * they would have answered and everything between the wire and `openDrawing`
 * runs for real - including the mapping of three platform outcomes onto the two
 * the contract declares.
 *
 * **No database.** This module stores nothing, so `database()` throws: a handler
 * that reached for a profile's database would fail here rather than in a build
 * that happens to have one.
 */

const TRUSTED = { trusted: true };
const UNTRUSTED = { trusted: false };

let read: ReadDrawing;
let printed: PrintView;

function harness(): ModuleHost {
  const platform: DrawingsPlatform = {
    pickAndRead: () => Promise.resolve(read),
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
  } satisfies ModulePlatform);
  register(host);
  return host;
}

async function call(host: ModuleHost, channel: string, payload: unknown): Promise<unknown> {
  return await host.dispatch(channel, TRUSTED, payload);
}

beforeEach(() => {
  read = { status: "cancelled" };
  printed = { status: "cancelled" };
});

describe("the drawings handler surface", () => {
  it("registers exactly the ops its contract declares", () => {
    expect(harness().channels()).toEqual(["drawings:open", "drawings:print"]);
  });

  it("opens a chosen DXF: the bytes come back with the file's own name", async () => {
    const host = harness();
    const bytes = new Uint8Array([0x30, 0x0a]);
    read = { status: "chosen", name: "plan.dxf", kind: "dxf", bytes };

    await expect(call(host, "drawings:open", {})).resolves.toEqual({
      outcome: "drawing",
      name: "plan.dxf",
      bytes,
    });
  });

  it("answers a DWG with the pack that reads it, not with bytes to parse", async () => {
    const host = harness();
    read = {
      status: "chosen",
      name: "plan.dwg",
      kind: "dwg",
      bytes: new Uint8Array([0x41, 0x43, 0x31, 0x30]),
    };

    await expect(call(host, "drawings:open", {})).resolves.toEqual({
      outcome: "needs-pack",
      pack: "libredwg",
      catalogue: "settings:packs",
    });
  });

  it("passes every refusal through as data, by its own code", async () => {
    const host = harness();
    for (const code of ["too-large", "unreadable", "not-a-file", "unknown-format", "empty"] as const) {
      read = { status: "refused", code };
      await expect(call(host, "drawings:open", {})).resolves.toEqual({ outcome: "refused", code });
    }
  });

  it("answers a cancelled picker with nothing opened", async () => {
    const host = harness();
    read = { status: "cancelled" };
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
