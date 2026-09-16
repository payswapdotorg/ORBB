/**
 * Reminder preference profile — the per-person, preference-gated inputs of
 * the reminder engine (B8).
 *
 * RECORDED ASSUMPTIONS (architecture-consistent, safest reading):
 *
 * Local-of-record time: quiet hours are defined against a FIXED UTC offset
 * (`localUtcOffsetMinutes`), not an IANA timezone identifier. Reason: the
 * engine is deterministic and pure (zero runtime dependencies — no tz
 * database), and the measurement scheduler it computes from is likewise
 * pure UTC millisecond arithmetic. A tz-database-aware offset resolver is
 * a later integration seam (handoff recorded in the README). Valid range
 * mirrors real-world UTC offsets: [-720, +840] minutes.
 *
 * Quiet hours default: when `quietHours` is omitted, the profile is
 * treated as "no reminders 22:00–07:00 local-of-record" (the packet's
 * default assumption, recorded here). Quiet hours are preference-GATED:
 * `enabled: false` disables deferral entirely, and custom start/end
 * minutes are honored. Reminders due inside quiet hours are DEFERRED to
 * the quiet-end edge — never dropped silently (see `quietHours.ts`).
 *
 * Escalation timing defaults: the upcoming-due reminder fires
 * `upcomingLeadMs` (default 1 hour) before the measurement window closes;
 * the fallback-offer rung becomes current `escalationAfterMs` (default
 * 24 hours) after the window closes. Both are profile-overridable so
 * product tuning never touches engine code.
 */
import { isPersonId, type PersonId } from "@orbb/domain";

/** One minute in milliseconds (pure UTC arithmetic). */
export const MS_PER_MINUTE = 60_000;

/** One day in milliseconds (pure UTC arithmetic, DST-free by construction). */
export const MS_PER_DAY = 86_400_000;

/**
 * Quiet hours: a half-open window `[startMinuteOfDayLocal,
 * endMinuteOfDayLocal)` in MINUTES of local-of-record time. The default
 * window (22:00 -> 07:00) WRAPS midnight; a custom window with
 * `start < end` does not. `start === end` is degenerate and rejected.
 */
export interface QuietHoursSpec {
  readonly enabled: boolean;
  /** Quiet start, minutes since local midnight: integer in [0, 1439]. */
  readonly startMinuteOfDayLocal: number;
  /** Quiet end (exclusive edge), minutes since local midnight: integer in [0, 1439], !== start. */
  readonly endMinuteOfDayLocal: number;
}

/** The packet's recorded default: no reminders 22:00–07:00 local-of-record. */
export const DEFAULT_QUIET_HOURS: QuietHoursSpec = {
  enabled: true,
  startMinuteOfDayLocal: 22 * 60,
  endMinuteOfDayLocal: 7 * 60,
};

/** Default lead time of the upcoming-due reminder before the window closes. */
export const DEFAULT_UPCOMING_LEAD_MS = 3_600_000;

/** Default grace after a missed window before the fallback-offer rung. */
export const DEFAULT_ESCALATION_AFTER_MS = 86_400_000;

// ---------------------------------------------------------------------------
// Channel recipient reference.
// ---------------------------------------------------------------------------

declare const channelRecipientBrand: unique symbol;

/**
 * An opaque, channel-scoped recipient REFERENCE (e.g. a push-subscription
 * token reference or an email-address reference). It is routing metadata
 * for the channel adapter, resolved to a real address INSIDE the provider
 * seam — the engine never sees, stores, or logs a raw address. PHID-safe
 * by construction: the engine only passes it through.
 */
export type ChannelRecipient = string & {
  readonly [channelRecipientBrand]: "ChannelRecipient";
};

/** Prefix-free helper: builds a branded recipient reference from a string. */
export function channelRecipient(value: string): ChannelRecipient {
  return value as ChannelRecipient;
}

// ---------------------------------------------------------------------------
// Preference profile.
// ---------------------------------------------------------------------------

/**
 * The per-person reminder preference profile. All engine gates are
 * preference-driven: reminders can be switched off entirely, channels are
 * enabled explicitly (deny-by-default), and quiet hours defer — never
 * drop — reminders.
 */
export interface ReminderPreferenceProfile {
  readonly personId: PersonId;
  /** Master gate: `false` produces an empty schedule (accounted, never silent). */
  readonly remindersEnabled: boolean;
  /** Explicitly enabled channel ids (deny-by-default: a channel not listed never receives a reminder). */
  readonly enabledChannelIds: readonly string[];
  /** Per-channel recipient references for the enabled channels. */
  readonly channelRecipients: Readonly<Record<string, ChannelRecipient>>;
  /** Fixed UTC offset of the person's local-of-record time, in minutes ([-720, 840]). */
  readonly localUtcOffsetMinutes: number;
  /** Omitted => {@link DEFAULT_QUIET_HOURS} (22:00–07:00 local-of-record). */
  readonly quietHours?: QuietHoursSpec;
  /** Omitted => {@link DEFAULT_UPCOMING_LEAD_MS} (1 hour). */
  readonly upcomingLeadMs?: number;
  /** Omitted => {@link DEFAULT_ESCALATION_AFTER_MS} (24 hours). */
  readonly escalationAfterMs?: number;
}

/** Profile fields a {@link PreferenceViolation} can name (structural, PHID-safe). */
export type PreferenceField =
  | "personId"
  | "remindersEnabled"
  | "enabledChannelIds"
  | "channelRecipients"
  | "localUtcOffsetMinutes"
  | "quietHours"
  | "upcomingLeadMs"
  | "escalationAfterMs";

/** Structural preference violation (the offending VALUE is never echoed). */
export interface PreferenceViolation {
  readonly kind: "invalid-preference";
  readonly field: PreferenceField;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPlainBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** Type-guarding integer range check (keeps `unknown` narrowing sound). */
function isIntegerInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

/**
 * Structurally validates a {@link ReminderPreferenceProfile}. Returns the
 * first violation, or `undefined` when the profile is well-formed. Pure;
 * received values are never echoed.
 */
export function validatePreferenceProfile(
  profile: unknown,
): PreferenceViolation | undefined {
  if (!isRecord(profile)) {
    return { kind: "invalid-preference", field: "personId" };
  }
  if (!isPersonId(profile.personId)) {
    return { kind: "invalid-preference", field: "personId" };
  }
  if (!isPlainBoolean(profile.remindersEnabled)) {
    return { kind: "invalid-preference", field: "remindersEnabled" };
  }
  if (!Array.isArray(profile.enabledChannelIds)) {
    return { kind: "invalid-preference", field: "enabledChannelIds" };
  }
  const seenChannelIds = new Set<string>();
  for (const channelId of profile.enabledChannelIds) {
    if (!isNonEmptyString(channelId)) {
      return { kind: "invalid-preference", field: "enabledChannelIds" };
    }
    if (seenChannelIds.has(channelId)) {
      return { kind: "invalid-preference", field: "enabledChannelIds" };
    }
    seenChannelIds.add(channelId);
  }
  if (!isRecord(profile.channelRecipients)) {
    return { kind: "invalid-preference", field: "channelRecipients" };
  }
  for (const recipient of Object.values(profile.channelRecipients)) {
    if (!isNonEmptyString(recipient)) {
      return { kind: "invalid-preference", field: "channelRecipients" };
    }
  }
  const { localUtcOffsetMinutes, quietHours, upcomingLeadMs, escalationAfterMs } = profile;
  if (!isIntegerInRange(localUtcOffsetMinutes, -720, 840)) {
    return { kind: "invalid-preference", field: "localUtcOffsetMinutes" };
  }
  if (quietHours !== undefined) {
    if (!isRecord(quietHours)) {
      return { kind: "invalid-preference", field: "quietHours" };
    }
    if (!isPlainBoolean(quietHours.enabled)) {
      return { kind: "invalid-preference", field: "quietHours" };
    }
    const { startMinuteOfDayLocal: start, endMinuteOfDayLocal: end } = quietHours;
    if (
      !isIntegerInRange(start, 0, 1439) ||
      !isIntegerInRange(end, 0, 1439) ||
      start === end
    ) {
      return { kind: "invalid-preference", field: "quietHours" };
    }
  }
  if (upcomingLeadMs !== undefined && !isIntegerInRange(upcomingLeadMs, 1, Number.MAX_SAFE_INTEGER)) {
    return { kind: "invalid-preference", field: "upcomingLeadMs" };
  }
  if (escalationAfterMs !== undefined && !isIntegerInRange(escalationAfterMs, 0, Number.MAX_SAFE_INTEGER)) {
    return { kind: "invalid-preference", field: "escalationAfterMs" };
  }
  return undefined;
}

/** Resolves the effective quiet-hours spec (default when omitted). */
export function resolveQuietHours(profile: ReminderPreferenceProfile): QuietHoursSpec {
  return profile.quietHours ?? DEFAULT_QUIET_HOURS;
}

/** Resolves the effective upcoming-due lead time (default when omitted). */
export function resolveUpcomingLeadMs(profile: ReminderPreferenceProfile): number {
  return profile.upcomingLeadMs ?? DEFAULT_UPCOMING_LEAD_MS;
}

/** Resolves the effective escalation grace (default when omitted). */
export function resolveEscalationAfterMs(profile: ReminderPreferenceProfile): number {
  return profile.escalationAfterMs ?? DEFAULT_ESCALATION_AFTER_MS;
}
