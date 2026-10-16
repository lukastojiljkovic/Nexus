import { describe, expect, it } from "vitest";
import type { NotificationRecord, NotificationSettings, UpdateNotificationSettingsInput } from "@nexus/db";
import type { ConfirmRequest, Tool, ToolContext } from "@nexus/core";
import { notificationTools, type NotificationsHost, type UpcomingReminder } from "./notifications.js";

/**
 * The notification tools over a HOST that keeps the centre in memory. The host's
 * own writes (the store calls and the `notifications:changed` push, one per write)
 * live in `main/index.ts`; these tests pin what the tools ask of it: names resolved
 * before anything is asked, a declined confirmation that writes nothing, and one
 * host write per confirmed act.
 */

const PROFILE = "profile-1";

function record(overrides: Partial<NotificationRecord> = {}): NotificationRecord {
  return {
    id: "n-1",
    profileId: PROFILE,
    source: "task",
    entityId: "task-1",
    occurrenceKey: "2026-10-16",
    title: "Predaj seminarski",
    body: "danas",
    status: "delivered",
    snoozedUntil: null,
    deliveredAt: "2026-10-16T08:00:00.000Z",
    createdAt: "2026-10-16T08:00:00.000Z",
    updatedAt: "2026-10-16T08:00:00.000Z",
    ...overrides,
  };
}

const SETTINGS: NotificationSettings = {
  quietFrom: "22:00",
  quietTo: "07:00",
  morningHour: "08:00",
  enabledSources: ["document", "task", "event"],
  snoozeDefault: "1h",
  appetiteAsked: true,
};

interface Calls {
  snoozes: { id: string; preset: string | undefined }[];
  dismisses: string[];
  updates: UpdateNotificationSettingsInput[];
  sources: { source: string; enabled: boolean }[];
}

function hostWith(records: NotificationRecord[], upcoming: UpcomingReminder[] = []): { host: NotificationsHost; calls: Calls } {
  const calls: Calls = { snoozes: [], dismisses: [], updates: [], sources: [] };
  const host: NotificationsHost = {
    list: () => records,
    snooze: (_profileId, id, preset) => {
      calls.snoozes.push({ id, preset });
      return record({ id, status: "snoozed", snoozedUntil: "2026-10-16T18:00:00.000Z" });
    },
    dismiss: (_profileId, id) => {
      calls.dismisses.push(id);
    },
    settings: () => SETTINGS,
    updateSettings: (_profileId, changes) => {
      calls.updates.push(changes);
      return SETTINGS;
    },
    setSourceEnabled: (_profileId, source, enabled) => {
      calls.sources.push({ source, enabled });
    },
    upcoming: () => upcoming,
  };
  return { host, calls };
}

function toolsFor(host: NotificationsHost): readonly Tool[] {
  return notificationTools({ notifications: host });
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

describe("notifications.list", () => {
  it("says the centre is empty when it is", async () => {
    const { host } = hostWith([]);
    const result = await toolOf(toolsFor(host), "notifications.list").run({}, contextFor("en", true).context);
    expect(result).toEqual({ ok: true, content: "The notification centre is empty." });
  });

  it("lists each record with its id, and says when a snooze runs", async () => {
    const { host } = hostWith([
      record(),
      record({ id: "n-2", title: "Pasoš", source: "document", status: "snoozed", snoozedUntil: "2026-10-16T18:00:00.000Z" }),
    ]);
    const result = await toolOf(toolsFor(host), "notifications.list").run({}, contextFor("en", true).context);
    expect(result.ok).toBe(true);
    expect(result.content).toContain("- n-1 · task · Predaj seminarski");
    expect(result.content).toContain("- n-2 · document · Pasoš (snoozed until");
  });
});

describe("notifications.snooze", () => {
  it("refuses an id the centre does not hold, before asking", async () => {
    const { host, calls } = hostWith([record()]);
    const recorder = contextFor("en", true);
    const result = await toolOf(toolsFor(host), "notifications.snooze").run({ id: "missing" }, recorder.context);
    expect(result.ok).toBe(false);
    expect(recorder.confirms).toEqual([]);
    expect(calls.snoozes).toEqual([]);
  });

  it("asks with the title, then snoozes with an omitted preset left to the host's default", async () => {
    const { host, calls } = hostWith([record()]);
    const recorder = contextFor("en", true);
    const result = await toolOf(toolsFor(host), "notifications.snooze").run({ id: "n-1" }, recorder.context);
    expect(recorder.confirms).toEqual([
      {
        tool: "notifications.snooze",
        summary: "Snooze the notification “Predaj seminarski” to the default time.",
        effect: "write",
      },
    ]);
    expect(calls.snoozes).toEqual([{ id: "n-1", preset: undefined }]);
    expect(result.ok).toBe(true);
  });

  it("passes a named preset through", async () => {
    const { host, calls } = hostWith([record()]);
    await toolOf(toolsFor(host), "notifications.snooze").run({ id: "n-1", preset: "tonight" }, contextFor("en", true).context);
    expect(calls.snoozes).toEqual([{ id: "n-1", preset: "tonight" }]);
  });

  it("writes nothing when declined", async () => {
    const { host, calls } = hostWith([record()]);
    const result = await toolOf(toolsFor(host), "notifications.snooze").run({ id: "n-1" }, contextFor("en", false).context);
    expect(result).toEqual({ ok: false, content: "The user declined." });
    expect(calls.snoozes).toEqual([]);
  });

  it("refuses a preset outside the four the centre offers", async () => {
    const { host, calls } = hostWith([record()]);
    const result = await toolOf(toolsFor(host), "notifications.snooze").run({ id: "n-1", preset: "next-week" }, contextFor("en", true).context);
    expect(result.ok).toBe(false);
    expect(calls.snoozes).toEqual([]);
  });
});

describe("notifications.dismiss", () => {
  it("removes the named record once, after the confirmation", async () => {
    const { host, calls } = hostWith([record()]);
    const recorder = contextFor("sr", true);
    const result = await toolOf(toolsFor(host), "notifications.dismiss").run({ id: "n-1" }, recorder.context);
    expect(calls.dismisses).toEqual(["n-1"]);
    expect(recorder.confirms[0]?.summary).toBe("Ukloni obaveštenje „Predaj seminarski“ iz centra.");
    expect(result).toEqual({ ok: true, content: "Obaveštenje „Predaj seminarski“ je uklonjeno iz centra." });
  });

  it("refuses an unknown id and writes nothing", async () => {
    const { host, calls } = hostWith([record()]);
    const result = await toolOf(toolsFor(host), "notifications.dismiss").run({ id: "n-9" }, contextFor("en", true).context);
    expect(result.ok).toBe(false);
    expect(calls.dismisses).toEqual([]);
  });
});

describe("notifications.settings", () => {
  it("states the quiet hours, the morning hour and which sources are off", async () => {
    const { host } = hostWith([]);
    const result = await toolOf(toolsFor(host), "notifications.settings").run({}, contextFor("en", true).context);
    expect(result.ok).toBe(true);
    expect(result.content).toContain("quiet hours 22:00–07:00");
    expect(result.content).toContain("morning hour 08:00");
    expect(result.content).toContain("Off: ");
  });
});

describe("notifications.configure", () => {
  it("turns one source's reminders off after confirming, and writes once", async () => {
    const { host, calls } = hostWith([]);
    const recorder = contextFor("en", true);
    const result = await toolOf(toolsFor(host), "notifications.configure").run(
      { source: "habit", enabled: false },
      recorder.context,
    );
    expect(calls.sources).toEqual([{ source: "habit", enabled: false }]);
    expect(calls.updates).toEqual([]);
    expect(recorder.confirms[0]?.summary).toBe("Change notifications: turn off habit reminders.");
    expect(result.ok).toBe(true);
  });

  it("writes the quiet-hours pair together as one patch", async () => {
    const { host, calls } = hostWith([]);
    await toolOf(toolsFor(host), "notifications.configure").run(
      { quietFrom: "23:00", quietTo: "06:30" },
      contextFor("en", true).context,
    );
    expect(calls.updates).toEqual([{ quietFrom: "23:00", quietTo: "06:30" }]);
  });

  it("refuses quiet hours with one end only, writing nothing", async () => {
    const { host, calls } = hostWith([]);
    const result = await toolOf(toolsFor(host), "notifications.configure").run(
      { quietFrom: "23:00" },
      contextFor("en", true).context,
    );
    expect(result.ok).toBe(false);
    expect(calls.updates).toEqual([]);
  });

  it("refuses a source without its switch", async () => {
    const { host, calls } = hostWith([]);
    const result = await toolOf(toolsFor(host), "notifications.configure").run({ source: "habit" }, contextFor("en", true).context);
    expect(result.ok).toBe(false);
    expect(calls.sources).toEqual([]);
  });

  it("refuses a call that names no change at all", async () => {
    const { host } = hostWith([]);
    const result = await toolOf(toolsFor(host), "notifications.configure").run({}, contextFor("en", true).context);
    expect(result.ok).toBe(false);
  });

  it("refuses to switch the always-on security source off", async () => {
    const { host, calls } = hostWith([]);
    const result = await toolOf(toolsFor(host), "notifications.configure").run(
      { source: "security", enabled: false },
      contextFor("en", true).context,
    );
    expect(result.ok).toBe(false);
    expect(calls.sources).toEqual([]);
  });

  it("writes nothing when declined", async () => {
    const { host, calls } = hostWith([]);
    const result = await toolOf(toolsFor(host), "notifications.configure").run(
      { morningHour: "07:30" },
      contextFor("en", false).context,
    );
    expect(result).toEqual({ ok: false, content: "The user declined." });
    expect(calls.updates).toEqual([]);
  });
});

describe("reminders.due", () => {
  it("lists the upcoming reminders with their dates and text", async () => {
    const { host } = hostWith([], [
      { source: "task", fireDate: "2026-10-16", title: "Predaj seminarski", body: "danas" },
    ]);
    const result = await toolOf(toolsFor(host), "reminders.due").run({ days: 2 }, contextFor("en", true).context);
    expect(result.ok).toBe(true);
    expect(result.content).toBe(
      "Reminders for the next 2 days:\n- 2026-10-16 · Predaj seminarski · danas",
    );
  });

  it("says when nothing is due in the window", async () => {
    const { host } = hostWith([]);
    const result = await toolOf(toolsFor(host), "reminders.due").run({}, contextFor("en", true).context);
    expect(result).toEqual({ ok: true, content: "No reminders are due in the next 7 days." });
  });

  it("refuses a window beyond a week", async () => {
    const { host } = hostWith([]);
    const result = await toolOf(toolsFor(host), "reminders.due").run({ days: 30 }, contextFor("en", true).context);
    expect(result.ok).toBe(false);
  });
});
