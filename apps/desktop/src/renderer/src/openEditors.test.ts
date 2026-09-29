import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EDITOR_FLUSH_GRACE_MS } from "../../shared/ipc.js";
import {
  answerEditorFlushRequests,
  flushOpenEditors,
  registerOpenEditor,
} from "./openEditors.js";

/**
 * Every exit waits for the editors it is about to tear down (DC-149). Two things
 * are pinned here: what `flushOpenEditors` promises an exit — it answers when
 * every write has, never later than the grace, and never with a failure — and,
 * at the bottom, that no write-behind editor can exist without registering.
 */

/** A promise the test settles by hand. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** Whether the promise has settled yet, read without waiting on it. */
function watch(promise: Promise<void>): { settled: () => boolean } {
  let done = false;
  void promise.then(() => {
    done = true;
  });
  return { settled: () => done };
}

describe("flushOpenEditors", () => {
  let unregister: (() => void)[];

  /** Registers for the length of one test, whatever it does. */
  const register = (flush: () => Promise<void>): void => {
    unregister.push(registerOpenEditor(flush));
  };

  beforeEach(() => {
    vi.useFakeTimers();
    unregister = [];
  });

  afterEach(() => {
    unregister.forEach((remove) => remove());
    vi.useRealTimers();
  });

  it("calls every registered flush", async () => {
    const calls: string[] = [];
    register(async () => void calls.push("a"));
    register(async () => void calls.push("b"));
    await flushOpenEditors();
    expect(calls.sort()).toEqual(["a", "b"]);
  });

  it("resolves only once every write has answered", async () => {
    const first = deferred();
    const second = deferred();
    register(() => first.promise);
    register(() => second.promise);
    const flushed = watch(flushOpenEditors());
    first.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(flushed.settled()).toBe(false);
    second.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(flushed.settled()).toBe(true);
    // The answer beat the grace, so nothing is left armed.
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not reject for a flush that rejects, or one that throws before it returns", async () => {
    const calls: string[] = [];
    register(() => Promise.reject(new Error("the write failed")));
    register(() => {
      throw new Error("no editor left to read");
    });
    register(async () => void calls.push("still ran"));
    await expect(flushOpenEditors()).resolves.toBeUndefined();
    expect(calls).toEqual(["still ran"]);
  });

  it("does not call a flush that was unregistered", async () => {
    const flush = vi.fn(async () => undefined);
    const remove = registerOpenEditor(flush);
    remove();
    await flushOpenEditors();
    expect(flush).not.toHaveBeenCalled();
  });

  it("gives up at the grace, and not a millisecond before, on a write that never answers", async () => {
    register(() => new Promise<void>(() => undefined));
    const flushed = watch(flushOpenEditors());
    await vi.advanceTimersByTimeAsync(EDITOR_FLUSH_GRACE_MS - 1);
    expect(flushed.settled()).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(flushed.settled()).toBe(true);
  });

  it("resolves at once, with no timer armed, when no editor is open", async () => {
    const flushed = watch(flushOpenEditors());
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(flushed.settled()).toBe(true);
  });
});

describe("answerEditorFlushRequests", () => {
  let request: (requestId: number) => void;
  let answered: number[];
  let unsubscribed: boolean;

  beforeEach(() => {
    vi.useFakeTimers();
    answered = [];
    unsubscribed = false;
    vi.stubGlobal("window", {
      nexus: {
        onEditorsFlushRequested: (listener: (requestId: number) => void) => {
          request = listener;
          return () => {
            unsubscribed = true;
          };
        },
        editorsFlushed: async (requestId: number) => {
          answered.push(requestId);
        },
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("answers a request with its own id once the open editors have written", async () => {
    const write = deferred();
    const remove = registerOpenEditor(() => write.promise);
    answerEditorFlushRequests();
    request(7);
    await vi.advanceTimersByTimeAsync(0);
    expect(answered).toEqual([]);
    write.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(answered).toEqual([7]);
    remove();
  });

  it("hands back the unsubscribe", () => {
    answerEditorFlushRequests()();
    expect(unsubscribed).toBe(true);
  });
});

/**
 * The executable form of DC-149. A registry an editor can forget to join is a
 * list somebody has to remember, and the editor that forgets is the one whose
 * last edit an exit loses — with nothing red anywhere, because the editor works,
 * typechecks and passes its own tests. So the rule is stated where it can be
 * checked: a module that constructs a write-behind — `OwedWrites` or
 * `CanvasAutosave` — must also register what it owes.
 */
describe("write-behind editors", () => {
  const SOURCES = dirname(fileURLToPath(import.meta.url));
  const WRITE_BEHIND = new Set(["OwedWrites", "CanvasAutosave"]);

  /**
   * Every renderer source that is not a test, read as an AST so that a comment
   * naming either class is not taken for a construction.
   */
  function scan(): { constructs: { file: string; write: string }[]; registers: Set<string> } {
    const constructs: { file: string; write: string }[] = [];
    const registers = new Set<string>();
    const files = readdirSync(SOURCES, { recursive: true, encoding: "utf8" })
      .filter((name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name))
      .sort();
    for (const name of files) {
      const kind = name.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
      const file = ts.createSourceFile(
        name,
        readFileSync(join(SOURCES, name), "utf8"),
        ts.ScriptTarget.Latest,
        true,
        kind,
      );
      const visit = (node: ts.Node): void => {
        if (
          ts.isNewExpression(node) &&
          ts.isIdentifier(node.expression) &&
          WRITE_BEHIND.has(node.expression.text)
        ) {
          constructs.push({ file: name, write: node.expression.text });
        }
        if (
          ts.isCallExpression(node) &&
          ts.isIdentifier(node.expression) &&
          node.expression.text === "registerOpenEditor"
        ) {
          registers.add(name);
        }
        ts.forEachChild(node, visit);
      };
      visit(file);
    }
    return { constructs, registers };
  }

  it("finds the editors it is written about", () => {
    // „Found nothing" must not be able to pass: the three editors that exist
    // today are NoteEditor, PrivNoteEditor and CanvasPage.
    expect(scan().constructs.length).toBeGreaterThanOrEqual(3);
  });

  it("registers every one it finds with the open-editor registry", () => {
    const { constructs, registers } = scan();
    const unregistered = constructs
      .filter(({ file }) => !registers.has(file))
      .map(({ file, write }) => `${file} constructs ${write} and never registers`);
    expect(unregistered).toEqual([]);
  });
});
