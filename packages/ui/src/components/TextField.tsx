import { useId } from "react";
import type { InputHTMLAttributes, Ref } from "react";

/**
 * Exactly one name, and it is REQUIRED.
 *
 * The defect this closes is a text field whose only name is invisible — 38 of
 * 143 call sites at the last census, one of them with no name at all. `Select`
 * answered the same question by requiring `label` and omitting `aria-label`
 * from its props, and for a select that is complete: every select in this app
 * stands in a form row where a caption belongs.
 *
 * A text input does not, and the census is the reason the contract is three
 * arms rather than one: a text field turns up in FOUR kinds of place, and only
 * one of them has somewhere to put a caption.
 *
 *   - A SEARCH BOX, whose visible name is its placeholder and whose caption
 *     would be the same words printed twice — DOKUMENTI, PRIVATNO, PODEŠAVANJA,
 *     the palette, the find bar's query, the tools rail.
 *   - A CELL OF A MARKDOWN GRID, named by its row and its column — the devtools
 *     text tool's header and body cells.
 *   - A FIELD IN A HEADED LIST, named by its POSITION: the ruling `definitions`
 *     reached for UČENJE's weekday boxes and TASK's list rows alike.
 *   - A FIELD IN A COMPACT INLINE FORM, named by the section's own word because
 *     the form appears where the row it makes will land — `InlineNameForm`'s
 *     recipe, which NOTES' folder, tag and category forms and its template pane
 *     share. This list said THREE until the census was counted again and the
 *     fourth was plainly already in it; a comment that enumerates less than the
 *     tree holds is how the next author reads the extra case as an escape hatch.
 *
 * None of those can draw a caption and none has an element to point at, so
 * `aria-label` is not an escape hatch here; it is the correct spelling for all
 * four, and a contract that forbade it would be a contract with exceptions.
 *
 * What the union makes unrepresentable is the two things that were actually
 * wrong: NO name, and the ambiguous state of naming a control twice — once
 * visibly and once invisibly, which is how a screen reader and the screen come
 * to disagree about what a field is called. Both become type errors, and each
 * arm says which of the three arrangements the caller chose.
 */
type TextFieldName =
  | { label: string; "aria-labelledby"?: never; "aria-label"?: never }
  | { label?: never; "aria-labelledby": string; "aria-label"?: never }
  | { label?: never; "aria-labelledby"?: never; "aria-label": string };

export type TextFieldProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "aria-label" | "aria-labelledby"
> &
  TextFieldName & {
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
};

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
 * **The name is REQUIRED now, and it was not until the last call site could
 * satisfy it.** `Select` could say „my name is the caption I draw" from the day
 * it was written and this component could not, so two siblings sat in the same
 * rows under two different contracts for four months; adding the `inline`
 * arrangement first was deliberate, because a call site cannot adopt a visible
 * label until there is a shape for the visible label to take. [[DC-120]] is
 * what closed the gap, and the arms are on `TextFieldName` above — three of
 * them, because a search box and a grid cell have no caption to draw and no
 * element to point at, and a contract that forbade `aria-label` would be a
 * contract with an exception list.
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
