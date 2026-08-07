import type { ReactNode } from "react";

/**
 * „There is nothing here" — in the TWO shapes that sentence actually takes.
 *
 * **`page`** is the whole surface being empty: centred, generous, an 18px title
 * and room for one action. It is the first thing somebody sees on a module they
 * have never used, and it is allowed to take space because there is nothing else
 * competing for it.
 *
 * **`inline`** is ONE list inside a populated page being empty: a quiet muted
 * line where the rows would be, left-aligned, no padding to speak of. A
 * dashboard card that said „Danas još nema upisanih obroka" in 18px centred type
 * with sixty-four pixels of air would be shouting about the one thing on it that
 * did not happen.
 *
 * The variant exists because the app had already grown the second shape three
 * separate times by hand — `dash__empty`, `ntf__empty`, `search__empty`, each a
 * near-copy of the other two — which is the „a rule written twice" class, and
 * the answer to it is one component with the arrangement as a field.
 */
export interface EmptyStateProps {
  title: string;
  description?: string;
  /** Single action slot (e.g. a primary Button). Ignored by `inline`, which has no room for one. */
  action?: ReactNode;
  /** `page` when the whole surface is empty (the default), `inline` when one list inside it is. */
  variant?: "page" | "inline";
}

export function EmptyState({ title, description, action, variant = "page" }: EmptyStateProps) {
  if (variant === "inline") {
    // One line, and the description folded onto it — an inline empty that grew a
    // second paragraph would be a page empty wearing the wrong class.
    return (
      <p className="nx-empty nx-empty--inline">
        {description == null ? title : `${title} ${description}`}
      </p>
    );
  }
  return (
    <div className="nx-empty">
      <div className="nx-empty__title">{title}</div>
      {description != null && <p className="nx-empty__desc">{description}</p>}
      {action != null && <div className="nx-empty__action">{action}</div>}
    </div>
  );
}
