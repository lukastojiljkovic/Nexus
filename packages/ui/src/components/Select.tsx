import { useId } from "react";
import type { SelectHTMLAttributes } from "react";

/**
 * A `<select>` that cannot ship without a visible label.
 *
 * **Why this exists.** `TextField` has carried a label since the first week, so
 * every text input in the app has one. A `<select>` never had a primitive, so
 * every page wrote raw markup and invented its own labelling — a wrapping
 * `<label>` here, a bare `aria-label` there, nothing at all somewhere else. An
 * audit on 2026-08-07 found 39 of the app's 74 selects with no visible label at
 * all: the control announced itself to a screen reader and said nothing to
 * everyone else. That is not thirty-nine mistakes, it is one missing component.
 *
 * `label` is REQUIRED and is rendered, so the accessible name and the visible
 * name are the same string by construction. There is deliberately no
 * `aria-label` escape hatch: a control whose only name is invisible is the exact
 * defect this replaces, and a control legitimately named by nearby text (a
 * column header, a row's own heading) wants `aria-labelledby` pointing at that
 * text — which is that call site's own decision and not something to smuggle
 * through here.
 *
 * `layout` is the one arrangement choice, and both arrangements are labelled.
 * `stacked` is the form default, matching `TextField`. `inline` is for a
 * controls row — four stacked labels would double the height of a filter bar
 * that has to stay one line.
 *
 * `className` lands on the CONTROL rather than the wrapper (the opposite of
 * `TextField`, deliberately): every page that already styles a select styles the
 * element itself, so adopting this component leaves those rules working.
 */
export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "aria-label"> {
  /** Rendered, and therefore also the accessible name. Not optional — see the component's own doc. */
  label: string;
  /** `stacked` puts the label above (a form), `inline` beside it (a controls row). */
  layout?: "stacked" | "inline";
}

export function Select({ label, layout = "stacked", id, className, children, ...rest }: SelectProps) {
  const generatedId = useId();
  const selectId = id ?? generatedId;
  const wrapper = layout === "inline" ? "nx-select nx-select--inline" : "nx-select";
  const control = className ? `nx-select__control ${className}` : "nx-select__control";
  return (
    <div className={wrapper}>
      <label className="nx-select__label" htmlFor={selectId}>
        {label}
      </label>
      <select id={selectId} className={control} {...rest}>
        {children}
      </select>
    </div>
  );
}
