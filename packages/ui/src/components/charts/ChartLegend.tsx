import type { ChartLevel, ChartTone } from "./CellMatrix.js";

/**
 * The enforcement point for "state is never carried by colour alone". Every
 * entry pairs its tone with a distinct SHAPE — a matrix's swatch, a line
 * chart's stroke, a reference rule's dash, a lane's tick — so a reader who
 * cannot distinguish the hues still has a second channel that names the
 * difference.
 */
export interface ChartLegendItem {
  label: string;
  tone: ChartTone;
  /** Matches a `CellMatrix` cell's intensity. Only meaningful for "swatch"; defaults to full intensity. */
  level?: ChartLevel;
  shape: "swatch" | "line" | "dash" | "tick";
}

export interface ChartLegendProps {
  items: readonly ChartLegendItem[];
  /** A single wrapped row instead of the default stacked column — for a tight caption-line legend under a card. */
  inline?: boolean;
}

export function ChartLegend({ items, inline = false }: ChartLegendProps) {
  return (
    <ul className={`nx-legend${inline ? " nx-legend--inline" : ""}`}>
      {items.map((item, i) => (
        <li key={i} className="nx-legend__item">
          <svg className="nx-legend__glyph" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            {item.shape === "swatch" && (
              // Reuses CellMatrix's own `.nx-cell` recipe verbatim, so a
              // legend swatch is pixel-true to the matrix cell it explains
              // rather than a hand-tuned approximation that can drift from it.
              <rect
                className={`nx-cell nx-cell--${item.tone} nx-cell--l${item.level ?? 3}`}
                x="1"
                y="1"
                width="12"
                height="12"
                rx="2.5"
              />
            )}
            {item.shape === "line" && (
              <line className={`nx-legend__mark-line nx-tone--${item.tone}`} x1="0" y1="7" x2="14" y2="7" />
            )}
            {item.shape === "dash" && (
              <line className={`nx-legend__mark-dash nx-tone--${item.tone}`} x1="0" y1="7" x2="14" y2="7" />
            )}
            {item.shape === "tick" && (
              <line className={`nx-legend__mark-tick nx-tone--${item.tone}`} x1="7" y1="1" x2="7" y2="13" />
            )}
          </svg>
          <span className="nx-legend__label">{item.label}</span>
        </li>
      ))}
    </ul>
  );
}
