/**
 * B8 — Reminder preference profile (the "user preference profile" input of
 * the notification engine).
 *
 * RECORDED DESIGN DECISIONS / ASSUMPTIONS:
 *
 * - Quiet hours are PREFERENCE-GATED with a default: when no narrower
 *   preference has been recorded, the engine assumes no reminders are sent
 *   between 22:00 and 07:00 in the person's LOCAL-OF-RECORD time. Reminders
 *   whose nominal send instant falls inside quiet hours are DEFERRED to the
 *   closing edge (07:00) — never dropped silently (see `quiet-hours.ts`).
 *
 * - "Local-of-record" is modeled as a FIXED UTC offset in minutes
 *   ([-720, +840], i.e. UTC-12:00 .. UTC+14:00). Recorded assumption:
 *   DST-aware IANA zones are a deployment/presentation concern; the engine
 *   itself stays pure UTC millisecond arithmetic (the `@orbb/measurement`
 *   scheduler precedent — DST-free by construction).
 *
 * - `remindersEnabled: false` is the master gate: no reminders at all (the
 *   gentle, non-punishing stance — reminders nudge, they never punish,
 *   never gamify). Per-channel entries override; channels NOT listed in
 *   `channelPreferences` default to ENABLED (the deployment wires only
 *   channels the person actually has; opt-out is per-channel).
 *
 * - `leadMinutes` (how long before the window's due instant the upcoming
 *   REMIND rung fires) defaults to 60; `escalationDelayMinutes` (how long
 *   after a missed window before the escalation rung fires) defaults to 30.
 *   Both are per-person preferences with engine-side bounds (0 .. 30 days).
 */
import type { PersonId } from "@orbb/domain";

/** Default quiet-hours start (local minutes-of-day): 22:00. */
export const DEFAULT_QUIET_HOURS_START_LOCAL_MINUTES = 22 * 60;

/** Default quiet-hours end (local minutes-of-day): 07:00. */
export const DEFAULT_QUIET_HOURS_END_LOCAL_MINUTES = 7 * 60;

/** Default upcoming-due reminder lead, in minutes (recorded assumption). */
export const DEFAULT_REMINDER_LEAD_MINUTES = 60;

/** Default missed-window escalation delay, in minutes (recorded assumption). */
export const DEFAULT_ESCALATION_DELAY_MINUTES = 30;

/** Minimum local UTC offset accepted for local-of-record: UTC-12:00. */
export const MIN_LOCAL_UTC_OFFSET_MINUTES = -720;

/** Maximum local UTC offset accepted for local-of-record: UTC+14:00. */
export const MAX_LOCAL_UTC_OFFSET_MINUTES = 840;

/** Upper bound for per-person lead/escalation preferences: 30 days. */
export const MAX_TIMING_PREFERENCE_MINUTES = 43_200;

/** Minutes in one local day. */
export const MINUTES_PER_DAY = 1_440;

/**
 * Quiet-hours specification in local-of-record minutes-of-day. The window
 * is half-open `[startLocalMinutes, endLocalMinutes)`; a start later than
 * the end wraps midnight (e.g. 22:00 → 07:00). A degenerate zero-length
 * window (start === end) is treated as disabled.
 */
export interface QuietHoursSpec {
  readonly enabled: boolean;
  readonly startLocalMinutes: number;
  readonly endLocalMinutes: number;
}

/** One per-channel reminder preference override. */
export interface ChannelPreference {
  readonly channelId: string;
  readonly enabled: boolean;
}

/**
 * The per-person reminder preference profile consumed by
 * `ReminderEngine.computeSchedule` / `dispatchDue`.
 */
export interface ReminderPreferences {
  readonly personId: PersonId;
  /** Master gate — `false` disables every reminder for the person. */
  readonly remindersEnabled: boolean;
  /** Quiet hours window (preference-gated; default 22:00–07:00). */
  readonly quietHours: QuietHoursSpec;
  /** Local-of-record as a fixed UTC offset in minutes ([-720, +840]). */
  readonly localUtcOffsetMinutes: number;
  /** Lead before the window due instant for the REMIND rung. Default 60. */
  readonly leadMinutes: number;
  /** Delay after a missed window before the escalation rung. Default 30. */
  readonly escalationDelayMinutes: number;
  /** Per-channel overrides; unlisted channels default to enabled. */
  readonly channelPreferences: readonly ChannelPreference[];
}

/** The recorded default quiet-hours window: 22:00–07:00, enabled. */
export function defaultQuietHours(): QuietHoursSpec {
  return {
    enabled: true,
    startLocalMinutes: DEFAULT_QUIET_HOURS_START_LOCAL_MINUTES,
    endLocalMinutes: DEFAULT_QUIET_HOURS_END_LOCAL_MINUTES,
  };
}

/**
 * Builds the default preference profile for a person: reminders enabled,
 * quiet hours 22:00–07:00 local-of-record at UTC+0, lead 60 min,
 * escalation delay 30 min, no per-channel overrides.
 */
export function defaultReminderPreferences(personId: PersonId): ReminderPreferences {
  return {
    personId,
    remindersEnabled: true,
    quietHours: defaultQuietHours(),
    localUtcOffsetMinutes: 0,
    leadMinutes: DEFAULT_REMINDER_LEAD_MINUTES,
    escalationDelayMinutes: DEFAULT_ESCALATION_DELAY_MINUTES,
    channelPreferences: [],
  };
}

/** Type guard: is `value` a structurally valid {@link QuietHoursSpec}? */
export function isQuietHoursSpec(value: unknown): value is QuietHoursSpec {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<QuietHoursSpec>;
  return (
    typeof candidate.enabled === "boolean" &&
    typeof candidate.startLocalMinutes === "number" &&
    Number.isInteger(candidate.startLocalMinutes) &&
    candidate.startLocalMinutes >= 0 &&
    candidate.startLocalMinutes < MINUTES_PER_DAY &&
    typeof candidate.endLocalMinutes === "number" &&
    Number.isInteger(candidate.endLocalMinutes) &&
    candidate.endLocalMinutes >= 0 &&
    candidate.endLocalMinutes < MINUTES_PER_DAY
  );
}
