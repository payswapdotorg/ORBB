/**
 * The care-team authorization gate (A49, part 3) — THE exit-criterion
 * gate: "clinician can request authorized data and reason over a
 * longitudinal patient timeline".
 *
 * The timeline is the SUBJECT person's data; a clinician reads it ONLY
 * through `@orbb/clinical`'s REAL `evaluateCareTeamAccess` with the
 * frozen read scope `timeline:read` (runtime workspace dependency — the
 * layering point of A45, not a reimplementation). DENY-BY-DEFAULT IS
 * ABSOLUTE:
 *
 *   - every clinical deny reason maps to a typed timeline denial (a
 *     total mapping — exhaustiveness is compile-forced by the
 *     `Record<CareTeamDenyReason, TimelineDenyReason>` table and
 *     drift-locked by a test over the REAL runtime vocabulary);
 *   - the denial is ALL-OR-NOTHING: a denied request returns the typed
 *     denial and NEVER a partial timeline — the store ports are not
 *     even read (proven by tests with spy stores);
 *   - no grant, no timeline; no confirmed link, no timeline;
 *     suspended/dissolved/unverified anything — no timeline;
 *   - the evaluation is AUDITED on every outcome (ALLOW and DENY alike)
 *     with a record shaped for the append-only `access_audits` table
 *     (db handoff recorded — the same mapping discipline as the
 *     clinical lane's `audit.ts`).
 *
 * Self-serve (a person reading their OWN timeline through a
 * person-context seam) is a RECORDED FUTURE SURFACE, not shipped here:
 * there is no person-context path into the timeline assembly.
 */
import type { PersonId } from "@orbb/domain";
import {
  CARE_TEAM_DENY_REASONS,
  evaluateCareTeamAccess,
  isCareTeamDenyReason,
  type CareTeamAccessAllowed,
  type CareTeamAccessDecision,
  type CareTeamAccessSnapshot,
  type CareTeamDenyReason,
  type CareTeamScopePermission,
  type PractitionerId,
} from "@orbb/clinical";
import { TimelineError } from "./errors.js";
import type { TimelineEventEnvelope } from "./events.js";
import type { TimelinePage } from "./entries.js";

// ---------------------------------------------------------------------------
// The frozen read scope this gate demands.
// ---------------------------------------------------------------------------

/**
 * The one scope permission that opens the timeline: `timeline:read`,
 * NAMED in the frozen @orbb/clinical read-only vocabulary. The
 * `satisfies CareTeamScopePermission` clause is a compile-time drift
 * lock: removing `timeline:read` from the clinical vocabulary breaks
 * this package's build, not its runtime.
 */
export const TIMELINE_READ_PERMISSION = "timeline:read" as const satisfies CareTeamScopePermission;

// ---------------------------------------------------------------------------
// The typed timeline denial vocabulary (total mirror of the clinical one).
// ---------------------------------------------------------------------------

/**
 * Every way a timeline read can be denied — a typed, closed vocabulary
 * mapped 1:1 from {@link CareTeamDenyReason} (identity labels: the
 * clinical reason IS the reason the timeline read failed; relabeling
 * would add nothing and hide the A45 semantics). The clinician UI shows
 * the deny, never a partial timeline.
 */
export type TimelineDenyReason = CareTeamDenyReason;

/**
 * The total clinical→timeline denial mapping. Compile-forced exhaustive
 * over every {@link CareTeamDenyReason}; identity-labeled.
 */
const TIMELINE_DENIALS: Record<CareTeamDenyReason, TimelineDenyReason> = {
  "unknown-scope-permission": "unknown-scope-permission",
  "unknown-recipient": "unknown-recipient",
  "subject-mismatch": "subject-mismatch",
  "revoked-grant": "revoked-grant",
  "expired-grant": "expired-grant",
  "missing-scope": "missing-scope",
  "purpose-mismatch": "purpose-mismatch",
  "unconfirmed-patient-link": "unconfirmed-patient-link",
  "inactive-care-team": "inactive-care-team",
  "not-on-care-team": "not-on-care-team",
  "suspended-practitioner": "suspended-practitioner",
  "unverified-practitioner": "unverified-practitioner",
  "dissolved-organization": "dissolved-organization",
  "suspended-organization": "suspended-organization",
  "inactive-membership": "inactive-membership",
  "dissolved-clinic": "dissolved-clinic",
  "suspended-clinic": "suspended-clinic",
  "inactive-affiliation": "inactive-affiliation",
};

/**
 * Maps a clinical deny reason to its typed timeline denial. Total by
 * construction; fails CLOSED with a {@link TimelineError} if the
 * clinical vocabulary drifts ahead of this table (unreachable while the
 * packages move together — the drift test pins it).
 */
export function timelineDenialFor(reason: CareTeamDenyReason): TimelineDenyReason {
  if (!isCareTeamDenyReason(reason)) {
    // Unknown to the runtime vocabulary: vocabulary drift — fail closed.
    throw new TimelineError(
      "invalid-request",
      "Internal invariant violation: an unmapped care-team deny reason reached the timeline gate — failing closed.",
    );
  }
  const denial = TIMELINE_DENIALS[reason];
  if (denial === undefined) {
    // Known to the type but absent from the table: drift — fail closed.
    throw new TimelineError(
      "invalid-request",
      "Internal invariant violation: an unmapped care-team deny reason reached the timeline gate — failing closed.",
    );
  }
  return denial;
}

/** The runtime mirror of the frozen clinical vocabulary, for drift tests. */
export const TIMELINE_DENY_REASONS: readonly TimelineDenyReason[] = CARE_TEAM_DENY_REASONS;

// ---------------------------------------------------------------------------
// The audit record (shaped for access_audits — db handoff recorded).
// ---------------------------------------------------------------------------

/** The decision vocabulary (mirrors the access_audits check constraint). */
export const TIMELINE_ACCESS_DECISIONS = ["ALLOW", "DENY"] as const;

export type TimelineAccessDecisionKind = (typeof TIMELINE_ACCESS_DECISIONS)[number];

/** The allow-side reason label (labels only — never data values). */
export const TIMELINE_ACCESS_ALLOW_REASON = "timeline-read-granted" as const;

/**
 * The audit record of one timeline access decision — WHO (the
 * practitioner), WHAT (the subject + the `timeline:read` permission
 * label), WHEN, DECISION, REASON. Structurally the clinical lane's
 * `ClinicalAccessAuditRecord` shape; suitable for the append-only
 * `access_audits` table via the same mapping discipline the clinical
 * lane recorded (permission + reason ride inside `requestDigest` or
 * promoted columns — the db handoff).
 */
export interface TimelineAccessAudit {
  /** Who: the requesting practitioner (canonical pract_ id label). */
  readonly actor: string;
  /** What: the person whose timeline was requested. */
  readonly subjectId: PersonId;
  /** What: the requested permission (always "timeline:read" here). */
  readonly permission: string;
  /** When: the evaluation instant (from the injected clock). */
  readonly at: Date;
  readonly decision: TimelineAccessDecisionKind;
  /** Reason: the typed deny reason or the allow label. */
  readonly reason: string;
}

function auditFromDecision(
  subject: PersonId,
  permission: string,
  decision: CareTeamAccessDecision,
): TimelineAccessAudit {
  return {
    actor: decision.audit.actor,
    subjectId: subject,
    permission,
    at: decision.audit.at,
    decision: decision.audit.decision,
    // On ALLOW the timeline surfaces its own allow label (the clinical
    // record says "care-team-access-granted"; this surface is the
    // timeline read — the label names the surface). On DENY the typed
    // clinical reason is carried unchanged (identity mapping).
    reason:
      decision.audit.decision === "ALLOW"
        ? TIMELINE_ACCESS_ALLOW_REASON
        : decision.audit.reason,
  };
}

// ---------------------------------------------------------------------------
// The practitioner context + the read outcomes.
// ---------------------------------------------------------------------------

/**
 * The clinician's request context: WHO is asking (practitioner), the
 * stated purpose of use, and the A45 clinical state snapshot the REAL
 * evaluator reasons over (grant, patient link, care team, practitioner,
 * organization, membership, and optional clinic/affiliation).
 */
export interface PractitionerTimelineContext {
  readonly practitionerId: PractitionerId;
  /** Stated purpose of use (consent-lane vocabulary, matched by the kernel). */
  readonly purpose: string;
  /** The A45 snapshot for the REAL care-team evaluation. */
  readonly snapshot: CareTeamAccessSnapshot;
}

/**
 * The ALLOW outcome: the authorized page. Reachable ONLY through every
 * check of the REAL evaluator (kernel grant + link + team + practitioner
 * + organization + membership + optional clinic/affiliation) with the
 * frozen `timeline:read` scope.
 */
export interface TimelineReadGranted {
  readonly kind: "granted";
  readonly page: TimelinePage;
  /** The kernel grant that authorized the read. */
  readonly grantId: CareTeamAccessAllowed["grantId"];
  /** The practitioner's care-team role label, when one is recorded. */
  readonly careTeamRole?: CareTeamAccessAllowed["careTeamRole"];
  readonly evaluatedAt: Date;
  readonly audit: TimelineAccessAudit;
  /** The TIMELINE_READ access-decision event (persistence handoff recorded). */
  readonly event: TimelineEventEnvelope;
}

/**
 * The DENY outcome — ALL-OR-NOTHING: a typed reason and nothing else.
 * There is deliberately NO partial page, NO entry count, NO window echo:
 * a denied clinician learns only THAT the read was denied and WHY
 * (typed label). The clinician UI shows the deny, never a partial
 * timeline.
 */
export interface TimelineReadDenied {
  readonly kind: "denied";
  readonly reason: TimelineDenyReason;
  readonly evaluatedAt: Date;
  readonly audit: TimelineAccessAudit;
  /** The TIMELINE_READ access-decision event (persistence handoff recorded). */
  readonly event: TimelineEventEnvelope;
}

export type TimelineReadOutcome = TimelineReadGranted | TimelineReadDenied;

// ---------------------------------------------------------------------------
// The gate itself (pure evaluation plumbing — the page assembly lives in
// assembly.ts; this module owns the decision surface).
// ---------------------------------------------------------------------------

/**
 * Evaluates care-team access for a timeline read at `at` (the injected
 * evaluation instant) via the REAL `evaluateCareTeamAccess`, returning
 * the decision plus the timeline-shaped audit record. Pure: same
 * inputs → same decision, always. Malformed snapshots propagate the
 * kernel {@link import("@orbb/domain").DomainInvariantError}
 * (data-integrity discipline — mirroring the clinical evaluator).
 */
export function evaluateTimelineAccess(
  subject: PersonId,
  context: PractitionerTimelineContext,
  at: Date,
): { decision: CareTeamAccessDecision; audit: TimelineAccessAudit } {
  const decision = evaluateCareTeamAccess(
    {
      subjectId: subject,
      practitionerId: context.practitionerId,
      purpose: context.purpose,
      permission: TIMELINE_READ_PERMISSION,
      at,
    },
    context.snapshot,
  );
  return { decision, audit: auditFromDecision(subject, TIMELINE_READ_PERMISSION, decision) };
}

export function isTimelineReadOutcome(value: unknown): value is TimelineReadOutcome {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const kind = (value as Partial<Record<"kind", unknown>>).kind;
  if (kind === "denied") {
    const candidate = value as Partial<Record<keyof TimelineReadDenied, unknown>>;
    return isCareTeamDenyReason(candidate.reason);
  }
  if (kind === "granted") {
    const candidate = value as Partial<Record<keyof TimelineReadGranted, unknown>>;
    return typeof candidate.page === "object" && candidate.page !== null;
  }
  return false;
}

export type { CareTeamAccessDecision, CareTeamAccessSnapshot };
export type { PractitionerId };
