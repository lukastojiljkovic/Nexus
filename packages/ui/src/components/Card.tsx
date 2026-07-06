import type { HTMLAttributes, ReactNode } from "react";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Widget-style uppercase caption title. */
  title?: string;
  children?: ReactNode;
}

export function Card({ title, children, className, ...rest }: CardProps) {
  const classes = ["nx-card"];
  if (className) classes.push(className);
  return (
    <div className={classes.join(" ")} {...rest}>
      {title != null && <div className="nx-card__title">{title}</div>}
      {children}
    </div>
  );
}
