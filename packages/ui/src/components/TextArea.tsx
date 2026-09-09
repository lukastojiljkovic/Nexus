import { useId } from "react";
import type { Ref, TextareaHTMLAttributes } from "react";

export interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Optional label rendered above the box, wired via htmlFor/id. */
  label?: string;
  /** The BOX, not the wrapper — a caller reaching for this wants to focus or select. */
  ref?: Ref<HTMLTextAreaElement>;
}

/**
 * A labelled `<textarea>`.
 *
 * `TextField` renders an `<input>`, so every multi-line field in the app was
 * written out by hand — and every one of them reached for
 * `nx-textfield__input` to get the box, because the box is right and there was
 * nothing else to ask for. Seven sites did it. The shared class was the honest
 * half; what came with it was not. Four of the seven then re-declared the SAME
 * three multi-line rules in four stylesheets (`resize: vertical`, a
 * `font-family`, `line-height: var(--nx-font-leading-normal)`), and six of the
 * seven had no label at all — a placeholder and an `aria-label`, which is
 * [[DC-120]] with a bigger box.
 *
 * There is no `layout` prop, unlike `TextField`'s, and that is a decision
 * rather than an omission: `inline` puts the name on the same line as the
 * control, and a five-row box has no line to share. A caption beside it would
 * sit against the top edge of something twelve times its height.
 *
 * `className` lands on the WRAPPER, `TextField`'s rule exactly — the pages
 * that style one of these style its box, and the box is this div. What the
 * call sites keep after adopting this is a `min-height` and, where the content
 * is code, a monospace face; both belong to the site and neither belongs here.
 */
export function TextArea({ label, id, className, ref, ...rest }: TextAreaProps) {
  const generatedId = useId();
  const areaId = id ?? generatedId;
  const classes = className ? `nx-textarea ${className}` : "nx-textarea";
  return (
    <div className={classes}>
      {label != null && (
        <label className="nx-textarea__label" htmlFor={areaId}>
          {label}
        </label>
      )}
      <textarea ref={ref} id={areaId} className="nx-textarea__input" {...rest} />
    </div>
  );
}
