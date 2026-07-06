import { useId } from "react";
import type { InputHTMLAttributes } from "react";

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Optional label rendered above the input, wired via htmlFor/id. */
  label?: string;
}

export function TextField({ label, id, className, ...rest }: TextFieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const classes = ["nx-textfield"];
  if (className) classes.push(className);
  return (
    <div className={classes.join(" ")}>
      {label != null && (
        <label className="nx-textfield__label" htmlFor={inputId}>
          {label}
        </label>
      )}
      <input id={inputId} className="nx-textfield__input" {...rest} />
    </div>
  );
}
