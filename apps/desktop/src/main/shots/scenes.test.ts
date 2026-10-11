import { describe, expect, it } from "vitest";

import { createModuleRegistry } from "../../shared/modules.js";
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

describe("the pre-shell scenes", () => {
  const shells = SHOT_SCENES.filter((scene) => scene.kind === "shell");

  it("names the network choice, the questionnaire and the lock screen once each", () => {
    const ids = shells.map((scene) => scene.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("network");
    expect(ids).toContain("onboarding");
    expect(ids).toContain("lock");
  });

  it("runs the network scene before the first-run scene", () => {
    // It reloads and then ANSWERS the choice, so the file exists again for every
    // scene after it; the questionnaire is the other scene that rewrites this
    // profile, and it must run after the choice has settled.
    const ids = shells.map((scene) => scene.id);
    expect(ids.indexOf("network")).toBeLessThan(ids.indexOf("onboarding"));
  });
});

describe("the module pages", () => {
  /**
   * EVERY module the registry declares is landed on by some scene.
   *
   * This is the assertion the hand-written plan could not make and did not
   * notice it was not making: twenty-five module-kit modules were reachable
   * from the rail and named by no scene, so a sweep could run over the whole
   * product, print a clean headline and never have photographed them. The
   * generated list closes it today; this test is what keeps it closed, and it
   * fails on the day a module is added whose page nothing visits.
   *
   * It compares against `SHOT_SCENES` rather than against the plan, because
   * that is the list the sweep actually walks: a scene that is filtered out as
   * HELD takes its module with it, and this test is the one place that would
   * say so.
   */
  it("lands on every module the registry declares", () => {
    const landed = new Set(
      SHOT_SCENES.flatMap((scene) => (scene.kind === "shell" ? [] : [scene.module])),
    );
    const uncovered = createModuleRegistry()
      .all()
      .map((manifest) => manifest.id)
      .filter((id) => !landed.has(id));
    expect(uncovered).toEqual([]);
  });

  it("gives every scene its own id", () => {
    // A generated id is `page-<module>`; a hand-written one is a name somebody
    // chose. Two scenes sharing an id would make `NEXUS_SHOTS_SCENES=that-id`
    // run both, and the second would overwrite the first's frames while the
    // report counted two.
    const ids = SHOT_SCENES.map((scene) => scene.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
