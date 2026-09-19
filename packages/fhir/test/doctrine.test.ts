/**
 * Doctrine proofs (definition of done, part 4):
 *   - the privacy-first Patient proofs (default port = identifier-only);
 *   - the Condition `provisional` doctrine (never a confirmed diagnosis
 *     from an intent — binding);
 *   - the superseded-observation status rule (exact table);
 *   - the Consent inactive-on-revoked rule;
 *   - the deny-by-default survival rule (no grant -> no permit-resource,
 *     proven with the REAL domain evaluator: no grants decide DENY, and
 *     a grantless world maps zero Consents).
 */
import { describe, expect, it } from "vitest";
import { evaluateAccess } from "@orbb/domain";
import type { PersonId } from "@orbb/domain";
import { FhirMappingError } from "../src/errors.js";
import { mapPatient } from "../src/patient.js";
import { mapObservation } from "../src/observation.js";
import { mapCondition } from "../src/condition.js";
import { mapConsent } from "../src/consent.js";
import { createFhirMappingContext } from "../src/context.js";
import { serializeCanonical } from "../src/canonical.js";
import { WORLD_A, WORLD_A_IDS, WORLD_B, mapWorld, worldContext } from "./worlds.js";

const ctx = worldContext(WORLD_A);

describe("doctrine — privacy-first Patient (default port = identifier-only)", () => {
  it("the default Patient carries EXACTLY resourceType, id, identifier", () => {
    const patient = mapPatient(WORLD_A_IDS.PERSON_1, ctx);
    expect(Object.keys(patient).sort()).toEqual(["id", "identifier", "resourceType"]);
  });

  it("the identifier carries the opaque canonical PersonId under the SYNTH namespace", () => {
    const patient = mapPatient(WORLD_A_IDS.PERSON_1, ctx);
    expect(patient.identifier).toEqual([
      { system: "https://orbb.test/synth/id/person", value: WORLD_A_IDS.PERSON_1 },
    ]);
  });

  it("a person id that is not canonical fails closed", () => {
    expect(() => mapPatient("not-a-canonical-id", ctx)).toThrow();
  });

  it("the default context's demographic port discloses nothing for any person", () => {
    const defaultCtx = createFhirMappingContext();
    for (const personId of [WORLD_A_IDS.PERSON_1, WORLD_A_IDS.PERSON_2]) {
      expect(defaultCtx.demographics.demographicsFor(personId)).toBeUndefined();
    }
  });
});

describe("doctrine — Condition verificationStatus is ALWAYS provisional (binding)", () => {
  it("every mapped Condition (all intent states) carries verificationStatus provisional", () => {
    const baseIntent = WORLD_A.intents[0]!;
    for (const state of ["draft", "active", "paused", "achieved", "retired"] as const) {
      const condition = mapCondition({ ...baseIntent, state }, ctx);
      expect(condition.verificationStatus.coding).toEqual([
        {
          system: "http://terminology.hl7.org/CodeSystem/condition-ver-status",
          code: "provisional",
        },
      ]);
    }
  });

  it("no Condition output anywhere in the mapped worlds asserts confirmed/differential/refuted", () => {
    const conditions = [
      ...mapWorld(WORLD_A, ctx).resources,
      ...mapWorld(WORLD_B, worldContext(WORLD_B)).resources,
    ]
      .filter((resource) => resource.resourceType === "Condition")
      .map((resource) => serializeCanonical(resource));
    for (const serialized of conditions) {
      expect(serialized).not.toContain("confirmed");
      expect(serialized).not.toContain("differential");
      expect(serialized).not.toContain("refuted");
    }
  });

  it("the conservative clinicalStatus table holds for every intent state", () => {
    const baseIntent = WORLD_A.intents[0]!;
    const expected = {
      draft: "inactive",
      active: "active",
      paused: "inactive",
      achieved: "resolved",
      retired: "inactive",
    } as const;
    for (const [state, clinicalStatus] of Object.entries(expected)) {
      const condition = mapCondition({ ...baseIntent, state: state as keyof typeof expected }, ctx);
      expect(condition.clinicalStatus.coding[0]?.code).toBe(clinicalStatus);
    }
  });
});

describe("doctrine — the superseded-observation status rule (exact table)", () => {
  it("pending -> preliminary, validated -> final, rejected -> entered-in-error, superseded -> entered-in-error", () => {
    const base = WORLD_A.observations[0]!;
    expect(mapObservation({ ...base, validationState: "pending" }, ctx).status).toBe("preliminary");
    expect(mapObservation({ ...base, validationState: "validated" }, ctx).status).toBe("final");
    expect(mapObservation({ ...base, validationState: "rejected" }, ctx).status).toBe("entered-in-error");
    expect(mapObservation({ ...base, validationState: "superseded" }, ctx).status).toBe("entered-in-error");
  });

  it("the world's superseded/replacement pair maps entered-in-error / final respectively", () => {
    const superseded = mapObservation(
      WORLD_A.observations.find((candidate) => candidate.id === WORLD_A_IDS.OBS_B)!,
      ctx,
    );
    const replacement = mapObservation(
      WORLD_A.observations.find((candidate) => candidate.id === WORLD_A_IDS.OBS_C)!,
      ctx,
    );
    expect(superseded.status).toBe("entered-in-error");
    expect(replacement.status).toBe("final");
    // The replacement's own id differs from the superseded one (immutable replacement model).
    expect(replacement.id).not.toBe(superseded.id);
  });

  it("an unknown validation state fails closed with unknown-vocabulary (never a silent partial resource)", () => {
    const smuggled = { ...WORLD_A.observations[0]!, validationState: "quarantined" } as never;
    let caught: unknown;
    try {
      mapObservation(smuggled, ctx);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(FhirMappingError);
    expect((caught as FhirMappingError).kind).toBe("unknown-vocabulary");
  });
});

describe("doctrine — Consent rules", () => {
  it("active grants map to status active; revoked grants map to status inactive", () => {
    const active = mapConsent(
      WORLD_A.grants.find((candidate) => candidate.id === WORLD_A_IDS.GRANT_1)!,
      ctx,
    );
    const revoked = mapConsent(
      WORLD_A.grants.find((candidate) => candidate.id === WORLD_A_IDS.GRANT_2)!,
      ctx,
    );
    expect(active.status).toBe("active");
    expect(revoked.status).toBe("inactive");
  });

  it("the provision is the permit the grant was, with the period from issued/expiresAt", () => {
    const grant = WORLD_A.grants.find((candidate) => candidate.id === WORLD_A_IDS.GRANT_1)!;
    const consent = mapConsent(grant, ctx);
    expect(consent.provision.type).toBe("permit");
    expect(consent.provision.period).toEqual({
      start: "2026-01-02T10:00:00.000Z",
      end: "2026-06-30T23:59:59.000Z",
    });
    expect(consent.provision.action.map((action) => action.coding[0]?.code)).toEqual([
      "observations:read",
      "intent:read",
    ]);
  });

  it("a grant without issuedAt maps a period with END ONLY (never an invented start)", () => {
    const grant = WORLD_A.grants.find((candidate) => candidate.id === WORLD_A_IDS.GRANT_3)!;
    const consent = mapConsent(grant, ctx);
    expect(consent.provision.period.start).toBeUndefined();
    expect(consent.provision.period.end).toBe("2026-12-31T23:59:59.000Z");
    expect(consent.dateTime).toBeUndefined();
  });

  it("scope/category carry the grant purpose; scope also carries the standard patient-privacy coding", () => {
    const consent = mapConsent(
      WORLD_A.grants.find((candidate) => candidate.id === WORLD_A_IDS.GRANT_1)!,
      ctx,
    );
    expect(consent.scope.coding.map((coding) => coding.code)).toEqual([
      "patient-privacy",
      "SYNTH-CARE_MANAGEMENT",
    ]);
    expect(consent.category[0]?.coding[0]?.code).toBe("SYNTH-CARE_MANAGEMENT");
  });
});

describe("doctrine — deny-by-default survival", () => {
  it("the REAL domain evaluator decides DENY with no grants", () => {
    const decision = evaluateAccess(
      {
        subjectId: WORLD_A_IDS.PERSON_2 as PersonId,
        recipientId: "SYNTH-Recipient-CareTeam-0001",
        resource: { resourceKind: "observation" },
        purpose: "SYNTH-CARE_MANAGEMENT",
        operation: "read",
        at: new Date("2026-02-10T09:00:00.000Z"),
      },
      [], // no grants
      [], // no policies
      [], // no relationships
      { active: false },
    );
    expect(decision.decision).toBe("DENY");
    expect(decision.reasons).toContain("no grant for subject and recipient");
  });

  it("a grantless world maps ZERO Consent resources", () => {
    const mapped = mapWorld(WORLD_B, worldContext(WORLD_B));
    const consents = mapped.resources.filter((resource) => resource.resourceType === "Consent");
    expect(consents).toHaveLength(0);
  });

  it("every mapped Consent corresponds 1:1 to a mapped grant (identifier equality)", () => {
    const mapped = mapWorld(WORLD_A, ctx);
    const consents = mapped.resources.filter((resource) => resource.resourceType === "Consent") as unknown as {
      readonly identifier: readonly { readonly value: string }[];
    }[];
    const grantIds = new Set(WORLD_A.grants.map((grant) => grant.id));
    expect(consents).toHaveLength(WORLD_A.grants.length);
    for (const consent of consents) {
      expect(grantIds.has(consent.identifier[0]!.value)).toBe(true);
    }
  });

  it("the evaluator ALLOWS what grant 1 covers, and exactly that grant maps to an active Consent", () => {
    const grants = WORLD_A.grants as unknown as Parameters<typeof evaluateAccess>[1];
    const decision = evaluateAccess(
      {
        subjectId: WORLD_A_IDS.PERSON_1 as PersonId,
        recipientId: "SYNTH-Recipient-CareTeam-0001",
        resource: { resourceKind: "observations" },
        purpose: "SYNTH-CARE_MANAGEMENT",
        operation: "read",
        at: new Date("2026-02-10T09:00:00.000Z"),
      },
      grants,
      [],
      [],
      { active: false },
    );
    expect(decision.decision).toBe("ALLOW");
    const mapped = mapWorld(WORLD_A, ctx);
    const consent = mapped.resources.find(
      (resource) =>
        resource.resourceType === "Consent" &&
        serializeCanonical(resource).includes(WORLD_A_IDS.GRANT_1),
    );
    expect(consent).toBeDefined();
    expect((consent as { status: string }).status).toBe("active");
  });
});
