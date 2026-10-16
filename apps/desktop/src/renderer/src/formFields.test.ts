import { describe, expect, it } from "vitest";
import type { Event } from "../../shared/ipc.js";
import { categorySuggestions, optionalText } from "./formFields.js";

/**
 * The save rule the task and event forms apply to their free-text boxes. The
 * forms are not rendered under Vitest (this suite runs without a DOM), so what
 * is pinned here is the value each box sends: a typed description keeps its
 * line breaks, and a cleared box sends null, which is what clears the stored
 * text on an edit.
 */
describe("optionalText", () => {
  it("keeps the line breaks of a multi-line description", () => {
    expect(optionalText("  Prvi red\nDrugi red  ")).toBe("Prvi red\nDrugi red");
  });

  it("sends null for a box that is blank or only whitespace", () => {
    expect(optionalText("")).toBeNull();
    expect(optionalText(" \n\t ")).toBeNull();
  });
});

function event(category: string | null): Event {
  return {
    id: `ev-${category ?? "none"}`,
    profileId: "p1",
    title: "Predavanje",
    description: null,
    startAt: "2026-10-15T10:00",
    endAt: null,
    allDay: false,
    location: null,
    category,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    recurrence: null,
    recurrenceExdates: [],
    reminderOffsets: [],
  };
}

describe("categorySuggestions", () => {
  it("offers each category in use once, alphabetically, and skips events without one", () => {
    const events = [event("posao"), event(null), event("fakultet"), event("posao")];
    expect(categorySuggestions(events)).toEqual(["fakultet", "posao"]);
  });

  it("offers nothing on a profile whose events carry no category", () => {
    expect(categorySuggestions([event(null)])).toEqual([]);
    expect(categorySuggestions([])).toEqual([]);
  });
});
