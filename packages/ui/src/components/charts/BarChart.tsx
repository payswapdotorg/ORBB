import { color, typography } from "../../tokens";

/** One bar: a plain label and a non-negative value. */
export interface BarChartDatum {
  label: string;
  value: number;
}

/** Computed geometry for one bar (pure output of {@link barChartGeometry}). */
export interface BarChartBarGeometry {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly label: string;
  readonly value: number;
}

export interface BarChartGeometryOptions {
  /** Horizontal padding on both sides. Defaults to `2`. */
  padding?: number;
  /** Gap between bars. Defaults to `4`. */
  gap?: number;
  /** Height reserved at the bottom for value labels. Defaults to `16`. */
  labelArea?: number;
}

/**
 * Computes bar geometry for a bar chart (M1-B).
 *
 * Pure geometry: values are clamped at zero (negative values render no bar
 * — the caller handles invalid data), the tallest bar fills the plot area,
 * and every bar gets an equal share of the inner width minus gaps. An empty
 * series yields an empty geometry array.
 */
export function barChartGeometry(
  data: readonly BarChartDatum[],
  width: number,
  height: number,
  options: BarChartGeometryOptions = {},
): BarChartBarGeometry[] {
  if (data.length === 0) {
    return [];
  }
  const { padding = 2, gap = 4, labelArea = 16 } = options;

  let max = 0;
  for (const datum of data) {
    if (datum.value > max) {
      max = datum.value;
    }
  }

  const innerWidth = Math.max(width - padding * 2, 0);
  const plotHeight = Math.max(height - padding * 2 - labelArea, 0);
  const barWidth = Math.max((innerWidth - gap * (data.length - 1)) / data.length, 0);

  return data.map((datum, index) => {
    const value = datum.value > 0 ? datum.value : 0;
    const barHeight = max > 0 ? (value / max) * plotHeight : 0;
    return {
      x: round(padding + index * (barWidth + gap)),
      y: round(padding + plotHeight - barHeight),
      width: round(barWidth),
      height: round(barHeight),
      label: datum.label,
      value: datum.value,
    };
  });
}

const round = (value: number): number => Math.round(value * 100) / 100;

export interface BarChartProps {
  /** Bars (label + non-negative value), rendered in order. */
  data: readonly BarChartDatum[];
  /**
   * Accessible summary describing the data SHAPE (e.g. "Completion counts
   * by weekday, Tuesday highest") — not the values themselves (WCAG 1.1.1).
   * Required by design so no chart ships unnamed.
   */
  summary: string;
  /** SVG width in px. Defaults to `320`. */
  width?: number;
  /** SVG height in px. Defaults to `160`. */
  height?: number;
  /** Render value labels under the bars. Defaults to `true`. */
  showLabels?: boolean;
}

/**
 * BarChart (M1-B): a dependency-free SVG bar chart for small series.
 *
 * - `role="img"` + `aria-label` from the required `summary` prop (one named
 *   image, matching the sparkline contract);
 * - bar geometry comes from the pure {@link barChartGeometry} function;
 * - labels are SVG text (12px, muted token); on narrow widths disable them
 *   with `showLabels={false}` rather than relying on truncation;
 * - no axes, tooltips or interactions — presentational summary only;
 * - server-component-safe (no hooks, no effects).
 */
export function BarChart({
  data,
  summary,
  width = 320,
  height = 160,
  showLabels = true,
}: BarChartProps) {
  const geometry = barChartGeometry(data, width, height, {
    padding: 4,
    gap: 6,
    labelArea: showLabels ? 18 : 4,
  });
  const labelY = height - 6;

  return (
    <svg
      role="img"
      aria-label={summary}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      focusable="false"
    >
      {geometry.map((bar, index) => (
        <g key={`${bar.label}-${index}`}>
          <rect
            x={bar.x}
            y={bar.y}
            width={bar.width}
            height={bar.height}
            fill={color.accent}
            rx="2"
          />
          {showLabels ? (
            <text
              x={bar.x + bar.width / 2}
              y={labelY}
              textAnchor="middle"
              fill={color.fgMuted}
              fontSize={typography.size.xs}
              fontFamily={typography.family.sans}
            >
              {bar.label}
            </text>
          ) : null}
        </g>
      ))}
    </svg>
  );
}
