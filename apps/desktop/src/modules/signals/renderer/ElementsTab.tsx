import { useState } from "react";
import { Card } from "@nexus/ui";
import { ELEMENTS, type Element } from "@nexus/core";
import { numberFormat } from "../../../renderer/src/moduleKit/moduleSurface.js";
import { copy } from "./copy.js";

/**
 * THE PERIODIC TABLE: the 118 elements on the standard grid, with the two f-block
 * rows under it, and one card for the element that is selected.
 *
 * **The grid is the element's own position, and nothing is laid out by hand.**
 * Group and period are the engine's values; a lanthanide or an actinide has no
 * group and sits in one of the two rows beneath the table, from the third column,
 * in the order of its number. The tile is a button, so the table is reached with the keyboard
 * and every tile says which element it is.
 *
 * **The names are English.** The dataset carries English names only, and no
 * Serbian list was sourced for this table, so the tab says so rather than
 * translating a name from memory.
 */

/** The grid cell an element sits in: its group and period, or the f-block row beneath the table. */
function cellOf(element: Element): { readonly column: number; readonly row: number } {
  if (element.group !== null) return { column: element.group, row: element.period };
  // The lanthanides are 57 to 71 and the actinides 89 to 103; each row starts at the third column.
  return element.category === "lanthanide"
    ? { column: element.number - 54, row: 9 }
    : { column: element.number - 86, row: 10 };
}

export function ElementsTab() {
  const [selected, setSelected] = useState(1);
  const element = ELEMENTS[selected - 1] ?? ELEMENTS[0];

  return (
    <>
      <Card className="signals__card" title={copy.elements.title}>
        <p className="nx-hint">{copy.elements.hint}</p>
        <div className="signals__table-wrap">
          <div className="signals__elements" role="group" aria-label={copy.elements.title}>
            {ELEMENTS.map((entry) => {
              const { column, row } = cellOf(entry);
              return (
                <button
                  key={entry.number}
                  type="button"
                  className="signals__element"
                  aria-label={`${entry.number} ${entry.name}`}
                  aria-pressed={entry.number === selected}
                  style={{ gridColumn: column, gridRow: row }}
                  onClick={() => {
                    setSelected(entry.number);
                  }}
                >
                  <span className="signals__element-number">{entry.number}</span>
                  <span className="signals__element-symbol">{entry.symbol}</span>
                </button>
              );
            })}
          </div>
        </div>
        <p className="nx-hint">{copy.elements.nameNote}</p>
      </Card>

      {element !== undefined && (
        <Card className="signals__card" title={element.name}>
          <dl className="signals__facts">
            <dt>{copy.elements.symbol}</dt>
            <dd className="signals__code">{element.symbol}</dd>
            <dt>{copy.elements.number}</dt>
            <dd className="signals__code">{element.number}</dd>
            <dt>{copy.elements.mass}</dt>
            <dd className="signals__code">
              {numberFormat({ maximumFractionDigits: 4 }).format(element.mass)}
            </dd>
            <dt>{copy.elements.group}</dt>
            <dd className="signals__code">{element.group ?? copy.elements.noGroup}</dd>
            <dt>{copy.elements.period}</dt>
            <dd className="signals__code">{element.period}</dd>
            <dt>{copy.elements.category}</dt>
            <dd>{copy.elements.categories[element.category]}</dd>
          </dl>
        </Card>
      )}
    </>
  );
}
