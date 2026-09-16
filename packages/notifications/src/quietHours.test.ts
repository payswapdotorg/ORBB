import { describe, expect, it } from "vitest";
import { DEFAULT_QUIET_HOURS, type QuietHoursSpec } from "./preferences.js";
import { deferForQuietHours, isInsideQuietHours, localMinuteOfDay } from "./quietHours.js";

const at = (iso: string): number => Date.parse(iso);

describe("quiet hours — local minute-of-day", () => {
  it.each([
    { iso: "2024-01-02T00:00:00.000Z", offset: 0, expected: 0 },
    { iso: "2024-01-02T00:00:00.000Z", offset: 60, expected: 60 },
    { iso: "2024-01-02T00:00:00.000Z", offset: -60, expected: 1380 },
    { iso: "2024-01-02T18:30:00.000Z", offset: 330, expected: 0 },
    { iso: "2024-01-02T23:59:59.999Z", offset: 0, expected: 1439 },
  ])("localMinuteOfDay($iso, $offset) === $expected", ({ iso, offset, expected }) => {
    expect(localMinuteOfDay(at(iso), offset)).toBe(expected);
  });
});

describe("quiet hours — window membership (half-open, wrap-aware)", () => {
  it.each([
    // Default 22:00 -> 07:00 wraps midnight.
    { minute: 1320, expected: true },
    { minute: 1439, expected: true },
    { minute: 0, expected: true },
    { minute: 419, expected: true },
    { minute: 420, expected: false },
    { minute: 1319, expected: false },
  ])("default window: minute $minute inside=$expected", ({ minute, expected }) => {
    expect(isInsideQuietHours(minute, DEFAULT_QUIET_HOURS)).toBe(expected);
  });

  it("a non-wrapping custom window [13:00, 15:30) is half-open", () => {
    const spec: QuietHoursSpec = {
      enabled: true,
      startMinuteOfDayLocal: 13 * 60,
      endMinuteOfDayLocal: 15 * 60 + 30,
    };
    expect(isInsideQuietHours(13 * 60, spec)).toBe(true);
    expect(isInsideQuietHours(15 * 60 + 29, spec)).toBe(true);
    expect(isInsideQuietHours(15 * 60 + 30, spec)).toBe(false);
    expect(isInsideQuietHours(13 * 60 - 1, spec)).toBe(false);
  });

  it("a disabled spec is never inside quiet hours", () => {
    const disabled: QuietHoursSpec = { ...DEFAULT_QUIET_HOURS, enabled: false };
    for (const minute of [0, 300, 1320, 1439]) {
      expect(isInsideQuietHours(minute, disabled)).toBe(false);
    }
  });
});

describe("quiet hours — defer-not-drop mathematics (table-driven)", () => {
  it.each([
    {
      name: "midday is untouched",
      iso: "2024-01-02T12:00:00.000Z",
      offset: 0,
      spec: DEFAULT_QUIET_HOURS,
      deferred: false,
      sendAt: "2024-01-02T12:00:00.000Z",
    },
    {
      name: "late evening defers to the next quiet-end edge",
      iso: "2024-01-02T23:30:00.000Z",
      offset: 0,
      spec: DEFAULT_QUIET_HOURS,
      deferred: true,
      sendAt: "2024-01-03T07:00:00.000Z",
    },
    {
      name: "one millisecond before the edge still defers to the edge",
      iso: "2024-01-02T06:59:59.999Z",
      offset: 0,
      spec: DEFAULT_QUIET_HOURS,
      deferred: true,
      sendAt: "2024-01-02T07:00:00.000Z",
    },
    {
      name: "the edge itself is not quiet (half-open)",
      iso: "2024-01-02T07:00:00.000Z",
      offset: 0,
      spec: DEFAULT_QUIET_HOURS,
      deferred: false,
      sendAt: "2024-01-02T07:00:00.000Z",
    },
    {
      name: "one millisecond before quiet start is untouched",
      iso: "2024-01-02T21:59:59.999Z",
      offset: 0,
      spec: DEFAULT_QUIET_HOURS,
      deferred: false,
      sendAt: "2024-01-02T21:59:59.999Z",
    },
    {
      name: "the quiet start defers to the next edge",
      iso: "2024-01-02T22:00:00.000Z",
      offset: 0,
      spec: DEFAULT_QUIET_HOURS,
      deferred: true,
      sendAt: "2024-01-03T07:00:00.000Z",
    },
    {
      name: "early morning (wrapped window) defers to the same-day edge",
      iso: "2024-01-02T00:30:00.000Z",
      offset: 0,
      spec: DEFAULT_QUIET_HOURS,
      deferred: true,
      sendAt: "2024-01-02T07:00:00.000Z",
    },
    {
      name: "UTC+05:30 offset: local midnight defers to local 07:00 (01:30Z)",
      iso: "2024-01-02T18:30:00.000Z",
      offset: 330,
      spec: DEFAULT_QUIET_HOURS,
      deferred: true,
      sendAt: "2024-01-03T01:30:00.000Z",
    },
    {
      name: "UTC-05:00 offset: local 22:00 defers to local 07:00 (12:00Z)",
      iso: "2024-01-02T03:00:00.000Z",
      offset: -300,
      spec: DEFAULT_QUIET_HOURS,
      deferred: true,
      sendAt: "2024-01-02T12:00:00.000Z",
    },
    {
      name: "custom non-wrapping window defers to its end edge",
      iso: "2024-01-02T14:00:00.000Z",
      offset: 0,
      spec: {
        enabled: true,
        startMinuteOfDayLocal: 13 * 60,
        endMinuteOfDayLocal: 15 * 60 + 30,
      } satisfies QuietHoursSpec,
      deferred: true,
      sendAt: "2024-01-02T15:30:00.000Z",
    },
    {
      name: "custom window end edge is not quiet",
      iso: "2024-01-02T15:30:00.000Z",
      offset: 0,
      spec: {
        enabled: true,
        startMinuteOfDayLocal: 13 * 60,
        endMinuteOfDayLocal: 15 * 60 + 30,
      } satisfies QuietHoursSpec,
      deferred: false,
      sendAt: "2024-01-02T15:30:00.000Z",
    },
    {
      name: "disabled quiet hours never defer",
      iso: "2024-01-02T23:30:00.000Z",
      offset: 0,
      spec: { ...DEFAULT_QUIET_HOURS, enabled: false } satisfies QuietHoursSpec,
      deferred: false,
      sendAt: "2024-01-02T23:30:00.000Z",
    },
  ])(
    "$name",
    ({ iso, offset, spec, deferred, sendAt }) => {
      const resolution = deferForQuietHours(at(iso), spec, offset);
      expect(resolution.deferred).toBe(deferred);
      expect(resolution.sendAtMs).toBe(at(sendAt));
      // Determinism: identical inputs => identical outputs.
      expect(deferForQuietHours(at(iso), spec, offset)).toEqual(resolution);
    },
  );

  it("deferral is monotone non-decreasing (never sends earlier than asked)", () => {
    const spec = DEFAULT_QUIET_HOURS;
    for (const iso of [
      "2024-01-02T06:00:00.000Z",
      "2024-01-02T12:00:00.000Z",
      "2024-01-02T23:59:59.999Z",
      "2024-01-03T00:00:00.000Z",
      "2024-01-03T06:59:59.999Z",
    ]) {
      const resolution = deferForQuietHours(at(iso), spec, 0);
      expect(resolution.sendAtMs).toBeGreaterThanOrEqual(at(iso));
    }
  });
});
