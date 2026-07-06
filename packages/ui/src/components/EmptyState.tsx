import type { ReactNode } from "react";

export interface EmptyStateProps {
  title: string;
  description?: string;
  /** Single action slot (e.g. a primary Button). */
  action?: ReactNode;
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="nx-empty">
      <div className="nx-empty__title">{title}</div>
      {description != null && <p className="nx-empty__desc">{description}</p>}
      {action != null && <div className="nx-empty__action">{action}</div>}
    </div>
  );
}
