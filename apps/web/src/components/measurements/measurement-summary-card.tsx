import { BarChart, Card, Heading, Sparkline, Text } from "@orbb/ui";
import {
  SYNTHETIC_CAPTURE_COUNTS_BY_DAY,
  SYNTHETIC_LATEST_HEART_RATE,
  SYNTHETIC_METRIC,
  SYNTHETIC_RESTING_HEART_RATE_SERIES,
} from "@/lib/synthetic-data";

/**
 * Measurement summary card (M3-B): mounts the `@orbb/ui` SVG charts over
 * the synthetic measurement data — a Sparkline of the recent
 * resting-heart-rate series and a BarChart of capture counts by day.
 *
 * Both charts are exposed as single named images (`role="img"` +
 * accessible summary describing the data SHAPE, not the values — the
 * library's required `summary` prop). Redundant visible text lines keep
 * the latest value readable without the chart. Server-component-safe:
 * no hooks, no effects.
 */
export function MeasurementSummaryCard() {
  const totalCaptures = SYNTHETIC_CAPTURE_COUNTS_BY_DAY.reduce(
    (sum, datum) => sum + datum.value,
    0,
  );

  return (
    <Card>
      <Heading level={2}>Measurement summary</Heading>
      <Text variant="muted">
        Synthetic summary of recent measurement activity for {SYNTHETIC_METRIC.label.toLowerCase()}.
      </Text>
      <div className="mt-4 grid grid-cols-1 gap-6 sm:grid-cols-2">
        <section>
          <Heading level={3}>
            {SYNTHETIC_METRIC.label} — last {SYNTHETIC_RESTING_HEART_RATE_SERIES.length}{" "}
            readings
          </Heading>
          <Sparkline
            data={SYNTHETIC_RESTING_HEART_RATE_SERIES}
            summary="Resting heart rate across the last 10 synthetic readings, gently declining from 68 to 60 beats per minute."
            width={220}
            height={48}
          />
          <Text variant="small">
            Latest synthetic reading: {SYNTHETIC_LATEST_HEART_RATE} {SYNTHETIC_METRIC.unit}.
          </Text>
        </section>
        <section>
          <Heading level={3}>Captures by day — this week</Heading>
          <BarChart
            data={SYNTHETIC_CAPTURE_COUNTS_BY_DAY}
            summary="Synthetic measurement counts by day of week, Wednesday highest with 5 captures."
            width={280}
            height={140}
          />
          <Text variant="small">{totalCaptures} synthetic captures this week.</Text>
        </section>
      </div>
    </Card>
  );
}
