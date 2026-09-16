/**
 * @orbb/notifications — deterministic notification/reminder engine (M6-B
 * B8, Lane A).
 *
 * Public surface:
 *   - `ReminderEngine` — deterministic schedule computation over
 *     measurement-task snapshots (upcoming-due, missed-window, gentle
 *     REMIND -> REMIND_WITH_FALLBACK_OFFER escalation over the task's
 *     recorded fallback vocabulary) plus fail-closed dispatch over the
 *     injectable send-attempt ledger.
 *   - `ReminderPreferenceProfile` — the preference-gated inputs (master
 *     switch, explicit channel enablement, recipient references, quiet
 *     hours, escalation timing defaults).
 *   - Quiet-hours mathematics — defer-not-drop, pure UTC arithmetic over
 *     a fixed local-of-record offset.
 *   - Deterministic identities — reminder id = f(task id, window id,
 *     rung, channel, UTC day); window keys derived from the real
 *     `MeasurementWindow` semantic identity.
 *   - `NotificationChannel` abstraction — typed sends, capability flags,
 *     fail-closed outcomes; `InMemoryChannel` double; seam-only SYNTH
 *     `WebPushChannel`/`EmailChannel` provider doubles.
 *   - `ReminderDispatchLedger` port + in-memory double (exactly-once per
 *     reminder id).
 *
 * Interface-driven like `@orbb/measurement`: injected clock, injected
 * ledger, injected channel registry — ZERO db imports, ZERO external
 * runtime dependencies. The `EngineResult`/`ok`/`err` helpers and the
 * domain-separated deterministic id derivation are re-used from
 * `@orbb/measurement` (the workspace dependency that also owns the task
 * snapshot types this engine computes from).
 */
export { NotificationEngineError, type NotificationEngineErrorCode } from "./errors.js";

export { ok, err, type EngineResult } from "@orbb/measurement";
export type { NotificationResult } from "./result.js";

export {
  deriveReminderIdentity,
  deriveWindowKey,
  isReminderId,
  isWindowKey,
  utcDayOf,
  REMINDER_ID_PREFIX,
  WINDOW_KEY_PREFIX,
  type ReminderIdentityInput,
  type ReminderId,
  type WindowKey,
  type WindowKeyInput,
} from "./ids.js";

export {
  ALL_CHANNEL_CAPABILITIES,
  CHANNEL_FAILURE_REASON_KINDS,
  isRungCarriedByChannel,
  validateChannelRegistry,
  type ChannelCapabilities,
  type ChannelDeliveryOutcome,
  type ChannelDeliveryStatus,
  type ChannelFailureReason,
  type ChannelFailureReasonKind,
  type ChannelId,
  type ChannelRegistryViolation,
  type ChannelSendRequest,
  type NotificationChannel,
  type ProviderDeliveryReport,
} from "./channels.js";

export {
  channelRecipient,
  DEFAULT_ESCALATION_AFTER_MS,
  DEFAULT_QUIET_HOURS,
  DEFAULT_UPCOMING_LEAD_MS,
  MS_PER_DAY,
  MS_PER_MINUTE,
  resolveEscalationAfterMs,
  resolveQuietHours,
  resolveUpcomingLeadMs,
  validatePreferenceProfile,
  type ChannelRecipient,
  type PreferenceField,
  type PreferenceViolation,
  type QuietHoursSpec,
  type ReminderPreferenceProfile,
} from "./preferences.js";

export {
  deferForQuietHours,
  isInsideQuietHours,
  localMinuteOfDay,
  type QuietHoursResolution,
} from "./quietHours.js";

export {
  cloneReminder,
  cloneReminderPayload,
  compareReminders,
  ESCALATION_RUNGS,
  isEscalationRung,
  REMINDER_REASONS,
  rungOrder,
  type EscalationRung,
  type FallbackMethodOffer,
  type FallbackOfferPayload,
  type RemindPayload,
  type Reminder,
  type ReminderPayload,
  type ReminderPayloadBase,
  type ReminderReason,
} from "./reminder.js";

export {
  DISPATCH_STATUSES,
  InMemoryReminderDispatchLedger,
  type DispatchRecord,
  type DispatchStatus,
  type LedgerWriteOutcome,
  type ReminderDispatchLedger,
} from "./ledger.js";

export {
  InMemoryChannel,
  type InMemoryChannelBehavior,
  type InMemoryChannelOptions,
  type RecordedChannelSend,
} from "./inmemory-channel.js";

export {
  EmailChannel,
  renderEmailMessage,
  SyntheticEmailProvider,
  WebPushChannel,
  renderWebPushNotification,
  SyntheticWebPushProvider,
  type EmailChannelOptions,
  type EmailMessage,
  type EmailProvider,
  type RecordedEmailDelivery,
  type RecordedWebPushDelivery,
  type SeamChannelOptions,
  type SynthProviderBehavior,
  type SynthProviderOptions,
  type WebPushChannelOptions,
  type WebPushNotification,
  type WebPushProvider,
} from "./synth-channels.js";

export {
  ReminderEngine,
  type ChannelSkipRecord,
  type DispatchSkipRecord,
  type ReminderDispatchError,
  type ReminderDispatchOutcome,
  type ReminderEngineDeps,
  type ReminderLabelPack,
  type ReminderScheduleError,
  type ReminderScheduleInput,
  type ReminderScheduleOutcome,
  type TaskSkipRecord,
} from "./engine.js";
