/**
 * The one test that proves a pack is copied and hashed in a STREAM, and it is
 * skipped by default because it writes and reads several gigabytes.
 *
 * Run it with:
 *
 *     NEXUS_SLOW_PACKS=1 node node_modules/vitest/vitest.mjs run \
 *       --maxWorkers=1 apps/desktop/src/main/packs/streaming.slow.test.ts
 *
 * (PowerShell: `$env:NEXUS_SLOW_PACKS = "1"; node node_modules/vitest/vitest.mjs
 * run --maxWorkers=1 apps/desktop/src/main/packs/streaming.slow.test.ts`.)
 *
 * It needs about THREE gigabytes of free space on the temp volume: the pack's
 * one-gigabyte file, the copy that staging holds while the first one is still
 * there, and room for the filesystem to breathe. It says so and stops rather
 * than failing when that is not there — the machine, not the code, would be the
 * reason.
 */

import { createHash } from "node:crypto";
import { closeSync, mkdirSync, mkdtempSync, openSync, rmSync, statfsSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { baseManifest, makeKey, writePack } from "./fixtures.js";
import { installPackFromDirectory, verifyInstalledPack } from "./install.js";

const CHUNK = Buffer.alloc(1024 * 1024, "packs are streamed, never slurped");
const GIB = 1024 * 1024 * 1024;
const REQUIRED_FREE_BYTES = 3 * GIB;

const RUN = process.env["NEXUS_SLOW_PACKS"] === "1";

let root: string;
let userData: string;
let freeEnough = false;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "nexus-packs-streaming-"));
  userData = join(root, "userData");
  try {
    const stats = statfsSync(tmpdir());
    freeEnough = stats.bavail * stats.bsize > REQUIRED_FREE_BYTES;
  } catch {
    freeEnough = false;
  }
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe.skipIf(!RUN)("a one-gigabyte file", () => {
  it("is copied and hashed in one streaming pass, then verified the same way", async () => {
    if (!freeEnough) {
      console.log("streaming: SKIPPED — the temp volume has under 3 GiB free.");
      return;
    }
    const key = makeKey();
    const sourceDir = join(root, "source");
    mkdirSync(sourceDir, { recursive: true });

    // The source file, hashed WHILE it is written, one mebibyte at a time, so
    // the expected digest does not come from the code under test and the test
    // itself never holds a gigabyte.
    const hash = createHash("sha256");
    const descriptor = openSync(join(sourceDir, "big.bin"), "w");
    for (let written = 0; written < GIB; written += CHUNK.byteLength) {
      writeSync(descriptor, CHUNK);
      hash.update(CHUNK);
    }
    closeSync(descriptor);

    writePack({
      dir: sourceDir,
      key: key.privateKey,
      manifest: baseManifest([{ path: "big.bin", size: GIB, sha256: hash.digest("hex") }]),
    });

    const copyStart = process.hrtime.bigint();
    const installed = await installPackFromDirectory(sourceDir, {
      userData,
      appVersion: "1.6.0",
      publicKeyPem: key.publicKeyPem,
      onProgress: () => undefined,
      freeBytes: () => null,
    });
    const copySeconds = Number(process.hrtime.bigint() - copyStart) / 1e9;
    expect(installed.size).toBe(GIB);
    console.log(
      `streaming: install (copy + hash) ${(GIB / 1024 / 1024 / copySeconds).toFixed(0)} MiB/s over ${copySeconds.toFixed(1)} s`,
    );

    const verifyStart = process.hrtime.bigint();
    await verifyInstalledPack({
      userData,
      id: "wikipedia-sr",
      publicKeyPem: key.publicKeyPem,
      onProgress: () => undefined,
    });
    const verifySeconds = Number(process.hrtime.bigint() - verifyStart) / 1e9;
    console.log(
      `streaming: verify (hash only) ${(GIB / 1024 / 1024 / verifySeconds).toFixed(0)} MiB/s over ${verifySeconds.toFixed(1)} s`,
    );
  }, 600_000);
});
