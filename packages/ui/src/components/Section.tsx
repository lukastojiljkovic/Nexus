import type { ReactNode } from "react";

/** The heading levels a section's caption can take. */
export type SectionLevel = 2 | 3 | 4;

/**
 * The element a section's caption is drawn with.
 *
 * A caption with no level is a paragraph and not a heading: the document outline
 * is the list of headings a screen reader offers, and a caption that only looks
 * like one belongs in no outline at all. The ink and size are the `.nx-eyebrow`
 * tier at every level, because the level says what the caption IS in the
 * document and never how it is drawn.
 */
export function sectionCaptionTag(level: SectionLevel | undefined): "p" | "h2" | "h3" | "h4" {
  const tags = { 2: "h2", 3: "h3", 4: "h4" } as const;
  return level === undefined ? "p" : tags[level];
}

export interface SectionProps {
  /** The group's name, drawn as the eyebrow caption above its rows. */
  title: string;
  /** The heading level of the caption, when the section is one the outline should list. */
  level?: SectionLevel | undefined;
  /** Controls that act on this group alone, at the caption's right. */
  actions?: ReactNode;
  className?: string | undefined;
  children: ReactNode;
}

/**
 * A named group of rows on a page or inside a card, with one way of naming it.
 *
 * Section titles had been drawn with four devices: a card's own caption, an
 * eyebrow on a span, a module-prefixed heading class and a bare `h3`, so the
 * outline differed from page to page and the same tier was three inks. This is
 * the caption tier, with the heading level as a decision the caller makes rather
 * than a side effect of which class it reached for.
 */
export function Section({ title, level, actions, className, children }: SectionProps) {
  const Caption = sectionCaptionTag(level);
  const classes = ["nx-section"];
  if (className != null) classes.push(className);
  return (
    <div className={classes.join(" ")}>
      <div className="nx-section__head">
        <Caption className="nx-eyebrow nx-section__title">{title}</Caption>
        {actions != null && <div className="nx-section__actions">{actions}</div>}
      </div>
      {children}
    </div>
  );
}
