import { describe, expect, it } from "vitest";
import { resolveActiveProfileId } from "./activeProfile.js";

const personal = { id: "p-1", kind: "personal" as const };
const business = { id: "b-1", kind: "business" as const };

describe("resolveActiveProfileId", () => {
  it("keeps the selected id while it names a live profile", () => {
    expect(resolveActiveProfileId([personal, business], business.id)).toBe(business.id);
  });

  it("falls back to the personal anchor when nothing was selected yet — the unlock default (ADR-058)", () => {
    expect(resolveActiveProfileId([personal, business], null)).toBe(personal.id);
  });

  it("falls back to the personal anchor when the selected id went stale", () => {
    expect(resolveActiveProfileId([personal, business], "deleted-profile")).toBe(personal.id);
  });

  it("falls back to the first profile when no personal anchor exists — defensive, mirrors the renderer's resolveActiveProfile", () => {
    expect(resolveActiveProfileId([business], null)).toBe(business.id);
  });

  it("answers null only for an empty list", () => {
    expect(resolveActiveProfileId([], "anything")).toBeNull();
  });
});
