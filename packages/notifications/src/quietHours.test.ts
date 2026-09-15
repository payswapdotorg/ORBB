import { describe, expect, it } from "vitest";
import {
  DEFAULT_QUIET_HOURS,
  MS_PER_DAY,
  deferToQuietEdge,
  isQuietHoursSpec,
  isQuietInstant,
  localMinuteOfDay,
  type QuietHoursSpec,
} from "./quietHours.js";

/** 22:00–07:00 local, at the given fixed UTC offset. */
function window2200To0700(utcOffsetMinutes: number): QuietHoursSpec {
  return {
    enabled: true,
    startMinuteOfDay: 22 * 60,
    endMinuteOfDay: 7 * 60,
    utcOffsetMinutes,
  };
}

/** 02:00–05:00 local (a NON-wrapping window), at UTC offset 0. */
const NON_WRAPPING: QuietHoursSpec = {
  enabled: true,
  startMinuteOfDay: 2 * 60,
  endMinuteOfDay: 5 * 60,
  utcOffsetMinutes: 0,
};

/** 1970-01-05 is a Monday; timestamps below are that week's absolute UTC ms. */
const MONDAY = Date.UTC(1970, 0, 5);
const TUESDAY = MONDAY + MS_PER_DAY;
const SUNDAY = Date.UTC(2024, 0, 7); // A genuine Sunday (week boundary).
const MONDAY_2024 = Date.UTC(2024, 0, 8);

const HOUR = MS_PER_DAY / 24;
const MINUTE = 60_000;

describe("B8 quiet hours — deferral table (UTC day edges, week boundaries, offsets)", () => {
  const cases: readonly {
    readonly name: string;
    readonly spec: QuietHoursSpec;
    readonly instantMs: number;
    readonly expectedMs: number;
  }[] = [
    {
      name: "midday instant is never deferred",
      spec: window2200To0700(0),
      instantMs: MONDAY + 12 * HOUR,
      expectedMs: MONDAY + 12 * HOUR,
    },
    {
      name: "08:00 local (after the edge) is not deferred",
      spec: window2200To0700(0),
      instantMs: MONDAY + 8 * HOUR,
      expectedMs: MONDAY + 8 * HOUR,
    },
    {
      name: "21:59 local (one minute before start) is not deferred",
      spec: window2200To0700(0),
      instantMs: MONDAY + 21 * HOUR + 59 * MINUTE,
      expectedMs: MONDAY + 21 * HOUR + 59 * MINUTE,
    },
    {
      name: "exactly 22:00 local IS quiet (half-open start) — deferred to the 07:00 edge",
      spec: window2200To0700(0),
      instantMs: MONDAY + 22 * HOUR,
      expectedMs: TUESDAY + 7 * HOUR,
    },
    {
      name: "exactly 07:00 local is NOT quiet (the edge itself is deliverable)",
      spec: window2200To0700(0),
      instantMs: MONDAY + 7 * HOUR,
      expectedMs: MONDAY + 7 * HOUR,
    },
    {
      name: "23:30 local defers to 07:00 the next local day (crosses the UTC day edge)",
      spec: window2200To0700(0),
      instantMs: MONDAY + 23 * HOUR + 30 * MINUTE,
      expectedMs: TUESDAY + 7 * HOUR,
    },
    {
      name: "03:00 local defers to 07:00 the same local day",
      spec: window2200To0700(0),
      instantMs: MONDAY + 3 * HOUR,
      expectedMs: MONDAY + 7 * HOUR,
    },
    {
      name: "06:59 local defers one minute forward to the edge",
      spec: window2200To0700(0),
      instantMs: MONDAY + 6 * HOUR + 59 * MINUTE,
      expectedMs: MONDAY + 7 * HOUR,
    },
    {
      name: "non-wrapping window 02:00–05:00: 03:00 defers to 05:00 the same day",
      spec: NON_WRAPPING,
      instantMs: MONDAY + 3 * HOUR,
      expectedMs: MONDAY + 5 * HOUR,
    },
    {
      name: "non-wrapping window 02:00–05:00: 01:30 is untouched",
      spec: NON_WRAPPING,
      instantMs: MONDAY + 90 * MINUTE,
      expectedMs: MONDAY + 90 * MINUTE,
    },
    {
      name: "UTC+05:30: local Mon 23:30 (= UTC Mon 18:00) defers to local Tue 07:00 (= UTC Tue 01:30)",
      spec: window2200To0700(330),
      instantMs: MONDAY + 18 * HOUR,
      expectedMs: TUESDAY + 90 * MINUTE,
    },
    {
      name: "UTC-08:00: local Mon 23:30 (= UTC Tue 07:30) defers to local Tue 07:00 (= UTC Tue 15:00)",
      spec: window2200To0700(-480),
      instantMs: TUESDAY + 7 * HOUR + 30 * MINUTE,
      expectedMs: TUESDAY + 15 * HOUR,
    },
    {
      name: "week boundary: Sunday 23:30 local defers to Monday 07:00 local",
      spec: window2200To0700(0),
      instantMs: SUNDAY + 23 * HOUR + 30 * MINUTE,
      expectedMs: MONDAY_2024 + 7 * HOUR,
    },
    {
      name: "week boundary: Sunday 03:00 local defers to the SAME Sunday 07:00 edge",
      spec: window2200To0700(0),
      instantMs: SUNDAY + 3 * HOUR,
      expectedMs: SUNDAY + 7 * HOUR,
    },
    {
      name: "a disabled spec never defers",
      spec: { ...window2200To0700(0), enabled: false },
      instantMs: MONDAY + 23 * HOUR + 30 * MINUTE,
      expectedMs: MONDAY + 23 * HOUR + 30 * MINUTE,
    },
  ];

  for (const testCase of cases) {
    it(testCase.name, () => {
      expect(deferToQuietEdge(testCase.instantMs, testCase.spec)).toBe(testCase.expectedMs);
      // Deferral only ever moves time FORWARD (defer, never drop).
      expect(deferToQuietEdge(testCase.instantMs, testCase.spec)).toBeGreaterThanOrEqual(
        testCase.instantMs,
      );
    });
  }
});

describe("B8 quiet hours — membership table (half-open, wrap-aware)", () => {
  const membership: readonly {
    readonly name: string;
    readonly spec: QuietHoursSpec;
    readonly instantMs: number;
    readonly expectedQuiet: boolean;
  }[] = [
    { name: "22:00 is quiet (start-inclusive)", spec: window2200To0700(0), instantMs: MONDAY + 22 * HOUR, expectedQuiet: true },
    { name: "07:00 is not quiet (end-exclusive edge)", spec: window2200To0700(0), instantMs: MONDAY + 7 * HOUR, expectedQuiet: false },
    { name: "21:59 is not quiet", spec: window2200To0700(0), instantMs: MONDAY + 21 * HOUR + 59 * MINUTE, expectedQuiet: false },
    { name: "06:59 is quiet", spec: window2200To0700(0), instantMs: MONDAY + 6 * HOUR + 59 * MINUTE, expectedQuiet: true },
    { name: "12:00 is not quiet", spec: window2200To0700(0), instantMs: MONDAY + 12 * HOUR, expectedQuiet: false },
    { name: "UTC+05:30: UTC 18:30 is local midnight — quiet", spec: window2200To0700(330), instantMs: MONDAY + 18 * HOUR + 30 * MINUTE, expectedQuiet: true },
    { name: "disabled spec is never quiet", spec: { ...window2200To0700(0), enabled: false }, instantMs: MONDAY + 23 * HOUR, expectedQuiet: false },
  ];

  for (const testCase of membership) {
    it(testCase.name, () => {
      expect(isQuietInstant(testCase.instantMs, testCase.spec)).toBe(testCase.expectedQuiet);
    });
  }
});

describe("B8 quiet hours — local minute math + spec validation", () => {
  it("computes the local minute of day under positive and negative offsets", () => {
    expect(localMinuteOfDay(MONDAY + 18 * HOUR, 330)).toBe(23 * 60 + 30); // UTC 18:00 = local 23:30
    expect(localMinuteOfDay(MONDAY + 7 * HOUR + 30 * MINUTE, -480)).toBe(23 * 60 + 30); // UTC Tue 07:30 = local Mon 23:30
    expect(localMinuteOfDay(MONDAY + 12 * HOUR, 0)).toBe(12 * 60);
    // Negative-shift normalization: epoch 0 at UTC-12 is local 12:00 the
    // PREVIOUS day — the double-mod keeps the minute correct.
    expect(localMinuteOfDay(0, -720)).toBe(12 * 60);
  });

  it("accepts the recorded default spec and rejects degenerate/invalid specs", () => {
    expect(isQuietHoursSpec(DEFAULT_QUIET_HOURS)).toBe(true);
    expect(DEFAULT_QUIET_HOURS.startMinuteOfDay).toBe(22 * 60);
    expect(DEFAULT_QUIET_HOURS.endMinuteOfDay).toBe(7 * 60);
    expect(DEFAULT_QUIET_HOURS.utcOffsetMinutes).toBe(0);
    // Degenerate empty interval [s, s) is a configuration error.
    expect(
      isQuietHoursSpec({ enabled: true, startMinuteOfDay: 300, endMinuteOfDay: 300, utcOffsetMinutes: 0 }),
    ).toBe(false);
    // Out-of-range minutes / offsets are rejected.
    expect(
      isQuietHoursSpec({ enabled: true, startMinuteOfDay: 1440, endMinuteOfDay: 420, utcOffsetMinutes: 0 }),
    ).toBe(false);
    expect(
      isQuietHoursSpec({ enabled: true, startMinuteOfDay: 1320, endMinuteOfDay: 1440, utcOffsetMinutes: 0 }),
    ).toBe(false);
    expect(
      isQuietHoursSpec({ enabled: true, startMinuteOfDay: 1320, endMinuteOfDay: 420, utcOffsetMinutes: 841 }),
    ).toBe(false);
    expect(
      isQuietHoursSpec({ enabled: true, startMinuteOfDay: 1320, endMinuteOfDay: 420, utcOffsetMinutes: -721 }),
    ).toBe(false);
  });
});
