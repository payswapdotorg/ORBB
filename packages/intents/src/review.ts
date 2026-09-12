/**
 * A43 — Human review/publish workflow: the ONLY path from an AI
 * proposal (A42) or a safety-ESCALATED candidate to a PUBLISHED
 * measurement plan (architecture §8, M5 milestone, Lane C packet M5-C).
 *
 * THE INVARIANT (packet-literal, encoded in types AND runtime):
 *   NOTHING reaches `published` without a review record.
 *   - `approve-with-edits` without a matching enqueue is a TYPED error
 *     (`unknown-entry`): entries exist only through `enqueueProposal` /
 *     `enqueueEscalation`, and every act resolves an entry id against
 *     that queue.
 *   - a proposal NEVER enters the plan store directly: the store port
 *     ({@link PlanStore}) accepts ONLY {@link PublishedMeasurementPlan}
 *     values — a type that exists solely as the output of THIS
 *     workflow's domain transition. A {@link ProposedDraftPlan} (no
 *     `state` field) is not assignable to it at compile time, and the
 *     in-memory double re-validates the domain shape at runtime
 *     (defense-in-depth).
 *   - publication is a DOMAIN TRANSITION, never a direct state write:
 *     approval reconstructs the draft domain plan, applies the
 *     reviewer's edits, and invokes the FROZEN `assertPlanTransition`
 *     guard from `@orbb/domain` (draft -> published). No other code path
 *     in this module writes a plan state.
 *   - REJECTION IS TERMINAL for the queue entry; approval is likewise
 *     once-only (both move the entry out of `pending` permanently).
 *   - COMPLETE AUDIT TRAIL: every action (enqueue, approve, reject) is
 *     recorded with actor + inputs — reviewer provenance (domain
 *     `PersonId`) and timestamps from the INJECTED clock; the enqueued
 *     record carries the subject's provenance summary (model provenance
 *     + the pack version LINEAGE the proposal was derived from, or the
 *     safety escalation reason codes).
 *
 * RECORDED DECISIONS (genuinely unspecified points; safest
 * architecture-consistent choice made for tech-lead review):
 *   - M5-A exports `applyPlanTransition` (compiler.ts) as the intended
 *     A43 convenience wrapper; this module deliberately does NOT import
 *     it (packet rule: no M5-A/M5-B module imports in the parallel-lane
 *     seam files) and instead calls `@orbb/domain`'s FROZEN
 *     `assertPlanTransition` directly — the same guard, within this
 *     packet's dependency budget (@orbb/domain + @orbb/testkit). At
 *     integration the two call sites may unify mechanically.
 *   - The PLAN STORE port is publication-scoped for this milestone:
 *     `save` accepts only published plans (the type-encoded invariant).
 *     Drafts live inside proposals/queue entries, never in the store;
 *     db adaptation widens the port to the full plan lifecycle when
 *     activation (M6+) arrives — handoff recorded.
 *   - PLAN EDITS surface: only the plan's committed METRIC concept codes
 *     and a reviewer note are editable (the plan's identity fields —
 *     id/person/intent/createdAt — are provenance and immutable; edits
 *     are re-validated against the frozen domain plan guard). Both the
 *     original and published metric lists are recorded in the audit.
 *   - QUEUE ENTRY ids (`revq_<body>`) and AUDIT RECORD ids
 *     (`rvar_<body>`) are lane-local branded grammars mirroring the
 *     M5-A `EvidencePackId` precedent (frozen domain id kinds have no
 *     review kinds; promotion is a domain change for tech-lead review).
 *   - ENQUEUE DEDUPLICATION: a queue entry whose underlying draft plan
 *     id is already queued (pending OR acted on) is a typed rejection —
 *     one review per plan draft. A revised candidate compiles to a
 *     different content-derived plan id and therefore enqueues cleanly.
 *   - The enqueue ACTOR is optional provenance (a system service or the
 *     person's session may enqueue); the REVIEWER on act commands is a
 *     REQUIRED domain `PersonId` — human review means a person decides.
 */
import {
  DomainInvariantError,
  assertMeasurementPlan,
  assertPlanTransition,
  isIdOf,
  isMeasurementPlan,
  isProvenanceActor,
  type IntentId,
  type MeasurementPlan,
  type PersonId,
  type PlanId,
  type ProvenanceActor,
} from "@orbb/domain";
import type { Clock, IdFactory } from "@orbb/testkit";
import { canonicalJsonStringify, sha256Hex } from "./canonical.js";
import { err, ok, type IntentResult } from "./result.js";
import {
  isProposalId,
  type Proposal,
  type ProposalId,
  type ProposalProvenance,
  type ProposedDraftPlan,
  type SafetyOutcomeView,
} from "./proposal.js";

// ---------------------------------------------------------------------------
// Lane-local identifiers: ReviewEntryId (revq_<body>).
// ---------------------------------------------------------------------------

declare const reviewEntryIdBrand: unique symbol;

/** Opaque review-queue entry identifier: `revq_<body>` (lane-local). */
export type ReviewEntryId = string & { readonly [reviewEntryIdBrand]: "ReviewEntryId" };

/** Fixed prefix of {@link ReviewEntryId}. */
export const REVIEW_ENTRY_ID_PREFIX = "revq";

/** Valid body segment of the lane-local review-entry id grammar. */
const REVIEW_ENTRY_ID_BODY_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

/** Type guard: is `value` a well-formed {@link ReviewEntryId}? */
export function isReviewEntryId(value: unknown): value is ReviewEntryId {
  return (
    typeof value === "string" &&
    value.startsWith(`${REVIEW_ENTRY_ID_PREFIX}_`) &&
    REVIEW_ENTRY_ID_BODY_PATTERN.test(value.slice(REVIEW_ENTRY_ID_PREFIX.length + 1))
  );
}

// ---------------------------------------------------------------------------
// The published plan type (the ONLY state the plan store accepts).
// ---------------------------------------------------------------------------

/**
 * A domain `MeasurementPlan` in exactly the `published` state. This type
 * is the OUTPUT of the review workflow's domain transition; because the
 * store port accepts only this type, nothing but a review approval can
 * place a plan into the store (type-encoded invariant).
 */
export type PublishedMeasurementPlan = MeasurementPlan & { readonly state: "published" };

// ---------------------------------------------------------------------------
// The plan store port (publication-scoped for this milestone).
// ---------------------------------------------------------------------------

/** Typed reasons a plan-store save is refused (never throws). */
export type PlanStoreError =
  | { readonly kind: "invalid-plan" }
  | { readonly kind: "duplicate-plan" };

/**
 * The plan store PORT: where the review workflow's published plans are
 * persisted. Publication-scoped at this milestone (see module header);
 * the db adaptation (packages/db repos) is a recorded handoff.
 */
export interface PlanStore {
  /** Persists a PUBLISHED plan (append-only: a duplicate id is refused). */
  save(plan: PublishedMeasurementPlan): IntentResult<void, PlanStoreError>;
  /** Resolves one stored plan by id (undefined when unknown). */
  get(planId: PlanId): PublishedMeasurementPlan | undefined;
  /** All stored plans for one intent (insertion order). */
  listByIntent(intentId: IntentId): readonly PublishedMeasurementPlan[];
  /** All stored plans (insertion order) — the published-only proof set. */
  listAll(): readonly PublishedMeasurementPlan[];
}

/**
 * In-memory {@link PlanStore} double. Defense-in-depth: `save` validates
 * the value is a well-formed domain `MeasurementPlan` AND exactly
 * `published` (a draft view or non-plan object is a typed
 * `invalid-plan` refusal — a proposal can never sneak in here even if a
 * caller defeats the compiler), and refuses duplicate ids
 * (publication is once-only, append-only).
 */
export class InMemoryPlanStore implements PlanStore {
  readonly #plans = new Map<PlanId, PublishedMeasurementPlan>();

  save(plan: PublishedMeasurementPlan): IntentResult<void, PlanStoreError> {
    if (
      typeof plan !== "object" ||
      plan === null ||
      plan.state !== "published" ||
      !isMeasurementPlan(plan)
    ) {
      return err({ kind: "invalid-plan" });
    }
    if (this.#plans.has(plan.id)) {
      return err({ kind: "duplicate-plan" });
    }
    this.#plans.set(plan.id, { ...plan, metrics: [...plan.metrics] });
    return ok(undefined);
  }

  get(planId: PlanId): PublishedMeasurementPlan | undefined {
    const plan = this.#plans.get(planId);
    return plan === undefined ? undefined : { ...plan, metrics: [...plan.metrics] };
  }

  listByIntent(intentId: IntentId): readonly PublishedMeasurementPlan[] {
    return this.listAll().filter((plan) => plan.intentId === intentId);
  }

  listAll(): readonly PublishedMeasurementPlan[] {
    return [...this.#plans.values()].map((plan) => ({ ...plan, metrics: [...plan.metrics] }));
  }
}

// ---------------------------------------------------------------------------
// Review subjects: proposals and safety-escalated candidates.
// ---------------------------------------------------------------------------

/** Pack lineage reference echoed onto an escalation subject (audit). */
export interface EscalationPackRef {
  readonly packId: string;
  readonly version: number;
  readonly supersedesVersion?: number;
  readonly lineage: readonly number[];
}

/**
 * A safety-ESCALATED candidate entering human review — the M5-B
 * `EscalateOutcome` clearing path (type-encoding on the M5-B side says
 * an escalation is never publishable without this workflow). Carries
 * the escalated candidate identity, the safety reason codes, the
 * NON-PROMOTABLE draft plan view, and (optionally) the pack lineage it
 * was compiled from.
 */
export interface EscalatedCandidateForReview {
  /** Candidate identity (the M5-B SafetyCandidate id = draft plan id). */
  readonly candidateId: string;
  /** Escalation reason codes (non-empty; from the safety gate). */
  readonly reasonCodes: readonly string[];
  /** The non-promotable draft plan view awaiting human adjudication. */
  readonly plan: ProposedDraftPlan;
  readonly pack?: EscalationPackRef;
}

/** Lifecycle of a review queue entry (NOT the plan state machine). */
export const REVIEW_ENTRY_STATES = ["pending", "approved", "rejected"] as const;

export type ReviewEntryState = (typeof REVIEW_ENTRY_STATES)[number];

/** One review queue entry (the subject + its lifecycle state). */
export interface ReviewQueueEntry {
  readonly entryId: ReviewEntryId;
  /** The full subject (proposal or escalated candidate) under review. */
  readonly subject: ReviewQueueSubject;
  readonly state: ReviewEntryState;
  readonly enqueuedAt: Date;
  readonly enqueuedBy?: ProvenanceActor;
}

/** The discriminated subject of a queue entry (kind-tagged payload). */
export type ReviewQueueSubject =
  | { readonly kind: "proposal"; readonly proposal: Proposal }
  | { readonly kind: "escalation"; readonly escalation: EscalatedCandidateForReview };

// ---------------------------------------------------------------------------
// Reviewer commands (typed; provenance: reviewer PersonId + injected clock).
// ---------------------------------------------------------------------------

/** Reviewer edits applied at approval (identity fields are immutable). */
export interface PlanEdits {
  /** Replacement metric concept codes (non-empty, non-blank). */
  readonly metrics?: readonly string[];
  /** Reviewer note recorded verbatim in the audit trail. */
  readonly note?: string;
}

/** The approve-with-edits command (approves AND applies edits atomically). */
export interface ApproveWithEditsCommand {
  readonly action: "approve-with-edits";
  readonly entryId: ReviewEntryId;
  /** The HUMAN reviewer (domain PersonId — a person decides, §8). */
  readonly reviewer: PersonId;
  /** Optional edits to the draft plan before publication. */
  readonly edits?: PlanEdits;
}

/** The reject command — terminal for the queue entry. */
export interface RejectCommand {
  readonly action: "reject";
  readonly entryId: ReviewEntryId;
  readonly reviewer: PersonId;
  /** Required rejection reason (non-empty; recorded in the audit). */
  readonly reason: string;
}

/** Every reviewer act is ONE typed command (discriminated by `action`). */
export type ReviewActCommand = ApproveWithEditsCommand | RejectCommand;

// ---------------------------------------------------------------------------
// Audit trail (complete: every action, with actor + inputs).
// ---------------------------------------------------------------------------

/** Provenance summary of an enqueued subject (PHID-safe: ids/versions). */
export type EnqueuedSubjectSummary =
  | {
      readonly kind: "proposal";
      readonly proposalId: ProposalId;
      readonly intentId: IntentId;
      readonly personId: PersonId;
      readonly selectedCandidateId: string;
      readonly modelProvenance: ProposalProvenance;
      readonly pack: {
        readonly packId: string;
        readonly version: number;
        readonly supersedesVersion?: number;
        readonly lineage: readonly number[];
      };
    }
  | {
      readonly kind: "escalation";
      readonly candidateId: string;
      readonly intentId: IntentId;
      readonly personId: PersonId;
      readonly reasonCodes: readonly string[];
      readonly pack?: {
        readonly packId: string;
        readonly version: number;
        readonly supersedesVersion?: number;
        readonly lineage: readonly number[];
      };
    };

/** A proposal or escalation entered the queue. */
export interface EnqueuedAuditRecord {
  readonly kind: "enqueued";
  /** Creation-scoped audit record id (`rvar_<body>`). */
  readonly recordId: string;
  readonly entryId: ReviewEntryId;
  readonly at: Date;
  readonly actor?: ProvenanceActor;
  readonly subject: EnqueuedSubjectSummary;
}

/** A reviewer approved (with edits) — the plan was published. */
export interface ApprovedAuditRecord {
  readonly kind: "approved";
  readonly recordId: string;
  readonly entryId: ReviewEntryId;
  readonly at: Date;
  readonly reviewer: PersonId;
  /** The published plan this record traces (the review join key). */
  readonly planId: PlanId;
  /** The DOMAIN transition invoked through the frozen guard. */
  readonly fromState: "draft";
  readonly toState: "published";
  /** Echo of the reviewer's edits (absent when the draft was approved as-is). */
  readonly edits?: PlanEdits;
  /** The draft's committed metrics BEFORE edits (audit of what changed). */
  readonly originalMetrics: readonly string[];
  /** The PUBLISHED plan's committed metrics AFTER edits. */
  readonly publishedMetrics: readonly string[];
  /** Model provenance of the subject proposal (absent for escalations). */
  readonly modelProvenance?: ProposalProvenance;
  /** Safety escalation reason codes cleared by this approval (if any). */
  readonly escalatedReasonCodes?: readonly string[];
}

/** A reviewer rejected — terminal for that queue entry. */
export interface RejectedAuditRecord {
  readonly kind: "rejected";
  readonly recordId: string;
  readonly entryId: ReviewEntryId;
  readonly at: Date;
  readonly reviewer: PersonId;
  readonly reason: string;
  readonly modelProvenance?: ProposalProvenance;
  readonly escalatedReasonCodes?: readonly string[];
}

/** The append-only audit trail (chronological order is the record order). */
export type ReviewAuditRecord = EnqueuedAuditRecord | ApprovedAuditRecord | RejectedAuditRecord;

// ---------------------------------------------------------------------------
// Typed workflow rejections (PHID-safe: structural context only).
// ---------------------------------------------------------------------------

/** Typed reasons an enqueue is refused. */
export type ReviewEnqueueError =
  | { readonly kind: "invalid-proposal" }
  | { readonly kind: "invalid-escalation" }
  | { readonly kind: "invalid-actor" }
  | { readonly kind: "proposal-person-mismatch" }
  | { readonly kind: "proposal-intent-mismatch" }
  | { readonly kind: "duplicate-plan" };

/** Typed reasons a reviewer act is refused. */
export type ReviewActError =
  | { readonly kind: "invalid-action" }
  | { readonly kind: "invalid-entry-id" }
  | { readonly kind: "invalid-reviewer" }
  | { readonly kind: "missing-reject-reason" }
  | { readonly kind: "invalid-edit" }
  | { readonly kind: "invalid-edits" }
  /** THE packet invariant: an act with no matching enqueue is a typed error. */
  | { readonly kind: "unknown-entry" }
  /** Terminal states: rejection is terminal; approval is once-only. */
  | { readonly kind: "entry-not-pending" }
  | { readonly kind: "invalid-plan" }
  /** Defensive: the frozen domain guard refused the transition. */
  | { readonly kind: "domain-transition-refused" }
  | { readonly kind: "store-failure"; readonly reason: PlanStoreError };

// ---------------------------------------------------------------------------
// Act outcomes.
// ---------------------------------------------------------------------------

/** The result of an approved act: the PUBLISHED plan + review record. */
export interface ApprovedReviewOutcome {
  readonly kind: "approved";
  readonly plan: PublishedMeasurementPlan;
  readonly record: ApprovedAuditRecord;
  readonly entry: ReviewQueueEntry;
}

/** The result of a rejected act (terminal for the entry). */
export interface RejectedReviewOutcome {
  readonly kind: "rejected";
  readonly record: RejectedAuditRecord;
  readonly entry: ReviewQueueEntry;
}

export type ReviewActOutcome = ApprovedReviewOutcome | RejectedReviewOutcome;

// ---------------------------------------------------------------------------
// The review workflow PORT + in-memory implementation.
// ---------------------------------------------------------------------------

/** Enqueue input for the proposal path. */
export interface EnqueueProposalInput {
  readonly proposal: Proposal;
  /** Optional actor provenance for the enqueue (system service/session). */
  readonly actor?: ProvenanceActor;
}

/** Enqueue input for the safety-escalation path. */
export interface EnqueueEscalationInput {
  readonly escalation: EscalatedCandidateForReview;
  /** Optional actor provenance for the enqueue (system service/session). */
  readonly actor?: ProvenanceActor;
}

/**
 * The review workflow PORT (A43): enqueue (proposal or safety-ESCALATED
 * candidate), reviewer acts (approve-with-edits | reject) as typed
 * commands with reviewer provenance, inspect the queue, and read the
 * append-only audit trail.
 */
export interface ReviewWorkflow {
  enqueueProposal(input: EnqueueProposalInput): IntentResult<ReviewQueueEntry, ReviewEnqueueError>;
  enqueueEscalation(input: EnqueueEscalationInput): IntentResult<ReviewQueueEntry, ReviewEnqueueError>;
  act(command: ReviewActCommand): IntentResult<ReviewActOutcome, ReviewActError>;
  getEntry(entryId: ReviewEntryId): ReviewQueueEntry | undefined;
  listEntries(): readonly ReviewQueueEntry[];
  auditTrail(): readonly ReviewAuditRecord[];
}

/** Constructor deps for the in-memory workflow (all injectable). */
export interface ReviewWorkflowDeps {
  readonly clock: Clock;
  readonly ids: IdFactory;
  readonly store: PlanStore;
}

/** Audit-record id prefix (lane-local grammar, see module header). */
const AUDIT_RECORD_ID_PREFIX = "rvar";

/**
 * In-memory {@link ReviewWorkflow} reference implementation.
 * Deterministic given (command sequence, injected clock/id state, store
 * state). The ONLY writer to the plan store is `act` on an
 * `approve-with-edits` command — after the frozen domain transition.
 */
export class InMemoryReviewWorkflow implements ReviewWorkflow {
  readonly #clock: Clock;
  readonly #ids: IdFactory;
  readonly #store: PlanStore;
  readonly #entries = new Map<ReviewEntryId, ReviewQueueEntry>();
  readonly #audit: ReviewAuditRecord[] = [];
  /** Queue dedup: draft plan ids already under review (any state). */
  readonly #queuedPlanIds = new Set<string>();

  constructor(deps: ReviewWorkflowDeps) {
    this.#clock = deps.clock;
    this.#ids = deps.ids;
    this.#store = deps.store;
  }

  enqueueProposal(
    input: EnqueueProposalInput,
  ): IntentResult<ReviewQueueEntry, ReviewEnqueueError> {
    if (typeof input !== "object" || input === null) {
      return err({ kind: "invalid-proposal" });
    }
    if (input.actor !== undefined && !isProvenanceActor(input.actor)) {
      return err({ kind: "invalid-actor" });
    }
    const proposal = input.proposal;
    const proposalError = validateProposalSubject(proposal);
    if (proposalError !== undefined) {
      return err(proposalError);
    }
    if (proposal.candidatePlan.personId !== proposal.personId) {
      return err({ kind: "proposal-person-mismatch" });
    }
    if (proposal.candidatePlan.intentId !== proposal.intentId) {
      return err({ kind: "proposal-intent-mismatch" });
    }
    if (this.#queuedPlanIds.has(proposal.candidatePlan.id)) {
      return err({ kind: "duplicate-plan" });
    }

    const entry: ReviewQueueEntry = {
      entryId: this.#ids.next(REVIEW_ENTRY_ID_PREFIX) as ReviewEntryId,
      subject: { kind: "proposal", proposal },
      state: "pending",
      enqueuedAt: this.#clock.now(),
      ...(input.actor !== undefined ? { enqueuedBy: input.actor } : {}),
    };
    this.#entries.set(entry.entryId, entry);
    this.#queuedPlanIds.add(proposal.candidatePlan.id);
    this.#audit.push({
      kind: "enqueued",
      recordId: this.#ids.next(AUDIT_RECORD_ID_PREFIX),
      entryId: entry.entryId,
      at: entry.enqueuedAt,
      ...(input.actor !== undefined ? { actor: input.actor } : {}),
      subject: {
        kind: "proposal",
        proposalId: proposal.id,
        intentId: proposal.intentId,
        personId: proposal.personId,
        selectedCandidateId: proposal.selectedCandidateId,
        modelProvenance: proposal.provenance,
        pack: {
          packId: proposal.evidencePack.packId,
          version: proposal.evidencePack.version,
          ...(proposal.evidencePack.supersedesVersion !== undefined
            ? { supersedesVersion: proposal.evidencePack.supersedesVersion }
            : {}),
          lineage: [...proposal.evidencePack.lineage],
        },
      },
    });
    return ok({ ...entry });
  }

  enqueueEscalation(
    input: EnqueueEscalationInput,
  ): IntentResult<ReviewQueueEntry, ReviewEnqueueError> {
    if (typeof input !== "object" || input === null) {
      return err({ kind: "invalid-escalation" });
    }
    if (input.actor !== undefined && !isProvenanceActor(input.actor)) {
      return err({ kind: "invalid-actor" });
    }
    const escalation = input.escalation;
    const escalationError = validateEscalationSubject(escalation);
    if (escalationError !== undefined) {
      return err(escalationError);
    }
    if (this.#queuedPlanIds.has(escalation.plan.id)) {
      return err({ kind: "duplicate-plan" });
    }

    const entry: ReviewQueueEntry = {
      entryId: this.#ids.next(REVIEW_ENTRY_ID_PREFIX) as ReviewEntryId,
      subject: { kind: "escalation", escalation },
      state: "pending",
      enqueuedAt: this.#clock.now(),
      ...(input.actor !== undefined ? { enqueuedBy: input.actor } : {}),
    };
    this.#entries.set(entry.entryId, entry);
    this.#queuedPlanIds.add(escalation.plan.id);
    this.#audit.push({
      kind: "enqueued",
      recordId: this.#ids.next(AUDIT_RECORD_ID_PREFIX),
      entryId: entry.entryId,
      at: entry.enqueuedAt,
      ...(input.actor !== undefined ? { actor: input.actor } : {}),
      subject: {
        kind: "escalation",
        candidateId: escalation.candidateId,
        intentId: escalation.plan.intentId,
        personId: escalation.plan.personId,
        reasonCodes: [...escalation.reasonCodes],
        ...(escalation.pack !== undefined
          ? {
              pack: {
                packId: escalation.pack.packId,
                version: escalation.pack.version,
                ...(escalation.pack.supersedesVersion !== undefined
                  ? { supersedesVersion: escalation.pack.supersedesVersion }
                  : {}),
                lineage: [...escalation.pack.lineage],
              },
            }
          : {}),
      },
    });
    return ok({ ...entry });
  }

  act(command: ReviewActCommand): IntentResult<ReviewActOutcome, ReviewActError> {
    if (typeof command !== "object" || command === null) {
      return err({ kind: "invalid-action" });
    }
    if (command.action !== "approve-with-edits" && command.action !== "reject") {
      return err({ kind: "invalid-action" });
    }
    if (!isReviewEntryId(command.entryId)) {
      return err({ kind: "invalid-entry-id" });
    }
    if (!isIdOf("person", command.reviewer)) {
      return err({ kind: "invalid-reviewer" });
    }
    if (command.action === "reject") {
      if (typeof command.reason !== "string" || command.reason.length === 0) {
        return err({ kind: "missing-reject-reason" });
      }
      return this.#reject(command);
    }
    if (command.edits !== undefined) {
      const editsError = validatePlanEdits(command.edits);
      if (editsError !== undefined) {
        return err(editsError);
      }
    }
    return this.#approve(command);
  }

  getEntry(entryId: ReviewEntryId): ReviewQueueEntry | undefined {
    const entry = this.#entries.get(entryId);
    return entry === undefined ? undefined : cloneEntry(entry);
  }

  listEntries(): readonly ReviewQueueEntry[] {
    return [...this.#entries.values()].map((entry) => cloneEntry(entry));
  }

  auditTrail(): readonly ReviewAuditRecord[] {
    return [...this.#audit];
  }

  // -------------------------------------------------------------------------
  // Approve: the ONLY publication path (domain transition + store + audit).
  // -------------------------------------------------------------------------

  #approve(command: ApproveWithEditsCommand): IntentResult<ApprovedReviewOutcome, ReviewActError> {
    const entry = this.#entries.get(command.entryId);
    if (entry === undefined) {
      // THE packet invariant: an approve with no matching enqueue.
      return err({ kind: "unknown-entry" });
    }
    if (entry.state !== "pending") {
      return err({ kind: "entry-not-pending" });
    }

    const planView = subjectPlanView(entry);
    const provenance = subjectModelProvenance(entry);
    const escalatedReasonCodes = subjectEscalatedReasonCodes(entry);

    // 1. Reconstruct the DRAFT domain plan (the view + state: "draft").
    const draft: MeasurementPlan = { ...planView, state: "draft" };
    if (!isMeasurementPlan(draft)) {
      return err({ kind: "invalid-plan" });
    }

    // 2. Apply the reviewer's edits (identity fields are immutable).
    const editedMetrics =
      command.edits?.metrics !== undefined ? [...command.edits.metrics] : [...draft.metrics];
    const edited: MeasurementPlan = { ...draft, metrics: editedMetrics };
    if (command.edits?.metrics !== undefined && !isMeasurementPlan(edited)) {
      // The DRAFT was valid; the EDITS broke the domain shape.
      return err({ kind: "invalid-edit" });
    }
    if (!isMeasurementPlan(edited)) {
      return err({ kind: "invalid-plan" });
    }

    // 3. THE DOMAIN TRANSITION — through the frozen guard, never a
    //    direct state write. assertPlanTransition(draft -> published)
    //    throws DomainInvariantError on any illegal transition; that can
    //    never happen for a just-validated draft, but the guard is the
    //    authority and refusal is surfaced as a typed error.
    try {
      assertPlanTransition(edited.state, "published");
    } catch (error) {
      if (error instanceof DomainInvariantError) {
        return err({ kind: "domain-transition-refused" });
      }
      throw error;
    }
    const published: PublishedMeasurementPlan = { ...edited, state: "published" };
    try {
      assertMeasurementPlan(published);
    } catch (error) {
      if (error instanceof DomainInvariantError) {
        return err({ kind: "invalid-plan" });
      }
      throw error;
    }

    // 4. Persist (the workflow is the ONLY store writer).
    const saved = this.#store.save(published);
    if (!saved.ok) {
      return err({ kind: "store-failure", reason: saved.error });
    }

    // 5. Record the review record + move the entry to approved.
    const at = this.#clock.now();
    const record: ApprovedAuditRecord = {
      kind: "approved",
      recordId: this.#ids.next(AUDIT_RECORD_ID_PREFIX),
      entryId: entry.entryId,
      at,
      reviewer: command.reviewer,
      planId: published.id,
      fromState: "draft",
      toState: "published",
      ...(command.edits !== undefined
        ? {
            edits: {
              ...(command.edits.metrics !== undefined
                ? { metrics: [...command.edits.metrics] }
                : {}),
              ...(command.edits.note !== undefined ? { note: command.edits.note } : {}),
            },
          }
        : {}),
      originalMetrics: [...draft.metrics],
      publishedMetrics: [...published.metrics],
      ...(provenance !== undefined ? { modelProvenance: provenance } : {}),
      ...(escalatedReasonCodes !== undefined
        ? { escalatedReasonCodes: [...escalatedReasonCodes] }
        : {}),
    };
    this.#audit.push(record);
    const updated: ReviewQueueEntry = { ...entry, state: "approved" };
    this.#entries.set(entry.entryId, updated);
    return ok({ kind: "approved", plan: published, record, entry: cloneEntry(updated) });
  }

  // -------------------------------------------------------------------------
  // Reject: terminal for the queue entry (no plan is ever produced).
  // -------------------------------------------------------------------------

  #reject(command: RejectCommand): IntentResult<RejectedReviewOutcome, ReviewActError> {
    const entry = this.#entries.get(command.entryId);
    if (entry === undefined) {
      // THE packet invariant: a reject with no matching enqueue.
      return err({ kind: "unknown-entry" });
    }
    if (entry.state !== "pending") {
      return err({ kind: "entry-not-pending" });
    }
    const provenance = subjectModelProvenance(entry);
    const escalatedReasonCodes = subjectEscalatedReasonCodes(entry);
    const at = this.#clock.now();
    const record: RejectedAuditRecord = {
      kind: "rejected",
      recordId: this.#ids.next(AUDIT_RECORD_ID_PREFIX),
      entryId: entry.entryId,
      at,
      reviewer: command.reviewer,
      reason: command.reason,
      ...(provenance !== undefined ? { modelProvenance: provenance } : {}),
      ...(escalatedReasonCodes !== undefined
        ? { escalatedReasonCodes: [...escalatedReasonCodes] }
        : {}),
    };
    this.#audit.push(record);
    const updated: ReviewQueueEntry = { ...entry, state: "rejected" };
    this.#entries.set(entry.entryId, updated);
    return ok({ kind: "rejected", record, entry: cloneEntry(updated) });
  }
}

// ---------------------------------------------------------------------------
// Deterministic serialization (the replay proof witness).
// ---------------------------------------------------------------------------

/**
 * Canonical serialization of the audit trail (sorted keys, Dates as
 * epoch ms, undefined dropped) — the byte-identity witness for the
 * workflow's determinism / deterministic-replay contract.
 */
export function serializeReviewAuditTrail(records: readonly ReviewAuditRecord[]): string {
  return canonicalJsonStringify(records);
}

/** Hex SHA-256 of {@link serializeReviewAuditTrail}. */
export function hashReviewAuditTrail(records: readonly ReviewAuditRecord[]): string {
  return sha256Hex(serializeReviewAuditTrail(records));
}

// ---------------------------------------------------------------------------
// Internal helpers (deny-by-default validation; PHID-safe errors).
// ---------------------------------------------------------------------------

function cloneEntry(entry: ReviewQueueEntry): ReviewQueueEntry {
  return { ...entry };
}

function subjectPlanView(entry: ReviewQueueEntry): ProposedDraftPlan {
  const subject = entry.subject;
  return subject.kind === "proposal" ? subject.proposal.candidatePlan : subject.escalation.plan;
}

function subjectModelProvenance(entry: ReviewQueueEntry): ProposalProvenance | undefined {
  const subject = entry.subject;
  return subject.kind === "proposal" ? subject.proposal.provenance : undefined;
}

function subjectEscalatedReasonCodes(entry: ReviewQueueEntry): readonly string[] | undefined {
  const subject = entry.subject;
  if (subject.kind === "escalation") {
    return subject.escalation.reasonCodes;
  }
  const safety: SafetyOutcomeView | undefined = subject.proposal.selectedSafetyOutcome;
  if (safety !== undefined && safety.kind === "ESCALATE") {
    return safety.reasonCodes;
  }
  return undefined;
}

function validateProposalSubject(proposal: unknown): ReviewEnqueueError | undefined {
  if (typeof proposal !== "object" || proposal === null) {
    return { kind: "invalid-proposal" };
  }
  const candidate = proposal as Partial<
    Record<
      | "id"
      | "intentId"
      | "personId"
      | "candidatePlan"
      | "selectedCandidateId"
      | "rationaleTrail"
      | "provenance"
      | "decisionAuthority"
      | "evidencePack"
      | "proposedAt",
      unknown
    >
  >;
  if (!isProposalId(candidate.id)) {
    return { kind: "invalid-proposal" };
  }
  if (!isIdOf("intent", candidate.intentId)) {
    return { kind: "invalid-proposal" };
  }
  if (!isIdOf("person", candidate.personId)) {
    return { kind: "invalid-proposal" };
  }
  if (typeof candidate.selectedCandidateId !== "string" || candidate.selectedCandidateId.length === 0) {
    return { kind: "invalid-proposal" };
  }
  if (
    !Array.isArray(candidate.rationaleTrail) ||
    candidate.rationaleTrail.length === 0
  ) {
    return { kind: "invalid-proposal" };
  }
  for (const step of candidate.rationaleTrail) {
    if (typeof step !== "object" || step === null) {
      return { kind: "invalid-proposal" };
    }
    const stepKind = (step as { kind?: unknown }).kind;
    if (typeof stepKind !== "string" || !isKnownRationaleKind(stepKind)) {
      return { kind: "invalid-proposal" };
    }
  }
  const last = candidate.rationaleTrail[candidate.rationaleTrail.length - 1];
  if (
    typeof last !== "object" ||
    last === null ||
    (last as { kind?: unknown }).kind !== "human-decision-required"
  ) {
    return { kind: "invalid-proposal" };
  }
  if (candidate.decisionAuthority !== "none") {
    return { kind: "invalid-proposal" };
  }
  if (candidate.provenance === undefined || typeof candidate.provenance !== "object") {
    return { kind: "invalid-proposal" };
  }
  const provenance = candidate.provenance as Partial<Record<keyof ProposalProvenance, unknown>>;
  if (
    typeof provenance.modelId !== "string" ||
    provenance.modelId.length === 0 ||
    typeof provenance.modelVersion !== "string" ||
    provenance.modelVersion.length === 0 ||
    typeof provenance.promptHash !== "string" ||
    provenance.promptHash.length === 0 ||
    typeof provenance.confidence !== "number" ||
    !Number.isFinite(provenance.confidence) ||
    provenance.confidence < 0 ||
    provenance.confidence > 1
  ) {
    return { kind: "invalid-proposal" };
  }
  if (candidate.evidencePack === undefined || typeof candidate.evidencePack !== "object") {
    return { kind: "invalid-proposal" };
  }
  const pack = candidate.evidencePack as Partial<
    Record<"packId" | "version" | "supersedesVersion" | "lineage" | "contentHash", unknown>
  >;
  const packVersion = pack.version;
  const supersedesValid =
    (packVersion === 1 && pack.supersedesVersion === undefined) ||
    (typeof packVersion === "number" &&
      packVersion >= 2 &&
      pack.supersedesVersion === packVersion - 1);
  if (
    typeof pack.packId !== "string" ||
    pack.packId.length === 0 ||
    !Number.isInteger(pack.version) ||
    (pack.version as number) < 1 ||
    !supersedesValid ||
    !Array.isArray(pack.lineage) ||
    pack.lineage.length === 0 ||
    pack.lineage.some((version) => !Number.isInteger(version) || (version as number) < 1) ||
    (pack.lineage as unknown[])[0] !== 1 ||
    (pack.lineage as unknown[])[(pack.lineage as unknown[]).length - 1] !== pack.version ||
    typeof pack.contentHash !== "string" ||
    pack.contentHash.length === 0
  ) {
    return { kind: "invalid-proposal" };
  }
  if (candidate.proposedAt === undefined || !(candidate.proposedAt instanceof Date)) {
    return { kind: "invalid-proposal" };
  }
  const planError = validateDraftPlanSubject(candidate.candidatePlan);
  if (planError !== undefined) {
    return planError;
  }
  if (candidate.candidatePlan === undefined || typeof candidate.candidatePlan !== "object") {
    return { kind: "invalid-proposal" };
  }
  if (
    (candidate.candidatePlan as { id?: unknown }).id !== candidate.selectedCandidateId
  ) {
    return { kind: "invalid-proposal" };
  }
  return undefined;
}

const KNOWN_RATIONALE_KINDS = new Set([
  "evidence-considered",
  "candidates-reviewed",
  "candidate-selected",
  "safety-context-noted",
  "human-decision-required",
]);

function isKnownRationaleKind(kind: unknown): boolean {
  return typeof kind === "string" && KNOWN_RATIONALE_KINDS.has(kind);
}

function validateDraftPlanSubject(plan: unknown): ReviewEnqueueError | undefined {
  if (typeof plan !== "object" || plan === null) {
    return { kind: "invalid-proposal" };
  }
  const candidate = plan as Partial<Record<keyof ProposedDraftPlan, unknown>> & { state?: unknown };
  if (!isIdOf("plan", candidate.id)) {
    return { kind: "invalid-proposal" };
  }
  if (!isIdOf("person", candidate.personId)) {
    return { kind: "invalid-proposal" };
  }
  if (!isIdOf("intent", candidate.intentId)) {
    return { kind: "invalid-proposal" };
  }
  if (
    !Array.isArray(candidate.metrics) ||
    candidate.metrics.length === 0 ||
    candidate.metrics.some((code) => typeof code !== "string" || code.length === 0)
  ) {
    return { kind: "invalid-proposal" };
  }
  if (!(candidate.createdAt instanceof Date) || Number.isNaN(candidate.createdAt.getTime())) {
    return { kind: "invalid-proposal" };
  }
  if (candidate.state !== undefined) {
    // A draft view carrying a lifecycle state is malformed — views are
    // never plans (the §8 encoding, enforced at the enqueue boundary).
    return { kind: "invalid-proposal" };
  }
  return undefined;
}

function validateEscalationSubject(
  escalation: unknown,
): ReviewEnqueueError | undefined {
  if (typeof escalation !== "object" || escalation === null) {
    return { kind: "invalid-escalation" };
  }
  const candidate = escalation as Partial<
    Record<"candidateId" | "reasonCodes" | "plan" | "pack", unknown>
  >;
  if (typeof candidate.candidateId !== "string" || candidate.candidateId.length === 0) {
    return { kind: "invalid-escalation" };
  }
  if (
    !Array.isArray(candidate.reasonCodes) ||
    candidate.reasonCodes.length === 0 ||
    candidate.reasonCodes.some((code) => typeof code !== "string" || code.length === 0)
  ) {
    return { kind: "invalid-escalation" };
  }
  const planError = validateDraftPlanSubject(candidate.plan);
  if (planError !== undefined) {
    return { kind: "invalid-escalation" };
  }
  if (candidate.plan === undefined || typeof candidate.plan !== "object") {
    return { kind: "invalid-escalation" };
  }
  if ((candidate.plan as { id?: unknown }).id !== candidate.candidateId) {
    return { kind: "invalid-escalation" };
  }
  if (candidate.pack !== undefined) {
    if (typeof candidate.pack !== "object" || candidate.pack === null) {
      return { kind: "invalid-escalation" };
    }
    const pack = candidate.pack as Partial<
      Record<"packId" | "version" | "supersedesVersion" | "lineage", unknown>
    >;
    const packVersion = pack.version;
    const supersedesValid =
      (packVersion === 1 && pack.supersedesVersion === undefined) ||
      (typeof packVersion === "number" &&
        packVersion >= 2 &&
        pack.supersedesVersion === packVersion - 1);
    if (
      typeof pack.packId !== "string" ||
      pack.packId.length === 0 ||
      !Number.isInteger(pack.version) ||
      (pack.version as number) < 1 ||
      !supersedesValid ||
      !Array.isArray(pack.lineage) ||
      pack.lineage.length === 0 ||
      pack.lineage.some((version) => !Number.isInteger(version) || (version as number) < 1) ||
      (pack.lineage as unknown[])[0] !== 1 ||
      (pack.lineage as unknown[])[(pack.lineage as unknown[]).length - 1] !== pack.version
    ) {
      return { kind: "invalid-escalation" };
    }
  }
  return undefined;
}

function validatePlanEdits(edits: unknown): ReviewActError | undefined {
  if (typeof edits !== "object" || edits === null) {
    return { kind: "invalid-edits" };
  }
  const candidate = edits as Partial<Record<"metrics" | "note", unknown>>;
  if (
    candidate.metrics !== undefined &&
    (!Array.isArray(candidate.metrics) ||
      candidate.metrics.length === 0 ||
      candidate.metrics.some((code) => typeof code !== "string" || code.length === 0) ||
      new Set(candidate.metrics as string[]).size !== (candidate.metrics as string[]).length)
  ) {
    return { kind: "invalid-edits" };
  }
  if (candidate.note !== undefined && (typeof candidate.note !== "string" || candidate.note.length === 0)) {
    return { kind: "invalid-edits" };
  }
  return undefined;
}
