/**
 * @orbb/measurement — measurement boundary package (M0).
 *
 * Future responsibility (architecture §2, §5): owns MetricDefinition,
 * MeasurementMethod, MeasurementCapability, MeasurementPlan, PlanMetric,
 * MeasurementTask/Window/Attempt, and ServiceOrder — turning published
 * plans into capture tasks, ingesting observations from devices and
 * sources, validating them (pending -> validated | rejected), and
 * recording them with evidence labels, quality scores, and provenance.
 *
 * M0 boundary: no runtime behavior yet. Re-exports (type-only) the
 * measurement-plane types from @orbb/domain that this lane will own.
 */
export type {
  MeasurementPlan,
  Observation,
  ObservationId,
  ObservationValidationState,
  PlanId,
  PlanState,
  QualityScore,
  TaskId,
} from "@orbb/domain";
