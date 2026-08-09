import { describe, expect, it } from "vitest";

import type { PostgrestFailure } from "./http.js";
import { classifyPush, needsReread, type PushCode } from "./outcome.js";

const failure = (over: Partial<PostgrestFailure> = {}): PostgrestFailure => ({
  code: null,
  message: null,
  details: null,
  hint: null,
  ...over,
});

describe("classifyPush", () => {
  it("maps every code the guard triggers raise", () => {
    const expected: ReadonlyArray<readonly [string, PushCode]> = [
      ["NX001", "conflict"],
      ["NX002", "absent"],
      ["NX003", "stale-bytes"],
      ["NX004", "rejected"],
      ["NX005", "nonce-reuse"],
      ["NX006", "rejected"],
      ["NX007", "no-epoch"],
    ];
    for (const [code, outcome] of expected) {
      expect(classifyPush(400, failure({ code })), code).toBe(outcome);
    }
  });

  it("tells the two 23505s apart by the constraint the server named", () => {
    // Both are „unique violation". One is an ordinary race — another device
    // created the object first — and the other is a repeated nonce under one
    // content key, which is a cryptographic alarm rather than something to
    // resolve by pulling.
    expect(
      classifyPush(
        409,
        failure({
          code: "23505",
          message: 'duplicate key value violates unique constraint "sync_objects_pkey"',
        }),
      ),
    ).toBe("duplicate");
    expect(
      classifyPush(
        409,
        failure({
          code: "23505",
          message: 'duplicate key value violates unique constraint "sync_objects_nonce_unique"',
        }),
      ),
    ).toBe("nonce-reuse");
  });

  it("falls through to `rejected` when a 23505 names a constraint it does not know", () => {
    // Wrong-way-safe on purpose: a renamed constraint must never become
    // `accepted`, and `rejected` stops rather than retrying.
    expect(classifyPush(409, failure({ code: "23505", message: "something else entirely" }))).toBe("rejected");
    expect(classifyPush(409, failure({ code: "23505" }))).toBe("rejected");
  });

  it("reads a privilege failure as forbidden whether it arrives as a code or a status", () => {
    expect(classifyPush(403, failure({ code: "42501" }))).toBe("forbidden");
    expect(classifyPush(401, failure())).toBe("forbidden");
    expect(classifyPush(403, failure())).toBe("forbidden");
  });

  it("separates a broken server from a refusing one", () => {
    // The distinction decides whether a retry is worth anything: a 500 may
    // succeed next time, a 400 with no rule of ours behind it will be refused
    // identically forever.
    expect(classifyPush(500, failure())).toBe("unavailable");
    expect(classifyPush(503, failure())).toBe("unavailable");
    expect(classifyPush(418, failure())).toBe("rejected");
    expect(classifyPush(400, failure({ code: "PGRST102" }))).toBe("rejected");
  });

  it("treats a CHECK violation as a refusal of the content", () => {
    expect(classifyPush(400, failure({ code: "23514" }))).toBe("rejected");
  });
});

describe("needsReread", () => {
  it("is true for exactly the three outcomes that mean the local picture is stale", () => {
    const all: readonly PushCode[] = [
      "accepted",
      "conflict",
      "absent",
      "duplicate",
      "stale-bytes",
      "nonce-reuse",
      "no-epoch",
      "rejected",
      "forbidden",
      "unavailable",
    ];
    expect(all.filter(needsReread)).toEqual(["conflict", "absent", "duplicate"]);
  });
});
