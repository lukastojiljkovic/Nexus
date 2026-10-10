import { cloneElement, useId, type ReactElement } from "react";
import type { ReactNode } from "react";

import { Icon } from "./Icon.js";

/** Everything one field's boxes have to agree on, derived from one base id. */
export interface FieldWiring {
  /** The one line of help, when the field has one. */
  readonly helpId: string;
  /** The refusal, when the field has one. */
  readonly errorId: string;
  /** Merged into the control. Nothing the control already had is removed. */
  readonly control: {
    readonly "aria-describedby"?: string;
    readonly "aria-required"?: true;
  };
}

/**
 * The id and ARIA algebra of a field, as a value rather than as markup.
 *
 * Three decisions live here, and they are the three the pattern exists to
 * state once:
 *
 *   - The description is the help line and then the refusal, in the order they
 *     are drawn, and it is MERGED with whatever the control already described
 *     itself with. A field whose control already points at a caption — a
 *     markdown grid cell named by its row — keeps that caption.
 *   - The refusal appears in an assertive live region as well (`FieldError`),
 *     so it is heard when it arrives whatever the order here.
 *   - The requirement is `aria-required`, never the native `required`
 *     attribute: the house forms validate in their own submit handler, and the
 *     native attribute would add the browser's own bubble to a page whose
 *     refusals are drawn in the page.
 */
export function fieldWiring(input: {
  readonly baseId: string;
  readonly required: boolean;
  readonly hasHelp: boolean;
  readonly hasError: boolean;
  readonly describedBy?: string | undefined;
}): FieldWiring {
  const { baseId, required, hasHelp, hasError, describedBy } = input;
  const helpId = `${baseId}-help`;
  const errorId = `${baseId}-error`;
  const ids = [
    describedBy,
    hasHelp ? helpId : null,
    hasError ? errorId : null,
  ].filter((id): id is string => id !== undefined && id !== null && id !== "");
  return {
    helpId,
    errorId,
    control: {
      ...(ids.length > 0 ? { "aria-describedby": ids.join(" ") } : {}),
      ...(required ? { "aria-required": true as const } : {}),
    },
  };
}

export interface FieldErrorProps {
  /** The id a control describes itself with, when this line refuses one field. */
  id?: string;
  /** Extra class on the line, for a page that places it in its own row. */
  className?: string;
  children: ReactNode;
}

/**
 * The one inline refusal.
 *
 * It is a component rather than a sentence for two reasons. The app had written
 * this line by hand eighteen times across nine stylesheets (`.hab__error`,
 * `.set__error`, `.fin__error`, `.doc-preview__error`, …), with more than one
 * treatment among them. And a refusal has two obligations a bare `<p>` cannot
 * state: it is announced when it appears (`role="alert"`, the house's one
 * assertive use), and it carries a SHAPE. Danger ink alone is the redundancy
 * rule's defect — so the line leads with the `warning` glyph, and a reader who
 * cannot tell garnet from paper still sees which line is the refusal.
 *
 * It stands on its own as well as inside a `Field`: a form whose refusal is
 * about the whole form rather than one control wants the same line with no id
 * and no control to point at.
 */
export function FieldError({ id, className, children }: FieldErrorProps) {
  const classes = ["nx-field__error"];
  if (className) classes.push(className);
  return (
    <p id={id} className={classes.join(" ")} role="alert">
      <span className="nx-field__error-mark" aria-hidden="true">
        <Icon name="warning" size={13} />
      </span>
      {children}
    </p>
  );
}

export interface FieldProps {
  /**
   * The control — `TextField`, `Select`, `TextArea` or `Checkbox` — which keeps
   * its own name and its own box. Nothing written on it is removed.
   */
  children: ReactElement<Record<string, unknown>>;
  /** Marks the field as required, visibly and to assistive technology. */
  required?: boolean;
  /** One line under the control: what the field wants, or what it accepts. */
  help?: string | undefined;
  /** The refusal, under the help line. */
  error?: string | undefined;
  /** Extra class on the wrapper, for a page that places the field in its own grid. */
  className?: string;
}

/**
 * One field: a name, a help line, a refusal, a required mark.
 *
 * **What it does not do is draw the control.** The box, and the label that
 * names it, belong to `TextField`, `Select`, `TextArea` and `Checkbox` — the
 * primitives whose label rule is stated once in this package — and this
 * component deliberately does not restate a name or repeat a label. A second
 * `<label>` here would be a second name for one control, which is the quietest
 * failure in the whole form layer: the screen and the screen reader then
 * disagree, and nothing goes red.
 *
 * What it adds is what a primitive does not have, and what the forms this
 * pattern was drawn from had each answered a different way:
 *
 *   - the HELP line, as the one explanation tier (`.nx-hint`), wired to the
 *     control with `aria-describedby`;
 *   - the REFUSAL line, as `FieldError`, wired the same way, announced when it
 *     appears, and carried onto the control's own border;
 *   - the REQUIRED mark, in the accent ink and after the primitive's own label,
 *     with `aria-required` on the control so it is announced as well as drawn.
 *
 * The mark is inserted by the stylesheet rather than written here as markup: it
 * belongs immediately after a name this component does not render, and an
 * insertion point is what keeps the two from being two pieces free to drift.
 */
export function Field({ children, required = false, help, error, className }: FieldProps) {
  const baseId = useId();
  const wiring = fieldWiring({
    baseId,
    required,
    hasHelp: help !== undefined,
    hasError: error !== undefined,
    describedBy: children.props["aria-describedby"] as string | undefined,
  });
  const classes = ["nx-field"];
  if (required) classes.push("nx-field--required");
  if (error !== undefined) classes.push("nx-field--invalid");
  if (className) classes.push(className);

  return (
    <div className={classes.join(" ")}>
      {cloneElement(children, wiring.control as Partial<Record<string, unknown>>)}
      {help !== undefined && (
        <p className="nx-hint nx-field__help" id={wiring.helpId}>
          {help}
        </p>
      )}
      {error !== undefined && <FieldError id={wiring.errorId}>{error}</FieldError>}
    </div>
  );
}
