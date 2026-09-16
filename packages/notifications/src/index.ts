/**
 * @orbb/notifications — deterministic notification/reminder engine
 * (M6-B, Lane A, work item B8).
 *
 * Public surface:
 *   - `ReminderEngine` — pure, deterministic schedule computation over
 *     `@orbb/measurement` task snapshots (upcoming-due REMIND rung,
 *     missed-window detection, gentle escalation to
 *     REMIND_WITH_FALLBACK_OFFER offering the task's recorded fallback
 *     vocabulary — journey #7: data, never a decision) plus idempotent,
 *     fail-closed dispatch through the channel abstraction.
 *   - `ReminderPreferences` / `QuietHoursSpec` — the per-person preference
 *     profile (quiet hours 22:00–07:00 local-of-record by default,
 *     defer-to-edge, never drop).
 *   - `NotificationChannel` / `ChannelRegistry` — typed send operations,
 *     per-rung capability flags, fail-closed `DeliveryResult` model;
 *     `InMemoryChannel` (test/impl default) and seam-only SYNTH
 *     `WebPushChannel` / `EmailChannel` doubles (no network, no SDKs).
 *   - `ReminderDispatchLedger` — the send-attempt ledger port keyed by
 *     deterministic `ReminderId`s (dispatch exactly-once per reminder).
 *   - `ReminderEventSink` / `buildTaskDueEvent` — TASK_DUE emission
 *     through the `@orbb/contracts` §11 envelope.
 *   - `canonicalJson` / `serializeReminderPayload` /
 *     `serializeReminderSchedule` — byte-stable serialization (the
 *     determinism contract made testable).
 *
 * Interface-driven discipline (the `@orbb/measurement` precedent):
 * injected clock, injected id-factory, injected ledger, injected event
 * sink, injected channel registry — ZERO @orbb/db imports (db adapters
 * arrive in a later integration packet; handoffs recorded in README.md),
 * ZERO external runtime dependencies, no provider SDKs.
 *
 * PHI discipline: reminder payloads reference task/metric/window ids and
 * human-safe vocabulary labels ONLY — never observation values, never
 * evidence content, never person ids, never person-identifying free text
 * (see `payloads.ts` and the not.toContain PHI proofs in `phi.test.ts`).
 */
export { NotificationEngineError, type NotificationEngineErrorCode } from "./errors.js";
export { ok, err, type EngineResult } from "./result.js";

export {
  DEFAULT_ESCALATION_DELAY_MINUTES,
  DEFAULT_QUIET_HOURS_END_LOCAL_MINUTES,
  DEFAULT_QUIET_HOURS_START_LOCAL_MINUTES,
  DEFAULT_REMINDER_LEAD_MINUTES,
  MAX_LOCAL_UTC_OFFSET_MINUTES,
  MAX_TIMING_PREFERENCE_MINUTES,
  MINUTES_PER_DAY,
  MIN_LOCAL_UTC_OFFSET_MINUTES,
  defaultQuietHours,
  defaultReminderPreferences,
  isQuietHoursSpec,
  type ChannelPreference,
  type QuietHoursSpec,
  type ReminderPreferences,
} from "./preferences.js";

export {
  MAX_LABEL_LENGTH,
  REMINDER_REASONS,
  REMINDER_RUNGS,
  cloneReminderPayload,
  isHumanSafeLabel,
  isReminderPayload,
  isReminderReason,
  isReminderRung,
  type FallbackMethodOption,
  type FallbackOfferReminderPayload,
  type ReminderPayload,
  type ReminderReason,
  type ReminderRung,
  type UpcomingDueReminderPayload,
} from "./payloads.js";

export {
  REMINDER_ID_PREFIX,
  deriveReminderId,
  isReminderId,
  reminderUtcDay,
  type ReminderId,
  type ReminderIdentityParts,
} from "./identity.js";

export {
  MS_PER_DAY,
  MS_PER_HOUR,
  MS_PER_MINUTE,
  deferToQuietHoursEdge,
  isQuietInstant,
  localMinutesOfDay,
} from "./quiet-hours.js";

export {
  canonicalJson,
  serializeReminderPayload,
  serializeReminderSchedule,
  type SerializableSchedule,
} from "./canonical.js";

export {
  CHANNEL_KINDS,
  DELIVERY_FAILURE_REASONS,
  InMemoryChannelRegistry,
  isChannelKind,
  isDeliveryFailureReason,
  isDeliveryResult,
  sendForRung,
  type ChannelCapabilityFlags,
  type ChannelKind,
  type ChannelRegistry,
  type ChannelSendRequest,
  type DeliveredResult,
  type DeliveryFailureReason,
  type DeliveryResult,
  type NotificationChannel,
  type UndeliveredResult,
} from "./channels.js";

export {
  InMemoryChannel,
  type InMemoryChannelFailureMode,
  type InMemoryChannelOptions,
  type InMemorySentRecord,
} from "./inmemory-channel.js";

export {
  SYNTH_WEB_PUSH_CHANNEL_ID,
  WebPushChannel,
  type WebPushSubscriptionProvider,
} from "./webpush-channel.js";

export {
  SYNTH_EMAIL_CHANNEL_ID,
  EmailChannel,
  type EmailAddressProvider,
} from "./email-channel.js";

export {
  InMemoryReminderDispatchLedger,
  REMINDER_DISPATCH_STATUSES,
  isReminderDispatchStatus,
  type ReminderAttemptRecord,
  type ReminderDispatchLedger,
  type ReminderDispatchRecord,
  type ReminderDispatchStatus,
} from "./ledger.js";

export {
  InMemoryReminderEventSink,
  TASK_DUE_ENVELOPE_VERSION,
  TASK_DUE_PAYLOAD_SCHEMA_VERSION,
  buildTaskDueEvent,
  type BuildTaskDueEventInput,
  type ReminderEventSink,
  type TaskDueEvent,
  type TaskDueEventPayload,
} from "./events.js";

export {
  DEFAULT_MAX_DISPATCH_ATTEMPTS,
  ReminderEngine,
  compareScheduledReminders,
  compareSkippedTargets,
  type DispatchOutcome,
  type DispatchedReminder,
  type FailedDispatch,
  type ReminderEngineDeps,
  type ReminderEngineInput,
  type ReminderEngineOptions,
  type ReminderError,
  type ReminderSchedule,
  type ScheduledReminder,
  type SkippedChannelTarget,
  type SkippedDispatch,
  type VocabularyLabels,
} from "./engine.js";
