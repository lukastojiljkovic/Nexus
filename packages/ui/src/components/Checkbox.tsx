import type { InputHTMLAttributes, ReactNode } from "react";

export interface CheckboxProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "children"> {
  /** Label rendered next to the box. */
  children?: ReactNode;
  /** Visual done-state: mutes and strikes the label. */
  done?: boolean;
}

export function Checkbox({ children, done, className, ...rest }: CheckboxProps) {
  const classes = ["nx-checkbox"];
  if (done) classes.push("nx-checkbox--done");
  if (className) classes.push(className);
  return (
    <label className={classes.join(" ")}>
      <input type="checkbox" {...rest} />
      {children != null && <span className="nx-checkbox__label">{children}</span>}
    </label>
  );
}
