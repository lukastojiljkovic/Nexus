import type { HTMLAttributes } from "react";

export interface ChipProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: "neutral" | "data" | "accent" | "danger";
}

export function Chip({ variant = "neutral", className, ...rest }: ChipProps) {
  const classes = ["nx-chip"];
  if (variant !== "neutral") classes.push(`nx-chip--${variant}`);
  if (className) classes.push(className);
  return <span className={classes.join(" ")} {...rest} />;
}
