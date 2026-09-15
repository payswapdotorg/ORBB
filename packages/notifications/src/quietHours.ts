/**
 * Quiet hours — preference-gated, pure-UTC deferral math (B8).
 *
 * RECORDED ASSUMPTION (the B8 packet's stated default): quiet hours are
 * 22:00–07:00 LOCAL-OF-RECORD. "Local-of-record" is expressed as a FIXED
 * UTC offset in minutes (no DST transitions — the same pure-UTC
 * discipline the A30 scheduler records for window math; an IANA
 * timezone-resolved local clock is an application-boundary concern and is
 * recorded as an integration handoff in README.md). When a preference
 * profile is silent about quiet hours, the engine applies this default;
 * a profile that sets `quietHours: null` (or `enabled: false`) disables
 * deferral entirely — quiet hours are PREFERENCE-GATED, never forced.
 *
 * DEFER, NEVER DROP: a reminder whose effective fire instant lands inside
 * the quiet interval is DEFERRED to the quiet-window EDGE (the end edge,
 * when quiet hours lift — 07:00 by default). The deferral is recorded on
 * the reminder payload (`defer.from` + reason `quiet-hours`) so the
 * defer-not-drop property is auditable; nothing is silently discarded.
 *
 * Interval semantics: half-open `[start, end)` over local minutes of day,
 * wrap-aware. A window whose start > end spans local midnight
 * (22:00–07:00). The END edge minute itself (07:00) is deliverable by
 * definition — "deferred to the window edge" means the reminder fires AT
 * the edge. The START edge minute (22:00) is quiet. A degenerate
 * `start === end` window is rejected at profile validation (an explicit
 * empty interval is a configuration error — fail-closed, never silent).
 *
 * All arithmetic is integer milliseconds on absolute UTC instants; the
 * offset only shifts the local-minute computation. Same inputs => same
 * outputs, always (table-driven tests cover UTC-day edges, week
 * boundaries, and offset extremes).
 */

/** One millisecond/day in pure UTC arithmetic (DST-free). */
export const MS_PER_DAY = 86_400_000;

/** One millisecond/minute. */
export const MS_PER_MINUTE = 60_000;

/**
 * Quiet-hours specification, in the user's local-of-record.
 *
 * Boundaries: minutes of day are integers in [0, 1439]; the UTC offset is
 * an integer in [-720, +840] (UTC-12 .. UTC+14 — the real-world offset
 * extremes).
 */
export interface QuietHoursSpec {
  /** Preference gate: `false` disables deferral (the spec is kept for audit). */
  readonly enabled: boolean;
  /** Local minute of day when quiet hours START (inclusive). */
  readonly startMinuteOfDay: number;
  /** Local minute of day when quiet hours END (exclusive — the defer edge). */
  readonly endMinuteOfDay: number;
  /** Fixed UTC offset of the local-of-record, in minutes [-720, 840]. */
  readonly utcOffsetMinutes: number;
}

/**
 * The RECORDED DEFAULT quiet-hours assumption: no reminders 22:00–07:00
 * local-of-record (UTC offset 0 when the profile is silent about the
 * offset as well — the offset is a property of the spec, so a silent
 * profile gets the documented default).
 */
export const DEFAULT_QUIET_HOURS: QuietHoursSpec = {
  enabled: true,
  startMinuteOfDay: 22 * 60,
  endMinuteOfDay: 7 * 60,
  utcOffsetMinutes: 0,
};

/** Type guard: is `value` a structurally valid {@link QuietHoursSpec}? */
export function isQuietHoursSpec(value: unknown): value is QuietHoursSpec {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const spec = value as Record<string, unknown>;
  if (typeof spec.enabled !== "boolean") {
    return false;
  }
  if (!isMinuteOfDay(spec.startMinuteOfDay) || !isMinuteOfDay(spec.endMinuteOfDay)) {
    return false;
  }
  const offset = spec.utcOffsetMinutes;
  if (
    typeof offset !== "number" ||
    !Number.isInteger(offset) ||
    offset < -720 ||
    offset > 840
  ) {
    return false;
  }
  // Degenerate empty interval [s, s) is a configuration error, not a spec.
  if (spec.enabled && spec.startMinuteOfDay === spec.endMinuteOfDay) {
    return false;
  }
  return true;
}

function isMinuteOfDay(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 1439;
}

/**
 * Local minute of day of an absolute UTC instant under a fixed offset.
 * Pure: the double-mod normalizes negative shifted values (offsets can
 * push the shifted instant below the epoch).
 */
export function localMinuteOfDay(instantMs: number, utcOffsetMinutes: number): number {
  const shifted = instantMs + utcOffsetMinutes * MS_PER_MINUTE;
  const withinDay = ((shifted % MS_PER_DAY) + MS_PER_DAY) % MS_PER_DAY;
  return Math.floor(withinDay / MS_PER_MINUTE);
}

/**
 * Does `instantMs` fall inside the (enabled) quiet interval? Half-open
 * `[start, end)` over local minutes, wrap-aware. A disabled spec is never
 * quiet.
 */
export function isQuietInstant(instantMs: number, spec: QuietHoursSpec): boolean {
  if (!spec.enabled) {
    return false;
  }
  const minute = localMinuteOfDay(instantMs, spec.utcOffsetMinutes);
  if (spec.startMinuteOfDay > spec.endMinuteOfDay) {
    // Wrapping window (e.g., 22:00–07:00): [start, 24:00) ∪ [0, end).
    return minute >= spec.startMinuteOfDay || minute < spec.endMinuteOfDay;
  }
  return minute >= spec.startMinuteOfDay && minute < spec.endMinuteOfDay;
}

/**
 * Defers `instantMs` to the next quiet-window END edge when it falls
 * inside the quiet interval; returns the instant unchanged otherwise.
 * Pure and total: the returned instant is always outside the quiet
 * interval, and deferral only ever moves time FORWARD (to the upcoming
 * edge — never dropped, never moved backwards).
 */
export function deferToQuietEdge(instantMs: number, spec: QuietHoursSpec): number {
  if (!isQuietInstant(instantMs, spec)) {
    return instantMs;
  }
  const offsetMs = spec.utcOffsetMinutes * MS_PER_MINUTE;
  // The local calendar day that contains the instant.
  const localDay = Math.floor((instantMs + offsetMs) / MS_PER_DAY);
  // Absolute instant of the end-edge on that local day.
  const edgeThisLocalDay = localDay * MS_PER_DAY + spec.endMinuteOfDay * MS_PER_MINUTE - offsetMs;
  return edgeThisLocalDay >= instantMs ? edgeThisLocalDay : edgeThisLocalDay + MS_PER_DAY;
}
