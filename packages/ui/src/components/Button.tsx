import type { ButtonHTMLAttributes, Ref } from "react";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /**
   * `quiet` is the one that had been missing, and its absence was expensive:
   * a control that should read as a line of text rather than as a button —
   * „Vrati na podrazumevano", a disclosure, a licence toggle — had no
   * primitive, so Settings alone hand-rolled it three times. All three set
   * `padding: 0`, which is why all three shipped as tall as their own line box
   * and all three failed the 24px pointer floor. One variant, one floor.
   */
  variant?: "primary" | "ghost" | "danger" | "quiet";
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
