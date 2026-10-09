import { describe, expect, it } from "vitest";
import type { DocumentType } from "../../shared/ipc.js";
import {
  DEFAULT_REMINDER_LADDERS,
  REMINDER_LADDER,
  type DocumentFormValues,
  documentFieldChanges,
  ladderFor,
  newDocumentFields,
  reminderChoices,
  toggleReminder,
} from "./documentsForm.js";

/**
 * The warning ladder used to be the field nobody could reach: `reminderOffsets`
 * was declared on both document wires, validated by main, honoured by the store
 * and asserted by `documentStore.test.ts`, while the panel sent neither — so
 * every document kept its type's default for its whole life and no test said so.
 * These cases drive the form's own functions instead: what a create carries,
 * what an edit carries, and what „no warnings“ looks like on each.
 */

/** The form's values as the panel hands them over: notes trimmed, ladder resolved. */
function values(overrides: Partial<DocumentFormValues> = {}): DocumentFormValues {
  const docType: DocumentType = overrides.docType ?? "pasos";
  return {
    docType,
    label: overrides.label ?? "Pasoš",
    expiryDate: overrides.expiryDate ?? "2030-01-01",
    notes: overrides.notes ?? "",
    ladder: ladderFor(overrides.ladder ?? null, docType),
  };
}

describe("a document's ladder on create", () => {
  it("sends the type's default while no chip has been touched", () => {
    // The store would apply its own copy of this table if the field were absent,
    // and the chips are already showing it as the selection — so the form sends
    // the ladder it put on screen rather than leaving the row to a second table.
    expect(newDocumentFields(values({ docType: "pasos" })).reminderOffsets).toEqual([90, 30, 7]);
    expect(newDocumentFields(values({ docType: "registracija" })).reminderOffsets).toEqual([
      30, 14, 3,
    ]);
  });

  it("sends the user's own ladder once a chip has been touched", () => {
    const touched = toggleReminder(null, "kartica", 30); // un-tick 30 of the default [30, 7]
    expect(touched).toEqual([7]);
    expect(newDocumentFields(values({ docType: "kartica", ladder: touched })).reminderOffsets).toEqual([
      7,
    ]);
  });

  it("sends an empty ladder as 'no warnings' rather than letting the default stand", () => {
    // Every chip un-ticked is a real answer, and the one place it cannot be said
    // by omission: absent means „the type's default“ to the store.
    const cleared = DEFAULT_REMINDER_LADDERS.kartica.reduce<readonly number[]>(
      (ladder, days) => toggleReminder(ladder, "kartica", days),
      DEFAULT_REMINDER_LADDERS.kartica,
    );
    expect(cleared).toEqual([]);
    expect(newDocumentFields(values({ docType: "kartica", ladder: cleared }))).toMatchObject({
      reminderOffsets: [],
    });
  });

  it("leaves notes off the payload when there are none", () => {
    expect(newDocumentFields(values())).not.toHaveProperty("notes");
    expect(newDocumentFields(values({ notes: "Serijski broj" })).notes).toBe("Serijski broj");
  });
});

describe("a document's ladder on edit", () => {
  it("carries the record's own ladder, not the type's default", () => {
    // What `startEdit` loads into the chips: a record stored under a ladder the
    // type's default does not have keeps every lead time through an edit.
    const stored = [60, 14, 1];
    expect(documentFieldChanges(values({ docType: "pasos", ladder: stored })).reminderOffsets).toEqual([
      60, 14, 1,
    ]);
  });

  it("clears every warning with an empty ladder", () => {
    expect(documentFieldChanges(values({ ladder: [] })).reminderOffsets).toEqual([]);
  });

  it("clears notes with null, which is how the wire says 'empty'", () => {
    expect(documentFieldChanges(values({ notes: "" })).notes).toBeNull();
    expect(documentFieldChanges(values({ notes: "Produžen" })).notes).toBe("Produžen");
  });
});

describe("the chip row", () => {
  it("offers the fixed ladder plus any lead time a stored record can say", () => {
    expect(reminderChoices([])).toEqual([...REMINDER_LADDER]);
    expect(reminderChoices([2, 90])).toEqual([1, 2, 3, 7, 14, 30, 90]);
  });

  it("makes the ladder the user's on the first click, from the type's default", () => {
    expect(toggleReminder(null, "polisa", 14)).toEqual([30, 7, 14]);
    expect(toggleReminder(null, "polisa", 30)).toEqual([7]);
  });

  it("counts 0 as a lead time a chip can un-tick, though none offers it", () => {
    // Reachable through a restored archive that carries it; un-ticking it must
    // be a decision like any other rather than an edit the form silently drops.
    expect(toggleReminder([0, 7], "custom", 0)).toEqual([7]);
  });
});
