import { useMemo, useState } from "react";
import type { ComponentDef } from "@nexus/core";
import { TextField } from "@nexus/ui";

import { filterComponents, groupComponentsByKind } from "./elecCatalogue.js";
import { componentName, componentSummary } from "./elecLocale.js";
import { countUnit, lookup, strings } from "./strings.js";
// The drawer's own number formatter, imported rather than restated: it follows
// the ACTIVE interface locale, and a second `Intl` here would be a second answer
// to „how does a number look" — the decimal mark would drift the first time
// somebody corrected one of them.
import { formatToolNumber } from "./toolFormat.js";

export interface ElecPaletteProps {
  /** Everything that can be placed — the shipped catalogue today, plus the user's own components later. */
  components: readonly ComponentDef[];
  onAdd: (component: ComponentDef) => void;
  /** True while a write is in flight, so a double click cannot place two parts. */
  busy: boolean;
}

/**
 * The component drawer down the left of the workbench.
 *
 * **A flat search over a grouped list, not a tree.** 153 parts in eight kinds is
 * too many to scroll and far too few to need a hierarchy: the search is how
 * anybody who knows what they want gets there, and the groups are how somebody
 * who does not browses. Both are always visible, which is why the sections
 * narrow as the query does rather than the query filtering inside one open
 * section.
 *
 * The row IS the button. A list of names with an „+" beside each is two targets
 * for one intention, and the second one is 24 pixels wide.
 */
export function ElecPalette({ components, onAdd, busy }: ElecPaletteProps) {
  const s = strings.electronics.palette;
  const [query, setQuery] = useState("");

  const groups = useMemo(
    () => groupComponentsByKind(filterComponents(components, query)),
    [components, query],
  );

  return (
    <div className="elec-palette">
      <h2 className="elec-palette__title">{s.title}</h2>
      <TextField
        label={s.searchLabel}
        placeholder={s.searchPlaceholder}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {groups.length === 0 ? (
        <p className="elec-palette__empty">{s.empty}</p>
      ) : (
        <div className="elec-palette__list">
          {groups.map((group) => (
            <section key={group.kind} className="elec-palette__group">
              <h3 className="elec-palette__heading">{lookup(s.kinds, group.kind) ?? group.kind}</h3>
              {group.components.map((component) => (
                <button
                  key={component.id}
                  type="button"
                  className="elec-palette__row"
                  title={s.add}
                  disabled={busy}
                  onClick={() => onAdd(component)}
                >
                  <span className="elec-palette__name">{componentName(component)}</span>
                  <span className="elec-palette__summary">{componentSummary(component)}</span>
                  <span className="elec-palette__meta">{componentMeta(component)}</span>
                </button>
              ))}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The row's third line: how many pins, and what it wants to be fed.
 *
 * Both are the questions asked while choosing a part — „will it fit on the
 * header I have left" and „can this board even power it" — and both are already
 * in the catalogue, so the row states them rather than making somebody place
 * the part to find out. A supply is stated only when the part has one; a
 * resistor has nothing to be fed and a made-up figure for it would be the
 * current budget adding up a number nobody drew.
 */
function componentMeta(component: ComponentDef): string {
  const s = strings.electronics.palette;
  const pins = component.pins.length;
  const parts = [`${pins} ${countUnit(pins, s.pinsOne, s.pinsFew, s.pinsMany)}`];
  if (component.supply !== undefined) {
    const { min, max } = component.supply;
    const range =
      min === max
        ? formatToolNumber(min)
        : `${formatToolNumber(min)}–${formatToolNumber(max)}`;
    parts.push(`${s.supplyPrefix} ${range} V`);
  }
  return parts.join(" · ");
}
