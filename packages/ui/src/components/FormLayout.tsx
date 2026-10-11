import { useId } from "react";
import type { FormEventHandler, ReactNode } from "react";

export interface FormLayoutProps {
  /**
   * The form's own heading, when it has one — „Nova navika". Rendered as the
   * form's `h2` and used as the form's accessible name, so a screen reader user
   * who tabs into the first field hears which form they are in.
   */
  title?: string;
  /** The fields, in the order they are read. */
  children: ReactNode;
  /**
   * The submit row. The acting button first, the quiet way out second — the
   * order every dialog in the product already uses, so the same pair of
   * buttons is never the other way round on one surface.
   */
  actions?: ReactNode;
  onSubmit?: FormEventHandler<HTMLFormElement>;
  /** Extra class on the form, for a page that gives it its own frame. */
  className?: string;
}

/**
 * The frame of a form: one heading, one column, one submit row.
 *
 * **What it is not.** It is not the fields. Every box in the product is drawn by
 * `TextField`, `Select`, `TextArea` or `Checkbox`, and every field's name, help
 * and refusal are `Field`'s — so this component holds the three things that sit
 * BETWEEN those: the form's own heading, the vertical rhythm that makes a
 * column of fields read as one form rather than as a stack, and the row of
 * answers at the end.
 *
 * **Why the rhythm is not left to each page.** A form's `gap` is the smallest
 * decision in the whole pattern and the one with the most copies: the pages
 * this pattern was drawn from had four different field spacings, and the
 * difference is invisible until two forms are open in two windows. A page that
 * needs its own frame (a card around the form, a width) still passes its class
 * and keeps it: this component owns the inside, the page owns the outside.
 */
export function FormLayout({ title, children, actions, onSubmit, className }: FormLayoutProps) {
  const titleId = useId();
  const classes = ["nx-form"];
  if (className) classes.push(className);
  return (
    <form className={classes.join(" ")} onSubmit={onSubmit} aria-labelledby={title === undefined ? undefined : titleId}>
      {title !== undefined && (
        <h2 className="nx-form__title" id={titleId}>
          {title}
        </h2>
      )}
      {children}
      {actions !== undefined && <div className="nx-form__actions">{actions}</div>}
    </form>
  );
}
