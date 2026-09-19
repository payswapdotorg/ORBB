/**
 * Observation mapper — the REAL domain Observation (validation state
 * machine, typed value shapes, supersession chain) to FHIR R4.
 *
 * STATUS MAPPING (RECORDED EXACT RULE, verified against the domain
 * supersession semantics in packages/domain/src/observation.ts):
 *
 *   domain validationState | FHIR Observation.status | rationale
 *   -----------------------+--------------------------+-----------
 *   pending                | "preliminary"            | a value exists but is not yet validated — an initial, unverified estimate
 *   validated              | "final"                  | validation complete; the observation is current and verified
 *   rejected               | "entered-in-error"       | validation refused the observation; consumers must never rely on rejected data (fail-safe)
 *   superseded             | "entered-in-error"       | the FHIR-observation-style replace pattern: the domain never mutates in place — the superseded observation's value is retired and the REPLACEMENT (a new domain observation) carries the corrected value as its own resource
 *
 *   The replacement observation itself maps via ITS OWN validationState
 *   (validated -> "final"); its `supersedesId` does NOT inflate the
 *   status to FHIR "amended"/"corrected" — those codes describe mutation
 *   of a single resource, which contradicts the domain's immutable
 *   replacement model. The correction chain stays queryable on the ORBB
 *   side via the domain ids and provenance linkage.
 *
 * OTHER RECORDED DECISIONS:
 *   - `code` is a MANDATORY FHIR element and the domain concept code is
 *     opaque: the coding (system/code/display) comes from the context's
 *     registered metric vocabulary — unresolved codes fail closed.
 *   - Value shapes: number -> valueQuantity (unit only when non-empty),
 *     string -> valueString, boolean -> valueBoolean (the M0 value union
 *     admits booleans; FHIR has a native element, and silently coercing
 *     to a string would lose type fidelity).
 *   - The evidence label (MEASURED | ESTIMATED | IMPORTED | DERIVED)
 *     rides `meta.tag` under the ORBB evidence-label vocabulary system —
 *     R4 has NO standard observation-reliability element, and inventing
 *     an extension is out of doctrine; a namespaced workflow tag is the
 *     standard-conformant carrier.
 *   - `method` carries the opaque method code under the ORBB
 *     method-code vocabulary system (vocabulary label moved verbatim).
 *   - The source actor is NOT referenced on the Observation (no
 *     performer/device element): the source rides the linked Provenance
 *     agent — stable provenance is the FHIR-native carrier.
 *   - The provenance record linked by `provenanceId` MUST exist in the
 *     context ("every observation needs provenance", fail-closed at the
 *     boundary).
 */
import { assertObservationInput } from "./guards.js";
import { requireProvenanceRecord, resolveConceptCode } from "./context.js";
import type { FhirMappingContext } from "./context.js";
import type { FhirObservation } from "./fhir.js";
import type { ObservationInput } from "./inputs.js";
import { deriveResourceId } from "./fhirIds.js";
import { identifierSystem, vocabularySystem } from "./vocabulary.js";
import type { ObservationValidationStateValue } from "./vocabulary.js";
import { toFhirTimestamp } from "./canonical.js";
import { patientReference } from "./references.js";

/** The frozen status table (see module docs for the exact rule). */
export const OBSERVATION_STATUS_BY_VALIDATION_STATE: Readonly<
  Record<ObservationValidationStateValue, FhirObservation["status"]>
> = {
  pending: "preliminary",
  validated: "final",
  rejected: "entered-in-error",
  superseded: "entered-in-error",
};

/**
 * Maps a domain Observation to a FHIR R4 Observation resource. Pure and
 * deterministic; fail-closed on malformed input, unknown vocabulary,
 * unresolved concept codes, and missing provenance linkage.
 */
export function mapObservation(
  observation: ObservationInput,
  context: FhirMappingContext,
): FhirObservation {
  assertObservationInput(observation);
  requireProvenanceRecord(observation.provenanceId, context);
  const metric = resolveConceptCode(observation.conceptCode, context);

  const value =
    typeof observation.value === "number"
      ? {
          valueQuantity: {
            value: observation.value,
            ...(observation.unit.length > 0 ? { unit: observation.unit } : {}),
          },
        }
      : typeof observation.value === "string"
        ? { valueString: observation.value }
        : { valueBoolean: observation.value };

  return {
    resourceType: "Observation",
    id: deriveResourceId("Observation", observation.id),
    meta: {
      tag: [
        {
          system: vocabularySystem(context.namespace, "evidence-label"),
          code: observation.evidenceLabel,
        },
      ],
    },
    identifier: [
      { system: identifierSystem(context.namespace, "observation"), value: observation.id },
    ],
    status: OBSERVATION_STATUS_BY_VALIDATION_STATE[observation.validationState],
    ...(metric.category !== undefined && metric.categorySystem !== undefined
      ? {
          category: [
            {
              coding: [{ system: metric.categorySystem, code: metric.category }],
            },
          ],
        }
      : {}),
    code: {
      coding: [
        {
          system: metric.conceptSystem,
          code: metric.conceptCode,
          ...(metric.display !== undefined ? { display: metric.display } : {}),
        },
      ],
    },
    subject: patientReference(observation.personId, context),
    effectiveDateTime: toFhirTimestamp(observation.effectiveAt),
    issued: toFhirTimestamp(observation.observedAt),
    method: {
      coding: [
        { system: vocabularySystem(context.namespace, "method-code"), code: observation.methodId },
      ],
    },
    ...value,
  };
}
