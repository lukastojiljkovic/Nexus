import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CLOCK_PREFERENCES,
  clearStoredCalendarPreferences,
  EVENT_DURATIONS,
  formatClockLabel,
  localMinutesOfDay,
  persistClock,
  persistEventDuration,
  readStoredClock,
  readStoredEventDuration,
  type ClockPreference,
} from "./calendarPrefs.js";
import { lookup, strings } from "./strings.js";
import { memoryStorage } from "./testStorage.js";

/**
 * CAL §5's two device preferences, on the shape `rendererPrefs.test.ts`,
 * `weekStart.test.ts` and `taskPrefs.test.ts` all pin: a closed value set, a
 * safe fallback for anything unrecognized, `localStorage` only, and no write
 * on read. Neither touches the document, so there is no DOM stub here at all.
 *
 * `formatClockLabel` is tested as what it is — a PURE function of minutes and
 * the preference — because that is precisely what lets `dashboardStrip.ts`
 * stay pure while every calendar surface draws the same label.
 */

const DURATION_KEY = "nexus.calendar.defaultDurationMinutes";
const CLOCK_KEY = "nexus.calendar.clock";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubStorage(seed: Readonly<Record<string, string>> = {}): Storage {
  const storage = memoryStorage(seed);
  vi.stubGlobal("localStorage", storage);
  return storage;
}

// --- the default event duration ----------------------------------------------

describe("EVENT_DURATIONS", () => {
  it("is the four spans, ascending, with the default among them", () => {
    expect(EVENT_DURATIONS).toEqual([30, 60, 90, 120]);
    expect(new Set(EVENT_DURATIONS).size).toBe(EVENT_DURATIONS.length);
  });

  it("has a Serbian label for every span the Settings select can offer", () => {
    for (const minutes of EVENT_DURATIONS) {
      expect(
        lookup(strings.settings.appearance.eventDurationOptions, String(minutes))?.length,
        String(minutes),
      ).toBeGreaterThan(0);
    }
  });
});

describe("readStoredEventDuration", () => {
  it("defaults to an hour when nothing is stored", () => {
    stubStorage();
    expect(readStoredEventDuration()).toBe(60);
  });

  it("reads back every allowed span", () => {
    for (const minutes of EVENT_DURATIONS) {
      stubStorage({ [DURATION_KEY]: String(minutes) });
      expect(readStoredEventDuration()).toBe(minutes);
    }
  });

  it("falls back to an hour for an out-of-set number or a non-number", () => {
    for (const stored of ["45", "-30", "1440", "0", "abc", "60min", "NaN", "Infinity"]) {
      stubStorage({ [DURATION_KEY]: stored });
      expect(readStoredEventDuration(), stored).toBe(60);
    }
  });

  // `Number("")` and `Number("  ")` are 0, which is not an allowed span but IS
  // a number — the blank guard is what keeps a corrupt key from seeding an
  // event that ends the minute it starts.
  it("falls back to an hour for a blank stored value", () => {
    for (const stored of ["", "   "]) {
      stubStorage({ [DURATION_KEY]: stored });
      expect(readStoredEventDuration(), JSON.stringify(stored)).toBe(60);
    }
  });

  it("tolerates surrounding whitespace on an otherwise valid span", () => {
    stubStorage({ [DURATION_KEY]: " 90 " });
    expect(readStoredEventDuration()).toBe(90);
  });

  it("does not write on read — a first run leaves storage untouched", () => {
    const storage = stubStorage();
    expect(readStoredEventDuration()).toBe(60);
    expect(storage.length).toBe(0);
  });
});

describe("persistEventDuration", () => {
  it("writes the key and round-trips every allowed span", () => {
    const storage = stubStorage();
    for (const minutes of EVENT_DURATIONS) {
      persistEventDuration(minutes);
      expect(storage.getItem(DURATION_KEY)).toBe(String(minutes));
      expect(readStoredEventDuration()).toBe(minutes);
    }
  });

  it("touches no other preference key", () => {
    const storage = stubStorage({ "nexus.theme": "dan", "nexus.weekStart": "sunday" });
    persistEventDuration(120);
    expect(storage.getItem("nexus.theme")).toBe("dan");
    expect(storage.getItem("nexus.weekStart")).toBe("sunday");
  });
});

// --- the clock ----------------------------------------------------------------

describe("CLOCK_PREFERENCES", () => {
  it("is the two clocks, the default first — the order the Settings select draws", () => {
    expect(CLOCK_PREFERENCES).toEqual(["24h", "12h"]);
  });

  it("has a Serbian label for both", () => {
    for (const clock of CLOCK_PREFERENCES) {
      expect(strings.settings.appearance.clockOptions[clock].length, clock).toBeGreaterThan(0);
    }
  });
});

describe("readStoredClock", () => {
  it("defaults to the 24-hour clock — the Serbian norm — when nothing is stored", () => {
    stubStorage();
    expect(readStoredClock()).toBe("24h");
  });

  it("reads back both clocks", () => {
    for (const clock of CLOCK_PREFERENCES) {
      stubStorage({ [CLOCK_KEY]: clock });
      expect(readStoredClock()).toBe(clock);
    }
  });

  it("falls back to 24h for anything it cannot name, casing included", () => {
    for (const stored of ["", "  ", "24", "12", "H12", "12H", "hour12", "true"]) {
      stubStorage({ [CLOCK_KEY]: stored });
      expect(readStoredClock(), stored).toBe("24h");
    }
  });

  it("does not write on read — a first run leaves storage untouched", () => {
    const storage = stubStorage();
    expect(readStoredClock()).toBe("24h");
    expect(storage.length).toBe(0);
  });
});

describe("persistClock", () => {
  it("writes the key and round-trips both clocks", () => {
    const storage = stubStorage();
    for (const clock of CLOCK_PREFERENCES) {
      persistClock(clock);
      expect(storage.getItem(CLOCK_KEY)).toBe(clock);
      expect(readStoredClock()).toBe(clock);
    }
  });

  it("touches neither the duration nor any other preference key", () => {
    const storage = stubStorage({ [DURATION_KEY]: "90", "nexus.accent": "bordo" });
    persistClock("12h");
    expect(storage.getItem(DURATION_KEY)).toBe("90");
    expect(storage.getItem("nexus.accent")).toBe("bordo");
  });
});

// --- the per-card reset (SET §5) ---------------------------------------------

describe("clearStoredCalendarPreferences", () => {
  it("forgets both keys, so the next read is the default again", () => {
    const storage = stubStorage({ [DURATION_KEY]: "120", [CLOCK_KEY]: "12h" });

    clearStoredCalendarPreferences();

    expect(storage.getItem(DURATION_KEY)).toBeNull();
    expect(storage.getItem(CLOCK_KEY)).toBeNull();
    expect(readStoredEventDuration()).toBe(60);
    expect(readStoredClock()).toBe("24h");
  });

  // The two keys are enumerated, never swept by prefix: `nexus.calendar.view.…`
  // and `nexus.calendar.sources.…` sit under the same prefix and are a
  // profile's own view state, not a setting the Izgled card offers.
  it("leaves the calendar's per-profile view state alone", () => {
    const storage = stubStorage({
      [CLOCK_KEY]: "12h",
      "nexus.calendar.view.p1": "nedelja",
      "nexus.calendar.sources.p1": "events,tasks",
      "nexus.weekStart": "sunday",
    });

    clearStoredCalendarPreferences();

    expect(storage.getItem("nexus.calendar.view.p1")).toBe("nedelja");
    expect(storage.getItem("nexus.calendar.sources.p1")).toBe("events,tasks");
    expect(storage.getItem("nexus.weekStart")).toBe("sunday");
  });

  it("is safe on a profile that never stored either key", () => {
    const storage = stubStorage();
    clearStoredCalendarPreferences();
    expect(storage.length).toBe(0);
  });
});

// --- the label ----------------------------------------------------------------

describe("formatClockLabel", () => {
  it("is `formatClock`'s own zero-padded HH:MM on the 24-hour clock", () => {
    expect(formatClockLabel(0, "24h")).toBe("00:00");
    expect(formatClockLabel(9, "24h")).toBe("00:09");
    expect(formatClockLabel(90, "24h")).toBe("01:30");
    expect(formatClockLabel(720, "24h")).toBe("12:00");
    expect(formatClockLabel(1439, "24h")).toBe("23:59");
  });

  it("names both halves of the day on the 12-hour clock, midnight and noon as 12", () => {
    expect(formatClockLabel(0, "12h")).toBe("12:00 AM");
    expect(formatClockLabel(9, "12h")).toBe("12:09 AM");
    expect(formatClockLabel(90, "12h")).toBe("1:30 AM");
    expect(formatClockLabel(11 * 60 + 59, "12h")).toBe("11:59 AM");
    expect(formatClockLabel(720, "12h")).toBe("12:00 PM");
    expect(formatClockLabel(13 * 60, "12h")).toBe("1:00 PM");
    expect(formatClockLabel(1439, "12h")).toBe("11:59 PM");
  });

  // The hour loses its leading zero on the 12-hour clock and the minute never
  // does — the shape `Intl.DateTimeFormat("sr-Latn", { hour: "numeric" })`
  // produces, which is what a user switching clocks expects to see.
  it("pads the minute but not the hour on the 12-hour clock", () => {
    expect(formatClockLabel(8 * 60 + 5, "12h")).toBe("8:05 AM");
    expect(formatClockLabel(8 * 60 + 5, "24h")).toBe("08:05");
  });

  it("is pure — the same minutes and clock give the same label with nothing stored", () => {
    stubStorage({ [CLOCK_KEY]: "12h" });
    expect(formatClockLabel(600, "24h")).toBe("10:00");
    expect(formatClockLabel(600, "12h")).toBe("10:00 AM");
  });

  it("draws every minute of the day on both clocks, and never the same label twice", () => {
    for (const clock of CLOCK_PREFERENCES) {
      const labels = new Set<string>();
      for (let minutes = 0; minutes < 24 * 60; minutes += 1) {
        labels.add(formatClockLabel(minutes, clock));
      }
      expect(labels.size, clock).toBe(24 * 60);
    }
  });
});

describe("localMinutesOfDay", () => {
  it("reads an instant's local wall clock as minutes since midnight", () => {
    expect(localMinutesOfDay(new Date(2026, 6, 31, 0, 0))).toBe(0);
    expect(localMinutesOfDay(new Date(2026, 6, 31, 14, 5))).toBe(14 * 60 + 5);
    expect(localMinutesOfDay(new Date(2026, 6, 31, 23, 59))).toBe(23 * 60 + 59);
  });

  it("round-trips through the label the calendar rows draw", () => {
    const date = new Date(2026, 6, 31, 14, 5);
    const clocks: readonly ClockPreference[] = CLOCK_PREFERENCES;
    expect(clocks.map((clock) => formatClockLabel(localMinutesOfDay(date), clock))).toEqual([
      "14:05",
      "2:05 PM",
    ]);
  });
});
