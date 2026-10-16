import type { ModulePageIntent } from "../../../shared/moduleApi.js";

/**
 * WHAT EACH KIT PAGE IS OWED: one FIFO queue per module, held by the shell until
 * the page of that module says it has it (ADR-114, ADR-117).
 *
 * **Why a queue, and not one held item.** One turn can ask a module's page to do
 * two things - an assistant turn whose tool results name two places, a citation
 * clicked while a reveal is still owed - and one slot answered that by
 * overwriting: the second request landed and the first was silently dropped.
 * Worse, a request aimed at one module must not clear what another module is
 * still owed, so the queue is keyed by module rather than being global: a
 * queued action for Canvas survives a later `app.open` of Tasks.
 *
 * **Why this is a value and not an event.** A citation's module page may not
 * exist yet when the citation is clicked: a kit page arrives in its own chunk,
 * so an event raised at the moment of the press would be heard by nobody. What
 * the shell does instead is HOLD the queue - `App.tsx` keeps what `enqueueIntent`
 * answered in state - and every render asks `intentForPage` what the page being
 * drawn is owed. A page that mounts a second later reads the same answer, and a
 * page that has already reported its head consumed is owed nothing.
 *
 * **Why a fresh value on every request.** Two presses of the same citation must
 * reveal it twice, and a page's effect keys off the prop's identity: reading the
 * SAME object back would leave a page that already consumed one reveal sitting
 * still on the second. So a request always builds a new intent object, and the
 * queue holds that one - a re-render of `App.tsx` for any other reason hands the
 * page the very same reference, which is what keeps the reveal from repeating
 * itself.
 *
 * **What this file does NOT decide.** Which modules a location may name, and what
 * an item or an action means to the module that gets it. The shell knows neither:
 * it hands the module its own item or its own verb, and the module reads it as it
 * reads its own ids.
 */

/** Module id → what its page has not consumed yet, oldest first. */
export type ItemIntents = ReadonlyMap<string, readonly ModulePageIntent[]>;

/** The empty queue. One shared value, so "nothing is owed" is one identity. */
export const NO_ITEM_INTENTS: ItemIntents = new Map();

/**
 * The two fields of a `nexus:open-location` request this file reads, both
 * `unknown` because the request arrives as a window event's detail, which is a
 * payload nobody type-checks on the way in - the same reason `App.tsx` reads
 * `module` and `settings` with `typeof`.
 */
export interface ItemIntentRequest {
  readonly item: unknown;
  readonly action: unknown;
}

/**
 * What one request asks the page of its module to do, or `null` when it asks for
 * nothing.
 *
 * An action wins over an item, because a location that carries both names a row
 * AND says what to do with it. An absent, empty or non-string item is not a
 * request to reveal something; an action whose `name` is not a non-empty string
 * is not a verb a page could apply; a request with neither is a bare move to the
 * module, which is the shell's job and not this queue's.
 */
export function requestIntent(request: ItemIntentRequest): ModulePageIntent | null {
  const item = itemOf(request.item);
  const action = actionOf(request.action);
  if (action !== null) {
    return item === null
      ? { kind: "action", action: action.name, payload: action.payload }
      : { kind: "action", action: action.name, payload: action.payload, item };
  }
  return item === null ? null : { kind: "reveal", item };
}

/**
 * The queue with one request added for `moduleId`.
 *
 * A request that names neither an item nor an action leaves the queue exactly as
 * it was - including every request other modules are still owed, which is the
 * defect this shape exists to end.
 */
export function enqueueIntent(
  queue: ItemIntents,
  moduleId: string,
  request: ItemIntentRequest,
): ItemIntents {
  const intent = requestIntent(request);
  if (intent === null) return queue;
  const next = new Map(queue);
  next.set(moduleId, [...(queue.get(moduleId) ?? []), intent]);
  return next;
}

/**
 * The head of `moduleId`'s queue: what its page is owed, or `null` for a page
 * owing nothing.
 *
 * Called on every render with the queue the shell is holding, rather than once
 * when the request arrives, which is what lets a page that mounts afterwards
 * still be handed it - and the same reference until the queue moves, so an
 * unrelated re-render of the shell cannot re-fire a page's intent effect.
 */
export function intentForPage(
  queue: ItemIntents,
  moduleId: string,
): ModulePageIntent | null {
  return queue.get(moduleId)?.[0] ?? null;
}

/**
 * The queue with `moduleId`'s head dropped, which is what a page's
 * `onIntentHandled` means: the page acted on what it was handed, so the next
 * request - or nothing - is what it is owed now. A module whose queue empties is
 * dropped from the map rather than left holding an empty list.
 */
export function dropIntent(queue: ItemIntents, moduleId: string): ItemIntents {
  const queued = queue.get(moduleId);
  if (queued === undefined) return queue;
  const rest = queued.slice(1);
  const next = new Map(queue);
  if (rest.length === 0) next.delete(moduleId);
  else next.set(moduleId, rest);
  return next;
}

/**
 * The queue with everything `moduleId` was owed dropped.
 *
 * Not `dropIntent` in a loop, and not the same situation: this is the shell
 * answering for a module whose page will never be drawn - switched off between
 * the request and the reveal - where leaving the rest of the queue behind would
 * hold a request waiting for a page that cannot report it handled.
 */
export function forgetIntents(queue: ItemIntents, moduleId: string): ItemIntents {
  if (!queue.has(moduleId)) return queue;
  const next = new Map(queue);
  next.delete(moduleId);
  return next;
}

/** The item a location named, or `null` when it named none this shell may act on. */
function itemOf(item: unknown): string | null {
  return typeof item === "string" && item !== "" ? item : null;
}

/** The action a location named, or `null` when it is not one a page could apply. */
function actionOf(value: unknown): { readonly name: string; readonly payload: unknown } | null {
  if (typeof value !== "object" || value === null) return null;
  const name = (value as { readonly name?: unknown }).name;
  if (typeof name !== "string" || name === "") return null;
  return { name, payload: (value as { readonly payload?: unknown }).payload };
}
