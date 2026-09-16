import { describe, expect, it } from "vitest";
import { defaultQuietHours } from "./preferences.js";
import type { QuietHoursSpec } from "./preferences.js";
import { deferToQuietHoursEdge, isQuietInstant, localMinutesOfDay } from "./quiet-hours.js";

const DEFAULT_QUIET = defaultQuietHours();

/** Same-day (non-wrapping) quiet window for wrap-around contrast. */
const SAME_DAY_QUIET: QuietHoursSpec = { enabled: true, startLocalMinutes: 60, endLocalMinutes: 300 };

/** Disabled quiet window (preference gate off). */
const DISABLED_QUIET: QuietHoursSpec = { enabled: false, startLocalMinutes: 1320, endLocalMinutes: 420 };

/** Degenerate zero-length window (recorded: treated as disabled). */
const DEGENERATE_QUIET: QuietHoursSpec = { enabled: true, startLocalMinutes: 1320, endLocalMinutes: 1320 };

const ms = (iso: string): number => new Date(iso).getTime();

describe("B8 quiet hours — local minutes-of-day", () => {
  it.each([
    { utcMs: 0, offsetMinutes: 0, expected: 0 },
    { utcMs: 0, offsetMinutes: 60, expected: 60 },
    { utcMs: 0, offsetMinutes: -60, expected: 1380 },
    { utcMs: ms("2026-06-10T12:34:00.000Z"), offsetMinutes: 0, expected: 12 * 60 + 34 },
    { utcMs: ms("2026-06-10T12:34:00.000Z"), offsetMinutes: 330, expected: 18 * 60 + 4 },
  ])("localMinutesOfDay($utcMs, $offsetMinutes) === $expected", ({ utcMs, offsetMinutes, expected }) => {
    expect(localMinutesOfDay(utcMs, offsetMinutes)).toBe(expected);
  });
});

describe("B8 quiet hours — isQuietInstant (table-driven)", () => {
  it.each([
    // Default 22:00–07:00 wrapping window, local = UTC (offset 0).
    { label: "23:30 local is quiet", iso: "2026-06-10T23:30:00.000Z", offset: 0, quiet: DEFAULT_QUIET, expected: true },
    { label: "03:00 local is quiet", iso: "2026-06-11T03:00:00.000Z", offset: 0, quiet: DEFAULT_QUIET, expected: true },
    { label: "22:00 local (the opening edge) is quiet — half-open [start, end)", iso: "2026-06-10T22:00:00.000Z", offset: 0, quiet: DEFAULT_QUIET, expected: true },
    { label: "06:59 local is quiet", iso: "2026-06-11T06:59:00.000Z", offset: 0, quiet: DEFAULT_QUIET, expected: true },
    { label: "07:00 local (the closing edge) is NOT quiet", iso: "2026-06-11T07:00:00.000Z", offset: 0, quiet: DEFAULT_QUIET, expected: false },
    { label: "21:59 local is NOT quiet", iso: "2026-06-10T21:59:00.000Z", offset: 0, quiet: DEFAULT_QUIET, expected: false },
    { label: "noon local is NOT quiet", iso: "2026-06-10T12:00:00.000Z", offset: 0, quiet: DEFAULT_QUIET, expected: false },
    // Offset shifts the local clock: UTC+1 makes 23:00 UTC == 00:00 local (quiet).
    { label: "UTC+1: 23:00 UTC is local midnight (quiet)", iso: "2026-06-10T23:00:00.000Z", offset: 60, quiet: DEFAULT_QUIET, expected: true },
    { label: "UTC+1: 05:59 UTC is local 06:59 (quiet)", iso: "2026-06-11T05:59:00.000Z", offset: 60, quiet: DEFAULT_QUIET, expected: true },
    { label: "UTC+1: 06:00 UTC is local 07:00 (NOT quiet)", iso: "2026-06-11T06:00:00.000Z", offset: 60, quiet: DEFAULT_QUIET, expected: false },
    // UTC-5: 04:00 UTC == 23:00 local the previous day (quiet).
    { label: "UTC-5: 04:00 UTC is local 23:00 (quiet)", iso: "2026-06-11T04:00:00.000Z", offset: -300, quiet: DEFAULT_QUIET, expected: true },
    { label: "UTC-5: 12:00 UTC is local 07:00 (NOT quiet)", iso: "2026-06-11T12:00:00.000Z", offset: -300, quiet: DEFAULT_QUIET, expected: false },
    // Same-day (non-wrapping) window 01:00–05:00.
    { label: "same-day window: 02:00 is quiet", iso: "2026-06-10T02:00:00.000Z", offset: 0, quiet: SAME_DAY_QUIET, expected: true },
    { label: "same-day window: 04:59 is quiet", iso: "2026-06-10T04:59:00.000Z", offset: 0, quiet: SAME_DAY_QUIET, expected: true },
    { label: "same-day window: 05:00 (closing edge) is NOT quiet", iso: "2026-06-10T05:00:00.000Z", offset: 0, quiet: SAME_DAY_QUIET, expected: false },
    { label: "same-day window: 00:59 is NOT quiet", iso: "2026-06-10T00:59:00.000Z", offset: 0, quiet: SAME_DAY_QUIET, expected: false },
    { label: "same-day window: 23:00 is NOT quiet (no midnight wrap)", iso: "2026-06-10T23:00:00.000Z", offset: 0, quiet: SAME_DAY_QUIET, expected: false },
    // Preference gate off and degenerate window.
    { label: "disabled quiet hours: 23:30 is NOT quiet", iso: "2026-06-10T23:30:00.000Z", offset: 0, quiet: DISABLED_QUIET, expected: false },
    { label: "disabled quiet hours: 03:00 is NOT quiet", iso: "2026-06-11T03:00:00.000Z", offset: 0, quiet: DISABLED_QUIET, expected: false },
    { label: "degenerate zero-length window is NOT quiet", iso: "2026-06-10T22:00:00.000Z", offset: 0, quiet: DEGENERATE_QUIET, expected: false },
  ])("$label", ({ iso, offset, quiet, expected }) => {
    expect(isQuietInstant(ms(iso), quiet, offset)).toBe(expected);
  });
});

describe("B8 quiet hours — deferToQuietHoursEdge (defer, never drop)", () => {
  it.each([
    // Default 22:00–07:00 window.
    { label: "23:30 defers to next 07:00", iso: "2026-06-10T23:30:00.000Z", offset: 0, quiet: DEFAULT_QUIET, expected: "2026-06-11T07:00:00.000Z" },
    { label: "03:00 defers to same-day 07:00", iso: "2026-06-11T03:00:00.000Z", offset: 0, quiet: DEFAULT_QUIET, expected: "2026-06-11T07:00:00.000Z" },
    { label: "22:00 (opening edge) defers to next 07:00", iso: "2026-06-10T22:00:00.000Z", offset: 0, quiet: DEFAULT_QUIET, expected: "2026-06-11T07:00:00.000Z" },
    { label: "06:59 defers one minute to 07:00", iso: "2026-06-11T06:59:00.000Z", offset: 0, quiet: DEFAULT_QUIET, expected: "2026-06-11T07:00:00.000Z" },
    { label: "21:59 is outside quiet hours — unchanged", iso: "2026-06-10T21:59:00.000Z", offset: 0, quiet: DEFAULT_QUIET, expected: "2026-06-10T21:59:00.000Z" },
    { label: "07:00 (closing edge) is outside quiet hours — unchanged", iso: "2026-06-11T07:00:00.000Z", offset: 0, quiet: DEFAULT_QUIET, expected: "2026-06-11T07:00:00.000Z" },
    // UTC day edge: a reminder at 23:59 crosses UTC midnight to the edge.
    { label: "23:59 crosses the UTC day edge to next 07:00", iso: "2026-06-10T23:59:00.000Z", offset: 0, quiet: DEFAULT_QUIET, expected: "2026-06-11T07:00:00.000Z" },
    // Week boundary: Friday 23:30 defers to Saturday 07:00.
    { label: "Friday 23:30 defers across the week boundary to Saturday 07:00", iso: "2026-06-12T23:30:00.000Z", offset: 0, quiet: DEFAULT_QUIET, expected: "2026-06-13T07:00:00.000Z" },
    { label: "Saturday 00:30 defers to Saturday 07:00", iso: "2026-06-13T00:30:00.000Z", offset: 0, quiet: DEFAULT_QUIET, expected: "2026-06-13T07:00:00.000Z" },
    // Offsets move the local edge: UTC-5 edge lands at 12:00 UTC.
    { label: "UTC-5: 04:00 UTC (local 23:00) defers to local 07:00 == 12:00 UTC", iso: "2026-06-11T04:00:00.000Z", offset: -300, quiet: DEFAULT_QUIET, expected: "2026-06-11T12:00:00.000Z" },
    { label: "UTC+1: 23:00 UTC (local 00:00) defers to local 07:00 == 06:00 UTC", iso: "2026-06-10T23:00:00.000Z", offset: 60, quiet: DEFAULT_QUIET, expected: "2026-06-11T06:00:00.000Z" },
    // Same-day window defers to its own closing edge.
    { label: "same-day window: 02:00 defers to 05:00 the same day", iso: "2026-06-10T02:00:00.000Z", offset: 0, quiet: SAME_DAY_QUIET, expected: "2026-06-10T05:00:00.000Z" },
    { label: "same-day window: 04:59 defers one minute to 05:00", iso: "2026-06-10T04:59:00.000Z", offset: 0, quiet: SAME_DAY_QUIET, expected: "2026-06-10T05:00:00.000Z" },
    // Preference gate off: never deferred.
    { label: "disabled quiet hours: 23:30 unchanged", iso: "2026-06-10T23:30:00.000Z", offset: 0, quiet: DISABLED_QUIET, expected: "2026-06-10T23:30:00.000Z" },
    { label: "degenerate window: 22:00 unchanged", iso: "2026-06-10T22:00:00.000Z", offset: 0, quiet: DEGENERATE_QUIET, expected: "2026-06-10T22:00:00.000Z" },
  ])("$label", ({ iso, offset, quiet, expected }) => {
    const deferred = deferToQuietHoursEdge(ms(iso), quiet, offset);
    expect(new Date(deferred).toISOString()).toBe(expected);
    // Deferral NEVER moves time backwards and NEVER drops the reminder.
    expect(deferred).toBeGreaterThanOrEqual(ms(iso));
    // The deferred instant itself is outside quiet hours.
    expect(isQuietInstant(deferred, quiet, offset)).toBe(false);
  });

  it("deferral across a UTC day edge never lands back inside quiet hours (rollover proof)", () => {
    // Sweep every minute of a full wrapping night; each deferred instant
    // must be the next 07:00 local and outside the window.
    const start = ms("2026-06-10T22:00:00.000Z");
    const end = ms("2026-06-11T07:00:00.000Z");
    for (let t = start; t < end; t += 60_000) {
      const deferred = deferToQuietHoursEdge(t, DEFAULT_QUIET, 0);
      expect(deferred).toBe(end);
      expect(deferred).toBeGreaterThan(t);
    }
    // The instant AT the edge is not deferred (half-open window).
    expect(deferToQuietHoursEdge(end, DEFAULT_QUIET, 0)).toBe(end);
  });
});
