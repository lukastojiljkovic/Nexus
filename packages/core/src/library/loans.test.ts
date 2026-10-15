import { describe, expect, it } from "vitest";
import { isLibraryLoanOverdue } from "./loans.js";

describe("isLibraryLoanOverdue", () => {
  it("is overdue when it has not come back and its due day is before today", () => {
    expect(isLibraryLoanOverdue({ dueOn: "2026-10-01", returnedOn: null }, "2026-10-02")).toBe(
      true,
    );
  });

  it("is not overdue on its due day itself", () => {
    expect(isLibraryLoanOverdue({ dueOn: "2026-10-02", returnedOn: null }, "2026-10-02")).toBe(
      false,
    );
  });

  it("compares calendar days across a year boundary", () => {
    expect(isLibraryLoanOverdue({ dueOn: "2026-12-31", returnedOn: null }, "2027-01-01")).toBe(
      true,
    );
    expect(isLibraryLoanOverdue({ dueOn: "2027-01-01", returnedOn: null }, "2026-12-31")).toBe(
      false,
    );
  });

  it("is never overdue once returned, and never overdue without a due day", () => {
    expect(
      isLibraryLoanOverdue({ dueOn: "2026-10-01", returnedOn: "2026-10-09" }, "2026-10-10"),
    ).toBe(false);
    expect(isLibraryLoanOverdue({ dueOn: null, returnedOn: null }, "2030-01-01")).toBe(false);
  });
});
