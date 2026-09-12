/**
 * In-memory intent + plan store (M6-A, Lane B): process-local module state
 * backing the `/api/intents` and `/api/plans` route stubs — the same
 * stub-store pattern as the M4-B capture store, now with the M5-C review
 * lifecycle mirrored.
 *
 * DOMAIN-TRANSITION MIRROR (the packet's B3 invariant):
 *   - NOTHING reaches the plan store's `published` state except the review
 *     approve path, and ONLY through {@link applyPlanTransitionMirror} —
 *     the local mirror of the frozen domain `assertPlanTransition` guard
 *     (draft -> published -> active -> completed | cancelled). No other
 *     code path in the app writes a plan state; drafts live inside review
 *     entries, never in the plan store.
 *   - Rejection is TERMINAL for the entry; approval is once-only
 *     (`entry-not-pending` on repeat acts) — the M5-C semantics.
 *   - A full audit trail records every enqueue/approve/reject (ids
 *     `rvar_SYNTH-…`, creation-scoped counters).
 *
 * IDEMPOTENCY (the packet's B2 requirement): intent creation is keyed by
 * the CLIENT DRAFT ID — re-submitting the same draft id returns the SAME
 * stored intent + review entry (the M4-B store has no retry semantics yet;
 * here they are first-class because the composer keeps its draft id stable
 * across retries).
 *
 * Person-scoped by construction (single-person synthetic session, the
 * M4-B discipline): every record carries SYNTHETIC_PERSON_ID.
 */

import { GOAL_METRIC_OPTIONS } from "./catalog";
import {
  burdenSummaryOf,
  compileForSyntheticPerson,
  composeObjectiveStatement,
  evaluateCandidateSafety,
} from "./compile";
import type {
  IntentAuditRecordView,
  IntentConstraintsView,
  IntentGoalView,
  IntentPlanCandidateView,
  IntentPublishedPlanView,
  IntentRecordView,
  IntentReviewEntryView,
} from "./types";
import { SYNTHETIC_PERSON_ID } from "../capture/catalog";
import type { IntentPlanActValidated } from "./validation";

// ---------------------------------------------------------------------------
// The domain plan-state machine mirror (frozen upstream; mirrored locally).
// ---------------------------------------------------------------------------

/** Allowed plan-state transitions (the domain `assertPlanTransition` mirror). */
const ALLOWED_PLAN_TRANSITIONS: Readonly<Record<string, readonly string[]>> = {
  draft: ["published"],
  published: ["active"],
  active: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

/**
 * The domain-transition mirror: asserts a plan-state transition is legal
 * and returns the plan with the new state — the ONLY way plan states
 * change in this app. Illegal transitions throw (the domain guard treats
 * them as programming errors, not typed user-facing rejections).
 */
export function applyPlanTransitionMirror<T extends { state: string }>(
  plan: T,
  to: string,
): T & { state: string } {
  const allowed = ALLOWED_PLAN_TRANSITIONS[plan.state] ?? [];
  if (!allowed.includes(to)) {
    throw new Error(`Illegal plan transition mirror: ${plan.state} -> ${to}.`);
  }
  return { ...plan, state: to };
}

// ---------------------------------------------------------------------------
// Module state (process-local, insertion-ordered).
// ---------------------------------------------------------------------------

interface StoredReview {
  readonly entry: IntentReviewEntryView;
  readonly executable: readonly IntentPlanCandidateView[];
}

interface StoredIntent {
  readonly intent: IntentRecordView;
  readonly review: StoredReview;
}

const intentsByDraftId = new Map<string, StoredIntent>();
const entriesById = new Map<string, StoredReview>();
const auditTrail: IntentAuditRecordView[] = [];
const publishedPlans: IntentPublishedPlanView[] = [];

let intentCounter = 0;
let entryCounter = 0;
let auditCounter = 0;

function nextIntentId(): string {
  intentCounter += 1;
  return `intent_SYNTH-intent-${String(intentCounter).padStart(6, "0")}`;
}

function nextEntryId(): string {
  entryCounter += 1;
  return `revq_SYNTH-${String(entryCounter).padStart(6, "0")}`;
}

function nextAuditId(): string {
  auditCounter += 1;
  return `rvar_SYNTH-${String(auditCounter).padStart(6, "0")}`;
}

/** The catalog's concept codes are the only editable committed codes. */
function conceptCodeKnown(code: string): boolean {
  return GOAL_METRIC_OPTIONS.some((option) => option.conceptCode === code);
}

// ---------------------------------------------------------------------------
// Intent creation (idempotent by client draft id).
// ---------------------------------------------------------------------------

/** Creation input (the route already validated the body). */
export interface CreateIntentStoreInput {
  readonly draftId: string;
  readonly goal: IntentGoalView;
  readonly constraints: IntentConstraintsView;
  readonly now: Date;
}

/**
 * Creates (or idempotently replays) an intent: compiles the plan proposal,
 * enqueues the review entry, and records the enqueue audit. Same draft id
 * -> the SAME stored result (no duplicate records, no duplicate audit).
 */
export function createIntentRecord(
  input: CreateIntentStoreInput,
): StoredIntent {
  const existing = intentsByDraftId.get(input.draftId);
  if (existing !== undefined) {
    return existing;
  }

  const intentId = nextIntentId();
  const intent: IntentRecordView = {
    intentId,
    draftId: input.draftId,
    personId: SYNTHETIC_PERSON_ID,
    objective: composeObjectiveStatement(input.goal),
    goal: input.goal,
    constraints: input.constraints,
    evidencePackVersion: 1,
    createdAt: input.now.toISOString(),
  };

  const compilation = compileForSyntheticPerson({
    intentId,
    goal: input.goal,
    constraints: input.constraints,
    now: input.now,
  });

  const [primary, ...alternatives] = compilation.executable;
  const entry: IntentReviewEntryView = {
    entryId: nextEntryId(),
    intentId,
    state: "pending",
    enqueuedAt: input.now.toISOString(),
    candidate: primary ?? null,
    alternatives,
    dropped: compilation.dropped,
    safety: primary !== undefined ? evaluateCandidateSafety(primary) : null,
    burden: primary !== undefined ? burdenSummaryOf(primary) : null,
  };

  const stored: StoredIntent = { intent, review: { entry, executable: compilation.executable } };
  intentsByDraftId.set(input.draftId, stored);
  entriesById.set(entry.entryId, stored.review);
  auditTrail.push({
    kind: "enqueued",
    recordId: nextAuditId(),
    entryId: entry.entryId,
    intentId,
    at: entry.enqueuedAt,
    planId: primary?.planId ?? null,
  });
  return stored;
}

/** Resolves an intent by its client draft id (idempotent replay lookup). */
export function findIntentByDraftId(
  draftId: string,
): { intent: IntentRecordView; review: IntentReviewEntryView } | undefined {
  const stored = intentsByDraftId.get(draftId);
  return stored === undefined
    ? undefined
    : { intent: stored.intent, review: stored.review.entry };
}

// ---------------------------------------------------------------------------
// Reviewer acts (approve-with-edits | reject) — the publication path.
// ---------------------------------------------------------------------------

/** Typed reasons a reviewer act is refused (mirrors the M5-C vocabulary). */
export type IntentActError =
  | { readonly kind: "unknown-entry" }
  | { readonly kind: "entry-not-pending" }
  | { readonly kind: "invalid-edit" }
  | { readonly kind: "domain-transition-refused" };

/** A successful reviewer act result (discriminated by the act). */
export type IntentActOutcome =
  | {
      readonly ok: true;
      readonly kind: "approved";
      readonly plan: IntentPublishedPlanView;
      readonly review: IntentReviewEntryView;
      readonly audit: IntentAuditRecordView;
    }
  | {
      readonly ok: true;
      readonly kind: "rejected";
      readonly review: IntentReviewEntryView;
      readonly audit: IntentAuditRecordView;
    };

/**
 * Applies a reviewer act. Approval reconstructs the DRAFT plan, applies
 * the reviewer's edits (metric concept codes + note), and promotes it to
 * `published` ONLY through {@link applyPlanTransitionMirror}; the plan
 * store accepts PUBLISHED plans only, and the write happens only here.
 */
export function actOnReviewEntry(
  command: IntentPlanActValidated,
  now: Date,
): IntentActOutcome | { ok: false; error: IntentActError } {
  const stored = entriesById.get(command.entryId);
  if (stored === undefined) {
    return { ok: false, error: { kind: "unknown-entry" } };
  }
  const entry = stored.entry;
  if (entry.state !== "pending") {
    return { ok: false, error: { kind: "entry-not-pending" } };
  }

  if (command.action === "reject") {
    const rejectedEntry: IntentReviewEntryView = { ...entry, state: "rejected" };
    const record: IntentAuditRecordView = {
      kind: "rejected",
      recordId: nextAuditId(),
      entryId: entry.entryId,
      intentId: entry.intentId,
      at: now.toISOString(),
      reason: command.reason,
    };
    commitEntryState(rejectedEntry, stored);
    auditTrail.push(record);
    return { ok: true, kind: "rejected", review: rejectedEntry, audit: record };
  }

  const candidate = entry.candidate;
  if (candidate === null) {
    // Nothing executable was proposed — approval is impossible (the honest
    // empty state; the person must adjust the intent or reject).
    return { ok: false, error: { kind: "invalid-edit" } };
  }

  // 1. Reconstruct the DRAFT plan view and apply the reviewer's edits
  //    (identity fields are immutable; only committed codes + note edit).
  let editedMetrics: readonly string[] = candidate.metrics;
  if (command.edits?.metrics !== undefined) {
    const metrics = command.edits.metrics;
    if (metrics.length === 0 || metrics.some((code) => !conceptCodeKnown(code))) {
      return { ok: false, error: { kind: "invalid-edit" } };
    }
    editedMetrics = metrics;
  }

  // 2. THE domain transition — the only path to `published`.
  const transitioned = applyPlanTransitionMirror(
    {
      planId: candidate.planId,
      personId: candidate.personId,
      intentId: candidate.intentId,
      metrics: editedMetrics,
      metricLabel: candidate.metricLabel,
      methodId: candidate.methodId,
      methodLabel: candidate.methodLabel,
      cadencePerDay: candidate.cadencePerDay,
      state: "draft",
    },
    "published",
  );

  const publishedRecord: IntentPublishedPlanView = {
    planId: transitioned.planId,
    personId: transitioned.personId,
    intentId: transitioned.intentId,
    metrics: [...transitioned.metrics],
    metricLabel: transitioned.metricLabel,
    methodId: transitioned.methodId,
    methodLabel: transitioned.methodLabel,
    cadencePerDay: transitioned.cadencePerDay,
    state: "published",
    publishedAt: now.toISOString(),
    ...(command.edits?.note !== undefined
      ? { reviewerNote: command.edits.note }
      : {}),
  };

  // 3. Persist: the plan store accepts published plans ONLY, written ONLY
  //    here (the M5-C InMemoryPlanStore discipline, mirrored). A duplicate
  //    plan id is refused (publication is once-only, append-only).
  if (publishedPlans.some((plan) => plan.planId === publishedRecord.planId)) {
    return { ok: false, error: { kind: "invalid-edit" } };
  }
  publishedPlans.push(publishedRecord);

  const approvedEntry: IntentReviewEntryView = { ...entry, state: "approved" };
  const record: IntentAuditRecordView = {
    kind: "approved",
    recordId: nextAuditId(),
    entryId: entry.entryId,
    intentId: entry.intentId,
    at: publishedRecord.publishedAt,
    planId: publishedRecord.planId,
    fromState: "draft",
    toState: "published",
    originalMetrics: [...candidate.metrics],
    publishedMetrics: [...publishedRecord.metrics],
    ...(command.edits?.note !== undefined
      ? { reviewerNote: command.edits.note }
      : {}),
  };
  commitEntryState(approvedEntry, stored);
  auditTrail.push(record);
  return {
    ok: true,
    kind: "approved",
    plan: publishedRecord,
    review: approvedEntry,
    audit: record,
  };
}

/** Writes an acted entry state back into every index (single source). */
function commitEntryState(next: IntentReviewEntryView, stored: StoredReview): void {
  const updated: StoredReview = { ...stored, entry: next };
  entriesById.set(next.entryId, updated);
  for (const [draftId, record] of intentsByDraftId.entries()) {
    if (record.review.entry.entryId === next.entryId) {
      intentsByDraftId.set(draftId, { ...record, review: updated });
    }
  }
}

// ---------------------------------------------------------------------------
// Read models.
// ---------------------------------------------------------------------------

/** All stored intents (insertion order), with their review entries. */
export function listIntents(): readonly {
  intent: IntentRecordView;
  review: IntentReviewEntryView;
}[] {
  return [...intentsByDraftId.values()].map((stored) => ({
    intent: stored.intent,
    review: stored.review.entry,
  }));
}

/** The pending review entries (insertion order). */
export function listPendingReviews(): readonly IntentReviewEntryView[] {
  return listIntents()
    .map((record) => record.review)
    .filter((entry) => entry.state === "pending");
}

/** The PUBLISHED plan store (insertion order) — the review stub's only writer. */
export function listPublishedPlans(): readonly IntentPublishedPlanView[] {
  return publishedPlans.map((plan) => ({ ...plan, metrics: [...plan.metrics] }));
}

/** The append-only audit trail (chronological order is the record order). */
export function listAuditTrail(): readonly IntentAuditRecordView[] {
  return [...auditTrail];
}

/** Resets the store (test-only; deterministic re-seeding of suites). */
export function resetIntentStore(): void {
  intentsByDraftId.clear();
  entriesById.clear();
  auditTrail.length = 0;
  publishedPlans.length = 0;
  intentCounter = 0;
  entryCounter = 0;
  auditCounter = 0;
}
