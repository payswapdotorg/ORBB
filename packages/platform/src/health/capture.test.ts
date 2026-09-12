import { describe, expect, it } from "vitest";
import { DeterministicClock } from "@orbb/testkit";
import { parseQualityScore, type PersonId, type SourceId } from "@orbb/domain";
import {
  MANUAL_CAPTURE_METRIC_SUPPORT,
  SyntheticManualCaptureSession,
} from "./capture.js";

const PERSON_ID = "prsn_SYNTH-person-0001" as PersonId;
const MANUAL_SOURCE_ID = "src_SYNTH-source-manual-0001" as SourceId;

const CAPTURED_AT = new Date("2026-09-10T08:30:00.000Z");

function buildSession() {
  const clock = new DeterministicClock({ epochMs: new Date("2026-09-10T09:00:00.000Z").getTime() });
  const session = new SyntheticManualCaptureSession({ nowMs: () => clock.epochMs });
  return { session, clock };
}

describe("SyntheticManualCaptureSession", () => {
  it("produces one domain-shaped draft per captured field with full provenance", () => {
    const { session } = buildSession();
    const result = session.capture({
      personId: PERSON_ID,
      sourceId: MANUAL_SOURCE_ID,
      methodId: "SYNTH-method-hr-manual",
      capturedAt: CAPTURED_AT,
      fields: [{ metricId: "SYNTH-metric-heart-rate", value: 68 }],
      quality: parseQualityScore(0.7),
      correlationId: "SYNTH-MCAP-record-1",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(1);
      const draft = result.value[0];
      expect(draft?.personId).toBe(PERSON_ID);
      expect(draft?.sourceId).toBe(MANUAL_SOURCE_ID);
      expect(draft?.metricId).toBe("SYNTH-metric-heart-rate");
      expect(draft?.conceptCode).toBe("SYNTH-8867-4");
      expect(draft?.value).toBe(68);
      expect(draft?.unit).toBe("beats/min");
      expect(draft?.effectiveAt).toBe(CAPTURED_AT);
      expect(draft?.methodId).toBe("SYNTH-method-hr-manual");
      expect(draft?.evidenceLabel).toBe("MEASURED");
      expect(draft?.quality).toBe(0.7);
      expect(draft?.validationState).toBe("pending");
      expect(draft?.provenance.sourceId).toBe(MANUAL_SOURCE_ID);
      expect(draft?.provenance.methodId).toBe("SYNTH-method-hr-manual");
      expect(draft?.provenance.nativeTimestamp).toBe(CAPTURED_AT);
      expect(draft?.provenance.nativeSampleId).toBe("SYNTH-MCAP-000001");
      expect(draft?.provenance.unitConversion.applied).toBe(false);
      expect(draft?.provenance.unitConversion.fromUnit).toBe("beats/min");
      expect(draft?.provenance.unitConversion.toUnit).toBe("beats/min");
      expect(draft?.provenance.sourceMetadata["manual.capture"]).toBe("synthetic");
      expect(draft?.provenance.sourceMetadata["manual.correlationId"]).toBe("SYNTH-MCAP-record-1");
    }
  });

  it("mints sequential SYNTH native sample ids across captures", () => {
    const { session } = buildSession();
    const first = session.capture({
      personId: PERSON_ID,
      sourceId: MANUAL_SOURCE_ID,
      methodId: "SYNTH-method-hr-manual",
      capturedAt: CAPTURED_AT,
      fields: [{ metricId: "SYNTH-metric-heart-rate", value: 68 }],
    });
    const second = session.capture({
      personId: PERSON_ID,
      sourceId: MANUAL_SOURCE_ID,
      methodId: "SYNTH-method-steps-manual",
      capturedAt: CAPTURED_AT,
      fields: [{ metricId: "SYNTH-metric-step-count", value: 4200 }],
    });
    expect(first.ok && first.value[0]?.provenance.nativeSampleId).toBe("SYNTH-MCAP-000001");
    expect(second.ok && second.value[0]?.provenance.nativeSampleId).toBe("SYNTH-MCAP-000002");
  });

  it("captures multiple fields in one session", () => {
    const { session } = buildSession();
    const result = session.capture({
      personId: PERSON_ID,
      sourceId: MANUAL_SOURCE_ID,
      methodId: "SYNTH-method-hr-manual",
      capturedAt: CAPTURED_AT,
      fields: [
        { metricId: "SYNTH-metric-heart-rate", value: 68 },
        { metricId: "SYNTH-metric-step-count", value: 4200 },
        { metricId: "SYNTH-metric-sleep-minutes", value: 455 },
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.map((draft) => draft.unit)).toEqual(["beats/min", "count", "min"]);
      expect(result.value.map((draft) => draft.evidenceLabel)).toEqual([
        "MEASURED",
        "ESTIMATED",
        "ESTIMATED",
      ]);
    }
  });

  it("rejects unknown metrics, invalid values, and malformed inputs (typed, never throws)", () => {
    const { session } = buildSession();
    const base = {
      personId: PERSON_ID,
      sourceId: MANUAL_SOURCE_ID,
      methodId: "SYNTH-method-hr-manual",
      capturedAt: CAPTURED_AT,
    };
    expect(session.capture({ ...base, fields: [{ metricId: "SYNTH-metric-unknown", value: 1 }] })).toEqual(
      { ok: false, error: { kind: "unknown-metric" } },
    );
    expect(session.capture({ ...base, fields: [{ metricId: "SYNTH-metric-heart-rate", value: Number.NaN }] })).toEqual(
      { ok: false, error: { kind: "invalid-value" } },
    );
    expect(session.capture({ ...base, fields: [] })).toEqual({
      ok: false,
      error: { kind: "invalid-input" },
    });
    expect(
      session.capture({ ...base, personId: "not-canonical" as never, fields: [{ metricId: "SYNTH-metric-heart-rate", value: 68 }] }),
    ).toEqual({ ok: false, error: { kind: "invalid-input" } });
  });

  it("supports the SYNTH metric surface aligned with the engine seed", () => {
    expect(MANUAL_CAPTURE_METRIC_SUPPORT.map((entry) => entry.metricId)).toEqual([
      "SYNTH-metric-heart-rate",
      "SYNTH-metric-step-count",
      "SYNTH-metric-sleep-minutes",
    ]);
    expect(MANUAL_CAPTURE_METRIC_SUPPORT.every((entry) => entry.conceptCode.startsWith("SYNTH-"))).toBe(true);
  });
});
