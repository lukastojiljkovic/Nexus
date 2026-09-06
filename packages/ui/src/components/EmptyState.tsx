import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon.js";

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
  /**
   * The module's mark, at 48px above the title — the same mark the page header
   * watermarks and the sidebar lists, at a third scale.
   *
   * It is the mark and not an illustration deliberately. An illustration that
   * does not explain the moment is decoration, and a drawn scene in an empty
   * state is the most reliable way to make a product look like a template. A
   * page's own sigil says WHICH surface is empty, which is the one thing the
   * reader needs and the title alone repeats.
   */
  sigil?: IconName;
}

export function EmptyState({
  title,
  description,
  action,
  variant = "page",
  sigil,
}: EmptyStateProps) {
  if (variant === "inline") {
    // One line, and the description folded onto it — an inline empty that grew a
    // second paragraph would be a page empty wearing the wrong class.
    //
    // The mark comes at 14px here rather than 48. An inline empty sits inside a
    // populated card whose caption has already named the module; at page size
    // the mark would be the loudest thing on a card that is reporting an
    // absence. At 14 it reads as the line's own bullet, which is what it is.
    return (
      <p className="nx-hint nx-empty nx-empty--inline">
        {sigil != null && (
          <span className="nx-empty__sigil nx-empty__sigil--inline" aria-hidden="true">
            <Icon name={sigil} size={14} />
          </span>
        )}
        {description == null ? title : `${title} ${description}`}
      </p>
    );
  }
  return (
    <div className="nx-empty">
      {sigil != null && (
        <span className="nx-empty__sigil" aria-hidden="true">
          <Icon name={sigil} size={48} />
        </span>
      )}
      <div className="nx-empty__title">{title}</div>
      {description != null && <p className="nx-empty__desc">{description}</p>}
      {action != null && <div className="nx-empty__action">{action}</div>}
    </div>
  );
}
