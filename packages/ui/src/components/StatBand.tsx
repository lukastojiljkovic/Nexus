import type { ReactNode } from "react";

/**
 * „How am I doing" — answered above the list, before „what is on it".
 *
 * A surface holding sixty tasks or three hundred transactions is unscannable by
 * construction; no amount of row craft fixes that, because the question a
 * person arrives with is not about any single row. What makes such a surface
 * usable is a small set of figures at the top that answers the question in the
 * time it takes to look, so the list below can be read deliberately instead of
 * searched anxiously.
 *
 * This is one component rather than a convention because six surfaces need it
 * at once and, left to themselves, would produce six subtly different bands —
 * the defect class this codebase has already paid for twice (three hand-rolled
 * empty states, four copies of the week-opening arithmetic). Here the type
 * scale, the alignment, the numeral treatment and the divider all live in one
 * place, and a page supplies only figures.
 *
 * TWO RULES ABOUT THE FIGURES THEMSELVES, and they are not stylistic:
 *
 *  1. **Never invent one.** Every value must be computed from data the page has
 *     genuinely loaded. A plausible number in a large typeface is the most
 *     damaging thing this component could be used to draw.
 *  2. **A lower bound is not a total.** If the source is lossy — a count that
 *     misses deleted rows, a sum over a truncated index — the `note` says so,
 *     in the same breath as the figure. A derived number whose source is lossy
 *     reads as a total unless the drawing says otherwise.
 */
export interface Stat {
  /** The 11px uppercase label above the figure. One or two words. */
  label: string;
  /**
   * The figure. A string, not a number, because the caller owns the
   * formatting: Serbian sets `1.234,56`, and a component that took a number
   * would either have to know the locale or would quietly render `1234.56`.
   */
  value: string;
  /** A unit or qualifier set beside the figure at caption size — „RSD", „min", „od 312". */
  unit?: string;
  /** One short line under the figure. The place a lower bound admits to being one. */
  note?: string;
  /** Tints the figure. `neutral` (the default) is right unless the number itself is good or bad news. */
  tone?: "neutral" | "data" | "danger" | "accent";
}

export interface StatBandProps {
  /** Three to five. Two is a sentence; six is a table with the labels on top. */
  stats: readonly Stat[];
  /** An optional graphic — a sparkline, a small chart — occupying the band's right end. */
  aside?: ReactNode;
  className?: string;
}

export function StatBand({ stats, aside, className }: StatBandProps) {
  return (
    <div className={className == null ? "nx-stat-band" : `nx-stat-band ${className}`}>
      <div className="nx-stat-band__stats">
        {stats.map((stat) => (
          <div className="nx-stat" key={stat.label}>
            <div className="nx-stat__label">{stat.label}</div>
            <div className={`nx-stat__value nx-stat__value--${stat.tone ?? "neutral"}`}>
              {stat.value}
              {stat.unit != null && <span className="nx-stat__unit">{stat.unit}</span>}
            </div>
            {stat.note != null && <div className="nx-stat__note">{stat.note}</div>}
          </div>
        ))}
      </div>
      {aside != null && <div className="nx-stat-band__aside">{aside}</div>}
    </div>
  );
}
