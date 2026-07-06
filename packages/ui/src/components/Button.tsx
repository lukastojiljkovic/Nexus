import type { ButtonHTMLAttributes } from "react";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "ghost" | "danger";
  size?: "sm" | "md";
}

export function Button({
  variant = "ghost",
  size = "md",
  className,
  type,
  ...rest
}: ButtonProps) {
  const classes = ["nx-button", `nx-button--${variant}`];
  if (size === "sm") classes.push("nx-button--sm");
  if (className) classes.push(className);
  return <button type={type ?? "button"} className={classes.join(" ")} {...rest} />;
}
