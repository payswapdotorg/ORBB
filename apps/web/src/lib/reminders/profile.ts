/**
 * Reminder preference profile mirror (M6 EXIT, Lane B) — the B8
 * `ReminderPreferenceProfile` knobs the journey-#7 schedule math reads.
 *
 * RECORDED ANCHORING (see `catalog.ts` for the full rationale): the
 * fixture session's local-of-record is the SESSION'S LOCAL TIMEZONE —
 * the same local clock the B4 today fixtures anchor task windows to —
 * expressed as the B8 fixed UTC offset resolved from the seeding
 * instant. This keeps the golden journey's quiet-hours facts
 * ("deferred to 07:00") timezone-independent on any machine.
 */

import type {
  TodayQuietHoursMirror,
  TodayReminderProfileMirror,
} from "./types";

/** One millisecond per minute (the B8 `MS_PER_MINUTE` mirror). */
export const MS_PER_MINUTE = 60_000;

/** One millisecond per day (the B8 `MS_PER_DAY` mirror). */
export const MS_PER_DAY = 86_400_000;

/** The B8 recorded default upcoming-due lead time: 60 minutes. */
export const TODAY_LEAD_TIME_MS = 3_600_000;

/** The B8 recorded default missed-window escalation grace: 60 minutes. */
export const TODAY_ESCALATION_GRACE_MS = 3_600_000;

/**
 * The session's local-of-record UTC offset in minutes
 * (east-positive — the B8 `QuietHoursSpec.utcOffsetMinutes` convention).
 * Resolved from the seeding instant; fixed for the session (DST-free,
 * the B8 pure-UTC discipline; IANA-zone resolution is the recorded
 * application-boundary handoff in the B8 package).
 */
export function localOffsetMinutes(at: Date): number {
  return -at.getTimezoneOffset();
}

/**
 * The active quiet-hours spec: the B8 recorded default 22:00–07:00
 * local-of-record, enabled (preference-gated; defer-to-edge, never drop).
 */
export function todayQuietHours(at: Date): TodayQuietHoursMirror {
  return {
    enabled: true,
    startMinuteOfDay: 22 * 60,
    endMinuteOfDay: 7 * 60,
    utcOffsetMinutes: localOffsetMinutes(at),
  };
}

/**
 * The active reminder profile mirror: reminders enabled, quiet hours ON
 * (the recorded default), and the recorded B8 lead/grace defaults.
 */
export function todayReminderProfile(at: Date): TodayReminderProfileMirror {
  return {
    remindersEnabled: true,
    quietHours: todayQuietHours(at),
    leadTimeMs: TODAY_LEAD_TIME_MS,
    escalationGraceMs: TODAY_ESCALATION_GRACE_MS,
  };
}
