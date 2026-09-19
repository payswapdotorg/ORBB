/**
 * The timeline store ports (A49, part 2) — the injected persistence
 * seams over which {@link PatientTimelineService} assembles a person's
 * longitudinal timeline.
 *
 * Interface-driven, ZERO `@orbb/db` imports (binding): the port
 * INTERFACES are defined here; db adapters arrive in a later integration
 * packet (handoff recorded in README.md). The in-memory reference stores
 * (`inMemory.ts`) are the deterministic doubles used by tests and by the
 * future Lane-C harness.
 *
 * The observation port is CANONICAL-VIEW-SHAPED (the recorded assumption
 * at the heart of the reconciliation mirror): it returns the timeline's
 * `CanonicalObservationRecord` — the canonical head observation of a
 * same-metric set PLUS the per-source provenance of every original in
 * the set. This is exactly the output shape of the @orbb/measurement
 * `ReconciliationService` doctrine (winner + loser + canonical
 * replacement, per-source provenance records, nothing discarded), so the
 * timeline consumes reconciliation outputs instead of re-deriving set
 * membership from observation content (which would be an invented,
 * fragile heuristic). The db adapter reconstructs the sets from the
 * persisted supersession graph — handoff recorded.
 */
import {
  DomainInvariantError,
  isHealthIntent,
  isObservation,
  isIdOf,
  isPersonId,
  type HealthIntent,
  type Observation,
  type PersonId,
} from "@orbb/domain";
import type { MeasurementTask } from "@orbb/measurement";
import type {
  TimelineObservationSourceProvenance,
  TimelineObservationSourceRole,
} from "./entries.js";
import { isTimelineTaskState } from "./entries.js";

// ---------------------------------------------------------------------------
// Window bounds.
// ---------------------------------------------------------------------------

/**
 * The timeline window bounds: `from`/`to` are INCLUSIVE UTC-millisecond
 * bounds on an entry's `occurredAt`. Undefined means unbounded on that
 * side. A window with `from` after `to` is rejected by the service
 * (typed {@link import("./errors.js").TimelineError}).
 */
export interface TimelineWindowBounds {
  /** Inclusive lower bound on occurredAt; undefined = unbounded below. */
  readonly from?: Date;
  /** Inclusive upper bound on occurredAt; undefined = unbounded above. */
  readonly to?: Date;
}

function isTimestamp(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

export function isTimelineWindowBounds(value: unknown): value is TimelineWindowBounds {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<Record<keyof TimelineWindowBounds, unknown>>;
  if (candidate.from !== undefined && !isTimestamp(candidate.from)) {
    return false;
  }
  if (candidate.to !== undefined && !isTimestamp(candidate.to)) {
    return false;
  }
  return true;
}

/** Pure guard: asserts a well-formed {@link TimelineWindowBounds} value. */
export function assertTimelineWindowBounds(candidate: unknown): asserts candidate is TimelineWindowBounds {
  if (!isTimelineWindowBounds(candidate)) {
    throw new DomainInvariantError(
      "Invalid timeline window bounds: expected { from?, to? } with valid Date bounds (inclusive, UTC ms).",
    );
  }
}

// ---------------------------------------------------------------------------
// The canonical observation record (the reconciliation-doctrine port shape).
// ---------------------------------------------------------------------------

/**
 * One person's same-metric observation set as the timeline consumes it:
 * the CANONICAL domain observation (the single current value — the
 * ReconciliationService replacement after a reconciliation, the plain
 * observation otherwise) plus per-source provenance for EVERY original
 * in the set (never discarded).
 *
 * Invariants (asserted by {@link assertCanonicalObservationRecord}):
 *   - the canonical observation is structurally well-formed (kernel
 *     guard) and is NOT in the terminal `superseded` validation state
 *     (it is the head of its set by definition);
 *   - `sources` is non-empty with exactly one `canonical-source` first
 *     and the `superseded-source` originals after it (id-ascending);
 *   - when the canonical observation carries `supersedesId`, that id is
 *     among the superseded sources.
 */
export interface CanonicalObservationRecord {
  readonly canonical: Observation;
  readonly sources: readonly TimelineObservationSourceProvenance[];
}

function isObservationSourceProvenance(
  value: unknown,
): value is TimelineObservationSourceProvenance {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<Record<keyof TimelineObservationSourceProvenance, unknown>>;
  if (!isIdOf("observation", candidate.observationId)) {
    return false;
  }
  if (!isIdOf("source", candidate.sourceId)) {
    return false;
  }
  if (typeof candidate.methodId !== "string" || candidate.methodId.length === 0) {
    return false;
  }
  if (typeof candidate.evidenceLabel !== "string") {
    return false;
  }
  if (candidate.quality !== undefined && typeof candidate.quality !== "number") {
    return false;
  }
  if (!isIdOf("provenance", candidate.provenanceId)) {
    return false;
  }
  if (
    typeof candidate.role !== "string" ||
    !(["canonical-source", "superseded-source"] as const).includes(
      candidate.role as TimelineObservationSourceRole,
    )
  ) {
    return false;
  }
  return true;
}

export function isCanonicalObservationRecord(
  value: unknown,
): value is CanonicalObservationRecord {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<Record<keyof CanonicalObservationRecord, unknown>>;
  if (!isObservation(candidate.canonical)) {
    return false;
  }
  if (!Array.isArray(candidate.sources) || candidate.sources.length === 0) {
    return false;
  }
  for (const source of candidate.sources) {
    if (!isObservationSourceProvenance(source)) {
      return false;
    }
  }
  return true;
}

/**
 * Pure guard: asserts a well-formed {@link CanonicalObservationRecord}
 * (kernel discipline — malformed port data is a data-integrity failure).
 * The port is LIBERAL about source ORDER (the assembly normalizes:
 * canonical-source first, superseded id-ascending) and STRICT about
 * everything else: exactly one `canonical-source`, the rest
 * `superseded-source`, no repeated observation ids, and the canonical
 * head's `supersedesId` (when present) among the superseded sources.
 * Throws {@link DomainInvariantError}; received values are never echoed.
 */
export function assertCanonicalObservationRecord(
  candidate: unknown,
): asserts candidate is CanonicalObservationRecord {
  if (!isCanonicalObservationRecord(candidate)) {
    throw new DomainInvariantError(
      "Invalid canonical observation record: expected { canonical, sources } with a well-formed domain Observation as the canonical head and a non-empty per-source provenance list { observationId, sourceId, methodId, evidenceLabel, quality?, provenanceId, role }.",
    );
  }
  const record = candidate;
  if (record.canonical.validationState === "superseded") {
    throw new DomainInvariantError(
      "Invalid canonical observation record: the canonical head must not be in the terminal superseded validation state (a superseded observation is provenance, never the head of its set).",
    );
  }
  const sources = record.sources;
  let canonicalSources = 0;
  const seenIds = new Set<string>();
  const supersededIds = new Set<string>();
  for (const source of sources) {
    if (source.role === "canonical-source") {
      canonicalSources += 1;
    } else {
      supersededIds.add(source.observationId);
    }
    if (seenIds.has(source.observationId)) {
      throw new DomainInvariantError(
        "Invalid canonical observation record: sources must not repeat an observation id.",
      );
    }
    seenIds.add(source.observationId);
  }
  if (canonicalSources !== 1) {
    throw new DomainInvariantError(
      "Invalid canonical observation record: sources must contain exactly one canonical-source.",
    );
  }
  const supersedesId = record.canonical.supersedesId;
  if (supersedesId !== undefined && !supersededIds.has(supersedesId)) {
    throw new DomainInvariantError(
      "Invalid canonical observation record: the canonical head's supersedesId must appear among the superseded sources.",
    );
  }
}

// ---------------------------------------------------------------------------
// The task record guard (MeasurementTask is a TYPE-ONLY import).
// ---------------------------------------------------------------------------

/**
 * Pure guard over a port-supplied `MeasurementTask` (the type is imported
 * TYPE-ONLY from @orbb/measurement, so the structural checks use the
 * kernel id guards plus local field checks — no measurement runtime
 * import). Throws {@link DomainInvariantError}; values never echoed.
 */
export function assertTimelineTaskRecord(candidate: unknown): asserts candidate is MeasurementTask {
  if (typeof candidate !== "object" || candidate === null) {
    throw new DomainInvariantError(
      "Invalid timeline task record: expected a well-formed MeasurementTask { id, planId, personId, metricId, conceptCode, methodOrder, window, state, createdAt, rollCount }.",
    );
  }
  const task = candidate as Partial<Record<keyof MeasurementTask, unknown>>;
  if (!isIdOf("task", task.id)) {
    throw new DomainInvariantError(
      "Invalid timeline task record: expected a canonical task_ id.",
    );
  }
  if (!isPersonId(task.personId)) {
    throw new DomainInvariantError(
      "Invalid timeline task record: expected a canonical prsn_ person id.",
    );
  }
  if (!isIdOf("plan", task.planId)) {
    throw new DomainInvariantError(
      "Invalid timeline task record: expected a canonical plan_ id.",
    );
  }
  if (typeof task.metricId !== "string" || task.metricId.length === 0) {
    throw new DomainInvariantError(
      "Invalid timeline task record: expected a non-empty metric id.",
    );
  }
  if (typeof task.conceptCode !== "string" || task.conceptCode.length === 0) {
    throw new DomainInvariantError(
      "Invalid timeline task record: expected a non-empty concept code.",
    );
  }
  if (!Array.isArray(task.methodOrder)) {
    throw new DomainInvariantError(
      "Invalid timeline task record: expected a method order list.",
    );
  }
  for (const methodId of task.methodOrder) {
    if (typeof methodId !== "string" || methodId.length === 0) {
      throw new DomainInvariantError(
        "Invalid timeline task record: expected non-empty method codes in the method order.",
      );
    }
  }
  if (typeof task.window !== "object" || task.window === null) {
    throw new DomainInvariantError(
      "Invalid timeline task record: expected a measurement window { sequence, startsAt, endsAt }.",
    );
  }
  const window = task.window as Partial<Record<"sequence" | "startsAt" | "endsAt", unknown>>;
  if (
    typeof window.sequence !== "number" ||
    !Number.isInteger(window.sequence) ||
    window.sequence < 0
  ) {
    throw new DomainInvariantError(
      "Invalid timeline task record: expected a non-negative integer window sequence.",
    );
  }
  if (!isTimestamp(window.startsAt) || !isTimestamp(window.endsAt)) {
    throw new DomainInvariantError(
      "Invalid timeline task record: expected valid window timestamps.",
    );
  }
  if (!(window.startsAt.getTime() < window.endsAt.getTime())) {
    throw new DomainInvariantError(
      "Invalid timeline task record: expected a window whose startsAt precedes its endsAt.",
    );
  }
  if (!isTimelineTaskState(task.state)) {
    throw new DomainInvariantError(
      "Invalid timeline task record: expected a task state of open|completed.",
    );
  }
  if (
    typeof task.rollCount !== "number" ||
    !Number.isInteger(task.rollCount) ||
    task.rollCount < 0
  ) {
    throw new DomainInvariantError(
      "Invalid timeline task record: expected a non-negative integer roll count.",
    );
  }
}

// ---------------------------------------------------------------------------
// The three store ports.
// ---------------------------------------------------------------------------

/**
 * The observation plane of the timeline: canonical same-metric
 * observation sets for a person within inclusive window bounds (the
 * canonical head's `effectiveAt` is the set's timeline instant).
 */
export interface ObservationTimelineStore {
  findByPerson(
    personId: PersonId,
    bounds: TimelineWindowBounds,
  ): Promise<readonly CanonicalObservationRecord[]>;
}

/**
 * The task plane of the timeline: the person's measurement tasks within
 * inclusive window bounds (the CURRENT window's due instant `endsAt` is
 * the task's timeline instant).
 */
export interface TaskTimelineStore {
  findByPerson(
    personId: PersonId,
    bounds: TimelineWindowBounds,
  ): Promise<readonly MeasurementTask[]>;
}

/**
 * The intent plane of the timeline: the person's health intents within
 * inclusive window bounds (`createdAt` is the intent's timeline
 * instant).
 */
export interface IntentTimelineStore {
  findByPerson(
    personId: PersonId,
    bounds: TimelineWindowBounds,
  ): Promise<readonly HealthIntent[]>;
}

/** Pure guard over a port-supplied `HealthIntent` (kernel guard). */
export function assertTimelineIntentRecord(candidate: unknown): asserts candidate is HealthIntent {
  if (!isHealthIntent(candidate)) {
    throw new DomainInvariantError(
      "Invalid timeline intent record: expected a well-formed HealthIntent { id, personId, objective, state, createdAt, evidencePackVersion?, planId? }.",
    );
  }
}
