import { useId } from "react";

export interface BarChartDatum {
  label: string;
  value: number;
}

export interface BarChartProps {
  data: BarChartDatum[];
  /** Bar area height in px; the labels row sits below it. Default 90. */
  height?: number;
}

const VIEWBOX_WIDTH = 320;
const GAP = 8;
const RADIUS = 3;

export function BarChart({ data, height = 90 }: BarChartProps) {
  // Unique gradient id per instance so each themed subtree resolves its own
  // CSS vars (duplicate ids would make every chart inherit the first theme).
  const gradientId = `nx-bar-${useId().replace(/:/g, "")}`;
  const max = Math.max(1, ...data.map((d) => d.value));
  const barWidth = (VIEWBOX_WIDTH - GAP * (data.length - 1)) / data.length;
  const summary = data.map((d) => `${d.label}: ${d.value}`).join(", ");

  return (
    <div className="nx-barchart">
      <svg
        className="nx-barchart__svg"
        role="img"
        aria-label={summary}
        viewBox={`0 0 ${VIEWBOX_WIDTH} ${height}`}
        preserveAspectRatio="none"
        width="100%"
        height={height}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" style={{ stopColor: "var(--nx-accent)" }} />
            <stop offset="1" style={{ stopColor: "var(--nx-data)" }} />
          </linearGradient>
        </defs>
        {data.map((d, i) => {
          const barHeight = (d.value / max) * height;
          return (
            <rect
              key={i}
              x={i * (barWidth + GAP)}
              y={height - barHeight}
              width={barWidth}
              // Extend below the baseline so the bottom radius is clipped by
              // the viewport — only the top corners read as rounded.
              height={barHeight + RADIUS}
              rx={RADIUS}
              fill={`url(#${gradientId})`}
            />
          );
        })}
      </svg>
      <div className="nx-barchart__labels">
        {data.map((d, i) => (
          <span key={i}>{d.label}</span>
        ))}
      </div>
    </div>
  );
}
