/**
 * Condition mapper — HealthIntent to FHIR R4, under the binding
 * "intents are goals, not diagnoses" doctrine.
 *
 * BINDING DOCTRINE (RECORDED, per the work order): `verificationStatus`
 * is ALWAYS `provisional`. An intent is a goal the person is pursuing,
 * never a diagnosis — the mapper must never assert a confirmed (or
 * differential/refuted) clinical verification from intent data. This is
 * unconditional: no intent state, focus, or caller option can produce
 * another verification code.
 *
 * RECORDED DECISIONS:
 *   - `code` comes from the intent's health-focus vocabulary: the
 *     structured focus metric registered in the context (the M5/M6
 *     goal-metric read model; the M0 domain objective is free text and
 *     is NEVER mapped — PHI discipline). Resolution is fail-closed:
 *     unregistered focus -> `intent-focus-unknown`; unresolvable metric
 *     -> `unresolved-metric`.
 *   - MULTI-FOCUS INTENTS FAIL CLOSED (`multi-focus-intent`): a FHIR
 *     Condition.code is ONE clinical concept; collapsing several focus
 *     metrics into one Condition would assert comorbidity that does not
 *     exist. Future-milestone handoff: per-focus Condition resources if
 *     the clinical lane wants them.
 *   - `clinicalStatus` (mandatory in R4) translates the intent state
 *     machine through the MOST CONSERVATIVE table available — it
 *     expresses whether the focus is actively pursued, NOT disease
 *     course:
 *       draft -> "inactive"   (not yet pursuing)
 *       active -> "active"    (actively pursuing)
 *       paused -> "inactive"  (temporarily not pursuing; FHIR has no "paused")
 *       achieved -> "resolved"  (the goal's target was reached — closest honest label)
 *       retired -> "inactive"   (abandoned — deliberately NOT "resolved": nothing was asserted achieved)
 *     RECORDED as the weakest translation in the package (an intent
 *     state machine is not a clinical course); flagged for tech-lead
 *     review with the future Condition-curation work.
 *   - The free-text `objective` is shape-validated but NEVER emitted
 *     (tested: objective strings must not appear in any output).
 *   - `onset`/`abatement`/`asserter`/`recorder` are omitted — nothing in
 *     the domain intent carries them and the mapper never invents.
 */
import { assertHealthIntentInput } from "./guards.js";
import { resolveMetricId } from "./context.js";
import type { FhirMappingContext } from "./context.js";
import type { FhirCondition } from "./fhir.js";
import type { HealthIntentInput } from "./inputs.js";
import { deriveResourceId } from "./fhirIds.js";
import { FHIR_STANDARD_SYSTEMS, identifierSystem } from "./vocabulary.js";
import type { IntentStateValue } from "./vocabulary.js";
import { FhirMappingError } from "./errors.js";
import { toFhirTimestamp } from "./canonical.js";
import { patientReference } from "./references.js";

/**
 * The conservative clinicalStatus table (see module docs). The weakest
 * translation in the package — recorded and flagged for review.
 */
export const CONDITION_CLINICAL_STATUS_BY_INTENT_STATE: Readonly<
  Record<IntentStateValue, "active" | "inactive" | "resolved">
> = {
  draft: "inactive",
  active: "active",
  paused: "inactive",
  achieved: "resolved",
  retired: "inactive",
};

/**
 * Maps a domain HealthIntent to a FHIR R4 Condition resource.
 * verificationStatus is unconditionally `provisional` (binding
 * doctrine). Pure and deterministic; fail-closed on malformed input,
 * unknown vocabulary, missing focus registration, unresolved focus
 * metrics, and multi-focus intents.
 */
export function mapCondition(
  intent: HealthIntentInput,
  context: FhirMappingContext,
): FhirCondition {
  assertHealthIntentInput(intent);
  const focus = context.intentFocuses.find((entry) => entry.intentId === intent.id);
  if (focus === undefined) {
    throw new FhirMappingError(
      "intent-focus-unknown",
      "Intent focus unknown: no health-focus entry is registered for this intent in the mapping context (the M0 domain objective is free text and is never mapped — register the intent's focus metric ids).",
    );
  }
  if (focus.metricIds.length > 1) {
    throw new FhirMappingError(
      "multi-focus-intent",
      "Multi-focus intent: the intent commits to more than one focus metric, and a FHIR Condition.code is a single clinical concept (collapsing focus metrics would assert comorbidity that does not exist). Mapping is refused; per-focus Condition resources are a future-milestone decision.",
    );
  }
  const focusMetricId = focus.metricIds[0];
  if (focusMetricId === undefined) {
    // Defensive: the context validator enforces non-empty metricIds.
    throw new FhirMappingError("intent-focus-unknown", "Intent focus entry carries no metric id.");
  }
  const metric = resolveMetricId(focusMetricId, context);

  return {
    resourceType: "Condition",
    id: deriveResourceId("Condition", intent.id),
    identifier: [{ system: identifierSystem(context.namespace, "intent"), value: intent.id }],
    clinicalStatus: {
      coding: [
        {
          system: FHIR_STANDARD_SYSTEMS.conditionClinicalStatus,
          code: CONDITION_CLINICAL_STATUS_BY_INTENT_STATE[intent.state],
        },
      ],
    },
    verificationStatus: {
      coding: [
        {
          system: FHIR_STANDARD_SYSTEMS.conditionVerificationStatus,
          code: "provisional",
        },
      ],
    },
    code: {
      coding: [
        {
          system: metric.conceptSystem,
          code: metric.conceptCode,
          ...(metric.display !== undefined ? { display: metric.display } : {}),
        },
      ],
    },
    subject: patientReference(intent.personId, context),
    recordedDate: toFhirTimestamp(intent.createdAt),
  };
}
