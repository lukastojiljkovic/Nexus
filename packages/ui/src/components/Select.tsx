import { useId } from "react";
import type { SelectHTMLAttributes } from "react";
import { Icon } from "./Icon.js";

/**
 * The naming choice, as a type rather than as a rule somebody has to remember:
 * a rendered `label`, or an `aria-labelledby` pointing at text that is already
 * rendered. `?: never` on the other arm is what makes them exclusive — without
 * it an intersection would happily accept both and render a duplicate name.
 */
type SelectNaming =
  | { label: string; "aria-labelledby"?: never }
  | { label?: never; "aria-labelledby": string };

export type SelectProps = Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  "aria-label" | "aria-labelledby"
> &
  SelectNaming & {
    /** `stacked` puts the label above (a form), `inline` beside it (a controls row). */
    layout?: "stacked" | "inline";
  };

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
 * A NAME IS NOT OPTIONAL, and it is a choice of exactly two. `label` is
 * rendered, so the accessible name and the visible name are the same string by
 * construction. `aria-labelledby` is for the control whose name is already on
 * screen as somebody else's text — a column header, a settings row's own
 * heading — where a second rendered copy of that word is the defect. The type
 * is a union of those two and has no third member, so an unnamed select cannot
 * be spelled; there is still deliberately no `aria-label`, because a name only
 * a screen reader can hear is the exact defect this component replaces.
 *
 * The `aria-labelledby` arm used to be missing, and the doc said the case was
 * the call site's own business. It was: four call sites did it correctly, in raw
 * markup, and paid for the correct decision with the OS chevron, the wrong
 * ground and their own copy of the box — which is how a component that refuses
 * a legitimate case ends up policing only the call sites that never needed it.
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
export function Select({ label, layout = "stacked", id, className, children, ...rest }: SelectProps) {
  const generatedId = useId();
  const selectId = id ?? generatedId;
  const wrapper = layout === "inline" ? "nx-select nx-select--inline" : "nx-select";
  const control = className ? `nx-select__control ${className}` : "nx-select__control";
  return (
    <div className={wrapper}>
      {label !== undefined && (
        <label className="nx-select__label" htmlFor={selectId}>
          {label}
        </label>
      )}
      {/* The chevron is a real `Icon` laid over the control rather than the
          browser's own arrow: `appearance: none` takes the native one away so
          the closed control stops rendering as a Windows widget, and this puts
          the app's own shape back in its place. `aria-hidden` and
          `pointer-events: none` keep it decorative — the accessible control is
          still the `<select>`, and clicking the chevron still opens it. */}
      <span className="nx-select__field">
        <select id={selectId} className={control} {...rest}>
          {children}
        </select>
        <Icon name="chevronDown" size={15} className="nx-select__chevron" />
      </span>
    </div>
  );
}
