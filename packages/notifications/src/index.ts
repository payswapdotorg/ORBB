/**
 * @orbb/notifications — the deterministic reminder/notification engine
 * for ORBB (M6-B Lane A, work item B8).
 *
 * Public surface:
 *   - `ReminderEngine` — deterministic reminder-schedule computation over
 *     REAL measurement-task snapshots (`MeasurementTask` /
 *     `MeasurementWindow` imported TYPES-ONLY from @orbb/measurement —
 *     the workspace dependency recorded in the B8 packet), plus
 *     idempotent fail-closed dispatch through the send-attempt ledger.
 *   - The escalation ladder vocabulary (`REMIND` ->
 *     `REMIND_WITH_FALLBACK_OFFER`) with the recorded advancement
 *     conditions (open + future window -> rung 1; open + missed window ->
 *     rung 2 after the grace delay; completed -> silence).
 *   - The journey-#7 fallback-provider OFFER: the task's recorded method
 *     vocabulary as DATA (`fallbackOffer` on rung-2 payloads,
 *     `enforcementAuthority: "none"` type-encoded — the engine never
 *     orders a provider; authorized restrictions are B10's).
 *   - Preference-gated quiet hours (recorded default 22:00–07:00
 *     local-of-record as a fixed UTC offset; defer-to-edge, never drop).
 *   - Deterministic reminder identity f(task id, window id, rung,
 *     channel, UTC day) + `SendAttemptLedger` (exactly-once dispatch).
 *   - The fail-closed `NotificationChannel` port with capability flags
 *     and accounted skips; doubles only — `InMemoryChannel` (test/impl
 *     default) and the seam-only `SyntheticWebPushChannel` /
 *     `SyntheticEmailChannel` provider doubles (no network, no SDKs).
 *   - PHI-free reminder payloads (ids + human-safe labels ONLY) with
 *     serialization/hash helpers for the no-PHI and determinism proofs.
 *
 * RECORDED HANDOFFS (integration boundaries — engine wiring arrives in
 * later packets; none of these are implementable inside this packet's
 * scope without touching frozen contracts or other packages' trees):
 *   - WORKER WIRING (apps/worker): the Cloudflare Worker async consumer
 *     that drains the domain-event outbox (`TASK_DUE`-adjacent events +
 *     a periodic tick), loads task snapshots and preference profiles,
 *     and calls `dispatchPending` lives in `apps/worker/**` which is an
 *     M0 no-op shell today. Per the B8 packet's scope rule the seam is
 *     RECORDED, not wired: the worker app needs its runtime shape
 *     (queues, env, stores) settled first. The engine's contract is the
 *     call surface that module will consume.
 *   - DB ADAPTERS: `SendAttemptLedger`, `RecipientDirectory`,
 *     `ChannelRegistry`, `ReminderLabelDirectory` are async/sync ports
 *     exactly shaped for persistence adapters (the @orbb/measurement
 *     store-port precedent); the Postgres implementations arrive with the
 *     db integration packet.
 *   - PROVIDER ADAPTERS: real Web Push (VAPID) and email (SMTP/SES)
 *     channels arrive behind the same `NotificationChannel` interface —
 *     the SYNTH doubles here shape the contract (endpoint directories,
 *     expiry semantics, fail-closed reasons, receipts).
 *   - IANA TIMEZONES: local-of-record is a fixed UTC offset (pure-UTC
 *     engine discipline, DST-free like A30 window math); resolving a
 *     person's IANA timezone (with DST transitions) is an
 *     application-boundary concern that feeds the profile's offset.
 *   - B10 BOUNDARY: adherence enforcement ("authorized restriction
 *     applied only if configured") is B10's abstraction. This package
 *     exports no enforcement mechanism of any kind.
 *   - A daily re-nudge recurrence policy for still-missed tasks is
 *     deliberately NOT invented (no requirement specifies it; the safe
 *     non-spamming reading of the identity rule is recorded in
 *     `ids.ts`). Re-nudges emerge from the measurement scheduler's
 *     window roll-forward: a rolled task has a NEW window identity and
 *     therefore new reminders.
 *   - `NotificationResult` and the canonical-JSON/hash kernel are local
 *     mirrors of the measurement/intents lane helpers (same recorded
 *     dependency-budget rationale those lanes document); a future shared
 *     kernel package would let all lanes adopt them mechanically.
 */
export { NotificationEngineError, type NotificationEngineErrorCode } from "./errors.js";
export { ok, err, type NotificationResult } from "./result.js";

export {
  canonicalJsonStringify,
  hashWithDomainBase64Url,
  sha256Base64Url,
  sha256Hex,
} from "./canonical.js";

export {
  REMINDER_RUNGS,
  isNotificationChannelId,
  isReminderRung,
  reminderRungIndex,
  type NotificationChannelId,
  type ReminderRung,
} from "./vocabulary.js";

export {
  REMINDER_ID_PREFIX,
  SEND_ATTEMPT_ID_PREFIX,
  deriveReminderId,
  isReminderId,
  isSendAttemptId,
  utcEpochDay,
  type ReminderId,
  type ReminderIdentityParts,
  type SendAttemptId,
} from "./ids.js";

export {
  DEFAULT_QUIET_HOURS,
  MS_PER_DAY,
  MS_PER_MINUTE,
  deferToQuietEdge,
  isQuietHoursSpec,
  isQuietInstant,
  localMinuteOfDay,
  type QuietHoursSpec,
} from "./quietHours.js";

export {
  DEFAULT_ESCALATION_GRACE_MS,
  DEFAULT_LEAD_TIME_MS,
  DEFAULT_REMINDER_PROFILE,
  isReminderPreferenceProfile,
  normalizeReminderProfile,
  type NormalizedReminderProfile,
  type PreferenceField,
  type ReminderPreferenceProfile,
} from "./preferences.js";

export {
  DEFAULT_METRIC_LABEL,
  DEFAULT_METHOD_LABEL,
  InMemoryReminderLabelDirectory,
  type ReminderLabelDirectory,
} from "./labels.js";

export { InMemoryRecipientDirectory, type RecipientDirectory } from "./recipients.js";

export {
  buildReminderPayload,
  type BuildReminderPayloadInput,
  type FallbackMethodOption,
  type FallbackOfferReminderPayload,
  type FallbackOfferVocabulary,
  type ReminderDeferRecord,
  type ReminderPayload,
  type UpcomingDueReminderPayload,
} from "./payload.js";

export {
  FULL_CHANNEL_CAPABILITIES,
  InMemoryChannel,
  InMemoryChannelRegistry,
  InMemoryRecipientEndpointDirectory,
  RUNG_CAPABILITY_REQUIREMENTS,
  SyntheticEmailChannel,
  SyntheticWebPushChannel,
  type ChannelCapabilities,
  type ChannelCapabilityName,
  type ChannelFailureReason,
  type ChannelFaultInjection,
  type ChannelRegistry,
  type ChannelSendResult,
  type InMemoryChannelDeps,
  type NotificationChannel,
  type OutboundDelivery,
  type RecordedChannelDelivery,
  type RecipientEndpoint,
  type RecipientEndpointDirectory,
  type SyntheticProviderChannelDeps,
} from "./channels.js";

export {
  InMemorySendAttemptLedger,
  type SendAttempt,
  type SendAttemptLedger,
} from "./ledger.js";

export {
  ReminderEngine,
  baseFireInstant,
  comparePlannedReminders,
  compareReminderTasks,
  isTaskSnapshotValid,
  selectRung,
  type DispatchError,
  type DispatchOutcome,
  type PlannedReminder,
  type ReminderEngineDeps,
  type ReminderEngineInput,
  type ReminderSchedule,
  type ReminderScheduleError,
  type SkippedChannelFanout,
} from "./engine.js";

export {
  hashReminderPayload,
  hashReminderSchedule,
  hashScheduleAuditView,
  serializeReminderPayload,
  serializeReminderSchedule,
  serializeScheduleAuditView,
  toScheduleAuditView,
  type ReminderScheduleAuditView,
  type ScheduledReminderAuditEntry,
} from "./serialization.js";
