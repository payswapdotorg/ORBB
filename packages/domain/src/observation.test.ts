import { describe, expect, it } from "vitest";
import { DomainInvariantError } from "./errors.js";
import {
  parseEvidenceId,
  parseObservationId,
  parsePersonId,
  parseProvenanceId,
  parseSourceId,
  type ObservationId,
} from "./ids.js";
import { parseEvidenceLabel } from "./evidence.js";
import {
  OBSERVATION_VALIDATION_TRANSITIONS,
  allowedObservationValidationTransitions,
  assertObservation,
  assertObservationValidationTransition,
  canTransitionObservationValidation,
  isObservation,
  isObservationValidationState,
  isQualityScore,
  parseObservationValidationState,
  parseQualityScore,
  supersede,
  type Observation,
  type QualityScore,
} from "./observation.js";

const BODY = "01h45y6e8x2xq4n8v3m2k9abcd";

function makeObservation(overrides: Partial<Observation> = {}): Observation {
  return {
    id: parseObservationId(`obs_${BODY}`),
    personId: parsePersonId(`prsn_${BODY}`),
    conceptCode: "8867-4",
    value: 62,
    unit: "beats/min",
    effectiveAt: new Date("2025-01-15T07:45:00.000Z"),
    observedAt: new Date("2025-01-15T08:00:00.000Z"),
    sourceId: parseSourceId(`src_${BODY}`),
    methodId: "manual-entry",
    validationState: "pending",
    provenanceId: parseProvenanceId(`prov_${BODY}`),
    evidenceLabel: parseEvidenceLabel("MEASURED"),
    ...overrides,
  };
}

describe("observation validation state machine", () => {
  it("allows pending -> validated and pending -> rejected", () => {
    expect(canTransitionObservationValidation("pending", "validated")).toBe(true);
    expect(canTransitionObservationValidation("pending", "rejected")).toBe(true);
    expect(() => assertObservationValidationTransition("pending", "validated")).not.toThrow();
    expect(() => assertObservationValidationTransition("pending", "rejected")).not.toThrow();
  });

  it("allows validated -> superseded (M1 amendment edge)", () => {
    expect(canTransitionObservationValidation("validated", "superseded")).toBe(true);
    expect(() => assertObservationValidationTransition("validated", "superseded")).not.toThrow();
    expect(allowedObservationValidationTransitions("validated")).toEqual(["superseded"]);
    expect(OBSERVATION_VALIDATION_TRANSITIONS.validated).toEqual(["superseded"]);
  });

  it("rejects illegal transitions out of terminal states", () => {
    expect(canTransitionObservationValidation("validated", "rejected")).toBe(false);
    expect(canTransitionObservationValidation("rejected", "validated")).toBe(false);
    expect(canTransitionObservationValidation("rejected", "superseded")).toBe(false);
    expect(canTransitionObservationValidation("superseded", "validated")).toBe(false);
    expect(canTransitionObservationValidation("superseded", "rejected")).toBe(false);
    expect(canTransitionObservationValidation("validated", "pending")).toBe(false);
    expect(canTransitionObservationValidation("rejected", "pending")).toBe(false);
    expect(() =>
      assertObservationValidationTransition("validated", "rejected"),
    ).toThrow(DomainInvariantError);
    expect(() =>
      assertObservationValidationTransition("rejected", "validated"),
    ).toThrow(DomainInvariantError);
    expect(() =>
      assertObservationValidationTransition("superseded", "pending"),
    ).toThrow(DomainInvariantError);
  });

  it("rejects supersession edges the grammar forbids", () => {
    // pending must be validated or rejected first — it cannot jump to superseded
    expect(canTransitionObservationValidation("pending", "superseded")).toBe(false);
    expect(() => assertObservationValidationTransition("pending", "superseded")).toThrow(
      DomainInvariantError,
    );
    // rejected is terminal — a rejected value is never superseded
    expect(() => assertObservationValidationTransition("rejected", "superseded")).toThrow(
      DomainInvariantError,
    );
    // superseded is terminal — no further moves
    expect(() => assertObservationValidationTransition("superseded", "superseded")).toThrow(
      DomainInvariantError,
    );
  });

  it("rejects self-loops on pending", () => {
    expect(canTransitionObservationValidation("pending", "pending")).toBe(false);
    expect(() => assertObservationValidationTransition("pending", "pending")).toThrow(
      DomainInvariantError,
    );
  });

  it("treats rejected and superseded as terminal", () => {
    expect(allowedObservationValidationTransitions("rejected")).toEqual([]);
    expect(allowedObservationValidationTransitions("superseded")).toEqual([]);
    expect(OBSERVATION_VALIDATION_TRANSITIONS.rejected).toEqual([]);
    expect(OBSERVATION_VALIDATION_TRANSITIONS.superseded).toEqual([]);
  });

  it("parses legal states and rejects unknown state names", () => {
    expect(parseObservationValidationState("pending")).toBe("pending");
    expect(isObservationValidationState("validated")).toBe(true);
    expect(isObservationValidationState("superseded")).toBe(true);
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

describe("observation structural guard (M1 gap review)", () => {
  it("accepts a well-formed observation", () => {
    const observation = makeObservation();
    expect(isObservation(observation)).toBe(true);
    expect(() => assertObservation(observation)).not.toThrow();
  });

  it("accepts an observation carrying a canonical supersedesId", () => {
    const observation = makeObservation({
      supersedesId: parseObservationId(`obs_${"a1b2c3d4e5f6g7h8i9j0klmno"}`),
    });
    expect(isObservation(observation)).toBe(true);
  });

  it("rejects malformed ids, codes, dates, and states without echoing values", () => {
    expect(isObservation(null)).toBe(false);
    expect(isObservation("obs")).toBe(false);
    expect(
      isObservation(makeObservation({ id: "not-an-observation-id" as unknown as Observation["id"] })),
    ).toBe(false);
    expect(
      isObservation(makeObservation({ personId: "obs_x" as unknown as Observation["personId"] })),
    ).toBe(false);
    expect(isObservation(makeObservation({ conceptCode: "" }))).toBe(false);
    expect(isObservation(makeObservation({ methodId: "" }))).toBe(false);
    expect(
      isObservation(makeObservation({ value: { raw: 1 } as unknown as Observation["value"] })),
    ).toBe(false);
    expect(
      isObservation(makeObservation({ effectiveAt: new Date("not-a-date") })),
    ).toBe(false);
    expect(
      isObservation(makeObservation({ observedAt: new Date("not-a-date") })),
    ).toBe(false);
    expect(
      isObservation(
        makeObservation({
          validationState: "quarantined" as unknown as Observation["validationState"],
        }),
      ),
    ).toBe(false);
    expect(
      isObservation(
        makeObservation({ evidenceLabel: "GUESSED" as unknown as Observation["evidenceLabel"] }),
      ),
    ).toBe(false);
    expect(
      isObservation(makeObservation({ quality: 1.5 as unknown as QualityScore })),
    ).toBe(false);
    expect(
      isObservation(
        makeObservation({ supersedesId: "junk" as unknown as ObservationId }),
      ),
    ).toBe(false);
    for (const bad of [
      makeObservation({ id: "not-an-observation-id" as unknown as Observation["id"] }),
      makeObservation({ conceptCode: "" }),
      makeObservation({ effectiveAt: new Date("not-a-date") }),
      makeObservation({ quality: 1.5 as unknown as QualityScore }),
    ]) {
      expect(() => assertObservation(bad)).toThrow(DomainInvariantError);
    }
  });
});

describe("supersede (amendment semantics)", () => {
  const oldId = parseObservationId(`obs_${"01h45y6e8x2xq4n8v3m2k9abcd"}`);
  const newId = parseObservationId(`obs_${"99zzy6e8x2xq4n8v3m2k9wxyz"}`);

  function makeValidatedOld(): Observation {
    return makeObservation({ id: oldId, validationState: "validated", value: 62 });
  }

  function makePendingReplacement(): Observation {
    return makeObservation({
      id: newId,
      value: 58,
      provenanceId: parseProvenanceId(`prov_${"99zzy6e8x2xq4n8v3m2k9wxyz"}`),
      supersedesId: oldId,
    });
  }

  it("supersedes a validated observation with a pending replacement", () => {
    const pair = supersede(makeValidatedOld(), makePendingReplacement());
    expect(pair.superseded.id).toBe(oldId);
    expect(pair.superseded.validationState).toBe("superseded");
    expect(pair.superseded.value).toBe(62);
    expect(pair.replacement.id).toBe(newId);
    expect(pair.replacement.validationState).toBe("validated");
    expect(pair.replacement.value).toBe(58);
    expect(pair.replacement.supersedesId).toBe(oldId);
  });

  it("never mutates the inputs in place (values are preserved on the originals)", () => {
    const oldObservation = makeValidatedOld();
    const next = makePendingReplacement();
    supersede(oldObservation, next);
    expect(oldObservation.validationState).toBe("validated");
    expect(oldObservation.value).toBe(62);
    expect(next.validationState).toBe("pending");
    expect(next.value).toBe(58);
    expect(next.supersedesId).toBe(oldId);
  });

  it("supports a correction chain (obs3 supersedes the replacement of obs2)", () => {
    const first = supersede(makeValidatedOld(), makePendingReplacement());
    const thirdId = parseObservationId(`obs_${"77aay6e8x2xq4n8v3m2k9tuvwx"}`);
    const third = makeObservation({
      id: thirdId,
      value: 55,
      provenanceId: parseProvenanceId(`prov_${"77aay6e8x2xq4n8v3m2k9tuvwx"}`),
      supersedesId: newId,
    });
    const second = supersede(first.replacement, third);
    expect(first.replacement.validationState).toBe("validated");
    expect(second.superseded.id).toBe(newId);
    expect(second.superseded.validationState).toBe("superseded");
    expect(second.replacement.id).toBe(thirdId);
    expect(second.replacement.supersedesId).toBe(newId);
    // provenance preserves the full correction chain:
    // obs3.supersedesId -> obs2, obs2.supersedesId -> obs1
    expect(second.replacement.supersedesId).toBe(second.superseded.id);
    expect(first.replacement.supersedesId).toBe(oldId);
  });

  it("throws when the old observation is pending (must be validated first)", () => {
    const oldObservation = makeObservation({ id: oldId, validationState: "pending" });
    expect(() => supersede(oldObservation, makePendingReplacement())).toThrow(
      DomainInvariantError,
    );
  });

  it("throws when the old observation is rejected (terminal)", () => {
    const oldObservation = makeObservation({ id: oldId, validationState: "rejected" });
    expect(() => supersede(oldObservation, makePendingReplacement())).toThrow(
      DomainInvariantError,
    );
  });

  it("throws when the old observation is already superseded (terminal)", () => {
    const oldObservation = makeObservation({ id: oldId, validationState: "superseded" });
    expect(() => supersede(oldObservation, makePendingReplacement())).toThrow(
      DomainInvariantError,
    );
  });

  it("throws when the replacement is not pending", () => {
    const replacement = makePendingReplacement();
    expect(() =>
      supersede(makeValidatedOld(), { ...replacement, validationState: "validated" }),
    ).toThrow(DomainInvariantError);
    expect(() =>
      supersede(makeValidatedOld(), { ...replacement, validationState: "rejected" }),
    ).toThrow(DomainInvariantError);
    expect(() =>
      supersede(makeValidatedOld(), { ...replacement, validationState: "superseded" }),
    ).toThrow(DomainInvariantError);
  });

  it("throws when the replacement lacks a supersedesId", () => {
    const replacement = makeObservation({
      id: newId,
      value: 58,
      provenanceId: parseProvenanceId(`prov_${"99zzy6e8x2xq4n8v3m2k9wxyz"}`),
    });
    expect(replacement.supersedesId).toBeUndefined();
    expect(() => supersede(makeValidatedOld(), replacement)).toThrow(DomainInvariantError);
  });

  it("throws when the replacement's supersedesId points elsewhere", () => {
    const replacement = makePendingReplacement();
    const replacementOther = {
      ...replacement,
      supersedesId: parseObservationId(`obs_${"55bby6e8x2xq4n8v3m2k9rstuv"}`),
    };
    expect(() => supersede(makeValidatedOld(), replacementOther)).toThrow(DomainInvariantError);
  });

  it("throws when an observation tries to supersede itself", () => {
    const selfReplacement = makeObservation({
      id: oldId,
      validationState: "pending",
      supersedesId: oldId,
    });
    expect(() => supersede(makeValidatedOld(), selfReplacement)).toThrow(DomainInvariantError);
  });

  it("throws when the replacement belongs to a different person", () => {
    const replacement = makePendingReplacement();
    const foreign = {
      ...replacement,
      personId: parsePersonId(`prsn_${"22ccy6e8x2xq4n8v3m2k9qrstuv"}`),
    };
    expect(() => supersede(makeValidatedOld(), foreign)).toThrow(DomainInvariantError);
  });

  it("throws when the replacement carries a different concept code", () => {
    const replacement = makePendingReplacement();
    const reTagged = { ...replacement, conceptCode: "8867-5" };
    expect(() => supersede(makeValidatedOld(), reTagged)).toThrow(DomainInvariantError);
  });

  it("allows corrections that change value, unit, and timestamps", () => {
    const replacement = makePendingReplacement();
    const corrected = {
      ...replacement,
      value: 58,
      unit: "BEATS/MIN",
      effectiveAt: new Date("2025-01-15T07:50:00.000Z"),
      observedAt: new Date("2025-01-15T09:30:00.000Z"),
    };
    const pair = supersede(makeValidatedOld(), corrected);
    expect(pair.replacement.unit).toBe("BEATS/MIN");
    expect(pair.superseded.unit).toBe("beats/min");
  });

  it("throws when either input is structurally malformed", () => {
    const malformed = makeObservation({ conceptCode: "" });
    expect(() => supersede(malformed, makePendingReplacement())).toThrow(DomainInvariantError);
    expect(() => supersede(makeValidatedOld(), malformed)).toThrow(DomainInvariantError);
  });
});
