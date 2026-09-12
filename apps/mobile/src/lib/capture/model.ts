/**
 * Mobile capture model (M4-B, Lane B) — pure data + pure functions.
 *
 * The same capture session model as the web flow, mirrored for React
 * Native: same SYNTH catalog (ids aligned with the M4-A engine seed and
 * the web `apps/web/src/lib/capture/catalog.ts`), same completion-quality
 * vocabulary, same guard semantics, same domain-shaped records.
 *
 * Why a local mirror instead of importing the web libs or `@orbb/domain`:
 * `apps/mobile` declares only `@orbb/ui` as a workspace dependency (plus
 * the RN/Expo stack); adding `@orbb/domain` or an apps/web import would
 * change `pnpm-lock.yaml`, which this packet must not touch. The screens
 * consume this pure model; the engine wiring at integration promotes it
 * (recorded handoff).
 *
 * No React Native imports in this module — it is plain-node unit-testable
 * (the same discipline as `src/navigation/tabs.ts`).
 */

// ---------------------------------------------------------------------------
// Quality states — the domain completion-quality vocabulary.
// ---------------------------------------------------------------------------

export const CAPTURE_QUALITY_STATES = ["complete", "partial", "low-quality"] as const;

export type CaptureQualityState = (typeof CAPTURE_QUALITY_STATES)[number];

export function isCaptureQualityState(value: unknown): value is CaptureQualityState {
  return (
    typeof value === "string" &&
    (CAPTURE_QUALITY_STATES as readonly string[]).includes(value)
  );
}

export const CAPTURE_QUALITY_LABELS: Readonly<Record<CaptureQualityState, string>> = {
  complete: "Complete",
  partial: "Partial",
  "low-quality": "Low quality",
};

export const CAPTURE_QUALITY_DESCRIPTIONS: Readonly<Record<CaptureQualityState, string>> = {
  complete: "The reading is fully usable — everything the method typically delivers.",
  partial: "Captured something usable, but below what the method typically delivers.",
  "low-quality": "Barely usable — well below the method's typical quality.",
};

export const CAPTURE_PARTIAL_FLOOR_FRACTION = 0.5;

// ---------------------------------------------------------------------------
// Domain-plane mirrors (same shapes as packages/domain).
// ---------------------------------------------------------------------------

export type CaptureEvidenceLabel = "MEASURED" | "ESTIMATED" | "IMPORTED" | "DERIVED";

export interface CaptureMetricDefinition {
  readonly id: string;
  readonly displayName: string;
  readonly unitDomain: readonly string[];
  readonly valueType: "quantity";
  readonly conceptCode: string;
  readonly category: string;
}

export interface CaptureMeasurementMethod {
  readonly id: string;
  readonly metricId: string;
  readonly evidenceLabel: CaptureEvidenceLabel;
  readonly typicalQuality: { readonly min: number; readonly max: number };
  readonly relativeBurden: number;
}

export interface CaptureFieldSpec {
  readonly id: string;
  readonly label: string;
  readonly metric: CaptureMetricDefinition;
  readonly method: CaptureMeasurementMethod;
  readonly min: number;
  readonly max: number;
  readonly step: number;
}

export interface CaptureShape {
  readonly id: string;
  readonly displayName: string;
  readonly summary: string;
  readonly fields: readonly CaptureFieldSpec[];
  readonly manualMethodOption: {
    readonly id: string;
    readonly label: string;
    readonly meta: string;
  };
  readonly futureMethodOptions: readonly {
    readonly id: string;
    readonly label: string;
    readonly meta: string;
  }[];
  readonly evidenceNote?: string;
}

/** The single synthetic person of the mobile shell (self-tracking). */
export const SYNTHETIC_PERSON_ID = "prsn_SYNTH-person-0001";

/** Synthetic provenance actor display label. */
export const SYNTHETIC_PERSON_LABEL = "You (SYNTH-Person-1, self-tracking)";

// ---------------------------------------------------------------------------
// Catalog (mirrors the web seed; ids align with the M4-A engine seed).
// ---------------------------------------------------------------------------

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
      "Manual step entries are recorded as ESTIMATED — a recollection, not a measurement.",
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
      "Manual sleep entries are recorded as ESTIMATED — a recollection, not a measurement.",
  },
];

export function findCaptureShape(shapeId: string): CaptureShape | undefined {
  return CAPTURE_SHAPES.find((shape) => shape.id === shapeId);
}

// ---------------------------------------------------------------------------
// Quality mapping (same semantics as the web quality lib).
// ---------------------------------------------------------------------------

function round3(value: number): number {
  return Number(value.toFixed(3));
}

export function qualityScoreFromState(
  state: CaptureQualityState,
  typical: { readonly min: number; readonly max: number },
): number {
  const { min, max } = typical;
  if (!(min > 0) || !(min <= max) || !(max <= 1)) {
    throw new RangeError("Typical quality range must satisfy 0 < min <= max <= 1.");
  }
  switch (state) {
    case "complete":
      return round3(max);
    case "partial":
      return round3(0.75 * min);
    case "low-quality":
      return round3(0.25 * min);
  }
}

export function classifyQualityScore(
  score: number,
  typical: { readonly min: number; readonly max: number },
): CaptureQualityState {
  const { min } = typical;
  if (!(min > 0)) {
    throw new RangeError("Typical quality range must satisfy 0 < min <= max <= 1.");
  }
  if (score >= min) {
    return "complete";
  }
  if (score >= CAPTURE_PARTIAL_FLOOR_FRACTION * min) {
    return "partial";
  }
  return "low-quality";
}

// ---------------------------------------------------------------------------
// Parsing + validation (client guard semantics; RN has no ValueInput).
// ---------------------------------------------------------------------------

export const CAPTURE_NOTES_MAX_LENGTH = 500;
export const CAPTURE_FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

export type CaptureFieldParseFailure = "value-missing" | "value-not-numeric";

export type CaptureFieldParseResult =
  | { readonly ok: true; readonly value: number; readonly guardedText: string }
  | { readonly ok: false; readonly reason: CaptureFieldParseFailure };

/** Parses one field's text with clamp + snap guard semantics. */
export function parseCaptureFieldText(raw: string, field: CaptureFieldSpec): CaptureFieldParseResult {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return { ok: false, reason: "value-missing" };
  }
  const parsed = Number(trimmed.replace(",", "."));
  if (!Number.isFinite(parsed)) {
    return { ok: false, reason: "value-not-numeric" };
  }
  let guarded = parsed;
  if (guarded < field.min) {
    guarded = field.min;
  }
  if (guarded > field.max) {
    guarded = field.max;
  }
  if (field.step > 0) {
    guarded = Number((Math.round(guarded / field.step) * field.step).toFixed(10));
  }
  if (guarded < field.min) {
    guarded = field.min;
  }
  if (guarded > field.max) {
    guarded = field.max;
  }
  const guardedText = String(Number(guarded.toFixed(4)));
  return { ok: true, value: Number(guardedText), guardedText };
}

/** Formats a Date as the mobile timestamp input value: "YYYY-MM-DD HH:mm". */
export function toTimestampInputValue(date: Date): string {
  const pad2 = (value: number): string => String(value).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}` +
    ` ${pad2(date.getHours())}:${pad2(date.getMinutes())}`
  );
}

/** Parses "YYYY-MM-DD HH:mm" (or the 'T' separator) in local time. */
export function parseTimestampText(text: string): Date | null {
  const trimmed = text.trim();
  if (!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}$/.test(trimmed)) {
    return null;
  }
  const parsed = new Date(trimmed.replace(" ", "T"));
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// Records (domain-shaped; the synthetic mobile "submit" seam).
// ---------------------------------------------------------------------------

export interface MobileCaptureSubmission {
  readonly shapeId: string;
  readonly methodOptionId: string;
  readonly fieldValues: Readonly<Record<string, number>>;
  readonly qualityState: CaptureQualityState;
  readonly capturedAtIso: string;
  readonly notes?: string;
}

export interface MobileCaptureObservation {
  readonly id: string;
  readonly personId: string;
  readonly conceptCode: string;
  readonly metricId: string;
  readonly metricLabel: string;
  readonly value: number;
  readonly unit: string;
  readonly effectiveAt: string;
  readonly observedAt: string;
  readonly sourceId: string;
  readonly methodId: string;
  readonly evidenceLabel: CaptureEvidenceLabel;
  readonly quality: number;
  readonly validationState: "pending";
  readonly provenance: {
    readonly provenanceId: string;
    readonly actor: string;
    readonly subject: string;
    readonly occurredAt: string;
    readonly correlationId: string;
  };
}

export interface MobileCaptureRecord {
  readonly recordId: string;
  readonly personId: string;
  readonly shapeId: string;
  readonly shapeLabel: string;
  readonly methodOptionId: string;
  readonly qualityState: CaptureQualityState;
  readonly capturedAt: string;
  readonly recordedAt: string;
  readonly notes?: string;
  readonly observations: readonly MobileCaptureObservation[];
}

/** Id counters owned by the caller (deterministic; survives screen state). */
export interface CaptureIdCounters {
  record: number;
  observation: number;
  provenance: number;
}

export function initialCaptureIdCounters(): CaptureIdCounters {
  return { record: 0, observation: 0, provenance: 0 };
}

function nextId(prefix: string, kind: string, counter: number): string {
  return `${prefix}_SYNTH-${kind}-${String(counter).padStart(6, "0")}`;
}

/**
 * Builds one capture record (one observation per captured field) from a
 * submission. Pure: the caller supplies "now" and the id counters (which
 * are returned advanced, so callers can chain).
 */
export function createMobileCaptureRecord(
  submission: MobileCaptureSubmission,
  now: Date,
  counters: CaptureIdCounters,
): { readonly record: MobileCaptureRecord; readonly counters: CaptureIdCounters } {
  const shape = findCaptureShape(submission.shapeId);
  if (shape === undefined) {
    throw new Error("Mobile capture model received an unknown shape id.");
  }
  const recordId = `SYNTH-MCAP-${String(counters.record + 1).padStart(6, "0")}`;
  const recordedAt = now.toISOString();

  let observationCounter = counters.observation;
  let provenanceCounter = counters.provenance;
  const observations: MobileCaptureObservation[] = shape.fields.map((field) => {
    const value = submission.fieldValues[field.id];
    if (value === undefined) {
      throw new Error("Mobile capture model received a missing field value.");
    }
    observationCounter += 1;
    provenanceCounter += 1;
    return {
      id: nextId("obs", "obs", observationCounter),
      personId: SYNTHETIC_PERSON_ID,
      conceptCode: field.metric.conceptCode,
      metricId: field.metric.id,
      metricLabel: field.metric.displayName,
      value,
      unit: field.metric.unitDomain[0] ?? "",
      effectiveAt: submission.capturedAtIso,
      observedAt: recordedAt,
      sourceId: "src_SYNTH-source-manual",
      methodId: field.method.id,
      evidenceLabel: field.method.evidenceLabel,
      quality: qualityScoreFromState(submission.qualityState, field.method.typicalQuality),
      validationState: "pending",
      provenance: {
        provenanceId: nextId("prov", "prov", provenanceCounter),
        actor: SYNTHETIC_PERSON_ID,
        subject: SYNTHETIC_PERSON_ID,
        occurredAt: recordedAt,
        correlationId: recordId,
      },
    };
  });

  const record: MobileCaptureRecord = {
    recordId,
    personId: SYNTHETIC_PERSON_ID,
    shapeId: shape.id,
    shapeLabel: shape.displayName,
    methodOptionId: submission.methodOptionId,
    qualityState: submission.qualityState,
    capturedAt: submission.capturedAtIso,
    recordedAt,
    ...(submission.notes !== undefined ? { notes: submission.notes } : {}),
    observations,
  };

  return {
    record,
    counters: {
      record: counters.record + 1,
      observation: observationCounter,
      provenance: provenanceCounter,
    },
  };
}

// ---------------------------------------------------------------------------
// Display summaries (a11y labels + visible rows share one source).
// ---------------------------------------------------------------------------

const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function calendarDay(date: Date): { year: number; month: number; day: number } {
  return { year: date.getFullYear(), month: date.getMonth(), day: date.getDate() };
}

function sameDay(a: { year: number; month: number; day: number }, b: { year: number; month: number; day: number }): boolean {
  return a.year === b.year && a.month === b.month && a.day === b.day;
}

export function formatDayLabel(date: Date, now: Date): string {
  const target = calendarDay(date);
  const today = calendarDay(now);
  if (sameDay(target, today)) {
    return "Today";
  }
  const yesterday = calendarDay(new Date(today.year, today.month, today.day - 1));
  if (sameDay(target, yesterday)) {
    return "Yesterday";
  }
  const month = MONTH_LABELS[date.getMonth()] ?? "";
  return `${month} ${date.getDate()}`;
}

export function formatTimeLabel(date: Date): string {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

export function formatCapturedLabel(date: Date, now: Date): string {
  return `${formatDayLabel(date, now)}, ${formatTimeLabel(date)}`;
}

export function formatValueLabel(
  shape: CaptureShape,
  values: Readonly<Record<string, number>>,
): string {
  if (shape.fields.length === 2) {
    const [first, second] = shape.fields;
    if (first !== undefined && second !== undefined) {
      const firstUnit = first.metric.unitDomain[0] ?? "";
      const secondUnit = second.metric.unitDomain[0] ?? "";
      if (firstUnit === secondUnit) {
        return `${values[first.id] ?? 0}/${values[second.id] ?? 0} ${firstUnit}`;
      }
    }
  }
  return shape.fields
    .map((field) => `${values[field.id] ?? 0} ${field.metric.unitDomain[0] ?? ""}`)
    .join(" · ");
}

/** Row summary for the history list (also the a11y label of the row). */
export function buildRecordSummary(record: MobileCaptureRecord, now: Date): {
  readonly title: string;
  readonly subtitle: string;
  readonly accessibilityLabel: string;
} {
  const shape = findCaptureShape(record.shapeId);
  const values: Record<string, number> = {};
  for (const observation of record.observations) {
    const field = shape?.fields.find((candidate) => candidate.metric.id === observation.metricId);
    if (field !== undefined) {
      values[field.id] = observation.value;
    }
  }
  const valueLabel =
    shape !== undefined ? formatValueLabel(shape, values) : record.observations
      .map((observation) => `${observation.value} ${observation.unit}`)
      .join(" · ");
  const captured = new Date(record.capturedAt);
  const title = `${record.shapeLabel} ${valueLabel}`;
  const subtitle = `${formatCapturedLabel(captured, now)} · Manual · Quality: ${
    CAPTURE_QUALITY_LABELS[record.qualityState]
  }`;
  const methodSummary = record.observations
    .map((observation) => observation.methodId)
    .join(", ");
  const accessibilityLabel =
    `${title}, ${subtitle}, recorded by you (self-tracking), ` +
    `methods actually used: ${methodSummary}`;
  return { title, subtitle, accessibilityLabel };
}
