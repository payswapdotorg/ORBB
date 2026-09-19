/**
 * The assembly service (A49, part 2) — `PatientTimelineService`: a pure,
 * deterministic, care-team-authorized longitudinal assembly of a
 * person's health record into an ordered, paginated,
 * provenance-preserving timeline.
 *
 * Assembly law (all mirrored from the frozen architecture and recorded
 * in README.md):
 *
 *   - ORDERING: `occurredAt` DESCENDING with the domain-id tiebreak
 *     ASCENDING — a TOTAL order, hence deterministic and stable under
 *     any permutation of the input stream;
 *   - WINDOWING: `from`/`to` bounds are INCLUSIVE UTC-millisecond bounds
 *     on an entry's `occurredAt` (both ends included — boundary-proven
 *     by tests); a window with `from` after `to` fails closed with a
 *     typed error;
 *   - RECONCILIATION: same-metric observation sets present ONE canonical
 *     entry with the per-source provenance summary — the
 *     @orbb/measurement doctrine mirrored exactly (data never
 *     discarded; superseded sources stay visible as provenance);
 *   - CURSOR PAGINATION: the @orbb/db cursor law mirrored in-package —
 *     opaque base64url anchor tuple, page-stable under insertions before
 *     the anchor (position anchoring, never offsets), forward-only,
 *     fail-closed typed errors on malformed cursors, honest
 *     `truncated` flag (the limit+1 probe).
 *
 * Authorization happens FIRST (the A49 exit-criterion gate): the
 * subject's data is read from the store ports ONLY after the REAL
 * `evaluateCareTeamAccess` ALLOWs `timeline:read` — a denial reads
 * NOTHING and returns the typed all-or-nothing denial.
 *
 * Interface-driven throughout: stores, clock, and id-factory are
 * injected ports (Clock/IdFactory are TYPE-ONLY imports from
 * @orbb/testkit — the same seam discipline as @orbb/measurement); ZERO
 * @orbb/db imports; ZERO external runtime dependencies.
 */
import { isPersonId, type HealthIntent, type ObservationId, type PersonId } from "@orbb/domain";
import type { MeasurementTask } from "@orbb/measurement";
import type { Clock, IdFactory } from "@orbb/testkit";
import { TimelineError } from "./errors.js";
import type {
  IntentTimelineEntry,
  ObservationTimelineEntry,
  TaskTimelineEntry,
  TimelineEntry,
  TimelinePage,
  TimelineObservationSourceProvenance,
} from "./entries.js";
import { assertTimelineEntry } from "./entries.js";
import {
  applyTimelineCursorAnchor,
  clampTimelinePageLimit,
  compareTimelineEntries,
  pageTimelineOf,
  parseTimelineCursor,
} from "./cursor.js";
import {
  assertCanonicalObservationRecord,
  assertTimelineIntentRecord,
  assertTimelineTaskRecord,
  type CanonicalObservationRecord,
  type IntentTimelineStore,
  type ObservationTimelineStore,
  type TaskTimelineStore,
  type TimelineWindowBounds,
} from "./ports.js";
import {
  evaluateTimelineAccess,
  type PractitionerTimelineContext,
  type TimelineAccessAudit,
  type TimelineReadDenied,
  type TimelineReadGranted,
  type TimelineReadOutcome,
} from "./authorization.js";
import type { TimelineEventEnvelope } from "./events.js";
import {
  assertTimelineEventEnvelope,
  isTimelineEventId,
  type TimelineEventId,
} from "./events.js";

// ---------------------------------------------------------------------------
// The query.
// ---------------------------------------------------------------------------

/**
 * A timeline read query: inclusive `from`/`to` window bounds on
 * `occurredAt` (UTC ms), an opaque forward-only continuation cursor, and
 * a page limit (1..200; default 50).
 */
export interface TimelineQuery {
  /** Inclusive lower bound on occurredAt; undefined = unbounded below. */
  readonly from?: Date;
  /** Inclusive upper bound on occurredAt; undefined = unbounded above. */
  readonly to?: Date;
  /** Opaque cursor from a previous page's `nextCursor`. */
  readonly cursor?: string;
  /** Page size (integer 1..200); default 50. */
  readonly limit?: number;
}

function isTimestamp(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

/**
 * Structural validation of the query SHAPE (fail-closed, typed):
 * bounds must be valid Dates (when present), the cursor a string (when
 * present), the limit a number (when present). Window ORDER, limit
 * RANGE, and cursor DECODING are validated after authorization (a
 * denied clinician never triggers cursor work at all).
 */
function assertQueryShape(query: TimelineQuery): void {
  if (typeof query !== "object" || query === null) {
    throw new TimelineError(
      "invalid-request",
      "Invalid timeline query: expected { from?, to?, cursor?, limit? }.",
    );
  }
  if (query.from !== undefined && !isTimestamp(query.from)) {
    throw new TimelineError(
      "invalid-request",
      "Invalid timeline query: `from` must be a valid Date (inclusive UTC-ms bound).",
    );
  }
  if (query.to !== undefined && !isTimestamp(query.to)) {
    throw new TimelineError(
      "invalid-request",
      "Invalid timeline query: `to` must be a valid Date (inclusive UTC-ms bound).",
    );
  }
  if (query.cursor !== undefined && typeof query.cursor !== "string") {
    throw new TimelineError(
      "invalid-request",
      "Invalid timeline query: `cursor` must be an opaque string produced by this API.",
    );
  }
  if (
    query.limit !== undefined &&
    (typeof query.limit !== "number" || !Number.isFinite(query.limit))
  ) {
    throw new TimelineError(
      "invalid-limit",
      "Invalid timeline page limit: expected an integer between 1 and 200.",
    );
  }
}

/** Window-order validation: `from` must not be after `to`. */
function assertWindowOrder(bounds: TimelineWindowBounds): void {
  if (
    bounds.from !== undefined &&
    bounds.to !== undefined &&
    bounds.from.getTime() > bounds.to.getTime()
  ) {
    throw new TimelineError(
      "invalid-window",
      "Invalid timeline window: the inclusive `from` bound must not be after the `to` bound.",
    );
  }
}

// ---------------------------------------------------------------------------
// Record → entry mapping (pure, deterministic).
// ---------------------------------------------------------------------------

/**
 * Maps one canonical observation record to its timeline entry — the
 * ReconciliationService doctrine mirror: ONE entry per same-metric set,
 * the canonical head's typed value, the supersession summary, and the
 * per-source provenance for EVERY original (sources normalized:
 * canonical-source first, superseded id-ascending).
 */
function observationEntry(
  personId: PersonId,
  record: CanonicalObservationRecord,
): ObservationTimelineEntry {
  assertCanonicalObservationRecord(record);
  const canonical = record.canonical;
  const sources = normalizeSources(record.sources);
  const supersededIds = sources
    .filter((source) => source.role === "superseded-source")
    .map((source) => source.observationId)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)) as ObservationId[];
  const entry: ObservationTimelineEntry = {
    kind: "observation",
    id: canonical.id,
    personId,
    occurredAt: new Date(canonical.effectiveAt.getTime()),
    provenance: {
      sourceId: canonical.sourceId,
      methodId: canonical.methodId,
    },
    conceptCode: canonical.conceptCode,
    value: canonical.value,
    unit: canonical.unit,
    effectiveAt: new Date(canonical.effectiveAt.getTime()),
    methodId: canonical.methodId,
    validationState: canonical.validationState,
    evidenceLabel: canonical.evidenceLabel,
    ...(canonical.quality !== undefined ? { quality: canonical.quality } : {}),
    supersession: {
      ...(canonical.supersedesId !== undefined ? { supersedesId: canonical.supersedesId } : {}),
      supersededIds,
      supersededCount: supersededIds.length,
    },
    sources,
  };
  assertTimelineEntry(entry);
  return entry;
}

/**
 * Normalizes the per-source provenance order: exactly the one
 * canonical-source first, then the superseded originals id-ascending
 * (deterministic serialization; the entry guard enforces the result).
 */
function normalizeSources(
  sources: readonly TimelineObservationSourceProvenance[],
): readonly TimelineObservationSourceProvenance[] {
  const canonicalSources = sources.filter((source) => source.role === "canonical-source");
  const supersededSources = sources
    .filter((source) => source.role === "superseded-source")
    .sort((a, b) =>
      a.observationId < b.observationId ? -1 : a.observationId > b.observationId ? 1 : 0,
    );
  if (canonicalSources.length !== 1) {
    throw new TimelineError(
      "invalid-request",
      "Invalid canonical observation record: sources must contain exactly one canonical-source.",
    );
  }
  return [...canonicalSources, ...supersededSources];
}

/** Maps one measurement task record to its window/state summary entry. */
function taskEntry(personId: PersonId, task: MeasurementTask): TaskTimelineEntry {
  assertTimelineTaskRecord(task);
  const entry: TaskTimelineEntry = {
    kind: "task",
    id: task.id,
    personId,
    // The task's domain timestamp: the CURRENT window's due instant.
    occurredAt: new Date(task.window.endsAt.getTime()),
    provenance: {},
    planId: task.planId,
    metricId: task.metricId,
    conceptCode: task.conceptCode,
    methodOrder: [...task.methodOrder],
    window: {
      sequence: task.window.sequence,
      startsAt: new Date(task.window.startsAt.getTime()),
      endsAt: new Date(task.window.endsAt.getTime()),
    },
    state: task.state,
    rollCount: task.rollCount,
  };
  assertTimelineEntry(entry);
  return entry;
}

/** Maps one health intent record to its state summary entry (NO objective). */
function intentEntry(personId: PersonId, intent: HealthIntent): IntentTimelineEntry {
  assertTimelineIntentRecord(intent);
  const entry: IntentTimelineEntry = {
    kind: "intent",
    id: intent.id,
    personId,
    // The intent's domain timestamp: creation.
    occurredAt: new Date(intent.createdAt.getTime()),
    provenance: {},
    state: intent.state,
    ...(intent.evidencePackVersion !== undefined
      ? { evidencePackVersion: intent.evidencePackVersion }
      : {}),
    ...(intent.planId !== undefined ? { planId: intent.planId } : {}),
  };
  assertTimelineEntry(entry);
  return entry;
}

/** Inclusive window filter over an entry's occurredAt. */
function withinBounds(entry: TimelineEntry, bounds: TimelineWindowBounds): boolean {
  const at = entry.occurredAt.getTime();
  if (bounds.from !== undefined && at < bounds.from.getTime()) {
    return false;
  }
  if (bounds.to !== undefined && at > bounds.to.getTime()) {
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// The service.
// ---------------------------------------------------------------------------

/** Constructor deps (all injectable ports; no db imports anywhere). */
export interface PatientTimelineServiceDeps {
  readonly observations: ObservationTimelineStore;
  readonly tasks: TaskTimelineStore;
  readonly intents: IntentTimelineStore;
  /** Injected clock — owns the access-evaluation instant (never wall-clock). */
  readonly clock: Clock;
  /** Injected id factory — mints the TIMELINE_READ event ids. */
  readonly ids: IdFactory;
}

/**
 * The patient timeline assembly service. Pure and deterministic given
 * (subject, query, context, store contents, clock, id factory): every
 * timestamp comes from the domain records or the injected clock; every
 * id from the domain records or the injected factory.
 */
export class PatientTimelineService {
  readonly #observations: ObservationTimelineStore;
  readonly #tasks: TaskTimelineStore;
  readonly #intents: IntentTimelineStore;
  readonly #clock: Clock;
  readonly #ids: IdFactory;

  constructor(deps: PatientTimelineServiceDeps) {
    this.#observations = deps.observations;
    this.#tasks = deps.tasks;
    this.#intents = deps.intents;
    this.#clock = deps.clock;
    this.#ids = deps.ids;
  }

  /**
   * Assembles a page of the SUBJECT person's longitudinal timeline for
   * an authorized clinician — the M7 exit-criterion surface.
   *
   * Order of operations (recorded; tests pin it):
   *   1. structural validation of subject / context / query SHAPE
   *      (malformed input fails closed with typed errors — garbage is
   *      a caller bug, never a silent default);
   *   2. the REAL care-team evaluation of `timeline:read` at the
   *      injected clock instant — DENY returns the typed all-or-nothing
   *      denial WITHOUT reading any store port (no partial timeline,
   *      ever);
   *   3. query SEMANTICS validation (window order, limit range, cursor
   *      decoding — fail-closed typed errors);
   *   4. assembly: load the three planes, map to entries, order
   *      deterministically, window-filter inclusively, apply the cursor
   *      anchor, slice the page with the limit+1 probe (honest
   *      truncation);
   *   5. every outcome (granted and denied alike) carries the
   *      access-decision audit record and the TIMELINE_READ event
   *      (persistence/outbox handoff recorded).
   */
  async assembleTimeline(
    subject: PersonId,
    query: TimelineQuery,
    context: PractitionerTimelineContext,
  ): Promise<TimelineReadOutcome> {
    if (!isPersonId(subject)) {
      throw new TimelineError(
        "invalid-request",
        "Invalid timeline subject: expected a canonical prsn_ person id.",
      );
    }
    if (
      typeof context !== "object" ||
      context === null ||
      typeof context.purpose !== "string" ||
      context.purpose.length === 0 ||
      context.snapshot === undefined
    ) {
      throw new TimelineError(
        "invalid-request",
        "Invalid practitioner context: expected { practitionerId, purpose, snapshot } with a non-empty purpose and an A45 care-team snapshot.",
      );
    }
    assertQueryShape(query);

    // THE GATE: the REAL evaluateCareTeamAccess with the frozen scope.
    const at = this.#clock.now();
    const { decision, audit } = evaluateTimelineAccess(subject, context, at);
    const event = this.#timelineReadEvent(subject, context, audit);

    if (decision.kind === "DENY") {
      const denied: TimelineReadDenied = {
        kind: "denied",
        reason: decision.reason,
        evaluatedAt: decision.evaluatedAt,
        audit,
        event,
      };
      return denied;
    }

    // Query semantics (after authorization: a denied clinician never
    // triggers window/limit/cursor work at all).
    assertWindowOrder(query);
    const limit = clampTimelinePageLimit(query.limit);
    const anchor =
      query.cursor !== undefined ? parseTimelineCursor(query.cursor) : undefined;
    const bounds: TimelineWindowBounds = {
      ...(query.from !== undefined ? { from: new Date(query.from.getTime()) } : {}),
      ...(query.to !== undefined ? { to: new Date(query.to.getTime()) } : {}),
    };

    // Assembly: load the subject's three planes (subject data only).
    const [observationRecords, taskRecords, intentRecords] = await Promise.all([
      this.#observations.findByPerson(subject, bounds),
      this.#tasks.findByPerson(subject, bounds),
      this.#intents.findByPerson(subject, bounds),
    ]);

    const entries: TimelineEntry[] = [
      ...observationRecords.map((record) => observationEntry(subject, record)),
      ...taskRecords.map((task) => taskEntry(subject, task)),
      ...intentRecords.map((intent) => intentEntry(subject, intent)),
    ];

    // Deterministic total order (permutation-invariant by totality).
    entries.sort(compareTimelineEntries);

    // Inclusive window filter (authoritative in the service — the ports
    // pre-filter as an optimization seam, and the service re-asserts).
    const windowed = entries.filter((entry) => withinBounds(entry, bounds));

    // Forward-only cursor anchor application.
    const anchored = anchor !== undefined ? applyTimelineCursorAnchor(windowed, anchor) : windowed;

    // Honest truncation via the limit+1 probe.
    const paged = pageTimelineOf(anchored, limit);
    const page: TimelinePage = {
      entries: paged.entries,
      ...(paged.nextCursor !== undefined ? { nextCursor: paged.nextCursor } : {}),
      truncated: paged.truncated,
    };

    const granted: TimelineReadGranted = {
      kind: "granted",
      page,
      grantId: decision.grantId,
      ...(decision.careTeamRole !== undefined ? { careTeamRole: decision.careTeamRole } : {}),
      evaluatedAt: decision.evaluatedAt,
      audit,
      event,
    };
    return granted;
  }

  /**
   * Builds the TIMELINE_READ access-decision event for every outcome
   * (ALLOW and DENY alike): the §11 envelope with the practitioner as
   * actor, the subject, the injected-clock instant, and an id minted
   * from the injected factory. Payloads are deliberately not modeled
   * (the persistence lane attaches the outbox payload — handoff
   * recorded); the envelope carries labels and ids only.
   */
  #timelineReadEvent(
    subject: PersonId,
    context: PractitionerTimelineContext,
    audit: TimelineAccessAudit,
  ): TimelineEventEnvelope {
    const eventId = this.#ids.next("tevt") as TimelineEventId;
    if (!isTimelineEventId(eventId)) {
      // Fail closed: an id factory that violates the canonical grammar
      // is an integration bug, never a silently-degraded event.
      throw new TimelineError(
        "invalid-request",
        "Internal invariant violation: the injected id factory produced a non-canonical timeline event id — failing closed.",
      );
    }
    const event: TimelineEventEnvelope = {
      eventId,
      type: "TIMELINE_READ",
      version: 1,
      occurredAt: new Date(audit.at.getTime()),
      actor: context.practitionerId,
      subject,
      payloadSchemaVersion: "1.0.0",
    };
    assertTimelineEventEnvelope(event);
    return event;
  }
}
