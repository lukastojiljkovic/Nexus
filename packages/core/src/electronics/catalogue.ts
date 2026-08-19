/**
 * Every component the app ships with, and the two ways anything looks one up.
 *
 * Assembled from one file per kind rather than one long list, for the reason
 * `pro`'s toolkits are: the file a person edits is the file about the subject
 * they know. Concatenation order is the order the picker shows, and boards come
 * first because a circuit starts with one.
 *
 * **Nothing here is written to a database** (ADR-085 §3). A circuit's part row
 * stores the component's id, and this is what resolves it — `undefined` for an
 * id a later build no longer ships, which callers must handle rather than assume
 * away. A circuit drawn under an older catalogue is still a real circuit, and
 * that is precisely why the row keeps the id instead of a copy of the entry.
 */

import type { ComponentDef, ComponentKind } from "./component.js";
import { ACTUATORS } from "./catalogue/actuators.js";
import { BOARDS } from "./catalogue/boards.js";
import { COMMS } from "./catalogue/comms.js";
import { DISPLAYS } from "./catalogue/displays.js";
import { DRIVERS } from "./catalogue/drivers.js";
import { PASSIVES } from "./catalogue/passives.js";
import { POWER } from "./catalogue/power.js";
import { SENSORS } from "./catalogue/sensors.js";

export const COMPONENT_CATALOGUE: readonly ComponentDef[] = [
  ...BOARDS,
  ...SENSORS,
  ...ACTUATORS,
  ...DRIVERS,
  ...DISPLAYS,
  ...COMMS,
  ...POWER,
  ...PASSIVES,
];

const index = new Map(COMPONENT_CATALOGUE.map((component) => [component.id, component]));

/**
 * One component by id, or `undefined` for an id this build does not ship.
 *
 * The `undefined` is not a defect to be designed away: a profile can hold a
 * circuit whose part came from a build that had an entry this one dropped, and
 * the honest answer there is „this build does not know that part" rather than a
 * substitute nobody chose.
 */
export function catalogueComponent(id: string): ComponentDef | undefined {
  return index.get(id);
}

/** Everything of one kind, in catalogue order — what the picker's sections read. */
export function componentsOfKind(kind: ComponentKind): readonly ComponentDef[] {
  return COMPONENT_CATALOGUE.filter((component) => component.kind === kind);
}
