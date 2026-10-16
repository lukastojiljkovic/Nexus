import { describe, expect, it } from "vitest";

import {
  KIT72_DEFAULT_IDS,
  MAX_KIT_ENTRIES,
  MAX_KIT_TEXT_LENGTH,
  addKitEntry,
  defaultKit,
  parseKit,
  removeKitEntry,
  toggleKitEntry,
} from "./kit72.js";

describe("defaultKit", () => {
  it("is the fourteen basic items of Ready.gov's list, none ticked", () => {
    const kit = defaultKit();
    expect(kit).toHaveLength(14);
    expect(kit.map((entry) => entry.id)).toEqual([...KIT72_DEFAULT_IDS]);
    expect(kit.every((entry) => entry.text === null && !entry.done)).toBe(true);
  });
});

describe("toggleKitEntry", () => {
  it("flips one tick and leaves every other entry as it was", () => {
    const kit = toggleKitEntry(defaultKit(), "water");
    expect(kit.find((entry) => entry.id === "water")?.done).toBe(true);
    expect(kit.filter((entry) => entry.done)).toHaveLength(1);
    expect(toggleKitEntry(kit, "water").find((entry) => entry.id === "water")?.done).toBe(false);
  });

  it("answers the same list for an id it does not hold", () => {
    const kit = defaultKit();
    expect(toggleKitEntry(kit, "nope")).toEqual(kit);
  });
});

describe("addKitEntry and removeKitEntry", () => {
  it("appends a trimmed item with a new id, one above the highest still in the list", () => {
    const once = addKitEntry(defaultKit(), "  Insulin pen  ");
    expect(once.at(-1)).toEqual({ id: "custom-1", text: "Insulin pen", done: false });
    const twice = addKitEntry(once, "Spare glasses");
    expect(twice.at(-1)?.id).toBe("custom-2");
    const thrice = addKitEntry(removeKitEntry(twice, "custom-1"), "Cash");
    expect(thrice.at(-1)?.id).toBe("custom-3");
  });

  it("refuses an empty item, an item over the limit and a full list", () => {
    const kit = defaultKit();
    expect(addKitEntry(kit, "   ")).toEqual(kit);
    expect(addKitEntry(kit, "x".repeat(MAX_KIT_TEXT_LENGTH + 1))).toEqual(kit);
    expect(addKitEntry(kit, "x".repeat(MAX_KIT_TEXT_LENGTH))).toHaveLength(15);
    let full = kit;
    while (full.length < MAX_KIT_ENTRIES) full = addKitEntry(full, "item");
    expect(addKitEntry(full, "one more")).toBe(full);
  });

  it("removes a default item as well, and removing an id it does not hold changes nothing", () => {
    expect(removeKitEntry(defaultKit(), "radio")).toHaveLength(13);
    expect(removeKitEntry(defaultKit(), "nope")).toHaveLength(14);
  });
});

describe("parseKit", () => {
  it("reads back what the page writes, ticks and user items included", () => {
    const kit = toggleKitEntry(addKitEntry(defaultKit(), "Cash"), "food");
    expect(parseKit(JSON.parse(JSON.stringify(kit)))).toEqual(kit);
  });

  it("refuses anything that is not a checklist this module wrote", () => {
    expect(parseKit("water")).toBeNull();
    expect(parseKit([{ id: "water", text: null }])).toBeNull();
    expect(parseKit([{ id: "unknown", text: null, done: false }])).toBeNull();
    expect(parseKit([{ id: "water", text: null, done: false }, { id: "water", text: null, done: true }])).toBeNull();
    expect(parseKit([{ id: "custom-1", text: "", done: false }])).toBeNull();
    expect(parseKit([{ id: "custom-1", text: "x".repeat(MAX_KIT_TEXT_LENGTH + 1), done: false }])).toBeNull();
    expect(parseKit([{ id: "custom-0", text: "Cash", done: false }])).toBeNull();
    expect(parseKit([{ id: "water", text: "Water", done: false }])).toBeNull();
    expect(parseKit(Array.from({ length: MAX_KIT_ENTRIES + 1 }, () => null))).toBeNull();
  });
});
