import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import { DWG_LIMITS, DwgError, convertDwgToDxf } from "./dwg.js";
import { fixtureScript, removeSharedToolPacks, sharedToolPack } from "./fixtures.js";
import { createToolSession, TOOL_LIMITS, type ToolSession } from "./run.js";

/**
 * The DWG client against `fixtures/fake-dwg2dxf.mts`, which implements the CLI
 * the pack's own man page documents (`-y`, `-o outfile`, one input file) and one
 * failure mode. What the client is responsible for is the argv it sends, the
 * copy it makes first, the file it reads back and the caps around all three.
 */

let session: ToolSession | null = null;

afterEach(async () => {
  // The pack folders are shared between cases (`fixtures.ts` says why), so a case
  // ends its own session and leaves them alone.
  if (session !== null) await session.close();
  session = null;
});

afterAll(() => {
  removeSharedToolPacks();
});

/** A session whose entry is `fake-dwg2dxf.mts` run to completion, and a file to convert. */
async function converterSession(): Promise<{ readonly session: ToolSession; readonly input: string }> {
  const fixture = sharedToolPack({
    tool: { protocol: "stdio", args: [fixtureScript("fake-dwg2dxf.mts")] },
  });
  session = await createToolSession({
    dir: fixture.dir,
    manifest: fixture.manifest,
    tempRoot: fixture.root,
    limits: { ...TOOL_LIMITS, timeoutMs: 5_000 },
  });
  const drawing = join(mkdtempSync(join(tmpdir(), "nexus-dwg-")), "plan.dwg");
  writeFileSync(drawing, "AC1027 with twelve bytes");
  return { session, input: drawing };
}

describe("converting a DWG", () => {
  it("copies the input into the session, runs the converter and returns the DXF bytes", async () => {
    const { session: toolSession, input } = await converterSession();
    const conversion = await convertDwgToDxf({ session: toolSession, path: input });
    const text = conversion.dxf.toString("utf8");
    // The fixture writes the INPUT's length into the drawing it produces, so the
    // bytes that came back identify the run: 24 bytes of "AC1027 with twelve bytes".
    expect(text).toContain("999\nbytes 24\n");
    expect(text.startsWith("0\nSECTION\n")).toBe(true);
    expect(conversion.log).toContain("Writing DXF file");
    // The tool's own log names the file it was given, which is the staged random
    // name rather than anything the user wrote.
    expect(conversion.log).not.toContain("plan.dwg");
    // Measured: 573 ms warm; the first spawn of a fresh executable is what costs,
    // and this file is 3.8 s on this machine. The budget is CI's margin.
  }, 30_000);

  it("names the tool's paths as relative ones, so it never learns where the user's file lives", async () => {
    const { session: toolSession, input } = await converterSession();
    const conversion = await convertDwgToDxf({ session: toolSession, path: input });
    const reading = conversion.log
      .split("\n")
      .find((line) => line.startsWith("Reading DWG file "));
    expect(reading).toBeDefined();
    const named = reading?.slice("Reading DWG file ".length) ?? "";
    expect(named).not.toContain("\\");
    expect(named).not.toContain("/");
    expect(named.endsWith(".dwg")).toBe(true);
  });

  it("reports a converter that exited non-zero, with what it said", async () => {
    const { session: toolSession } = await converterSession();
    const broken = join(mkdtempSync(join(tmpdir(), "nexus-dwg-")), "broken.dwg");
    writeFileSync(broken, "BROKEN header");
    try {
      await convertDwgToDxf({ session: toolSession, path: broken });
      expect.unreachable("a failed conversion must not answer with a drawing");
    } catch (error) {
      expect(error).toBeInstanceOf(DwgError);
      expect(error).toMatchObject({ code: "conversion-failed" });
      expect((error as DwgError).message).toContain("READ ERROR 0x1");
    } finally {
      rmSync(dirname(broken), { recursive: true, force: true });
    }
  });

  it("refuses an input larger than the runner will copy, before the converter is started", async () => {
    const { session: toolSession } = await converterSession();
    const huge = join(mkdtempSync(join(tmpdir(), "nexus-dwg-")), "huge.dwg");
    writeFileSync(huge, "0123456789");
    try {
      await expect(
        convertDwgToDxf({ session: toolSession, path: huge, maxInputBytes: 4 }),
      ).rejects.toMatchObject({ code: "input-too-large" });
    } finally {
      rmSync(dirname(huge), { recursive: true, force: true });
    }
  });

  it("refuses a pack whose tool speaks a request/response protocol instead", async () => {
    const fixture = sharedToolPack({ tool: { protocol: "uci" } });
    session = await createToolSession({ dir: fixture.dir, manifest: fixture.manifest, tempRoot: fixture.root });
    await expect(
      convertDwgToDxf({ session, path: join(fixture.root, "absent.dwg") }),
    ).rejects.toMatchObject({ code: "not-a-tool" });
  });

  it("reports a conversion that was stopped by its deadline", async () => {
    const fixture = sharedToolPack({
      tool: { protocol: "stdio", args: [fixtureScript("fake-tool.mts"), "hang"] },
    });
    session = await createToolSession({
      dir: fixture.dir,
      manifest: fixture.manifest,
      tempRoot: fixture.root,
      limits: { ...TOOL_LIMITS, timeoutMs: TOOL_LIMITS.timeoutMs },
    });
    const drawing = join(mkdtempSync(join(tmpdir(), "nexus-dwg-")), "plan.dwg");
    writeFileSync(drawing, "AC1027");
    try {
      await expect(
        convertDwgToDxf({ session, path: drawing, timeoutMs: 250 }),
      ).rejects.toMatchObject({ code: "conversion-stopped" });
    } finally {
      rmSync(dirname(drawing), { recursive: true, force: true });
    }
  });

  it("states the deadline and the output cap the pack ships under", () => {
    expect(DWG_LIMITS.timeoutMs).toBe(60_000);
    expect(DWG_LIMITS.outputBytes).toBe(256 * 1024 * 1024);
  });
});
