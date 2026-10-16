import { describe, expect, it } from "vitest";
import type { ConfirmRequest, Tool, ToolContext } from "@nexus/core";
import type { FocusSession, RunningFocusSession } from "../../../shared/ipc.js";
import { focusTools, type FocusHost } from "./focus.js";

/**
 * The FOCUS tools over a HOST that keeps one running phase per profile, the way
 * main's timer does. The host's own persistence (one row on stop, none on cancel)
 * lives in `main/index.ts` and is exercised there; these tests pin what the tools
 * ask of it: a refused second start, a declined confirmation that leaves the phase
 * alone, and one host call per confirmed act.
 */

const NOW_MS = new Date(2026, 9, 16, 9, 0, 0).getTime();
const NOW_ISO = new Date(NOW_MS).toISOString();
const PROFILE = "profile-1";

interface Calls {
  readonly starts: unknown[];
  stops: number;
  cancels: number;
  pauses: number;
  resumes: number;
}

function hostWith(initial: RunningFocusSession | null): { host: FocusHost; calls: Calls; current: () => RunningFocusSession | null } {
  let phase: RunningFocusSession | null = initial;
  const calls: Calls = { starts: [], stops: 0, cancels: 0, pauses: 0, resumes: 0 };
  const host: FocusHost = {
    start: (_profileId, body) => {
      calls.starts.push(body);
      phase = {
        subjectId: null,
        startedAt: NOW_ISO,
        kind: "work",
        plannedMinutes: typeof body.plannedMinutes === "number" ? body.plannedMinutes : null,
        cycleIndex: 0,
        taskId: null,
        label: typeof body.label === "string" ? body.label : null,
        pausedAt: null,
        pausedSeconds: 0,
      };
      return phase;
    },
    stop: () => {
      calls.stops += 1;
      phase = null;
      return {
        id: "focus-1",
        profileId: PROFILE,
        subjectId: null,
        startedAt: NOW_ISO,
        endedAt: new Date(NOW_MS + 18 * 60_000).toISOString(),
        kind: "work",
        plannedMinutes: 25,
        pausedSeconds: 0,
        outcome: "stopped",
        cycleIndex: 0,
        taskId: null,
        label: null,
      } as FocusSession;
    },
    cancel: () => {
      calls.cancels += 1;
      phase = null;
    },
    pause: () => {
      calls.pauses += 1;
      if (phase !== null) phase = { ...phase, pausedAt: NOW_ISO };
      return phase as RunningFocusSession;
    },
    resume: () => {
      calls.resumes += 1;
      if (phase !== null) phase = { ...phase, pausedAt: null };
      return phase as RunningFocusSession;
    },
    status: () => phase,
  };
  return { host, calls, current: () => phase };
}

function running(overrides: Partial<RunningFocusSession> = {}): RunningFocusSession {
  return {
    subjectId: null,
    startedAt: new Date(NOW_MS - 5 * 60_000).toISOString(),
    kind: "work",
    plannedMinutes: 25,
    cycleIndex: 0,
    taskId: null,
    label: null,
    pausedAt: null,
    pausedSeconds: 0,
    ...overrides,
  };
}

function toolsFor(host: FocusHost): readonly Tool[] {
  return focusTools({ focus: host, now: () => NOW_MS });
}

function toolOf(tools: readonly Tool[], name: string): Tool {
  const found = tools.find((tool) => tool.name === name);
  if (found === undefined) throw new Error(`Test setup: no tool "${name}".`);
  return found;
}

function contextFor(locale: "sr" | "en", allow: boolean): { context: ToolContext; confirms: ConfirmRequest[] } {
  const confirms: ConfirmRequest[] = [];
  return {
    confirms,
    context: {
      profileId: PROFILE,
      locale,
      signal: new AbortController().signal,
      confirm: (request) => {
        confirms.push(request);
        return Promise.resolve(allow);
      },
    },
  };
}

describe("focus.status", () => {
  it("says so when no phase runs", async () => {
    const { host } = hostWith(null);
    const result = await toolOf(toolsFor(host), "focus.status").run({}, contextFor("en", true).context);
    expect(result).toEqual({ ok: true, content: "No focus phase is running right now." });
  });

  it("states the phase, its plan and the time left", async () => {
    const { host } = hostWith(running());
    const result = await toolOf(toolsFor(host), "focus.status").run({}, contextFor("en", true).context);
    expect(result.ok).toBe(true);
    expect(result.content).toContain("planned for");
    expect(result.content).toContain("left");
  });
});

describe("focus.start", () => {
  it("asks in the user's language, then starts the phase through the host", async () => {
    const { host, calls } = hostWith(null);
    const recorder = contextFor("sr", true);
    const result = await toolOf(toolsFor(host), "focus.start").run(
      { minutes: 25, label: "Seminarski" },
      recorder.context,
    );
    expect(recorder.confirms).toEqual([
      { tool: "focus.start", summary: "Pokreni fazu fokusa: rad, 25 min.", effect: "write" },
    ]);
    expect(calls.starts).toEqual([{ kind: "work", plannedMinutes: 25, label: "Seminarski" }]);
    expect(result).toEqual({
      ok: true,
      content: "Pokrenuta faza fokusa: rad, 25 min.",
      navigateTo: { module: "focus" },
    });
  });

  it("refuses a second start before asking, and starts nothing", async () => {
    const { host, calls } = hostWith(running());
    const recorder = contextFor("en", true);
    const result = await toolOf(toolsFor(host), "focus.start").run({ minutes: 25 }, recorder.context);
    expect(result.ok).toBe(false);
    expect(recorder.confirms).toEqual([]);
    expect(calls.starts).toEqual([]);
  });

  it("writes nothing when the user declines", async () => {
    const { host, calls } = hostWith(null);
    const result = await toolOf(toolsFor(host), "focus.start").run({ minutes: 25 }, contextFor("en", false).context);
    expect(result).toEqual({ ok: false, content: "The user declined." });
    expect(calls.starts).toEqual([]);
  });

  it("refuses a plan beyond the store's ceiling with the field named", async () => {
    const { host, calls } = hostWith(null);
    const result = await toolOf(toolsFor(host), "focus.start").run({ minutes: 500 }, contextFor("en", true).context);
    expect(result.ok).toBe(false);
    expect(result.content).toContain("minutes");
    expect(calls.starts).toEqual([]);
  });
});

describe("focus.stop", () => {
  it("stops once, saves the row, and reveals it", async () => {
    const { host, calls } = hostWith(running());
    const result = await toolOf(toolsFor(host), "focus.stop").run({}, contextFor("en", true).context);
    expect(calls.stops).toBe(1);
    expect(calls.cancels).toBe(0);
    expect(result).toEqual({
      ok: true,
      content: "Focus phase stopped and saved (focus-1), 18 min of work.",
      navigateTo: { module: "focus", item: "focus-1" },
    });
  });

  it("discards without saving when asked to", async () => {
    const { host, calls } = hostWith(running());
    const result = await toolOf(toolsFor(host), "focus.stop").run({ discard: true }, contextFor("en", true).context);
    expect(calls.cancels).toBe(1);
    expect(calls.stops).toBe(0);
    expect(result).toEqual({ ok: true, content: "Focus phase cancelled. Nothing was saved." });
  });

  it("leaves a running phase alone when declined", async () => {
    const { host, calls, current } = hostWith(running());
    const result = await toolOf(toolsFor(host), "focus.stop").run({}, contextFor("en", false).context);
    expect(result).toEqual({ ok: false, content: "The user declined." });
    expect(calls.stops).toBe(0);
    expect(current()).not.toBeNull();
  });

  it("refuses when nothing runs", async () => {
    const { host, calls } = hostWith(null);
    const result = await toolOf(toolsFor(host), "focus.stop").run({}, contextFor("en", true).context);
    expect(result.ok).toBe(false);
    expect(calls.stops).toBe(0);
  });
});

describe("focus.pause and focus.resume", () => {
  it("pauses a running phase once confirmed", async () => {
    const { host, calls } = hostWith(running());
    const recorder = contextFor("en", true);
    const result = await toolOf(toolsFor(host), "focus.pause").run({}, recorder.context);
    expect(calls.pauses).toBe(1);
    expect(recorder.confirms.map((request) => request.tool)).toEqual(["focus.pause"]);
    expect(result.ok).toBe(true);
  });

  it("resumes a paused phase", async () => {
    const { host, calls } = hostWith(running({ pausedAt: NOW_ISO }));
    const result = await toolOf(toolsFor(host), "focus.resume").run({}, contextFor("en", true).context);
    expect(calls.resumes).toBe(1);
    expect(result.ok).toBe(true);
  });

  it("refuses to pause when nothing runs", async () => {
    const { host, calls } = hostWith(null);
    const result = await toolOf(toolsFor(host), "focus.pause").run({}, contextFor("en", true).context);
    expect(result.ok).toBe(false);
    expect(calls.pauses).toBe(0);
  });
});
