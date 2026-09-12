import type { CaptureShape } from "./types";

/**
 * Seeded synthetic capture catalog (M4-B): the metric/method vocabulary the
 * manual capture UI offers. Pure data — no hooks, no DOM, no fetch — so
 * server components, client components and the API route handler can all
 * import it.
 *
 * Agent-protocol test-data rules: every identity-like string is SYNTH
 * marked; the metric shapes (units, LOINC-shaped concept codes, typical
 * quality ranges) are real domain shapes with synthetic ids. The ids and
 * vocabulary INTENTIONALLY align with the M4-A engine's seeded vocabulary
 * (`packages/measurement/src/seed.ts`: SYNTH-metric-bp-systolic,
 * SYNTH-method-bpsys-manual, …) so the engine wiring at integration is a
 * drop-in swap — the engine's catalog/registry replaces this local seed
 * with no id renames.
 *
 * Canonical-id bodies carry the SYNTH marker (grammar `<prefix>_<body>`
 * with body 16–128 chars of [A-Za-z0-9_-], e.g. `prsn_SYNTH-person-0001`).
 */

/** The single synthetic person of the web-shell session (self-tracking). */
export const SYNTHETIC_PERSON_ID = "prsn_SYNTH-person-0001";

/** Synthetic person display label (provenance UX: "recorded by you"). */
export const SYNTHETIC_PERSON_LABEL = "You (SYNTH-Person-1, self-tracking)";

/** The synthetic source record standing in for the web manual-capture shell. */
export const SYNTHETIC_SOURCE_ID = "src_SYNTH-source-manual";

/**
 * The synthetic capture shapes, in picker display order. Shapes mirror the
 * engine seed: blood pressure is the compound panel (systolic + diastolic,
 * two domain metrics in one capture act); the rest are single-field.
 */
export const CAPTURE_SHAPES: readonly CaptureShape[] = [
  {
    id: "SYNTH-shape-bp-panel",
    displayName: "Blood pressure",
    summary: "Systolic and diastolic — one cuff reading (mmHg)",
    fields: [
      {
        id: "systolic",
        label: "Systolic",
        metric: {
          id: "SYNTH-metric-bp-systolic",
          displayName: "Blood Pressure Systolic",
          unitDomain: ["mmHg"],
          valueType: "quantity",
          conceptCode: "SYNTH-8480-5",
          category: "vital-signs",
        },
        method: {
          id: "SYNTH-method-bpsys-manual",
          metricId: "SYNTH-metric-bp-systolic",
          evidenceLabel: "MEASURED",
          typicalQuality: { min: 0.7, max: 0.9 },
          relativeBurden: 3,
        },
        min: 60,
        max: 300,
        step: 1,
      },
      {
        id: "diastolic",
        label: "Diastolic",
        metric: {
          id: "SYNTH-metric-bp-diastolic",
          displayName: "Blood Pressure Diastolic",
          unitDomain: ["mmHg"],
          valueType: "quantity",
          conceptCode: "SYNTH-8462-4",
          category: "vital-signs",
        },
        method: {
          id: "SYNTH-method-bpdia-manual",
          metricId: "SYNTH-metric-bp-diastolic",
          evidenceLabel: "MEASURED",
          typicalQuality: { min: 0.7, max: 0.9 },
          relativeBurden: 3,
        },
        min: 30,
        max: 200,
        step: 1,
      },
    ],
    manualMethodOption: {
      id: "SYNTH-method-manual-bp-panel",
      label: "Manual entry — home BP cuff reading",
      meta: "Manual · ~2 min · private",
    },
    futureMethodOptions: [
      {
        id: "SYNTH-method-cuff-bp-panel",
        label: "Automatic cuff sync",
        meta: "Device · not available yet (device integration)",
      },
      {
        id: "SYNTH-method-app-bp-panel",
        label: "App import",
        meta: "App · not available yet (app integration)",
      },
    ],
  },
  {
    id: "SYNTH-shape-heart-rate",
    displayName: "Heart rate",
    summary: "One resting pulse reading (beats/min)",
    fields: [
      {
        id: "heartRate",
        label: "Heart rate",
        metric: {
          id: "SYNTH-metric-heart-rate",
          displayName: "Heart Rate",
          unitDomain: ["beats/min"],
          valueType: "quantity",
          conceptCode: "SYNTH-8867-4",
          category: "vital-signs",
        },
        method: {
          id: "SYNTH-method-hr-manual",
          metricId: "SYNTH-metric-heart-rate",
          evidenceLabel: "MEASURED",
          typicalQuality: { min: 0.6, max: 0.8 },
          relativeBurden: 3,
        },
        min: 30,
        max: 220,
        step: 1,
      },
    ],
    manualMethodOption: {
      id: "SYNTH-method-manual-heart-rate",
      label: "Manual pulse check",
      meta: "Manual · ~1 min · private",
    },
    futureMethodOptions: [
      {
        id: "SYNTH-method-wearable-heart-rate",
        label: "Wearable sync",
        meta: "Device · not available yet (device integration)",
      },
      {
        id: "SYNTH-method-app-heart-rate",
        label: "App import",
        meta: "App · not available yet (app integration)",
      },
    ],
  },
  {
    id: "SYNTH-shape-body-weight",
    displayName: "Body weight",
    summary: "One scale reading (kg)",
    fields: [
      {
        id: "bodyWeight",
        label: "Body weight",
        metric: {
          id: "SYNTH-metric-body-weight",
          displayName: "Body Weight",
          unitDomain: ["kg"],
          valueType: "quantity",
          conceptCode: "SYNTH-29463-7",
          category: "body-composition",
        },
        method: {
          id: "SYNTH-method-wt-manual",
          metricId: "SYNTH-metric-body-weight",
          evidenceLabel: "MEASURED",
          typicalQuality: { min: 0.8, max: 0.95 },
          relativeBurden: 3,
        },
        min: 25,
        max: 400,
        step: 0.1,
      },
    ],
    manualMethodOption: {
      id: "SYNTH-method-manual-body-weight",
      label: "Manual entry — scale reading",
      meta: "Manual · ~1 min · private",
    },
    futureMethodOptions: [
      {
        id: "SYNTH-method-scale-body-weight",
        label: "Scale sync",
        meta: "Device · not available yet (device integration)",
      },
      {
        id: "SYNTH-method-app-body-weight",
        label: "App import",
        meta: "App · not available yet (app integration)",
      },
    ],
  },
  {
    id: "SYNTH-shape-step-count",
    displayName: "Step count",
    summary: "Your day's steps, typed from memory (count — estimate)",
    fields: [
      {
        id: "stepCount",
        label: "Step count",
        metric: {
          id: "SYNTH-metric-step-count",
          displayName: "Step Count",
          unitDomain: ["count"],
          valueType: "quantity",
          conceptCode: "SYNTH-41950-7",
          category: "activity",
        },
        method: {
          id: "SYNTH-method-steps-manual",
          metricId: "SYNTH-metric-step-count",
          evidenceLabel: "ESTIMATED",
          typicalQuality: { min: 0.3, max: 0.5 },
          relativeBurden: 3,
        },
        min: 0,
        max: 100000,
        step: 1,
      },
    ],
    manualMethodOption: {
      id: "SYNTH-method-manual-step-count",
      label: "Manual estimate — typed from memory",
      meta: "Manual · ~1 min · private",
    },
    futureMethodOptions: [
      {
        id: "SYNTH-method-wearable-step-count",
        label: "Wearable sync",
        meta: "Device · not available yet (device integration)",
      },
      {
        id: "SYNTH-method-app-step-count",
        label: "App import",
        meta: "App · not available yet (app integration)",
      },
    ],
    evidenceNote:
      "Manual step entries are recorded as ESTIMATED — a recollection, not a measurement. The provenance on this observation keeps that distinction.",
  },
  {
    id: "SYNTH-shape-sleep-minutes",
    displayName: "Sleep duration",
    summary: "Last night's sleep, typed from memory (min — estimate)",
    fields: [
      {
        id: "sleepMinutes",
        label: "Sleep duration",
        metric: {
          id: "SYNTH-metric-sleep-minutes",
          displayName: "Sleep Duration",
          unitDomain: ["min"],
          valueType: "quantity",
          conceptCode: "SYNTH-94641-0",
          category: "sleep",
        },
        method: {
          id: "SYNTH-method-sleep-manual",
          metricId: "SYNTH-metric-sleep-minutes",
          evidenceLabel: "ESTIMATED",
          typicalQuality: { min: 0.4, max: 0.6 },
          relativeBurden: 3,
        },
        min: 0,
        max: 1440,
        step: 5,
      },
    ],
    manualMethodOption: {
      id: "SYNTH-method-manual-sleep-minutes",
      label: "Manual estimate — typed from memory",
      meta: "Manual · ~1 min · private",
    },
    futureMethodOptions: [
      {
        id: "SYNTH-method-wearable-sleep-minutes",
        label: "Wearable derivation",
        meta: "Device · not available yet (device integration)",
      },
      {
        id: "SYNTH-method-app-sleep-minutes",
        label: "App import",
        meta: "App · not available yet (app integration)",
      },
    ],
    evidenceNote:
      "Manual sleep entries are recorded as ESTIMATED — a recollection, not a measurement. The provenance on this observation keeps that distinction.",
  },
];

/** Finds a capture shape by id. */
export function findCaptureShape(shapeId: string): CaptureShape | undefined {
  return CAPTURE_SHAPES.find((shape) => shape.id === shapeId);
}

/**
 * Catalog invariants (pure, thrown as programming errors — the seed is a
 * fixture, and a malformed fixture must fail loudly, not reject users):
 *   - every id is SYNTH-marked;
 *   - per-field method.metricId === field.metric.id (the engine's
 *     assertMethodForMetric invariant, mirrored);
 *   - every manual method has a non-degenerate typical range
 *     (0 < min <= max <= 1) so quality-state round-trips hold;
 *   - every quantity field has 0 < min <= max and step > 0;
 *   - shape ids and field ids are unique across the catalog.
 */
export function assertCaptureCatalogInvariants(): void {
  const shapeIds = new Set<string>();
  const fieldIds = new Set<string>();
  for (const shape of CAPTURE_SHAPES) {
    if (!shape.id.startsWith("SYNTH-")) {
      throw new Error(`Capture shape id is not SYNTH-marked: ${shape.id}`);
    }
    if (shapeIds.has(shape.id)) {
      throw new Error(`Duplicate capture shape id: ${shape.id}`);
    }
    shapeIds.add(shape.id);
    if (!shape.manualMethodOption.id.startsWith("SYNTH-")) {
      throw new Error("Manual method option id is not SYNTH-marked.");
    }
    if (shape.fields.length === 0) {
      throw new Error(`Capture shape has no fields: ${shape.id}`);
    }
    for (const field of shape.fields) {
      if (!field.metric.id.startsWith("SYNTH-") || !field.method.id.startsWith("SYNTH-")) {
        throw new Error("Metric or method id is not SYNTH-marked.");
      }
      if (field.method.metricId !== field.metric.id) {
        throw new Error(
          `Method ${field.method.id} does not belong to metric ${field.metric.id}.`,
        );
      }
      if (field.metric.unitDomain.length !== 1) {
        throw new Error(`Quantity metric must carry exactly one unit: ${field.metric.id}`);
      }
      const { min, max } = field.method.typicalQuality;
      if (!(min > 0) || !(min <= max) || !(max <= 1)) {
        throw new Error(`Manual method typical quality is degenerate: ${field.method.id}`);
      }
      if (!(field.min < field.max) || !(field.step > 0)) {
        throw new Error(`Field guard bounds are invalid: ${shape.id}.${field.id}`);
      }
      if (field.min < 0) {
        throw new Error(`Field minimum must be non-negative: ${shape.id}.${field.id}`);
      }
      const compositeKey = `${shape.id}.${field.id}`;
      if (fieldIds.has(compositeKey)) {
        throw new Error(`Duplicate field id: ${compositeKey}`);
      }
      fieldIds.add(compositeKey);
    }
  }
}
