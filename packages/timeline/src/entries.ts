/**
 * The timeline entry model (A49, part 1) — a FROZEN discriminated union
 * over the three longitudinal record kinds a person's timeline assembles:
 *
 *   - `observation` — the CANONICAL view of a same-metric observation set
 *     (the @orbb/measurement ReconciliationService doctrine: two
 *     same-metric observations from different sources reconcile into ONE
 *     canonical view with per-source provenance; data is never discarded
 *     — superseded sources stay visible as provenance);
 *   - `task`        — a MeasurementTask window/state summary;
 *   - `intent`     — a HealthIntent state summary.
 *
 * EVERY entry carries: the domain id, `personId`, `occurredAt` (the
 * domain timestamp — `effectiveAt` for observations, the window due
 * instant for tasks, `createdAt` for intents), an entry-kind tag, and a
 * provenance summary (`sourceId`/`methodId` where applicable).
 *
 * PHI DISCIPLINE (binding): NO free-text content beyond typed bounded
 * labels; NO PHI beyond typed shapes. The domain `HealthIntent.objective`
 * (free text) is deliberately NOT mapped; observation values are the
 * typed domain union (string | number | boolean) exactly as the kernel
 * models them. SYNTH fixtures only, in tests.
 */
import {
  DomainInvariantError,
  isEvidenceLabel,
  isIdOf,
  isIntentState,
  isObservationValidationState,
  isPersonId,
  isQualityScore,
  type EvidenceLabel,
  type IntentId,
  type IntentState,
  type ObservationId,
  type ObservationValue,
  type ObservationValidationState,
  type PersonId,
  type PlanId,
  type QualityScore,
  type SourceId,
  type ProvenanceId,
  type TaskId,
} from "@orbb/domain";

// ---------------------------------------------------------------------------
// The frozen entry-kind vocabulary.
// ---------------------------------------------------------------------------

/** The frozen timeline entry kinds (one per assembled record family). */
export const TIMELINE_ENTRY_KINDS = ["observation", "task", "intent"] as const;

export type TimelineEntryKind = (typeof TIMELINE_ENTRY_KINDS)[number];

export function isTimelineEntryKind(value: unknown): value is TimelineEntryKind {
  return (
    typeof value === "string" && (TIMELINE_ENTRY_KINDS as readonly string[]).includes(value)
  );
}

// ---------------------------------------------------------------------------
// Task lifecycle states (timeline-local mirror of the measurement
// scheduler's frozen vocabulary — the timeline imports MeasurementTask
// TYPES ONLY from @orbb/measurement, so the state guard is local).
// ---------------------------------------------------------------------------

/** MeasurementTask lifecycle states (mirrors @orbb/measurement TASK_STATES). */
export const TIMELINE_TASK_STATES = ["open", "completed"] as const;

export type TimelineTaskState = (typeof TIMELINE_TASK_STATES)[number];

export function isTimelineTaskState(value: unknown): value is TimelineTaskState {
  return (
    typeof value === "string" && (TIMELINE_TASK_STATES as readonly string[]).includes(value)
  );
}

// ---------------------------------------------------------------------------
// Common entry fields (the contract every entry carries).
// ---------------------------------------------------------------------------

/**
 * Provenance summary carried by EVERY entry: `sourceId`/`methodId` where
 * applicable. Observation entries carry the canonical source/method; task
 * and intent entries carry neither (a task's methods are its ordered
 * method chain — already a typed field; an intent has no source).
 */
export interface TimelineProvenanceSummary {
  /** The measurement source of the canonical observation, when there is one. */
  readonly sourceId?: SourceId;
  /** The opaque MeasurementMethod code of the canonical observation, when there is one. */
  readonly methodId?: string;
}

/** Fields shared by every timeline entry (the A49 common contract). */
export interface TimelineEntryCommonFields {
  /** The person whose timeline this entry belongs to (the SUBJECT). */
  readonly personId: PersonId;
  /**
   * The domain timestamp of the entry: `effectiveAt` for observations,
   * the window due instant (`window.endsAt`) for tasks, `createdAt` for
   * intents (recorded assumptions — see README).
   */
  readonly occurredAt: Date;
  /** Provenance summary (sourceId/methodId where applicable). */
  readonly provenance: TimelineProvenanceSummary;
}

// ---------------------------------------------------------------------------
// Per-source provenance (the ReconciliationService doctrine mirror).
// ---------------------------------------------------------------------------

/**
 * The role an original observation played in its same-metric set —
 * mirroring @orbb/measurement `SourceRole` exactly.
 */
export const TIMELINE_OBSERVATION_SOURCE_ROLES = [
  "canonical-source",
  "superseded-source",
] as const;

export type TimelineObservationSourceRole = (typeof TIMELINE_OBSERVATION_SOURCE_ROLES)[number];

export function isTimelineObservationSourceRole(
  value: unknown,
): value is TimelineObservationSourceRole {
  return (
    typeof value === "string" &&
    (TIMELINE_OBSERVATION_SOURCE_ROLES as readonly string[]).includes(value)
  );
}

/**
 * Per-source provenance for one original observation inside a canonical
 * view — mirroring the @orbb/measurement `SourceProvenanceRecord` doctrine
 * (data never discarded; superseded sources stay visible as provenance).
 */
export interface TimelineObservationSourceProvenance {
  /** The original observation's domain id. */
  readonly observationId: ObservationId;
  readonly sourceId: SourceId;
  readonly methodId: string;
  readonly evidenceLabel: EvidenceLabel;
  readonly quality?: QualityScore;
  readonly provenanceId: ProvenanceId;
  readonly role: TimelineObservationSourceRole;
}

// ---------------------------------------------------------------------------
// The supersession summary.
// ---------------------------------------------------------------------------

/**
 * Supersession summary of a canonical observation entry: the correction
 * chain that produced the current value — never discarded, always
 * countable (honest counts only).
 */
export interface ObservationSupersessionSummary {
  /**
   * The observation this canonical entry directly supersedes (the domain
   * `supersedesId`), when the entry is a replacement. When present it is
   * always among `supersededIds` (the entry's set includes its
   * predecessor).
   */
  readonly supersedesId?: ObservationId;
  /** Every superseded original in the set (the correction chain), id-ascending. */
  readonly supersededIds: readonly ObservationId[];
  /** Number of superseded originals (== supersededIds.length; honest count). */
  readonly supersededCount: number;
}

// ---------------------------------------------------------------------------
// The frozen discriminated union.
// ---------------------------------------------------------------------------

/**
 * A patient-timeline observation entry — the CANONICAL view of one
 * same-metric observation set. `occurredAt` is `effectiveAt` (the domain
 * timestamp; invariant — asserted by the structural guard).
 */
export interface ObservationTimelineEntry extends TimelineEntryCommonFields {
  readonly kind: "observation";
  /** The canonical observation's domain id (the replacement after reconciliation). */
  readonly id: ObservationId;
  /** Terminology concept code (e.g. a SYNTH LOINC-style code). */
  readonly conceptCode: string;
  /** Typed observation value (the domain primitive union). */
  readonly value: ObservationValue;
  /** Unit of measure; empty string for non-quantitative values. */
  readonly unit: string;
  /** Clinically relevant time (== occurredAt). */
  readonly effectiveAt: Date;
  /** Opaque MeasurementMethod code of the canonical observation. */
  readonly methodId: string;
  readonly validationState: ObservationValidationState;
  readonly evidenceLabel: EvidenceLabel;
  readonly quality?: QualityScore;
  /** The supersession summary (the correction chain — never discarded). */
  readonly supersession: ObservationSupersessionSummary;
  /**
   * Per-source provenance for EVERY original in the set — exactly one
   * `canonical-source` first, then the `superseded-source` originals
   * (id-ascending). Never empty.
   */
  readonly sources: readonly TimelineObservationSourceProvenance[];
}

/**
 * A patient-timeline task entry — a MeasurementTask window/state summary
 * (types imported TYPE-ONLY from @orbb/measurement; the summary carries
 * no attempt data — attempts are the measurement lane's own surface).
 */
export interface TaskTimelineEntry extends TimelineEntryCommonFields {
  readonly kind: "task";
  readonly id: TaskId;
  readonly planId: PlanId;
  readonly metricId: string;
  readonly conceptCode: string;
  /** The ordered method chain (preferred first, fallback order after). */
  readonly methodOrder: readonly string[];
  /** The CURRENT measurement window (advanced by roll-forwards). */
  readonly window: {
    /** 0-based cadence index. */
    readonly sequence: number;
    readonly startsAt: Date;
    readonly endsAt: Date;
  };
  readonly state: TimelineTaskState;
  /** Times this task's window has been rolled forward after being missed. */
  readonly rollCount: number;
}

/**
 * A patient-timeline intent entry — a HealthIntent state summary. The
 * free-text `objective` is deliberately NOT mapped (PHI discipline).
 */
export interface IntentTimelineEntry extends TimelineEntryCommonFields {
  readonly kind: "intent";
  readonly id: IntentId;
  readonly state: IntentState;
  readonly evidencePackVersion?: number;
  readonly planId?: PlanId;
}

/**
 * A patient timeline entry — the FROZEN discriminated union. Extending it
 * (new kinds, new fields beyond the typed summaries) is a reviewed
 * contract change, not a caller decision.
 */
export type TimelineEntry =
  | ObservationTimelineEntry
  | TaskTimelineEntry
  | IntentTimelineEntry;

// ---------------------------------------------------------------------------
// Structural guards (kernel discipline: malformed data is a
// data-integrity failure and throws DomainInvariantError).
// ---------------------------------------------------------------------------

function isTimestamp(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** The kernel's primitive observation value union, guarded locally (the kernel keeps its value guard module-private). */
function isObservationValue(value: unknown): value is ObservationValue {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

function isTimelineProvenanceSummary(value: unknown): value is TimelineProvenanceSummary {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<Record<keyof TimelineProvenanceSummary, unknown>>;
  if (candidate.sourceId !== undefined && !isIdOf("source", candidate.sourceId)) {
    return false;
  }
  if (candidate.methodId !== undefined && !isNonEmptyString(candidate.methodId)) {
    return false;
  }
  return true;
}

function isTimelineObservationSourceProvenance(
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
  if (!isNonEmptyString(candidate.methodId)) {
    return false;
  }
  if (!isEvidenceLabel(candidate.evidenceLabel)) {
    return false;
  }
  if (candidate.quality !== undefined && !isQualityScore(candidate.quality)) {
    return false;
  }
  if (!isIdOf("provenance", candidate.provenanceId)) {
    return false;
  }
  if (!isTimelineObservationSourceRole(candidate.role)) {
    return false;
  }
  return true;
}

function isObservationSupersessionSummary(
  value: unknown,
): value is ObservationSupersessionSummary {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<Record<keyof ObservationSupersessionSummary, unknown>>;
  if (candidate.supersedesId !== undefined && !isIdOf("observation", candidate.supersedesId)) {
    return false;
  }
  if (!Array.isArray(candidate.supersededIds)) {
    return false;
  }
  for (const id of candidate.supersededIds) {
    if (!isIdOf("observation", id)) {
      return false;
    }
  }
  if (!isNonNegativeInteger(candidate.supersededCount)) {
    return false;
  }
  if (candidate.supersededCount !== candidate.supersededIds.length) {
    return false;
  }
  return true;
}

function isObservationTimelineEntry(value: unknown): value is ObservationTimelineEntry {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<Record<keyof ObservationTimelineEntry, unknown>>;
  if (candidate.kind !== "observation") {
    return false;
  }
  if (!isIdOf("observation", candidate.id)) {
    return false;
  }
  if (!isPersonId(candidate.personId)) {
    return false;
  }
  if (!isTimestamp(candidate.occurredAt)) {
    return false;
  }
  if (!isTimelineProvenanceSummary(candidate.provenance)) {
    return false;
  }
  if (!isNonEmptyString(candidate.conceptCode)) {
    return false;
  }
  if (!isObservationValue(candidate.value)) {
    return false;
  }
  if (typeof candidate.unit !== "string") {
    return false;
  }
  if (!isTimestamp(candidate.effectiveAt)) {
    return false;
  }
  if (!isNonEmptyString(candidate.methodId)) {
    return false;
  }
  if (!isObservationValidationState(candidate.validationState)) {
    return false;
  }
  if (!isEvidenceLabel(candidate.evidenceLabel)) {
    return false;
  }
  if (candidate.quality !== undefined && !isQualityScore(candidate.quality)) {
    return false;
  }
  if (!isObservationSupersessionSummary(candidate.supersession)) {
    return false;
  }
  if (!Array.isArray(candidate.sources) || candidate.sources.length === 0) {
    return false;
  }
  for (const source of candidate.sources) {
    if (!isTimelineObservationSourceProvenance(source)) {
      return false;
    }
  }
  return true;
}

function isTaskTimelineEntry(value: unknown): value is TaskTimelineEntry {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<Record<keyof TaskTimelineEntry, unknown>>;
  if (candidate.kind !== "task") {
    return false;
  }
  if (!isIdOf("task", candidate.id)) {
    return false;
  }
  if (!isPersonId(candidate.personId)) {
    return false;
  }
  if (!isTimestamp(candidate.occurredAt)) {
    return false;
  }
  if (!isTimelineProvenanceSummary(candidate.provenance)) {
    return false;
  }
  if (!isIdOf("plan", candidate.planId)) {
    return false;
  }
  if (!isNonEmptyString(candidate.metricId)) {
    return false;
  }
  if (!isNonEmptyString(candidate.conceptCode)) {
    return false;
  }
  if (!Array.isArray(candidate.methodOrder)) {
    return false;
  }
  for (const methodId of candidate.methodOrder) {
    if (!isNonEmptyString(methodId)) {
      return false;
    }
  }
  if (typeof candidate.window !== "object" || candidate.window === null) {
    return false;
  }
  const window = candidate.window as Partial<Record<"sequence" | "startsAt" | "endsAt", unknown>>;
  if (!isNonNegativeInteger(window.sequence)) {
    return false;
  }
  if (!isTimestamp(window.startsAt) || !isTimestamp(window.endsAt)) {
    return false;
  }
  if (!(window.startsAt.getTime() < window.endsAt.getTime())) {
    return false;
  }
  if (!isTimelineTaskState(candidate.state)) {
    return false;
  }
  if (!isNonNegativeInteger(candidate.rollCount)) {
    return false;
  }
  return true;
}

function isIntentTimelineEntry(value: unknown): value is IntentTimelineEntry {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<Record<keyof IntentTimelineEntry, unknown>>;
  if (candidate.kind !== "intent") {
    return false;
  }
  if (!isIdOf("intent", candidate.id)) {
    return false;
  }
  if (!isPersonId(candidate.personId)) {
    return false;
  }
  if (!isTimestamp(candidate.occurredAt)) {
    return false;
  }
  if (!isTimelineProvenanceSummary(candidate.provenance)) {
    return false;
  }
  if (!isIntentState(candidate.state)) {
    return false;
  }
  if (candidate.evidencePackVersion !== undefined && !isPositiveInteger(candidate.evidencePackVersion)) {
    return false;
  }
  if (candidate.planId !== undefined && !isIdOf("plan", candidate.planId)) {
    return false;
  }
  return true;
}

/**
 * Type guard: is `value` a well-formed {@link TimelineEntry} of any kind?
 * Kind-specific cross-field invariants (occurredAt == effectiveAt for
 * observations; the task's occurredAt == its window's due instant;
 * source-role ordering) are checked by {@link assertTimelineEntry}, which
 * this guard feeds — use the pair together at boundaries.
 */
export function isTimelineEntry(value: unknown): value is TimelineEntry {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const kind = (value as Partial<Record<"kind", unknown>>).kind;
  if (kind === "observation") {
    return isObservationTimelineEntry(value);
  }
  if (kind === "task") {
    return isTaskTimelineEntry(value);
  }
  if (kind === "intent") {
    return isIntentTimelineEntry(value);
  }
  return false;
}

/**
 * Pure guard: asserts that `candidate` is a well-formed
 * {@link TimelineEntry} — including the kind-specific cross-field
 * invariants:
 *
 *   - observation: `occurredAt` EQUALS `effectiveAt` (the domain
 *     timestamp); the source list has EXACTLY one `canonical-source`,
 *     first, with the `superseded-source` originals after it in
 *     id-ascending order, all observation ids unique, and — when
 *     present — `supersession.supersedesId` among `supersededIds`;
 *   - task: `occurredAt` EQUALS `window.endsAt` (the due instant);
 *   - every kind: canonical ids and typed shapes throughout.
 *
 * Throws {@link DomainInvariantError} describing the expected shape —
 * received values are never echoed.
 */
export function assertTimelineEntry(candidate: unknown): asserts candidate is TimelineEntry {
  if (!isTimelineEntry(candidate)) {
    throw new DomainInvariantError(
      "Invalid timeline entry: expected a frozen-union member { kind: observation | task | intent } carrying { id, personId, occurredAt, provenance } with canonical domain ids, a valid occurredAt timestamp, and a provenance summary { sourceId?, methodId? } — plus the kind's typed summary fields.",
    );
  }
  switch (candidate.kind) {
    case "observation": {
      if (candidate.occurredAt.getTime() !== candidate.effectiveAt.getTime()) {
        throw new DomainInvariantError(
          "Invalid timeline entry: an observation entry's occurredAt must EQUAL its effectiveAt (the domain timestamp).",
        );
      }
      assertObservationSourceOrdering(candidate);
      return;
    }
    case "task": {
      if (candidate.occurredAt.getTime() !== candidate.window.endsAt.getTime()) {
        throw new DomainInvariantError(
          "Invalid timeline entry: a task entry's occurredAt must EQUAL its measurement window's due instant (endsAt).",
        );
      }
      return;
    }
    case "intent":
      return;
  }
}

/**
 * Asserts the doctrine invariants of an observation entry's per-source
 * provenance list: exactly one `canonical-source`, first; the
 * `superseded-source` originals after it, id-ascending; no duplicate
 * observation ids; the supersession summary's `supersededIds` exactly
 * the superseded-source ids (1:1 — never the canonical-source's own
 * id); and the direct `supersedesId` (when present) among them.
 */
function assertObservationSourceOrdering(entry: ObservationTimelineEntry): void {
  const sources = entry.sources;
  const first = sources[0];
  if (first === undefined || first.role !== "canonical-source") {
    throw new DomainInvariantError(
      "Invalid timeline entry: an observation entry's sources must list exactly one canonical-source first, then the superseded-source originals.",
    );
  }
  let supersededSeen = 0;
  const seenIds = new Set<string>([first.observationId]);
  const supersededSourceIds = new Set<string>();
  let previousSupersededId: string | undefined;
  for (const source of sources.slice(1)) {
    if (source.role !== "superseded-source") {
      throw new DomainInvariantError(
        "Invalid timeline entry: an observation entry's sources must list exactly one canonical-source first, then the superseded-source originals.",
      );
    }
    if (seenIds.has(source.observationId)) {
      throw new DomainInvariantError(
        "Invalid timeline entry: an observation entry's sources must not repeat an observation id.",
      );
    }
    if (previousSupersededId !== undefined && source.observationId < previousSupersededId) {
      throw new DomainInvariantError(
        "Invalid timeline entry: an observation entry's superseded sources must be ordered by observation id ascending.",
      );
    }
    seenIds.add(source.observationId);
    supersededSourceIds.add(source.observationId);
    previousSupersededId = source.observationId;
    supersededSeen += 1;
  }
  if (supersededSeen !== entry.supersession.supersededCount) {
    throw new DomainInvariantError(
      "Invalid timeline entry: the supersession count must equal the number of superseded sources.",
    );
  }
  for (const supersededId of entry.supersession.supersededIds) {
    if (!supersededSourceIds.has(supersededId)) {
      throw new DomainInvariantError(
        "Invalid timeline entry: every superseded id in the supersession summary must appear as a superseded-source provenance record.",
      );
    }
  }
  if (
    entry.supersession.supersedesId !== undefined &&
    !entry.supersession.supersededIds.includes(entry.supersession.supersedesId)
  ) {
    throw new DomainInvariantError(
      "Invalid timeline entry: a canonical entry's direct supersedesId must be among its superseded ids.",
    );
  }
}

// ---------------------------------------------------------------------------
// The page.
// ---------------------------------------------------------------------------

/**
 * One page of a patient timeline: the entries, the opaque cursor that
 * continues the iteration (present iff more entries exist in the
 * requested stream), and an HONEST `truncated` flag — the timeline is
 * never silently truncated. `truncated` is true exactly when
 * `nextCursor` is present.
 */
export interface TimelinePage {
  readonly entries: readonly TimelineEntry[];
  /** Opaque cursor to the next page; undefined marks the end of the stream. */
  readonly nextCursor?: string;
  /** True iff entries exist beyond this page — never silently truncated. */
  readonly truncated: boolean;
}

export function isTimelinePage(value: unknown): value is TimelinePage {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<Record<keyof TimelinePage, unknown>>;
  if (!Array.isArray(candidate.entries)) {
    return false;
  }
  for (const entry of candidate.entries) {
    if (!isTimelineEntry(entry)) {
      return false;
    }
  }
  if (candidate.nextCursor !== undefined && typeof candidate.nextCursor !== "string") {
    return false;
  }
  if (typeof candidate.truncated !== "boolean") {
    return false;
  }
  if (candidate.truncated !== (candidate.nextCursor !== undefined)) {
    return false;
  }
  return true;
}
