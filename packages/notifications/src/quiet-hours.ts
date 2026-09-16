/**
 * B8 — Quiet-hours mathematics (pure, table-testable).
 *
 * RECORDED DESIGN DECISIONS / ASSUMPTIONS:
 *
 * - Default assumption (work order): no reminders 22:00–07:00
 *   LOCAL-OF-RECORD. The window is preference-gated (`QuietHoursSpec`) and
 *   modeled over a FIXED UTC offset (see `preferences.ts`): all arithmetic
 *   is pure UTC milliseconds, DST-free by construction (the A30 scheduler
 *   precedent).
 *
 * - DEFER, NEVER DROP: a reminder whose nominal send instant falls inside
 *   quiet hours is deferred FORWARD to the closing edge (the next
 *   occurrence of `endLocalMinutes` strictly after the nominal instant —
 *   for the default window, the next 07:00 local). The deferred reminder
 *   keeps its identity (derived from the nominal instant) and is simply
 *   dispatched later; nothing is ever silently discarded.
 *
 * - Half-open local window `[start, end)`: 07:00 local is NOT quiet (a
 *   reminder at exactly 07:00 local goes out immediately), 22:00 local IS
 *   quiet. A wrapping window (start > end, e.g. 22:00→07:00) is quiet from
 *   start through midnight into end. A degenerate zero-length window
 *   (start === end) is treated as disabled.
 *
 * - All minutes-of-day inputs are validated upstream (integers in
 *   [0, 1440)); the pure functions below still normalize defensively via
 *   true modular arithmetic (negative instants cannot produce negative
 *   remainders).
 */
import type { QuietHoursSpec } from "./preferences.js";

/** One millisecond/minute/hour/day in pure UTC arithmetic. */
export const MS_PER_MINUTE = 60_000;
export const MS_PER_HOUR = 3_600_000;
export const MS_PER_DAY = 86_400_000;

/** Minutes in one day. */
export const MINUTES_PER_DAY = 1_440;

/**
 * Local minutes-of-day of a UTC instant under a fixed local-of-record
 * offset (minutes). Deterministic pure arithmetic.
 */
export function localMinutesOfDay(utcMs: number, localUtcOffsetMinutes: number): number {
  const localMs = utcMs + localUtcOffsetMinutes * MS_PER_MINUTE;
  const dayMs = ((localMs % MS_PER_DAY) + MS_PER_DAY) % MS_PER_DAY;
  return Math.floor(dayMs / MS_PER_MINUTE);
}

/** Is the UTC instant inside the (half-open, possibly wrapping) quiet window? */
export function isQuietInstant(
  utcMs: number,
  quietHours: QuietHoursSpec,
  localUtcOffsetMinutes: number,
): boolean {
  if (!quietHours.enabled) {
    return false;
  }
  const { startLocalMinutes: start, endLocalMinutes: end } = quietHours;
  if (start === end) {
    // Degenerate zero-length window — treated as disabled (recorded).
    return false;
  }
  const minutes = localMinutesOfDay(utcMs, localUtcOffsetMinutes);
  if (start < end) {
    return minutes >= start && minutes < end;
  }
  // Wrapping window (e.g. 22:00–07:00): [start, 24:00) ∪ [00:00, end).
  return minutes >= start || minutes < end;
}

/**
 * DEFER-TO-EDGE: returns the instant at which a reminder whose nominal
 * send instant is `utcMs` should actually be sent. When quiet hours are
 * disabled or the instant is outside the window, the instant is returned
 * unchanged; otherwise the reminder is deferred forward to the next
 * closing edge (strictly after `utcMs` — deferral never moves time
 * backwards, and the returned edge is itself never quiet).
 */
export function deferToQuietHoursEdge(
  utcMs: number,
  quietHours: QuietHoursSpec,
  localUtcOffsetMinutes: number,
): number {
  if (!isQuietInstant(utcMs, quietHours, localUtcOffsetMinutes)) {
    return utcMs;
  }
  const { startLocalMinutes: start, endLocalMinutes: end } = quietHours;
  const minutes = localMinutesOfDay(utcMs, localUtcOffsetMinutes);
  let minutesAhead: number;
  if (start < end) {
    // Same-day window: the closing edge is `end` on the same local day.
    minutesAhead = end - minutes;
  } else if (minutes >= start) {
    // Wrapping window, after the evening start: edge is `end` next local day.
    minutesAhead = MINUTES_PER_DAY - minutes + end;
  } else {
    // Wrapping window, before the morning end: edge is `end` this local day.
    minutesAhead = end - minutes;
  }
  // minutesAhead is always >= 1 inside a half-open quiet window.
  const deferred = utcMs + minutesAhead * MS_PER_MINUTE;
  if (deferred <= utcMs || isQuietInstant(deferred, quietHours, localUtcOffsetMinutes)) {
    // Defensive: the deferral must move strictly forward and land outside
    // the quiet window (the closing edge is exclusive by construction).
    throw new RangeError("Quiet-hours deferral failed to land on the closing window edge.");
  }
  return deferred;
}
