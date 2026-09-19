/**
 * @orbb/clinical — the clinical organization/clinic/practitioner domain
 * with patient linking and care-team permissions (M7-A A44 + A45,
 * Lane A).
 *
 * Zero external runtime dependencies: `@orbb/domain` (workspace) only.
 * The A45 evaluator is layered ON TOP of the REAL kernel access
 * evaluation — it imports the kernel `AccessGrant` type and delegates
 * the grant-side verdict to the kernel's deny-by-default
 * `evaluateAccess`.
 *
 * SAFETY POSTURE (binding, AGENTS.md): clinical features require
 * jurisdiction-specific governance before real-world use — everything in
 * this package is boundary-shaped, non-authoritative, and
 * SYNTH-fixtured. Verification vocabulary is SYNTH-only; the evaluator
 * is deny-by-default with NO allow-by-default path anywhere.
 */
// Internal state-machine engine — deliberately NOT re-exported (mirrors
// the kernel, whose stateMachine.ts stays internal to @orbb/domain).

export {
  CLINICAL_ID_PREFIXES,
  isClinicId,
  isClinicalIdOf,
  isOrganizationId,
  isPractitionerId,
  parseClinicId,
  parseClinicalId,
  parseOrganizationId,
  parsePractitionerId,
  type ClinicId,
  type ClinicalIdFor,
  type ClinicalIdKind,
  type ClinicalIdTypes,
  type OrganizationId,
  type PractitionerId,
} from "./ids.js";

export {
  CLINIC_STATES,
  CLINIC_STATE_TRANSITIONS,
  ORGANIZATION_STATES,
  ORGANIZATION_STATE_TRANSITIONS,
  allowedClinicTransitions,
  allowedOrganizationTransitions,
  assertClinic,
  assertClinicTransition,
  assertOrganization,
  assertOrganizationTransition,
  canTransitionClinic,
  canTransitionOrganization,
  isClinic,
  isClinicState,
  isOrganization,
  isOrganizationState,
  parseClinicState,
  parseOrganizationState,
  type Clinic,
  type ClinicState,
  type Organization,
  type OrganizationState,
} from "./organizations.js";

export {
  PRACTITIONER_ROLES,
  PRACTITIONER_STATES,
  PRACTITIONER_STATE_TRANSITIONS,
  allowedPractitionerTransitions,
  assertPractitioner,
  assertPractitionerClinicAffiliation,
  assertPractitionerOrganizationMembership,
  assertPractitionerTransition,
  assertPractitionerVerification,
  canTransitionPractitioner,
  isPractitioner,
  isPractitionerClinicAffiliation,
  isPractitionerOrganizationMembership,
  isPractitionerRole,
  isPractitionerState,
  isPractitionerVerification,
  newPractitioner,
  parsePractitionerRole,
  parsePractitionerState,
  suspendPractitioner,
  verifyPractitioner,
  type Practitioner,
  type PractitionerClinicAffiliation,
  type PractitionerOrganizationMembership,
  type PractitionerRole,
  type PractitionerState,
  type PractitionerVerification,
} from "./practitioners.js";

export {
  PATIENT_LINK_ACTORS,
  PATIENT_LINK_CONFIRMATION_SOURCES,
  PATIENT_LINK_STATES,
  PATIENT_LINK_STATE_TRANSITIONS,
  allowedPatientLinkTransitions,
  assertPatientLink,
  assertPatientLinkTransition,
  canTransitionPatientLink,
  confirmPatientLink,
  declinePatientLink,
  isPatientLink,
  isPatientLinkActor,
  isPatientLinkConfirmationSource,
  isPatientLinkState,
  parsePatientLinkActor,
  parsePatientLinkConfirmationSource,
  parsePatientLinkState,
  requestPatientLink,
  revokePatientLink,
  type PatientLink,
  type PatientLinkActor,
  type PatientLinkConfirmationSource,
  type PatientLinkState,
} from "./patientLinks.js";

export {
  CARE_TEAM_CHANGE_KINDS,
  CARE_TEAM_ROLES,
  CARE_TEAM_STATES,
  CARE_TEAM_STATE_TRANSITIONS,
  allowedCareTeamTransitions,
  applyCareTeamChange,
  assertCareTeam,
  assertCareTeamChange,
  assertCareTeamTransition,
  canTransitionCareTeam,
  isCareTeam,
  isCareTeamChange,
  isCareTeamChangeKind,
  isCareTeamEntry,
  isCareTeamRole,
  isCareTeamState,
  newCareTeam,
  parseCareTeamRole,
  parseCareTeamState,
  type CareTeam,
  type CareTeamChange,
  type CareTeamChangeKind,
  type CareTeamEntry,
  type CareTeamRole,
  type CareTeamState,
} from "./careTeams.js";

export {
  CARE_TEAM_SCOPE_PERMISSIONS,
  careTeamScopePermissionSegments,
  isCareTeamScopePermission,
  parseCareTeamScopePermission,
  type CareTeamScopePermission,
} from "./scopes.js";

export {
  CLINICAL_ACCESS_ALLOW_REASON,
  CLINICAL_ACCESS_DECISIONS,
  assertClinicalAccessAuditRecord,
  isClinicalAccessAuditRecord,
  type ClinicalAccessAuditRecord,
  type ClinicalAccessDecisionKind,
} from "./audit.js";

export {
  CLINICAL_EVENT_ID_PREFIX,
  CLINICAL_EVENT_TYPES,
  assertClinicalEventEnvelope,
  isClinicalEventEnvelope,
  isClinicalEventId,
  isClinicalEventType,
  parseClinicalEventId,
  parseClinicalEventType,
  type ClinicalEventEnvelope,
  type ClinicalEventId,
  type ClinicalEventType,
} from "./events.js";

export {
  CARE_TEAM_DENY_REASONS,
  assertCareTeamAccessRequest,
  evaluateCareTeamAccess,
  isCareTeamAccessRequest,
  isCareTeamDenyReason,
  type CareTeamAccessAllowed,
  type CareTeamAccessDecision,
  type CareTeamAccessDenied,
  type CareTeamAccessRequest,
  type CareTeamAccessSnapshot,
  type CareTeamDenyReason,
} from "./evaluation.js";
