/**
 * The tally counter (mini-apps, stage 1): one state value in, one state value
 * out, with undo and redo.
 *
 * The shape is deliberate and is the whole reason this is not a `useState` in a
 * page: `past` and `future` are stacks of the COUNTER LIST, not of the last
 * action, so undo cannot go wrong when an action touched more than one field,
 * and there is no half-applied inverse to write for a new counter field added
 * later. Nothing here reads a clock or a random source, so a session replays
 * exactly; the ids come from the caller, which is also what lets the tests name
 * their counters.
 *
 * A `bump` that changes nothing — the minus button on a counter already at zero
 * with the floor on — records NO history entry, because a stack that grows when
 * nothing happened makes the user press undo twice to see one change. The same
 * rule covers a rename to the same name and a step set to the value it already
 * had.
 */

import { MAX_ID_LENGTH } from "../ids.js";

/** Counter limits, stated here because stage 2's IPC layer validates against them too. */
export const TALLY_MAX_COUNTERS = 24;
export const TALLY_MAX_NAME_LENGTH = 60;
export const TALLY_MAX_STEP = 1000;

export type TallyErrorCode =
  | "id"
  | "name"
  | "step"
  | "value"
  | "counter-limit"
  | "duplicate-id"
  | "unknown-counter";

/** An action no counter can carry out, named so stage 2 can turn the code into its own copy. */
export class TallyError extends Error {
  readonly code: TallyErrorCode;

  constructor(code: TallyErrorCode, message: string) {
    super(message);
    this.name = "TallyError";
    this.code = code;
  }
}

export interface TallyCounter {
  readonly id: string;
  readonly name: string;
  readonly value: number;
  /** How much one press moves the value, at least 1. */
  readonly step: number;
  /** When true the value never goes below zero. Off by default: the brief calls it optional. */
  readonly floorZero: boolean;
}

export interface TallyState {
  readonly counters: readonly TallyCounter[];
  /** The counter list before each change, oldest first. */
  readonly past: readonly (readonly TallyCounter[])[];
  /** Undone counter lists, the next redo last. */
  readonly future: readonly (readonly TallyCounter[])[];
}

export type TallyAction =
  | {
      readonly type: "add-counter";
      readonly id: string;
      readonly name: string;
      readonly step?: number;
      readonly floorZero?: boolean;
    }
  | { readonly type: "rename-counter"; readonly id: string; readonly name: string }
  | { readonly type: "set-step"; readonly id: string; readonly step: number }
  | { readonly type: "set-floor"; readonly id: string; readonly floorZero: boolean }
  /** One press of the plus or minus button; the counter's own step is applied. */
  | { readonly type: "bump"; readonly id: string; readonly direction: 1 | -1 }
  | { readonly type: "set-value"; readonly id: string; readonly value: number }
  | { readonly type: "remove-counter"; readonly id: string }
  | { readonly type: "undo" }
  | { readonly type: "redo" };

export function emptyTallyState(): TallyState {
  return { counters: [], past: [], future: [] };
}

function assertId(id: string): void {
  if (typeof id !== "string" || id.trim() === "") {
    throw new TallyError("id", "a counter needs an id");
  }
  if (id.length > MAX_ID_LENGTH) throw new TallyError("id", "the counter id is too long");
}

function assertName(name: string): string {
  const trimmed = name.trim();
  if (trimmed === "") throw new TallyError("name", "a counter needs a name");
  if (trimmed.length > TALLY_MAX_NAME_LENGTH) {
    throw new TallyError("name", `a counter name holds ${TALLY_MAX_NAME_LENGTH} characters at most`);
  }
  return trimmed;
}

function assertStep(step: number): void {
  if (!Number.isInteger(step) || step < 1 || step > TALLY_MAX_STEP) {
    throw new TallyError("step", `a step is a whole number from 1 to ${TALLY_MAX_STEP}`);
  }
}

function assertValue(value: number): void {
  if (!Number.isSafeInteger(value)) {
    throw new TallyError("value", "a tally counts whole numbers");
  }
}

export function tallyCounter(state: TallyState, id: string): TallyCounter | undefined {
  return state.counters.find((counter) => counter.id === id);
}

function requireCounter(state: TallyState, id: string): TallyCounter {
  const counter = tallyCounter(state, id);
  if (counter === undefined) throw new TallyError("unknown-counter", `no counter ${id}`);
  return counter;
}

/** The sum of every counter's value — what the page shows under the column. */
export function tallyTotal(state: TallyState): number {
  return state.counters.reduce((sum, counter) => sum + counter.value, 0);
}

export function tallyCanUndo(state: TallyState): boolean {
  return state.past.length > 0;
}

export function tallyCanRedo(state: TallyState): boolean {
  return state.future.length > 0;
}

/** Records `counters` as the present, keeping the old present for undo and dropping any redo. */
function commit(state: TallyState, counters: readonly TallyCounter[]): TallyState {
  return { counters, past: [...state.past, state.counters], future: [] };
}

/** Replaces one counter, leaving the others' objects untouched. */
function withCounter(
  state: TallyState,
  id: string,
  replace: (counter: TallyCounter) => TallyCounter,
): readonly TallyCounter[] {
  return state.counters.map((counter) => (counter.id === id ? replace(counter) : counter));
}

/**
 * The reducer. Every mutating action either produces a state the page can show
 * or raises `TallyError`; nothing is silently ignored, because a counter that
 * did not move is the one bug a tally page cannot show the user.
 */
export function tallyReduce(state: TallyState, action: TallyAction): TallyState {
  switch (action.type) {
    case "undo": {
      const previous = state.past[state.past.length - 1];
      if (previous === undefined) return state;
      return {
        counters: previous,
        past: state.past.slice(0, -1),
        future: [...state.future, state.counters],
      };
    }
    case "redo": {
      const next = state.future[state.future.length - 1];
      if (next === undefined) return state;
      return {
        counters: next,
        past: [...state.past, state.counters],
        future: state.future.slice(0, -1),
      };
    }
    case "add-counter": {
      assertId(action.id);
      if (state.counters.some((counter) => counter.id === action.id)) {
        throw new TallyError("duplicate-id", `there is already a counter ${action.id}`);
      }
      if (state.counters.length >= TALLY_MAX_COUNTERS) {
        throw new TallyError("counter-limit", `a board holds ${TALLY_MAX_COUNTERS} counters at most`);
      }
      const step = action.step ?? 1;
      assertStep(step);
      return commit(state, [
        ...state.counters,
        {
          id: action.id,
          name: assertName(action.name),
          value: 0,
          step,
          floorZero: action.floorZero ?? false,
        },
      ]);
    }
    case "rename-counter": {
      const counter = requireCounter(state, action.id);
      const name = assertName(action.name);
      if (name === counter.name) return state;
      return commit(state, withCounter(state, action.id, (held) => ({ ...held, name })));
    }
    case "set-step": {
      const counter = requireCounter(state, action.id);
      assertStep(action.step);
      if (action.step === counter.step) return state;
      return commit(state, withCounter(state, action.id, (held) => ({ ...held, step: action.step })));
    }
    case "set-floor": {
      const counter = requireCounter(state, action.id);
      if (action.floorZero === counter.floorZero) return state;
      return commit(
        state,
        withCounter(state, action.id, (held) => ({ ...held, floorZero: action.floorZero })),
      );
    }
    case "bump": {
      const counter = requireCounter(state, action.id);
      if (action.direction !== 1 && action.direction !== -1) {
        throw new TallyError("step", "a bump moves up or down by one press");
      }
      const moved = counter.value + action.direction * counter.step;
      const value = counter.floorZero && moved < 0 ? 0 : moved;
      if (value === counter.value) return state;
      return commit(state, withCounter(state, action.id, (held) => ({ ...held, value })));
    }
    case "set-value": {
      const counter = requireCounter(state, action.id);
      assertValue(action.value);
      const value = counter.floorZero && action.value < 0 ? 0 : action.value;
      if (value === counter.value) return state;
      return commit(state, withCounter(state, action.id, (held) => ({ ...held, value })));
    }
    case "remove-counter": {
      requireCounter(state, action.id);
      return commit(
        state,
        state.counters.filter((counter) => counter.id !== action.id),
      );
    }
  }
}
