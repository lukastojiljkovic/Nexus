import { describe, expect, it } from "vitest";
import {
  DEVICE_PREFERENCE_CARDS,
  DEVICE_PREFERENCE_KEYS,
  DEVICE_PREFERENCE_VALUES,
  isDevicePreferenceValue,
  parseDevicePreference,
} from "./devicePreferences.js";

describe("device preferences", () => {
  it("names a card for every allowed key, so the page the assistant opens holds the control", () => {
    expect([...DEVICE_PREFERENCE_KEYS].sort()).toEqual(Object.keys(DEVICE_PREFERENCE_CARDS).sort());
    expect(DEVICE_PREFERENCE_CARDS["auto-lock"]).toBe("security");
  });

  it("accepts an allowed key with one of its values", () => {
    expect(parseDevicePreference({ key: "theme", value: "noc" })).toEqual({
      key: "theme",
      value: "noc",
    });
    expect(parseDevicePreference({ key: "auto-lock", value: "0" })).toEqual({
      key: "auto-lock",
      value: "0",
    });
  });

  it("refuses a value that belongs to another key", () => {
    expect(parseDevicePreference({ key: "clock", value: "noc" })).toBeNull();
    expect(isDevicePreferenceValue("week-start", "sunday")).toBe(true);
    expect(isDevicePreferenceValue("week-start", "24h")).toBe(false);
  });

  it("refuses a key outside the allowlist, including the ones the assistant must never change", () => {
    for (const key of ["network", "passcode", "recovery", "webSearch", "shortcuts", "__proto__"]) {
      expect(parseDevicePreference({ key, value: "on" })).toBeNull();
    }
  });

  it("refuses a payload that is not an object with two strings", () => {
    expect(parseDevicePreference(null)).toBeNull();
    expect(parseDevicePreference("theme")).toBeNull();
    expect(parseDevicePreference({ key: "theme" })).toBeNull();
    expect(parseDevicePreference({ key: "theme", value: 2 })).toBeNull();
  });

  it("keeps the allowed values as literal lists the schema can carry", () => {
    expect(DEVICE_PREFERENCE_VALUES.language).toEqual(["sr", "en"]);
    expect(DEVICE_PREFERENCE_VALUES.accent).toContain("bordo");
  });
});
