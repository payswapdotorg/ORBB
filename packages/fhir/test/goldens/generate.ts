/**
 * Golden fixture generator — regenerates the golden JSON files under
 * test/goldens/ from the SYNTH test worlds.
 *
 * Run from the package root: `bun test/goldens/generate.ts` (bun resolves
 * the repo's .js->.ts import convention natively; no other tooling
 * needed). The generated files are committed — the golden TESTS only
 * read them, so CI never writes.
 *
 * Each golden file is `prettyCanonical(mappedResource) + "\n"`: canonical
 * key ordering (sorted), 2-space indentation, deterministic — the exact
 * same structure `serializeCanonical` emits compactly. The golden tests
 * prove byte-equivalence by re-canonicalizing the parsed golden file.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createFhirMappingContext } from "../../src/context.js";
import { prettyCanonical } from "../../src/canonical.js";
import { mapPatient } from "../../src/patient.js";
import { mapObservation } from "../../src/observation.js";
import { mapDiagnosticReport } from "../../src/diagnosticReport.js";
import { mapCondition } from "../../src/condition.js";
import { mapDocumentReference } from "../../src/documentReference.js";
import { mapConsent } from "../../src/consent.js";
import { mapProvenance } from "../../src/provenance.js";
import { fhirResourceReference } from "../../src/references.js";
import {
  WORLD_A,
  WORLD_A_IDS,
  SYNTH_DEMOGRAPHIC_PORT,
  mapWorld,
  worldContext,
} from "../worlds.js";

const GOLDENS_DIR = fileURLToPath(new URL(".", import.meta.url));

function writeGolden(name: string, value: unknown): void {
  const path = join(GOLDENS_DIR, `${name}.json`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${prettyCanonical(value)}\n`, "utf8");
  console.log(`wrote ${name}.json`);
}

// The default world context (no demographics — privacy-first default).
const ctx = worldContext(WORLD_A);

// --- Patient -------------------------------------------------------------
writeGolden("patient-default", mapPatient(WORLD_A_IDS.PERSON_1, ctx));
writeGolden(
  "patient-with-demographics",
  mapPatient(
    WORLD_A_IDS.PERSON_1,
    createFhirMappingContext({
      metrics: WORLD_A.metrics,
      intentFocuses: WORLD_A.intentFocuses,
      provenanceRecords: WORLD_A.provenance.map((entry) => entry.record),
      demographics: SYNTH_DEMOGRAPHIC_PORT,
    }),
  ),
);

// --- Observation (one per validation state + value shape) ----------------
const byObservationId = new Map(WORLD_A.observations.map((o) => [o.id, o]));
writeGolden("observation-validated-quantity", mapObservation(byObservationId.get(WORLD_A_IDS.OBS_A)!, ctx));
writeGolden("observation-superseded-quantity", mapObservation(byObservationId.get(WORLD_A_IDS.OBS_B)!, ctx));
writeGolden("observation-pending-string", mapObservation(byObservationId.get(WORLD_A_IDS.OBS_D)!, ctx));
writeGolden("observation-rejected-boolean", mapObservation(byObservationId.get(WORLD_A_IDS.OBS_E)!, ctx));

// --- DiagnosticReport ------------------------------------------------------
const byTaskId = new Map(WORLD_A.reports.map((r) => [r.task.id, r]));
writeGolden("diagnosticreport-final", mapDiagnosticReport(byTaskId.get(WORLD_A_IDS.TASK_1)!, ctx));
writeGolden("diagnosticreport-registered", mapDiagnosticReport(byTaskId.get(WORLD_A_IDS.TASK_2)!, ctx));

// --- Condition -------------------------------------------------------------
const byIntentId = new Map(WORLD_A.intents.map((i) => [i.id, i]));
writeGolden("condition-active", mapCondition(byIntentId.get(WORLD_A_IDS.INTENT_1)!, ctx));
writeGolden("condition-achieved", mapCondition(byIntentId.get(WORLD_A_IDS.INTENT_2)!, ctx));

// --- DocumentReference -------------------------------------------------------
writeGolden("documentreference-current", mapDocumentReference(WORLD_A.evidence[0]!, ctx));

// --- Consent -------------------------------------------------------------------
const byGrantId = new Map(WORLD_A.grants.map((g) => [g.id, g]));
writeGolden("consent-active", mapConsent(byGrantId.get(WORLD_A_IDS.GRANT_1)!, ctx));
writeGolden("consent-revoked", mapConsent(byGrantId.get(WORLD_A_IDS.GRANT_2)!, ctx));
writeGolden("consent-active-no-issued", mapConsent(byGrantId.get(WORLD_A_IDS.GRANT_3)!, ctx));

// --- Provenance ------------------------------------------------------------------
const provenanceById = new Map(WORLD_A.provenance.map((p) => [p.record.provenanceId, p]));
writeGolden("provenance-observation", mapProvenance(
  provenanceById.get("prov_SYNTH000000000003")!.record,
  [fhirResourceReference("Observation", WORLD_A_IDS.OBS_A, ctx)],
  ctx,
));
writeGolden("provenance-multi-target", mapProvenance(
  provenanceById.get("prov_SYNTH000000000016")!.record,
  [
    fhirResourceReference("Observation", WORLD_A_IDS.OBS_A, ctx),
    fhirResourceReference("DiagnosticReport", WORLD_A_IDS.TASK_1, ctx),
  ],
  ctx,
));

// Sanity: the full world A still maps (generator never writes goldens
// from a broken world).
void mapWorld(WORLD_A, ctx);
console.log("goldens regenerated");
