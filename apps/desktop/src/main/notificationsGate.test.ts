import { describe, expect, it, vi } from "vitest";
import type { NotificationSchedulerDeps } from "./notifications.js";

// The scheduler module needs Electron only for the OS toast and the resume
// hook — neither is under test here, so both are stubbed just far enough for
// the module to load and for `showNotifications` to no-op.
vi.mock("electron", () => ({
  Notification: class {
    static isSupported(): boolean {
      return false;
    }
  },
  powerMonitor: { on: vi.fn(), removeListener: vi.fn() },
}));

const { runNotificationCheck } = await import("./notifications.js");

/**
 * ADR-058 (NTF active-profile rule): the check loop serves the ACTIVE profile
 * only. Pinned through the first thing `checkProfile` does per profile —
 * `planStore(profileId).syncAll` — so the assertion is "whose stores were
 * touched at all", not an implementation detail of delivery. Everything
 * downstream is exercised with empty data: no candidates, nothing recorded.
 */
function makeDeps(profileIds: readonly string[], activeId: string | null) {
  const checkedProfiles: string[] = [];
  const emptySettings = {
    quietFrom: null,
    quietTo: null,
    morningHour: "08:00",
    enabledSources: [],
    snoozeDefault: "1h",
    appetiteAsked: true,
  };
  const deps = {
    listProfiles: () => profileIds.map((id) => ({ id })),
    activeProfileId: () => activeId,
    planStore: (profileId: string) => ({
      syncAll: () => {
        checkedProfiles.push(profileId);
      },
      listBlocksInRange: () => [],
    }),
    notificationStore: () => ({
      getSettings: () => emptySettings,
      listLedgerKeys: () => [],
      dueSnoozed: () => [],
    }),
    documentStore: () => ({ listActive: () => [] }),
    eventStore: () => ({ listActive: () => [] }),
    examStore: () => ({ listActive: () => [] }),
    subjectStore: () => ({ listActive: () => [] }),
    taskStore: () => ({ listActive: () => [] }),
    getMainWindow: () => null,
  } as unknown as NotificationSchedulerDeps;
  return { deps, checkedProfiles };
}

describe("runNotificationCheck — ADR-058 active-profile gating", () => {
  it("checks the active profile and ONLY the active profile", () => {
    const { deps, checkedProfiles } = makeDeps(["personal", "business"], "business");
    runNotificationCheck(deps);
    expect(checkedProfiles).toEqual(["business"]);
  });

  it("follows the active id when it changes between checks — the switch landing's restart serves the entered profile", () => {
    let active = "personal";
    const { deps, checkedProfiles } = makeDeps(["personal", "business"], null);
    (deps as { activeProfileId(): string | null }).activeProfileId = () => active;
    runNotificationCheck(deps);
    active = "business";
    runNotificationCheck(deps);
    expect(checkedProfiles).toEqual(["personal", "business"]);
  });

  it("checks nobody when no profile is active — the defensive floor, unreachable while unlocked", () => {
    const { deps, checkedProfiles } = makeDeps(["personal", "business"], null);
    runNotificationCheck(deps);
    expect(checkedProfiles).toEqual([]);
  });
});
