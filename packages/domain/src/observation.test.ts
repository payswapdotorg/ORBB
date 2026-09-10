import { describe, expect, it } from "vitest";
import { DomainInvariantError } from "./errors.js";
import {
  parseEvidenceId,
  parseObservationId,
  parsePersonId,
  parseProvenanceId,
  parseSourceId,
} from "./ids.js";
import { parseEvidenceLabel } from "./evidence.js";
import {
  OBSERVATION_VALIDATION_TRANSITIONS,
  allowedObservationValidationTransitions,
  assertObservationValidationTransition,
  canTransitionObservationValidation,
  isObservationValidationState,
  isQualityScore,
  parseObservationValidationState,
  parseQualityScore,
  type Observation,
} from "./observation.js";

const BODY = "01h45y6e8x2xq4n8v3m2k9abcd";

describe("observation validation state machine", () => {
  it("allows pending -> validated and pending -> rejected", () => {
    expect(canTransitionObservationValidation("pending", "validated")).toBe(true);
    expect(canTransitionObservationValidation("pending", "rejected")).toBe(true);
    expect(() => assertObservationValidationTransition("pending", "validated")).not.toThrow();
    expect(() => assertObservationValidationTransition("pending", "rejected")).not.toThrow();
  });

  it("rejects illegal transitions out of terminal states", () => {
    expect(canTransitionObservationValidation("validated", "rejected")).toBe(false);
    expect(canTransitionObservationValidation("rejected", "validated")).toBe(false);
    expect(canTransitionObservationValidation("validated", "pending")).toBe(false);
    expect(canTransitionObservationValidation("rejected", "pending")).toBe(false);
    expect(() =>
      assertObservationValidationTransition("validated", "rejected"),
    ).toThrow(DomainInvariantError);
    expect(() =>
      assertObservationValidationTransition("rejected", "validated"),
    ).toThrow(DomainInvariantError);
  });

  it("rejects self-loops on pending", () => {
    expect(canTransitionObservationValidation("pending", "pending")).toBe(false);
    expect(() => assertObservationValidationTransition("pending", "pending")).toThrow(
      DomainInvariantError,
    );
  });

  it("treats validated and rejected as terminal", () => {
    expect(allowedObservationValidationTransitions("validated")).toEqual([]);
    expect(allowedObservationValidationTransitions("rejected")).toEqual([]);
    expect(OBSERVATION_VALIDATION_TRANSITIONS.validated).toEqual([]);
    expect(OBSERVATION_VALIDATION_TRANSITIONS.rejected).toEqual([]);
  });

  it("parses legal states and rejects unknown state names", () => {
    expect(parseObservationValidationState("pending")).toBe("pending");
    expect(isObservationValidationState("validated")).toBe(true);
    expect(isObservationValidationState("quarantined")).toBe(false);
    expect(() => parseObservationValidationState("quarantined")).toThrow(DomainInvariantError);
    expect(() => parseObservationValidationState(1)).toThrow(DomainInvariantError);
  });
});

describe("quality score", () => {
  it("accepts finite numbers in [0, 1]", () => {
    expect(parseQualityScore(0)).toBe(0);
    expect(parseQualityScore(1)).toBe(1);
    expect(parseQualityScore(0.92)).toBe(0.92);
    expect(isQualityScore(0.5)).toBe(true);
  });

  it("rejects values outside [0, 1] and non-numbers", () => {
    expect(isQualityScore(-0.1)).toBe(false);
    expect(isQualityScore(1.1)).toBe(false);
    expect(isQualityScore(Number.NaN)).toBe(false);
    expect(isQualityScore("0.5")).toBe(false);
    expect(() => parseQualityScore(-0.1)).toThrow(DomainInvariantError);
    expect(() => parseQualityScore(1.1)).toThrow(DomainInvariantError);
    expect(() => parseQualityScore(Number.NaN)).toThrow(DomainInvariantError);
    expect(() => parseQualityScore("0.5")).toThrow(DomainInvariantError);
  });
});

describe("observation type", () => {
  it("accepts a well-formed Observation with optional fields present", () => {
    const observation: Observation = {
      id: parseObservationId(`obs_${BODY}`),
      personId: parsePersonId(`prsn_${BODY}`),
      conceptCode: "8867-4",
      value: 62,
      unit: "beats/min",
      effectiveAt: new Date("2025-01-15T07:45:00.000Z"),
      observedAt: new Date("2025-01-15T08:00:00.000Z"),
      sourceId: parseSourceId(`src_${BODY}`),
      methodId: "manual-entry",
      evidenceId: parseEvidenceId(`evid_${BODY}`),
      quality: parseQualityScore(0.92),
      validationState: "pending",
      provenanceId: parseProvenanceId(`prov_${BODY}`),
      evidenceLabel: parseEvidenceLabel("MEASURED"),
    };
    expect(observation.validationState).toBe("pending");
    expect(observation.evidenceLabel).toBe("MEASURED");
    expect(observation.quality).toBe(0.92);
  });

  it("accepts a minimal Observation with unit set to the empty string", () => {
    const observation: Observation = {
      id: parseObservationId(`obs_${BODY}`),
      personId: parsePersonId(`prsn_${BODY}`),
      conceptCode: "72166-2",
      value: "smoker",
      unit: "",
      effectiveAt: new Date("2025-01-15T07:45:00.000Z"),
      observedAt: new Date("2025-01-15T08:00:00.000Z"),
      sourceId: parseSourceId(`src_${BODY}`),
      methodId: "interview",
      validationState: "pending",
      provenanceId: parseProvenanceId(`prov_${BODY}`),
      evidenceLabel: "ESTIMATED",
    };
    expect(observation.evidenceId).toBeUndefined();
    expect(observation.quality).toBeUndefined();
    expect(observation.unit).toBe("");
  });
});
