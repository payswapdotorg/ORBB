/**
 * @orbb/timeline — the patient timeline API (M7-B A49, Lane A).
 *
 * A pure, deterministic, care-team-authorized longitudinal assembly of
 * a person's health record into an ordered, paginated,
 * provenance-preserving timeline — the M7 exit direction: "clinician
 * can request authorized data and reason over a longitudinal patient
 * timeline".
 *
 * Public surface:
 *   - The entry model: `TimelineEntry` (the frozen `observation | task |
 *     intent` union with per-source provenance and the supersession
 *     summary), `TimelinePage` (entries + opaque `nextCursor` + honest
 *     `truncated`).
 *   - The cursor law: `takeTimelineCursor` / `parseTimelineCursor` /
 *     `applyTimelineCursor` / `pageTimelineOf` / `clampTimelinePageLimit`
 *     (the @orbb/db cursor law mirrored in-package: opaque base64url
 *     anchor tuple `(occurredAt, id)`, page-stable, forward-only,
 *     fail-closed).
 *   - The assembly service: `PatientTimelineService.assembleTimeline(
 *     subject, query, practitionerContext)` — deterministic ordering
 *     (occurredAt DESC, domain-id ASC tiebreak), inclusive windowing,
 *     the ReconciliationService doctrine mirror (ONE canonical entry per
 *     same-metric set, per-source provenance never discarded).
 *   - THE GATE: care-team authorization through @orbb/clinical's REAL
 *     `evaluateCareTeamAccess` with the frozen `timeline:read` scope —
 *     deny-by-default is ABSOLUTE, every clinical deny reason maps to a
 *     typed timeline denial, the denial is all-or-nothing (no partial
 *     timeline, no store reads), and every decision is audited
 *     (`TimelineAccessAudit`, shaped for `access_audits`) and emitted as
 *     a `TIMELINE_READ` event (`TimelineEventEnvelope`).
 *   - `timelineSummary` — honest counts by kind as a pure derivation
 *     (no inference, no trend claims — M12 owns interpretation).
 *   - The store ports + in-memory reference doubles (db adapters are a
 *     recorded handoff).
 *
 * SAFETY POSTURE (binding, AGENTS.md): clinical features require
 * jurisdiction-specific governance before real-world use — everything
 * in this package is boundary-shaped, non-authoritative, and
 * SYNTH-fixtured. Self-serve (a person reading their own timeline) is a
 * recorded future surface, NOT shipped here.
 */
// The entry model.
export {
  TIMELINE_ENTRY_KINDS,
  TIMELINE_OBSERVATION_SOURCE_ROLES,
  TIMELINE_TASK_STATES,
  assertTimelineEntry,
  isTimelineEntry,
  isTimelineEntryKind,
  isTimelineObservationSourceRole,
  isTimelineTaskState,
  type IntentTimelineEntry,
  type ObservationSupersessionSummary,
  type ObservationTimelineEntry,
  type TaskTimelineEntry,
  type TimelineEntry,
  type TimelineEntryCommonFields,
  type TimelineEntryKind,
  type TimelineObservationSourceProvenance,
  type TimelineObservationSourceRole,
  type TimelinePage,
  type TimelineProvenanceSummary,
  type TimelineTaskState,
} from "./entries.js";

// The cursor law.
export {
  DEFAULT_TIMELINE_PAGE_SIZE,
  MAX_TIMELINE_PAGE_SIZE,
  applyTimelineCursor,
  clampTimelinePageLimit,
  compareTimelineEntries,
  pageTimelineOf,
  parseTimelineCursor,
  takeTimelineCursor,
  type TimelineCursorAnchor,
  type TimelinePageResult,
} from "./cursor.js";

// The typed error surface.
export {
  TIMELINE_ERROR_CODES,
  TimelineError,
  isTimelineError,
  type TimelineErrorCode,
} from "./errors.js";

// The store ports + record guards.
export {
  assertCanonicalObservationRecord,
  assertTimelineIntentRecord,
  assertTimelineTaskRecord,
  assertTimelineWindowBounds,
  isCanonicalObservationRecord,
  isTimelineWindowBounds,
  type CanonicalObservationRecord,
  type IntentTimelineStore,
  type ObservationTimelineStore,
  type TaskTimelineStore,
  type TimelineWindowBounds,
} from "./ports.js";

// The in-memory reference stores (deterministic doubles).
export {
  InMemoryIntentTimelineStore,
  InMemoryObservationTimelineStore,
  InMemoryTaskTimelineStore,
} from "./inMemory.js";

// The care-team authorization gate.
export {
  TIMELINE_ACCESS_ALLOW_REASON,
  TIMELINE_ACCESS_DECISIONS,
  TIMELINE_DENY_REASONS,
  TIMELINE_READ_PERMISSION,
  evaluateTimelineAccess,
  isTimelineReadOutcome,
  timelineDenialFor,
  type CareTeamAccessDecision,
  type CareTeamAccessSnapshot,
  type PractitionerId,
  type PractitionerTimelineContext,
  type TimelineAccessAudit,
  type TimelineAccessDecisionKind,
  type TimelineDenyReason,
  type TimelineReadDenied,
  type TimelineReadGranted,
  type TimelineReadOutcome,
} from "./authorization.js";

// The assembly service.
export {
  PatientTimelineService,
  type PatientTimelineServiceDeps,
  type TimelineQuery,
} from "./assembly.js";

// The summary derivation.
export { timelineSummary, type TimelineSummary } from "./summary.js";

// Timeline events.
export {
  TIMELINE_EVENT_ID_PREFIX,
  TIMELINE_EVENT_TYPES,
  assertTimelineEventEnvelope,
  isTimelineEventActor,
  isTimelineEventEnvelope,
  isTimelineEventId,
  isTimelineEventType,
  parseTimelineEventId,
  parseTimelineEventType,
  type TimelineEventActor,
  type TimelineEventEnvelope,
  type TimelineEventId,
  type TimelineEventType,
} from "./events.js";
