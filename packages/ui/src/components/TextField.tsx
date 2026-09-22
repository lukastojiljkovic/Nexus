import { useId } from "react";
import type { InputHTMLAttributes, Ref } from "react";

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Optional label rendered above the input, wired via htmlFor/id. */
  label?: string;
  /** `stacked` puts the label above (a form), `inline` beside it (a controls row). */
  layout?: "stacked" | "inline";
  /**
   * Extra classes for the rendered `<label>`, alongside `nx-textfield__label`.
   *
   * Podešavanja's search highlights the row a query matched by adding a class
   * to the name it draws, and that class is produced by `labelClass()` at the
   * call site. The component could not express it, so six settings rows drew
   * their own `<label>`, their own `<span>` and their own `<input>` to get one
   * — and the six turned out to be one skeleton with one defect between them:
   * the hint and the error sat INSIDE the wrapping `<label>`, so the accessible
   * name of two of those fields was the label and its explanation run together.
   * They are one component now (`SettingsField`), and this prop is the half of
   * it that only this component could supply.
   */
  labelClassName?: string;
  /**
   * The INPUT, not the wrapper — a caller reaching for this wants to focus or
   * select the control, never to measure the box.
   *
   * `Button` has had exactly this, with exactly this comment about React 19
   * accepting `ref` as a plain prop, since long before this line existed. Nine
   * call sites needed a ref on a text input and hand-wrote the whole
   * `<input className="nx-textfield__input">` to get one — CAL's title, TASK's
   * quick-add and subtask drafts, DOKUMENTI's name, FINANSIJE's amount,
   * LJUDI's name, UČENJE's subject, and both search surfaces — and every one
   * of them lost the label with it.
   */
  ref?: Ref<HTMLInputElement>;
}

/**
 * A labelled `<input>`.
 *
 * `layout` is the same prop, with the same two values and the same meaning, as
 * `Select`'s — and it arrived four months later, which is the reason it is
 * worth a comment. The two components are siblings that sit in the same rows,
 * and `Select` could say „my name goes BESIDE me" while this one could not; a
 * call site that wanted an inline pair therefore had exactly two moves, and
 * both were wrong. Hand-roll the `<label>` + `<span>` (which is what
 * `RecurrencePicker` did, and it drifted a whole tier), or keep the name in an
 * `aria-label` and let the row look tidy while saying nothing to anyone looking
 * at it. `FitNutrition`'s inline edit row had one of each, side by side, with a
 * comment on the select explaining that its label is visible „rather than
 * smuggled into an `aria-label`" — beside a field doing exactly that.
 *
 * `label` is still OPTIONAL here, unlike `Select`'s, and that is [[DC-120]]
 * rather than a decision: 38 of 143 call sites name themselves invisibly, and
 * the required-name contract lands once they do not. Adding the arrangement
 * first is deliberate — a call site cannot adopt a visible label until there is
 * a shape for the visible label to take.
 *
 * `className` lands on the WRAPPER (the opposite of `Select`, deliberately):
 * the pages that style a field style its box, and the box is this div.
 */
export function TextField({
  label,
  layout = "stacked",
  id,
  className,
  labelClassName,
  ref,
  ...rest
}: TextFieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const classes = ["nx-textfield"];
  if (layout === "inline") classes.push("nx-textfield--inline");
  if (className) classes.push(className);
  const labelClasses = ["nx-textfield__label"];
  if (labelClassName) labelClasses.push(labelClassName);
  return (
    <div className={classes.join(" ")}>
      {label != null && (
        <label className={labelClasses.join(" ")} htmlFor={inputId}>
          {label}
        </label>
      )}
      <input ref={ref} id={inputId} className="nx-textfield__input" {...rest} />
    </div>
  );
}
