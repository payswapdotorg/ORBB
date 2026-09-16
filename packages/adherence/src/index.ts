/**
 * @orbb/adherence — the adherence enforcement abstraction (M6-B B10,
 * Lane C): golden journey #7's "authorized restriction applied only if
 * configured" leg, built observe-only by default.
 *
 * SAFETY POSTURE (binding, docs/UI_UX_ARCHITECTURE.md §Design system:
 * "Avoid gamifying risk, abnormality, disease, or adherence"):
 *   - Adherence evaluation is a PURE function computing per-task states
 *     `on-track | missed | recovered` with a full audit trail. Missing a
 *     task window records state and NOTHING restrictive happens.
 *   - A restriction exists ONLY under an explicit, authorized,
 *     configured, versioned `AdherencePolicy` — validated fail-closed by
 *     `resolveAdherencePolicy` (absent/malformed => NO-ENFORCEMENT).
 *   - Authorization is an INJECTED consent/access-grant-shaped predicate
 *     that must pass NOW, at decision time; configured-but-unauthorized
 *     => a typed REFUSAL with an audit record, never a silent pass.
 *   - The minted `RestrictionDecision` token is the ONLY value OS
 *     capability adapters accept as authorization to act (platform seam
 *     mirrors it structurally and refuses forgeries).
 *   - Non-punitive by construction: no streaks, no scores, no penalties,
 *     no third-party escalation vocabulary anywhere in the policy schema
 *     (proven by the vocabulary test over the closed field-name list).
 *
 * Zero external runtime dependencies: `@orbb/domain` and
 * `@orbb/measurement` (workspace) only, plus Node's crypto for
 * deterministic digests.
 */
export {
  canonicalJsonStringify,
  sha256Hex,
} from "./canonical.js";

export { ok, err, type AdherenceResult } from "./result.js";

export {
  ADHERENCE_CAPABILITY_IDS,
  ADHERENCE_POLICY_FIELD_NAMES,
  ADHERENCE_STATES,
  ADHERENCE_STATE_REASONS,
  CAPABILITY_DETECTION_STATES,
  isAdherenceCapabilityId,
  isAdherenceState,
  isAdherenceStateReason,
  isCapabilityDetectionState,
  type AdherenceCapabilityId,
  type AdherencePolicyFieldName,
  type AdherenceState,
  type AdherenceStateReason,
  type CapabilityDetectionReport,
  type CapabilityDetectionState,
} from "./states.js";

export {
  adherenceSnapshotFromTask,
  adherenceEvaluationDigest,
  evaluateAdherenceSnapshot,
  type AdherenceEvaluation,
  type AdherenceEvaluationError,
  type AdherenceEvaluationStep,
  type AdherenceTaskSnapshot,
} from "./evaluation.js";

export {
  MAX_RESTRICTION_DURATION_MS,
  resolveAdherencePolicy,
  ADHERENCE_POLICY_CAPABILITIES,
  type AdherencePolicy,
  type AdherencePolicyAuthorization,
  type AdherencePolicyRestriction,
  type AdherencePolicyScope,
  type PolicyRejectionDetail,
  type PolicyResolutionReason,
  type ResolvedAdherencePolicy,
} from "./policy.js";

export {
  AccessGrantAdherenceGate,
  type AccessGrantAdherenceGateDeps,
  type AdherenceAuthorizationGate,
  type RestrictionAuthorizationRequest,
} from "./authorization.js";

export {
  RESTRICTION_DECISION_KIND,
  AdherenceEnforcementEngine,
  enforcementDecisionDigest,
  type AdherenceCapabilityProber,
  type AdherenceDecisionAudit,
  type AdherenceDecisionStep,
  type AdherenceEnforcementEngineDeps,
  type EnforcementDecision,
  type EnforcementEvaluationInput,
  type EnforcementRefusalReason,
  type NoEnforcementReason,
  type RestrictionDecision,
} from "./engine.js";
