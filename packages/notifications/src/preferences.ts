/**
 * Reminder preference profile (B8) — the user-gated input of the engine.
 *
 * The profile is the single place user preference is expressed: the master
 * reminders gate, the ordered set of enabled channels, the quiet-hours
 * spec (gated, with the recorded 22:00–07:00 default when absent), and
 * the two schedule knobs (upcoming-due lead time, missed-window escalation
 * grace). All knobs are NON-NEGATIVE millisecond durations.
 *
 * RECORDED DEFAULT ASSUMPTIONS (both genuinely unspecified by the packet;
 * the safest architecture-consistent values are fixed and testable):
 *   - `leadTimeMs`      default 3_600_000 (60 minutes before the window
 *     closes — an "upcoming due" nudge close enough to be actionable,
 *     far enough to be gentle).
 *   - `escalationGraceMs` default 3_600_000 (60 minutes of grace after a
 *     window closes before the fallback-offer rung may fire — the ladder
 *     escalates gently, never at the instant of the miss).
 * Both are profile-overridable; production surfaces should expose them as
 * accessibility/preference controls (Lane B integration).
 */
import { NotificationEngineError } from "./errors.js";
import { DEFAULT_QUIET_HOURS, isQuietHoursSpec, type QuietHoursSpec } from "./quietHours.js";
import { isNotificationChannelId, type NotificationChannelId } from "./vocabulary.js";

/** Default upcoming-due lead time: 60 minutes before the window closes. */
export const DEFAULT_LEAD_TIME_MS = 3_600_000;

/** Default missed-window escalation grace: 60 minutes after the window closes. */
export const DEFAULT_ESCALATION_GRACE_MS = 3_600_000;

/**
 * The user preference profile. Field-by-field validation semantics:
 *   - `remindersEnabled: false` — the master gate: the engine computes an
 *     EMPTY schedule (preference wins; no reminder is ever forced).
 *   - `channels` — ordered, non-empty when reminders are enabled; each id
 *     must satisfy the lane-local channel grammar (registry membership is
 *     checked by the engine against its injected registry).
 *   - `quietHours` — absent => the recorded DEFAULT (22:00–07:00 offset 0);
 *     `null` or `{ enabled: false }` => deferral disabled.
 *   - `leadTimeMs` / `escalationGraceMs` — absent => the recorded defaults;
 *     when present, non-negative finite integers.
 */
export interface ReminderPreferenceProfile {
  /** Master preference gate. */
  readonly remindersEnabled: boolean;
  /** Ordered enabled delivery channels (fan-out order). */
  readonly channels: readonly NotificationChannelId[];
  /** Quiet hours: absent => default 22:00–07:00; null / disabled => off. */
  readonly quietHours?: QuietHoursSpec | null;
  /** Upcoming-due lead time (ms). Default 3_600_000. */
  readonly leadTimeMs?: number;
  /** Missed-window escalation grace (ms). Default 3_600_000. */
  readonly escalationGraceMs?: number;
}

/** Validated, default-resolved internal view of a preference profile. */
export interface NormalizedReminderProfile {
  readonly remindersEnabled: boolean;
  readonly channels: readonly NotificationChannelId[];
  /** `null` when quiet-hour deferral is disabled. */
  readonly quietHours: QuietHoursSpec | null;
  readonly leadTimeMs: number;
  readonly escalationGraceMs: number;
}

/** Structural field names a preference rejection can point at (PHID-safe). */
export type PreferenceField =
  | "remindersEnabled"
  | "channels"
  | "quietHours"
  | "leadTimeMs"
  | "escalationGraceMs";

/** Is `value` structurally a valid {@link ReminderPreferenceProfile}? */
export function isReminderPreferenceProfile(value: unknown): value is ReminderPreferenceProfile {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const profile = value as Record<string, unknown>;
  if (typeof profile.remindersEnabled !== "boolean") {
    return false;
  }
  if (!Array.isArray(profile.channels)) {
    return false;
  }
  for (const channel of profile.channels) {
    if (!isNotificationChannelId(channel)) {
      return false;
    }
  }
  if (profile.remindersEnabled && profile.channels.length === 0) {
    return false;
  }
  const quietHours: unknown = profile.quietHours;
  if (quietHours !== undefined && quietHours !== null && !isQuietHoursSpec(quietHours)) {
    return false;
  }
  if (!isOptionalDuration(profile.leadTimeMs) || !isOptionalDuration(profile.escalationGraceMs)) {
    return false;
  }
  return true;
}

function isOptionalDuration(value: unknown): boolean {
  return (
    value === undefined ||
    (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER)
  );
}

/**
 * Resolves a {@link ReminderPreferenceProfile} into its normalized view,
 * applying the recorded defaults. Throws {@link NotificationEngineError}
 * (`invalid-request`) on structurally invalid input — callers should
 * pre-validate with {@link isReminderPreferenceProfile} and surface the
 * typed rejection instead.
 */
export function normalizeReminderProfile(
  profile: ReminderPreferenceProfile,
): NormalizedReminderProfile {
  if (!isReminderPreferenceProfile(profile)) {
    throw new NotificationEngineError(
      "invalid-request",
      "Reminder preference profile failed structural validation (engine surfaces typed rejections before calling this).",
    );
  }
  const quietHours: QuietHoursSpec | null =
    profile.quietHours === undefined
      ? DEFAULT_QUIET_HOURS
      : profile.quietHours === null
        ? null
        : profile.quietHours.enabled
          ? profile.quietHours
          : null;
  return {
    remindersEnabled: profile.remindersEnabled,
    channels: profile.channels,
    quietHours,
    leadTimeMs: profile.leadTimeMs ?? DEFAULT_LEAD_TIME_MS,
    escalationGraceMs: profile.escalationGraceMs ?? DEFAULT_ESCALATION_GRACE_MS,
  };
}

/**
 * A ready-to-use default profile: reminders on, the default in-memory
 * channel, and the recorded default quiet hours + knobs (all fields the
 * engine resolves via their documented defaults).
 */
export const DEFAULT_REMINDER_PROFILE: ReminderPreferenceProfile = {
  remindersEnabled: true,
  channels: ["inmem"],
};
