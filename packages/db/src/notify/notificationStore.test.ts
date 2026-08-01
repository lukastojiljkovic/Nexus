import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NotificationSource } from "@nexus/core";
import {
  DEFAULT_SNOOZE_PRESET,
  NexusDatabase,
  NotificationNotFoundError,
  NotificationStore,
  NotificationValidationError,
  NOTIFICATION_SOURCES,
  openDatabase,
  SNOOZE_PRESETS,
  TOGGLEABLE_NOTIFICATION_SOURCES,
  uuidv7,
} from "../index.js";
import type { SnoozePreset } from "../index.js";

let dir: string;
let db: NexusDatabase;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-notify-"));
  db = openDatabase({ path: join(dir, "notify.db") });
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function createProfile(): string {
  const id = uuidv7();
  db.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(id, "personal", "P", new Date().toISOString());
  return id;
}

function fixture(): { notify: NotificationStore; profileId: string } {
  const profileId = createProfile();
  return { notify: new NotificationStore(db.raw, profileId), profileId };
}

const NOW = "2026-07-10T08:00:00.000Z";

function deliver(
  notify: NotificationStore,
  overrides: Partial<{ entityId: string; occurrenceKey: string; source: NotificationSource }> = {},
) {
  return notify.recordDelivered(
    {
      source: overrides.source ?? "exam",
      entityId: overrides.entityId ?? "exam1",
      occurrenceKey: overrides.occurrenceKey ?? "d-1",
      title: "Ispit sutra",
      body: "Analiza 1 — pismeni",
    },
    NOW,
  );
}

describe("NotificationStore", () => {
  describe("getSettings", () => {
    it("returns defaults when no settings rows exist: no quiet hours, 08:00 morning hour, all sources enabled, 10m snooze, appetite unasked", () => {
      const { notify } = fixture();
      expect(notify.getSettings()).toEqual({
        quietFrom: null,
        quietTo: null,
        morningHour: "08:00",
        enabledSources: ["document", "exam", "study-day", "event", "task", "subscription", "habit"],
        snoozeDefault: "10m",
        appetiteAsked: false,
      });
    });

    it("never writes on read (a second call sees the same defaults)", () => {
      const { notify } = fixture();
      notify.getSettings();
      expect(notify.getSettings().morningHour).toBe("08:00");
    });
  });

  describe("updateSettings", () => {
    it("sets quiet hours and morning hour together, then persists across calls", () => {
      const { notify } = fixture();
      const updated = notify.updateSettings(
        { quietFrom: "22:00", quietTo: "07:00", morningHour: "09:00" },
        NOW,
      );
      expect(updated).toEqual({
        quietFrom: "22:00",
        quietTo: "07:00",
        morningHour: "09:00",
        enabledSources: ["document", "exam", "study-day", "event", "task", "subscription", "habit"],
        snoozeDefault: "10m",
        appetiteAsked: false,
      });
      expect(notify.getSettings().quietFrom).toBe("22:00");
    });

    it("clears quiet hours by setting both to null", () => {
      const { notify } = fixture();
      notify.updateSettings({ quietFrom: "22:00", quietTo: "07:00" }, NOW);
      notify.updateSettings({ quietFrom: null, quietTo: null }, NOW);
      expect(notify.getSettings()).toMatchObject({ quietFrom: null, quietTo: null });
    });

    it("rejects setting exactly one side of the quiet-hours pair", () => {
      const { notify } = fixture();
      expect(() => notify.updateSettings({ quietFrom: "22:00" }, NOW)).toThrow(
        NotificationValidationError,
      );
      notify.updateSettings({ quietFrom: "22:00", quietTo: "07:00" }, NOW);
      expect(() => notify.updateSettings({ quietTo: null }, NOW)).toThrow(
        NotificationValidationError,
      );
    });

    it("rejects a malformed HH:MM for quietFrom/quietTo/morningHour", () => {
      const { notify } = fixture();
      expect(() => notify.updateSettings({ quietFrom: "22:00", quietTo: "25:00" }, NOW)).toThrow(
        NotificationValidationError,
      );
      expect(() => notify.updateSettings({ quietFrom: "9:00", quietTo: "07:00" }, NOW)).toThrow(
        NotificationValidationError,
      );
      expect(() => notify.updateSettings({ morningHour: "8:00" }, NOW)).toThrow(
        NotificationValidationError,
      );
    });

    it("upserts rather than duplicating: a second call updates the same row", () => {
      const { notify } = fixture();
      notify.updateSettings({ morningHour: "09:00" }, NOW);
      notify.updateSettings({ morningHour: "10:00" }, "2026-07-11T08:00:00.000Z");
      expect(notify.getSettings().morningHour).toBe("10:00");
    });

    it("leaves an omitted field untouched", () => {
      const { notify } = fixture();
      notify.updateSettings({ quietFrom: "22:00", quietTo: "07:00" }, NOW);
      notify.updateSettings({ morningHour: "09:00" }, NOW);
      expect(notify.getSettings()).toEqual({
        quietFrom: "22:00",
        quietTo: "07:00",
        morningHour: "09:00",
        enabledSources: ["document", "exam", "study-day", "event", "task", "subscription", "habit"],
        snoozeDefault: "10m",
        appetiteAsked: false,
      });
    });
  });

  /**
   * NTF-009: which preset the center's plain „Odloži“ button means. A
   * preference like any other on this row, so it upserts and defaults exactly
   * as quiet hours do — and it is validated against the closed preset domain,
   * because the renderer is untrusted and the column's own CHECK is the last
   * line, not the first.
   */
  describe("updateSettings — snoozeDefault", () => {
    it("stores each of the four presets and reads it back", () => {
      const { notify } = fixture();
      for (const preset of SNOOZE_PRESETS) {
        expect(notify.updateSettings({ snoozeDefault: preset }, NOW).snoozeDefault).toBe(preset);
        expect(notify.getSettings().snoozeDefault).toBe(preset);
      }
    });

    it("rejects a preset outside the closed set", () => {
      const { notify } = fixture();
      expect(() =>
        notify.updateSettings({ snoozeDefault: "30m" as SnoozePreset }, NOW),
      ).toThrow(NotificationValidationError);
      expect(() => notify.updateSettings({ snoozeDefault: "" as SnoozePreset }, NOW)).toThrow(
        NotificationValidationError,
      );
    });

    it("survives an unrelated settings edit", () => {
      const { notify } = fixture();
      notify.updateSettings({ snoozeDefault: "tonight" }, NOW);
      notify.updateSettings({ quietFrom: "22:00", quietTo: "07:00" }, NOW);
      expect(notify.getSettings().snoozeDefault).toBe("tonight");
    });

    it("is scoped to its own profile", () => {
      const first = fixture();
      const second = fixture();
      first.notify.updateSettings({ snoozeDefault: "1h" }, NOW);
      expect(first.notify.getSettings().snoozeDefault).toBe("1h");
      expect(second.notify.getSettings().snoozeDefault).toBe("10m");
    });

    it("is left alone by markAppetiteAsked, which only closes the question", () => {
      const { notify } = fixture();
      notify.updateSettings({ snoozeDefault: "tomorrow-morning" }, NOW);
      notify.markAppetiteAsked(NOW);
      expect(notify.getSettings().snoozeDefault).toBe("tomorrow-morning");
    });
  });

  describe("SNOOZE_PRESETS", () => {
    it("is the closed preset domain, in the order the center offers them", () => {
      expect(SNOOZE_PRESETS).toEqual(["10m", "1h", "tonight", "tomorrow-morning"]);
    });

    it("starts at the default the shortest preset gives", () => {
      expect(DEFAULT_SNOOZE_PRESET).toBe("10m");
    });
  });

  /**
   * NTF-008 (ADR-033): the one-time "how much should Nexus remind you" ask.
   * The flag records that the question was PUT, not what was answered — so
   * "keep the defaults" and a chosen preset both close it forever.
   */
  describe("markAppetiteAsked", () => {
    it("flips the flag and persists it, from no settings row at all", () => {
      const { notify } = fixture();
      expect(notify.getSettings().appetiteAsked).toBe(false);
      notify.markAppetiteAsked(NOW);
      expect(notify.getSettings().appetiteAsked).toBe(true);
    });

    it("leaves the rest of the settings at their defaults when it writes the first row", () => {
      const { notify } = fixture();
      notify.markAppetiteAsked(NOW);
      expect(notify.getSettings()).toEqual({
        quietFrom: null,
        quietTo: null,
        morningHour: "08:00",
        enabledSources: ["document", "exam", "study-day", "event", "task", "subscription", "habit"],
        snoozeDefault: "10m",
        appetiteAsked: true,
      });
    });

    it("preserves quiet hours and the morning hour when a settings row already exists", () => {
      const { notify } = fixture();
      notify.updateSettings({ quietFrom: "22:00", quietTo: "07:00", morningHour: "09:00" }, NOW);
      notify.markAppetiteAsked(NOW);
      expect(notify.getSettings()).toEqual({
        quietFrom: "22:00",
        quietTo: "07:00",
        morningHour: "09:00",
        enabledSources: ["document", "exam", "study-day", "event", "task", "subscription", "habit"],
        snoozeDefault: "10m",
        appetiteAsked: true,
      });
    });

    it("is idempotent and upserts rather than duplicating the row", () => {
      const { notify, profileId } = fixture();
      notify.markAppetiteAsked(NOW);
      notify.markAppetiteAsked("2026-07-11T08:00:00.000Z");
      expect(notify.getSettings().appetiteAsked).toBe(true);
      expect(
        (
          db.raw
            .prepare("SELECT count(*) AS n FROM ntf_settings WHERE profile_id = ?")
            .get(profileId) as { n: number }
        ).n,
      ).toBe(1);
    });

    it("survives a later settings edit — the question is asked once, ever", () => {
      const { notify } = fixture();
      notify.markAppetiteAsked(NOW);
      notify.updateSettings({ morningHour: "10:00" }, NOW);
      expect(notify.getSettings().appetiteAsked).toBe(true);
      expect(notify.updateSettings({ morningHour: "11:00" }, NOW).appetiteAsked).toBe(true);
    });

    it("is scoped to its own profile", () => {
      const first = fixture();
      const second = fixture();
      first.notify.markAppetiteAsked(NOW);
      expect(first.notify.getSettings().appetiteAsked).toBe(true);
      expect(second.notify.getSettings().appetiteAsked).toBe(false);
    });

    it("rejects a malformed now", () => {
      const { notify } = fixture();
      expect(() => notify.markAppetiteAsked("2026-07-10")).toThrow(NotificationValidationError);
    });
  });

  describe("setSourceEnabled", () => {
    it("disables and re-enables a source, reflected in getSettings().enabledSources", () => {
      const { notify } = fixture();
      notify.setSourceEnabled("exam", false, NOW);
      expect(notify.getSettings().enabledSources).toEqual(["document", "study-day", "event", "task", "subscription", "habit"]);

      notify.setSourceEnabled("exam", true, NOW);
      expect(notify.getSettings().enabledSources).toEqual(["document", "exam", "study-day", "event", "task", "subscription", "habit"]);
    });

    it("upserts rather than duplicating on repeated toggles", () => {
      const { notify } = fixture();
      notify.setSourceEnabled("document", false, NOW);
      notify.setSourceEnabled("document", false, NOW);
      notify.setSourceEnabled("document", true, NOW);
      expect(notify.getSettings().enabledSources).toEqual(["document", "exam", "study-day", "event", "task", "subscription", "habit"]);
    });

    it("rejects a source outside the closed set", () => {
      const { notify } = fixture();
      expect(() =>
        notify.setSourceEnabled("bogus" as never, false, NOW),
      ).toThrow(NotificationValidationError);
    });

    it("toggles the event source added by migration 019 (CAL-006) like any other", () => {
      const { notify } = fixture();
      notify.setSourceEnabled("event", false, NOW);
      expect(notify.getSettings().enabledSources).toEqual(["document", "exam", "study-day", "task", "subscription", "habit"]);

      notify.setSourceEnabled("event", true, NOW);
      expect(notify.getSettings().enabledSources).toEqual(["document", "exam", "study-day", "event", "task", "subscription", "habit"]);
    });

    it("toggles the task source added by migration 021 (ADR-028) like any other", () => {
      const { notify } = fixture();
      notify.setSourceEnabled("task", false, NOW);
      expect(notify.getSettings().enabledSources).toEqual(["document", "exam", "study-day", "event", "subscription", "habit"]);

      notify.setSourceEnabled("task", true, NOW);
      expect(notify.getSettings().enabledSources).toEqual(["document", "exam", "study-day", "event", "task", "subscription", "habit"]);
    });

    it("refuses the always-on security source in BOTH directions (NTF-007)", () => {
      const { notify } = fixture();
      // Off is the one that matters; on is refused too, because accepting it
      // would write a preference row for something that has no preference.
      expect(() => notify.setSourceEnabled("security", false, NOW)).toThrow(
        NotificationValidationError,
      );
      expect(() => notify.setSourceEnabled("security", true, NOW)).toThrow(
        NotificationValidationError,
      );
      expect(notify.getSettings().enabledSources).toEqual([
        "document",
        "exam",
        "study-day",
        "event",
        "task",
        "subscription",
        "habit",
      ]);
    });
  });

  describe("the always-on security source (NTF-007)", () => {
    it("is a ledger source but never an appetite one", () => {
      expect(NOTIFICATION_SOURCES).toContain("security");
      expect(TOGGLEABLE_NOTIFICATION_SOURCES).not.toContain("security");
      expect(TOGGLEABLE_NOTIFICATION_SOURCES).toEqual([
        "document",
        "exam",
        "study-day",
        "event",
        "task",
        "subscription",
        "habit",
      ]);
    });

    it("records and reads back a security row, center and ledger alike", () => {
      const { notify } = fixture();
      const record = notify.recordDelivered(
        {
          source: "security",
          entityId: "passcode-changed",
          occurrenceKey: "2026-07-10T08:00:00.000Z",
          title: "PIN je promenjen",
          body: "Otključavanje sada traži novi PIN.",
        },
        NOW,
      );
      expect(record).toMatchObject({ source: "security", status: "delivered", deliveredAt: NOW });
      expect(notify.listLedgerKeys()).toContainEqual({
        source: "security",
        entityId: "passcode-changed",
        occurrenceKey: "2026-07-10T08:00:00.000Z",
        status: "delivered",
      });
      expect(notify.listCenter().map((row) => row.source)).toContain("security");
      expect(notify.listAll().map((row) => row.source)).toContain("security");
    });

    it("keeps two security events of the same kind apart by their instants", () => {
      const { notify } = fixture();
      const record = (occurrenceKey: string) =>
        notify.recordDelivered(
          {
            source: "security",
            entityId: "recovery-kit-reissued",
            occurrenceKey,
            title: "Izdat je novi Recovery Kit",
            body: "Stari kod više ne važi.",
          },
          NOW,
        );
      record("2026-07-10T08:00:00.000Z");
      expect(() => record("2026-07-10T09:30:00.000Z")).not.toThrow();
      // ...and the same instant is still the same occurrence.
      expect(() => record("2026-07-10T09:30:00.000Z")).toThrow(NotificationValidationError);
      expect(notify.listAll()).toHaveLength(2);
    });
  });

  describe("recordDelivered", () => {
    it("persists a delivered notification with delivered_at = now", () => {
      const { notify } = fixture();
      const record = deliver(notify);
      expect(record).toMatchObject({
        source: "exam",
        entityId: "exam1",
        occurrenceKey: "d-1",
        title: "Ispit sutra",
        body: "Analiza 1 — pismeni",
        status: "delivered",
        snoozedUntil: null,
        deliveredAt: NOW,
        createdAt: NOW,
        updatedAt: NOW,
      });
      expect(record.id).toBeTruthy();
    });

    it("round-trips a ledger row whose source is 'event' (CAL-006), occurrence key and all", () => {
      const { notify } = fixture();
      const record = deliver(notify, {
        source: "event",
        entityId: "event1",
        occurrenceKey: "2026-08-01 15",
      });
      expect(record).toMatchObject({
        source: "event",
        entityId: "event1",
        occurrenceKey: "2026-08-01 15",
      });
      expect(notify.listLedgerKeys()).toContainEqual({
        source: "event",
        entityId: "event1",
        occurrenceKey: "2026-08-01 15",
        status: "delivered",
      });
    });

    it("round-trips a ledger row whose source is 'task' (ADR-028), due-date-keyed occurrence and all", () => {
      const { notify } = fixture();
      const record = deliver(notify, {
        source: "task",
        entityId: "task1",
        occurrenceKey: "2026-08-10 3",
      });
      expect(record).toMatchObject({
        source: "task",
        entityId: "task1",
        occurrenceKey: "2026-08-10 3",
      });
      expect(notify.listLedgerKeys()).toContainEqual({
        source: "task",
        entityId: "task1",
        occurrenceKey: "2026-08-10 3",
        status: "delivered",
      });
    });

    it("rejects an empty or over-500-char title/body", () => {
      const { notify } = fixture();
      expect(() =>
        notify.recordDelivered(
          { source: "exam", entityId: "e1", occurrenceKey: "d-1", title: "", body: "b" },
          NOW,
        ),
      ).toThrow(NotificationValidationError);
      expect(() =>
        notify.recordDelivered(
          { source: "exam", entityId: "e1", occurrenceKey: "d-1", title: "a".repeat(501), body: "b" },
          NOW,
        ),
      ).toThrow(NotificationValidationError);
    });

    it("rejects a malformed now", () => {
      const { notify } = fixture();
      expect(() =>
        notify.recordDelivered(
          { source: "exam", entityId: "e1", occurrenceKey: "d-1", title: "t", body: "b" },
          "not-a-date",
        ),
      ).toThrow(NotificationValidationError);
    });

    it("rejects a source outside the closed set", () => {
      const { notify } = fixture();
      expect(() =>
        notify.recordDelivered(
          { source: "bogus" as never, entityId: "e1", occurrenceKey: "d-1", title: "t", body: "b" },
          NOW,
        ),
      ).toThrow(NotificationValidationError);
    });

    it("surfaces a UNIQUE(profile, source, entity, occurrence) collision as NotificationValidationError", () => {
      const { notify } = fixture();
      deliver(notify);
      expect(() => deliver(notify)).toThrow(NotificationValidationError);
    });

    it("allows the same occurrence again for a different profile", () => {
      const a = fixture();
      const b = fixture();
      deliver(a.notify);
      expect(() => deliver(b.notify)).not.toThrow();
    });
  });

  describe("listLedgerKeys", () => {
    it("lists every ledger entry for this profile with its current status", () => {
      const { notify } = fixture();
      const r1 = deliver(notify, { entityId: "exam1", occurrenceKey: "d-1" });
      deliver(notify, { entityId: "exam1", occurrenceKey: "d-0" });
      notify.dismiss(r1.id, NOW);

      const keys = notify.listLedgerKeys();
      expect(keys).toEqual([
        { source: "exam", entityId: "exam1", occurrenceKey: "d-0", status: "delivered" },
        { source: "exam", entityId: "exam1", occurrenceKey: "d-1", status: "dismissed" },
      ]);
    });

    it("isolates the ledger between profiles", () => {
      const a = fixture();
      const b = fixture();
      deliver(a.notify);
      expect(b.notify.listLedgerKeys()).toEqual([]);
    });
  });

  describe("dueSnoozed", () => {
    it("returns snoozed rows whose snoozed_until is at or before now, excluding others", () => {
      const { notify } = fixture();
      const snoozed = deliver(notify, { entityId: "exam1", occurrenceKey: "d-1" });
      const stillFuture = deliver(notify, { entityId: "exam1", occurrenceKey: "d-0" });
      deliver(notify, { entityId: "exam2", occurrenceKey: "d-1" }); // left delivered, never snoozed

      notify.snooze(snoozed.id, "2026-07-10T09:00:00.000Z", NOW);
      notify.snooze(stillFuture.id, "2026-07-11T09:00:00.000Z", NOW);

      const due = notify.dueSnoozed("2026-07-10T09:00:00.000Z");
      expect(due.map((r) => r.id)).toEqual([snoozed.id]);
    });
  });

  describe("snooze / markRefired / dismiss lifecycle", () => {
    it("snoozes a delivered notification, then re-fires it back to delivered", () => {
      const { notify } = fixture();
      const record = deliver(notify);

      const snoozed = notify.snooze(record.id, "2026-07-10T09:00:00.000Z", NOW);
      expect(snoozed).toMatchObject({ status: "snoozed", snoozedUntil: "2026-07-10T09:00:00.000Z" });

      const refired = notify.markRefired(record.id, "2026-07-10T09:00:00.000Z");
      expect(refired).toMatchObject({
        status: "delivered",
        snoozedUntil: null,
        deliveredAt: "2026-07-10T09:00:00.000Z",
      });
    });

    it("rejects an until that is not strictly after now", () => {
      const { notify } = fixture();
      const record = deliver(notify);
      expect(() => notify.snooze(record.id, NOW, NOW)).toThrow(NotificationValidationError);
      expect(() =>
        notify.snooze(record.id, "2026-07-10T07:00:00.000Z", NOW),
      ).toThrow(NotificationValidationError);
    });

    it("throws NotificationNotFoundError snoozing an unknown or cross-profile id", () => {
      const a = fixture();
      const b = fixture();
      const record = deliver(b.notify);
      expect(() => a.notify.snooze("missing", "2026-07-10T09:00:00.000Z", NOW)).toThrow(
        NotificationNotFoundError,
      );
      expect(() => a.notify.snooze(record.id, "2026-07-10T09:00:00.000Z", NOW)).toThrow(
        NotificationNotFoundError,
      );
    });

    it("throws NotificationNotFoundError re-firing a row that is not currently snoozed", () => {
      const { notify } = fixture();
      const record = deliver(notify);
      expect(() => notify.markRefired(record.id, NOW)).toThrow(NotificationNotFoundError);
      expect(() => notify.markRefired("missing", NOW)).toThrow(NotificationNotFoundError);
    });

    it("dismisses a notification, terminally", () => {
      const { notify } = fixture();
      const record = deliver(notify);
      notify.dismiss(record.id, NOW);
      expect(notify.listCenter()[0]).toMatchObject({ id: record.id, status: "dismissed" });
    });

    it("treats dismissing an already-dismissed row as a no-op, not an error", () => {
      const { notify } = fixture();
      const record = deliver(notify);
      notify.dismiss(record.id, NOW);
      expect(() => notify.dismiss(record.id, "2026-07-11T08:00:00.000Z")).not.toThrow();
      // the second dismiss did not re-stamp updated_at.
      expect(notify.listCenter()[0]).toMatchObject({ updatedAt: NOW });
    });

    it("throws NotificationNotFoundError dismissing an unknown or cross-profile id", () => {
      const a = fixture();
      const b = fixture();
      const record = deliver(b.notify);
      expect(() => a.notify.dismiss("missing", NOW)).toThrow(NotificationNotFoundError);
      expect(() => a.notify.dismiss(record.id, NOW)).toThrow(NotificationNotFoundError);
    });

    it("refuses to snooze a dismissed row — dismissal is terminal", () => {
      const { notify } = fixture();
      const record = deliver(notify);
      notify.dismiss(record.id, NOW);
      expect(() =>
        notify.snooze(record.id, "2026-07-10T10:00:00.000Z", "2026-07-10T09:00:00.000Z"),
      ).toThrow(NotificationNotFoundError);
      expect(notify.listCenter()[0]).toMatchObject({ id: record.id, status: "dismissed" });
    });
  });

  describe("listCenter", () => {
    it("returns every status, newest updated_at first", () => {
      const { notify } = fixture();
      const first = deliver(notify, { entityId: "exam1", occurrenceKey: "d-1" });
      const second = deliver(notify, { entityId: "exam1", occurrenceKey: "d-0" });
      notify.dismiss(first.id, "2026-07-11T08:00:00.000Z");

      const center = notify.listCenter();
      expect(center.map((r) => r.id)).toEqual([first.id, second.id]);
      expect(center[0]?.status).toBe("dismissed");
    });

    it("caps the result at the given limit", () => {
      const { notify } = fixture();
      deliver(notify, { entityId: "exam1", occurrenceKey: "d-1" });
      deliver(notify, { entityId: "exam1", occurrenceKey: "d-0" });
      deliver(notify, { entityId: "exam2", occurrenceKey: "d-1" });
      expect(notify.listCenter(2)).toHaveLength(2);
    });

    it("isolates the center listing between profiles", () => {
      const a = fixture();
      const b = fixture();
      deliver(a.notify);
      expect(b.notify.listCenter()).toEqual([]);
    });
  });

  describe("listAll", () => {
    it("returns the full ledger of this profile, every status, ordered by deliveredAt then id", () => {
      const { notify } = fixture();
      // Distinct `deliveredAt` values (rather than the shared `NOW` the
      // `deliver` helper defaults to) so ordering is asserted on
      // `delivered_at` itself, never on an id tie-break between two rows
      // recorded in the same millisecond.
      const first = notify.recordDelivered(
        { source: "exam", entityId: "exam1", occurrenceKey: "d-1", title: "Ispit sutra", body: "B" },
        "2026-07-10T08:00:00.000Z",
      );
      const second = notify.recordDelivered(
        { source: "exam", entityId: "exam1", occurrenceKey: "d-0", title: "Ispit danas", body: "B" },
        "2026-07-11T08:00:00.000Z",
      );
      notify.dismiss(first.id, "2026-07-11T08:00:00.000Z");

      const all = notify.listAll();
      expect(all.map((r) => r.id)).toEqual([first.id, second.id]);
      expect(all.find((r) => r.id === first.id)?.status).toBe("dismissed");
    });

    it("returns an empty array when the ledger is empty", () => {
      const { notify } = fixture();
      expect(notify.listAll()).toEqual([]);
    });

    it("has no cap, unlike listCenter", () => {
      const { notify } = fixture();
      for (let i = 0; i < 60; i += 1) {
        deliver(notify, { entityId: `exam${i}`, occurrenceKey: "d-1" });
      }
      expect(notify.listAll()).toHaveLength(60);
    });

    it("isolates the full ledger between profiles", () => {
      const a = fixture();
      const b = fixture();
      deliver(a.notify);
      expect(b.notify.listAll()).toEqual([]);
    });
  });
});
