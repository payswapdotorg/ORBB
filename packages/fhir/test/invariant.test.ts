/**
 * Invariant + fail-closed proofs (definition of done, part 5):
 *   - the provenance-linkage invariant over EVERY mapped resource in
 *     every test world (and its negative);
 *   - the malformed-input battery (unknown vocabulary -> typed mapping
 *     failure, never a silent partial resource);
 *   - vocabulary drift guards (local mirrors === the REAL frozen
 *     @orbb/domain and @orbb/measurement constants);
 *   - @orbb/testkit synthetic-fixture interop (real domain-produced
 *     objects map through this package);
 *   - the exported-API surface snapshot (exactly one Consent-producing
 *     entry point — the deny-by-default survival precondition).
 */
import { describe, expect, it } from "vitest";
import {
  EVIDENCE_LABELS as DOMAIN_EVIDENCE_LABELS,
  GRANT_STATES as DOMAIN_GRANT_STATES,
  ID_PREFIXES as DOMAIN_ID_PREFIXES,
  INTENT_STATES as DOMAIN_INTENT_STATES,
  OBSERVATION_VALIDATION_STATES as DOMAIN_OBSERVATION_VALIDATION_STATES,
} from "@orbb/domain";
import { COMPLETION_QUALITY_STATES, TASK_STATES } from "@orbb/measurement";
import {
  syntheticConsentGrant,
  syntheticObservation,
  syntheticPerson,
  syntheticProvenance,
} from "@orbb/testkit";
import { FhirMappingError, type FhirMappingErrorKind } from "../src/errors.js";
import { assertProvenanceCoverage } from "../src/coverage.js";
import {
  createFhirMappingContext,
  type FhirMappingContext,
  type MetricVocabularyEntry,
} from "../src/context.js";
import { mapObservation } from "../src/observation.js";
import { mapDiagnosticReport } from "../src/diagnosticReport.js";
import { mapCondition } from "../src/condition.js";
import { mapDocumentReference } from "../src/documentReference.js";
import { mapConsent } from "../src/consent.js";
import { mapProvenance } from "../src/provenance.js";
import { mapPatient } from "../src/patient.js";
import { fhirResourceReference } from "../src/references.js";
import { serializeCanonical } from "../src/canonical.js";
import {
  COMPLETION_QUALITY_STATES as LOCAL_COMPLETION_QUALITY_STATES,
  EVIDENCE_LABELS as LOCAL_EVIDENCE_LABELS,
  GRANT_STATES as LOCAL_GRANT_STATES,
  ID_PREFIXES as LOCAL_ID_PREFIXES,
  INTENT_STATES as LOCAL_INTENT_STATES,
  OBSERVATION_VALIDATION_STATES as LOCAL_OBSERVATION_VALIDATION_STATES,
  TASK_STATES as LOCAL_TASK_STATES,
} from "../src/vocabulary.js";
import { WORLD_A, WORLD_A_IDS, WORLD_B, mapWorld, worldContext } from "./worlds.js";
import * as fhirApi from "../src/index.js";

/** Asserts fn throws a FhirMappingError of the given kind (PHI-safe message not asserted). */
function expectMappingError(kind: FhirMappingErrorKind, fn: () => unknown): void {
  let caught: unknown;
  try {
    fn();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(FhirMappingError);
  expect((caught as FhirMappingError).kind).toBe(kind);
}

describe("provenance-linkage invariant over every mapped resource in every test world", () => {
  it("world A: every mapped clinical resource is targeted by at least one Provenance", () => {
    const ctx = worldContext(WORLD_A);
    const mapped = mapWorld(WORLD_A, ctx);
    expect(() => assertProvenanceCoverage(mapped.resources, mapped.provenances)).not.toThrow();
  });

  it("world B: every mapped clinical resource is targeted by at least one Provenance", () => {
    const ctx = worldContext(WORLD_B);
    const mapped = mapWorld(WORLD_B, ctx);
    expect(() => assertProvenanceCoverage(mapped.resources, mapped.provenances)).not.toThrow();
  });

  it("removing one provenance uncovers its resource and the checker fails closed", () => {
    const ctx = worldContext(WORLD_A);
    const mapped = mapWorld(WORLD_A, ctx);
    const withOneRemoved = mapped.provenances.slice(0, -1);
    expectMappingError("provenance-coverage", () =>
      assertProvenanceCoverage(mapped.resources, withOneRemoved),
    );
  });

  it("the checker is exact: re-adding the provenance restores coverage", () => {
    const ctx = worldContext(WORLD_A);
    const mapped = mapWorld(WORLD_A, ctx);
    const withOneRemoved = mapped.provenances.slice(0, -1);
    expect(() => assertProvenanceCoverage(mapped.resources, withOneRemoved)).toThrow();
    expect(() => assertProvenanceCoverage(mapped.resources, mapped.provenances)).not.toThrow();
  });

  it("mapObservation fails closed when the observation's provenance record is missing", () => {
    const ctxWithoutProvenance = createFhirMappingContext({
      metrics: WORLD_A.metrics,
    });
    expectMappingError("missing-provenance", () =>
      mapObservation(WORLD_A.observations[0]!, ctxWithoutProvenance),
    );
  });

  it("mapDocumentReference fails closed when the evidence's provenance record is missing", () => {
    const ctxWithoutProvenance = createFhirMappingContext();
    expectMappingError("missing-provenance", () =>
      mapDocumentReference(WORLD_A.evidence[0]!, ctxWithoutProvenance),
    );
  });

  it("mapDiagnosticReport fails closed when an attempt's provenance record is missing", () => {
    const ctxWithoutProvenance = createFhirMappingContext({
      metrics: WORLD_A.metrics,
    });
    expectMappingError("missing-provenance", () =>
      mapDiagnosticReport(WORLD_A.reports[0]!, ctxWithoutProvenance),
    );
  });
});

describe("malformed-input battery — fail-closed, never a silent partial resource", () => {
  const ctx = worldContext(WORLD_A);

  it("observation: unknown evidence label -> unknown-vocabulary", () => {
    const smuggled = { ...WORLD_A.observations[0]!, evidenceLabel: "GUESSED" } as never;
    expectMappingError("unknown-vocabulary", () => mapObservation(smuggled, ctx));
  });

  it("observation: non-canonical id -> invalid-input", () => {
    const smuggled = { ...WORLD_A.observations[0]!, id: "obs_short" } as never;
    expectMappingError("invalid-input", () => mapObservation(smuggled, ctx));
  });

  it("observation: out-of-range quality -> invalid-input", () => {
    const smuggled = { ...WORLD_A.observations[0]!, quality: 1.5 } as never;
    expectMappingError("invalid-input", () => mapObservation(smuggled, ctx));
  });

  it("observation: object value smuggled where a primitive belongs -> invalid-input", () => {
    const smuggled = { ...WORLD_A.observations[0]!, value: { v: 72 } } as never;
    expectMappingError("invalid-input", () => mapObservation(smuggled, ctx));
  });

  it("observation: unresolved concept code -> unresolved-concept-code", () => {
    const smuggled = { ...WORLD_A.observations[0]!, conceptCode: "SYNTH-UNKNOWN-1" } as never;
    expectMappingError("unresolved-concept-code", () => mapObservation(smuggled, ctx));
  });

  it("diagnostic report: attempt belonging to another task -> invalid-input (grouping invariant)", () => {
    const [report] = WORLD_A.reports;
    const foreignAttempt = {
      ...report!.attempts[0]!,
      taskId: WORLD_A_IDS.TASK_2,
    };
    expectMappingError("invalid-input", () =>
      mapDiagnosticReport({ task: report!.task, attempts: [foreignAttempt] }, ctx),
    );
  });

  it("diagnostic report: duplicate observation across attempts -> invalid-input", () => {
    const [report] = WORLD_A.reports;
    const [first, second] = report!.attempts;
    expectMappingError("invalid-input", () =>
      mapDiagnosticReport({ task: report!.task, attempts: [first!, { ...second!, observationId: first!.observationId }] }, ctx),
    );
  });

  it("diagnostic report: unknown task state -> unknown-vocabulary", () => {
    const smuggled = { task: { ...WORLD_A.reports[0]!.task, state: "paused" } as never, attempts: [] };
    expectMappingError("unknown-vocabulary", () => mapDiagnosticReport(smuggled, ctx));
  });

  it("condition: unregistered intent focus -> intent-focus-unknown", () => {
    const intent = { ...WORLD_A.intents[0]!, id: "intent_SYNTH000000000099" };
    expectMappingError("intent-focus-unknown", () => mapCondition(intent, ctx));
  });

  it("condition: multi-focus intent -> multi-focus-intent (never comorbidity)", () => {
    const multiFocusCtx = createFhirMappingContext({
      metrics: WORLD_A.metrics,
      intentFocuses: [
        { intentId: WORLD_A_IDS.INTENT_1, metricIds: ["SYNTH-metric-heart-rate", "SYNTH-metric-body-weight"] },
      ],
      provenanceRecords: WORLD_A.provenance.map((entry) => entry.record),
    });
    expectMappingError("multi-focus-intent", () =>
      mapCondition(WORLD_A.intents[0]!, multiFocusCtx),
    );
  });

  it("condition: unresolved focus metric -> unresolved-metric", () => {
    const unknownMetricCtx = createFhirMappingContext({
      metrics: WORLD_A.metrics,
      intentFocuses: [{ intentId: WORLD_A_IDS.INTENT_1, metricIds: ["SYNTH-metric-unknown"] }],
    });
    expectMappingError("unresolved-metric", () => mapCondition(WORLD_A.intents[0]!, unknownMetricCtx));
  });

  it("condition: unknown intent state -> unknown-vocabulary", () => {
    const smuggled = { ...WORLD_A.intents[0]!, state: "cancelled" } as never;
    expectMappingError("unknown-vocabulary", () => mapCondition(smuggled, ctx));
  });

  it("consent: unknown grant state -> unknown-vocabulary", () => {
    const smuggled = { ...WORLD_A.grants[0]!, state: "expired" } as never;
    expectMappingError("unknown-vocabulary", () => mapConsent(smuggled, ctx));
  });

  it("consent: malformed scope entry -> invalid-input", () => {
    const smuggled = { ...WORLD_A.grants[0]!, scope: ["observations"] } as never;
    expectMappingError("invalid-input", () => mapConsent(smuggled, ctx));
  });

  it("document reference: bad sha256 grammar -> invalid-input", () => {
    const smuggled = { ...WORLD_A.evidence[0]!, sha256: "NOT-A-SHA256" } as never;
    expectMappingError("invalid-input", () => mapDocumentReference(smuggled, ctx));
  });

  it("document reference: unknown lifecycle state -> unknown-vocabulary", () => {
    const smuggled = { ...WORLD_A.evidence[0]!, state: "deleted" } as never;
    expectMappingError("unknown-vocabulary", () => mapDocumentReference(smuggled, ctx));
  });

  it("provenance: actor outside the person/device/source vocabulary -> unknown-vocabulary", () => {
    const smuggled = {
      ...WORLD_A.provenance[0]!.record,
      actor: "task_SYNTH000000000001",
    } as never;
    expectMappingError("unknown-vocabulary", () =>
      mapProvenance(smuggled, [fhirResourceReference("Patient", WORLD_A_IDS.PERSON_1, ctx)], ctx),
    );
  });

  it("provenance: empty target list -> invalid-input (target is 1..*)", () => {
    expectMappingError("invalid-input", () =>
      mapProvenance(WORLD_A.provenance[0]!.record, [], ctx),
    );
  });

  it("provenance: malformed target reference -> invalid-input", () => {
    expectMappingError("invalid-input", () =>
      mapProvenance(
        WORLD_A.provenance[0]!.record,
        [{ reference: "not a reference", identifier: { system: "https://orbb.test/synth/id/person", value: "prsn_SYNTH000000000001" } }] as never,
        ctx,
      ),
    );
  });

  it("context: duplicate metric vocabulary concept codes -> invalid-context", () => {
    const duplicate: MetricVocabularyEntry = { ...WORLD_A.metrics[0]!, metricId: "SYNTH-metric-other" };
    expectMappingError("invalid-context", () =>
      createFhirMappingContext({ metrics: [...WORLD_A.metrics, duplicate] }),
    );
  });

  it("context: duplicate provenance ids -> invalid-context", () => {
    expectMappingError("invalid-context", () =>
      createFhirMappingContext({
        provenanceRecords: [WORLD_A.provenance[0]!.record, WORLD_A.provenance[0]!.record],
      }),
    );
  });

  it("context: bad namespace -> invalid-context", () => {
    expectMappingError("invalid-context", () => createFhirMappingContext({ namespace: "not-a-uri" }));
  });

  it("the default context maps NO clinical resources fail-open (Observation fails on provenance first — validation order: guard, provenance, vocabulary)", () => {
    const defaultCtx = createFhirMappingContext();
    expectMappingError("missing-provenance", () =>
      mapObservation(WORLD_A.observations[0]!, defaultCtx),
    );
    // Even WITH the provenance record, the default (vocabulary-less) context
    // still fails closed on the mandatory FHIR code element:
    const ctxWithProvenanceOnly = createFhirMappingContext({
      provenanceRecords: WORLD_A.provenance.map((entry) => entry.record),
    });
    expectMappingError("unresolved-concept-code", () =>
      mapObservation(WORLD_A.observations[0]!, ctxWithProvenanceOnly),
    );
  });
});

describe("vocabulary drift guards — local mirrors === the frozen kernel constants", () => {
  it("ID prefixes mirror @orbb/domain exactly", () => {
    expect(LOCAL_ID_PREFIXES).toEqual(DOMAIN_ID_PREFIXES);
  });

  it("evidence labels mirror @orbb/domain exactly", () => {
    expect([...LOCAL_EVIDENCE_LABELS]).toEqual([...DOMAIN_EVIDENCE_LABELS]);
  });

  it("observation validation states mirror @orbb/domain exactly", () => {
    expect([...LOCAL_OBSERVATION_VALIDATION_STATES]).toEqual([
      ...DOMAIN_OBSERVATION_VALIDATION_STATES,
    ]);
  });

  it("grant states mirror @orbb/domain exactly", () => {
    expect([...LOCAL_GRANT_STATES]).toEqual([...DOMAIN_GRANT_STATES]);
  });

  it("intent states mirror @orbb/domain exactly", () => {
    expect([...LOCAL_INTENT_STATES]).toEqual([...DOMAIN_INTENT_STATES]);
  });

  it("task states mirror @orbb/measurement exactly", () => {
    expect([...LOCAL_TASK_STATES]).toEqual([...TASK_STATES]);
  });

  it("completion quality states mirror @orbb/measurement exactly", () => {
    expect([...LOCAL_COMPLETION_QUALITY_STATES]).toEqual([...COMPLETION_QUALITY_STATES]);
  });
});

describe("@orbb/testkit synthetic-fixture interop — real domain-produced objects map", () => {
  const TESTKIT_METRICS: readonly MetricVocabularyEntry[] = [
    {
      metricId: "SYNTH-metric-heart-rate",
      conceptCode: "SYNTH-8867-4",
      conceptSystem: "https://orbb.test/synth/vocab/metric-code",
      display: "Heart Rate",
      category: "vital-signs",
      categorySystem: "https://orbb.test/synth/vocab/metric-category",
    },
  ];

  it("syntheticPerson -> mapPatient (identifier-only default)", () => {
    const person = syntheticPerson();
    const ctx = createFhirMappingContext();
    const patient = mapPatient(person.id, ctx);
    expect(patient.identifier[0]?.value).toBe(person.id);
    expect(Object.keys(patient).sort()).toEqual(["id", "identifier", "resourceType"]);
  });

  it("syntheticObservation (with embedded provenance) -> mapObservation, byte-identical twice", () => {
    const observation = syntheticObservation();
    const ctx: FhirMappingContext = createFhirMappingContext({
      metrics: TESTKIT_METRICS,
      provenanceRecords: [observation.provenance],
    });
    const first = mapObservation(observation, ctx);
    const second = mapObservation(syntheticObservation(), ctx);
    expect(serializeCanonical(first)).toBe(serializeCanonical(second));
  });

  it("syntheticConsentGrant -> mapConsent (active)", () => {
    const grant = syntheticConsentGrant();
    const ctx = createFhirMappingContext();
    const consent = mapConsent(grant, ctx);
    expect(consent.status).toBe("active");
    expect(consent.provision.type).toBe("permit");
  });

  it("syntheticProvenance -> mapProvenance with a Patient target", () => {
    const provenance = syntheticProvenance();
    const person = syntheticPerson();
    const ctx = createFhirMappingContext();
    const mapped = mapProvenance(
      provenance,
      [fhirResourceReference("Patient", person.id, ctx)],
      ctx,
    );
    expect(mapped.target).toHaveLength(1);
    expect(mapped.agent).toHaveLength(1);
  });
});

describe("exported API surface — exactly the documented mapper surface", () => {
  it("all seven mappers plus the documented helpers are exported as functions", () => {
    for (const name of [
      "mapPatient",
      "mapObservation",
      "mapDiagnosticReport",
      "mapCondition",
      "mapDocumentReference",
      "mapConsent",
      "mapProvenance",
      "createFhirMappingContext",
      "serializeCanonical",
      "prettyCanonical",
      "deriveResourceId",
      "assertProvenanceCoverage",
      "fhirResourceReference",
    ]) {
      expect(fhirApi[name as keyof typeof fhirApi]).toBeTypeOf("function");
    }
  });

  it("mapConsent is the only Consent-related export and no permit-factory exists (deny-by-default survival precondition)", () => {
    const valueExports = Object.keys(fhirApi);
    // The only export that can produce a Consent resource is mapConsent:
    expect(valueExports.filter((name) => name.toLowerCase().includes("consent"))).toEqual([
      "mapConsent",
    ]);
    // And nothing on the surface fabricates permits:
    expect(valueExports.filter((name) => name.toLowerCase().includes("permit"))).toEqual([]);
  });

  it("every Consent resource in every world was produced by mapConsent over a world grant", () => {
    for (const world of [WORLD_A, WORLD_B]) {
      const ctx = worldContext(world);
      const mapped = mapWorld(world, ctx);
      const consents = mapped.resources.filter(
        (resource) => resource.resourceType === "Consent",
      ) as unknown as readonly { readonly identifier: readonly { readonly value: string }[] }[];
      const grantIds = new Set(world.grants.map((grant) => grant.id));
      expect(consents).toHaveLength(world.grants.length);
      for (const consent of consents) {
        expect(grantIds.has(consent.identifier[0]!.value)).toBe(true);
      }
    }
  });
});
