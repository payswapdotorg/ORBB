/**
 * Golden-file snapshot tests for all seven resource types (definition of
 * done, part 1).
 *
 * For every golden case:
 *   1. `prettyCanonical(mapped)` equals the committed golden file byte
 *      for byte (canonical key ordering, 2-space indent — diff-stable);
 *   2. `serializeCanonical(JSON.parse(golden))` equals
 *      `serializeCanonical(mapped)` — the golden and the compact boundary
 *      form carry exactly the same bytes (the pretty form is a
 *      reviewability rendering of the canonical structure, nothing more).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { prettyCanonical, serializeCanonical } from "../src/canonical.js";
import type { FhirResource } from "../src/fhir.js";
import { createFhirMappingContext } from "../src/context.js";
import {
  SYNTH_DEMOGRAPHIC_PORT,
  WORLD_A,
  WORLD_A_IDS,
  worldContext,
} from "./worlds.js";
import { mapConsent } from "../src/consent.js";
import { mapCondition } from "../src/condition.js";
import { mapDiagnosticReport } from "../src/diagnosticReport.js";
import { mapDocumentReference } from "../src/documentReference.js";
import { mapObservation } from "../src/observation.js";
import { mapPatient } from "../src/patient.js";
import { mapProvenance } from "../src/provenance.js";
import { fhirResourceReference } from "../src/references.js";

const GOLDENS_DIR = fileURLToPath(new URL("./goldens", import.meta.url));

function readGolden(name: string): string {
  return readFileSync(join(GOLDENS_DIR, `${name}.json`), "utf8");
}

function expectGolden(name: string, resource: FhirResource): void {
  const golden = readGolden(name);
  expect(`${prettyCanonical(resource)}\n`).toBe(golden);
  expect(serializeCanonical(JSON.parse(golden))).toBe(serializeCanonical(resource));
}

const ctx = worldContext(WORLD_A);
const observation = (id: string) =>
  mapObservation(WORLD_A.observations.find((candidate) => candidate.id === id)!, ctx);
const report = (taskId: string) =>
  mapDiagnosticReport(WORLD_A.reports.find((candidate) => candidate.task.id === taskId)!, ctx);
const condition = (intentId: string) =>
  mapCondition(WORLD_A.intents.find((candidate) => candidate.id === intentId)!, ctx);
const grant = (grantId: string) =>
  mapConsent(WORLD_A.grants.find((candidate) => candidate.id === grantId)!, ctx);
const provenance = (provenanceId: string, targets: readonly { readonly resourceType: Parameters<typeof fhirResourceReference>[0]; readonly domainId: string }[]) =>
  mapProvenance(
    WORLD_A.provenance.find((candidate) => candidate.record.provenanceId === provenanceId)!.record,
    targets.map((target) => fhirResourceReference(target.resourceType, target.domainId, ctx)),
    ctx,
  );

describe("golden fixtures — all seven resource types", () => {
  it("Patient: privacy-first default is identifier-only", () => {
    expectGolden("patient-default", mapPatient(WORLD_A_IDS.PERSON_1, ctx));
  });

  it("Patient: deliberate demographic port discloses SYNTH-marked demographics", () => {
    const demographicsCtx = createFhirMappingContext({
      metrics: WORLD_A.metrics,
      intentFocuses: WORLD_A.intentFocuses,
      provenanceRecords: WORLD_A.provenance.map((entry) => entry.record),
      demographics: SYNTH_DEMOGRAPHIC_PORT,
    });
    expectGolden("patient-with-demographics", mapPatient(WORLD_A_IDS.PERSON_1, demographicsCtx));
  });

  it("Observation: validated quantity (final)", () => {
    expectGolden("observation-validated-quantity", observation(WORLD_A_IDS.OBS_A));
  });

  it("Observation: superseded quantity (entered-in-error)", () => {
    expectGolden("observation-superseded-quantity", observation(WORLD_A_IDS.OBS_B));
  });

  it("Observation: pending string value (preliminary, valueString)", () => {
    expectGolden("observation-pending-string", observation(WORLD_A_IDS.OBS_D));
  });

  it("Observation: rejected boolean value (entered-in-error, valueBoolean)", () => {
    expectGolden("observation-rejected-boolean", observation(WORLD_A_IDS.OBS_E));
  });

  it("DiagnosticReport: completed task with attempts (final)", () => {
    expectGolden("diagnosticreport-final", report(WORLD_A_IDS.TASK_1));
  });

  it("DiagnosticReport: open attempt-less task (registered)", () => {
    expectGolden("diagnosticreport-registered", report(WORLD_A_IDS.TASK_2));
  });

  it("Condition: active intent (clinicalStatus active, verificationStatus provisional)", () => {
    expectGolden("condition-active", condition(WORLD_A_IDS.INTENT_1));
  });

  it("Condition: achieved intent (clinicalStatus resolved, verificationStatus provisional)", () => {
    expectGolden("condition-achieved", condition(WORLD_A_IDS.INTENT_2));
  });

  it("DocumentReference: evidence object (current, opaque-id attachment)", () => {
    expectGolden("documentreference-current", mapDocumentReference(WORLD_A.evidence[0]!, ctx));
  });

  it("Consent: active grant with issued period", () => {
    expectGolden("consent-active", grant(WORLD_A_IDS.GRANT_1));
  });

  it("Consent: revoked grant maps inactive", () => {
    expectGolden("consent-revoked", grant(WORLD_A_IDS.GRANT_2));
  });

  it("Consent: grant without issuedAt has period end only (never invented)", () => {
    expectGolden("consent-active-no-issued", grant(WORLD_A_IDS.GRANT_3));
  });

  it("Provenance: single observation target", () => {
    expectGolden("provenance-observation", provenance("prov_SYNTH000000000003", [
      { resourceType: "Observation", domainId: WORLD_A_IDS.OBS_A },
    ]));
  });

  it("Provenance: multi-target provenance covers observation + report", () => {
    expectGolden("provenance-multi-target", provenance("prov_SYNTH000000000016", [
      { resourceType: "Observation", domainId: WORLD_A_IDS.OBS_A },
      { resourceType: "DiagnosticReport", domainId: WORLD_A_IDS.TASK_1 },
    ]));
  });
});
