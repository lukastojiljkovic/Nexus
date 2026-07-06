import type { ReactNode } from "react";

export interface KanbanColumnProps {
  title: string;
  count?: number;
  children?: ReactNode;
}

export function KanbanColumn({ title, count, children }: KanbanColumnProps) {
  return (
    <div className="nx-kanban-col">
      <div className="nx-kanban-col__head">
        <span>{title}</span>
        {count != null && (
          <span className="nx-kanban-col__count">{count}</span>
        )}
      </div>
      {children}
    </div>
  );
}

export interface KanbanCardProps {
  children: ReactNode;
  /** Small meta line under the card body (dates, counts). */
  tag?: ReactNode;
}

export function KanbanCard({ children, tag }: KanbanCardProps) {
  return (
    <div className="nx-kanban-card">
      <div>{children}</div>
      {tag != null && <div className="nx-kanban-card__tag">{tag}</div>}
    </div>
  );
}
