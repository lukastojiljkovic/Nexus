import type { ButtonHTMLAttributes, Ref } from "react";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "ghost" | "danger";
  size?: "sm" | "md";
  /** React 19 accepts `ref` as a plain prop on function components — no `forwardRef` needed. A caller reaches for this to name a specific button as a dialog's initial-focus target (`useFocusTrap`'s `initialFocusRef`). */
  ref?: Ref<HTMLButtonElement>;
}

export function Button({
  variant = "ghost",
  size = "md",
  className,
  type,
  ref,
  ...rest
}: ButtonProps) {
  const classes = ["nx-button", `nx-button--${variant}`];
  if (size === "sm") classes.push("nx-button--sm");
  if (className) classes.push(className);
  return <button ref={ref} type={type ?? "button"} className={classes.join(" ")} {...rest} />;
}
