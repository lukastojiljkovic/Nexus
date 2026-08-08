import { describe, expect, it } from "vitest";
import { NexusApiNotConnectedError, OBJECT_PROTOTYPE_MEMBER_NAMES, nexus } from "../src/api.js";

/**
 * How the seam REFUSES, which is the only behaviour it has today.
 *
 * These are not tests of a stub for its own sake. Each one pins a decision that
 * would otherwise be invisible until a real page was ported and broke in a way
 * that pointed somewhere else: whether a refusal arrives as a rejection or a
 * throw, whether the object survives being awaited, and whether reading a method
 * twice gives the same function. All three are answered by the `get` trap, and
 * none of them is visible in the type.
 */
describe("the not-connected NexusApi", () => {
  it("REJECTS a request method rather than throwing", async () => {
    // The distinction the whole dispatch rule exists for. `listProfiles()` must
    // hand back a promise — calling it must not throw — because the desktop
    // chains `.catch(…)` straight onto calls like this one.
    const pending = nexus.listProfiles();
    expect(pending).toBeInstanceOf(Promise);
    await expect(pending).rejects.toBeInstanceOf(NexusApiNotConnectedError);
  });

  it("is catchable the way the desktop already writes it", async () => {
    // Verbatim the shape found in apps/desktop's renderer:
    // `window.nexus.setActiveProfile(id).catch((error: unknown) => …)`.
    // A synchronous throw would sail straight past this `.catch`.
    let caught: unknown = null;
    await nexus.setActiveProfile("p1").catch((error: unknown) => {
      caught = error;
    });
    expect(caught).toBeInstanceOf(NexusApiNotConnectedError);
  });

  it("names the method that was called", async () => {
    await expect(nexus.listTasks("p1")).rejects.toMatchObject({ method: "listTasks" });
    // And says so in Serbian, because an error that reaches an error boundary is
    // copy whether it was meant to be or not.
    await expect(nexus.listTasks("p1")).rejects.toThrow(/nije povezan/);
  });

  it("THROWS from a subscription, where the caller stands", () => {
    // The opposite refusal, and for the opposite reason: `onGlobalCapture`
    // returns an unsubscribe function. Handing back a promise instead would put
    // the failure in a `useEffect` cleanup on unmount, with nothing pointing at
    // the line that subscribed.
    expect(() => nexus.onGlobalCapture(() => undefined)).toThrow(NexusApiNotConnectedError);
    expect(() => nexus.onWindowStateChanged(() => undefined)).toThrow(
      NexusApiNotConnectedError,
    );
  });

  it("hands back the same function every time a method is read", () => {
    // React compares callbacks by identity. A proxy that minted a fresh function
    // per property access would make `[nexus.listTasks]` a new dependency on
    // every render, and the effect holding it would re-run forever — a symptom
    // that looks like an infinite loop and not like an unwired app.
    expect(nexus.listTasks).toBe(nexus.listTasks);
  });

  it("is not a thenable", async () => {
    // `await nexus` — or returning it from an async function — makes the promise
    // machinery read `.then` and CALL it if it is a function. The object must
    // therefore answer `undefined` there, or an accidental await turns into a
    // rejection blaming a method nobody wrote.
    expect((nexus as unknown as Record<string, unknown>)["then"]).toBeUndefined();
    await expect(Promise.resolve(nexus)).resolves.toBe(nexus);
  });

  it("answers nothing for a symbol", () => {
    // Symbols are the runtime asking questions ABOUT the object — string
    // coercion, spreading, DevTools' probes — never `NexusApi` members. A
    // throwing function here turns a `console.log` into a crash.
    const asRecord = nexus as unknown as Record<symbol, unknown>;
    expect(asRecord[Symbol.toPrimitive]).toBeUndefined();
    expect(asRecord[Symbol.iterator]).toBeUndefined();
  });

  it("names Object.prototype exactly, so the fall-through proof is total", () => {
    // `_NoMemberIsShadowedByTheFallThrough` proves no `NexusApi` member is named
    // any of these. That proof is worth exactly as much as the list is complete,
    // and the list was NOT complete when it was written — the four `__…__`
    // accessors were missing, so the assertion silently said nothing about a
    // member called `__defineGetter__`. Nothing in TypeScript can check a
    // hand-written union against a runtime object, so this is where it happens.
    expect([...OBJECT_PROTOTYPE_MEMBER_NAMES].sort()).toEqual(
      Object.getOwnPropertyNames(Object.prototype).sort(),
    );
  });

  it("is not answered by a prototype-pollution gadget", async () => {
    // THE DEFECT THIS PINS, demonstrated before it was fixed: the trap decided
    // „is this a member?" with `Reflect.has(target, name)`, and `Reflect.has`
    // consults the prototype CHAIN. So a single polluted key —
    // `Object.prototype.listProfiles = () => Promise.resolve([…])` — made the
    // trap classify a real API method as „something a plain object already
    // answers", delegate to it, and hand the attacker's function back AS the
    // method. No error, no refusal: a page believed it had the user's profiles.
    //
    // Not hypothetical in this repository. pnpm-workspace.yaml carries three
    // lodash prototype-pollution advisories (GHSA-r5fr-rjxr-66jc and friends)
    // that arrive SHIPPED, through Excalidraw, and are held off by an override
    // rather than by the dependency having been fixed.
    const polluted = Object.prototype as unknown as Record<string, unknown>;
    try {
      polluted["listProfiles"] = (): Promise<unknown> =>
        Promise.resolve([{ id: "attacker", name: "pwned" }]);
      await expect(nexus.listProfiles()).rejects.toBeInstanceOf(NexusApiNotConnectedError);
    } finally {
      delete polluted["listProfiles"];
    }
  });

  it("cannot have a method replaced by assignment", () => {
    // The desktop's half of this contract is a FROZEN preload bridge (SEC-EL).
    // The browser is the more hostile of the two runtimes, so the seam must not
    // be the more permissive of the two objects. Before this, assigning to a
    // method wrote through to the proxy's target and every later read returned
    // the written function — the refusal simply stopped happening.
    expect(() => {
      (nexus as unknown as Record<string, unknown>)["listProfiles"] = () => Promise.resolve([]);
    }).toThrow(TypeError);
    expect(Object.isFrozen(nexus)).toBe(true);
  });

  it("survives being printed, coerced and serialised", () => {
    // THE REGRESSION THIS EXISTS FOR. The first version of the proxy guarded
    // symbols and `then` and stopped there, so `toString` and `valueOf` — which
    // every object has and which string coercion reads BY NAME, not by symbol —
    // were answered as if they were methods. `String(nexus)` then got a function
    // returning a rejected promise, failed to coerce it to a primitive, and
    // threw „Cannot convert object to primitive value" while leaving two
    // unhandled rejections behind. From a `console.log`.
    expect(String(nexus)).toBe("[object Object]");
    expect(`${String(nexus)}`).toBe("[object Object]");
    expect(Object.prototype.hasOwnProperty.call(nexus, "listTasks")).toBe(false);
    expect(JSON.stringify(nexus)).toBe("{}");
  });
});
