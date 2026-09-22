import { describe, expect, it } from "vitest";

import { SHOT_SCENES } from "./index.js";

/**
 * The scene scripts are STRINGS, for the reason `AUDIT_SCRIPT` is one: they run
 * in the renderer's world through `executeJavaScript`, so `tsc` sees an opaque
 * sequence of characters, ESLint sees the same, and the editor colours none of
 * it.
 *
 * `audit.test.ts` learned this the expensive way — a redeclaration inside that
 * string cost a six-minute build-and-sweep to find, and what it printed named
 * neither the line nor the file. These strings are worse in one respect: a
 * scene's `prepare` that throws does not stop the sweep. `evalIn` resolves, the
 * scene shoots the page it landed on, and the frame is an ordinary landing
 * filed under a name that says a fold is open. That is silence, not failure.
 *
 * `new Function` compiles and does not run, so this costs microseconds. It
 * cannot prove a probe FINDS what it is looking for — the run says „found
 * nothing to open" for that, and the frames say the rest — only that every one
 * of them is a program.
 */

const scripts = SHOT_SCENES.flatMap((scene) =>
  scene.kind === "shell"
    ? // A SHELL scene has no script fields to compile: its entry, its frames
      // and its exit are steps in `shootShellScene`, which is ordinary typed
      // TypeScript in `index.ts` and therefore not this suite's subject. What
      // the suite still owes them is the assertion above — a shell scene is in
      // the list like any other, and `NEXUS_SHOTS_SCENES` can name it.
      []
    : [
        ...(scene.prepare === undefined ? [] : [[`${scene.id}.prepare`, scene.prepare] as const]),
        ...(scene.cleanup === undefined ? [] : [[`${scene.id}.cleanup`, scene.cleanup] as const]),
      ],
);

describe("every scene script", () => {
  it("is a script somewhere in the plan, so this suite cannot pass vacuously", () => {
    expect(scripts.length).toBeGreaterThan(10);
  });

  it.each(scripts)("%s parses as JavaScript", (_id, code) => {
    expect(() => new Function(code)).not.toThrow();
  });

  /**
   * `evalIn` reports a probe that found nothing by looking at the RESOLVED
   * value, so a script whose completion value is not the expression is a probe
   * that can never say it missed. A leading `const`, or a stray `;`, still
   * parses and still runs.
   */
  it.each(scripts)("%s yields its own value rather than a statement's", (_id, code) => {
    expect(code.trimStart().startsWith("(")).toBe(true);
  });
});
