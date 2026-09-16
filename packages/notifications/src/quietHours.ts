/**
 * Quiet-hours mathematics — pure UTC millisecond arithmetic against a
 * fixed local-of-record offset (the deterministic, tz-database-free model
 * recorded in `preferences.ts`).
 *
 * SEMANTICS (the B8 "defer, never drop" rule):
 *   - A reminder instant that falls INSIDE the (half-open) quiet window
 *     `[startMinuteOfDayLocal, endMinuteOfDayLocal)` of local-of-record
 *     time is DEFERRED to the next quiet-END edge — the earliest instant
 *     >= the original whose local minute-of-day equals the end minute.
 *     The reminder is never dropped: it stays in the schedule with its
 *     deferred (edge) send time, and the deferral is recorded on the
 *     reminder (`deferredFrom`).
 *   - The quiet end edge itself is NOT quiet (half-open window), so a
 *     reminder at exactly the edge sends immediately.
 *   - Disabled quiet hours (`enabled: false`) never defer.
 *
 * All functions are pure: identical inputs => identical outputs, no
 * mutation, no I/O, no wall clock.
 */
import { MS_PER_DAY, MS_PER_MINUTE, type QuietHoursSpec } from "./preferences.js";

/** Result of a quiet-hours deferral decision. */
export interface QuietHoursResolution {
  /** Effective send instant (the quiet-end edge when deferred, otherwise the input instant). */
  readonly sendAtMs: number;
  /** `true` exactly when the input instant was inside the quiet window and got deferred. */
  readonly deferred: boolean;
}

/** Floor-mod that stays correct for negative dividends (defensive). */
function floorMod(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

/**
 * Minute of the local-of-record day for an instant: an integer in
 * [0, 1439]. Pure UTC arithmetic plus the fixed offset — DST-free by
 * construction.
 */
export function localMinuteOfDay(instantMs: number, offsetMinutes: number): number {
  const localMs = instantMs + offsetMinutes * MS_PER_MINUTE;
  return Math.floor(floorMod(localMs, MS_PER_DAY) / MS_PER_MINUTE);
}

/**
 * Is this local minute-of-day inside the (half-open) quiet window?
 * A window with `start < end` does not wrap midnight; the default
 * 22:00 -> 07:00 window wraps (`start > end`). `start === end` is
 * rejected by preference validation and never reaches this function.
 */
export function isInsideQuietHours(minuteOfDayLocal: number, spec: QuietHoursSpec): boolean {
  if (!spec.enabled) {
    return false;
  }
  const { startMinuteOfDayLocal: start, endMinuteOfDayLocal: end } = spec;
  if (start < end) {
    return minuteOfDayLocal >= start && minuteOfDayLocal < end;
  }
  // Wrapping window (start > end): quiet from `start` to midnight AND
  // from midnight to `end`.
  return minuteOfDayLocal >= start || minuteOfDayLocal < end;
}

/**
 * Applies the defer-not-drop rule to a planned send instant:
 *   - outside quiet hours (or quiet hours disabled) => unchanged;
 *   - inside quiet hours => the next quiet-end edge (local-of-record).
 *
 * The edge is computed in local time and converted back to UTC, so the
 * result is exact even for offsets that are not whole hours.
 */
export function deferForQuietHours(
  instantMs: number,
  spec: QuietHoursSpec,
  offsetMinutes: number,
): QuietHoursResolution {
  if (!spec.enabled) {
    return { sendAtMs: instantMs, deferred: false };
  }
  const offsetMs = offsetMinutes * MS_PER_MINUTE;
  const localMs = instantMs + offsetMs;
  const minute = Math.floor(floorMod(localMs, MS_PER_DAY) / MS_PER_MINUTE);
  if (!isInsideQuietHours(minute, spec)) {
    return { sendAtMs: instantMs, deferred: false };
  }
  const localDayStartMs = Math.floor(localMs / MS_PER_DAY) * MS_PER_DAY;
  let edgeLocalMs = localDayStartMs + spec.endMinuteOfDayLocal * MS_PER_MINUTE;
  if (edgeLocalMs <= localMs) {
    edgeLocalMs += MS_PER_DAY;
  }
  return { sendAtMs: edgeLocalMs - offsetMs, deferred: true };
}
