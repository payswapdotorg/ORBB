import { describe, expect, it } from "vitest";
import {
  hashReminderPayload,
  hashReminderSchedule,
  hashScheduleAuditView,
  serializeReminderPayload,
  serializeReminderSchedule,
  serializeScheduleAuditView,
  toScheduleAuditView,
} from "./serialization.js";
import { canonicalJsonStringify } from "./canonical.js";
import {
  MS_PER_DAY,
  MS_PER_HOUR,
  buildNotificationHarness,
  harnessProfile,
  syntheticTask,
} from "./testsupport.js";

function window(startMs: number, durationMs: number) {
  return { sequence: 0, startsAt: new Date(startMs), endsAt: new Date(startMs + durationMs) };
}

function computedSchedule() {
  const harness = buildNotificationHarness();
  const tasks = [
    syntheticTask({ index: 1, window: window(MS_PER_DAY, 2 * MS_PER_HOUR) }),
    syntheticTask({ index: 2, window: window(2 * MS_PER_DAY, MS_PER_HOUR) }),
  ];
  const result = harness.engine.computeSchedule({
    tasks,
    profile: harnessProfile({ quietHours: null }),
  });
  if (!result.ok) {
    throw new Error("expected scheduling to succeed");
  }
  return result.value;
}

describe("B8 serialization — the determinism-proof surface", () => {
  it("serializes schedules canonically: Dates as epoch ms, keys sorted, stable hashes", () => {
    const schedule = computedSchedule();
    const dump = serializeReminderSchedule(schedule);
    expect(dump).toContain('"computedAt":0');
    // Round-trip stability: parse + re-serialize is byte-identical.
    expect(canonicalJsonStringify(JSON.parse(dump))).toBe(dump);
    expect(hashReminderSchedule(schedule)).toBe(hashReminderSchedule(computedSchedule()));
    expect(hashReminderSchedule(schedule)).toHaveLength(64);
  });

  it("serializes payloads with rung-variant key discipline (absent keys stay absent)", () => {
    const schedule = computedSchedule();
    for (const reminder of schedule.reminders) {
      const dump = serializeReminderPayload(reminder.payload);
      expect(dump.startsWith("{")).toBe(true);
      if (reminder.payload.rung === "REMIND") {
        expect(dump).not.toContain("fallbackOffer");
      } else {
        expect(dump).toContain("fallbackOffer");
      }
      expect(hashReminderPayload(reminder.payload)).toHaveLength(64);
    }
  });

  it("audit views drop the addressing field and hash deterministically", () => {
    const schedule = computedSchedule();
    const view = toScheduleAuditView(schedule);
    expect(view.reminders).toHaveLength(schedule.reminders.length);
    expect(view.skippedChannelCount).toBe(schedule.skippedChannels.length);
    const dump = serializeScheduleAuditView(view);
    expect(dump).not.toContain("personId");
    expect(hashScheduleAuditView(view)).toBe(
      hashScheduleAuditView(toScheduleAuditView(computedSchedule())),
    );
  });

  it("re-serializes a parsed schedule audit view byte-identically", () => {
    const view = toScheduleAuditView(computedSchedule());
    const dump = serializeScheduleAuditView(view);
    expect(canonicalJsonStringify(JSON.parse(dump))).toBe(dump);
  });
});
