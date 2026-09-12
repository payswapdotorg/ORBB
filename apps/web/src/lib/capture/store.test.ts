import { afterEach, describe, expect, it } from "vitest";
import { SYNTHETIC_PERSON_ID, SYNTHETIC_SOURCE_ID, findCaptureShape } from "./catalog";
import {
  CAPTURE_HISTORY_LIMIT,
  captureValueLabel,
  listRecentCaptures,
  resetCaptureStore,
  storeCapture,
} from "./store";
import { qualityScoreFromState } from "./quality";
import type { CaptureSubmission } from "./types";

/**
 * In-memory capture store contract tests (M4-B): domain-shaped records,
 * provenance actor = the person (self-tracking), method-actually-used
 * recording, quality states landing as recorded, deterministic ids.
 */

afterEach(() => {
  resetCaptureStore();
});

function submission(overrides: Partial<CaptureSubmission> = {}): CaptureSubmission {
  return {
    shapeId: "SYNTH-shape-bp-panel",
    methodOptionId: "SYNTH-method-manual-bp-panel",
    fieldValues: { systolic: 118, diastolic: 76 },
    qualityState: "partial",
    capturedAtIso: "2026-09-10T08:30:00.000Z",
    ...overrides,
  };
}

describe("storeCapture", () => {
  it("stores one observation per captured field with canonical SYNTH ids", () => {
    const record = storeCapture(submission(), new Date("2026-09-10T09:00:00.000Z"));
    expect(record.captureId).toBe("SYNTH-CAP-000001");
    expect(record.observations).toHaveLength(2);
    const [systolic, diastolic] = record.observations;
    expect(systolic?.id).toBe("obs_SYNTH-obs-000001");
    expect(systolic?.metricId).toBe("SYNTH-metric-bp-systolic");
    expect(systolic?.conceptCode).toBe("SYNTH-8480-5");
    expect(systolic?.value).toBe(118);
    expect(systolic?.unit).toBe("mmHg");
    expect(diastolic?.id).toBe("obs_SYNTH-obs-000002");
    expect(diastolic?.metricId).toBe("SYNTH-metric-bp-diastolic");
    expect(diastolic?.value).toBe(76);
    for (const observation of record.observations) {
      expect(observation.id.startsWith("obs_")).toBe(true);
      expect(observation.personId).toBe(SYNTHETIC_PERSON_ID);
      expect(observation.sourceId).toBe(SYNTHETIC_SOURCE_ID);
      expect(observation.validationState).toBe("pending");
    }
  });

  it("records the method ACTUALLY used per observation (component methods)", () => {
    const record = storeCapture(submission(), new Date("2026-09-10T09:00:00.000Z"));
    const [systolic, diastolic] = record.observations;
    expect(systolic?.methodId).toBe("SYNTH-method-bpsys-manual");
    expect(diastolic?.methodId).toBe("SYNTH-method-bpdia-manual");
    expect(record.methodOptionId).toBe("SYNTH-method-manual-bp-panel");
  });

  it("sets provenance actor = the person (self-tracking) with the capture correlation", () => {
    const record = storeCapture(submission(), new Date("2026-09-10T09:00:00.000Z"));
    for (const observation of record.observations) {
      expect(observation.provenance.actor).toBe(SYNTHETIC_PERSON_ID);
      expect(observation.provenance.subject).toBe(SYNTHETIC_PERSON_ID);
      expect(observation.provenance.correlationId).toBe(record.captureId);
      expect(observation.provenance.provenanceId.startsWith("prov_")).toBe(true);
      expect(observation.provenance.occurredAt).toBe(record.recordedAt);
    }
  });

  it("maps effectiveAt to the user-stated time and observedAt to record time", () => {
    const record = storeCapture(
      submission({ capturedAtIso: "2026-09-09T20:30:00.000Z" }),
      new Date("2026-09-10T09:00:00.000Z"),
    );
    expect(record.capturedAt).toBe("2026-09-09T20:30:00.000Z");
    expect(record.recordedAt).toBe("2026-09-10T09:00:00.000Z");
    for (const observation of record.observations) {
      expect(observation.effectiveAt).toBe("2026-09-09T20:30:00.000Z");
      expect(observation.observedAt).toBe("2026-09-10T09:00:00.000Z");
    }
  });

  it("derives the quality score from the self-assessed state per method and never upgrades the state", () => {
    const record = storeCapture(
      submission({ qualityState: "low-quality" }),
      new Date("2026-09-10T09:00:00.000Z"),
    );
    expect(record.qualityState).toBe("low-quality");
    const shape = findCaptureShape("SYNTH-shape-bp-panel");
    for (const observation of record.observations) {
      const field = shape?.fields.find((candidate) => candidate.metric.id === observation.metricId);
      expect(field).toBeDefined();
      expect(observation.quality).toBe(
        qualityScoreFromState("low-quality", field!.method.typicalQuality),
      );
    }
  });

  it("keeps notes optional and present when supplied", () => {
    const bare = storeCapture(submission(), new Date("2026-09-10T09:00:00.000Z"));
    expect("notes" in bare).toBe(false);
    const withNotes = storeCapture(
      submission({ notes: "after exercise" }),
      new Date("2026-09-10T09:00:00.000Z"),
    );
    expect(withNotes.notes).toBe("after exercise");
  });

  it("throws on an unknown shape (programming-error boundary)", () => {
    expect(() =>
      storeCapture(submission({ shapeId: "SYNTH-shape-nope" }), new Date()),
    ).toThrowError(/unknown shape/);
  });
});

describe("listRecentCaptures", () => {
  it("lists most recent first", () => {
    for (let index = 0; index < 3; index += 1) {
      storeCapture(
        submission({ capturedAtIso: `2026-09-0${index + 1}T08:00:00.000Z` }),
        new Date(`2026-09-0${index + 1}T09:00:00.000Z`),
      );
    }
    const recent = listRecentCaptures();
    expect(recent).toHaveLength(3);
    expect(recent[0]?.captureId).toBe("SYNTH-CAP-000003");
    expect(recent[2]?.captureId).toBe("SYNTH-CAP-000001");
  });

  it("caps the history window at the documented limit", () => {
    for (let index = 0; index < CAPTURE_HISTORY_LIMIT + 2; index += 1) {
      storeCapture(
        submission({ capturedAtIso: "2026-09-01T08:00:00.000Z" }),
        new Date("2026-09-01T09:00:00.000Z"),
      );
    }
    expect(listRecentCaptures()).toHaveLength(CAPTURE_HISTORY_LIMIT);
  });
});

describe("captureValueLabel", () => {
  it("renders compound labels for stored records", () => {
    const record = storeCapture(submission(), new Date("2026-09-10T09:00:00.000Z"));
    expect(captureValueLabel(record)).toBe("118/76 mmHg");
  });
});
