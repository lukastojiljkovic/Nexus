import { describe, expect, it } from "vitest";
import { hlcZero, type Hlc } from "./hlc.js";
import {
  applyEdit,
  decodeRowState,
  emptyRowState,
  encodeRowState,
  markDeleted,
  markRestored,
  mergeRows,
  rowFields,
  type RowState,
} from "./merge.js";

const A = "device-a";
const B = "device-b";
const T0 = 1_800_000_000_000;

/** The authenticated envelope of a live (not deleted) row at version 1. */
const LIVE = { version: 1, deleted: false } as const;

/** 10:00 on device A, 10:05 on device B — the scenario from the brief. */
const at = (nodeId: string, minutes: number): Hlc => ({
  wallMs: T0 + minutes * 60_000,
  counter: 0,
  nodeId,
});

/** A task created on one device and already synced to both, at version 7. */
function sharedStart(): RowState {
  const created = emptyRowState(at(A, 0));
  const withFields = applyEdit(created, { title: "Kupiti hleb", due_date: "2026-08-10" }, at(A, 0));
  return { ...withFields, version: 7 };
}

describe("the two-device scenario", () => {
  it("keeps BOTH edits when two devices change different fields from the same version", () => {
    const start = sharedStart();
    const deviceA = applyEdit(start, { title: "Kupiti hleb i mleko" }, at(A, 60));
    const deviceB = applyEdit(start, { due_date: "2026-08-12" }, at(B, 65));

    const merged = mergeRows(deviceA, deviceB);
    expect(rowFields(merged)).toEqual({
      title: "Kupiti hleb i mleko",
      due_date: "2026-08-12",
    });
  });

  it("resolves the same field edited on both devices identically whichever side merges", () => {
    const start = sharedStart();
    const deviceA = applyEdit(start, { title: "A's title" }, at(A, 60));
    const deviceB = applyEdit(start, { title: "B's title" }, at(B, 65));

    const onA = mergeRows(deviceA, deviceB);
    const onB = mergeRows(deviceB, deviceA);
    expect(onA).toEqual(onB);
    // 10:05 beats 10:00 — the later write wins, and both devices agree it did.
    expect(rowFields(onA)["title"]).toBe("B's title");
  });

  it("takes the greater version — the server still owns the next one", () => {
    const start = sharedStart();
    const merged = mergeRows({ ...start, version: 7 }, { ...start, version: 9 });
    expect(merged.version).toBe(9);
  });
});

describe("mergeRows is a proper merge", () => {
  const start = sharedStart();
  const a = applyEdit(start, { title: "A" }, at(A, 10));
  const b = applyEdit(start, { due_date: "B" }, at(B, 20));
  const c = applyEdit(start, { title: "C", note: "c" }, at(A, 30));

  it("is commutative", () => {
    expect(mergeRows(a, b)).toEqual(mergeRows(b, a));
    expect(mergeRows(a, c)).toEqual(mergeRows(c, a));
  });

  it("is associative", () => {
    expect(mergeRows(mergeRows(a, b), c)).toEqual(mergeRows(a, mergeRows(b, c)));
  });

  it("is idempotent", () => {
    expect(mergeRows(a, a)).toEqual(a);
    const once = mergeRows(a, b);
    expect(mergeRows(once, b)).toEqual(once);
    expect(mergeRows(once, once)).toEqual(once);
  });

  it("keeps a field only one side has ever seen", () => {
    const merged = mergeRows(a, c);
    expect(rowFields(merged)["note"]).toBe("c");
  });

  it("breaks an exact stamp tie deterministically, by canonical value", () => {
    // Same wall clock, same counter, same node id: only possible if something
    // upstream is broken, but a merge still has to give one answer everywhere.
    const stamp = at(A, 10);
    const left = applyEdit(start, { title: "aaa" }, stamp);
    const right = applyEdit(start, { title: "zzz" }, stamp);
    expect(mergeRows(left, right)).toEqual(mergeRows(right, left));
    expect(rowFields(mergeRows(left, right))["title"]).toBe("zzz");
  });
});

describe("deletion is a field like any other", () => {
  const start = sharedStart();

  it("lets a later edit beat an earlier delete", () => {
    const deleted = markDeleted(start, at(A, 10));
    const edited = applyEdit(start, { title: "still wanted" }, at(B, 20));
    const merged = mergeRows(deleted, edited);
    // The delete is older, but nothing has un-deleted the row: LWW on `deleted`
    // alone decides, and only a restore moves it back.
    expect(merged.deleted.value).toBe(true);
    // The edit survives regardless, so restoring the row restores the new title.
    expect(rowFields(merged)["title"]).toBe("still wanted");
  });

  it("lets a later restore beat an earlier delete", () => {
    const deleted = markDeleted(start, at(A, 10));
    const restored = markRestored(deleted, at(B, 20));
    expect(mergeRows(deleted, restored).deleted.value).toBe(false);
    expect(mergeRows(restored, deleted).deleted.value).toBe(false);
  });

  it("lets a later delete beat an earlier restore", () => {
    const restored = markRestored(start, at(A, 10));
    const deleted = markDeleted(restored, at(B, 20));
    expect(mergeRows(restored, deleted).deleted.value).toBe(true);
  });
});

describe("applyEdit", () => {
  it("stamps only the fields in the patch", () => {
    const start = sharedStart();
    const edited = applyEdit(start, { title: "new" }, at(A, 99));
    expect(edited.fields["title"]?.at).toEqual(at(A, 99));
    expect(edited.fields["due_date"]?.at).toEqual(start.fields["due_date"]?.at);
  });

  it("refuses a prototype-poisoning field name", () => {
    const start = sharedStart();
    const patch = JSON.parse('{"__proto__":{"x":1}}') as Record<string, never>;
    expect(() => applyEdit(start, patch, at(A, 1))).toThrow(TypeError);
    expect(() => applyEdit(start, { constructor: 1 }, at(A, 1))).toThrow(TypeError);
  });

  it("leaves the input untouched — every operation returns a new state", () => {
    const start = sharedStart();
    const before = JSON.stringify(start);
    applyEdit(start, { title: "new" }, at(A, 99));
    expect(JSON.stringify(start)).toBe(before);
  });
});

describe("encodeRowState / decodeRowState", () => {
  it("round-trips through the JSON that row.ts seals", () => {
    const start = applyEdit(sharedStart(), { done: false, tags: ["a", "b"] }, at(B, 3));
    const wire = encodeRowState(start);
    expect(decodeRowState(wire, { version: start.version, deleted: false })).toEqual(start);
  });

  it("carries no version — the version is authenticated metadata, not plaintext", () => {
    const wire = encodeRowState(sharedStart());
    expect(Object.keys(wire).sort()).toEqual(["d", "f"]);
    expect(decodeRowState(wire, { version: 42, deleted: false })?.version).toBe(42);
  });

  it("rejects every malformed shape rather than half-decoding it", () => {
    const wire = encodeRowState(sharedStart());
    expect(decodeRowState({ f: {} }, LIVE)).toBeNull();
    expect(decodeRowState({ ...wire, extra: 1 }, LIVE)).toBeNull();
    expect(decodeRowState({ ...wire, d: { v: "yes", t: "000000000000:00000000:a" } }, LIVE)).toBeNull();
    expect(decodeRowState({ ...wire, f: { title: { v: 1, t: "not-a-stamp" } } }, LIVE)).toBeNull();
    expect(decodeRowState({ ...wire, f: { title: { v: 1 } } }, LIVE)).toBeNull();
    expect(decodeRowState({ ...wire, f: "nope" }, LIVE)).toBeNull();
    expect(decodeRowState({ ...wire, f: { "__proto__x": { v: 1, t: "000000000000:00000000:a" } } }, LIVE))
      .not.toBeNull();
  });

  it("rejects a wire object whose field name is a prototype-poisoning key", () => {
    const wire = encodeRowState(sharedStart());
    const hostile = JSON.parse(
      `{"f":{"__proto__":{"v":1,"t":"000000000000:00000000:a"}},"d":${JSON.stringify(wire["d"])}}`,
    ) as Record<string, never>;
    expect(decodeRowState(hostile, LIVE)).toBeNull();
  });

  it("rejects a version that is not a non-negative safe integer", () => {
    const wire = encodeRowState(sharedStart());
    expect(decodeRowState(wire, { version: -1, deleted: false })).toBeNull();
    expect(decodeRowState(wire, { version: 1.5, deleted: false })).toBeNull();
  });
});

describe("emptyRowState", () => {
  it("starts at version 0, with no fields and not deleted", () => {
    const empty = emptyRowState(hlcZero(A));
    expect(empty.version).toBe(0);
    expect(rowFields(empty)).toEqual({});
    expect(empty.deleted.value).toBe(false);
  });
});
