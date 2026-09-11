/**
 * Seeded measurement vocabulary: a catalog of REAL metric shapes with
 * SYNTHETIC ids (agent-protocol test-data rules — zero PHI: every metric
 * id and concept code carries the `SYNTH-` marker, mirroring the testkit
 * fixture convention; the UNITS and unit domains are real).
 *
 * Metric shapes (real units/domains, LOINC-shaped synthetic concept
 * codes):
 *   - blood pressure systolic / diastolic — mmHg — vital-signs
 *   - heart rate — beats/min — vital-signs
 *   - body weight — kg — body-composition
 *   - step count — count — activity
 *   - sleep duration — min — sleep
 *
 * Methods per metric cover the three source kinds the packet names
 * (manual entry, a device, an app) with domain evidence labels, typical
 * quality ranges, and burden ranks (per-capture burden: passive device 1
 * < app sync 2 < manual entry 3 — recorded assumption).
 */
import { parseQualityScore } from "@orbb/domain";
import { DeterministicClock } from "@orbb/testkit";
import { InMemoryMetricCatalog, type MetricCatalog } from "./catalog.js";
import {
  InMemoryMeasurementMethodRegistry,
  type MeasurementMethodRegistry,
} from "./methods.js";

/** Seeded metric ids (SYNTH- marked, stable). */
export const SEEDED_METRIC_IDS = {
  bloodPressureSystolic: "SYNTH-metric-bp-systolic",
  bloodPressureDiastolic: "SYNTH-metric-bp-diastolic",
  heartRate: "SYNTH-metric-heart-rate",
  bodyWeight: "SYNTH-metric-body-weight",
  stepCount: "SYNTH-metric-step-count",
  sleepMinutes: "SYNTH-metric-sleep-minutes",
} as const;

/** Seeded method ids (SYNTH- marked, stable). */
export const SEEDED_METHOD_IDS = {
  bpSystolicManual: "SYNTH-method-bpsys-manual",
  bpSystolicCuff: "SYNTH-method-bpsys-cuff",
  bpSystolicApp: "SYNTH-method-bpsys-app",
  bpDiastolicManual: "SYNTH-method-bpdia-manual",
  bpDiastolicCuff: "SYNTH-method-bpdia-cuff",
  bpDiastolicApp: "SYNTH-method-bpdia-app",
  heartRateManual: "SYNTH-method-hr-manual",
  heartRateWearable: "SYNTH-method-hr-wearable",
  heartRateApp: "SYNTH-method-hr-app",
  bodyWeightManual: "SYNTH-method-wt-manual",
  bodyWeightScale: "SYNTH-method-wt-scale",
  bodyWeightApp: "SYNTH-method-wt-app",
  stepCountManual: "SYNTH-method-steps-manual",
  stepCountWearable: "SYNTH-method-steps-wearable",
  stepCountApp: "SYNTH-method-steps-app",
  sleepMinutesManual: "SYNTH-method-sleep-manual",
  sleepMinutesWearable: "SYNTH-method-sleep-wearable",
  sleepMinutesApp: "SYNTH-method-sleep-app",
} as const;

/** The seeded metric definitions (real units/domains, synthetic ids). */
export const SEEDED_METRIC_DEFINITIONS = [
  {
    id: SEEDED_METRIC_IDS.bloodPressureSystolic,
    displayName: "Blood Pressure Systolic",
    unitDomain: ["mmHg"],
    valueType: "quantity",
    conceptCode: "SYNTH-8480-5",
    category: "vital-signs",
  },
  {
    id: SEEDED_METRIC_IDS.bloodPressureDiastolic,
    displayName: "Blood Pressure Diastolic",
    unitDomain: ["mmHg"],
    valueType: "quantity",
    conceptCode: "SYNTH-8462-4",
    category: "vital-signs",
  },
  {
    id: SEEDED_METRIC_IDS.heartRate,
    displayName: "Heart Rate",
    unitDomain: ["beats/min"],
    valueType: "quantity",
    conceptCode: "SYNTH-8867-4",
    category: "vital-signs",
  },
  {
    id: SEEDED_METRIC_IDS.bodyWeight,
    displayName: "Body Weight",
    unitDomain: ["kg"],
    valueType: "quantity",
    conceptCode: "SYNTH-29463-7",
    category: "body-composition",
  },
  {
    id: SEEDED_METRIC_IDS.stepCount,
    displayName: "Step Count",
    unitDomain: ["count"],
    valueType: "quantity",
    conceptCode: "SYNTH-41950-7",
    category: "activity",
  },
  {
    id: SEEDED_METRIC_IDS.sleepMinutes,
    displayName: "Sleep Duration",
    unitDomain: ["min"],
    valueType: "quantity",
    conceptCode: "SYNTH-94641-0",
    category: "sleep",
  },
] as const;

/**
 * The seeded methods: `[metricId, methodId, evidenceLabel, min, max,
 * burden]`. Burden: device/app captures are less burdensome per reading
 * than manual entry (device 1, app 2, manual 3).
 */
export const SEEDED_METHODS = [
  [SEEDED_METRIC_IDS.bloodPressureSystolic, SEEDED_METHOD_IDS.bpSystolicManual, "MEASURED", 0.7, 0.9, 3],
  [SEEDED_METRIC_IDS.bloodPressureSystolic, SEEDED_METHOD_IDS.bpSystolicCuff, "MEASURED", 0.92, 0.99, 1],
  [SEEDED_METRIC_IDS.bloodPressureSystolic, SEEDED_METHOD_IDS.bpSystolicApp, "IMPORTED", 0.8, 0.9, 2],
  [SEEDED_METRIC_IDS.bloodPressureDiastolic, SEEDED_METHOD_IDS.bpDiastolicManual, "MEASURED", 0.7, 0.9, 3],
  [SEEDED_METRIC_IDS.bloodPressureDiastolic, SEEDED_METHOD_IDS.bpDiastolicCuff, "MEASURED", 0.92, 0.99, 1],
  [SEEDED_METRIC_IDS.bloodPressureDiastolic, SEEDED_METHOD_IDS.bpDiastolicApp, "IMPORTED", 0.8, 0.9, 2],
  [SEEDED_METRIC_IDS.heartRate, SEEDED_METHOD_IDS.heartRateManual, "MEASURED", 0.6, 0.8, 3],
  [SEEDED_METRIC_IDS.heartRate, SEEDED_METHOD_IDS.heartRateWearable, "MEASURED", 0.9, 0.98, 1],
  [SEEDED_METRIC_IDS.heartRate, SEEDED_METHOD_IDS.heartRateApp, "IMPORTED", 0.85, 0.95, 2],
  [SEEDED_METRIC_IDS.bodyWeight, SEEDED_METHOD_IDS.bodyWeightManual, "MEASURED", 0.8, 0.95, 3],
  [SEEDED_METRIC_IDS.bodyWeight, SEEDED_METHOD_IDS.bodyWeightScale, "MEASURED", 0.9, 0.99, 1],
  [SEEDED_METRIC_IDS.bodyWeight, SEEDED_METHOD_IDS.bodyWeightApp, "IMPORTED", 0.85, 0.95, 2],
  [SEEDED_METRIC_IDS.stepCount, SEEDED_METHOD_IDS.stepCountManual, "ESTIMATED", 0.3, 0.5, 3],
  [SEEDED_METRIC_IDS.stepCount, SEEDED_METHOD_IDS.stepCountWearable, "MEASURED", 0.9, 0.97, 1],
  [SEEDED_METRIC_IDS.stepCount, SEEDED_METHOD_IDS.stepCountApp, "IMPORTED", 0.8, 0.9, 2],
  [SEEDED_METRIC_IDS.sleepMinutes, SEEDED_METHOD_IDS.sleepMinutesManual, "ESTIMATED", 0.4, 0.6, 3],
  [SEEDED_METRIC_IDS.sleepMinutes, SEEDED_METHOD_IDS.sleepMinutesWearable, "DERIVED", 0.7, 0.85, 1],
  [SEEDED_METRIC_IDS.sleepMinutes, SEEDED_METHOD_IDS.sleepMinutesApp, "IMPORTED", 0.75, 0.9, 2],
] as const;

/** The seeded vocabulary: a ready-to-use catalog + method registry pair. */
export interface SeededMeasurementVocabulary {
  readonly catalog: MetricCatalog;
  readonly methods: MeasurementMethodRegistry;
}

/**
 * Builds the seeded vocabulary on FRESH in-memory instances (deterministic
 * `DeterministicClock` for version timestamps). Registration failures
 * would mean the seed itself is malformed — they throw (seed integrity
 * is a programming invariant, not a domain rejection).
 */
export function seedMeasurementVocabulary(): SeededMeasurementVocabulary {
  const catalog = new InMemoryMetricCatalog(new DeterministicClock());
  for (const definition of SEEDED_METRIC_DEFINITIONS) {
    const result = catalog.register({ definition: { ...definition } });
    if (!result.ok) {
      throw new Error("Seeded metric definition was rejected by the catalog (seed integrity).");
    }
  }
  const methods = new InMemoryMeasurementMethodRegistry(catalog);
  for (const [metricId, id, evidenceLabel, min, max, relativeBurden] of SEEDED_METHODS) {
    const result = methods.register({
      id,
      metricId,
      evidenceLabel,
      typicalQuality: { min: parseQualityScore(min), max: parseQualityScore(max) },
      relativeBurden,
    });
    if (!result.ok) {
      throw new Error("Seeded method was rejected by the registry (seed integrity).");
    }
  }
  return { catalog, methods };
}
