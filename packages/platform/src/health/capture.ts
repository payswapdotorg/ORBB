/**
 * Manual capture-session contract (Lane C packet M4-C) — method 1 of the
 * M4 exit harness: a TYPED capture-session double producing observation
 * drafts for the MANUAL measurement path (A33's user surface is Lane B's;
 * this is the engine-side seam the Lane A engine will implement — handoff
 * recorded).
 *
 * The contract mirrors the capture semantics Lane B already models in the
 * apps (`createMobileCaptureRecord` / web capture): the person enters
 * values in CANONICAL metric units, so no unit conversion is applied
 * (`unitConversion.applied === false`) and the draft's provenance records
 * the capture timestamp as the native timestamp plus a deterministic
 * synthetic native sample id.
 *
 * Metric ids, concept codes, units, and manual method ids align with the
 * Lane A engine seed and the Lane B capture catalog (SYNTH-marked).
 */
import type { EvidenceLabel, PersonId, QualityScore, SourceId } from "@orbb/domain";
import { isIdOf } from "@orbb/domain";
import { err, ok, type HealthResult } from "./result.js";
import type { ObservationDraft } from "./sources.js";

// ---------------------------------------------------------------------------
// Contract.
// ---------------------------------------------------------------------------

/** One manually captured reading (value in the metric's canonical unit). */
export interface ManualCaptureField {
  readonly metricId: string;
  readonly value: number;
}

/** A manual capture session submission. */
export interface ManualCaptureInput {
  readonly personId: PersonId;
  /** The registered MANUAL source performing the capture. */
  readonly sourceId: SourceId;
  /** The method actually used (opaque method code, e.g. "SYNTH-method-hr-manual"). */
  readonly methodId: string;
  /** When the reading was taken (the clinically relevant time). */
  readonly capturedAt: Date;
  readonly fields: readonly ManualCaptureField[];
  /** Optional self-assessed quality in [0, 1]. */
  readonly quality?: QualityScore;
  /** Optional correlation token threaded onto draft provenance metadata. */
  readonly correlationId?: string;
}

/** Typed capture rejections (PHID-safe, values never echoed). */
export type ManualCaptureError =
  | { readonly kind: "invalid-input" }
  | { readonly kind: "unknown-metric" }
  | { readonly kind: "invalid-value" };

/**
 * The manual capture-session port: one call per capture session, one
 * observation draft per captured field. The ENGINE owns the real
 * implementation (task linkage, attempt recording, duplicate suppression
 * — handoff recorded); this packet ships the contract plus a synthetic
 * double for the harness.
 */
export interface ManualCaptureSession {
  capture(input: ManualCaptureInput): HealthResult<readonly ObservationDraft[], ManualCaptureError>;
}

// ---------------------------------------------------------------------------
// Reference double.
// ---------------------------------------------------------------------------

/** Metric support entry of the synthetic capture session. */
export interface ManualCaptureMetricSupport {
  readonly metricId: string;
  readonly conceptCode: string;
  /** Canonical unit — manual entry is IN canonical units (no conversion). */
  readonly unit: string;
  readonly evidenceLabel: EvidenceLabel;
}

/**
 * The supported metric surface of the synthetic manual capture session
 * (heart rate, step count, sleep minutes — SYNTH ids aligned with the
 * Lane A engine seed; manual methods per the seed's manual vocabulary).
 */
export const MANUAL_CAPTURE_METRIC_SUPPORT: readonly ManualCaptureMetricSupport[] = [
  {
    metricId: "SYNTH-metric-heart-rate",
    conceptCode: "SYNTH-8867-4",
    unit: "beats/min",
    evidenceLabel: "MEASURED",
  },
  {
    metricId: "SYNTH-metric-step-count",
    conceptCode: "SYNTH-41950-7",
    unit: "count",
    evidenceLabel: "ESTIMATED",
  },
  {
    metricId: "SYNTH-metric-sleep-minutes",
    conceptCode: "SYNTH-94641-0",
    unit: "min",
    evidenceLabel: "ESTIMATED",
  },
];

/** Options for {@link SyntheticManualCaptureSession}. */
export interface SyntheticManualCaptureSessionOptions {
  /** Overridable metric support table. Default: {@link MANUAL_CAPTURE_METRIC_SUPPORT}. */
  readonly support?: readonly ManualCaptureMetricSupport[];
  /** Injectable time source (epoch ms) for the observedAt stamps. Default: Date.now. */
  readonly nowMs?: () => number;
}

/**
 * Synthetic manual capture-session double: produces one domain-shaped
 * observation draft per captured field with full draft provenance (source
 * id, method, native timestamp = capturedAt, unit conversion NOT applied
 * — manual entry is in canonical units — and a deterministic SYNTH native
 * sample id per field).
 */
export class SyntheticManualCaptureSession implements ManualCaptureSession {
  readonly #support: readonly ManualCaptureMetricSupport[];
  readonly #nowMs: () => number;
  #sequence = 0;

  constructor(options?: SyntheticManualCaptureSessionOptions) {
    this.#support = options?.support ?? MANUAL_CAPTURE_METRIC_SUPPORT;
    this.#nowMs = options?.nowMs ?? Date.now;
  }

  capture(input: ManualCaptureInput): HealthResult<readonly ObservationDraft[], ManualCaptureError> {
    if (
      !isIdOf("person", input.personId) ||
      !isIdOf("source", input.sourceId) ||
      typeof input.methodId !== "string" ||
      input.methodId.length === 0 ||
      !(input.capturedAt instanceof Date) ||
      Number.isNaN(input.capturedAt.getTime()) ||
      !Array.isArray(input.fields) ||
      input.fields.length === 0
    ) {
      return err({ kind: "invalid-input" });
    }
    const drafts: ObservationDraft[] = [];
    for (const field of input.fields) {
      const support = this.#support.find((entry) => entry.metricId === field.metricId);
      if (support === undefined) {
        return err({ kind: "unknown-metric" });
      }
      if (typeof field.value !== "number" || !Number.isFinite(field.value)) {
        return err({ kind: "invalid-value" });
      }
      this.#sequence += 1;
      drafts.push({
        personId: input.personId,
        sourceId: input.sourceId,
        metricId: support.metricId,
        conceptCode: support.conceptCode,
        value: field.value,
        unit: support.unit,
        effectiveAt: input.capturedAt,
        observedAt: new Date(this.#nowMs()),
        methodId: input.methodId,
        evidenceLabel: support.evidenceLabel,
        ...(input.quality !== undefined ? { quality: input.quality } : {}),
        validationState: "pending",
        provenance: {
          sourceId: input.sourceId,
          methodId: input.methodId,
          nativeTimestamp: input.capturedAt,
          nativeSampleId: `SYNTH-MCAP-${String(this.#sequence).padStart(6, "0")}`,
          unitConversion: {
            applied: false,
            fromUnit: support.unit,
            toUnit: support.unit,
            factor: 1,
          },
          sourceMetadata: {
            "manual.capture": "synthetic",
            ...(input.correlationId !== undefined
              ? { "manual.correlationId": input.correlationId }
              : {}),
          },
        },
      });
    }
    return ok(drafts);
  }
}
