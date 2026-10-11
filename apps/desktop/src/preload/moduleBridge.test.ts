import { describe, expect, it } from "vitest";
import { contract as timersContract } from "../modules/timers/shared/ipc.js";
import { buildModuleBridge, type ModuleInvoker } from "./moduleBridge.js";

/**
 * The preload's half of the module kit (ADR-090): the bridge is built from the
 * DISCOVERED contracts and nothing else.
 *
 * The rule the module kit exists to make structural is pinned here: there is no
 * generic `invoke(channel)` on the exposed surface, the set of callable channels
 * is exactly the set the discovered modules declared, and the renderer never
 * names a channel at all — it calls an op and the module's own declaration
 * decides where that lands. A bridge that took a channel as an argument would
 * hand the renderer the whole main-process surface through one hole, which is
 * the thing SEC-EL-02 exists to prevent.
 */

/** A double that records what it was asked for, which is the only way "exactly these channels" can be checked. */
function recorder(): { invoker: ModuleInvoker; calls: { channel: string; payload: unknown }[] } {
  const calls: { channel: string; payload: unknown }[] = [];
  return {
    calls,
    invoker: {
      invoke: (channel, payload) => {
        calls.push({ channel, payload });
        return Promise.resolve({ recorded: channel });
      },
    },
  };
}

describe("buildModuleBridge", () => {
  it("exposes one frozen namespace per discovered contract, with exactly its declared ops", () => {
    const { invoker } = recorder();
    const modules = buildModuleBridge(invoker) as unknown as Record<
      string,
      Record<string, (payload: unknown) => Promise<unknown>>
    >;

    // The build discovers at least this one, and the namespace is keyed by the
    // id the module's own contract declares — never by a path.
    expect(Object.keys(modules)).toContain("timers");
    expect(Object.keys(modules.timers ?? {}).sort()).toEqual([...timersContract.ops].sort());
    expect(Object.isFrozen(modules)).toBe(true);
    expect(Object.isFrozen(modules.timers)).toBe(true);
  });

  it("lands every call on the channel its own op declares, and on no other", async () => {
    const { invoker, calls } = recorder();
    const modules = buildModuleBridge(invoker) as unknown as {
      timers: {
        createCountdown(payload: unknown): Promise<unknown>;
        removePreset(payload: unknown): Promise<unknown>;
      };
    };

    await modules.timers.createCountdown({ profileId: "p-1", name: "Kafa", durationSeconds: 240 });
    await modules.timers.removePreset({ profileId: "p-1", id: "preset-1" });

    expect(calls).toEqual([
      {
        channel: "timers:createCountdown",
        payload: { profileId: "p-1", name: "Kafa", durationSeconds: 240 },
      },
      { channel: "timers:removePreset", payload: { profileId: "p-1", id: "preset-1" } },
    ]);
    // The whole point, stated as an assertion: the renderer has no way to name a
    // channel of its own.
    for (const op of Object.keys(modules.timers)) {
      expect(op, op).not.toBe("invoke");
    }
  });

  it("is derived from the discovery, so every channel it can reach begins with its module's own id", async () => {
    const { invoker, calls } = recorder();
    const modules = buildModuleBridge(invoker) as unknown as Record<
      string,
      Record<string, (payload: unknown) => Promise<unknown>>
    >;

    for (const [moduleId, api] of Object.entries(modules)) {
      for (const [op, method] of Object.entries(api)) {
        await method(null);
        expect(calls[calls.length - 1]?.channel, `${moduleId}:${op}`).toBe(`${moduleId}:${op}`);
      }
    }
  });
});
