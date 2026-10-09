import { describe, expect, it } from "vitest";
import {
  TallyError,
  emptyTallyState,
  tallyCanRedo,
  tallyCanUndo,
  tallyCounter,
  tallyReduce,
  tallyTotal,
  type TallyAction,
  type TallyState,
} from "./tally.js";

const add = (
  id: string,
  name: string,
  options: { step?: number; floorZero?: boolean } = {},
): TallyAction => ({
  type: "add-counter",
  id,
  name,
  ...(options.step === undefined ? {} : { step: options.step }),
  ...(options.floorZero === undefined ? {} : { floorZero: options.floorZero }),
});

const apply = (state: TallyState, ...actions: readonly TallyAction[]): TallyState =>
  actions.reduce(tallyReduce, state);

const code = (action: TallyAction) => {
  try {
    tallyReduce(emptyTallyState(), action);
  } catch (error) {
    expect(error).toBeInstanceOf(TallyError);
    return (error as TallyError).code;
  }
  return "did not throw";
};

describe("tallyReduce", () => {
  it("starts empty", () => {
    expect(emptyTallyState()).toEqual({ counters: [], past: [], future: [] });
  });

  it("adds named counters with a step of one and no floor", () => {
    const state = apply(emptyTallyState(), add("a", "  Ulazi  "), add("b", "Izlazi"));
    expect(state.counters).toEqual([
      { id: "a", name: "Ulazi", value: 0, step: 1, floorZero: false },
      { id: "b", name: "Izlazi", value: 0, step: 1, floorZero: false },
    ]);
    expect(tallyTotal(state)).toBe(0);
  });

  it("counts up and down by the counter's own step", () => {
    const state = apply(
      emptyTallyState(),
      add("a", "Koraci", { step: 5 }),
      { type: "bump", id: "a", direction: 1 },
      { type: "bump", id: "a", direction: 1 },
      { type: "bump", id: "a", direction: -1 },
    );
    expect(tallyCounter(state, "a")?.value).toBe(5);
    expect(tallyTotal(state)).toBe(5);
  });

  it("goes below zero unless the counter floors at zero", () => {
    const free = apply(emptyTallyState(), add("a", "Slobodan"), {
      type: "bump",
      id: "a",
      direction: -1,
    });
    expect(tallyCounter(free, "a")?.value).toBe(-1);

    const floored = apply(
      emptyTallyState(),
      add("b", "Pod", { step: 5, floorZero: true }),
      { type: "set-value", id: "b", value: 2 },
      { type: "bump", id: "b", direction: -1 },
    );
    expect(tallyCounter(floored, "b")?.value).toBe(0);
  });

  it("renames, resteps and refloors without touching the other counters", () => {
    const before = apply(emptyTallyState(), add("a", "A"), add("b", "B"));
    const after = apply(
      before,
      { type: "rename-counter", id: "a", name: " Novi " },
      { type: "set-step", id: "a", step: 10 },
      { type: "set-floor", id: "a", floorZero: true },
    );
    expect(tallyCounter(after, "a")).toEqual({
      id: "a",
      name: "Novi",
      value: 0,
      step: 10,
      floorZero: true,
    });
    expect(tallyCounter(after, "b")).toBe(before.counters[1]);
  });

  it("sets an absolute value, clamped by the floor", () => {
    const state = apply(
      emptyTallyState(),
      add("a", "A", { floorZero: true }),
      { type: "set-value", id: "a", value: -4 },
    );
    expect(tallyCounter(state, "a")?.value).toBe(0);
  });

  it("removes a counter and forgets its value", () => {
    const state = apply(
      emptyTallyState(),
      add("a", "A"),
      add("b", "B"),
      { type: "bump", id: "a", direction: 1 },
      { type: "remove-counter", id: "a" },
    );
    expect(state.counters.map((counter) => counter.id)).toEqual(["b"]);
    expect(tallyTotal(state)).toBe(0);
    expect(() => tallyReduce(state, { type: "bump", id: "a", direction: 1 })).toThrow(TallyError);
  });

  it("refuses the actions it cannot carry out", () => {
    expect(code(add("a", "A"))).toBe("did not throw");
    expect(code(add("", "A"))).toBe("id");
    expect(code(add("a", "   "))).toBe("name");
    expect(code(add("a", "x".repeat(61)))).toBe("name");
    expect(code(add("a", "A", { step: 0 }))).toBe("step");
    expect(code(add("a", "A", { step: 2.5 }))).toBe("step");

    const one = apply(emptyTallyState(), add("a", "A"));
    try {
      tallyReduce(one, add("a", "Again"));
      expect.unreachable("a duplicate id must be refused");
    } catch (error) {
      expect((error as TallyError).code).toBe("duplicate-id");
    }

    let full = emptyTallyState();
    for (let index = 0; index < 24; index += 1) full = tallyReduce(full, add(`c${index}`, "C"));
    try {
      tallyReduce(full, add("one-too-many", "C"));
      expect.unreachable("a 25th counter must be refused");
    } catch (error) {
      expect((error as TallyError).code).toBe("counter-limit");
    }
  });
});

describe("undo and redo", () => {
  const built = apply(
    emptyTallyState(),
    add("a", "A"),
    { type: "bump", id: "a", direction: 1 },
    { type: "bump", id: "a", direction: 1 },
  );

  it("walks the whole history back and forward again", () => {
    expect(tallyCanUndo(built)).toBe(true);
    expect(tallyCanRedo(built)).toBe(false);
    expect(tallyCounter(built, "a")?.value).toBe(2);

    const undone = apply(built, { type: "undo" }, { type: "undo" });
    expect(tallyCounter(undone, "a")?.value).toBe(0);
    const emptied = tallyReduce(undone, { type: "undo" });
    expect(emptied.counters).toEqual([]);
    expect(tallyCanUndo(emptied)).toBe(false);

    const restored = apply(emptied, { type: "redo" }, { type: "redo" }, { type: "redo" });
    expect(restored.counters).toEqual(built.counters);
    expect(tallyCanRedo(restored)).toBe(false);
  });

  it("does nothing at either end of the history", () => {
    const empty = emptyTallyState();
    expect(tallyReduce(empty, { type: "undo" })).toEqual(empty);
    expect(tallyReduce(empty, { type: "redo" })).toEqual(empty);
  });

  it("drops the redo stack as soon as a new change lands", () => {
    const undone = tallyReduce(built, { type: "undo" });
    expect(tallyCanRedo(undone)).toBe(true);
    const branched = tallyReduce(undone, { type: "rename-counter", id: "a", name: "Drugi put" });
    expect(tallyCanRedo(branched)).toBe(false);
    expect(tallyCounter(branched, "a")?.name).toBe("Drugi put");
  });

  it("records nothing for a change that changed nothing", () => {
    const floored = apply(emptyTallyState(), add("a", "A", { floorZero: true }));
    expect(floored.past).toHaveLength(1);
    const bumped = tallyReduce(floored, { type: "bump", id: "a", direction: -1 });
    expect(bumped.past).toHaveLength(1);
    expect(tallyReduce(bumped, { type: "undo" }).counters).toEqual([]);
  });

  it("brings a removed counter back with its value", () => {
    const state = apply(
      emptyTallyState(),
      add("a", "A"),
      { type: "bump", id: "a", direction: 1 },
      { type: "bump", id: "a", direction: 1 },
      { type: "remove-counter", id: "a" },
    );
    const restored = tallyReduce(state, { type: "undo" });
    expect(tallyCounter(restored, "a")).toEqual({
      id: "a",
      name: "A",
      value: 2,
      step: 1,
      floorZero: false,
    });
  });
});
