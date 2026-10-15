import type { ModulePageIntent } from "../../../shared/moduleApi.js";

/**
 * THE ONE ITEM A LOCATION NAMES, held by the shell until a page says it has it
 * (ADR-114).
 *
 * **Why this is a value and not an event.** A citation's module page may not
 * exist yet when the citation is clicked: a kit page arrives in its own chunk,
 * so an event raised at the moment of the press would be heard by nobody. What
 * the shell does instead is HOLD the item — `App.tsx` keeps the result of
 * `holdItemIntent` in state — and every render asks `intentForPage` what the
 * page being drawn is owed. A page that mounts a second later reads the same
 * answer, and a page that has already reported the intent consumed is owed
 * nothing.
 *
 * **Why a fresh value on every request.** Two presses of the same citation must
 * reveal it twice, and a page's effect keys off the prop's identity: reading the
 * SAME object back would leave a page that already consumed one reveal sitting
 * still on the second. So a request always builds a new intent, and the shell
 * holds that one — a re-render of `App.tsx` for any other reason hands the page
 * the very same reference, which is what keeps the reveal from repeating itself.
 *
 * **What this file does NOT decide.** Which modules a location may name, and what
 * an item means to the module that gets it. The shell knows neither: it hands the
 * module its own item, and the module reads it as it reads its own ids.
 */

/** The module a location named, and the one thing the shell can hand its page. */
export interface HeldItemIntent {
  readonly module: string;
  readonly intent: ModulePageIntent;
}

/**
 * The intent one `nexus:open-location` request asks for, or `null` when it names
 * no item.
 *
 * `item` is `unknown` rather than `string` because the request arrives as a
 * window event's detail, which is a payload nobody type-checks on the way in —
 * the same reason `App.tsx` reads `module` and `settings` with `typeof`. An
 * absent or empty item is not a request to reveal something, so it holds nothing.
 */
export function holdItemIntent(moduleId: string, item: unknown): HeldItemIntent | null {
  if (typeof item !== "string" || item === "") return null;
  return { module: moduleId, intent: { kind: "reveal", item } };
}

/**
 * What the page of `moduleId` is owed, or `null` for every other page.
 *
 * Called on every render with the value the shell is holding, rather than once
 * when the request arrives, which is what lets a page that mounts afterwards
 * still be handed it.
 */
export function intentForPage(
  held: HeldItemIntent | null,
  moduleId: string,
): ModulePageIntent | null {
  return held !== null && held.module === moduleId ? held.intent : null;
}
