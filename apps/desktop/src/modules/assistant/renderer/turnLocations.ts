import type { AppLocation } from "@nexus/core";
import type { AssistantTurnEventView } from "../shared/ipc.js";
import { manifest } from "../shared/manifest.js";

/**
 * WHERE A FINISHED TURN ASKS THE APP TO GO.
 *
 * **Why the locations are read at the END of the turn.** Opening a place means
 * leaving this page, and leaving this page unmounts it - whose cleanup stops the
 * turn (`Page.tsx` says why). Opening mid-turn would therefore kill the very
 * turn that asked to be taken somewhere, so the page collects what the turn
 * asked for and moves once, when the poll has read `done`: the answer is saved,
 * the draft is dropped, and then the view goes - and the page drawn at the end
 * is the last location's module.
 *
 * **Why a turn that ended badly opens nothing.** `no-model`, `model-failed`,
 * `step-limit`, `context-full` and the user's own stop all end the turn before
 * it did what it was asked, and a half-finished turn's last request is not a
 * place anybody asked to be. `tool-failed` is the one code the loop emits and
 * then carries on from (`loop.ts`: a tool that threw is answered as a result the
 * model can read), so it does not sink the navigation the rest of the turn produced.
 *
 * **Why a repeated place collapses, and only without an action.** Two calls that
 * name one page are one move, and queueing the same reveal twice would draw the
 * same row twice; but a location carrying an ACTION must be kept, because it is
 * a request to apply something and not a request to be somewhere.
 */
export function turnLocations(events: readonly AssistantTurnEventView[]): readonly AppLocation[] {
  if (events.some(endedTheTurn)) return [];
  const locations: AppLocation[] = [];
  for (const event of events) {
    if (event.type !== "tool-result") continue;
    const location = event.result.navigateTo;
    if (location === undefined) continue;
    // The assistant is a page like any other, and a turn that asks to be taken
    // to it asks for the page the user is already reading.
    if (location.module === manifest.id) continue;
    const previous = locations[locations.length - 1];
    if (
      location.action === undefined &&
      previous !== undefined &&
      samePlace(previous, location)
    ) {
      continue;
    }
    locations.push(location);
  }
  return locations;
}

/** The one error code the loop emits mid-turn and survives (`loop.ts`). */
const TOOL_FAILED = "tool-failed";

/** One `error` event, other than `tool-failed`, is a turn that stopped early. */
function endedTheTurn(event: AssistantTurnEventView): boolean {
  return event.type === "error" && event.code !== TOOL_FAILED;
}

/** The same place: the module, the item and the settings card, all three. */
function samePlace(left: AppLocation, right: AppLocation): boolean {
  return (
    left.module === right.module &&
    left.item === right.item &&
    left.settings === right.settings
  );
}
