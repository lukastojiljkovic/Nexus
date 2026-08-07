import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { IpcChannel } from "./ipc.js";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * EVERY main-process module, not just `index.ts`. Handlers are registered from
 * `imex.ts`, `notifications.ts`, `attachments.ts` and others too, and a check
 * that read one file would have reported two dozen false positives — which is
 * how a guard gets weakened until it means nothing.
 */
function readMainSources(): string {
  const dir = join(here, "../main");
  return readdirSync(dir)
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
    .map((name) => readFileSync(join(dir, name), "utf8"))
    .join("\n");
}

const mainSource = readMainSources();
const preloadSource = readFileSync(join(here, "../preload/index.ts"), "utf8");

/**
 * A channel declared and never wired is a method the renderer can call that
 * rejects at runtime — and TypeScript cannot see it, because `IpcChannel` is
 * just a record of strings and `ipcMain.handle` takes any of them.
 *
 * The FIT training slice added twenty-nine channels in one pass. Nothing in the
 * build would have complained about the thirtieth being forgotten, which is the
 * same shape as the three gates this repository has already watched fail
 * silently in two days: the colour gate's escape hatch, its unimportable
 * module, and a root Vitest config that disabled a package's whole suite. This
 * is the cheap guard that class deserves.
 *
 * It reads SOURCE rather than importing the modules: `main/index.ts` opens a
 * database and creates windows at import time, and `preload/index.ts` needs a
 * live Electron context. Text is what can be checked here, and text is enough
 * for the question being asked.
 */

/**
 * Whether main PUSHES on this channel rather than answering on it —
 * `webContents.send`, which the notification scheduler and the global-capture
 * shortcut use. Derived from the source rather than kept as a hand-written
 * exemption list: a list would have to be edited every time a push channel is
 * added, and the edit that gets forgotten is the one that turns a guard into a
 * formality.
 */
function isPushOnly(key: string): boolean {
  const pattern = new RegExp(String.raw`webContents\.send\(\s*IpcChannel\.${key}\b`);
  return pattern.test(mainSource);
}

/**
 * How many `ipcMain.handle` registrations name this channel. The argument list
 * is allowed to wrap — the longer handlers put the channel on its own line —
 * so the pattern spans whitespace rather than assuming one line, which is a
 * mistake that would have exempted two dozen real handlers and quietly turned
 * this whole file into a formality.
 */
function handlerCount(key: string): number {
  const pattern = new RegExp(String.raw`ipcMain\.handle\(\s*IpcChannel\.${key}\b`, "g");
  return mainSource.match(pattern)?.length ?? 0;
}

describe("the IPC channel list", () => {
  it("has no two channels sharing a wire name", () => {
    const values = Object.values(IpcChannel);
    expect(new Set(values).size).toBe(values.length);
  });

  it("wires every channel in main — answered, or pushed, and never neither", () => {
    const unwired = Object.keys(IpcChannel).filter(
      (key) => handlerCount(key) === 0 && !isPushOnly(key),
    );
    expect(unwired).toEqual([]);
  });

  it("never both answers and pushes on one channel", () => {
    // Two directions on one wire name is how a caller ends up unsure whether a
    // reply is coming.
    const both = Object.keys(IpcChannel).filter(
      (key) => handlerCount(key) > 0 && isPushOnly(key),
    );
    expect(both).toEqual([]);
  });

  it("registers no handler twice", () => {
    const duplicated = Object.keys(IpcChannel).filter((key) => handlerCount(key) > 1);
    expect(duplicated).toEqual([]);
  });

  it("reaches every channel from the preload bridge", () => {
    const unreachable = Object.keys(IpcChannel).filter(
      (key) => !preloadSource.includes(`IpcChannel.${key}`),
    );
    expect(unreachable).toEqual([]);
  });

  it("keeps the bridge free of any generic passthrough (SEC-EL)", () => {
    // One method per channel, and the channel named literally at each one. A
    // bridge that took a channel as an ARGUMENT would hand the renderer the
    // whole surface through a single hole.
    expect(preloadSource).not.toMatch(/ipcRenderer\.invoke\(\s*channel\b/);
    expect(preloadSource).not.toMatch(/ipcRenderer\.invoke\(\s*[a-z]\w*\s*,/);
  });
});
