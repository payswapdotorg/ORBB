/**
 * Intent journey view model (M6-A, Lane B) — types only.
 *
 * These are the "thin local interfaces" over the frozen M5 intent engine
 * (`packages/intents`: EvidencePack, IntentCompiler, matcher, optimizer,
 * SafetyRuleEngine, proposal, review). They are STRUCTURAL MIRORS:
 * field-for-field the same vocabularies and semantics, with the branded ids
 * widened to plain strings and the Date windows split into ISO strings at
 * this boundary (wire form).
 *
 * Why mirrors instead of direct `@orbb/intents` imports: `apps/web` declares
 * only `@orbb/ui` as a workspace dependency at this base; adding
 * `@orbb/intents` (or `@orbb/domain`) would change `pnpm-lock.yaml`, which
 * this packet must not touch ("dependencies added — expect none"). At
 * integration the engine wiring (Lane A) adds `"@orbb/intents":
 * "workspace:*"` to `apps/web/package.json` and swaps these mirrors for the
 * engine types — the call sites are already shaped for that (recorded
 * handoff; see the FINAL REPORT's contract-handoff section).
 *
 * Mirrored vocabularies (frozen upstream, mirrored exactly):
 *   - evidence labels: MEASURED | ESTIMATED | IMPORTED | DERIVED
 *     (`packages/domain` evidence vocabulary, mirrored by M4-B capture types);
 *   - provenance actor classes: person | device | source (M5-A A36);
 *   - burden method kinds: manual | app | device (M5-B A39);
 *   - matcher drop reasons: metric-uncovered | no-method | no-source
 *     (M5-B A40);
 *   - safety outcome kinds PASS | ESCALATE | REJECT and the five rule codes
 *     (M5-B A41); ESCALATE carries `requiresHumanReview: true` and
 *     `publishable: false` as literal types, mirroring the type-encoded
 *     "escalations never publish without review" invariant;
 *   - plan states draft | published | active | completed | cancelled
 *     (`packages/domain` plan state machine, mirrored by the store's
 *     domain-transition mirror).
 *   - review entry states pending | approved | rejected (M5-C A43).
 */

// ---------------------------------------------------------------------------
// Mirrored vocabularies.
// ---------------------------------------------------------------------------

/** Goal direction vocabulary (UI lane: the person's aim for the metric). */
export const INTENT_DIRECTIONS = ["decrease", "increase", "maintain"] as const;

export type IntentDirection = (typeof INTENT_DIRECTIONS)[number];

export function isIntentDirection(value: unknown): value is IntentDirection {
  return (
    typeof value === "string" &&
    (INTENT_DIRECTIONS as readonly string[]).includes(value)
  );
}

/** Burden method kinds (M5-B A39 `BurdenMethodKind` mirror). */
export const INTENT_METHOD_KINDS = ["manual", "app", "device"] as const;

export type IntentMethodKind = (typeof INTENT_METHOD_KINDS)[number];

/** Provenance actor classes (M5-A A36 `ProvenanceActorClass` mirror). */
export const INTENT_ACTOR_CLASSES = ["person", "device", "source"] as const;

export type IntentActorClass = (typeof INTENT_ACTOR_CLASSES)[number];

/** Matcher drop reasons (M5-B A40 `MetricMatchFailureReason` mirror). */
export const INTENT_DROP_REASONS = [
  "metric-uncovered",
  "no-method",
  "no-source",
] as const;

export type IntentDropReason = (typeof INTENT_DROP_REASONS)[number];

/** Safety rule codes (M5-B A41 `SafetyRuleCode` mirror). */
export const INTENT_SAFETY_CODES = [
  "exceeds-max-measurements-per-day",
  "min-gap-between-metrics",
  "forbidden-metric-combination",
  "cadence-below-floor",
  "cadence-above-ceiling",
] as const;

export type IntentSafetyCode = (typeof INTENT_SAFETY_CODES)[number];

/** Safety rule kinds (M5-B A41 `SafetyRuleKind` mirror). */
export const INTENT_SAFETY_RULE_KINDS = [
  "max-measurements-per-day",
  "min-gap-between-metrics",
  "forbidden-metric-combination",
  "cadence-floor",
  "cadence-ceiling",
] as const;

export type IntentSafetyRuleKind = (typeof INTENT_SAFETY_RULE_KINDS)[number];

/** Plan lifecycle states (domain plan state machine mirror). */
export const INTENT_PLAN_STATES = [
  "draft",
  "published",
  "active",
  "completed",
  "cancelled",
] as const;

export type IntentPlanState = (typeof INTENT_PLAN_STATES)[number];

/** Review queue entry states (M5-C A43 `ReviewEntryState` mirror). */
export const INTENT_REVIEW_STATES = ["pending", "approved", "rejected"] as const;

export type IntentReviewState = (typeof INTENT_REVIEW_STATES)[number];

/** Method preference constraint (maps to compiler excludedMethodIds). */
export const INTENT_METHOD_PREFERENCES = ["any", "measured-only"] as const;

export type IntentMethodPreference = (typeof INTENT_METHOD_PREFERENCES)[number];

// ---------------------------------------------------------------------------
// Goal + constraints (the composer's wire form).
// ---------------------------------------------------------------------------

/** One structured goal: metric + direction + numeric target. */
export interface IntentGoalView {
  /** Catalog metric id (SYNTH-marked, M4-B capture catalog vocabulary). */
  readonly metricId: string;
  /** The person's aim for the metric. */
  readonly direction: IntentDirection;
  /** Numeric target value in the metric's unit. */
  readonly target: number;
}

/** Compilation constraints (cadence window + method preference). */
export interface IntentConstraintsView {
  /** Proposed measurements per day (finite, > 0; fractional allowed). */
  readonly cadencePerDay: number;
  /** "measured-only" excludes ESTIMATED-labeled methods from expansion. */
  readonly methodPreference: IntentMethodPreference;
}

// ---------------------------------------------------------------------------
// EvidencePack mirrors (M5-A A36 — wire form: ISO strings for windows).
// ---------------------------------------------------------------------------

/** Counts per frozen evidence label (four labels, zero default). */
export type IntentEvidenceLabelCounts = Readonly<
  Record<"MEASURED" | "ESTIMATED" | "IMPORTED" | "DERIVED", number>
>;

/** Quality mix mirror (label counts + optional mean quality in [0, 1]). */
export interface IntentQualityMixView {
  readonly byEvidenceLabel: IntentEvidenceLabelCounts;
  readonly meanQuality?: number;
}

/**
 * One pack entry summary (the A36 `EvidencePackEntry` mirror in wire form:
 * half-open window `[windowStart, windowEnd)` as ISO-8601 strings).
 */
export interface IntentPackEntryView {
  /** Content-addressed id grammar mirror (`evpe_…`, SYNTH-marked fixture). */
  readonly entryId: string;
  readonly metricId: string;
  readonly methodId: string;
  readonly windowStart: string;
  readonly windowEnd: string;
  /** Number of summarized observations (positive integer). */
  readonly count: number;
  readonly qualityMix: IntentQualityMixView;
  readonly provenanceActorClass: IntentActorClass;
}

/** The person's evidence pack (one ACTIVE version, wire form). */
export interface IntentEvidencePackView {
  readonly packId: string;
  readonly personId: string;
  /** Positive-integer ACTIVE version. */
  readonly version: number;
  readonly contentHash: string;
  readonly entries: readonly IntentPackEntryView[];
}

// ---------------------------------------------------------------------------
// Candidate plans (M5-A A38 explainability shape, wire form).
// ---------------------------------------------------------------------------

/**
 * One candidate measurement plan — a DRAFT domain plan view plus the M5
 * explainability audit trail. `state` is always "draft" at this boundary:
 * publication happens ONLY through the review stub's domain-transition
 * mirror (see store.ts), mirroring the M5-C invariant.
 */
export interface IntentPlanCandidateView {
  /** Domain plan id grammar mirror (`plan_…`, SYNTH-marked fixture). */
  readonly planId: string;
  readonly state: "draft";
  readonly personId: string;
  readonly intentId: string;
  readonly metricId: string;
  readonly metricLabel: string;
  /** Committed metric concept codes (exactly one at this milestone). */
  readonly metrics: readonly string[];
  readonly conceptCode: string;
  readonly methodId: string;
  readonly methodLabel: string;
  readonly methodKind: IntentMethodKind;
  readonly methodEvidenceLabel: "MEASURED" | "ESTIMATED" | "IMPORTED" | "DERIVED";
  /** Burden rank of the proposed method (lower = less burden). */
  readonly methodRelativeBurden: number;
  readonly cadencePerDay: number;
  /** Backing pack identity (from the candidate's explainability). */
  readonly pack: {
    readonly packId: string;
    readonly version: number;
    readonly contentHash: string;
  };
  /**
   * Which pack entries contributed (their entry ids, methods, coverage
   * windows, counts, actor classes) — the A38 `ContributingPackEntry` list.
   */
  readonly contributingEntries: readonly {
    readonly entryId: string;
    readonly methodId: string;
    readonly windowStart: string;
    readonly windowEnd: string;
    readonly count: number;
    readonly provenanceActorClass: IntentActorClass;
  }[];
  /** Total observations summarized by the contributing entries. */
  readonly totalObservationCount: number;
  readonly compiledAt: string;
}

/**
 * A candidate the matcher dropped before executability — audit surface for
 * the review screen (M5-B A40 `DroppedCandidate` semantics, per-method).
 */
export interface IntentDroppedCandidateView {
  readonly metricId: string;
  readonly metricLabel: string;
  readonly methodId: string;
  readonly methodLabel: string;
  readonly methodKind: IntentMethodKind;
  readonly reason: IntentDropReason;
  /** PHID-safe explanation of the drop (template string, no values echoed). */
  readonly detail: string;
}

// ---------------------------------------------------------------------------
// Safety outcome mirror (M5-B A41 — the type-encoded invariant preserved).
// ---------------------------------------------------------------------------

/** One rule that fired: id, kind, code, violation outcome, input summary. */
export interface IntentFiredRuleView {
  readonly ruleId: string;
  readonly ruleKind: IntentSafetyRuleKind;
  readonly code: IntentSafetyCode;
  readonly onViolation: "reject" | "escalate";
  /** PHID-safe summary of the offending inputs (audit display). */
  readonly inputsSummary: string;
}

/**
 * Safety verdict of one candidate. The ESCALATE invariant is preserved in
 * the literals: only PASS is publishable; ESCALATE requires human review.
 */
export type IntentSafetyOutcomeView =
  | {
      readonly kind: "PASS";
      readonly requiresHumanReview: false;
      readonly publishable: true;
      readonly reasonCodes: readonly [];
      readonly firedRules: readonly IntentFiredRuleView[];
    }
  | {
      readonly kind: "ESCALATE";
      readonly requiresHumanReview: true;
      readonly publishable: false;
      readonly reasonCodes: readonly IntentSafetyCode[];
      readonly firedRules: readonly IntentFiredRuleView[];
    }
  | {
      readonly kind: "REJECT";
      readonly requiresHumanReview: false;
      readonly publishable: false;
      readonly reasonCodes: readonly IntentSafetyCode[];
      readonly firedRules: readonly IntentFiredRuleView[];
    };

// ---------------------------------------------------------------------------
// Burden summary (M5-B A39 display projection).
// ---------------------------------------------------------------------------

/**
 * Burden summary of one candidate: the M5-B burden model projection the
 * review screen displays (kind weights ordered manual > app > device, the
 * frozen default's ordering; cadence cost multiplies per-day burden).
 */
export interface IntentBurdenSummaryView {
  /** Methods committed by the candidate (exactly one at this milestone). */
  readonly methodCount: number;
  /** Proposed measurements per day for the committed metric. */
  readonly measurementsPerDay: number;
  /**
   * Burden units per day = kindWeight(method) × cadencePerDay, with the
   * frozen ordering manual(3) > app(2) > device(1).
   */
  readonly burdenUnitsPerDay: number;
  /** The kind weights used (display + audit of the model). */
  readonly methodKindWeights: Readonly<Record<IntentMethodKind, number>>;
}

// ---------------------------------------------------------------------------
// Stored records (in-memory store -> API responses).
// ---------------------------------------------------------------------------

/** One stored intent (domain HealthIntent-shaped summary, wire form). */
export interface IntentRecordView {
  /** `intent_SYNTH-intent-000001` grammar (creation-scoped, store counter). */
  readonly intentId: string;
  /** The client draft id — the idempotency key for re-submission. */
  readonly draftId: string;
  readonly personId: string;
  /** Free-text objective statement composed from the structured goal. */
  readonly objective: string;
  readonly goal: IntentGoalView;
  readonly constraints: IntentConstraintsView;
  /** Pack version the intent was compiled against. */
  readonly evidencePackVersion: number;
  readonly createdAt: string;
}

/**
 * One review queue entry (M5-C A43 mirror): the intent's compiled plan
 * proposal awaiting the person's approve-with-edits / reject decision.
 */
export interface IntentReviewEntryView {
  /** `revq_SYNTH-000001` grammar (creation-scoped, store counter). */
  readonly entryId: string;
  readonly intentId: string;
  readonly state: IntentReviewState;
  readonly enqueuedAt: string;
  /**
   * The least-burden EXECUTABLE candidate proposed for review. Null when
   * the matcher found no executable candidate (the dropped/gated audit
   * then explains why) — an honest empty state, never a fabricated plan.
   */
  readonly candidate: IntentPlanCandidateView | null;
  /** Other executable candidates (burden-ordered after the primary). */
  readonly alternatives: readonly IntentPlanCandidateView[];
  /** Candidates the matcher dropped (source/coverage audit). */
  readonly dropped: readonly IntentDroppedCandidateView[];
  /** Safety outcome of the primary candidate (null with no candidate). */
  readonly safety: IntentSafetyOutcomeView | null;
  /** Burden summary of the primary candidate (null with no candidate). */
  readonly burden: IntentBurdenSummaryView | null;
}

/** A PUBLISHED plan (plan-store record; only the review stub writes these). */
export interface IntentPublishedPlanView {
  readonly planId: string;
  readonly personId: string;
  readonly intentId: string;
  /** Committed metric concept codes (post-edit). */
  readonly metrics: readonly string[];
  readonly metricLabel: string;
  readonly methodId: string;
  readonly methodLabel: string;
  readonly cadencePerDay: number;
  readonly state: "published";
  readonly publishedAt: string;
  /** Reviewer note recorded at approval (absent when unedited). */
  readonly reviewerNote?: string;
}

/** One audit-trail record (enqueue / approve / reject; chronological order). */
export type IntentAuditRecordView =
  | {
      readonly kind: "enqueued";
      readonly recordId: string;
      readonly entryId: string;
      readonly intentId: string;
      readonly at: string;
      readonly planId: string | null;
    }
  | {
      readonly kind: "approved";
      readonly recordId: string;
      readonly entryId: string;
      readonly intentId: string;
      readonly at: string;
      readonly planId: string;
      readonly fromState: "draft";
      readonly toState: "published";
      readonly originalMetrics: readonly string[];
      readonly publishedMetrics: readonly string[];
      readonly reviewerNote?: string;
    }
  | {
      readonly kind: "rejected";
      readonly recordId: string;
      readonly entryId: string;
      readonly intentId: string;
      readonly at: string;
      readonly reason: string;
    };

// ---------------------------------------------------------------------------
// Wire types (client form -> POST /api/intents, /api/plans; responses back).
// ---------------------------------------------------------------------------

/** `POST /api/intents` request body. */
export interface IntentCreateRequest {
  /** Client-generated draft id — idempotency key (SYNTH-DRAFT-…). */
  readonly draftId: string;
  readonly goal: IntentGoalView;
  readonly constraints: IntentConstraintsView;
}

/** `POST /api/intents` success body (golden journey head: plan received). */
export interface IntentCreateResponse {
  readonly synthetic: true;
  readonly intent: IntentRecordView;
  readonly review: IntentReviewEntryView;
}

/** `GET /api/intents` response body. */
export interface IntentListResponse {
  readonly synthetic: true;
  readonly personId: string;
  readonly intents: readonly {
    readonly intent: IntentRecordView;
    readonly review: IntentReviewEntryView;
  }[];
}

/** Reviewer edits applied at approval (M5-C `PlanEdits` mirror). */
export interface IntentPlanEdits {
  /** Replacement metric concept codes (non-empty, from the catalog). */
  readonly metrics?: readonly string[];
  /** Reviewer note recorded verbatim in the audit trail. */
  readonly note?: string;
}

/** `POST /api/plans` request body (the typed reviewer act). */
export type IntentPlanActRequest =
  | {
      readonly action: "approve-with-edits";
      readonly entryId: string;
      readonly edits?: IntentPlanEdits;
    }
  | {
      readonly action: "reject";
      readonly entryId: string;
      /** Required rejection reason (non-empty; recorded in the audit). */
      readonly reason: string;
    };

/** `POST /api/plans` success body (discriminated by the act). */
export type IntentPlanActResponse =
  | {
      readonly synthetic: true;
      readonly kind: "approved";
      readonly plan: IntentPublishedPlanView;
      readonly review: IntentReviewEntryView;
      readonly audit: IntentAuditRecordView;
    }
  | {
      readonly synthetic: true;
      readonly kind: "rejected";
      readonly review: IntentReviewEntryView;
      readonly audit: IntentAuditRecordView;
    };

/** `GET /api/plans` response body. */
export interface IntentPlanListResponse {
  readonly synthetic: true;
  readonly personId: string;
  readonly published: readonly IntentPublishedPlanView[];
  readonly pending: readonly IntentReviewEntryView[];
  readonly audit: readonly IntentAuditRecordView[];
}

// ---------------------------------------------------------------------------
// Error envelope (the app's M3-A style, mirrored from the capture types:
// PHI-safe by construction — messages describe the violated invariant and
// never echo received values; field-level issues carry PATH + problem).
// ---------------------------------------------------------------------------

export type IntentErrorCode =
  | "invalid-request"
  | "validation-failed"
  | "internal-error";

/** Field-level validation issue (field PATH + problem; values never echoed). */
export interface IntentIssue {
  readonly field: string;
  readonly problem: string;
}

export interface IntentErrorEnvelope {
  readonly error: {
    readonly code: IntentErrorCode;
    readonly message: string;
    readonly details?: { readonly issues: readonly IntentIssue[] };
    readonly requestId: string;
  };
}

// ---------------------------------------------------------------------------
// Client-side payload guards (untrusted JSON from our own routes — the same
// defensive pattern as the M4-B capture form).
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isCandidateLike(value: unknown): value is IntentPlanCandidateView {
  if (!isPlainObject(value)) {
    return false;
  }
  return (
    isNonEmptyString(value.planId) &&
    value.state === "draft" &&
    isNonEmptyString(value.metricId) &&
    isNonEmptyString(value.methodId)
  );
}

/** Type guard: is `payload` a successful intent-create response? */
export function isIntentCreateResponse(
  payload: unknown,
): payload is IntentCreateResponse {
  if (!isPlainObject(payload)) {
    return false;
  }
  if (payload.synthetic !== true) {
    return false;
  }
  const intent = payload.intent;
  const review = payload.review;
  return (
    isPlainObject(intent) &&
    isNonEmptyString(intent.intentId) &&
    isPlainObject(review) &&
    isNonEmptyString(review.entryId) &&
    (review.candidate === null || isCandidateLike(review.candidate))
  );
}

/** Type guard: is `payload` a successful plan-act response? */
export function isIntentPlanActResponse(
  payload: unknown,
): payload is IntentPlanActResponse {
  if (!isPlainObject(payload)) {
    return false;
  }
  if (payload.synthetic !== true) {
    return false;
  }
  if (payload.kind !== "approved" && payload.kind !== "rejected") {
    return false;
  }
  if (payload.kind === "approved") {
    return isPlainObject(payload.plan) && isNonEmptyString(payload.plan.planId);
  }
  return isPlainObject(payload.review) && isNonEmptyString(reviewEntryIdOf(payload));
}

function reviewEntryIdOf(payload: Record<string, unknown>): unknown {
  const review = payload.review;
  return isPlainObject(review) ? review.entryId : undefined;
}

/** Type guard: is `payload` a plan/intent error envelope? */
export function isIntentErrorEnvelope(
  payload: unknown,
): payload is IntentErrorEnvelope {
  if (!isPlainObject(payload)) {
    return false;
  }
  const error = payload.error;
  if (!isPlainObject(error)) {
    return false;
  }
  return isNonEmptyString(error.code) && isNonEmptyString(error.message);
}
