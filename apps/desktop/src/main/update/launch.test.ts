import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";

import { createInstallerLauncher, type InstallerLaunchDeps } from "./launch.js";

/**
 * What these tests are FOR, in one sentence: the installer's command line is a
 * decision written down in source, and this file is what asserts it.
 *
 * No installer exists on this machine, so `deps.spawn` is injected and every
 * case drives the function the application really calls. The distinction that
 * carries the weight is WHEN the answer arrives: the service quits the app on an
 * empty answer, so answering before the OS has said the process exists would be
 * the app closing over an installer that was never started.
 *
 * The fake is cast to `InstallerLaunchDeps["spawn"]` rather than the test
 * importing `node:child_process` for its type, which is also why this file needs
 * no exemption in `scripts/check-runner.mjs`: a test that spawns nothing should
 * not have to be on the list of files that may.
 */

/** A child that does nothing until a test tells it to, and remembers how it was started. */
class FakeChild extends EventEmitter {
  unrefCalls = 0;

  unref(): void {
    this.unrefCalls += 1;
  }

  /** The OS started it — `spawn`'s own event, which is the one the answer waits for. */
  started(): void {
    this.emit("spawn");
  }

  /** The OS refused it. A program that is not there arrives here, not as an exit status. */
  refused(message: string): void {
    this.emit("error", new Error(message));
  }
}

interface Spawned {
  readonly program: string;
  readonly argv: readonly string[];
  readonly options: Record<string, unknown>;
  readonly child: FakeChild;
}

function harness(options: { throwOnSpawn?: string } = {}): {
  launch: (path: string) => Promise<string>;
  spawned: Spawned[];
} {
  const spawned: Spawned[] = [];
  const spawn = ((program: string, argv: readonly string[], spawnOptions: Record<string, unknown>) => {
    if (options.throwOnSpawn !== undefined) throw new Error(options.throwOnSpawn);
    const child = new FakeChild();
    spawned.push({ program, argv: [...argv], options: spawnOptions, child });
    return child;
  }) as unknown as InstallerLaunchDeps["spawn"];
  return { launch: createInstallerLauncher({ spawn }), spawned };
}

/** A stand-in for the file the service downloaded: the launcher must pass it through untouched. */
const INSTALLER =
  "C:\\Users\\test\\AppData\\Roaming\\Nexus\\updates\\Nexus-Setup-1.5.0-3f2a1b.exe";

describe("the installer launch", () => {
  it("starts the verified file with the arguments that keep the shortcuts and bring the app back", async () => {
    const { launch, spawned } = harness();
    const answer = launch(INSTALLER);

    expect(spawned).toHaveLength(1);
    expect(spawned[0]?.program).toBe(INSTALLER);
    // `--updated` is what keeps the existing shortcuts, and the pin is attached
    // to one; `/S` and `--force-run` are the two conditions the assisted
    // installer needs before it starts the app itself.
    expect(spawned[0]?.argv).toEqual(["--updated", "/S", "--force-run"]);

    spawned[0]?.child.started();
    expect(await answer).toBe("");
  });

  it("detaches it, with no shell and no inherited stdio", () => {
    const { launch, spawned } = harness();
    void launch(INSTALLER);

    const options = spawned[0]?.options ?? {};
    expect(options.detached).toBe(true);
    expect(options.stdio).toBe("ignore");
    expect(options.shell).toBe(false);
  });

  it("answers only once the process exists, because the app quits on the answer", async () => {
    const { launch, spawned } = harness();
    let answer: string | null = null;
    const pending = launch(INSTALLER).then((value) => {
      answer = value;
    });

    await Promise.resolve();
    expect(answer).toBeNull();

    spawned[0]?.child.started();
    await pending;
    expect(answer).toBe("");
  });

  it("lets the installer outlive this process", async () => {
    const { launch, spawned } = harness();
    const answer = launch(INSTALLER);
    spawned[0]?.child.started();
    await answer;

    expect(spawned[0]?.child.unrefCalls).toBe(1);
  });

  it("hands back the OS's own message when the process could not be started", async () => {
    const { launch, spawned } = harness();
    const answer = launch(INSTALLER);
    spawned[0]?.child.refused(`spawn ${INSTALLER} ENOENT`);
    expect(await answer).toContain("ENOENT");
  });

  it("hands back the message when the spawn call itself threw", async () => {
    const { launch, spawned } = harness({ throwOnSpawn: "spawn refused" });
    expect(await launch(INSTALLER)).toBe("spawn refused");
    expect(spawned).toHaveLength(0);
  });
});
