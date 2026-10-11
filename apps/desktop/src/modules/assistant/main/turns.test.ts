import { describe, expect, it } from "vitest";
import type { AssistantTurnEventView } from "../shared/ipc.js";
import {
  ConfirmPark,
  MAX_TURN_EVENTS,
  TurnBusyError,
  TurnLog,
  TurnRegistry,
} from "./turns.js";

/**
 * THE TURN BUFFER'S RULES (ADR-106): what a cursor means, where a second turn is
 * refused, and how a parked question is answered. All three are pure, so they are
 * pinned here with the values they produce - no model, no database, no Electron.
 */

const token = (text: string): AssistantTurnEventView => ({ type: "token", text });

describe("TurnLog", () => {
  it("numbers events from one and answers everything after the cursor", () => {
    const log = new TurnLog("turn-1", "p1", "c1");
    expect(log.emit(token("Zdra"))?.seq).toBe(1);
    log.emit(token("vo"));
    log.emit(token("!"));
    expect(log.lastSeq()).toBe(3);

    const first = log.poll(0);
    expect(first.events.map((entry) => entry.seq)).toEqual([1, 2, 3]);
    expect(first.nextCursor).toBe(3);
    expect(first.done).toBe(false);
    expect(first.thread).toBeNull();

    // Asking from the cursor it answered is what the page does next, and it
    // reads nothing twice.
    expect(log.poll(first.nextCursor).events).toEqual([]);
    expect(log.poll(first.nextCursor).nextCursor).toBe(3);
  });

  it("answers only the tail after a cursor the page had already read", () => {
    const log = new TurnLog("turn-1", "p1", "c1");
    log.emit(token("a"));
    log.emit(token("b"));
    log.emit(token("c"));
    const tail = log.poll(2);
    expect(tail.events.map((entry) => entry.event)).toEqual([token("c")]);
    expect(tail.nextCursor).toBe(3);
  });

  it("clamps a cursor beyond the end rather than refusing it", () => {
    const log = new TurnLog("turn-1", "p1", "c1");
    log.emit(token("a"));
    const beyond = log.poll(99);
    expect(beyond.events).toEqual([]);
    expect(beyond.nextCursor).toBe(99);
    // A negative or non-integer cursor reads from the start, which is the answer
    // that keeps a stale page polling instead of erroring out of a live turn.
    expect(log.poll(-5).events.map((entry) => entry.seq)).toEqual([1]);
    expect(log.poll(Number.NaN).events.map((entry) => entry.seq)).toEqual([1]);
  });

  it("keeps every event readable once the turn is finished", () => {
    const log = new TurnLog("turn-1", "p1", "c1");
    log.emit(token("a"));
    log.finish();
    expect(log.isFinished()).toBe(true);
    const read = log.poll(0);
    expect(read.done).toBe(true);
    expect(read.events).toHaveLength(1);
  });

  it("stops buffering at the cap and says so", () => {
    const log = new TurnLog("turn-1", "p1", "c1");
    for (let index = 0; index < MAX_TURN_EVENTS; index += 1) {
      expect(log.emit(token(String(index)))).not.toBeNull();
    }
    expect(log.emit(token("one too many"))).toBeNull();
    expect(log.didOverflow()).toBe(true);
    expect(log.size()).toBe(MAX_TURN_EVENTS);
    expect(log.lastSeq()).toBe(MAX_TURN_EVENTS);
  });
});

describe("TurnRegistry", () => {
  let next = 0;
  const registry = (): TurnRegistry => {
    next = 0;
    return new TurnRegistry(() => `turn-${(next += 1)}`);
  };

  it("refuses a second turn for one profile, naming the one that is running", () => {
    const turns = registry();
    const first = turns.open("p1", "c1");
    expect(first.id).toBe("turn-1");
    expect(turns.runningTurn("p1")).toBe("turn-1");
    let caught: unknown;
    try {
      turns.open("p1", "c2");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(TurnBusyError);
    expect((caught as TurnBusyError).turnId).toBe("turn-1");
    expect((caught as Error).message).toContain("turn-1");
  });

  it("lets two profiles run one turn each, and frees a profile when its turn finishes", () => {
    const turns = registry();
    turns.open("p1", "c1");
    expect(turns.open("p2", "c2").id).toBe("turn-2");
    turns.finish("p1", "turn-1");
    expect(turns.runningTurn("p1")).toBeNull();
    // The finished turn's events are still readable; only the profile is free again.
    expect(turns.get("turn-1")?.isFinished()).toBe(true);
    expect(turns.open("p1", "c3").id).toBe("turn-3");
  });

  it("forgets a turn when a page has read it, and every one of a profile at a session end", () => {
    const turns = registry();
    const first = turns.open("p1", "c1");
    first.emit(token("a"));
    turns.finish("p1", first.id);
    turns.close(first.id);
    expect(turns.get(first.id)).toBeNull();

    turns.open("p1", "c2");
    turns.open("p2", "c3");
    turns.closeProfile("p1");
    expect(turns.ids()).toEqual(["turn-3"]);
    expect(turns.runningTurn("p1")).toBeNull();
  });
});

describe("ConfirmPark", () => {
  it("answers a parked question once, with what the user said", async () => {
    const park = new ConfirmPark();
    const answer = park.park("ask-1");
    expect(park.size()).toBe(1);
    expect(park.answer("ask-1", true)).toBe(true);
    await expect(answer).resolves.toBe(true);
    expect(park.size()).toBe(0);
    // A second answer reaches nothing, which is what makes a double click safe.
    expect(park.answer("ask-1", false)).toBe(false);
  });

  it("answers false for an id nobody parked, and refuses every parked question on a stop", async () => {
    const park = new ConfirmPark();
    expect(park.answer("nobody", true)).toBe(false);
    const first = park.park("a");
    const second = park.park("b");
    park.refuseAll();
    await expect(first).resolves.toBe(false);
    await expect(second).resolves.toBe(false);
    expect(park.size()).toBe(0);
    // A refusal is an answer: the ids are forgotten, so answering them again does
    // nothing rather than resolving a promise twice.
    expect(park.answer("a", true)).toBe(false);
  });
});
