import { color } from "../../tokens";

/**
 * Computes normalized SVG polyline points for a sparkline (M1-B).
 *
 * Pure geometry: maps `data` onto the `width` × `height` box (with symmetric
 * `padding`), normalizing by the data's own min/max. Degenerate cases:
 * - empty data → `""` (nothing to draw);
 * - constant data → a flat line at the vertical center;
 * - a single point → all points collapse to the left padding edge (render
 *   the last-point marker to make it visible).
 *
 * Y-axis is inverted (SVG y grows downward): larger values sit higher.
 */
export function sparklinePoints(
  data: readonly number[],
  width: number,
  height: number,
  padding = 2,
): string {
  if (data.length === 0) {
    return "";
  }
  let min = data[0] ?? 0;
  let max = data[0] ?? 0;
  for (const value of data) {
    if (value < min) {
      min = value;
    }
    if (value > max) {
      max = value;
    }
  }
  const span = max - min;
  const innerWidth = Math.max(width - padding * 2, 0);
  const innerHeight = Math.max(height - padding * 2, 0);
  const step = data.length > 1 ? innerWidth / (data.length - 1) : 0;

  const points = data.map((value, index) => {
    const x = padding + index * step;
    const normalized = span === 0 ? 0.5 : (value - min) / span;
    const y = padding + innerHeight - normalized * innerHeight;
    return `${round(x)},${round(y)}`;
  });
  return points.join(" ");
}

const round = (value: number): number => Math.round(value * 100) / 100;

export interface SparklineProps {
  /** Series values (empty series renders an empty image). */
  data: readonly number[];
  /**
   * Accessible summary describing the data SHAPE (e.g. "Daily synthetic
   * readings over the last week, generally increasing") — not the values
   * themselves (WCAG 1.1.1). Required by design so no sparkline ships unnamed.
   */
  summary: string;
  /** SVG width in px. Defaults to `120`. */
  width?: number;
  /** SVG height in px. Defaults to `36`. */
  height?: number;
}

/**
 * Sparkline (M1-B): a dependency-free SVG polyline trend line with a
 * last-point marker.
 *
 * - `role="img"` + `aria-label` from the required `summary` prop — the
 *   chart is exposed as a single named image, not as unlabeled decoration;
 * - polyline geometry comes from the pure {@link sparklinePoints} function;
 * - a filled circle marks the most recent value (also the only visible
 *   mark for single-point series);
 * - no axes/gridlines — sparklines are glanceable context, not precision
 *   instruments;
 * - server-component-safe (no hooks, no effects).
 */
export function Sparkline({
  data,
  summary,
  width = 120,
  height = 36,
}: SparklineProps) {
  const points = sparklinePoints(data, width, height, 2);
  const lastPoint = points.length > 0 ? points.split(" ").at(-1) : undefined;
  const [lastX, lastY] =
    lastPoint !== undefined ? (lastPoint.split(",") as [string, string]) : (["", ""] as [string, string]);

  return (
    <svg
      role="img"
      aria-label={summary}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      focusable="false"
    >
      {data.length > 1 ? (
        <polyline
          points={points}
          fill="none"
          stroke={color.accent}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : null}
      {lastX !== "" && lastY !== "" ? (
        <circle
          cx={lastX}
          cy={lastY}
          r="3"
          fill={color.accent}
          stroke={color.surface}
          strokeWidth="1"
        />
      ) : null}
    </svg>
  );
}
